async (page) => {
  const check = (value, message) => { if (!value) throw Error(message); };
  const path = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:path|resolve_directory', { directory: 14 }));
  check(path.endsWith('/com.tideplan.mobile.uiuxqa'), 'Refusing daily package');
  const nav = page.getByRole('navigation', { name: '手机主导航' });
  const tools = page.getByRole('navigation', { name: '工作区导航' });
  const sizes = [];
  for (const name of ['人物档案', '训练计划', '旅行规划', '采购清单', '主机与服务', 'AI 食谱', '计划日历']) {
    await nav.getByRole('button', { name: '工具', exact: true }).click();
    await tools.getByRole('button', { name, exact: true }).click();
    const size = await page.evaluate(() => ({
      width: innerWidth, height: innerHeight,
      pageWidth: document.documentElement.scrollWidth,
      workspaceWidth: document.querySelector('.workspace').scrollWidth,
      workspaceClientWidth: document.querySelector('.workspace').clientWidth,
    }));
    check(size.pageWidth <= size.width && size.workspaceWidth <= size.workspaceClientWidth + 1, `${name} overflow`);
    sizes.push({ name, ...size });
  }
  await page.getByRole('spinbutton', { name: '跳转年份', exact: true }).fill('2032');
  await page.getByRole('spinbutton', { name: '跳转年份', exact: true }).press('Enter');
  await page.getByRole('button', { name: '上一年', exact: true }).click();
  check(await page.getByRole('spinbutton', { name: '跳转年份', exact: true }).inputValue() === '2031', 'Native calendar year failed');
  await page.locator('.calendar-controls').getByRole('button', { name: '今天', exact: true }).click();
  const summary = await page.evaluate(async () => {
    const tasks = await window.__TAURI_INTERNALS__.invoke('list_tasks');
    const expected = JSON.parse(localStorage.getItem('oceanseo.qa.before-file-restore'));
    if (JSON.stringify(tasks) !== JSON.stringify(expected)) throw Error('APK reinstall changed native task data');
    const ai = await window.__TAURI_INTERNALS__.invoke('test_ai_connection');
    if (!ai.includes('连接成功')) throw Error('Android encrypted AI configuration did not survive upgrade');
    return { tasks: tasks.length, encryptedAiConfigSurvived: true };
  });
  return { gate: 'physical-native-tools-calendar-and-reinstall', sizes, ...summary };
}
