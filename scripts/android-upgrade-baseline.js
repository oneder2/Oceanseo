// ONLY on emulator-5580 with its temporary userdata and CDP forward 9259.
async (page) => {
  const check = (value, message) => { if (!value) throw Error(message); };
  const native = await page.evaluate(async () => ({
    version: await window.__TAURI_INTERNALS__.invoke('plugin:app|version'),
    path: await window.__TAURI_INTERNALS__.invoke('plugin:path|resolve_directory', { directory: 14 }),
    tasks: await window.__TAURI_INTERNALS__.invoke('list_tasks'),
  }));
  check(native.version === '0.17.0' && native.path.endsWith('/com.tideplan.mobile.debug') && native.tasks.length === 0, 'Refusing nonempty or incorrect baseline');
  const nav = page.getByRole('navigation', { name: '手机主导航' });
  await nav.getByRole('button', { name: '工具', exact: true }).click();
  await page.getByRole('navigation', { name: '工作区导航' }).getByRole('button', { name: '所有计划', exact: true }).click();
  await page.getByRole('button', { name: '新计划', exact: true }).click();
  const title = 'Android 旧版升级验收';
  await page.getByRole('textbox', { name: '计划名称', exact: true }).fill(title);
  await page.getByRole('button', { name: /截止日期：/ }).click();
  await page.getByRole('dialog', { name: '截止日期选择器' }).getByRole('button', { name: '今天', exact: true }).click();
  await page.getByRole('button', { name: '保存计划', exact: true }).click();
  await page.getByRole('button', { name: `${title}的记事本`, exact: true }).click();
  await page.locator('#task-notebook').fill('0.17.0 真实 APK 保存的笔记。');
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await page.getByRole('button', { name: `${title}的记事本`, exact: true }).click();
  const draft = '升级前未提交的笔记草稿。';
  await page.locator('#task-notebook').fill(draft);
  await page.getByRole('button', { name: '关闭记事本', exact: true }).click();
  return page.evaluate(async ({ draft }) => {
    const tasks = await window.__TAURI_INTERNALS__.invoke('list_tasks');
    const evidence = { tasks, draft, backup: await window.__TAURI_INTERNALS__.invoke('export_data_backup') };
    localStorage.setItem('oceanseo.qa.android-upgrade', JSON.stringify(evidence));
    return { gate: 'android-017-real-apk-baseline', tasks };
  }, { draft });
}
