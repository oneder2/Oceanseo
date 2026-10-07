// ONLY emulator-5580: same temporary userdata, upgraded public .debug package.
async (page) => {
  const check = (value, message) => { if (!value) throw Error(message); };
  const data = await page.evaluate(async () => ({
    version: await window.__TAURI_INTERNALS__.invoke('plugin:app|version'),
    path: await window.__TAURI_INTERNALS__.invoke('plugin:path|resolve_directory', { directory: 14 }),
    tasks: await window.__TAURI_INTERNALS__.invoke('list_tasks'),
    baseline: JSON.parse(localStorage.getItem('oceanseo.qa.android-upgrade') || 'null'),
  }));
  check(data.version === '0.18.0' && data.path.endsWith('/com.tideplan.mobile.debug') && data.baseline, 'Incorrect emulator upgrade');
  check(JSON.stringify(data.tasks) === JSON.stringify(data.baseline.tasks), 'Upgrade changed task fields or stable ID');
  const nav = page.getByRole('navigation', { name: '手机主导航' });
  await nav.getByRole('button', { name: '工具', exact: true }).click();
  await page.getByRole('navigation', { name: '工作区导航' }).getByRole('button', { name: '所有计划', exact: true }).click();
  await page.getByRole('button', { name: 'Android 旧版升级验收的记事本', exact: true }).click();
  check(await page.locator('#task-notebook').inputValue() === data.baseline.draft, 'Native draft not preserved');
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  const result = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const backup = await invoke('export_data_backup');
    if (backup.tasks[0].notes !== '升级前未提交的笔记草稿。') throw Error('Draft save failed');
    await invoke('create_task', { mutation: { title: '隔离备份恢复探针', notes: '', horizon: 'short', priority: 'normal', startDate: null, dueDate: null } });
    if ((await invoke('list_tasks')).length !== 2) throw Error('Probe missing');
    const snapshot = await invoke('restore_data_backup', { backup });
    const restored = await invoke('list_tasks');
    if (JSON.stringify(restored) !== JSON.stringify(backup.tasks)) throw Error('Native restore changed records');
    return { gate: 'android-017-to-018-upgrade', taskId: restored[0].id, draftPreserved: true, coreBackupRestore: true, snapshot };
  });
  await page.reload();
  check((await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_tasks'))).length === 1, 'Restore not durable');
  return result;
}
