/**
 * FILE: RipOrHoldEngine.scala
 * PACKAGE: com.poketracker.service
 * LOCATION: src/main/scala/com/poketracker/service/RipOrHoldEngine.scala
 *
 * PURPOSE:
 *   Pure "should I open this or keep it sealed" math. Takes a product's
 *   guaranteed contents, its per-card pull-rate table, and real market
 *   prices, and produces a guaranteed floor, per-pack/open expected value,
 *   a Monte Carlo outcome distribution, a ceiling check, and (optionally) a
 *   marginal-to-you value that discounts cards the user already owns.
 *
 *   No database access, no HTTP, no randomness source hardcoded in — every
 *   function here takes plain data in and returns plain data out, which is
 *   what makes it cheap to unit test exhaustively (see RipOrHoldEngineSuite)
 *   without spinning up a database or server.
 *
 * DATA INTEGRITY RULES THIS FILE ENFORCES:
 *   - Every dollar figure here comes from a real price the caller supplies.
 *     A missing price is never estimated, multiplied, or interpolated —
 *     it's dropped from the sum and its card ID is returned in
 *     `missingPriceCardIds` so the caller can say "price not found" instead
 *     of silently under-counting.
 *   - `currentSealedPrice` (real, current market price) and
 *     `projectedSealedPrice` (a labeled forecast, optional) are separate
 *     fields on VerdictInput/Verdict — never combined into one number.
 *   - No mid-box odds updating. `perPackProbability` for a card is the same
 *     for every pack in a simulated box regardless of what earlier packs in
 *     that box rolled — treating an ungoverned product as "due" for a hit
 *     after several empty packs is the gambler's fallacy, and nothing in
 *     `simulateOneBox` takes prior-pack results as an input, structurally
 *     ruling it out. See RipOrHoldEngineSuite's
 *     "no odds updating for an ungoverned product" test.
 *
 * USED BY: (future) RipTrackerService, verdict GET route
 */

package com.poketracker.service

import scala.util.Random

/**
 * CASE CLASS: PulledCard
 * PURPOSE: One card that hit in a simulated pack.
 * @param cardId  Which card
 * @param price   Its real market price (never estimated)
 */
final case class PulledCard(cardId: String, price: Double)

/**
 * CASE CLASS: PullRateInput
 * PURPOSE: One card's odds within one product — mirrors the PullRate model,
 *          decoupled from it so this engine has zero DB/JSON dependencies.
 * @param cardId               The card
 * @param perPackProbability   Chance this card appears in a single pack, e.g.
 *                             0.00390625 for a 1-in-256 pull
 */
final case class PullRateInput(cardId: String, perPackProbability: Double)

/**
 * CASE CLASS: GuaranteedFloorResult
 * PURPOSE: The certain, zero-variance value every box/product delivers —
 *          promos, sealed inserts, and (if the product has one) its
 *          pack-level guarantee, priced at real market value.
 * @param total               Sum of real prices for every guaranteed item.
 * @param missingPriceCardIds Guaranteed cards whose price was unavailable —
 *                            excluded from `total`, surfaced so the caller
 *                            can show "price not found" rather than a
 *                            silently low number.
 */
final case class GuaranteedFloorResult(total: Double, missingPriceCardIds: List[String])

/**
 * CASE CLASS: PerPackEvResult
 * PURPOSE: Expected value of opening one pack — Σ probability × price
 *          across every card in the pull-rate table.
 * @param expectedValue       The per-pack EV, real-price cards only.
 * @param missingPriceCardIds Pull-rate cards whose price was unavailable —
 *                            excluded from the sum, surfaced for "price not
 *                            found" reporting.
 */
final case class PerPackEvResult(expectedValue: Double, missingPriceCardIds: List[String])

/**
 * CASE CLASS: DistributionStats
 * PURPOSE: Outcome distribution of opening the whole product, from a Monte
 *          Carlo simulation. `median` is the headline figure — a handful of
 *          rare high-value pulls skew `mean` upward in a way that
 *          misrepresents what a typical box actually returns.
 * @param mean                   Average simulated box value.
 * @param median                 Middle simulated box value — HEADLINE this,
 *                               not `mean`.
 * @param p10                    10th percentile — a pessimistic-but-plausible outcome.
 * @param p90                    90th percentile — an optimistic-but-plausible outcome.
 * @param probBeatSealedPrice    Fraction of simulated boxes whose total value
 *                               met or beat `currentSealedPrice`.
 * @param probAboveChaseThreshold  Fraction of simulated boxes that pulled at
 *                               least one single card at or above the chase
 *                               threshold, if one was supplied.
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
 * CASE CLASS: CeilingCheck
 * PURPOSE: Sanity check against the best possible single pull.
 * @param maxSingleCardPrice  The highest real price among every card the
 *                            product can pull, if all have known prices.
 *                            None if the max card's price is unknown.
 * @param ceilingBelowSealed  True when even that best-case single pull can't
 *                            reach the sealed price on its own — a strong
 *                            signal worth surfacing prominently, not proof
 *                            the box is bad (the box's *total* contents,
 *                            floor included, might still clear it).
 */
final case class CeilingCheck(maxSingleCardPrice: Option[Double], ceilingBelowSealed: Boolean)

/**
 * CASE CLASS: MarginalValueResult
 * PURPOSE: A second, "value to this specific user" view that discounts cards
 *          they already own — distinct from raw market EV, which treats
 *          every pull as equally new.
 * @param perPackExpectedValue  Per-pack EV, but cards the user already owns
 *                              are down-weighted by `ownedDiscount` instead
 *                              of counted at full price.
 * @param openExpectedValue     Floor + packCount × perPackExpectedValue,
 *                              using the discounted per-pack figure.
 */
final case class MarginalValueResult(perPackExpectedValue: Double, openExpectedValue: Double)

/**
 * CASE CLASS: Verdict
 * PURPOSE: The full structured result the GET verdict route returns.
 *          Rendered by the frontend in this order: ceiling, then verdict/
 *          distribution, then guaranteed floor, then current vs projected
 *          sealed price — an honest, informational summary, not a command.
 * @param guaranteedFloor       Certain value (promos/inserts/pack-guarantee).
 * @param perPackEv             Expected value of one pack.
 * @param openExpectedValue     floor + packCount × perPackEv.
 * @param distribution          Monte Carlo outcome distribution.
 * @param ceiling               Best-single-pull sanity check.
 * @param currentSealedPrice    Real, current sealed-product market price.
 * @param projectedSealedPrice  A labeled forecast, kept separate from
 *                              `currentSealedPrice` on purpose — never
 *                              blended into a "real" number.
 * @param marginalValue         Present only when a user's collection was supplied.
 */
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
 * OBJECT: RipOrHoldEngine
 * PURPOSE: All the pure functions that build a Verdict.
 */
object RipOrHoldEngine:

  /**
   * FUNCTION: guaranteedFloor
   * PURPOSE: Sums real prices for every guaranteed item (quantity-weighted).
   *          A missing price is skipped from the sum and reported, never
   *          estimated.
   * @param guaranteedItems  (cardId, quantity) pairs for every guaranteed
   *                         insert/promo, plus pack-level guarantees for
   *                         products that have one.
   * @param prices           cardId -> real price, when known.
   * @return                 Certain total value plus any cards with no price on file.
   */
  def guaranteedFloor(
    guaranteedItems: List[(String, Int)],
    prices:          Map[String, Double]
  ): GuaranteedFloorResult =
    val (found, missing) = guaranteedItems.partition { case (cardId, _) => prices.contains(cardId) }
    val total = found.map { case (cardId, qty) => prices(cardId) * qty }.sum
    GuaranteedFloorResult(total, missing.map(_._1).distinct)

  /**
   * FUNCTION: perPackEv
   * PURPOSE: Σ probability × price across the pull-rate table. A card with
   *          no price on file contributes nothing to the sum and is
   *          reported separately, not treated as $0 silently.
   * @param rates   The product's full pull-rate table.
   * @param prices  cardId -> real price, when known.
   * @return        Per-pack expected value plus any cards with no price on file.
   */
  def perPackEv(rates: List[PullRateInput], prices: Map[String, Double]): PerPackEvResult =
    val (found, missing) = rates.partition(r => prices.contains(r.cardId))
    val ev = found.map(r => r.perPackProbability * prices(r.cardId)).sum
    PerPackEvResult(ev, missing.map(_.cardId).distinct)

  /**
   * FUNCTION: ceilingCheck
   * PURPOSE: Compares the single highest-priced card the product can pull
   *          against the sealed price.
   * @param rates             The product's pull-rate table (defines which
   *                          cards are even possible to pull).
   * @param prices            cardId -> real price, when known.
   * @param currentSealedPrice  Real current sealed price to check against.
   * @return                  The max price found (None if every candidate
   *                          card's price is unknown) and whether it clears
   *                          the sealed price.
   */
  def ceilingCheck(
    rates:              List[PullRateInput],
    prices:             Map[String, Double],
    currentSealedPrice: Double
  ): CeilingCheck =
    val max = rates.flatMap(r => prices.get(r.cardId)).maxOption
    CeilingCheck(max, max.forall(_ < currentSealedPrice))

  /**
   * FUNCTION: simulateOneBox
   * PURPOSE: One Monte Carlo trial — opens `packCount` independent packs and
   *          sums what hits. THE CRITICAL PROPERTY: this function takes no
   *          "packs already opened" or "prior pulls" argument at all, so it
   *          is structurally impossible for pack N's odds to depend on packs
   *          1..N-1 within the same simulated box — there's nothing to read.
   *          Every pack independently rolls the same `rates` against the
   *          same `rng`.
   * @param rates      The product's pull-rate table.
   * @param prices     cardId -> real price. Cards with no price contribute
   *                   $0 to this specific simulated trial (already excluded/
   *                   reported at the EV-summary level via perPackEv/
   *                   guaranteedFloor — this function is the per-trial engine,
   *                   not where "price not found" is surfaced).
   * @param packCount  How many independent packs this box contains.
   * @param floor      Guaranteed value added once per box (not per pack).
   * @param rng        Random source — caller-supplied so results are
   *                   reproducible in tests via a seeded Random.
   * @return            (total box value including floor, highest single
   *                    card pulled — 0.0 if nothing hit)
   */
  def simulateOneBox(
    rates:     List[PullRateInput],
    prices:    Map[String, Double],
    packCount: Int,
    floor:     Double,
    rng:       Random
  ): (Double, Double) =
    val pulls: List[PulledCard] =
      (1 to packCount).flatMap { _ =>
        rates.flatMap { r =>
          if rng.nextDouble() < r.perPackProbability
          then Some(PulledCard(r.cardId, prices.getOrElse(r.cardId, 0.0)))
          else None
        }
      }.toList
    val total   = floor + pulls.map(_.price).sum
    val maxPull = if pulls.isEmpty then 0.0 else pulls.map(_.price).max
    (total, maxPull)

  /**
   * FUNCTION: percentile
   * PURPOSE: Nearest-rank percentile of an already-sorted sample. Small,
   *          private, and unit-tested indirectly through `simulate`.
   * @param sorted  Ascending-sorted samples.
   * @param p       Percentile in [0, 1], e.g. 0.5 for median.
   * @return        The value at that percentile.
   */
  private def percentile(sorted: IndexedSeq[Double], p: Double): Double =
    if sorted.isEmpty then 0.0
    else
      val idx = math.min(sorted.length - 1, math.max(0, math.ceil(p * sorted.length).toInt - 1))
      sorted(idx)

  /**
   * FUNCTION: simulate
   * PURPOSE: Runs N independent box-opening trials and summarizes the
   *          resulting distribution. This is where "no mid-box odds
   *          updating" ultimately shows up empirically — every trial calls
   *          `simulateOneBox` fresh, so the simulated mean converges on
   *          floor + packCount × perPackEv exactly as independence predicts
   *          (see RipOrHoldEngineSuite).
   * @param rates               Pull-rate table.
   * @param prices              cardId -> real price.
   * @param packCount           Packs per box.
   * @param floor               Guaranteed value added once per box.
   * @param currentSealedPrice  Real sealed price, for probBeatSealedPrice.
   * @param chaseThreshold      Optional "chase card" price threshold.
   * @param trials              Number of Monte Carlo trials (brief default: 10,000).
   * @param rng                 Random source — pass a seeded Random for
   *                            reproducible tests.
   * @return                    Summarized outcome distribution.
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
      probAboveChaseThreshold = chaseThreshold.map(t => maxes.count(_ >= t).toDouble / maxes.length)
    )

  /**
   * FUNCTION: marginalValue
   * PURPOSE: A "value to this user" view — cards already owned are
   *          discounted rather than counted at full market price, so a box
   *          that's mostly cards you're chasing a completed set with reads
   *          differently than raw market EV would suggest.
   * @param rates          Pull-rate table.
   * @param prices         cardId -> real price.
   * @param ownedCardIds   Cards the user already owns.
   * @param floor          Guaranteed value added once per box.
   * @param packCount      Packs per box.
   * @param ownedDiscount  Multiplier applied to a pull's value when the user
   *                       already owns it, e.g. 0.2 = "worth 20% as much to
   *                       you personally, the rest is dupe/trade value."
   *                       Caller-supplied, not invented here.
   * @return                Discounted per-pack and open expected value.
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
      if ownedCardIds.contains(r.cardId) then base * ownedDiscount else base
    }.sum
    MarginalValueResult(discountedPerPackEv, floor + packCount * discountedPerPackEv)
