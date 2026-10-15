/**
 * GameParam — which game a request is for. The web app sends `?game=<id>`
 * on every request (an axios interceptor); a request without one — older
 * clients, scripts — means English Pokémon, so nothing breaks.
 *
 * USED BY: every route that lists or creates per-game data
 */

package com.poketracker.api

import com.poketracker.models.Game
import zio.http.Request

object GameParam:
  def of(req: Request): String = Game.sanitize(req.url.queryParams.getAll("game").headOption)
