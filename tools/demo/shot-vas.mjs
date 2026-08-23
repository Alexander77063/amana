// Drive the agent's new airtime & bills screen in a browser: buy airtime, then prove the
// parent's category lock refuses the next one. Screenshots both.
import { chromium } from 'playwright';
import { call, idem, login, newBvn, newNin, newPhone } from './lib.mjs';

// Seed a paired agent with a funded wallet through the API — the UI part under test is the
// top-up screen, not onboarding.
const pTok = (await login(newPhone(), { nin: newNin(), bvn: newBvn() })).body.accessToken;
const hh = await call('/households', { method: 'POST', token: pTok, body: { name: 'VAS demo' } });
const householdId = hh.body?.household?.id ?? hh.body?.id;
await fetch('http://localhost:3200/_control/fund', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ amountKobo: '50000000' }),
});
const pair = await call('/pairing', { method: 'POST', token: pTok, body: { householdId } });
const agentPhone = newPhone();
const agent = await login(agentPhone, { nin: newNin(), pairingCode: pair.body.code });
const sw = await call(`/households/${householdId}/sub-wallets`, {
  method: 'POST',
  token: pTok,
  body: { agentUserId: agent.body.user.id, name: 'Tunde — school run' },
});
const subWalletId = sw.body?.subWallet?.id;
console.log(`seeded agent ${agentPhone}, sub-wallet ${subWalletId}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 1200 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`!! ${e.message.slice(0, 200)}`));

await page.goto('http://localhost:19007', { waitUntil: 'load', timeout: 180_000 });
await page.waitForFunction(
  () => (document.querySelector('#root')?.textContent ?? '').trim().length > 0,
  { timeout: 120_000 },
);
await page.getByLabel('MOBILE NUMBER').fill(agentPhone);
await page.getByRole('button', { name: /SEND CODE/i }).click();
await page.getByLabel('VERIFICATION CODE').waitFor({ timeout: 30_000 });
await page.getByLabel('VERIFICATION CODE').fill('123456');
await page.getByRole('button', { name: /^VERIFY/i }).first().click();
await page.waitForTimeout(7000);

await page.getByText('Pay', { exact: true }).first().click();
await page.waitForTimeout(3000);
await page.getByRole('button', { name: /Buy airtime, data or pay a bill/i }).click();
await page.waitForTimeout(4000);

await page.screenshot({ path: 'tools/demo/out/vas-open.png', fullPage: true });
console.log(`topup screen: ${((await page.locator('#root').textContent()) ?? '').replace(/\s+/g,' ').slice(-260)}`);

// Airtime to the agent's own number — always permitted by the cash-out gate.
await page.getByRole('button', { name: 'MTN Nigeria' }).click();
await page.waitForTimeout(1500);
await page.getByLabel('PHONE NUMBER').fill(agentPhone);
await page.getByLabel('AMOUNT (₦)').fill('1000');
await page.waitForTimeout(1200);
await page.screenshot({ path: 'tools/demo/out/vas-topup.png', fullPage: true });
console.log('screenshot → tools/demo/out/vas-topup.png');

await page.getByRole('button', { name: 'BUY', exact: true }).click();
await page.waitForTimeout(6000);
const receipt = (await page.locator('#root').textContent()) ?? '';
console.log(`after buy: ${receipt.replace(/\s+/g, ' ').slice(0, 180)}`);
await page.screenshot({ path: 'tools/demo/out/vas-receipt.png', fullPage: true });

// Now the parent locks spending to transport only, and the agent tries again.
await call(`/sub-wallets/${subWalletId}/rules`, {
  method: 'POST',
  token: pTok,
  body: {
    rules: [
      { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: '5000000' } },
      { kind: 'category', priority: 20, config: { mode: 'allowlist', categories: ['transport'] } },
    ],
  },
});
console.log('parent locked spending to: transport');

await page.getByRole('button', { name: /^DONE$/i }).click();
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /Buy airtime, data or pay a bill/i }).click();
await page.waitForTimeout(4000);
await page.getByRole('button', { name: 'MTN Nigeria' }).click();
await page.waitForTimeout(1200);
await page.getByLabel('PHONE NUMBER').fill(agentPhone);
await page.getByLabel('AMOUNT (₦)').fill('1000');
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'BUY', exact: true }).click();
await page.waitForTimeout(5000);

const blocked = (await page.locator('#root').textContent()) ?? '';
const refused = blocked.includes('not allowed this category');
console.log(`blocked attempt shows: ${refused ? '✓ category refusal' : '✗ NOT refused'}`);
await page.screenshot({ path: 'tools/demo/out/vas-blocked.png', fullPage: true });

await browser.close();
process.exit(refused ? 0 : 1);
