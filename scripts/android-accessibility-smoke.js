// Run against the isolated upgrade emulator, after changing its native fontScale
// or rotation with ADB. Never change the daily phone's global preferences.
async (page) => {
  const check = (value, message) => { if (!value) throw Error(message); };
  const native = await page.evaluate(async () => ({
    version: await window.__TAURI_INTERNALS__.invoke('plugin:app|version'),
    path: await window.__TAURI_INTERNALS__.invoke('plugin:path|resolve_directory', { directory: 14 }),
    baseline: localStorage.getItem('oceanseo.qa.android-upgrade'),
  }));
  check(native.version === '0.18.0' && native.path.endsWith('/com.tideplan.mobile.debug') && native.baseline,
    'Requires isolated upgrade baseline');
  const nav = page.getByRole('navigation', { name: '手机主导航' });
  const tools = page.getByRole('navigation', { name: '工作区导航' });
  const measurements = [];
  for (const name of ['所有计划', '人物档案', '训练计划', '旅行规划', '采购清单', '主机与服务', 'AI 食谱', '计划日历']) {
    await nav.getByRole('button', { name: '工具', exact: true }).click();
    await tools.getByRole('button', { name, exact: true }).click();
    const size = await page.evaluate(() => {
      const workspace = document.querySelector('.workspace');
      const header = document.querySelector('.workspace-head h1');
      const range = document.createRange();
      if (header) range.selectNodeContents(header);
      return {
        width: innerWidth, height: innerHeight,
        pageWidth: document.documentElement.scrollWidth,
        workspaceWidth: workspace.scrollWidth, workspaceClientWidth: workspace.clientWidth,
        headingHeight: header ? range.getBoundingClientRect().height : null,
      };
    });
    check(size.pageWidth <= size.width + 1 && size.workspaceWidth <= size.workspaceClientWidth + 1, `${name}: overflow ${JSON.stringify(size)}`);
    measurements.push({ name, ...size });
  }
  await nav.getByRole('button', { name: '助手', exact: true }).click();
  const composer = page.getByRole('textbox', { name: '给小汐的消息' });
  await composer.fill('系统大字体与横屏验收：保留这条草稿。');
  const box = await composer.boundingBox();
  check(box && box.width > 80 && box.height >= 40, 'Composer unusable');
  const chat = await page.evaluate(() => {
    const rect = selector => {
      const b = document.querySelector(selector).getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, height: b.height };
    };
    return { thread: rect('.gc-thread'), composer: rect('.gc-composer'), nav: rect('.mobile-nav') };
  });
  check(chat.thread.height >= 64, `Conversation hidden: ${JSON.stringify(chat)}`);
  check(chat.composer.bottom <= chat.nav.top + 1, 'Navigation covers composer');
  await nav.getByRole('button', { name: '今天', exact: true }).click();
  await page.locator('.mobile-settings').click();
  const settings = page.getByRole('dialog', { name: '偏好设置', exact: true });
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  await nav.getByRole('button', { name: '助手', exact: true }).click();
  check(await composer.inputValue() === '系统大字体与横屏验收：保留这条草稿。', 'Settings discarded chat draft');
  const result = { gate: 'native-android-font-and-rotation', measurements, composer: box, chat, at: new Date().toISOString() };
  await page.evaluate(result => localStorage.setItem('oceanseo.qa.accessibility', JSON.stringify(result)), result);
  return result;
}
