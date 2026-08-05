/**
 * FILE: build.sbt
 * LOCATION: poketracker-v2/build.sbt
 *
 * PURPOSE:
 *   Build configuration for PokéTracker backend.
 *   SBT reads this file to know what Scala version to use, what external
 *   libraries to download, and how to compile and run the project.
 *
 * HOW TO READ DEPENDENCY LINES:
 *   "organization" %% "library-name" % "version"
 *   %%  = download the version compiled for our Scala version (Scala 3)
 *   %   = Java library, works with any JVM language, no Scala version needed
 *   % Test    = only included when running tests, not in production build
 *   % Runtime = only needed at runtime, not at compile time
 */

// The version of Scala we write our code in.
// Scala 3.8.4 is the latest stable release as of 2026.
val scala3Version = "3.8.4"

// ── Pinned dependency versions ──────────────────────────────────────────────
// Defined here so we change a version in one place and it applies everywhere.

// ZIO 2: our core effects library. Handles concurrency, error management,
// resource lifecycle, and structured asynchrony.
val zioVersion = "2.1.14"

// ZIO HTTP 3: our web server. Handles HTTP routes, requests, responses.
// Built on ZIO so all request handling is non-blocking.
val zioHttpVersion = "3.0.1"

// ZIO JSON: converts between Scala objects and JSON text automatically.
// Type-safe — missing fields are caught at the point of parsing, not later.
val zioJsonVersion = "0.7.3"

// ZIO Interop Cats: the bridge between ZIO and Cats Effect.
// Doobie is built on Cats Effect. This library teaches Doobie to use
// ZIO's Task as its effect type so they can work together.
val zioInteropCatsVersion = "23.1.0.3"

// Doobie: functional SQL library. Write SQL queries that map directly to
// Scala case classes. Queries return ZIO effects — errors are typed and explicit.
val doobieVersion = "1.0.0-RC6"

// PostgreSQL JDBC driver: the low-level network protocol implementation.
// Doobie uses this to physically connect to and query PostgreSQL.
// We never reference its classes directly — Doobie handles it.
val postgresVersion = "42.7.4"

// ── Project definition ───────────────────────────────────────────────────────
// "lazy val" means SBT only evaluates this when needed — standard practice.
// "project.in(file("."))" means our project lives in the current directory.
lazy val root = project
  .in(file("."))
  .settings(
    name         := "poketracker",
    version      := "0.1.0-SNAPSHOT",
    scalaVersion := scala3Version,

    // Raised from the compiler default (32): zio-json's DeriveJsonDecoder/
    // DeriveJsonEncoder macros recurse one inline expansion per case class
    // field, and ApiCard (every field pokemontcg.io's card API returns) has
    // 28 — comfortably past the default limit.
    scalacOptions += "-Xmax-inlines:128",

    // ── Libraries ────────────────────────────────────────────────────────────
    // ++= appends all items in the Seq to the existing dependency list.
    libraryDependencies ++= Seq(

      // ZIO core — the foundation.
      // Provides ZIO[R,E,A], Task[A], ZLayer, Scope, System, and all other
      // ZIO primitives. Every other ZIO library builds on top of this.
      "dev.zio" %% "zio" % zioVersion,

      // ZIO HTTP — our web server.
      // We define routes, ZIO HTTP matches incoming requests to them.
      // All I/O is non-blocking: while one request waits for the database,
      // other requests are handled concurrently on the same thread pool.
      "dev.zio" %% "zio-http" % zioHttpVersion,

      // ZIO JSON — JSON serialization and deserialization.
      // Annotate a case class once, get free conversion to/from JSON.
      // If incoming JSON is missing a field our code expects, we get
      // a clear error immediately rather than a null pointer later.
      "dev.zio" %% "zio-json" % zioJsonVersion,

      // ZIO Interop Cats — bridge between ZIO and Cats Effect ecosystem.
      // Doobie and HikariTransactor are built on Cats Effect (a different
      // functional effects library). This bridge provides typeclass instances
      // that let Doobie run ZIO's Task type as if it were Cats IO.
      // Without this, "HikariTransactor[Task]" would not compile.
      "dev.zio" %% "zio-interop-cats" % zioInteropCatsVersion,

      // Doobie core — SQL queries as Scala values.
      // sql"SELECT * FROM cards WHERE id = $id".query[Card].to[List]
      // The $id is automatically escaped (no SQL injection possible).
      // The .query[Card] tells Doobie how to map result rows to Card objects.
      "org.tpolecat" %% "doobie-core" % doobieVersion,

      // Doobie HikariCP — connection pool integration.
      // Maintains a fixed number of database connections ready to use.
      // Each incoming request borrows a connection, uses it, returns it.
      // Without pooling, every query would pay the ~100ms connection cost.
      "org.tpolecat" %% "doobie-hikari" % doobieVersion,

      // Doobie PostgreSQL — PostgreSQL-specific type mappings.
      // Provides support for PostgreSQL-specific column types like UUID,
      // JSON/JSONB, arrays, and enums that are not in standard JDBC.
      "org.tpolecat" %% "doobie-postgres" % doobieVersion,

      // PostgreSQL JDBC driver — the actual network protocol implementation.
      // Doobie needs this to physically connect to PostgreSQL over TCP.
      // "Runtime" means we need it when running but not when compiling —
      // we never reference its classes directly in our own code.
      "org.postgresql" % "postgresql" % postgresVersion % Runtime,

      // MUnit — unit testing framework.
      // We write tests in src/test/scala/ that verify our business logic.
      // "Test" means it is only included when running tests, never in production.
      "org.scalameta" %% "munit" % "1.3.2" % Test
    ),

    // ── Assembly (fat JAR) settings ──────────────────────────────────────────
    // These settings configure how sbt-assembly builds the fat JAR.

    // The name of the output JAR file.
    // Dockerfile copies this file to app.jar for deployment.
    assembly / assemblyJarName := "poketracker-assembly.jar",

    // What to do when multiple dependencies contain a file with the same path.
    // This is common with library licenses and service files.
    // "first" means keep the first one found and discard duplicates.
    assembly / assemblyMergeStrategy := {
      case PathList("META-INF", "MANIFEST.MF") => MergeStrategy.discard
      case PathList("META-INF", xs @ _*)       => MergeStrategy.first
      case PathList("reference.conf")          => MergeStrategy.concat
      case _                                   => MergeStrategy.first
    }
  )
