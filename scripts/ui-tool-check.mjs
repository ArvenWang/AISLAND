import { chromium } from '@playwright/test';
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:5173/tools/sprite-picker.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const frameCells = await page.locator('.frame-cell').count();
  console.log('frame cells:', frameCells, '(expect 28)');
  // click frame c0r2 then slot 0 (walk_down first slot)
  await page.locator('.frame-cell').nth(2).click(); // r0 c2? index = r*4+c -> index2 = r0 c2
  await page.locator('.slot').nth(0).click();
  await page.waitForTimeout(300);
  const filled = await page.locator('.slot.filled').count();
  console.log('filled slots after one assignment:', filled);
  // assign 4 walk_down frames: c0 r2..r5 (indices 2,6,10,14)
  for (const idx of [2, 6, 10, 14]) {
    await page.locator('.frame-cell').nth(idx).click();
    const slotIdx = [2, 6, 10, 14].indexOf(idx);
    await page.locator('.slot').nth(slotIdx).click();
  }
  await page.waitForTimeout(300);
  console.log('filled slots after walk_down set:', await page.locator('.slot.filled').count());
  // preview play
  await page.getByTestId ? null : null;
  await page.locator('#btnPlay').click();
  await page.waitForTimeout(700);
  const json = await page.locator('#jsonBox').textContent();
  console.log('json has walk_down frames:', /walk_down/.test(json) && json.split('"c"').length - 1 >= 4);
  console.log('errors:', errors.slice(0, 5));
  await page.screenshot({ path: '/tmp/mvp2-ui/sprite-tool.png' });
  await browser.close();
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
