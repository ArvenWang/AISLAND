import { chromium } from '@playwright/test';
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.getByTestId('start-game').click();
  await page.getByTestId('hud-time').waitFor({ timeout: 90000 });
  await page.bringToFront();
  await page.waitForTimeout(4000);
  const worldId = await page.evaluate(() => fetch('/api/mvp2/worlds').then((r) => r.json()).then((j) => j.worlds[0].worldId));
  const state = async () => {
    const w = await page.evaluate((id) => fetch(`/api/mvp2/worlds/${id}`).then((r) => r.json()).then((j) => j.world), worldId);
    return Object.values(w.agents).map((a: any) => ({ id: a.id, act: a.currentAction?.type ?? 'idle', prog: a.currentAction?.progress ?? -1, x: a.x, y: a.y }));
  };
  const btns = page.locator('button[title="跟随镜头"]');
  let lastAct = '';
  const shots: Buffer[] = [];
  for (let i = 0; i < 8; i++) {
    const st = await state();
    const moving = st.filter((a: any) => ['move', 'explore', 'approach'].includes(a.act));
    if (moving.length && moving[0].id !== lastAct) {
      const idx = moving[0].id === 'agent_a' ? 0 : moving[0].id === 'agent_b' ? 1 : 2;
      await btns.nth(idx).click();
      lastAct = moving[0].id;
    }
    if (i >= 2) shots.push(await page.screenshot({ type: 'png' }));
    console.log('t', i, JSON.stringify(st));
    await page.waitForTimeout(400);
  }
  const { PNG } = await import('pngjs');
  const cropCenter = (buf: Buffer) => {
    const png = PNG.sync.read(buf);
    const w = png.width, h = png.height;
    const x0 = Math.floor(w * 0.35), x1 = Math.floor(w * 0.65), y0 = Math.floor(h * 0.35), y1 = Math.floor(h * 0.7);
    const out = Buffer.alloc((x1 - x0) * (y1 - y0) * 4);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const si = (y * w + x) * 4;
        const di = ((y - y0) * (x1 - x0) + (x - x0)) * 4;
        out[di] = png.data[si]; out[di + 1] = png.data[si + 1]; out[di + 2] = png.data[si + 2]; out[di + 3] = png.data[si + 3];
      }
    }
    return out;
  };
  const diff = (a: Buffer, b: Buffer) => {
    let d = 0;
    for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    return d / (a.length / 4);
  };
  const cs = shots.map(cropCenter);
  const pairs = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]].map(([a, b]) => Math.round(diff(cs[a], cs[b])));
  console.log('center diffs:', pairs.join(', '));
  console.log('errors:', errors.slice(0, 5));
  await browser.close();
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
