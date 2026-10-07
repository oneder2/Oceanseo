// Isolated browser origin, synthetic records only; no AI or private API calls.
async (page) => {
  await page.setViewportSize({ width:1440, height:960 });
  await page.goto('http://127.0.0.1:1439');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: '想法与目标', exact: true }).click();
  const reply = await (await page.request.get('http://127.0.0.1:1439/tests/fixtures/dialogue-reply.json')).json();
  await page.evaluate(async reply => {
    const now = new Date().toISOString();
    const { emptyGoals } = await import('/src/goals/model.ts');
    const s = emptyGoals();
    s.preferences.checkins = false;
    const p = { id: 'preview-proposal', createdAt: now, sourceIds: [], goalSnapshot: JSON.stringify({ goals:s.goals, actions:s.actions }), taskVersions: {}, status:'pending', plan:reply.plan, waiting:reply.waiting };
    s.proposals = [p];
    s.conversation = { messages:[{ id:'preview-user', role:'user', text:'这周想把发布准备做好，也想安排一次周末旅行。先帮我理清优先级。', createdAt:now }, { id:'preview-reply', role:'assistant', text:reply.reply, createdAt:now }], understanding:reply.understanding, proposalId:p.id, receipts:[], needsReply:false };
    localStorage.setItem('tideplan.goals.v1', JSON.stringify(s));
  }, reply);
  await page.reload();
  await page.evaluate(async () => {
    const { platform } = await import('/src/platform.ts');
    Object.assign(platform, { name:'android', mobile:true, desktop:false, workMonitor:false });
    document.documentElement.dataset.platform = 'android';
  });
  await page.getByRole('button', { name:'想法与目标', exact:true }).click();
  await page.setViewportSize({ width:390, height:844 });
  await page.getByRole('textbox', { name:'给小汐的消息' }).waitFor();
  await page.screenshot({ path:'output/playwright/landing-app-chat.png', animations:'disabled' });
  await page.getByRole('button', { name:'打开交付清单', exact:true }).click();
  await page.getByRole('dialog', { name:'最终交付清单', exact:true }).waitFor();
  await page.screenshot({ path:'output/playwright/landing-app-delivery.png', animations:'disabled' });
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name:'手机主导航' }).getByRole('button', { name:'工具', exact:true }).click();
  await page.getByRole('button', { name:'所有计划', exact:true }).click();
  await page.getByRole('button', { name:'新计划', exact:true }).click();
  const editor = page.getByRole('dialog', { name:'记下想完成的事' });
  await editor.getByRole('textbox', { name:'计划名称' }).fill('完成发布前验证');
  await editor.getByRole('button', { name:'截止日期：选择日期' }).click();
  await page.getByRole('dialog', { name:'截止日期选择器' }).getByRole('button', { name:'今天', exact:true }).click();
  await editor.getByRole('button', { name:'保存计划', exact:true }).click();
  await page.getByRole('navigation', { name:'手机主导航' }).getByRole('button', { name:'工具', exact:true }).click();
  await page.getByRole('button', { name:'计划日历', exact:true }).click();
  await page.locator('.calendar-scroll').evaluate(el => el.scrollLeft = el.scrollWidth);
  await page.getByText('计划已加入', { exact:true }).waitFor({ state:'hidden' });
  await page.screenshot({ path:'output/playwright/landing-app-calendar.png', animations:'disabled' });
}
