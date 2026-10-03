import { chromium } from 'playwright';

const url = process.argv[2];
const out = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 220 } });
await page.goto(url);
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
