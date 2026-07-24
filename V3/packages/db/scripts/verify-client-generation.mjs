import { spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const prismaPackageDirectory = dirname(require.resolve("@prisma/client/package.json"));
const generatedDeclaration = join(
  dirname(dirname(prismaPackageDirectory)),
  ".prisma",
  "client",
  "default.d.ts"
);
const backupDeclaration = `${generatedDeclaration}.generation-check`;
const packageManagerEntryPoint = process.env.npm_execpath;

if (!packageManagerEntryPoint) {
  throw new Error("Run this regression check through pnpm so it can invoke the normal lint command.");
}

if (existsSync(backupDeclaration)) {
  // A prior run was interrupted (e.g. an aborted merge) before it could restore this
  // backup. Self-heal instead of refusing: recover the real declaration if it's missing,
  // or drop the stale backup if the declaration is already back in place.
  if (existsSync(generatedDeclaration)) {
    rmSync(backupDeclaration);
  } else {
    renameSync(backupDeclaration, generatedDeclaration);
  }
}

const hadGeneratedDeclaration = existsSync(generatedDeclaration);

if (hadGeneratedDeclaration) {
  renameSync(generatedDeclaration, backupDeclaration);
}

try {
  const lint = spawnSync(
    process.execPath,
    [packageManagerEntryPoint, "--filter", "@tcg/db", "lint"],
    { stdio: "inherit" }
  );

  if (lint.error) {
    throw lint.error;
  }

  if (lint.status !== 0) {
    throw new Error(`Database lint failed with exit code ${lint.status ?? "unknown"}.`);
  }

  if (!existsSync(generatedDeclaration)) {
    throw new Error("Database lint passed without restoring the invalidated Prisma Client declaration.");
  }
} finally {
  if (existsSync(backupDeclaration)) {
    if (existsSync(generatedDeclaration)) {
      rmSync(backupDeclaration);
    } else {
      renameSync(backupDeclaration, generatedDeclaration);
    }
  }
}
