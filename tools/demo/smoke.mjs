// Smoke: do the two Expo Web builds actually RENDER in a browser?
// Bundling clean is not the same as running clean — this catches runtime failures
// (missing native modules, null hooks dispatcher, blank #root) that Metro never sees.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.OUT_DIR ?? 'tools/demo/out';
mkdirSync(OUT, { recursive: true });

const targets = [
  ['principal', process.env.PRINCIPAL_URL ?? 'http://localhost:19006'],
  ['agent', process.env.AGENT_URL ?? 'http://localhost:19007'],
];

const browser = await chromium.launch();
let failed = 0;

for (const [name, url] of targets) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14 logical size
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  console.log(`\n── ${name} → ${url}`);
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 180_000 });
    // Expo web mounts an empty #root immediately, so waiting on childElementCount races
    // React's first paint. Wait for actual rendered text instead.
    await page.waitForFunction(
      () => (document.querySelector('#root')?.textContent ?? '').trim().length > 0,
      { timeout: 120_000 },
    );
    // react-native-web lays text out in nested spans that `innerText` reports as empty;
    // textContent is the reliable read here.
    const text = (await page.locator('#root').textContent())?.trim() ?? '';
    await page.screenshot({ path: `${OUT}/smoke-${name}.png`, fullPage: false });
    if (text.length === 0) {
      console.log(`  ✗ rendered but #root has no text`);
      failed++;
    } else {
      console.log(`  ✓ rendered — first text: ${JSON.stringify(text.slice(0, 120))}`);
    }
  } catch (e) {
    console.log(`  ✗ FAILED: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `${OUT}/smoke-${name}-FAIL.png` }).catch(() => {});
    failed++;
  }

  if (errors.length) {
    console.log(`  console errors (${errors.length}):`);
    for (const e of errors.slice(0, 12)) console.log(`    • ${e.slice(0, 260)}`);
  } else {
    console.log('  no console errors');
  }
  await context.close();
}

await browser.close();
console.log(`\nscreenshots in ${OUT}/`);
process.exit(failed);
