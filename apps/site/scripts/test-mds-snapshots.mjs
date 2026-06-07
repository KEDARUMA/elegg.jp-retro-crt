import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pixelmatch from 'pixelmatch';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const SNAPSHOT_DIR = path.join(ROOT, 'apps/site/tests/snapshots');
const BASE_URL = 'http://127.0.0.1:5173';
const VIEWPORT = { width: 1280, height: 720 };
const MAX_DIFF_PIXELS = 0;

const CASES = [
  {
    name: 'formatting',
    mds: '/var/www/mds/test/text/formatting.mds',
    snapshot: 'mds-formatting.png',
  },
  {
    name: 'link',
    mds: '/var/www/mds/test/link/link.mds',
    snapshot: 'mds-link.png',
  },
  {
    name: 'image',
    mds: '/var/www/mds/test/image/image.mds',
    snapshot: 'mds-image.png',
  },
  {
    name: 'form',
    mds: '/var/www/mds/test/form/form.mds',
    snapshot: 'mds-form.png',
  },
];

let serverProcess = null;

async function main() {
  const serverStarted = await ensureServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: VIEWPORT });
  const results = [];

  try {
    for (const testCase of CASES) {
      results.push(await runCase(page, testCase));
    }
  } finally {
    await browser.close();
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
  }

  printResults(results, serverStarted);
  if (results.some((result) => result.status === 'fail')) {
    process.exitCode = 1;
  }
}

async function ensureServer() {
  if (await isServerReady()) {
    return false;
  }

  serverProcess = spawn('pnpm', ['--filter', '@elegg/site', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  serverProcess.stdout.on('data', (chunk) => {
    log += chunk.toString();
  });
  serverProcess.stderr.on('data', (chunk) => {
    log += chunk.toString();
  });

  for (let i = 0; i < 50; i += 1) {
    if (await isServerReady()) {
      return true;
    }
    if (serverProcess.exitCode !== null) {
      throw new Error(`dev server exited before ready:\n${log.trim()}`);
    }
    await sleep(200);
  }

  throw new Error(`dev server did not become ready:\n${log.trim()}`);
}

async function isServerReady() {
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function runCase(page, testCase) {
  const snapshotPath = path.join(SNAPSHOT_DIR, testCase.snapshot);
  if (!(await exists(snapshotPath))) {
    return { name: testCase.name, status: 'skip', reason: `missing ${testCase.snapshot}` };
  }

  const url = `${BASE_URL}/?mds=${encodeURIComponent(testCase.mds)}&test=1`;
  await page.goto(url);
  await page.mouse.move(1, 1);
  await page.waitForTimeout(1200);
  const actualBuffer = await page.screenshot({ fullPage: false });
  const expectedBuffer = await fs.readFile(snapshotPath);
  const actual = PNG.sync.read(actualBuffer);
  const expected = PNG.sync.read(expectedBuffer);

  if (actual.width !== expected.width || actual.height !== expected.height) {
    const actualPath = path.join(SNAPSHOT_DIR, `${path.basename(testCase.snapshot, '.png')}.actual.png`);
    await fs.writeFile(actualPath, actualBuffer);
    return {
      name: testCase.name,
      status: 'fail',
      reason: `size mismatch actual=${actual.width}x${actual.height} expected=${expected.width}x${expected.height}; actual=${actualPath}`,
    };
  }

  const diff = new PNG({ width: expected.width, height: expected.height });
  const diffPixels = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, { threshold: 0 });
  if (diffPixels > MAX_DIFF_PIXELS) {
    const actualPath = path.join(SNAPSHOT_DIR, `${path.basename(testCase.snapshot, '.png')}.actual.png`);
    const diffPath = path.join(SNAPSHOT_DIR, `${path.basename(testCase.snapshot, '.png')}.diff.png`);
    await fs.writeFile(actualPath, actualBuffer);
    await fs.writeFile(diffPath, PNG.sync.write(diff));
    return { name: testCase.name, status: 'fail', reason: `${diffPixels} pixels differ; actual=${actualPath}; diff=${diffPath}` };
  }

  await removeIfExists(path.join(SNAPSHOT_DIR, `${path.basename(testCase.snapshot, '.png')}.actual.png`));
  await removeIfExists(path.join(SNAPSHOT_DIR, `${path.basename(testCase.snapshot, '.png')}.diff.png`));
  return { name: testCase.name, status: 'pass' };
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function removeIfExists(filePath) {
  try {
    await fs.rm(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function printResults(results, serverStarted) {
  console.log(`MDS snapshot tests (${VIEWPORT.width}x${VIEWPORT.height}, server ${serverStarted ? 'started' : 'reused'})`);
  for (const result of results) {
    const label = result.status.toUpperCase().padEnd(4, ' ');
    console.log(`${label} ${result.name}${result.reason ? ` - ${result.reason}` : ''}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
  console.error(error);
  process.exit(1);
});
