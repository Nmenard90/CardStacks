/** A binder cover photo can be set any time: what the binder update accepts as a cover. */
package com.poketracker

import com.poketracker.api.BinderRoutes

class BinderCoverSuite extends munit.FunSuite:
  test("a cover is empty, an https picture, or a small JPEG photo") {
    assert(BinderRoutes.validateCover("").isRight, "empty removes the cover")
    assert(BinderRoutes.validateCover("https://example.test/cover.png").isRight)
    assert(BinderRoutes.validateCover("data:image/jpeg;base64," + "A" * 80_000).isRight)
    assert(BinderRoutes.validateCover("data:image/jpeg;base64," + "A" * 500_000).isLeft, "too big")
    assert(BinderRoutes.validateCover("data:image/svg+xml;base64,PHN2Zz4=").isLeft, "only JPEG photos")
    assert(BinderRoutes.validateCover("javascript:alert(1)").isLeft)
    assert(BinderRoutes.validateCover("http://example.test/cover.png").isLeft, "https only")
  }
