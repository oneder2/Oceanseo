// Final APK regression in Pixel .uiuxqa, synthetic HTTP services only.
async (page) => {
  const check = (value, message) => { if (!value) throw Error(message); };
  const before = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const path = await invoke('plugin:path|resolve_directory', { directory: 14 });
    if (!path.endsWith('/com.tideplan.mobile.uiuxqa')) throw Error('Refusing daily package');
    const ai = await invoke('get_ai_settings');
    const sync = await invoke('get_sync_status');
    if (ai.baseUrl !== 'http://127.0.0.1:4319/v1' || sync.endpoint !== 'http://127.0.0.1:4789') throw Error('Synthetic services required');
    return { tasks: await invoke('list_tasks'), version: await invoke('plugin:app|version') };
  });
  check(before.version === '0.18.0', 'Wrong native version');
  const existingDelivery = page.getByRole('dialog', { name: '最终交付清单', exact: true });
  if (await existingDelivery.isVisible()) await existingDelivery.getByRole('button', { name: '关闭最终交付清单', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '手机主导航' });
  await nav.getByRole('button', { name: '助手', exact: true }).click();
  const recover = page.getByRole('button', { name: '重读数据', exact: true });
  if (await recover.isVisible()) await recover.click();
  const replies = await page.locator('.gc-message.is-assistant').count();
  await page.getByRole('textbox', { name: '给小汐的消息' }).fill('最终安装包验收：新增独立验收事项，替换刚才未执行的验收草稿，不修改已有事项。先验证升级与恢复，再准备发布。旅行目的尚未明确。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.waitForFunction(count => document.querySelectorAll('.gc-message.is-assistant').length > count, replies);
  await page.getByRole('button', { name: '查看理解图', exact: true }).click();
  const map = page.getByRole('dialog', { name: '理解图', exact: true });
  check(await map.locator('input,textarea,select,[contenteditable=true]').count() === 0, 'Editable understanding');
  await map.getByRole('button', { name: '关闭理解图', exact: true }).click();
  await page.getByRole('button', { name: '打开交付清单', exact: true }).click();
  const delivery = page.getByRole('dialog', { name: '最终交付清单', exact: true });
  const row = delivery.getByRole('article', { name: '验证升级与恢复', exact: true });
  await row.getByRole('button', { name: '微调参数', exact: true }).click();
  const title = `最终构建验收 ${Date.now()}`;
  await row.getByRole('textbox', { name: '名称', exact: true }).fill(title);
  await row.getByRole('button', { name: '保存微调', exact: true }).click();
  await delivery.getByRole('article', { name: title, exact: true }).waitFor();
  // A previously created goal is reused; only the new task is then executable.
  await delivery.getByRole('button', { name: /^执行全部可执行项（[12]）$/ }).click();
  await page.waitForFunction(async title => {
    if (document.querySelector('.delivery-list [role=alert]')) return true;
    return (await window.__TAURI_INTERNALS__.invoke('list_tasks')).some(task => task.title === title);
  }, title);
  check(await delivery.locator('[role=alert]').count() === 0, await delivery.locator('[role=alert]').allTextContents());
  const created = await page.evaluate(async title => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const tasks = await invoke('list_tasks');
    const state = await invoke('get_goal_state');
    return { tasks, receipt: state.conversation.receipts.find(receipt => receipt.title === title) };
  }, title);
  check(created.tasks.length === before.tasks.length + 1 && created.receipt?.taskId === created.tasks.find(task => task.title === title)?.id, 'Exact new task or execution receipt missing');
  await delivery.getByRole('button', { name: '关闭最终交付清单', exact: true }).click();
  await nav.getByRole('button', { name: '工具', exact: true }).click();
  await page.getByRole('navigation', { name: '工作区导航' }).getByRole('button', { name: '计划日历', exact: true }).click();
  await page.locator('.calendar-controls').getByRole('button', { name: '今天', exact: true }).click();
  await page.locator('.day-agenda').getByText(title, { exact: true }).waitFor();
  await nav.getByRole('button', { name: '工具', exact: true }).click();
  await page.getByRole('navigation', { name: '工作区导航' }).getByRole('button', { name: '所有计划', exact: true }).click();
  await page.getByRole('button', { name: `${title}的记事本`, exact: true }).click();
  await page.locator('#task-notebook').fill('最终安装包：对话微调、日历、笔记、完成和双端同步回归。');
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await page.locator('.task-card').filter({ hasText: title }).getByRole('button', { name: '完成计划', exact: true }).click();
  const task = await page.evaluate(async title => (await window.__TAURI_INTERNALS__.invoke('list_tasks')).find(t => t.title === title), title);
  check(task?.completed_at && task.notes.startsWith('最终安装包'), 'Completion or notes lost');
  await nav.getByRole('button', { name: '今天', exact: true }).click();
  await page.locator('.mobile-settings').click();
  const settings = page.getByRole('dialog', { name: '偏好设置', exact: true });
  await settings.getByRole('button', { name: '检查更改', exact: true }).click();
  await settings.getByRole('button', { name: '确认同步并重新载入', exact: true }).waitFor();
  check(await settings.locator('.sync-conflict').count() === 0, 'Unexpected conflict; do not auto-resolve');
  await settings.getByRole('button', { name: '确认同步并重新载入', exact: true }).click();
  await settings.waitFor({ state: 'hidden' });
  const result = await page.evaluate(async task => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const actual = (await invoke('list_tasks')).find(t => t.id === task.id);
    if (JSON.stringify(actual) !== JSON.stringify(task)) throw Error('Reload changed final record');
    const status = await invoke('get_sync_status');
    if (status.pending !== 0) throw Error('Synthetic changes not synchronized');
    const result = { gate: 'final-pixel-core-and-sync', task, status, at: new Date().toISOString() };
    localStorage.setItem('oceanseo.qa.final-workflow', JSON.stringify(result));
    return result;
  }, task);
  return result;
}
