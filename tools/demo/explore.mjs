// Walk the principal app in a browser and dump what is actually on screen at each step,
// so the recorder's selectors are written against reality rather than guessed.

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'tools/demo/out';
mkdirSync(OUT, { recursive: true });

const runTag = String(Date.now()).slice(-7);
const PHONE = `+2348${runTag}11`;
const NIN = String(22222222222n + BigInt(runTag)).slice(-11);
const BVN = String(33333333333n + BigInt(runTag)).slice(-11);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`  !! pageerror: ${e.message.slice(0, 200)}`));
page.on('console', (m) => {
  if (m.type() === 'error') console.log(`  !! console: ${m.text().slice(0, 200)}`);
});

async function dump(tag) {
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => ({
    text: (document.querySelector('#root')?.textContent ?? '').slice(0, 400),
    buttons: [...document.querySelectorAll('[role="button"]')].map((b) =>
      (b.textContent ?? '').trim().slice(0, 40),
    ),
    labels: [...document.querySelectorAll('[aria-label]')].map((b) => b.getAttribute('aria-label')),
    inputs: [...document.querySelectorAll('input')].map(
      (i) => i.getAttribute('aria-label') ?? i.placeholder,
    ),
  }));
  console.log(`\n=== ${tag} ===`);
  console.log(`text    : ${info.text.replace(/\s+/g, ' ').slice(0, 260)}`);
  console.log(`buttons : ${JSON.stringify(info.buttons)}`);
  console.log(`inputs  : ${JSON.stringify(info.inputs)}`);
  await page.screenshot({ path: `${OUT}/explore-${tag}.png` });
}

console.log(`phone=${PHONE} nin=${NIN} bvn=${BVN}`);
await page.goto('http://localhost:19006', { waitUntil: 'load', timeout: 180_000 });
await page.waitForFunction(
  () => (document.querySelector('#root')?.textContent ?? '').trim().length > 0,
  { timeout: 120_000 },
);
await dump('01-phone');

await page.getByLabel('MOBILE NUMBER').fill(PHONE);
await page.getByRole('button', { name: /SEND CODE/i }).click();
await dump('02-verify');

await page.getByLabel('6-DIGIT CODE').fill('123456');
await page.getByLabel('NIN').fill(NIN);
await page.getByLabel('BVN').fill(BVN);
const verifyBtn = page.getByRole('button', { name: /^(VERIFY|CONTINUE|SUBMIT)/i }).first();
await verifyBtn.click();
await page.waitForTimeout(3500);
await dump('03-after-verify');

// Whatever screen we land on, try to drive household creation if it's there.
const createBtns = await page.getByRole('button').allTextContents();
console.log(`\navailable buttons after login: ${JSON.stringify(createBtns)}`);

await browser.close();
console.log(`\nscreenshots in ${OUT}/`);
