/**
 * RipOrHoldEngine — the math behind "should I open this or keep it
 * sealed": guaranteed floor value, expected value per pack, a simulated
 * distribution of outcomes, a ceiling check, and an optional value
 * adjusted for cards the user already owns.
 *
 * HOW IT WORKS
 *   Pure functions only — plain numbers in, plain numbers out, no
 *   database or network — which is what makes this cheap to test
 *   exhaustively (see RipOrHoldEngineSuite). The distribution isn't a
 *   closed-form formula: simulateOneBox plays out one random box,
 *   simulate runs it 10,000 times and summarizes the results.
 *
 * INVARIANTS
 *   - Every dollar figure comes from a real price the caller supplies. A
 *     missing price is never guessed — it's excluded from the total and
 *     its card ID reported separately.
 *   - currentSealedPrice (real) and projectedSealedPrice (a labeled
 *     forecast) are always kept as two separate fields, never blended.
 *   - Pull odds never change mid-box based on what earlier packs in the
 *     same box contained — simulateOneBox has no parameter through which
 *     it could even see a prior pack's result, so this can't regress silently.
 *
 * USED BY: (future) RipTrackerService, verdict GET route
 */

package com.poketracker.service

import scala.util.Random

/** One card that hit in a simulated pack. */
final case class PulledCard(cardId: String, price: Double)

/**
 * One card's odds within one product.
 * @param perPackProbability  Chance this card appears in a single pack,
 *                            e.g. 0.0039 for a 1-in-256 pull.
 */
final case class PullRateInput(cardId: String, perPackProbability: Double)

/**
 * The certain value every copy of this product delivers — promos, sealed
 * inserts, and (if it has one) its pack guarantee — priced at real value.
 *
 * @param total               Total of every guaranteed item's real price.
 * @param missingPriceCardIds Guaranteed cards with no known price, left
 *                            out of `total` and reported here instead of
 *                            silently making the total look too low.
 */
final case class GuaranteedFloorResult(total: Double, missingPriceCardIds: List[String])

/**
 * The average value of opening one pack — each possible card's price
 * times its odds, added together.
 */
final case class PerPackEvResult(expectedValue: Double, missingPriceCardIds: List[String])

/**
 * The spread of likely outcomes from simulating many opened boxes.
 *
 * @param mean    Average simulated box value.
 * @param median  The MIDDLE simulated value — show this as the headline
 *                figure, not `mean`. A few rare huge pulls drag the
 *                average up in a way that misrepresents a typical box.
 * @param p10     A pessimistic-but-realistic outcome (90% of boxes did at least this well).
 * @param p90     An optimistic-but-realistic outcome (only 10% of boxes did better).
 * @param probBeatSealedPrice     Share of simulated boxes worth at least the sealed price.
 * @param probAboveChaseThreshold Share of simulated boxes that pulled at
 *                                least one card worth the chase threshold, if one was given.
 */
final case class DistributionStats(
  mean:                    Double,
  median:                  Double,
  p10:                     Double,
  p90:                     Double,
  probBeatSealedPrice:     Double,
  probAboveChaseThreshold: Option[Double]
)

/**
 * A sanity check against the single best possible pull.
 * @param maxSingleCardPrice  The highest real price among every pullable
 *                            card, if known.
 * @param ceilingBelowSealed  True if even that best case can't reach the
 *                            sealed price alone — worth flagging, though
 *                            not proof the box is bad, since the box's
 *                            full contents (floor included) might still clear it.
 */
final case class CeilingCheck(maxSingleCardPrice: Option[Double], ceilingBelowSealed: Boolean)

/**
 * A "value to this specific user" view that counts cards they already own
 * as worth less than a brand-new pull.
 */
final case class MarginalValueResult(perPackExpectedValue: Double, openExpectedValue: Double)

/** The full result the verdict endpoint returns. */
final case class Verdict(
  guaranteedFloor:      GuaranteedFloorResult,
  perPackEv:            PerPackEvResult,
  openExpectedValue:    Double,
  distribution:         DistributionStats,
  ceiling:              CeilingCheck,
  currentSealedPrice:   Double,
  projectedSealedPrice: Option[Double],
  marginalValue:        Option[MarginalValueResult]
)

/**
 * All the pure math functions that build a Verdict. Just a plain object,
 * not a trait+Live pair like other services — this file has no database
 * or network to inject, so there's nothing to swap out in tests.
 */
object RipOrHoldEngine:

  /**
   * Adds up every guaranteed item's real price, times how many are guaranteed.
   * @param guaranteedItems  (cardId, quantity) pairs — every guaranteed
   *                         insert/promo plus any pack-level guarantee.
   */
  def guaranteedFloor(
    guaranteedItems: List[(String, Int)],
    prices:          Map[String, Double]
  ): GuaranteedFloorResult =
    // Splits into items we have a price for and items we don't.
    val (found, missing) = guaranteedItems.partition { case (cardId, _) => prices.contains(cardId) }
    val total = found.map { case (cardId, qty) => prices(cardId) * qty }.sum
    GuaranteedFloorResult(total, missing.map(_._1).distinct)

  /** The average value of one pack — each card's odds times its price, summed. */
  def perPackEv(rates: List[PullRateInput], prices: Map[String, Double]): PerPackEvResult =
    val (found, missing) = rates.partition(r => prices.contains(r.cardId))
    val ev = found.map(r => r.perPackProbability * prices(r.cardId)).sum
    PerPackEvResult(ev, missing.map(_.cardId).distinct)

  /** Compares the single highest-priced pullable card against the sealed price. */
  def ceilingCheck(
    rates:              List[PullRateInput],
    prices:             Map[String, Double],
    currentSealedPrice: Double
  ): CeilingCheck =
    val max = rates.flatMap(r => prices.get(r.cardId)).maxOption
    // If we don't know the max price at all, default to "below sealed" —
    // there's no way to prove otherwise without data.
    CeilingCheck(max, max.forall(_ < currentSealedPrice))

  /**
   * Simulates opening ONE box: rolls the odds independently for every
   * pack, and sums up what hit. This function has no way to know what any
   * EARLIER pack in the box contained, so the odds genuinely can't drift
   * as more packs are opened.
   *
   * @param packCount  How many packs this box contains.
   * @param floor      The guaranteed value, added once for the whole box.
   * @param rng        The random source — pass a fixed-seed one in tests
   *                   so results are exactly repeatable.
   * @return           (total box value including floor, highest single card pulled)
   */
  def simulateOneBox(
    rates:     List[PullRateInput],
    prices:    Map[String, Double],
    packCount: Int,
    floor:     Double,
    rng:       Random
  ): (Double, Double) =
    val pulls: List[PulledCard] =
      // Once per pack in the box...
      (1 to packCount).flatMap { _ =>
        // ...roll independently for every possible card. A random number
        // under this card's odds counts as a hit.
        rates.flatMap { r =>
          if rng.nextDouble() < r.perPackProbability
          then Some(PulledCard(r.cardId, prices.getOrElse(r.cardId, 0.0)))
          else None
        }
      }.toList

    val total   = floor + pulls.map(_.price).sum
    val maxPull = if pulls.isEmpty then 0.0 else pulls.map(_.price).max
    (total, maxPull)

  /** The value at a given percentile of an already-sorted list of numbers. */
  private def percentile(sorted: IndexedSeq[Double], p: Double): Double =
    if sorted.isEmpty then 0.0
    else
      val idx = math.min(sorted.length - 1, math.max(0, math.ceil(p * sorted.length).toInt - 1))
      sorted(idx)

  /**
   * Simulates opening this product many times and summarizes what
   * happened. Since every simulated box is independent, the average
   * across all of them naturally lands on floor + packCount × perPackEv —
   * this is where "the odds don't drift mid-box" actually gets proven out
   * in practice (see RipOrHoldEngineSuite).
   *
   * @param trials  How many boxes to simulate (10,000 by default).
   * @param rng     Pass a fixed-seed Random in tests for repeatable results.
   */
  def simulate(
    rates:              List[PullRateInput],
    prices:             Map[String, Double],
    packCount:          Int,
    floor:              Double,
    currentSealedPrice: Double,
    chaseThreshold:     Option[Double] = None,
    trials:             Int = 10000,
    rng:                Random = new Random()
  ): DistributionStats =
    val results = (1 to trials).map(_ => simulateOneBox(rates, prices, packCount, floor, rng))
    val totals  = results.map(_._1).sorted
    val maxes   = results.map(_._2)

    DistributionStats(
      mean                   = totals.sum / totals.length,
      median                 = percentile(totals, 0.5),
      p10                    = percentile(totals, 0.10),
      p90                    = percentile(totals, 0.90),
      probBeatSealedPrice    = totals.count(_ >= currentSealedPrice).toDouble / totals.length,
      // Left blank unless a chase threshold was actually given.
      probAboveChaseThreshold = chaseThreshold.map(t => maxes.count(_ >= t).toDouble / maxes.length)
    )

  /**
   * A "value to this user" view — cards they already own count for less
   * than a brand-new pull, so a box that's mostly duplicates of cards
   * they're chasing a set with reads differently than raw market value would suggest.
   *
   * @param ownedDiscount  How much a duplicate is worth to this user,
   *                       e.g. 0.2 = "20% as valuable as a new pull." Set
   *                       by the caller, not decided here.
   */
  def marginalValue(
    rates:         List[PullRateInput],
    prices:        Map[String, Double],
    ownedCardIds:  Set[String],
    floor:         Double,
    packCount:     Int,
    ownedDiscount: Double
  ): MarginalValueResult =
    val (found, _) = rates.partition(r => prices.contains(r.cardId))
    val discountedPerPackEv = found.map { r =>
      val base = r.perPackProbability * prices(r.cardId)
      // Already owned — discount it. Otherwise, count it at full value.
      if ownedCardIds.contains(r.cardId) then base * ownedDiscount else base
    }.sum
    MarginalValueResult(discountedPerPackEv, floor + packCount * discountedPerPackEv)
