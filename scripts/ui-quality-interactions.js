async (page) => {
  const check = (value, message) => { if (!value) throw Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const gates = [];
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto(new URL('/', page.url()).href);
  const tools = page.getByRole('navigation', { name: '工作区导航' });
  await tools.getByRole('button', { name: '关键日期', exact: true }).click();
  const open = page.getByRole('button', { name: '添加关键日期', exact: true });
  await open.click();
  const editor = page.getByRole('dialog', { name: '记住一个重要日子', exact: true });
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-dialog-initial'));
  await editor.getByRole('textbox', { name: '名称', exact: true }).fill('只测试焦点，不保存');
  await editor.getByRole('button', { name: '保存日期', exact: true }).focus();
  await page.keyboard.press('Tab');
  check(await editor.getByRole('button', { name: '关闭', exact: true }).evaluate(el => el === document.activeElement), 'Date editor focus escaped');
  await page.keyboard.press('Escape');
  await editor.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.textContent.includes('添加关键日期'));
  gates.push('countdown-focus-escape-and-return');
  await tools.getByRole('button', { name: '想法与目标', exact: true }).click();
  await page.getByRole('textbox', { name: '给小汐的消息' }).fill('界面巡检草稿，不发送到 AI。');
  for (const reduced of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion: reduced });
    await page.getByRole('button', { name: '打开交付清单', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '最终交付清单', exact: true });
    await panel.waitFor();
    await page.waitForFunction(() => {
      const el = document.querySelector('.goal-overlay-panel');
      return el && getComputedStyle(el).transform === 'none';
    });
    check(await panel.evaluate(el => getComputedStyle(el).filter === 'none' && parseFloat(getComputedStyle(el).opacity) === 1), 'Reading text blurred/faded');
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
  }
  gates.push('gsap-motion-cleanup-and-reduced-motion');
  await page.evaluate(async () => {
    const { platform } = await import('/src/platform.ts');
    Object.assign(platform, { name: 'android', mobile: true, desktop: false, workMonitor: false });
    document.documentElement.dataset.platform = 'android';
  });
  await tools.getByRole('button', { name: '总览', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '手机主导航' });
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await nav.getByRole('button', { name: '助手', exact: true }).click();
    await page.getByRole('button', { name: '打开交付清单', exact: true }).click();
    const delivery = page.getByRole('dialog', { name: '最终交付清单', exact: true });
    const box = await delivery.boundingBox();
    check(box && box.x >= -1 && box.x + box.width <= viewport.width + 1 && box.y >= -1 && box.y + box.height <= viewport.height + 1, 'Drawer outside viewport');
    await page.keyboard.press('Escape');
    await nav.getByRole('button', { name: '工具', exact: true }).click();
    await tools.getByRole('button', { name: '训练计划', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-page-loading]'));
    check(await page.locator('.workspace').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Training page overflows');
    // Simulate 130% text only, without zooming layout or changing system settings.
    // Native WebView fontScale must still be checked on Android separately.
    await page.evaluate(() => {
      window.__fontRestore = [...document.querySelectorAll('.workspace *')].map(el => [el, el.style.fontSize, getComputedStyle(el).fontSize]);
      for (const [el, , size] of window.__fontRestore) el.style.fontSize = `${parseFloat(size) * 1.3}px`;
    });
    check(await page.locator('.workspace').evaluate(el => el.scrollWidth <= el.clientWidth + 1), '130% text causes overflow');
    await page.screenshot({ path: `output/playwright/quality-font130-${viewport.width}.png`, animations: 'disabled' });
    await page.evaluate(() => { for (const [el, size] of window.__fontRestore) el.style.fontSize = size; delete window.__fontRestore; });
    await page.locator('.account-entry').click();
    const account = page.getByRole('dialog', { name: '我的账号', exact: true });
    await account.waitFor();
    check(!(await account.getByLabel('账号服务地址', { exact: true }).isVisible()), 'Server configuration visible by default');
    await page.keyboard.press('Escape');
    await page.locator('.mobile-settings').click();
    const settings = page.getByRole('dialog', { name: '偏好设置', exact: true });
    check(await settings.getByLabel('账号用户名', { exact: true }).count() === 0, 'Account mixed into preferences');
    check(!(await settings.getByRole('region', { name: '跨设备同步', exact: true }).isVisible()), 'Sync diagnostics visible by default');
    await page.keyboard.press('Escape');
  }
  gates.push('four-mobile-viewports-drawer-font130-settings');
  await nav.getByRole('button', { name: '助手', exact: true }).click();
  check(await page.getByRole('textbox', { name: '给小汐的消息' }).inputValue() === '界面巡检草稿，不发送到 AI。', 'Draft lost during navigation');
  gates.push('unsent-chat-draft-retained');
  check(errors.length === 0, errors.join('\n'));
  await page.evaluate(value => { window.__qualityInteractionEvidence = value; }, { gates, errors, actualNative: false, fontScale: 'browser text-only simulation, not Android' });
  return { gates, errors };
}
