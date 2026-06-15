#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const allowedBumps = new Set(["patch", "minor", "major"]);
const bumpType = process.argv[2] ?? "patch";

if (!allowedBumps.has(bumpType)) {
  console.error('Usage: node scripts/bump-aa-maker-version.mjs <patch|minor|major>');
  process.exit(1);
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(rootDir, "apps/aa-maker/package.json");
const appMetaPath = path.join(rootDir, "apps/aa-maker/src/appMeta.ts");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const currentVersion = typeof packageJson.version === "string" ? packageJson.version : "";
const semverMatch = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);

if (!semverMatch) {
  throw new Error(`apps/aa-maker/package.json の version が semver ではありません: ${currentVersion}`);
}

const appMetaSource = await readFile(appMetaPath, "utf8");
const appMetaMatch = appMetaSource.match(/export const AA_MAKER_VERSION = "([^"]+)";/);

if (!appMetaMatch) {
  throw new Error("apps/aa-maker/src/appMeta.ts から AA_MAKER_VERSION を取得できませんでした");
}

if (appMetaMatch[1] !== currentVersion) {
  throw new Error(`version 不一致です package.json=${currentVersion} appMeta=${appMetaMatch[1]}`);
}

const [major, minor, patch] = semverMatch.slice(1).map(Number);
const nextVersion = (() => {
  switch (bumpType) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
})();

packageJson.version = nextVersion;
await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
await writeFile(appMetaPath, appMetaSource.replace(appMetaMatch[0], `export const AA_MAKER_VERSION = "${nextVersion}";`));

process.stdout.write(`${nextVersion}\n`);
