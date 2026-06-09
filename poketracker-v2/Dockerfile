# FILE: Dockerfile
# LOCATION: poketracker-v2/Dockerfile
#
# PURPOSE:
#   Tells Railway how to build and run our Scala application.
#   Uses a two-stage build:
#     Stage 1 (builder): compiles Scala code into a fat JAR using SBT
#     Stage 2 (runtime): runs the JAR in a minimal, secure Alpine image
#
# WHY TWO STAGES?
#   Build stage needs SBT, Scala, build tools — about 500MB.
#   Runtime stage only needs Java to run the JAR — about 100MB with Alpine.
#   Two stages means our deployed image is small, fast, and secure.
#
# WHY ALPINE FOR RUNTIME?
#   Alpine Linux is a minimal OS — it contains only what is absolutely needed.
#   Fewer packages = fewer vulnerabilities = more secure.
#   The jammy (Ubuntu) base is only used for building, never deployed.

# ── Stage 1: Build ────────────────────────────────────────────────────────────
# Latest SBT image with Java 21, Scala 3.3.7 LTS, and SBT 1.10.7
FROM sbtscala/scala-sbt:eclipse-temurin-jammy-21.0.11_10_1.10.7_3.3.7 AS builder

WORKDIR /app

# Copy dependency files first so Docker can cache the dependency download step.
# If build.sbt and project/ have not changed, Docker skips re-downloading
# all dependencies on the next build — saves several minutes.
COPY build.sbt .
COPY project/ project/

# Download all dependencies listed in build.sbt.
# Cached after first run — only re-runs when build.sbt changes.
RUN sbt update

# Copy source code and compile.
COPY src/ src/

# Compile and package into a single fat JAR containing all dependencies.
# Output: target/scala-3.x.x/poketracker-assembly.jar
RUN sbt assembly

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# Alpine Linux with Java 21 JRE — minimal and secure.
# Only the JRE (Java Runtime Environment) is needed — not the full JDK.
# This image is ~100MB vs ~500MB for the build image.
FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

# Copy only the compiled JAR from the build stage.
# No source code, no SBT, no build tools are included in the final image.
COPY --from=builder /app/target/scala-3.*/poketracker-assembly.jar app.jar

# Port our HTTP server listens on.
# Railway sets the PORT environment variable and maps its external URL to this.
EXPOSE 8080

# Start the application.
# -Xmx512m  = maximum heap memory 512MB (suits Railway hobby plan)
# -Xms128m  = start with 128MB heap, grows as needed up to 512MB
CMD ["java", "-Xmx512m", "-Xms128m", "-jar", "app.jar"]