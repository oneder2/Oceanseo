// Run in a NEW isolated playwright-cli session on the built preview server.
// The two operation cards below are explicit test fixtures, not live AI output.
// playwright-cli -s=assistant-smoke run-code "$(cat scripts/assistant-smoke.js)"
async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = (value, label) => { if (!value) throw Error(label); };
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: '打开小汐助手' }).click();
  await page.screenshot({ path: 'output/playwright/assistant-welcome.png', animations: 'disabled' });
  await page.getByRole('button', { name: '助手设置' }).click();
  await page.getByRole('textbox', { name: '怎么称呼我' }).fill('汐汐');
  await page.getByRole('textbox', { name: '希望我记住的偏好' }).fill('周日晚上复盘，每天只安排三件重要的事。');
  await page.getByRole('combobox', { name: '精灵配色' }).selectOption('sunset');
  await page.getByRole('checkbox', { name: '日历安排', exact: true }).uncheck();
  await page.getByRole('button', { name: '返回对话' }).click();
  await page.getByRole('textbox', { name: '给助手的消息' }).fill('帮我整理今天的安排');
  await page.reload();
  await page.getByRole('button', { name: '打开汐汐助手' }).click();
  check(await page.getByRole('textbox', { name: '给助手的消息' }).inputValue() === '帮我整理今天的安排', 'Draft lost');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '浏览器预览不连接 AI' }).waitFor();
  await page.setViewportSize({ width: 620, height: 560 });
  await page.screenshot({ path: 'output/playwright/assistant-narrow.png', animations: 'disabled' });
  const panel = await page.getByRole('dialog', { name: '汐汐 · 潮汐助手' }).boundingBox();
  check(panel && panel.x >= 0 && panel.x + panel.width <= 620 && panel.y + panel.height <= 560, 'Panel outside small viewport');
  await page.getByRole('textbox', { name: '给助手的消息' }).press('Escape');
  check(await page.getByRole('button', { name: '打开汐汐助手' }).evaluate(el => el === document.activeElement), 'Close lost keyboard focus');
  await page.evaluate(() => {
    const key = 'tideplan.assistant.v1';
    const state = JSON.parse(localStorage.getItem(key));
    state.draft = '';
    state.messages = [{ id: 'fixture-message', role: 'assistant', content: '测试操作卡：请检查这份发布计划，再决定是否保存。', createdAt: new Date().toISOString(), reads: ['tasks'], actions: [
      { id: 'fixture-task', type: 'task_draft', status: 'pending', draft: { title: '助手交接验收计划', notes: '先核对范围，再进行发布检查。', horizon: 'short', priority: 'important', startDate: '2026-09-18', dueDate: '2026-09-21' } },
      { id: 'fixture-page', type: 'navigate', view: 'calendar', status: 'pending' }
    ] }];
    localStorage.setItem(key, JSON.stringify(state));
    localStorage.setItem('tideplan.draft.task:new', JSON.stringify({ title:'应保留的旧草稿',notes:'',horizon:'short',priority:'normal',startDate:'',dueDate:'' }));
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await page.getByRole('button', { name: '打开汐汐助手' }).click();
  await page.getByRole('button', { name: '打开草稿检查并保存' }).click();
  await page.getByRole('alert').filter({ hasText: '已有未完成草稿' }).waitFor();
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('tideplan.draft.task:new')).title) === '应保留的旧草稿', 'Existing draft overwritten');
  // Remove only our fixture draft after the preservation assertion.
  await page.evaluate(() => localStorage.removeItem('tideplan.draft.task:new'));
  await page.getByRole('button', { name: '打开草稿检查并保存' }).click();
  check(await page.getByPlaceholder('例如：整理本周工作重点').inputValue() === '助手交接验收计划', 'Task handoff lost title');
  await page.getByRole('button', { name: '保存计划', exact: true }).click();
  await page.getByRole('navigation', { name: '工作区导航' }).getByRole('button', { name: '所有计划', exact: true }).click();
  await page.getByRole('button', { name: '助手交接验收计划的记事本', exact: true }).waitFor();
  await page.getByRole('button', { name: '打开汐汐助手' }).click();
  check(await page.getByRole('button', { name: '打开草稿检查并保存' }).count() === 0, 'Consumed action offered twice');
  check(await page.getByRole('alert').filter({ hasText: '已有未完成草稿' }).count() === 0, 'Successful handoff retained stale error');
  await page.screenshot({ path: 'output/playwright/assistant-action-handoff.png', animations: 'disabled' });
  await page.getByRole('button', { name: '打开这个页面' }).click();
  await page.getByRole('heading', { name: '计划日历', exact: true }).waitFor();
  await page.getByRole('button', { name: '打开汐汐助手' }).click();
  await page.getByRole('button', { name: '助手设置' }).click();
  check(await page.getByRole('textbox', { name: '希望我记住的偏好' }).inputValue() === '周日晚上复盘，每天只安排三件重要的事。', 'Preference lost');
  await page.getByRole('button', { name: '清空对话', exact: true }).click();
  await page.getByRole('button', { name: '确认清空', exact: true }).click();
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('tideplan.assistant.v1')).messages.length) === 0, 'Conversation not cleared');
  check(errors.length === 0, errors.join('\n'));
}
