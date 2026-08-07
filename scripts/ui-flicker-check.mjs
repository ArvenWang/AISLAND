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
  await page.waitForTimeout(3000);
  // Force agent_a into "moving" state and give it a distant target; the
  // ticker will advance walk frames at its configured cadence.
  await page.evaluate(() => {
    const app = window.__mvp2App;
    const scan = (c) => {
      if (c.__mvp2State && c.__mvp2State.agentSprites) {
        c.__mvp2State.moving.add('agent_a');
        c.__mvp2State.targetPos.set('agent_a', { x: 4000, y: 5000 });
        c.__mvp2State.agentSprites.get('agent_a').spr.visible = true;
      }
      if (c.children) for (const ch of c.children) scan(ch);
    };
    scan(app.stage);
  });
  const frames = [];
  for (let i = 0; i < 30; i++) {
    const col = await page.evaluate(() => {
      const app = window.__mvp2App;
      let c2 = -1;
      const scan = (c) => {
        if (c.__mvp2State && c.__mvp2State.agentSprites) {
          const s = c.__mvp2State.agentSprites.get('agent_a');
          if (s && s.spr.texture && s.spr.texture.frame) c2 = Math.round(s.spr.texture.frame.x / 32);
        }
        if (c.children) for (const ch of c.children) scan(ch);
      };
      scan(app.stage);
      return c2;
    });
    frames.push(col);
    await page.waitForTimeout(50);
  }
  console.log('frame cols over 1.5s:', frames.join(','));
  const same = frames.filter((f, i) => i > 0 && f === frames[i - 1]).length;
  console.log('same-as-previous:', same, '/', frames.length - 1);
  const ok = same >= 5 && frames.some((f) => f !== frames[0]);
  console.log('walk cadence OK (~12fps, no 60fps flicker):', ok);
  console.log('errors:', errors.slice(0, 5));
  await browser.close();
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
