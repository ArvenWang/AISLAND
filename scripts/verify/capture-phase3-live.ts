import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.join(__dirname, '../..');
const output = path.join(root, 'acceptance/phase3/visual-v2/live-game');

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors: Array<{ type: string; text: string }> = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push({ type: 'console.error', text: message.text() });
  });
  page.on('pageerror', (error) => errors.push({ type: 'pageerror', text: String(error) }));
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '开始新游戏' }).click();
  await page.waitForFunction(() => typeof (window as unknown as { render_game_to_text?: unknown }).render_game_to_text === 'function');
  await page.waitForTimeout(1800);
  const close = page.getByTestId('close-inspector');
  if (await close.isVisible()) await close.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(output, 'beach-overview.png'), fullPage: false });

  const follow = page.getByRole('button', { name: /跟随 林澈/ });
  await follow.click();
  await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(output, 'linche-follow.png'), fullPage: false });

  await follow.click();
  await page.waitForTimeout(750);
  const captureRegion = async (name: string, x: number, y: number, zoom = 1.2) => {
    await page.evaluate(({ x, y, zoom }) => {
      const viewport = (window as unknown as { __phase3Viewport?: { moveCenter: (x: number, y: number) => void; setZoom: (zoom: number, center?: boolean) => void } }).__phase3Viewport;
      viewport?.setZoom(zoom, true);
      viewport?.moveCenter(x * 32 + 16, y * 32 + 16);
    }, { x, y, zoom });
    await page.waitForTimeout(650);
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false });
  };
  await captureRegion('spring-valley', 68, 55, 1.25);
  await captureRegion('ridge-viewpoint', 101, 42, 1.25);
  await captureRegion('north-hidden-forest', 109, 27, 1.1);

  // Prove that the map presentation follows the same authoritative island
  // clock used by perception/survival. Speed up only this disposable
  // acceptance world, pause as soon as night begins, then return to the beach.
  const initialState = JSON.parse(await page.evaluate(() => (window as unknown as { render_game_to_text: () => string }).render_game_to_text())) as { worldId: string };
  await page.evaluate(async (worldId) => {
    await fetch(`/api/mvp2/worlds/${worldId}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'speed', timeScale: 15 }),
    });
  }, initialState.worldId);
  await page.waitForFunction(() => {
    const state = JSON.parse((window as unknown as { render_game_to_text: () => string }).render_game_to_text()) as { gameTime: number };
    return state.gameTime % 1440 >= 1000;
  }, undefined, { timeout: 15_000 });
  await page.evaluate(async (worldId) => {
    await fetch(`/api/mvp2/worlds/${worldId}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    });
  }, initialState.worldId);
  await page.waitForFunction(() => {
    const state = JSON.parse((window as unknown as { render_game_to_text: () => string }).render_game_to_text()) as { status: string };
    return state.status === 'paused';
  });
  await page.waitForFunction(() => document.querySelector('[data-testid="world-lighting"]')?.getAttribute('data-light-phase') === 'night');
  await captureRegion('night-beach', 48, 97, 0.8);

  const text = await page.evaluate(() => (window as unknown as { render_game_to_text: () => string }).render_game_to_text());
  fs.writeFileSync(path.join(output, 'state.json'), `${text}\n`);
  fs.writeFileSync(path.join(output, 'errors.json'), `${JSON.stringify(errors, null, 2)}\n`);
  if (errors.length) throw new Error(`Live Phase 3 capture found ${errors.length} browser errors`);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
