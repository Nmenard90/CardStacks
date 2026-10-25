/** Opt-in local Postgres regression tests for profile persistence and public
 * visibility. Apply schema/migrations through 020, set SHOP_PROFILE_IT_DB_URL.
 * Only disposable local databases are allowed; no production data is used. */
package com.poketracker

import cats.syntax.all.*
import com.poketracker.models.ShopSettings
import com.poketracker.repository.ShopRepository
import doobie.*
import doobie.implicits.*
import zio.*
import zio.interop.catz.*

class ShopProfileDbSuite extends munit.FunSuite:
  private val url = sys.env.get("SHOP_PROFILE_IT_DB_URL")
  override def munitTests() = if url.isEmpty then Nil else super.munitTests()
  private lazy val xa = Transactor.fromDriverManager[Task](
    driver = "org.postgresql.Driver", url = url.get, user = "postgres", password = "", logHandler = None)
  private lazy val repo = ShopRepository.Live(xa)
  private val owner = "profile-test-owner"
  private val other = "profile-test-other"
  private def run[A](z: Task[A]): A = Unsafe.unsafe { implicit u => Runtime.default.unsafe.run(z).getOrThrowFiberFailure() }
  override def beforeAll(): Unit = if url.nonEmpty then
    require(url.get.startsWith("jdbc:postgresql://127.0.0.1:"), "Use an isolated local database")
  override def afterAll(): Unit = if url.nonEmpty then
    run(sql"DELETE FROM shop_settings WHERE user_id IN ($owner,$other)".update.run.transact(xa).unit)

  test("a seller can save a name and multiline bio, and an enabled shop exposes them") {
    val settings = ShopSettings("profile-test", true, "https://m.me/test", "My Pokémon cards", "Hi!\nThese are cards from my collection.")
    run(repo.saveSettings(owner, settings))
    assertEquals(run(repo.getSettings(owner)), Some(settings))
    assertEquals(run(repo.findPublicSeller(settings.slug)), Some((owner, settings.messengerUrl, settings.displayName, settings.bio)))
  }

  test("turning a shop off hides its bio and editing it does not change another seller") {
    val separate = ShopSettings("profile-other", true, "", "Other shop", "Other bio")
    run(repo.saveSettings(other, separate))
    run(repo.saveSettings(owner, ShopSettings("profile-test", false, "", "Updated shop", "Private bio")))
    assertEquals(run(repo.findPublicSeller("profile-test")), None)
    assertEquals(run(repo.getSettings(other)), Some(separate))
  }

  test("old-style database rows get blank profile defaults after migration") {
    run(sql"INSERT INTO shop_settings(user_id,slug,enabled,messenger_url) VALUES('profile-legacy','profile-legacy',FALSE,'')".update.run.transact(xa))
    try assertEquals(run(repo.getSettings("profile-legacy")), Some(ShopSettings("profile-legacy", false, "")))
    finally run(sql"DELETE FROM shop_settings WHERE user_id='profile-legacy'".update.run.transact(xa))
  }
