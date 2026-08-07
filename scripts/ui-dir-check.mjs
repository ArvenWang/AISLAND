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
  const force = async (facing) => {
    await page.evaluate((fv) => {
      const app = window.__mvp2App;
      const scan = (c) => {
        if (c.__mvp2State && c.__mvp2State.agentSprites) {
          c.__mvp2State.moving.add('agent_a');
          c.__mvp2State.targetPos.set('agent_a', { x: 3000, y: 4000 });
          const e = c.__mvp2State.agentSprites.get('agent_a');
          if (e) e.spr.visible = true;
          // patch liveProps.agents['agent_a'].facing
          if (c.__mvp2State.livePropsTest) {}
        }
        if (c.children) for (const ch of c.children) scan(ch);
      };
      scan(app.stage);
      // expose a hook to override facing: store on state
      app.__mvp2Facing = fv;
    }, facing);
  };
  const sampleCols = async () => {
    const cols = [];
    for (let i = 0; i < 16; i++) {
      const col = await page.evaluate(() => {
        const app = window.__mvp2App;
        let c2 = -1;
        const scan = (c) => {
          if (c.__mvp2State && c.__mvp2State.agentSprites) {
            const s = c.__mvp2State.agentSprites.get('agent_a');
            if (s && s.spr.texture && s.spr.texture.frame) c2 = Math.round(s.spr.texture.frame.x / 64);
          }
          if (c.children) for (const ch of c.children) scan(ch);
        };
        scan(app.stage);
        return c2;
      });
      cols.push(col);
      await new Promise((r) => setTimeout(r, 50));
    }
    return cols;
  };
  // Patch facing via state hook: dirIndex reads liveProps.agents[id].facing.
  // Instead, override the dir function through window hook (MapScene reads
  // liveProps; we fake it by writing into the sprite's texture directly is
  // not possible, so verify down-direction default and frame cadence only.
  await force({ x: 0, y: 1 });
  const cols = await sampleCols();
  console.log('cols (down expect 0-3):', cols.join(','));
  const unique = [...new Set(cols)];
  console.log('unique cols:', unique.join(','));
  console.log('within one direction block:', unique.every((c) => c >= 0 && c < 4));
  console.log('errors:', errors.slice(0, 5));
  await browser.close();
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
