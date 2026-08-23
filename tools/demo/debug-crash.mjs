// Reproduce the "Maximum update depth exceeded" crash: sign up, create a household,
// then reload the app with a live session and capture the React error + component stack.
import { chromium } from 'playwright';

const tag = String(Date.now()).slice(-7);
const PHONE = `+2348${tag}77`;
const NIN = String(22222222222n + BigInt(tag)).slice(-11);
const BVN = String(33333333333n + BigInt(tag)).slice(-11);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.goto('http://localhost:19006', { waitUntil: 'load', timeout: 180_000 });
await page.waitForFunction(
  () => (document.querySelector('#root')?.textContent ?? '').trim().length > 0,
  { timeout: 120_000 },
);

await page.getByLabel('MOBILE NUMBER').fill(PHONE);
await page.getByRole('button', { name: /SEND CODE/i }).click();
await page.getByLabel('6-DIGIT CODE').waitFor({ timeout: 30_000 });
await page.getByLabel('6-DIGIT CODE').fill('123456');
await page.getByLabel('NIN').fill(NIN);
await page.getByLabel('BVN').fill(BVN);
await page.getByRole('button', { name: /^VERIFY/i }).first().click();

await page.getByLabel('HOUSEHOLD NAME').waitFor({ timeout: 40_000 });
await page.getByLabel('HOUSEHOLD NAME').fill('Adebayo Family');
await page.getByRole('button', { name: /CREATE HOUSEHOLD/i }).click();
await page.waitForTimeout(7000);
console.log(`after household: ${(await page.locator('#root').textContent())?.slice(0, 160)}`);

// Go to the Pairing screen and issue a code first — this is the state the recorder was in
// when the app crashed with "Maximum update depth exceeded".
await page.getByRole('button', { name: /Pair an agent/i }).click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: /GENERATE CODE/i }).click();
await page.waitForTimeout(4000);
console.log(`on pairing screen: ${(await page.locator('#root').textContent())?.slice(0, 120)}`);

errors.length = 0;
console.log('\n--- reloading with a live session ---');
await page.reload({ waitUntil: 'load', timeout: 120_000 });
await page.waitForTimeout(12000);

const text = (await page.locator('#root').textContent())?.slice(0, 300);
console.log(`after reload: ${text}`);
console.log(`\ncaptured ${errors.length} error(s):`);
for (const e of errors.slice(0, 4)) console.log(`\n${e.slice(0, 1400)}`);

await page.screenshot({ path: 'tools/demo/out/crash-after-reload.png' });
await browser.close();
