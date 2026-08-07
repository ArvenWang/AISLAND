import { chromium } from '@playwright/test';
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.getByTestId('start-game').click();
  await page.getByTestId('hud-time').waitFor({ timeout: 90000 });
  await page.waitForTimeout(3000);
  const readSprites = () =>
    page.evaluate(() => {
      const app = window.__mvp2App;
      if (!app) return null;
      const out = {};
      const scan = (c) => {
        if (c.__mvp2State && c.__mvp2State.agentSprites) {
          c.__mvp2State.agentSprites.forEach((s, id) => {
            out[id] = { x: Math.round(s.spr.position.x), y: Math.round(s.spr.position.y), visible: s.spr.visible };
          });
        }
        if (c.children) for (const ch of c.children) scan(ch);
      };
      scan(app.stage);
      return out;
    });
  const t0 = await readSprites();
  console.log('t0 sprites:', JSON.stringify(t0));
  await page.waitForTimeout(15000);
  const t1 = await readSprites();
  console.log('t1 sprites:', JSON.stringify(t1));
  if (t0 && t1) {
    const moved = Object.keys(t0).filter((id) => t0[id].x !== t1[id].x || t0[id].y !== t1[id].y);
    console.log('moved sprites:', moved);
  }
  console.log('errors:', errors.slice(0, 5));
  await browser.close();
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
