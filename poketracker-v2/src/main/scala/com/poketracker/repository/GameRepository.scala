/**
 * GameRepository — reads the `games` table (migration 016). Games change
 * only by hand-editing that table (e.g. flipping `enabled`), so this is
 * read-only.
 *
 * USED BY: CardService, TcgTrackingCatalog, GameRoutes
 */

package com.poketracker.repository

import com.poketracker.models.Game
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.transactor.Transactor
import zio.*
import zio.interop.catz.*

trait GameRepository:
  /** Enabled games, in display order. */
  def listEnabled: Task[List[Game]]
  def findById(id: String): Task[Option[Game]]
  /** The game a catalog set belongs to. */
  def findBySetId(setId: String): Task[Option[Game]]

object GameRepository:

  final class Live(xa: Transactor[Task]) extends GameRepository:

    private type Row = (String, String, String, String, Int, Boolean, Int, Array[String], Boolean)
    private val toGame: Row => Game = (id, name, short, source, cat, enabled, pos, prefs, firstEd) =>
      Game(id, name, short, source, cat, enabled, pos, prefs.toList, firstEd)

    private val cols = fr"g.id, g.name, g.short_name, g.catalog_source, g.tcgtracking_category, g.enabled, g.position, g.print_preference, g.has_first_edition"

    def listEnabled: Task[List[Game]] =
      (fr"SELECT" ++ cols ++ fr"FROM games g WHERE g.enabled ORDER BY g.position, g.name")
        .query[Row].to[List].map(_.map(toGame)).transact(xa)

    def findById(id: String): Task[Option[Game]] =
      (fr"SELECT" ++ cols ++ fr"FROM games g WHERE g.id = $id")
        .query[Row].option.map(_.map(toGame)).transact(xa)

    def findBySetId(setId: String): Task[Option[Game]] =
      (fr"SELECT" ++ cols ++ fr"FROM card_sets s JOIN games g ON g.id = s.game_id WHERE s.id = $setId")
        .query[Row].option.map(_.map(toGame)).transact(xa)

  val layer: ZLayer[Transactor[Task], Nothing, GameRepository] =
    ZLayer.fromFunction(new Live(_))
