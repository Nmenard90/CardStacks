/**
 * FILE: Main.scala
 * PACKAGE: com.poketracker
 * LOCATION: src/main/scala/com/poketracker/Main.scala
 *
 * PURPOSE:
 *   The entry point of the entire application.
 *   When Railway starts the server, this is the first code that runs.
 *   It reads configuration, connects to the database, and starts
 *   listening for HTTP requests.
 *
 * WHY EXTEND ZIOAPPDEFAULT?
 *   ZIOAppDefault is ZIO's version of a main class.
 *   Instead of "def main(args: Array[String])" like regular Java/Scala,
 *   ZIO apps override "val run" which returns a ZIO effect.
 *   ZIO then manages the entire application lifecycle:
 *     - Starts the effect
 *     - Handles any errors that bubble up to the top
 *     - Shuts down cleanly when the process receives a termination signal
 *     - Guarantees all resources (database pool, HTTP server) are closed
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTS EXPLAINED:
 *
 *   com.poketracker.config.DatabaseConfig
 *     Our configuration class that reads DATABASE_URL etc from environment
 *     variables and creates the database connection pool.
 *
 *   zio.*
 *     ZIO core — ZIO, ZIOAppDefault, ZLayer, Scope, Console etc.
 *
 *   zio.http.*
 *     ZIO HTTP server — Server, Routes, Handler etc.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * DEPENDS ON: DatabaseConfig, all Route files (added as we build them)
 */

package com.poketracker

import com.poketracker.config.DatabaseConfig
import zio.*
import zio.http.*

/**
 * OBJECT: Main
 *
 * PURPOSE:
 *   The application entry point. Extends ZIOAppDefault which provides
 *   the ZIO runtime that executes our effects.
 *
 * WHY AN OBJECT AND NOT A CLASS?
 *   There is exactly one entry point to an application — it makes no
 *   sense to have multiple instances of it. An object enforces this.
 */
object Main extends ZIOAppDefault:

  /**
   * VALUE: run
   *
   * PURPOSE:
   *   The root ZIO effect that represents the entire running application.
   *   ZIOAppDefault calls this automatically when the process starts.
   *   This effect never completes normally — it runs until the process
   *   is killed or an unrecoverable error occurs.
   *
   * HOW THE APP STARTS:
   *   1. Read database config from environment variables
   *   2. Create the database connection pool
   *   3. Define HTTP routes
   *   4. Start the HTTP server
   *   5. Wait forever (serving requests)
   *
   * @return ZIO[Any, Throwable, Unit]
   *         - Needs:       Nothing (ZIOAppDefault provides the environment)
   *         - Fails with:  Throwable if startup fails
   *                        (bad config, database unreachable, port in use)
   *         - Produces:    Unit — this effect runs forever, it never
   *                        "produces" a result, it just keeps running
   */
  val run: ZIO[Any, Throwable, Unit] =
    // ZIO.scoped creates a resource scope — any Scoped resources opened
    // inside (like the database pool) will be automatically closed
    // when this scope exits, even if we crash.
    ZIO.scoped {
      for
        // Step 1: Read database configuration from environment variables.
        // If any required variable is missing, this fails with a clear message
        // and the app exits rather than starting in a broken state.
        config     <- DatabaseConfig.fromEnv

        // Step 2: Create the database connection pool.
        // Opens poolSize connections to PostgreSQL and keeps them ready.
        // The pool stays open for the lifetime of the app (managed by Scope).
        transactor <- DatabaseConfig.makeTransactor(config)

        // Step 3: Log that we started successfully.
        // ZIO.logInfo is ZIO's structured logging — better than println
        // because it includes timestamps and log levels automatically.
        _          <- ZIO.logInfo("Database connection pool ready")

        // Step 4: Define our HTTP routes.
        // For now just a health check endpoint so Railway knows we're running.
        // We will add real routes as we build each feature.
        routes = Routes(
                   // Health check: GET /health
                   // Railway and load balancers ping this to verify the app is alive.
                   // Returns 200 OK with a simple message.
                   Method.GET / "health" -> Handler.ok
                 )

        // Step 5: Start the HTTP server.
        // Server.serve never returns — it keeps running, handling requests.
        // The port comes from the PORT environment variable which Railway
        // sets automatically. We default to 8080 for local development.
        port       <- System.env("PORT").map(_.flatMap(_.toIntOption).getOrElse(8080))
        _          <- ZIO.logInfo(s"Starting PokéTracker API on port $port")
        _          <- Server.serve(routes).provide(
                        Server.defaultWithPort(port)
                      )
      yield ()
    }
