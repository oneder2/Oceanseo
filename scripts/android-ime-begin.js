// Pixel .uiuxqa only. Follow with one real Android BACK key, then ime-verify.
async (page) => {
  const native = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:path|resolve_directory', { directory: 14 }));
  if (!native.endsWith('/com.tideplan.mobile.uiuxqa')) throw Error('Refusing daily package');
  await page.reload();
  await page.getByRole('button', { name: '添加计划', exact: true }).click();
  const input = page.getByRole('textbox', { name: '计划名称', exact: true });
  await input.fill('Pixel 原生键盘返回验收');
  await input.click();
  return page.evaluate(() => ({
    gate: 'native-ime-open-editor', height: innerHeight,
    title: document.querySelector('#editor-title')?.textContent,
    active: document.activeElement?.tagName,
  }));
}
