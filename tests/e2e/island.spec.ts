import { test, expect, type Page } from '@playwright/test';

async function createWorld(page: Page, fixture = 'FX-BASE', seed = '101', speed = '240') {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /开始荒岛实验/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: new RegExp(fixture) }).first().click();
  await page.locator('input[inputmode="numeric"]').fill(seed);
  await page.locator('select').nth(0).selectOption('mock');
  await page.locator('select').nth(1).selectOption(speed);
  await page.getByRole('button', { name: /开始荒岛实验/ }).click();
  await expect(page.getByText(/第 1 日/).first()).toBeVisible({ timeout: 20_000 });
}

test('完整用户路径：开始页 → 开局 → 观察 → 暂停/恢复 → 认知切换 → 事件筛选 → 结局 → 导出 → 重开', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  // 1. Start page: connection status + scenario + seed.
  await page.goto('/');
  await expect(page.getByText(/后端：在线/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Provider/i)).toBeVisible();

  // 2. Create world with fixed seed 101.
  await createWorld(page);
  await expect(page.getByText(/第 1 日/).first()).toBeVisible();

  // 3. Let agents act; open inspector and check KnownLocations + motives.
  await page.waitForTimeout(8000);
  await page.getByTestId('card-agent_a').click();
  await expect(page.getByText(/已知地点/)).toBeVisible();
  await expect(page.getByText(/稳定参数（Profile）/)).toBeVisible();

  // 4. Knowledge view toggle: agent view must hide unknown resources.
  const godNodes = await page.locator('text=/淡水泉|椰林|潮池/').count();
  await page.getByTestId('view-agent_a').click();
  await page.waitForTimeout(500);
  const agentNodes = await page.locator('text=/淡水泉|椰林|潮池/').count();
  expect(agentNodes).toBeLessThanOrEqual(godNodes);
  await page.getByTestId('view-god').click();

  // 5. Pause 5s and verify game time does not advance.
  await page.getByRole('button', { name: '暂停' }).click();
  await expect(page.getByRole('button', { name: '继续' })).toBeVisible();
  const t1 = await page.getByTestId('hud-time').innerText();
  await page.waitForTimeout(5000);
  const t2 = await page.getByTestId('hud-time').innerText();
  expect(t1).toBe(t2);
  await page.getByRole('button', { name: '继续' }).click();
  await expect(page.getByRole('button', { name: '暂停' })).toBeVisible();

  // 6. Event stream filters.
  await page.getByRole('button', { name: '事件流' }).click();
  await page.getByRole('button', { name: '资源', exact: true }).click();
  await expect(page.getByText(/取走|消耗|采到|给了/).first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: '角色洞察' }).click();

  // 7. Wait for the run to end (accelerated).
  await expect(page.getByText(/荒岛实验结束/)).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText(/行为指标/)).toBeVisible();

  // 8. Export bundle.
  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
  await page.getByRole('link', { name: /下载验收包/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/bundle\.json$/);

  // 9. Restart generates a new world.
  await page.getByRole('button', { name: /再来一局/ }).click();
  await expect(page.getByRole('button', { name: /开始荒岛实验/ })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('开始页在无后端时不崩溃', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/AI 原生荒岛/).first()).toBeVisible();
});
