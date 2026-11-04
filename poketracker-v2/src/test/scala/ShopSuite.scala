/**
 * ShopSuite — security boundary for the public shop: only /api/shop/<slug>
 * (and its /requests) is reachable without a login; the owner's settings and
 * inbox live under /api/collection/:userId and must stay owner-checked.
 */

package com.poketracker

import com.poketracker.security.AuthGuard
import com.poketracker.api.ShopRoutes
import com.poketracker.models.{BuyerRequestItem, ShopPhotoRef, ShopRequest, ShopRequestInput, ShopRequestItem, ShopRequestItemChange, ShopSettings}
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
    // The owner reads their own photos from their collection, signed in.
    assert(!AuthGuard.isPublicPath(Method.GET, "/api/collection/u1/shop-photos"))
    assert(!AuthGuard.isPublicPath(Method.GET, "/api/collection/u1/shop-photos/sv3-125/front"))
    assertEquals(AuthGuard.requiredOwnerUserId("/api/collection/u1/shop-photos"), Some("u1"))
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

  test("the request inbox's per-card pull list is owner-scoped") {
    assert(!AuthGuard.isPublicPath(Method.POST, "/api/collection/u1/shop-requests/r9/items/0"))
    assertEquals(AuthGuard.requiredOwnerUserId("/api/collection/u1/shop-requests/r9/items/0"), Some("u1"))
  }

  private val card = ShopRequestItem("base1-4", "Charizard", "4", "NM 1st Edition", 1)

  test("requests saved before the pull list still read, and new ones store nothing extra") {
    assertEquals("""{"cardId":"base1-4","name":"Charizard","number":"4","condition":"NM 1st Edition","qty":1}""".fromJson[ShopRequestItem], Right(card))
    assertEquals(card.toJson, """{"cardId":"base1-4","name":"Charizard","number":"4","condition":"NM 1st Edition","qty":1}""")
  }

  test("pull list: found, real condition, and back to what the buyer asked") {
    import ShopRoutes.applyItemChange
    val found = applyItemChange(card, ShopRequestItemChange(pulled = Some(true))).toOption.get
    assertEquals(found, card.copy(pulled = Some(true)))
    val lp = applyItemChange(found, ShopRequestItemChange(condition = Some("LP"))).toOption.get
    assertEquals(lp, card.copy(condition = "LP 1st Edition", pulled = Some(true), askedCondition = Some("NM 1st Edition")))
    // A second change keeps the buyer's original pick; setting it back forgets it.
    assertEquals(applyItemChange(lp, ShopRequestItemChange(condition = Some("MP"))).toOption.get.askedCondition, Some("NM 1st Edition"))
    assertEquals(applyItemChange(lp, ShopRequestItemChange(condition = Some("NM"))).toOption.get, card.copy(pulled = Some(true)))
    assertEquals(applyItemChange(card.copy(condition = "LP"), ShopRequestItemChange(condition = Some("HP"))).toOption.get.condition, "HP")
    assert(applyItemChange(card, ShopRequestItemChange(condition = Some("Mint"))).isLeft)
  }

  test("a buyer can't send cards already marked found or re-graded") {
    val sneaky = ShopRequestInput("Ash", "ash@example.test", "", List(card.copy(pulled = Some(true), askedCondition = Some("DMG"), foundQty = Some(1), sold = Some(1))))
    assertEquals(ShopRoutes.validateRequest(sneaky).toOption.get.items, List(card))
  }

  test("pull list: found some of several, all, or none") {
    import ShopRoutes.applyItemChange
    val three = card.copy(qty = 3)
    val two   = applyItemChange(three, ShopRequestItemChange(foundQty = Some(2))).toOption.get
    assertEquals((two.pulled, two.foundQty, two.found), (Some(true), Some(2), 2))
    assertEquals(applyItemChange(two, ShopRequestItemChange(foundQty = Some(3))).toOption.get, three.copy(pulled = Some(true)))
    assertEquals(applyItemChange(two, ShopRequestItemChange(foundQty = Some(0))).toOption.get, three.copy(pulled = Some(false)))
    assertEquals(applyItemChange(two, ShopRequestItemChange(pulled = Some(false))).toOption.get.found, 0)
    assert(applyItemChange(three, ShopRequestItemChange(foundQty = Some(4))).isLeft)
    assert(applyItemChange(three, ShopRequestItemChange(foundQty = Some(-1))).isLeft)
  }

  test("a sold card can't be changed on the pull list, and selling and putting back are owner-only") {
    import ShopRoutes.applyItemChange
    val sold = card.copy(pulled = Some(true), sold = Some(1))
    assert(applyItemChange(sold, ShopRequestItemChange(pulled = Some(false))).isLeft)
    assert(applyItemChange(sold, ShopRequestItemChange(condition = Some("LP"))).isLeft)
    for path <- List("/api/collection/u1/shop-requests/r1/sell", "/api/collection/u1/shop-requests/r1/put-back") do
      assert(!AuthGuard.isPublicPath(Method.POST, path))
      assertEquals(AuthGuard.requiredOwnerUserId(path), Some("u1"))
  }

  test("a buyer can ask for photos of a card; only a yes is stored") {
    val asked = ShopRequestInput("Ash", "ash@example.test", "", List(card.copy(photos = Some(true)), card.copy(cardId = "base1-2", photos = Some(false))))
    assertEquals(ShopRoutes.validateRequest(asked).toOption.get.items.map(_.photos), List(Some(true), None))
  }

  test("the buyer's view of a request: their pick, no pull-list notes, only photos of their cards") {
    val graded  = card.copy(condition = "LP 1st Edition", askedCondition = Some("NM 1st Edition"), pulled = Some(true), photos = Some(true))
    val request = ShopRequest("r1", "Ash", "ash@example.test", "hi", "buy", List(graded), "answered", java.time.Instant.EPOCH)
    val photos  = List(ShopPhotoRef("base1-4", "LP", "front", 1L), ShopPhotoRef("base1-2", "NM", "front", 2L))
    val view    = ShopRoutes.buyerView(request, photos)
    assertEquals(view.items, List(BuyerRequestItem("base1-4", "Charizard", "4", "LP 1st Edition", 1, true, Some("NM 1st Edition"))))
    assertEquals(view.photos, photos.take(1))
    assertEquals(view.status, "answered")
    assert(!view.toJson.contains("ash@example.test") && !view.toJson.contains("pulled"))
    assert(AuthGuard.isPublicPath(Method.GET, "/api/shop/nicholas/requests/0b5e1c9e-0000-4000-8000-000000000000"))
  }

  test("request emails are off until the mail server, user and password are all set") {
    import com.poketracker.service.ShopNotifier.readConfig
    val full = Map("SMTP_HOST" -> "smtp.gmail.com", "SMTP_USER" -> "me@gmail.test", "SMTP_PASSWORD" -> "abcd efgh ijkl mnop")
    assertEquals(readConfig(Map.empty[String, String].get), None)
    assertEquals(readConfig((full - "SMTP_PASSWORD").get), None)
    assertEquals(readConfig(full.updated("SMTP_HOST", "  ").get), None)
    val cfg = readConfig(full.get).get
    assertEquals((cfg.port, cfg.password, cfg.from, cfg.appUrl), (587, "abcdefghijklmnop", "me@gmail.test", "https://cardstacks.up.railway.app"))
    assertEquals(readConfig(full.updated("APP_URL", "https://example.test/").updated("SMTP_PORT", "465").get).map(c => (c.appUrl, c.port)),
      Some(("https://example.test", 465)))
  }

  test("the new-request email: who, how to reach them, the cards, and a link to My Shop") {
    import com.poketracker.service.ShopNotifier.requestEmail
    val request = ShopRequest("r1", "Ash\r\nBcc: x@evil.test", "Text: 555-123-4567", "Is it still there?", "buy",
                              List(card.copy(qty = 2, photos = Some(true))), "new", java.time.Instant.EPOCH)
    val email = requestEmail("seller@example.test", "nicholas", "Nick's Cards", request, "https://cardstacks.example")
    assertEquals(email.to, "seller@example.test")
    assert(!email.subject.exists(c => c == '\r' || c == '\n'), email.subject)
    assert(email.subject.contains("(2 cards)"), email.subject)
    for part <- List("How they want to be contacted: Text: 555-123-4567", "2× Charizard #4 (NM 1st Edition) · wants photos",
                     "Is it still there?", "https://cardstacks.example/shop/requests", "\"Nick's Cards\"") do
      assert(email.body.contains(part), part)
    assertEquals(email.replyTo, None)
    val question = requestEmail("s@example.test", "nicholas", "", request.copy(items = Nil, buyerContact = "Email: ash@example.test"), "https://x.test")
    assert(question.subject.startsWith("New question"), question.subject)
    assertEquals(question.replyTo, Some("ash@example.test"))
  }

  test("only a real email address the buyer chose becomes the Reply-To") {
    import com.poketracker.service.ShopNotifier.buyerEmail
    assertEquals(buyerEmail("email: ash@example.test "), Some("ash@example.test"))
    assertEquals(buyerEmail("Email: not an address"), None)
    assertEquals(buyerEmail("Email: a@b.test, c@d.test"), None)
    assertEquals(buyerEmail("Facebook: ash@example.test"), None)
  }
