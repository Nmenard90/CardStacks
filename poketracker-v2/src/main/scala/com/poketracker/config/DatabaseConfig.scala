/**
 * FILE: DatabaseConfig.scala
 * PACKAGE: com.poketracker.config
 * LOCATION: src/main/scala/com/poketracker/config/DatabaseConfig.scala
 *
 * PURPOSE:
 *   Reads database connection settings from environment variables and creates
 *   a HikariCP connection pool that the rest of the application uses to
 *   talk to PostgreSQL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTS EXPLAINED:
 *
 *   com.zaxxer.hikari.HikariConfig
 *     HikariConfig is the configuration object for HikariCP — the connection
 *     pool library. We set properties on it (URL, username, password, pool size)
 *     and then hand it to HikariTransactor to create the actual pool.
 *     Think of it like filling out a form before submitting it.
 *
 *   doobie.hikari.HikariTransactor
 *     HikariTransactor is Doobie's wrapper around HikariCP. It combines
 *     the connection pool with Doobie's ability to run SQL queries.
 *     This is the object every repository will use to talk to the database.
 *
 *   doobie.util.transactor.Transactor
 *     The base type that HikariTransactor extends. Our repositories accept
 *     a Transactor — using the base type instead of HikariTransactor directly
 *     means we could swap in a different implementation (e.g. for testing)
 *     without changing any repository code.
 *
 *   zio.*
 *     Imports everything from ZIO core:
 *       ZIO[R,E,A]  — the effect type (needs R, can fail with E, produces A)
 *       Task[A]     — shorthand for ZIO[Any, Throwable, A]
 *       Scope       — ZIO's resource lifecycle manager
 *       System      — ZIO's safe wrapper around environment variables
 *
 *   zio.interop.catz.*
 *     Doobie is built on Cats Effect, ZIO is a separate library.
 *     This import provides the "bridge" that lets them work together.
 *     Specifically it provides typeclass instances that teach Doobie
 *     how to use ZIO's Task as its effect type.
 *     Without this import, HikariTransactor[Task] would not compile.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * USED BY: Main.scala
 * DEPENDS ON: zio, zio-interop-cats, doobie-hikari, HikariCP (via doobie-hikari)
 */

package com.poketracker.config

import com.zaxxer.hikari.HikariConfig
import doobie.hikari.HikariTransactor
import doobie.util.transactor.Transactor
import zio.*
import zio.interop.catz.*

/**
 * OBJECT: DatabaseConfig
 *
 * PURPOSE:
 *   A singleton object (exactly one instance, ever) that contains everything
 *   needed to read database settings and create a connection pool.
 *
 * WHY AN OBJECT AND NOT A CLASS?
 *   A class can have many instances — you create one with "new MyClass()".
 *   An object has exactly one instance, created automatically by Scala.
 *   DatabaseConfig holds no state that varies between uses, so having
 *   multiple instances would be wasteful and confusing. One is enough.
 */
object DatabaseConfig:

  /**
   * CASE CLASS: Config
   *
   * PURPOSE:
   *   Groups the four pieces of information needed to connect to PostgreSQL.
   *
   * WHY A CASE CLASS?
   *   A case class is a Scala class designed purely for holding data.
   *   It is immutable — once created, its values cannot change.
   *   Immutability is important for safety in a concurrent application:
   *   multiple requests can read the same Config simultaneously without
   *   any risk of one modifying it while another is reading it.
   *
   * @param url
   *   The JDBC connection URL — tells the driver where to find the database.
   *   Format: jdbc:postgresql://hostname:port/database_name
   *   Example: jdbc:postgresql://localhost:5432/poketracker
   *   On Railway this is provided automatically as the DATABASE_URL variable.
   *
   * @param user
   *   The PostgreSQL username to log in with.
   *   Example: "postgres" for a local database, or a specific user on Railway.
   *
   * @param password
   *   The password for the above user.
   *   NEVER hardcoded in source code — always read from an environment variable.
   *
   * @param poolSize
   *   How many database connections to keep open simultaneously.
   *   10 means 10 queries can run at the exact same time without waiting.
   *   More is not always better — each connection uses ~5-10MB of RAM on
   *   the database server. 10 is a good default for most applications.
   */
  final case class Config(
    url:      String,
    user:     String,
    password: String,
    poolSize: Int
  )

  /**
   * FUNCTION: fromEnv
   *
   * PURPOSE:
   *   Reads the four connection settings from environment variables.
   *
   * WHY ENVIRONMENT VARIABLES?
   *   Passwords and connection strings must never be written in source code
   *   because source code is committed to GitHub which can be public.
   *   Environment variables are set separately:
   *     - On Railway: in the Variables section of your service dashboard
   *     - Locally: in a .env file that is listed in .gitignore
   *
   * WHY DOES THIS RETURN ZIO[Any, Throwable, Config] INSTEAD OF JUST Config?
   *   Reading an environment variable can fail — the variable might not be set.
   *   If we returned just Config and a variable was missing, the application
   *   would crash with a NullPointerException somewhere unexpected.
   *   By returning a ZIO effect, we force the caller to handle the failure.
   *   The compiler will not let you ignore it.
   *
   *   ZIO[Any, Throwable, Config] means:
   *     Any       = this effect needs nothing special to run
   *     Throwable = it can fail with any exception (specifically IllegalArgumentException
   *                 if a required variable is missing)
   *     Config    = if it succeeds, it produces a Config object
   *
   * REQUIRED ENVIRONMENT VARIABLES:
   *   DATABASE_URL      — JDBC connection URL
   *   DATABASE_USER     — PostgreSQL username
   *   DATABASE_PASSWORD — PostgreSQL password
   *
   * OPTIONAL ENVIRONMENT VARIABLES:
   *   DB_POOL_SIZE — Number of connections in pool. Defaults to 10 if not set.
   *
   * @return ZIO[Any, Throwable, Config]
   */
  val fromEnv: ZIO[Any, Throwable, Config] =
    for
      /**
       * System.env("NAME") is ZIO's safe way to read an environment variable.
       * It returns ZIO[Any, Nothing, Option[String]]:
       *   Option[String] = Some("value") if the variable is set, None if missing.
       *   Nothing        = this effect itself cannot fail (reading env vars is safe)
       *
       * .someOrFail(error) converts the Option into a ZIO that:
       *   - Succeeds with the String value if it was Some("value")
       *   - Fails with the given error if it was None
       *
       * This gives us a clear, specific error message if a variable is missing,
       * instead of a confusing NullPointerException later.
       */
      rawUrl <- System.env("DATABASE_URL").someOrFail(
                  new IllegalArgumentException(
                    "DATABASE_URL environment variable is not set.\n" +
                    "On Railway: add a PostgreSQL database to your project — Railway sets this automatically.\n" +
                    "Locally: add DATABASE_URL=jdbc:postgresql://localhost:5432/poketracker to your .env file."
                  )
                )
      // Railway provides the URL as postgresql:// but JDBC requires jdbc:postgresql://
      // We add the prefix if it is missing so both formats work.
      url = if rawUrl.startsWith("jdbc:") then rawUrl
            else "jdbc:" + rawUrl

      user <- System.env("DATABASE_USER").someOrFail(
                new IllegalArgumentException(
                  "DATABASE_USER environment variable is not set.\n" +
                  "Set it to your PostgreSQL username, e.g. DATABASE_USER=postgres"
                )
              )

      password <- System.env("DATABASE_PASSWORD").someOrFail(
                    new IllegalArgumentException(
                      "DATABASE_PASSWORD environment variable is not set.\n" +
                      "Set it to your PostgreSQL password."
                    )
                  )

      /**
       * DB_POOL_SIZE is optional so we use getOrElse instead of someOrFail.
       * System.env returns Option[String].
       * .map reads the Option if it exists and tries to convert it to an Int.
       * .flatMap(_.toIntOption) safely parses the string — if it's not a valid
       *   integer (e.g. someone set DB_POOL_SIZE=abc) we just use the default.
       * .getOrElse(10) uses 10 if the variable was not set or was not a valid Int.
       */
      poolSize <- System.env("DB_POOL_SIZE")
                    .map(_.flatMap(_.toIntOption).getOrElse(10))

    yield Config(url, user, password, poolSize)

  /**
   * FUNCTION: makeTransactor
   *
   * PURPOSE:
   *   Creates a HikariCP connection pool wrapped in a Doobie Transactor.
   *   This is the object every repository will use to run SQL queries.
   *
   * HOW IT WORKS:
   *   1. We create a HikariConfig object and set all our connection properties on it
   *   2. We pass that to HikariTransactor.fromHikariConfig which creates the pool
   *   3. The pool is wrapped as a ZIO Scoped resource — it opens at app startup
   *      and is guaranteed to close cleanly when the app stops
   *
   * WHAT IS ZIO SCOPE?
   *   Some resources must be explicitly opened and closed:
   *     - Files (open → read/write → close)
   *     - Database connection pools (start → use → shutdown)
   *   ZIO's Scope system guarantees the "close" step always runs, even if
   *   the application crashes. This prevents resource leaks.
   *   The return type ZIO[Scope, Throwable, Transactor[Task]] means:
   *     Scope     = this effect needs a Scope to manage its lifecycle
   *     Throwable = it can fail if the database is unreachable
   *     Transactor[Task] = on success it produces a ready-to-use Transactor
   *
   * @param config
   *   The connection details produced by DatabaseConfig.fromEnv
   *
   * @return ZIO[Scope, Throwable, Transactor[Task]]
   */
  def makeTransactor(config: Config): ZIO[Scope, Throwable, Transactor[Task]] =
    /**
     * HikariConfig is a plain Java object we configure by calling setter methods.
     * This is a common Java pattern — create object, set properties, use it.
     * We wrap it in ZIO.attempt because the setters could theoretically throw.
     */
    ZIO.attempt {
      val hikariConfig = new HikariConfig()

      // The fully qualified class name of the PostgreSQL JDBC driver.
      // This string never changes — it is the same for every PostgreSQL connection.
      hikariConfig.setDriverClassName("org.postgresql.Driver")

      // Where the database lives.
      hikariConfig.setJdbcUrl(config.url)

      // Who we are connecting as.
      hikariConfig.setUsername(config.user)

      // Proof of identity.
      hikariConfig.setPassword(config.password)

      // Maximum connections in the pool.
      hikariConfig.setMaximumPoolSize(config.poolSize)

      // Minimum idle connections to keep open even when traffic is low.
      // Keeping a few connections warm means the first requests after
      // a quiet period don't pay the cost of opening new connections.
      hikariConfig.setMinimumIdle(2)

      // How long (milliseconds) a request can wait for a connection
      // before giving up and failing. 30 seconds is a generous timeout.
      hikariConfig.setConnectionTimeout(30000)

      hikariConfig
    }.flatMap { hikariConfig =>
      /**
       * HikariTransactor.fromHikariConfig creates the actual connection pool
       * from our configuration object.
       *
       * It returns a Cats Effect Resource — a managed resource that opens
       * on start and closes on stop.
       *
       * .toScopedZIO converts the Cats Effect Resource into a ZIO Scoped resource.
       * This is provided by the zio-interop-cats library.
       */
      HikariTransactor
        .fromHikariConfig[Task](hikariConfig)
        .toScopedZIO
    }