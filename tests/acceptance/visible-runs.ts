// Visible runs (PRD 26.3/26.4): real browser, real API, 5 fixtures with
// screenshots and export bundles. Requires the API server running (mock or real).
//
// Usage:
//   npx tsx tests/acceptance/visible-runs.ts [--mock]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const useMock = process.argv.includes('--mock');
const outDir = join(process.cwd(), 'acceptance', 'visible');
mkdirSync(outDir, { recursive: true });

const RUNS = [
  { fixture: 'FX-BASE', seed: 101, speed: '4' },
  { fixture: 'FX-WATER-SECRET', seed: 202, speed: '4' },
  { fixture: 'FX-DEPENDENCY', seed: 303, speed: '4' },
  { fixture: 'FX-CONTENTION', seed: 404, speed: '4' },
  { fixture: 'FX-PROMISE-CRISIS', seed: 505, speed: '4' },
] as const;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

  for (const [i, run] of RUNS.entries()) {
    const tag = `V${i + 1}_${run.fixture}`;
    const dir = join(outDir, tag);
    mkdirSync(dir, { recursive: true });
    console.log(`[visible] ${tag} starting (${useMock ? 'mock' : 'real API'})`);

    await page.goto('http://localhost:8787/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(dir, '01-start-page.png'), fullPage: true });
    await page.getByRole('button', { name: new RegExp(run.fixture) }).first().click();
    await page.locator('input[inputmode="numeric"]').fill(String(run.seed));
    await page.locator('select').nth(0).selectOption(useMock ? 'mock' : 'real');
    await page.locator('select').nth(1).selectOption(run.speed);
    await page.getByRole('button', { name: /开始荒岛实验/ }).click();
    await page.getByTestId('hud-time').waitFor({ timeout: 30_000 });

    // Day 1 observation.
    await page.waitForTimeout(useMock ? 15_000 : 30_000);
    await page.getByTestId('card-agent_a').click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(dir, '02-day1-inspector.png'), fullPage: true });
    await page.getByTestId('view-agent_a').click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(dir, '03-agent-knowledge-view.png'), fullPage: true });
    await page.getByTestId('view-god').click();

    // Mid-game relations.
    await page.waitForTimeout(useMock ? 25_000 : 90_000);
    await page.getByRole('button', { name: '关系三角' }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(dir, '04-relationships.png'), fullPage: true });
    await page.getByRole('button', { name: '事件流' }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(dir, '05-event-stream.png'), fullPage: true });
    await page.getByRole('button', { name: '角色洞察' }).click();

    // Wait for the end (4x: ~6.75 game-minutes + LLM time).
    console.log(`[visible] ${tag} waiting for end...`);
    await page.getByText(/荒岛实验结束/).waitFor({ timeout: useMock ? 240_000 : 900_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(dir, '06-end-page.png'), fullPage: true });

    // Export bundle (worldId comes from the HUD export link).
    const exportHref = await page.getByRole('link', { name: '导出 JSON' }).getAttribute('href');
    const worldId = exportHref?.split('/').filter(Boolean).at(-2) ?? '';
    const resp = await page.evaluate(async (wid) => {
      const r = await fetch(`/api/worlds/${wid}/export`);
      return r.ok ? await r.text() : null;
    }, worldId);
    if (resp) {
      writeFileSync(join(dir, 'run-bundle.json'), resp);
      console.log(`[visible] ${tag} bundle saved (${(resp.length / 1024).toFixed(0)} KB)`);
    }

    await page.getByRole('button', { name: /再来一局/ }).click();
    await page.waitForTimeout(1000);
    console.log(`[visible] ${tag} done, pageErrors=${pageErrors.length}`);
  }
  await browser.close();
  console.log(`[visible] all runs complete. Output: ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
