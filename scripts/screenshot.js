const { spawn } = require('node:child_process');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'stock-pulse.png');
const port = process.env.PORT || '4173';
const address = `http://127.0.0.1:${port}`;

async function waitForServer(url, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The local server may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`서버가 준비되지 않았습니다: ${url}`);
}

async function main() {
  await mkdir(path.dirname(output), { recursive: true });
  const server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: port },
    stdio: 'inherit'
  });

  try {
    await waitForServer(address);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    await page.goto(address, { waitUntil: 'networkidle' });
    await page.screenshot({ path: output, fullPage: true });
    await browser.close();
    console.log(`Screenshot saved: ${path.relative(root, output)}`);
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
