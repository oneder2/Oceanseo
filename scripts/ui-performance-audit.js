// Production browser benchmark. No AI, native IPC or server load is measured.
async (page) => {
  const check = (value, message) => { if (!value) throw Error(message); };
  const origin = new URL(page.url()).origin;
  const evidence = { actualNative: false, actualAI: false, build: 'production preview', samples: [], budgets: { warmNavigationP95Ms: 250 } };
  const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const taskCount of [60, 1000]) {
    await page.goto(origin);
    await page.getByRole('navigation', { name: '工作区导航' }).waitFor();
    await page.evaluate(taskCount => {
      if (window.__TAURI_INTERNALS__) throw Error('Refusing native data');
      const at = new Date().toISOString(), date = at.slice(0, 10);
      localStorage.setItem('tideplan.tasks.v1', JSON.stringify(Array.from({ length: taskCount }, (_, i) => ({
        id: `perf-${i}`, title: `合成性能事项 ${i}`, notes: '性能测试不读取个人数据。', horizon: ['short', 'mid', 'long'][i % 3], priority: 'normal',
        startDate: date, dueDate: date, createdAt: at, updatedAt: at, completedAt: null, origin: null,
      }))));
    }, taskCount);
    await page.reload();
    const tools = page.getByRole('navigation', { name: '工作区导航' });
    await tools.getByRole('button', { name: '所有计划', exact: true }).click();
    const expectedInitialCards = Math.min(taskCount, 3 * 30);
    await page.waitForFunction(expected => document.querySelectorAll('.task-card').length === expected, expectedInitialCards);
    const samples = [];
    for (let round = 0; round < 11; round++) {
      for (const [name, heading] of [['所有计划', '所有计划'], ['计划日历', '计划日历']]) {
        await page.evaluate(heading => {
          window.__navigationPerf = new Promise(resolve => {
            let start, frames = 0;
            const onClick = () => {
              start = performance.now();
              const paint = () => {
                const ready = document.querySelector('.workspace-head h1')?.textContent === heading && !document.querySelector('[data-page-loading]');
                if (ready) frames++;
                if (frames >= 2) resolve(performance.now() - start);
                else if (performance.now() - start > 10000) resolve(null);
                else requestAnimationFrame(paint);
              };
              requestAnimationFrame(paint);
            };
            document.addEventListener('click', onClick, { capture: true, once: true });
          });
        }, heading);
        await tools.getByRole('button', { name, exact: true }).click();
        const ms = await page.evaluate(() => window.__navigationPerf);
        check(ms !== null, 'Navigation render timed out');
        if (round) samples.push({ name, ms });
      }
    }
    evidence.samples.push({ taskCount, renderedTasks: expectedInitialCards, renderedTasksVerified: true,
      navigation: ['所有计划', '计划日历'].map(name => ({ name, rounds: 10, p95Ms: p95(samples.filter(s => s.name === name).map(s => s.ms)) })), samples });
  }
  evidence.scope = 'Warm click-to-two-paints in desktop Chromium; excludes cold start, Android, storage, AI and network';
  await page.evaluate(evidence => { window.__performanceAuditEvidence = evidence; }, evidence);
  return evidence.samples.map(s => ({ taskCount: s.taskCount, navigation: s.navigation }));
}
