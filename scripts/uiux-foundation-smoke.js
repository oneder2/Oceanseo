// Run with playwright-cli against an isolated Vite session. No native or paid AI calls.
async (page) => {
  const check = (value, message) => { if (!value) throw Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('/', page.url()).href);
  await page.setViewportSize({ width: 1440, height: 960 });
  const tools = page.getByRole('navigation', { name: '工作区导航' });
  await tools.getByRole('button', { name: '总览', exact: true }).click();
  await page.screenshot({ path: 'output/playwright/oceanseo-overview-desktop.png', animations: 'disabled' });
  await tools.getByRole('textbox', { name: '搜索工具' }).fill('训练');
  check(await tools.getByRole('button', { name: '训练计划', exact: true }).count() === 1, 'Tool search missing match');
  check(await tools.getByRole('button', { name: '旅行规划', exact: true }).count() === 0, 'Tool search did not filter');
  await tools.getByRole('button', { name: '清除工具搜索' }).click();

  await page.evaluate(async () => {
    const { platform } = await import('/src/platform.ts');
    Object.assign(platform, { name: 'android', mobile: true, desktop: false, workMonitor: false });
    document.documentElement.dataset.platform = 'android';
  });
  await tools.getByRole('button', { name: '想法与目标', exact: true }).click();
  const navigation = page.getByRole('navigation', { name: '手机主导航' });
  async function navigate(name) {
    await navigation.getByRole('button', { name: '工具', exact: true }).click();
    await page.getByRole('dialog', { name: '工具导航' }).waitFor();
    await tools.getByRole('button', { name, exact: true }).click();
  }
  async function noOverflow(label) {
    check(await page.locator('.workspace').evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${label}: workspace overflow`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: viewport overflow`);
  }
  const today = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await navigate('计划日历');
    await page.locator('.calendar-controls').getByRole('button', { name: '今天', exact: true }).click();
    check(await page.locator('.calendar-grid').evaluate(element => element.scrollWidth <= element.clientWidth), `Calendar grid overflow at ${width}`);
    check(await page.locator('.weekday').count() === 7, 'Not a full week');
    if (width < 760) {
      const sizes = await page.locator('.day-number').evaluateAll(elements => elements.map(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
      check(sizes.every(size => size.width >= 44 && size.height >= 44), `Small calendar target at ${width}`);
    }
    await noOverflow(`calendar ${width}`);
    await page.screenshot({ path: `output/playwright/oceanseo-calendar-${width}.png`, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole('spinbutton', { name: '跳转年份' }).fill('2032');
  await page.getByRole('spinbutton', { name: '跳转年份' }).press('Enter');
  await page.getByRole('button', { name: '上一年' }).click();
  check(await page.getByRole('spinbutton', { name: '跳转年份' }).inputValue() === '2031', 'Year navigation failed');
  await page.getByRole('button', { name: '添加计划', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '记下想完成的事' });
  const title = editor.getByRole('textbox', { name: '计划名称' });
  check(await title.evaluate(element => element === document.activeElement), 'Editor initial focus missing');
  const taskTitle = `界面验收：很长的事项名称仍然可以完整阅读，并在手机上记录笔记与完成进度 ${Date.now()}`;
  await title.fill(taskTitle);
  await editor.getByRole('button', { name: '保存计划', exact: true }).focus();
  await page.keyboard.press('Tab');
  check(await editor.getByRole('button', { name: '关闭', exact: true }).evaluate(element => element === document.activeElement), 'Editor focus escaped');
  await page.keyboard.press('Shift+Tab');
  check(await editor.getByRole('button', { name: '保存计划', exact: true }).evaluate(element => element === document.activeElement), 'Reverse focus escaped');
  const trigger = editor.getByRole('button', { name: /截止日期：/ });
  await trigger.click();
  const picker = page.getByRole('dialog', { name: '截止日期选择器' });
  await picker.getByRole('button', { name: '今天', exact: true }).focus();
  await page.keyboard.press('Tab');
  check(await picker.evaluate(element => element.contains(document.activeElement)), 'Date picker focus escaped');
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'hidden' });
  check(await editor.count() === 1, 'Escape closed the enclosing editor');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('截止日期：'));
  check(await trigger.evaluate(element => element === document.activeElement), 'Date trigger focus missing');
  await trigger.click();
  await picker.getByRole('button', { name: '今天', exact: true }).click();
  await editor.getByRole('button', { name: '保存计划', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  await page.locator('.calendar-controls').getByRole('button', { name: '今天', exact: true }).click();
  await page.getByRole('button', { name: `选择${today}`, exact: true }).click();
  await page.locator('.day-agenda').getByText(taskTitle, { exact: true }).first().waitFor();
  await navigate('所有计划');
  await page.getByRole('button', { name: `${taskTitle}的记事本`, exact: true }).click();
  const notebook = page.getByRole('dialog', { name: taskTitle, exact: true });
  await notebook.getByRole('textbox').fill('本次只使用合成验收记录，不读取个人资料。');
  await page.screenshot({ path: 'output/playwright/oceanseo-notebook-320.png', animations: 'disabled' });
  await notebook.getByRole('button', { name: '保存笔记', exact: true }).click();
  await notebook.waitFor({ state: 'hidden' });
  const card = page.locator('.task-card').filter({ hasText: taskTitle });
  await card.getByRole('button', { name: '完成计划', exact: true }).click();
  await navigate('完成记录');
  await page.getByRole('button', { name: `${taskTitle}的记事本`, exact: true }).waitFor();

  for (const name of ['训练计划', '旅行规划', '采购清单', '主机与服务', 'AI 食谱', '人物档案']) {
    await navigate(name);
    await noOverflow(name);
    await page.screenshot({ path: `output/playwright/oceanseo-tool-${name}-320.png`, animations: 'disabled' });
  }
  await navigation.getByRole('button', { name: '工具', exact: true }).click();
  check(await tools.getByRole('textbox', { name: '搜索工具' }).isVisible(), 'Tools search hidden on reopening');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: '工具导航' }).waitFor({ state: 'hidden' });
  await page.locator('.mobile-settings').click();
  const settings = page.getByRole('dialog', { name: '偏好设置' });
  await page.setViewportSize({ width: 320, height: 430 });
  await page.screenshot({ path: 'output/playwright/oceanseo-settings-short.png', animations: 'disabled' });
  check(await page.evaluate(() => window.__tideplanBack?.()), 'Native back did not consume settings');
  await settings.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 390, height: 844 });
  await navigation.getByRole('button', { name: '助手', exact: true }).click();
  await page.getByRole('button', { name: '查看理解图', exact: true }).click();
  const map = page.getByRole('dialog', { name: '理解图', exact: true });
  check(await map.locator('input,textarea,select,[contenteditable="true"]').count() === 0, 'Understanding map is editable');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '打开交付清单', exact: true }).click();
  const delivery = page.getByRole('dialog', { name: '最终交付清单', exact: true });
  check(await delivery.evaluate(element => Math.abs(element.getBoundingClientRect().width - innerWidth) <= 1), 'Mobile delivery is not full width');
  await page.screenshot({ path: 'output/playwright/oceanseo-delivery-mobile.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '打开交付清单', exact: true }).click();
  check(await delivery.evaluate(element => Number.parseFloat(getComputedStyle(element).animationDuration) <= .001), 'Reduced motion ignored');
  await page.keyboard.press('Escape');
  for (const viewport of [{ width: 320, height: 430 }, { width: 844, height: 344 }]) {
    await page.setViewportSize(viewport);
    await navigation.getByRole('button', { name: '助手', exact: true }).click();
    await page.getByRole('textbox', { name: '给小汐的消息' }).fill('短屏仍能查看对话，并继续输入补充。');
    const geometry = await page.evaluate(() => {
      const thread = document.querySelector('.gc-thread').getBoundingClientRect();
      const composer = document.querySelector('.gc-composer').getBoundingClientRect();
      const nav = document.querySelector('.mobile-nav').getBoundingClientRect();
      return { thread: thread.height, composerBottom: composer.bottom, navTop: nav.top };
    });
    check(geometry.thread >= 64 && geometry.composerBottom <= geometry.navTop + 1, `Short chat obscured: ${JSON.stringify(geometry)}`);
    await navigation.getByRole('button', { name: '工具', exact: true }).click();
    await page.getByRole('dialog', { name: '工具导航' }).waitFor();
    await page.keyboard.press('Escape');
    await noOverflow(`short chat ${viewport.width}`);
    await page.screenshot({ path: `output/playwright/oceanseo-chat-short-${viewport.width}.png`, animations: 'disabled' });
  }
  check(errors.length === 0, errors.join('\n'));
}
