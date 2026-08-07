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
  const worldId = await page.evaluate(() => fetch('/api/mvp2/worlds').then((r) => r.json()).then((j) => j.worlds[0].worldId));
  const readPos = async () => {
    const w = await page.evaluate((id) => fetch(`/api/mvp2/worlds/${id}`).then((r) => r.json()).then((j) => j.world), worldId);
    const a = Object.values(w.agents).sort((x, y) => y.decisions - x.decisions)[0];
    return { id: a.id, x: a.x, y: a.y };
  };
  // sample server positions 10x @ 200ms to observe update cadence + speed
  const s0 = await readPos();
  const samples = [s0];
  for (let i = 0; i < 9; i++) { await new Promise((r) => setTimeout(r, 200)); samples.push(await readPos()); }
  const total = samples[samples.length - 1];
  const dx = Math.abs(total.x - s0.x) + Math.abs(total.y - s0.y);
  const changed = samples.filter((s, i) => i > 0 && (s.x !== samples[i - 1].x || s.y !== samples[i - 1].y)).length;
  console.log('server samples (2s):', samples.map((s) => `${s.id}@${s.x},${s.y}`).join(' | '));
  console.log(`moved ${dx} tiles in ~2s -> ~${(dx / 2).toFixed(1)} tiles/s; updates visible: ${changed}/9`);
  console.log('errors:', errors.slice(0, 5));
  await browser.close();
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
