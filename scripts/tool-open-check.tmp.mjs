import { chromium } from '@playwright/test';
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const resp = await page.goto('http://localhost:5173/tools/sprite-picker.html', { waitUntil: 'networkidle', timeout: 20000 });
  console.log('HTTP status:', resp.status());
  await page.waitForTimeout(1200);
  const title = await page.title();
  const cells = await page.locator('.frame-cell').count();
  const tabs = await page.locator('#tabs button').count();
  const slots = await page.locator('.slot').count();
  console.log('title:', title, '| frames:', cells, '| tabs:', tabs, '| slots:', slots);
  console.log('errors:', errors);
  await browser.close();
}
main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
