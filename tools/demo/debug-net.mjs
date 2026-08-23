// Log every network request the principal web app makes during signup, with status,
// so a "network_error" in the UI can be traced to the exact call.
import { chromium } from 'playwright';

const runTag = String(Date.now()).slice(-7);
const PHONE = `+2348${runTag}22`;
const NIN = String(22222222222n + BigInt(runTag)).slice(-11);
const BVN = String(33333333333n + BigInt(runTag)).slice(-11);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

page.on('request', (r) => {
  if (!r.url().includes('19006')) console.log(`→ ${r.method()} ${r.url()}`);
});
page.on('response', async (r) => {
  if (!r.url().includes('19006')) console.log(`← ${r.status()} ${r.url()}`);
});
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') {
    console.log(`   [${m.type()}] ${m.text().slice(0, 300)}`);
  }
});
page.on('requestfailed', (r) => {
  console.log(`✗ FAILED ${r.method()} ${r.url()} :: ${r.failure()?.errorText}`);
});
page.on('pageerror', (e) => console.log(`!! pageerror: ${e.message.slice(0, 240)}`));

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
await page
  .getByRole('button', { name: /^VERIFY/i })
  .first()
  .click();
await page.waitForTimeout(8000);

console.log(`\nfinal screen: ${(await page.locator('#root').textContent())?.slice(0, 300)}`);
await browser.close();
