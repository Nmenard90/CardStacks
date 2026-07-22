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

const hadGeneratedDeclaration = existsSync(generatedDeclaration);

if (existsSync(backupDeclaration)) {
  throw new Error(`Refusing to overwrite an existing regression-check backup: ${backupDeclaration}`);
}

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
