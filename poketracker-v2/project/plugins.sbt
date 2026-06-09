// FILE: plugins.sbt
// LOCATION: poketracker-v2/project/plugins.sbt
//
// PURPOSE:
//   Adds SBT plugins to the build.
//   Plugins extend SBT with extra commands and functionality.
//
// SBT ASSEMBLY PLUGIN:
//   Adds the "sbt assembly" command which bundles our compiled code
//   and all its dependencies into a single fat JAR file.
//   This is what the Dockerfile uses to create the deployable artifact.
//   Without this, we would need to manage classpath dependencies manually
//   when running the JAR — assembly makes deployment simple.

addSbtPlugin("com.eed3si9n" % "sbt-assembly" % "2.1.5")
