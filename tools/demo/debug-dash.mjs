// List every role=button on the principal dashboard with its accessible name and visibility,
// so the recorder's selectors target something actually clickable.
import { chromium } from 'playwright';

const tag = String(Date.now()).slice(-7);
const PHONE = `+2348${tag}88`;
const NIN = String(22222222222n + BigInt(tag)).slice(-11);
const BVN = String(33333333333n + BigInt(tag)).slice(-11);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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
await page.waitForTimeout(8000);

await page.getByRole('button', { name: 'Sub-wallets' }).click();
await page.waitForTimeout(5000);
console.log(`\nafter Sub-wallets click: ${(await page.locator('#root').textContent())?.slice(-260)}`);
await page.screenshot({ path: 'tools/demo/out/debug-subwallets.png' });

const info = await page.evaluate(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  return [...document.querySelectorAll('[role="button"]')].map((b) => ({
    name: b.getAttribute('aria-label') ?? (b.textContent ?? '').trim().slice(0, 40),
    visible: vis(b),
    ariaHidden: b.closest('[aria-hidden="true"]') !== null,
  }));
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
