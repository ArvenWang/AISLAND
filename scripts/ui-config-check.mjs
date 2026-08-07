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
  // sample helper
  const sample = async () => page.evaluate(() => {
    const app = window.__mvp2App;
    let out = null;
    const scan = (c) => {
      if (c.__mvp2State && c.__mvp2State.agentSprites) {
        const e = c.__mvp2State.agentSprites.get('agent_a');
        if (e && e.spr.texture && e.spr.texture.frame) {
          out = { x: Math.round(e.spr.texture.frame.x / 16), y: Math.round(e.spr.texture.frame.y / 16), sx: Math.round(e.spr.scale.x * 100) / 100 };
        }
      }
      if (c.children) for (const ch of c.children) scan(ch);
    };
    scan(app.stage);
    return out;
  });
  // force facing down + moving
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
  // fake facing via seqKey override
  await page.evaluate(() => {
    const app = window.__mvp2App;
    const scan = (c) => {
      if (c.__mvp2State && c.__mvp2State.agentSprites) {
        c.__mvp2State.seqKey.set('agent_a', 'walk_down');
        c.__mvp2State.mirrored.set('agent_a', false);
      }
      if (c.children) for (const ch of c.children) scan(ch);
    };
    scan(app.stage);
  });
  const down = [];
  for (let i = 0; i < 10; i++) { down.push(await sample()); await new Promise((r) => setTimeout(r, 60)); }
  console.log('walk_down frames (expect c=0 r=3/1 alternating):', down.map((d) => `${d.x},${d.y}`).join(' | '));
  // now up + mirrored horizontal
  await page.evaluate(() => {
    const app = window.__mvp2App;
    const scan = (c) => {
      if (c.__mvp2State && c.__mvp2State.agentSprites) {
        c.__mvp2State.seqKey.set('agent_a', 'walk_up');
        c.__mvp2State.mirrored.set('agent_a', false);
      }
      if (c.children) for (const ch of c.children) scan(ch);
    };
    scan(app.stage);
  });
  const up = [];
  for (let i = 0; i < 6; i++) { up.push(await sample()); await new Promise((r) => setTimeout(r, 60)); }
  console.log('walk_up frames (expect c=1 r=1/3):', up.map((d) => `${d.x},${d.y}`).join(' | '));
  await page.evaluate(() => {
    const app = window.__mvp2App;
    const scan = (c) => {
      if (c.__mvp2State && c.__mvp2State.agentSprites) {
        c.__mvp2State.seqKey.set('agent_a', 'walk_horiz');
        c.__mvp2State.mirrored.set('agent_a', true);
      }
      if (c.children) for (const ch of c.children) scan(ch);
    };
    scan(app.stage);
  });
  const horiz = [];
  for (let i = 0; i < 6; i++) { horiz.push(await sample()); await new Promise((r) => setTimeout(r, 60)); }
  console.log('walk_horiz (expect c=2 r=5/2, scale.x negative):', horiz.map((d) => `${d.x},${d.y} sx=${d.sx}`).join(' | '));
  console.log('errors:', errors.slice(0, 5));
  await browser.close();
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
