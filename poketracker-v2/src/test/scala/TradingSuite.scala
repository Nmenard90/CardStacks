/**
 * TradingSuite — security boundary and offer-state rules for share-link
 * trading: the share page is the only public trading path, every
 * /api/trading/:userId path is owner-checked, and only the right side can
 * move an offer between states.
 */

package com.poketracker

import com.poketracker.security.AuthGuard
import com.poketracker.service.TradingService
import zio.http.Method

class TradingSuite extends munit.FunSuite:

  test("share page is public for GET only") {
    assert(AuthGuard.isPublicPath(Method.GET, "/api/share/abc123"))
    assert(!AuthGuard.isPublicPath(Method.POST, "/api/share/abc123"))
  }

  test("trading endpoints are not public and are owner-scoped") {
    assert(!AuthGuard.isPublicPath(Method.GET, "/api/trading/u1/offers"))
    assertEquals(AuthGuard.requiredOwnerUserId("/api/trading/u1/offers/o9/status"), Some("u1"))
    assertEquals(AuthGuard.requiredOwnerUserId("/api/trading/u1/list"), Some("u1"))
  }

  test("seller accepts or declines a pending offer; buyer can't") {
    assert(TradingService.allowed("seller", "Pending", "Accepted"))
    assert(TradingService.allowed("seller", "Pending", "Declined"))
    assert(!TradingService.allowed("buyer", "Pending", "Accepted"))
    assert(!TradingService.allowed("buyer", "Pending", "Declined"))
  }

  test("buyer withdraws a pending offer; seller can't") {
    assert(TradingService.allowed("buyer", "Pending", "Withdrawn"))
    assert(!TradingService.allowed("seller", "Pending", "Withdrawn"))
  }

  test("either side completes or cancels an accepted offer") {
    for role <- List("seller", "buyer"); to <- List("Completed", "Cancelled") do
      assert(TradingService.allowed(role, "Accepted", to), s"$role -> $to")
  }

  test("finished offers are final") {
    for from <- List("Declined", "Withdrawn", "Cancelled", "Completed");
        to   <- List("Pending", "Accepted", "Completed", "Cancelled") do
      assert(!TradingService.allowed("seller", from, to), s"$from -> $to")
  }
