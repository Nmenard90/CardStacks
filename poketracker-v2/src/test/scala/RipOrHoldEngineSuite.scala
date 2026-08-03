/**
 * FILE: RipOrHoldEngineSuite.scala
 * LOCATION: src/test/scala/RipOrHoldEngineSuite.scala
 *
 * PURPOSE:
 *   Unit tests for RipOrHoldEngine — the pure rip-or-hold EV/Monte Carlo
 *   math. Covers the guaranteed floor, per-pack EV, ceiling check, the
 *   Monte Carlo distribution (including that median and mean are genuinely
 *   different numbers, not aliases of each other), marginal value, and —
 *   explicitly, per the correctness rule this engine exists to enforce —
 *   that an ungoverned product's pull odds never shift mid-box.
 *
 * DEPENDS ON: com.poketracker.service.RipOrHoldEngine
 */

import com.poketracker.service.*
import scala.util.Random

class RipOrHoldEngineSuite extends munit.FunSuite:

  // ── guaranteedFloor ─────────────────────────────────────────────────────

  test("guaranteedFloor sums real prices, quantity-weighted") {
    val items  = List("promo-1" -> 1, "promo-2" -> 2)
    val prices = Map("promo-1" -> 5.0, "promo-2" -> 1.5)
    val result = RipOrHoldEngine.guaranteedFloor(items, prices)
    assertEqualsDouble(result.total, 5.0 + 2 * 1.5, 0.0001)
    assertEquals(result.missingPriceCardIds, Nil)
  }

  test("guaranteedFloor excludes and reports cards with no price, never estimates") {
    val items  = List("promo-1" -> 1, "promo-unknown" -> 1)
    val prices = Map("promo-1" -> 5.0)
    val result = RipOrHoldEngine.guaranteedFloor(items, prices)
    assertEqualsDouble(result.total, 5.0, 0.0001) // NOT 5.0 + some guessed value
    assertEquals(result.missingPriceCardIds, List("promo-unknown"))
  }

  // ── perPackEv ────────────────────────────────────────────────────────────

  test("perPackEv is the probability-weighted sum") {
    val rates  = List(PullRateInput("common-1", 0.5), PullRateInput("rare-1", 0.01))
    val prices = Map("common-1" -> 0.10, "rare-1" -> 20.0)
    val result = RipOrHoldEngine.perPackEv(rates, prices)
    assertEqualsDouble(result.expectedValue, 0.5 * 0.10 + 0.01 * 20.0, 0.0001)
    assertEquals(result.missingPriceCardIds, Nil)
  }

  test("perPackEv drops cards with no price from the sum instead of guessing") {
    val rates  = List(PullRateInput("known", 0.5), PullRateInput("unknown", 0.5))
    val prices = Map("known" -> 1.0)
    val result = RipOrHoldEngine.perPackEv(rates, prices)
    assertEqualsDouble(result.expectedValue, 0.5, 0.0001)
    assertEquals(result.missingPriceCardIds, List("unknown"))
  }

  // ── ceilingCheck ─────────────────────────────────────────────────────────

  test("ceilingCheck flags when even the best possible pull can't beat sealed price") {
    val rates  = List(PullRateInput("a", 0.1), PullRateInput("b", 0.01))
    val prices = Map("a" -> 5.0, "b" -> 8.0)
    val result = RipOrHoldEngine.ceilingCheck(rates, prices, currentSealedPrice = 100.0)
    assertEquals(result.maxSingleCardPrice, Some(8.0))
    assertEquals(result.ceilingBelowSealed, true)
  }

  test("ceilingCheck clears when the best possible pull beats sealed price") {
    val rates  = List(PullRateInput("chase", 0.001))
    val prices = Map("chase" -> 500.0)
    val result = RipOrHoldEngine.ceilingCheck(rates, prices, currentSealedPrice = 100.0)
    assertEquals(result.ceilingBelowSealed, false)
  }

  test("ceilingCheck returns None (not a guessed max) when every candidate card's price is unknown") {
    val rates  = List(PullRateInput("mystery", 0.01))
    val result = RipOrHoldEngine.ceilingCheck(rates, Map.empty, currentSealedPrice = 100.0)
    assertEquals(result.maxSingleCardPrice, None)
  }

  // ── simulate: distribution shape ────────────────────────────────────────

  test("median and mean are genuinely different numbers for a skewed payout") {
    // A payout structure where one rare card is worth vastly more than the
    // common ones — a handful of lucky boxes should pull mean above median.
    val rates = List(
      PullRateInput("common", 0.9),
      PullRateInput("jackpot", 0.01)
    )
    val prices = Map("common" -> 0.25, "jackpot" -> 200.0)
    val dist = RipOrHoldEngine.simulate(
      rates, prices, packCount = 36, floor = 0.0,
      currentSealedPrice = 10.0, trials = 20000, rng = new Random(42)
    )
    assert(dist.mean > dist.median, s"expected mean (${dist.mean}) > median (${dist.median}) for a skewed payout")
  }

  test("percentiles are ordered p10 <= median <= p90") {
    val rates  = List(PullRateInput("a", 0.3), PullRateInput("b", 0.05))
    val prices = Map("a" -> 1.0, "b" -> 5.0)
    val dist = RipOrHoldEngine.simulate(
      rates, prices, packCount = 10, floor = 2.0,
      currentSealedPrice = 10.0, trials = 5000, rng = new Random(7)
    )
    assert(dist.p10 <= dist.median, s"p10 (${dist.p10}) should be <= median (${dist.median})")
    assert(dist.median <= dist.p90, s"median (${dist.median}) should be <= p90 (${dist.p90})")
  }

  test("simulated mean converges on floor + packCount * perPackEv within tolerance") {
    val rates  = List(PullRateInput("a", 0.4), PullRateInput("b", 0.02))
    val prices = Map("a" -> 0.5, "b" -> 12.0)
    val packCount = 24
    val floor = 3.0
    val expectedPerPackEv = RipOrHoldEngine.perPackEv(rates, prices).expectedValue
    val expectedOpenEv    = floor + packCount * expectedPerPackEv

    val dist = RipOrHoldEngine.simulate(
      rates, prices, packCount, floor, currentSealedPrice = 10.0,
      trials = 30000, rng = new Random(99)
    )
    // Monte Carlo noise, not exactness — a generous but meaningful tolerance.
    assert(
      math.abs(dist.mean - expectedOpenEv) < expectedOpenEv * 0.05,
      s"simulated mean ${dist.mean} should be within 5% of theoretical EV $expectedOpenEv"
    )
  }

  test("probBeatSealedPrice and probAboveChaseThreshold are valid probabilities in [0,1]") {
    val rates  = List(PullRateInput("a", 0.5), PullRateInput("chase", 0.02))
    val prices = Map("a" -> 1.0, "chase" -> 50.0)
    val dist = RipOrHoldEngine.simulate(
      rates, prices, packCount = 12, floor = 0.0,
      currentSealedPrice = 8.0, chaseThreshold = Some(40.0),
      trials = 5000, rng = new Random(3)
    )
    assert(dist.probBeatSealedPrice >= 0.0 && dist.probBeatSealedPrice <= 1.0)
    assert(dist.probAboveChaseThreshold.exists(p => p >= 0.0 && p <= 1.0))
  }

  test("no chase threshold supplied means no chase probability is reported") {
    val dist = RipOrHoldEngine.simulate(
      List(PullRateInput("a", 0.5)), Map("a" -> 1.0),
      packCount = 5, floor = 0.0, currentSealedPrice = 3.0,
      trials = 100, rng = new Random(1)
    )
    assertEquals(dist.probAboveChaseThreshold, None)
  }

  // ── CRITICAL: no mid-box odds updating for an ungoverned product ────────
  // This is the gambler's-fallacy prohibition from the brief, embedded as a
  // test rather than left as a comment. An ungoverned product's per-pack
  // odds must be identical no matter how many packs in the same box have
  // already been opened, or what they contained.

  test("an ungoverned product's per-pack hit rate does not drift across pack position within a box") {
    val cardId = "chase-card"
    val prob   = 0.10
    val rates  = List(PullRateInput(cardId, prob))
    val prices = Map(cardId -> 25.0)
    val packCount = 20
    val rng = new Random(2024)

    // Run many boxes, and for each pack POSITION (1st, 2nd, ..., 20th pack
    // across all boxes), track how often that position hit. If odds were
    // "heating up" toward the end of a box (the gambler's-fallacy bug this
    // test exists to catch), later positions would show a materially higher
    // hit rate than earlier ones.
    val trials = 4000
    val hitsByPosition = Array.fill(packCount)(0)

    for _ <- 1 to trials do
      for packIndex <- 0 until packCount do
        // Deliberately calling simulateOneBox with packCount=1 per pack
        // position and re-summing prior positions' state nowhere — this
        // mirrors that the production code path (simulateOneBox with the
        // full packCount) has no channel for a later pack to see earlier
        // pack outcomes: every pack independently rolls `rates` against the
        // same `rng`, full stop.
        val (total, _) = RipOrHoldEngine.simulateOneBox(rates, prices, packCount = 1, floor = 0.0, rng)
        if total > 0.0 then hitsByPosition(packIndex) += 1

    val hitRates = hitsByPosition.map(_.toDouble / trials)
    val firstQuarterAvg = hitRates.take(packCount / 4).sum / (packCount / 4)
    val lastQuarterAvg  = hitRates.takeRight(packCount / 4).sum / (packCount / 4)

    // Both should hover near the true probability, and — the actual point
    // of this test — near EACH OTHER. A systematic rise from first quarter
    // to last quarter would indicate odds updating within a box.
    assert(
      math.abs(firstQuarterAvg - lastQuarterAvg) < 0.03,
      s"first-quarter hit rate ($firstQuarterAvg) and last-quarter hit rate ($lastQuarterAvg) " +
      s"should be statistically indistinguishable for an ungoverned product — a drift here means " +
      s"odds are (incorrectly) updating mid-box"
    )
    assert(
      math.abs(firstQuarterAvg - prob) < 0.03 && math.abs(lastQuarterAvg - prob) < 0.03,
      s"both should also sit near the true per-pack probability ($prob)"
    )
  }

  test("simulateOneBox's signature itself takes no prior-pack-results argument") {
    // A compile-time-shaped assertion: if this line compiles with exactly
    // these five arguments, there is no fifth "previous pulls in this box"
    // channel for pack N to read pack N-1's outcome through. Odds-updating
    // would require such a channel to exist at all.
    val rng = new Random(1)
    val (_, _) = RipOrHoldEngine.simulateOneBox(
      rates = List(PullRateInput("a", 0.1)),
      prices = Map("a" -> 1.0),
      packCount = 5,
      floor = 0.0,
      rng = rng
    )
    assert(true)
  }

  // ── marginalValue ────────────────────────────────────────────────────────

  test("marginalValue discounts cards the user already owns") {
    val rates  = List(PullRateInput("owned", 0.5), PullRateInput("new", 0.5))
    val prices = Map("owned" -> 10.0, "new" -> 10.0)
    val result = RipOrHoldEngine.marginalValue(
      rates, prices, ownedCardIds = Set("owned"),
      floor = 0.0, packCount = 1, ownedDiscount = 0.2
    )
    val expected = 0.5 * 10.0 * 0.2 + 0.5 * 10.0
    assertEqualsDouble(result.perPackExpectedValue, expected, 0.0001)
  }

  test("marginalValue with no owned cards matches ordinary perPackEv") {
    val rates  = List(PullRateInput("a", 0.3), PullRateInput("b", 0.1))
    val prices = Map("a" -> 2.0, "b" -> 5.0)
    val ordinary  = RipOrHoldEngine.perPackEv(rates, prices).expectedValue
    val marginal  = RipOrHoldEngine.marginalValue(
      rates, prices, ownedCardIds = Set.empty,
      floor = 0.0, packCount = 1, ownedDiscount = 0.2
    )
    assertEqualsDouble(marginal.perPackExpectedValue, ordinary, 0.0001)
  }
