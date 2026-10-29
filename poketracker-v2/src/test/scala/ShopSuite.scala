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

  test("a seller photo can be viewed publicly, but only the owner can upload or remove one") {
    assert(AuthGuard.isPublicPath(Method.GET, "/api/shop/nicholas/photo/sv3-125/front"))
    assert(!AuthGuard.isPublicPath(Method.PUT, "/api/collection/u1/shop-photos/sv3-125/front"))
    assert(!AuthGuard.isPublicPath(Method.DELETE, "/api/collection/u1/shop-photos/sv3-125/front"))
    assertEquals(AuthGuard.requiredOwnerUserId("/api/collection/u1/shop-photos/sv3-125/front"), Some("u1"))
  }

  test("only JPEG bytes pass the upload check") {
    val jpeg = Array[Byte](0xff.toByte, 0xd8.toByte, 0xff.toByte, 0xe0.toByte, 0x00)
    assert(com.poketracker.api.ShopRoutes.isJpeg(jpeg))
    assert(!com.poketracker.api.ShopRoutes.isJpeg("<script>alert(1)</script>".getBytes("UTF-8")))
    assert(!com.poketracker.api.ShopRoutes.isJpeg(Array[Byte](0x89.toByte, 0x50, 0x4e, 0x47, 0x0d)))  // PNG
    assert(!com.poketracker.api.ShopRoutes.isJpeg(Array.emptyByteArray))
  }

  test("photo address parts are checked") {
    import com.poketracker.api.ShopRoutes.validatePhotoKey
    assertEquals(validatePhotoKey("sv3-125", "front", Some("NM")), Right("NM"))
    assert(validatePhotoKey("sv3-125", "side", Some("NM")).isLeft)
    assert(validatePhotoKey("sv3-125", "back", None).isLeft)
    assert(validatePhotoKey("", "back", Some("NM")).isLeft)
    assert(validatePhotoKey("x" * 65, "back", Some("NM")).isLeft)
  }

  test("shop settings and the request inbox are owner-scoped, not public") {
    assert(!AuthGuard.isPublicPath(Method.GET, "/api/collection/u1/shop-settings"))
    assert(!AuthGuard.isPublicPath(Method.PUT, "/api/collection/u1/shop-settings"))
    assert(!AuthGuard.isPublicPath(Method.GET, "/api/collection/u1/shop-requests"))
    assertEquals(AuthGuard.requiredOwnerUserId("/api/collection/u1/shop-settings"), Some("u1"))
    assertEquals(AuthGuard.requiredOwnerUserId("/api/collection/u1/shop-requests/r9"), Some("u1"))
  }
