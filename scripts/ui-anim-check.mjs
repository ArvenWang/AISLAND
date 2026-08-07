import { chromium } from '@playwright/test';
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.getByTestId('start-game').click();
  await page.getByTestId('hud-time').waitFor({ timeout: 90000 });
  await page.bringToFront();
  await page.waitForTimeout(4000);
  // world time scale check
  const worldId = await page.evaluate(() => fetch('/api/mvp2/worlds').then((r) => r.json()).then((j) => j.worlds[0].worldId));
  const t0 = await page.evaluate((id) => fetch(`/api/mvp2/worlds/${id}`).then((r) => r.json()).then((j) => j.world.gameTime), worldId);
  await page.waitForTimeout(5000);
  const t1 = await page.evaluate((id) => fetch(`/api/mvp2/worlds/${id}`).then((r) => r.json()).then((j) => j.world.gameTime), worldId);
  console.log('game minutes in 5 real seconds:', t1 - t0, '(expect ~50 with 2x)');
  // Force walk animation on agent_a and sample texture frame + position
  await page.evaluate(() => {
    const app = window.__mvp2App;
    const scan = (c) => {
      if (c.__mvp2State && c.__mvp2State.agentSprites) {
        c.__mvp2State.moving.add('agent_a');
        c.__mvp2State.targetPos.set('agent_a', { x: 3000, y: 4000 });
      }
      if (c.children) for (const ch of c.children) scan(ch);
    };
    scan(app.stage);
  });
  const samples = [];
  for (let i = 0; i < 24; i++) {
    const s = await page.evaluate(() => {
      const app = window.__mvp2App;
      let out = { col: -1, x: -1, y: -1 };
      const scan = (c) => {
        if (c.__mvp2State && c.__mvp2State.agentSprites) {
          const e = c.__mvp2State.agentSprites.get('agent_a');
          if (e && e.spr.texture && e.spr.texture.frame) {
            out.col = Math.round(e.spr.texture.frame.x / 64);
            out.x = Math.round(e.spr.position.x);
            out.y = Math.round(e.spr.position.y);
          }
        }
        if (c.children) for (const ch of c.children) scan(ch);
      };
      scan(app.stage);
      return out;
    });
    samples.push(s);
    await page.waitForTimeout(50);
  }
  const cols = samples.map((s) => s.col).join(',');
  const xs = samples.map((s) => s.x).join(',');
  console.log('walk cols:', cols);
  console.log('pos x:', xs);
  const hasEmpty = cols.includes('-1');
  const cycleOk = new Set(cols.filter((c) => c >= 0)).size >= 3;
  const posContinuous = samples.every((s, i) => i === 0 || Math.abs(s.x - samples[i - 1].x) <= 6);
  console.log('no empty frame:', !hasEmpty, '| 3+ frames used:', cycleOk, '| position continuous:', posContinuous);
  console.log('errors:', errors.slice(0, 5));
  await browser.close();
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
