/**
 * File: scripts/prepush-check.js
 * Purpose:
 *   Runs the documentation checklist that must happen before every push.
 *
 * Why this file exists:
 *   The project owner wants README.md, HANDOFF.md, and BUGS.md reviewed every
 *   time code is pushed so a future chat or developer can pick up the work.
 */

import { execSync } from "node:child_process";

const REQUIRED_DOCS = ["README.md", "HANDOFF.md", "BUGS.md"];

/**
 * Reads git changes so we can warn when required docs were not touched.
 *
 * Performance:
 *   This reads only file names from Git and does not inspect file contents.
 */
function readChangedFiles() {
  try {
    const output = execSync("git diff --name-only HEAD", { encoding: "utf8" });
    return new Set(output.split("\n").map((line) => line.trim()).filter(Boolean));
  } catch (error) {
    console.warn("Could not read git diff. Run the checklist manually.");
    return new Set();
  }
}

/**
 * Prints a clear checklist for the developer before pushing.
 *
 * Why this function exists:
 *   We do not want to block emergency pushes with a fragile script, but we do
 *   want the required documentation process to be impossible to miss.
 */
function printChecklist() {
  const changedFiles = readChangedFiles();
  const missingDocs = REQUIRED_DOCS.filter((doc) => !changedFiles.has(doc));

  console.log("\nTCG V3 pre-push checklist:");
  console.log("1. Run pnpm lint");
  console.log("2. Run pnpm typecheck");
  console.log("3. Run pnpm test");
  console.log("4. Update README.md if setup, commands, or behavior changed");
  console.log("5. Update HANDOFF.md with current state and next steps");
  console.log("6. Update BUGS.md with open/fixed/suspected issues\n");

  if (missingDocs.length > 0) {
    console.warn(`Docs not changed in current diff: ${missingDocs.join(", ")}`);
    console.warn("Review them before pushing.\n");
  }
}

printChecklist();
