# FILE: Dockerfile
# LOCATION: poketracker-v2/Dockerfile
#
# PURPOSE:
#   Tells Railway how to build and run our Scala application.
#   Two-stage build:
#     Stage 1 (builder): compiles Scala into a fat JAR using SBT
#     Stage 2 (runtime): runs the JAR in a minimal secure Alpine image
#
# WHY TWO STAGES?
#   Build stage needs SBT + Scala + all build tools (~577MB).
#   Runtime stage only needs Java to run the compiled JAR (~100MB with Alpine).
#   Two stages = smaller deployed image, faster startup, more secure.

# ── Stage 1: Build ────────────────────────────────────────────────────────────
# Official sbtscala image — Alpine-based, updated daily, Java 21 + SBT 1.12.8
# Tag format: <base>-<java>_<sbt>_<scala>
FROM sbtscala/scala-sbt:eclipse-temurin-alpine-21.0.8_9_1.12.11_3.3.7 AS builder
WORKDIR /app

# Copy dependency files first so Docker caches the download step.
# Only re-runs when build.sbt or project/ changes.
COPY build.sbt .
COPY project/ project/

# Download all dependencies listed in build.sbt.
RUN sbt update

# Copy source and compile into a single fat JAR.
COPY src/ src/
RUN sbt assembly

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# Minimal Alpine JRE — small and secure, no build tools.
FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

# Copy only the compiled JAR — no source, no SBT, no build tools.
COPY --from=builder /app/target/scala-3.*/poketracker-assembly.jar app.jar

EXPOSE 8080

# Start the server.
# -Xmx512m = max heap 512MB (suits Railway hobby plan)
# -Xms128m = initial heap 128MB, grows as needed
CMD ["java", "-Xmx512m", "-Xms128m", "-jar", "app.jar"]