import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto('http://localhost:19006', { waitUntil: 'load', timeout: 180_000 });
await page.waitForTimeout(4000);

const info = await page.evaluate(() => {
  const root = document.querySelector('#root');
  return {
    rootChildren: root?.childElementCount ?? -1,
    rootTextContent: JSON.stringify(root?.textContent?.slice(0, 200) ?? null),
    bodyTextContent: JSON.stringify(document.body.textContent?.slice(0, 200) ?? null),
    bodyInnerText: JSON.stringify(document.body.innerText?.slice(0, 200) ?? null),
    headingCount: document.querySelectorAll('[role="heading"]').length,
    buttonCount: document.querySelectorAll('[role="button"]').length,
    inputCount: document.querySelectorAll('input').length,
    firstDivHtml: (root?.innerHTML ?? '').slice(0, 400),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
