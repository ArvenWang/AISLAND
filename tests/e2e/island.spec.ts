import { test, expect, type Page } from '@playwright/test';

// MVP2 playable UI end-to-end: start page -> world -> map/HUD -> agent cards
// -> omniscient insight -> view switch -> pause/resume -> timeline -> follow
// camera -> export -> restart. Uses the real LLM API (server must be running).

test('完整用户路径：开始页 → 开局 → 观察 → 暂停/恢复 → 视角切换 → 洞察 → 时间线 → 跟随 → 导出 → 重开', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

  // 1. Start page: single start button + online status (no fixture/seed/model UI).
  await page.goto('/');
  await expect(page.getByTestId('start-game')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/AI 服务在线/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/场景（Fixture）/)).toHaveCount(0);
  await expect(page.getByText(/Provider/i)).toHaveCount(0);

  // 2. Create world (random seed) and enter the game view.
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('hud-time')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('hud-time')).toContainText('第 1 日');

  // 3. Agents act; cards show stats; open omniscient insight.
  await page.waitForTimeout(6000);
  for (const id of ['agent_a', 'agent_b', 'agent_c']) {
    await expect(page.getByTestId(`card-${id}`)).toBeVisible();
  }
  await page.getByTestId('card-agent_a').click();
  await expect(page.getByText(/当前计划/)).toBeVisible();
  await expect(page.getByText(/心理稳定/)).toBeVisible();

  // 4. View switch: god / agent views.
  await page.getByTestId('view-agent_a').click();
  await expect(page.getByTestId('view-agent_a')).toHaveClass(/bg-amber-500/);
  await page.getByTestId('view-god').click();
  await expect(page.getByTestId('view-god')).toHaveClass(/bg-amber-500/);

  // 5. Follow camera on agent_b.
  const followBtns = page.locator('button[title="跟随镜头"]');
  await followBtns.nth(1).click();
  await page.waitForTimeout(1200);
  await expect(followBtns.nth(1)).toHaveClass(/bg-sky-600/);
  await followBtns.nth(1).click(); // unfollow

  // 6. Pause: game time must not advance.
  await page.getByTestId('btn-pause').click();
  await expect(page.getByTestId('btn-resume')).toBeVisible();
  await page.waitForTimeout(2500); // let in-flight tick + WS state settle
  const t1 = await page.getByTestId('hud-time').innerText();
  await page.waitForTimeout(4000);
  const t2 = await page.getByTestId('hud-time').innerText();
  expect(t1).toBe(t2);
  await page.getByTestId('btn-resume').click();
  await expect(page.getByTestId('btn-pause')).toBeVisible();

  // 7. Timeline expands and shows events.
  await page.getByTestId('timeline-toggle').click();
  await expect(page.locator('text=/move|explore|pickup_item|harvest/').first()).toBeVisible({ timeout: 20_000 });

  // 8. Export evidence URL is reachable.
  const worldId = page.url();
  void worldId;
  const exportHref = await page.getByTestId('btn-export').getAttribute('href');
  expect(exportHref).toMatch(/^\/api\/mvp2\/worlds\//);

  // 9. Restart returns to the start page.
  await page.getByTestId('btn-restart').click();
  await expect(page.getByTestId('start-game')).toBeVisible({ timeout: 20_000 });

  expect(pageErrors).toEqual([]);
});
