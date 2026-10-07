// Production chunk failure; isolated browser storage only, no native data.
async (page) => {
  const check = (value, message) => { if (!value) throw Error(message); };
  await page.goto(new URL('/', page.url()).href);
  check(!(await page.evaluate(() => !!window.__TAURI_INTERNALS__)), 'Refusing native data');
  const tasks = await page.evaluate(() => localStorage.getItem('tideplan.tasks.v1'));
  const tools = page.getByRole('navigation', { name: '工作区导航' });
  const pattern = '**/BeadStudio-*.js';
  await page.route(pattern, route => route.abort());
  try {
    await tools.getByRole('button', { name: '拼豆图纸', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '这个页面暂时无法打开' }).waitFor();
    await tools.getByRole('button', { name: '所有计划', exact: true }).click();
    await page.locator('.board').waitFor();
    check(await page.evaluate(() => localStorage.getItem('tideplan.tasks.v1')) === tasks, 'Chunk failure changed task data');
    check(!(await page.getByRole('alert').filter({ hasText: '这个页面暂时无法打开' }).count()), 'Boundary did not reset on navigation');
    return { passed: true, actualNative: false, failedChunk: 'BeadStudio', navigationRecovery: true, storedTasksUnchanged: true };
  } finally {
    await page.unroute(pattern);
  }
}
