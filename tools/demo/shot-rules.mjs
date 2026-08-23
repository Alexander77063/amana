// Drive the principal app to the new rules editor and screenshot it, so the UI can be
// eyeballed without recording a whole take.
import { chromium } from 'playwright';

const tag = String(Date.now()).slice(-7);
const PHONE = `+2348${tag}55`;
const NIN = String(22222222222n + BigInt(tag)).slice(-11);
const BVN = String(33333333333n + BigInt(tag)).slice(-11);
const AGENT_PHONE = `+2348${tag}56`;
const NIN_A = String(44444444444n + BigInt(tag)).slice(-11);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 1100 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`!! ${e.message.slice(0, 200)}`));

let pairingCode = null;
page.on('response', async (r) => {
  if (r.url().endsWith('/pairing') && r.request().method() === 'POST') {
    try {
      pairingCode = (await r.json())?.code ?? pairingCode;
    } catch {
      /* ignore */
    }
  }
});

const ready = async () =>
  page.waitForFunction(
    () => (document.querySelector('#root')?.textContent ?? '').trim().length > 0,
    { timeout: 120_000 },
  );

await page.goto('http://localhost:19006', { waitUntil: 'load', timeout: 180_000 });
await ready();
await page.getByLabel('MOBILE NUMBER').fill(PHONE);
await page.getByRole('button', { name: /SEND CODE/i }).click();
await page.getByLabel('6-DIGIT CODE').waitFor({ timeout: 30_000 });
await page.getByLabel('6-DIGIT CODE').fill('123456');
await page.getByLabel('NIN').fill(NIN);
await page.getByLabel('BVN').fill(BVN);
await page.getByRole('button', { name: /^VERIFY/i }).first().click();

await page.getByLabel('HOUSEHOLD NAME').waitFor({ timeout: 45_000 });
await page.getByLabel('HOUSEHOLD NAME').fill('Adebayo Family');
await page.getByRole('button', { name: /CREATE HOUSEHOLD/i }).click();
await page.getByRole('button', { name: 'Pair an agent' }).waitFor({ timeout: 45_000 });

// Pair an agent so a sub-wallet can be issued.
await page.getByRole('button', { name: 'Pair an agent' }).click();
await page.getByRole('button', { name: /GENERATE CODE/i }).click();
await page.waitForTimeout(3000);
if (!pairingCode) throw new Error('no pairing code');

const agent = await browser.newPage({ viewport: { width: 390, height: 900 } });
await agent.goto('http://localhost:19007', { waitUntil: 'load', timeout: 180_000 });
await agent.waitForFunction(
  () => (document.querySelector('#root')?.textContent ?? '').trim().length > 0,
  { timeout: 120_000 },
);
await agent.getByLabel('MOBILE NUMBER').fill(AGENT_PHONE);
await agent.getByRole('button', { name: /SEND CODE/i }).click();
await agent.getByLabel('VERIFICATION CODE').waitFor({ timeout: 30_000 });
await agent.getByLabel('VERIFICATION CODE').fill('123456');
await agent.getByLabel('PAIRING CODE').fill(pairingCode);
await agent.getByLabel('NIN').fill(NIN_A);
await agent.getByRole('button', { name: /^VERIFY/i }).first().click();
await agent.waitForTimeout(6000);

// Back on the principal: issue a sub-wallet, then open the rules editor.
await page.goto('http://localhost:19006', { waitUntil: 'load', timeout: 180_000 });
await ready();
await page.getByRole('button', { name: 'Sub-wallets' }).waitFor({ timeout: 60_000 });
await page.getByRole('button', { name: 'Sub-wallets' }).click();
await page.getByRole('button', { name: /NEW SUB-WALLET/i }).click();
await page.getByRole('button', { name: /^Agent \+/i }).first().click();
await page.getByLabel('SUB-WALLET NAME').fill('Tunde — school run');
await page.getByRole('button', { name: /CREATE SUB-WALLET/i }).click();
await page.waitForTimeout(4000);

await page.getByText('Tunde — school run').first().click();
await page.waitForTimeout(2500);
await page.getByText('Edit', { exact: true }).first().click();
await page.waitForTimeout(3000);

// Exercise the new controls so the screenshot shows them populated.
await page.getByLabel('AMOUNT (₦)').fill('20000');
await page.getByRole('button', { name: 'Only these', exact: true }).click();
await page.waitForTimeout(600);
for (const c of ['Transport', 'School', 'Food & market']) {
  await page.getByRole('button', { name: c }).click();
}
await page.getByRole('button', { name: 'Only these hours' }).click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Sun' }).click();
await page.getByRole('button', { name: 'Sat' }).click();
await page.waitForTimeout(1200);

await page.screenshot({ path: 'tools/demo/out/rules-editor.png', fullPage: true });
console.log('screenshot → tools/demo/out/rules-editor.png');

// Publish, and confirm it round-trips.
await page.getByRole('button', { name: /PUBLISH RULES/i }).click();
await page.waitForTimeout(5000);
const detail = (await page.locator('#root').textContent()) ?? '';
console.log(`after publish, detail shows: ${detail.includes('category') ? 'category ✓' : 'category ✗'} ${detail.includes('time_window') ? 'time_window ✓' : 'time_window ✗'}`);
await page.screenshot({ path: 'tools/demo/out/rules-published.png', fullPage: true });

await browser.close();
