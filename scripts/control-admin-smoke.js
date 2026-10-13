async (page) => {
  const check = (value, label) => { if (!value) throw Error(label); };
  const evidence = [];
  await page.goto('http://127.0.0.1:1442/manage/');
  await page.getByLabel('账号', { exact: true }).fill('qa-owner');
  await page.getByLabel('密码', { exact: true }).fill('Synthetic-ui-only-password-123!');
  await page.getByRole('button', { name: '登录管理中心' }).click();
  await page.getByRole('heading', { name: '模块开放矩阵' }).waitFor();
  check(await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0), 'No browser-stored credentials');
  evidence.push('real HTTP login and no browser-stored credentials');
  await page.getByLabel('拼豆图纸 AI 调用', { exact: true }).selectOption('deny');
  await page.getByRole('button', { name: '预览并发布' }).click();
  await page.getByRole('region', { name: '发布确认' }).waitFor();
  await page.getByRole('button', { name: '确认发布', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已发布修订 1' }).waitFor();
  await page.getByRole('button', { name: '准备个人测试空间' }).click();
  await page.getByRole('button', { name: /个人测试空间.*查看生效权限/ }).click();
  await page.getByText('拼豆图纸 · 可编辑 · AI 限制', { exact: true }).waitFor();
  evidence.push('published policy applied to actual own-workspace capabilities');
  await page.getByLabel('拼豆图纸 AI 调用', { exact: true }).selectOption('inherit');
  await page.getByRole('button', { name: '预览并发布' }).click();
  await page.getByRole('button', { name: '确认发布', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已发布修订 2' }).waitFor();
  await page.getByRole('button', { name: '预览恢复' }).click();
  await page.getByRole('button', { name: '确认发布', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已发布修订 3' }).waitFor();
  evidence.push('restore writes a new policy revision');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page overflow at ${width}`);
  }
  evidence.push('320/390/768/1440 responsive layouts');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'output/playwright/control-admin-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/control-admin-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '退出管理中心' }).click();
  await page.getByRole('heading', { name: '先确认你的管理身份' }).waitFor();
  await page.getByLabel('账号', { exact: true }).fill('qa-member');
  await page.getByLabel('密码', { exact: true }).fill('Synthetic-ui-only-password-123!');
  await page.getByRole('button', { name: '登录管理中心' }).click();
  await page.getByRole('alert').filter({ hasText: '没有这项管理权限' }).waitFor();
  check(await page.getByRole('heading', { name: '模块开放矩阵' }).count() === 0, 'Member cannot reach management');
  evidence.push('logout revocation and member management denial');
  await page.evaluate(evidence => { window.__controlEvidence = evidence; }, evidence);
  return evidence;
}
