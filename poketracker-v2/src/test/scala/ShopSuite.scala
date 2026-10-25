/**
 * ShopSuite — security boundary for the public shop: only /api/shop/<slug>
 * (and its /requests) is reachable without a login; the owner's settings and
 * inbox live under /api/collection/:userId and must stay owner-checked.
 */

package com.poketracker

import com.poketracker.security.AuthGuard
import com.poketracker.api.ShopRoutes
import com.poketracker.models.ShopSettings
import zio.json.*
import zio.http.Method

class ShopSuite extends munit.FunSuite:

  test("existing shop settings without a profile still decode") {
    val decoded = """{"slug":"collector","enabled":true,"messengerUrl":""}""".fromJson[ShopSettings]
    assertEquals(decoded, Right(ShopSettings("collector", true, "", "", "")))
  }

  test("shop profile text is normalized, length-limited, and kept as plain text") {
    val input = ShopSettings(" Collector ", true, "", " My cards ", " Hello!\nI collect vintage cards. ")
    assertEquals(ShopRoutes.validateSettings(input), Right(input.copy(slug = "collector", displayName = "My cards", bio = "Hello!\nI collect vintage cards.")))
    assert(ShopRoutes.validateSettings(input.copy(displayName = "x" * 81)).isLeft)
    assert(ShopRoutes.validateSettings(input.copy(bio = "x" * 1001)).isLeft)
    assertEquals(ShopRoutes.validateSettings(input.copy(bio = "<script>plain text</script>")).toOption.get.bio, "<script>plain text</script>")
  }

  test("a shop page and its request form are public") {
    assert(AuthGuard.isPublicPath(Method.GET, "/api/shop/nicholas"))
    assert(AuthGuard.isPublicPath(Method.POST, "/api/shop/nicholas/requests"))
  }

  test("paths that merely start with the word shop are not public") {
    assert(!AuthGuard.isPublicPath(Method.GET, "/api/shopping"))
    assert(!AuthGuard.isPublicPath(Method.GET, "/api/shop"))
  }

  test("shop settings and the request inbox are owner-scoped, not public") {
    assert(!AuthGuard.isPublicPath(Method.GET, "/api/collection/u1/shop-settings"))
    assert(!AuthGuard.isPublicPath(Method.PUT, "/api/collection/u1/shop-settings"))
    assert(!AuthGuard.isPublicPath(Method.GET, "/api/collection/u1/shop-requests"))
    assertEquals(AuthGuard.requiredOwnerUserId("/api/collection/u1/shop-settings"), Some("u1"))
    assertEquals(AuthGuard.requiredOwnerUserId("/api/collection/u1/shop-requests/r9"), Some("u1"))
  }
