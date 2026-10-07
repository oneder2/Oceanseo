// Physical .uiuxqa client paired with native-desktop-qa.mjs, localhost only.
async (page) => {
  const check = (value, message) => { if (!value) throw Error(message); };
  const state = await page.evaluate(async () => ({
    path: await window.__TAURI_INTERNALS__.invoke('plugin:path|resolve_directory', { directory: 14 }),
    platform: await window.__TAURI_INTERNALS__.invoke('get_runtime_platform'),
  }));
  check(state.platform === 'android' && /^\/data\/(?:user\/0|data)\/com\.tideplan\.mobile\.uiuxqa(?:\/|$)/.test(state.path), 'Refusing daily package');
  const nav = page.getByRole('navigation', { name: '手机主导航' });
  const sync = page.getByRole('region', { name: '跨设备同步', exact: true });
  await page.locator('.mobile-settings').click();
  await sync.getByRole('textbox', { name: '同步服务地址', exact: true }).fill('http://127.0.0.1:4789');
  await sync.getByLabel('同步访问令牌', { exact: true }).fill('tideplan-local-test-token-not-for-production-123456');
  await sync.getByRole('button', { name: '保存同步配置', exact: true }).click();
  await sync.getByText(/配置已保存/).waitFor();
  await sync.getByRole('button', { name: '检查更改', exact: true }).click();
  const apply = sync.getByRole('button', { name: '确认同步并重新载入', exact: true });
  await apply.waitFor();
  const conflicts = sync.locator('.sync-conflict');
  // Each client created its own synthetic conversation. Require explicit choice.
  const count = await conflicts.count();
  if (count) {
    check(count === 1 && (await conflicts.innerText()).includes('目标与对话'), 'Unexpected task conflict');
    check(await apply.isDisabled(), 'Unresolved conflict did not block sync');
    await conflicts.getByRole('radio', { name: '保留服务端版本', exact: true }).check();
  }
  await apply.click();
  await page.getByRole('dialog', { name: '偏好设置', exact: true }).waitFor({ state: 'hidden' });
  let tasks = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_tasks'));
  const title = '原生升级验收：保留任务与笔记';
  const original = tasks.find(task => task.title === title);
  check(original && !original.completed_at, 'Did not receive native desktop record');
  check(tasks.filter(task => task.title === '验证升级与恢复').length === 2, 'Independent same-title tasks lost stable IDs');
  await nav.getByRole('button', { name: '工具', exact: true }).click();
  await page.getByRole('navigation', { name: '工作区导航' }).getByRole('button', { name: '所有计划', exact: true }).click();
  await page.getByRole('button', { name: `${title}的记事本`, exact: true }).click();
  await page.locator('#task-notebook').fill('手机回传验收：Linux 创建，Pixel 9a 更新笔记并完成。');
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await page.locator('.task-card').filter({ hasText: title }).getByRole('button', { name: '完成计划', exact: true }).click();
  await page.locator('.mobile-settings').click();
  await sync.getByRole('button', { name: '检查更改', exact: true }).click();
  await apply.waitFor();
  check(await sync.locator('.sync-conflict').count() === 0, 'Unexpected second-round conflict');
  await apply.click();
  await page.getByRole('dialog', { name: '偏好设置', exact: true }).waitFor({ state: 'hidden' });
  tasks = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_tasks'));
  const updated = tasks.find(task => task.id === original.id);
  check(updated?.notes.startsWith('手机回传验收') && updated.completed_at, 'Phone changes not durable');
  console.log(JSON.stringify({ gate: 'physical-phone-sync-receive-and-upload', id: original.id, goalsConflictConfirmed: count === 1, tasks }));
}
