import { chromium } from '@playwright/test';
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.getByTestId('start-game').click();
  await page.getByTestId('hud-time').waitFor({ timeout: 90000 });
  await page.waitForTimeout(8000);
  const zoom = async () => (await page.getByTestId('zoom-level').innerText()).trim();
  console.log('god view zoom:', await zoom());
  await page.screenshot({ path: '/tmp/mvp2-ui/zoom-god.png' });
  await page.locator('button[title="跟随镜头"]').nth(1).click();
  await page.waitForTimeout(3000);
  console.log('follow zoom:', await zoom());
  await page.screenshot({ path: '/tmp/mvp2-ui/zoom-follow.png' });
  await page.locator('button[title="跟随镜头"]').nth(1).click();
  await page.waitForTimeout(3000);
  console.log('back zoom:', await zoom());
  await page.screenshot({ path: '/tmp/mvp2-ui/zoom-back.png' });
  console.log('errors:', errors.slice(0, 5));
  await browser.close();
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
