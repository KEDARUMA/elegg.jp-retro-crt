import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve('public/root');
const manifestPath = path.resolve('public/root-manifest.json');
const ignoredNames = new Set(['.DS_Store']);

const dirs = [];
const files = [];

async function walk(relativeDir = '') {
  const absoluteDir = path.join(rootDir, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });

  if (relativeDir) {
    dirs.push(`/${relativeDir}`);
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignoredNames.has(entry.name)) {
      continue;
    }

    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      await walk(relativePath);
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
}

await walk();

const manifest = {
  dirs,
  files,
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`updated ${path.relative(process.cwd(), manifestPath)}`);
console.log(`dirs: ${dirs.length}`);
console.log(`files: ${files.length}`);
