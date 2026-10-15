/**
 * ConditionKeySuite — the condition-key grammar shared with the frontend
 * (web/src/lib/conditions.ts parseKey): "<COND>[ 1st Ed][ · <print>]".
 */

package com.poketracker

import com.poketracker.models.ConditionKey

class ConditionKeySuite extends munit.FunSuite:

  test("plain condition is the standard print, unlimited") {
    assertEquals(ConditionKey.parse("NM"), ConditionKey("NM", "unlimited", "standard"))
  }

  test("1st Ed suffix sets the edition") {
    assertEquals(ConditionKey.parse("LP 1st Ed"), ConditionKey("LP", "first_edition", "standard"))
  }

  test("print suffix becomes the variant, lower-cased") {
    assertEquals(ConditionKey.parse("NM · reverse"), ConditionKey("NM", "unlimited", "reverse"))
    assertEquals(ConditionKey.parse("MP · Pokeball"), ConditionKey("MP", "unlimited", "pokeball"))
  }

  test("1st Ed and print together") {
    assertEquals(ConditionKey.parse("NM 1st Ed · holo"), ConditionKey("NM", "first_edition", "holo"))
  }

  test("empty print suffix falls back to standard") {
    assertEquals(ConditionKey.parse("HP · "), ConditionKey("HP", "unlimited", "standard"))
  }
