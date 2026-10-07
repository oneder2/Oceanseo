// Isolated browser fixtures only. This is not native Android or paid AI evidence.
async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('/', page.url()).href);
  await page.getByRole('navigation', { name: '工作区导航' }).waitFor();
  await page.evaluate(async () => {
    if (window.__TAURI_INTERNALS__) throw Error('Refusing native data');
    const { replacePreviewTasks } = await import('/src/taskStore.ts');
    const { saveMealPlan, savePurchaseItems, createPurchaseItem } = await import('/src/shoppingStore.ts');
    const { saveCountdowns } = await import('/src/countdownStore.ts');
    const today = new Date().toISOString().slice(0, 10), at = new Date().toISOString();
    replacePreviewTasks(Array.from({ length: 60 }, (_, index) => ({
      id: `quality-${index}`, schemaVersion: '1.0.0', title: index % 10 === 0
        ? '一项名称较长的计划：整理最近的项目、完成训练并安排周末生活，让事项保持完整可读'
        : `合成计划 ${index + 1}`, notes: '测试笔记：保留完整说明与日期，不是真实个人记录。',
      horizon: ['short', 'mid', 'long'][index % 3], priority: index % 3 ? 'normal' : 'important',
      startDate: today, dueDate: today, createdAt: at, updatedAt: at, completedAt: index % 4 ? null : at, origin: null,
    })));
    saveMealPlan({ planTitle: '一周合成菜单', weekSummary: '用于检查食谱文字与采购排版，不调用模型。',
      days: Array.from({ length: 7 }, (_, dayIndex) => ({ dayIndex, weekday: `第 ${dayIndex + 1} 天`,
        breakfast: { name: '牛奶燕麦粥与水煮蛋', note: '按个人需求调整份量，准备新鲜水果。' },
        lunch: { name: '番茄土豆炖牛肉、清炒西兰花与杂粮饭', note: '番茄炖软，牛肉提前处理；保留完整说明。' },
        dinner: { name: '香菇豆腐汤与清蒸鲈鱼', note: '清淡烹调，避免过多调味料。' },
      })), shoppingList: [{ category: '蔬菜水果', items: [{ name: '新鲜西兰花与番茄（食谱自动来源）', amount: '西兰花 800 克、番茄 1 千克' }] }] });
    savePurchaseItems([createPurchaseItem({ name: '一项较长的采购名称：无糖酸奶和低脂牛奶', amount: '无糖酸奶 6 杯，牛奶 2 升', category: '乳品豆制品' })]);
    saveCountdowns([{ id: 'quality-date', title: '跨越五位数的关键日期测试', targetDate: '2400-01-01', notes: '长数字不能省略', createdAt: at, updatedAt: at }]);
  });
  await page.reload();
  const evidence = { actualNative: false, actualAI: false, datasetTasks: 60, errors, samples: [] };
  const names = ['总览', '所有计划', '完成记录', '计划日历', '关键日期', '想法与目标', '人物档案', '训练计划', '旅行规划', 'AI 食谱', '采购清单', '主机与服务'];
  const matrix = [
    { width: 1440, height: 900, mobile: false },
    { width: 960, height: 720, mobile: false },
    { width: 320, height: 740, mobile: true },
    { width: 390, height: 844, mobile: true },
    { width: 768, height: 1024, mobile: true },
    { width: 844, height: 390, mobile: true },
  ];
  for (const viewport of matrix) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(async mobile => {
      const { platform } = await import('/src/platform.ts');
      Object.assign(platform, { name: mobile ? 'android' : 'browser', mobile, desktop: !mobile, workMonitor: !mobile });
      document.documentElement.dataset.platform = mobile ? 'android' : 'browser';
    }, viewport.mobile);
    // Trigger a render after changing the simulated platform.
    await page.getByRole('navigation', { name: '工作区导航' }).getByRole('button', { name: '总览', exact: true }).evaluate(el => el.click());
    for (const name of names) {
      if (viewport.mobile) await page.getByRole('navigation', { name: '手机主导航' }).getByRole('button', { name: '工具', exact: true }).click();
      const before = await page.evaluate(() => performance.now());
      await page.getByRole('navigation', { name: '工作区导航' }).getByRole('button', { name, exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.workspace [data-page-loading]'));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const measurement = await page.evaluate(before => {
        const workspace = document.querySelector('.workspace');
        const visible = element => {
          const r = element.getBoundingClientRect(), css = getComputedStyle(element);
          return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && css.visibility !== 'hidden' && !element.closest('[inert],.sr-only');
        };
        const text = [...workspace.querySelectorAll('*')].filter(el => visible(el) && [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim()));
        const smallText = text.filter(el => parseFloat(getComputedStyle(el).fontSize) < 12).map(el => ({ tag: el.tagName, className: el.className, text: el.textContent.slice(0, 65), size: getComputedStyle(el).fontSize }));
        const narrowTargets = [...document.querySelectorAll('button,input:not([type="checkbox"]):not([type="radio"]),select')]
          .filter(visible).filter(el => el.getBoundingClientRect().height < 43)
          .map(el => ({ label: el.getAttribute('aria-label') || el.textContent.slice(0, 40), className: el.className, height: el.getBoundingClientRect().height }));
        const clipped = text.filter(el => getComputedStyle(el).overflowY === 'hidden' && el.scrollHeight > el.clientHeight + 3 && !['task-notes'].includes(el.className))
          .map(el => ({ className: el.className, text: el.textContent.slice(0, 65) }));
        return { width: innerWidth, workspaceClient: workspace.clientWidth, workspaceScroll: workspace.scrollWidth,
          documentWidth: document.documentElement.scrollWidth, smallText, narrowTargets, clipped, clickToSettledMs: performance.now() - before };
      }, before);
      evidence.samples.push({ name, ...viewport, ...measurement });
      if (['总览', '所有计划', 'AI 食谱', '采购清单', '想法与目标'].includes(name) && [1440, 320, 844].includes(viewport.width)) {
        await page.screenshot({ path: `output/playwright/quality-${viewport.width}-${name}.png`, animations: 'disabled' });
      }
    }
  }
  await page.evaluate(evidence => { window.__uiQualityEvidence = evidence; }, evidence);
  return { samples: evidence.samples.length,
    overflow: evidence.samples.filter(s => s.workspaceScroll > s.workspaceClient + 1 || s.documentWidth > s.width + 1).map(s => ({ name: s.name, width: s.width })),
    tinyTextSamples: evidence.samples.filter(s => s.smallText.length).length, errors };
}
