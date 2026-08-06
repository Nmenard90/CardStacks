/**
 * DatabaseConfig — reads DB connection settings from the environment and
 * opens the HikariCP-backed connection pool the rest of the app uses.
 *
 * HOW IT WORKS
 *   fromEnv reads five env vars (failing with a specific message naming
 *   whichever one is missing, since a generic NPE here is unhelpful) and
 *   assembles a JDBC URL. makeTransactor turns that into a live, scoped
 *   `Transactor[Task]` that every repository runs SQL through.
 *
 * USED BY: Main.scala
 */

package com.poketracker.config

import com.zaxxer.hikari.HikariConfig
import doobie.hikari.HikariTransactor
import doobie.util.transactor.Transactor
import zio.*
import zio.interop.catz.*

object DatabaseConfig:

  /** @param password  Always sourced from the environment, never hardcoded. */
  final case class Config(
    url:      String,
    user:     String,
    password: String,
    poolSize: Int
  )

  /** Maps to Railway's Postgres plugin vars (see the error messages below for the exact mapping). */
  val fromEnv: ZIO[Any, Throwable, Config] =
    for
      host <- System.env("DATABASE_HOST").someOrFail(
                new IllegalArgumentException(
                  "DATABASE_HOST is not set. In Railway set: DATABASE_HOST = ${{Postgres.PGHOST}}"
                )
              )
      port <- System.env("DATABASE_PORT")
                .map(_.flatMap(_.toIntOption).getOrElse(5432))
      name <- System.env("DATABASE_NAME").someOrFail(
                new IllegalArgumentException(
                  "DATABASE_NAME is not set. In Railway set: DATABASE_NAME = ${{Postgres.PGDATABASE}}"
                )
              )
      user <- System.env("DATABASE_USER").someOrFail(
                new IllegalArgumentException(
                  "DATABASE_USER is not set. In Railway set: DATABASE_USER = ${{Postgres.PGUSER}}"
                )
              )
      password <- System.env("DATABASE_PASSWORD").someOrFail(
                    new IllegalArgumentException(
                      "DATABASE_PASSWORD is not set. In Railway set: DATABASE_PASSWORD = ${{Postgres.PGPASSWORD}}"
                    )
                  )
      url       = s"jdbc:postgresql://$host:$port/$name"
      poolSize <- System.env("DB_POOL_SIZE")
                    .map(_.flatMap(_.toIntOption).getOrElse(10))
    yield Config(url, user, password, poolSize)

  /** Pool closes automatically (even on crash) since it's provisioned into a `Scope`. */
  def makeTransactor(config: Config): ZIO[Scope, Throwable, Transactor[Task]] =
    ZIO.attempt {
      val hikariConfig = new HikariConfig()
      hikariConfig.setDriverClassName("org.postgresql.Driver")
      hikariConfig.setJdbcUrl(config.url)
      hikariConfig.setUsername(config.user)
      hikariConfig.setPassword(config.password)
      hikariConfig.setMaximumPoolSize(config.poolSize)

      // Keeps a couple of connections warm so the first request after an
      // idle period isn't stuck paying full connection-open latency.
      hikariConfig.setMinimumIdle(2)
      hikariConfig.setConnectionTimeout(30000)
      hikariConfig
    }.flatMap { hikariConfig =>
      HikariTransactor
        .fromHikariConfig[Task](hikariConfig)
        .toScopedZIO
    }
