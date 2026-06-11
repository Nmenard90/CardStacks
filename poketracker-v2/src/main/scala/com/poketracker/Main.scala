/**
 * FILE: Main.scala
 * PACKAGE: com.poketracker
 * LOCATION: src/main/scala/com/poketracker/Main.scala
 *
 * PURPOSE:
 *   The entry point of the entire application.
 *   Wires all layers together and starts the HTTP server.
 *   This is the only file that knows how everything connects.
 *
 * HOW THE APP STARTS:
 *   1. Read database config from environment variables
 *   2. Create the database connection pool (Transactor)
 *   3. Build the dependency graph: Transactor → Repositories → Services → Routes
 *   4. Start the HTTP server on the configured port
 *
 * WHAT IS A ZLAYER?
 *   ZLayer is ZIO's dependency injection system.
 *   Instead of passing dependencies manually through every function,
 *   we define layers that declare what they need and what they provide.
 *   ZIO wires them together automatically at startup.
 *
 *   Example chain:
 *     Transactor (needs: DB config)
 *       → CardRepository (needs: Transactor)
 *         → CardService (needs: CardRepository)
 *           → CardRoutes (needs: CardService)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTS EXPLAINED:
 *
 *   com.poketracker.api.*
 *     All route objects — CardRoutes, CollectionRoutes, UserRoutes, BinderRoutes.
 *
 *   com.poketracker.config.DatabaseConfig
 *     Reads DB connection settings and creates the connection pool.
 *
 *   com.poketracker.repository.*
 *     All repository layers — CardRepository, CollectionRepository, etc.
 *
 *   com.poketracker.service.*
 *     All service layers — CardService, CollectionService, etc.
 *
 *   zio.*
 *     ZIO core — ZIOAppDefault, ZLayer, ZIO.logInfo, Scope etc.
 *
 *   zio.http.*
 *     Server — starts the HTTP server on the configured port.
 *     Routes — combines multiple route sets into one.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * DEPENDS ON: All routes, services, repositories, DatabaseConfig
 */

package com.poketracker

import com.poketracker.api.*
import com.poketracker.config.DatabaseConfig
import com.poketracker.repository.*
import com.poketracker.service.*
import zio.*
import zio.http.*

/**
 * OBJECT: Main
 * PURPOSE: Application entry point. Extends ZIOAppDefault which provides
 *          the ZIO runtime and calls our run method automatically.
 */
object Main extends ZIOAppDefault:

  /**
   * VALUE: run
   * PURPOSE: The root ZIO effect representing the entire running application.
   *          Never completes normally — runs until the process is stopped.
   *
   * @return ZIO[Any, Throwable, Unit]
   *         Needs:       Nothing — ZIOAppDefault provides the environment
   *         Fails with:  Throwable if startup fails (bad config, DB unreachable)
   *         Produces:    Unit — runs forever serving requests
   */
  val run: ZIO[Any, Throwable, Unit] =
    ZIO.scoped {
      for
        // Step 1: Read database connection settings from environment variables.
        // Fails immediately with a clear message if any required variable is missing.
        config     <- DatabaseConfig.fromEnv

        // Step 2: Open the database connection pool.
        // Kept open for the entire lifetime of the app.
        // Automatically closed when the app stops (managed by Scope).
        transactor <- DatabaseConfig.makeTransactor(config)

        _          <- ZIO.logInfo("Database connection pool ready")

        // Step 3: Read the port from the PORT environment variable.
        // Railway sets PORT automatically. Default to 8080 for local dev.
        port       <- System.env("PORT").map(_.flatMap(_.toIntOption).getOrElse(8080))

        // Step 4: Build the dependency layers.
        // Each layer declares what it needs and ZIO provides it automatically.
        // The transactor is shared across all repositories.
        appLayer    = ZLayer.succeed(transactor) >>>
                      (CardRepository.layer ++
                       CollectionRepository.layer ++
                       UserRepository.layer ++
                       BinderRepository.layer) >>>
                      (CardService.layer ++
                       CollectionService.layer ++
                       UserService.layer ++
                       BinderService.layer)

        // Step 5: Combine all routes into one.
        // The health check is defined inline — no service needed for it.
        // All other routes are defined in their respective route files.
        allRoutes   = Routes(Method.GET / "health" -> Handler.ok) ++
                      CardRoutes.routes ++
                      CollectionRoutes.routes ++
                      UserRoutes.routes ++
                      BinderRoutes.routes

        _          <- ZIO.logInfo(s"Starting PokéTracker API on port $port")

        // Step 6: Start the HTTP server.
        // Server.serve blocks forever — it keeps running and handling requests.
        // We provide both the app layer (services/repos) and the server config.
        _          <- Server.serve(allRoutes)
                        .provide(appLayer, Server.defaultWithPort(port))

      yield ()
    }