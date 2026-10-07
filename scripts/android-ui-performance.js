// Final Pixel QA only. Local UI/SQLite budgets exclude network and model latency.
async (page) => {
  const check = (value, message) => { if (!value) throw Error(message); };
  const before = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const path = await invoke('plugin:path|resolve_directory', { directory: 14 });
    if (!path.endsWith('/com.tideplan.mobile.uiuxqa')) throw Error('Refusing daily package');
    const final = JSON.parse(localStorage.getItem('oceanseo.qa.final-workflow') || 'null');
    if (final?.gate !== 'final-pixel-core-and-sync') throw Error('Final workflow required');
    return { tasks: await invoke('list_tasks'), version: await invoke('plugin:app|version') };
  });
  check(before.version === '0.18.0', 'Wrong native version');
  const nav = page.getByRole('navigation', { name: '手机主导航' });
  await nav.getByRole('button', { name: '助手', exact: true }).click();
  const measurements = [];
  async function measure(button, label, selector, visible) {
    await page.evaluate(({ selector, visible }) => {
      window.__oceanseoPerf = new Promise(resolve => {
        let observer, timer, started = false;
        const finish = result => {
          clearTimeout(timer);
          observer?.disconnect();
          document.removeEventListener('click', start, true);
          resolve(result);
        };
        const start = () => {
          if (started) return;
          started = true;
          document.removeEventListener('click', start, true);
          const at = performance.now();
          let pending = false;
          const ready = () => {
            const element = document.querySelector(selector);
            const shown = !!element && element.getClientRects().length > 0;
            if (shown !== visible || pending) return;
            pending = true;
            observer.disconnect();
            requestAnimationFrame(() => requestAnimationFrame(() => finish({ ms: performance.now() - at })));
          };
          observer = new MutationObserver(ready);
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
          ready();
        };
        document.addEventListener('click', start, true);
        timer = setTimeout(() => finish({ error: 'Render measurement timed out' }), 10000);
      });
    }, { selector, visible });
    await button.click();
    const result = await page.evaluate(() => window.__oceanseoPerf);
    check(!result.error, `${label}: ${result.error}`);
    measurements.push({ label, ms: result.ms });
  }
  const mapSelector = '[role="dialog"][aria-label="理解图"]';
  const deliverySelector = '[role="dialog"][aria-label="最终交付清单"]';
  for (let round = 0; round < 10; round++) {
    await measure(page.getByRole('button', { name: '查看理解图', exact: true }), 'map-open', mapSelector, true);
    await measure(page.getByRole('button', { name: '关闭理解图', exact: true }), 'map-close', mapSelector, false);
    await measure(page.getByRole('button', { name: '打开交付清单', exact: true }), 'delivery-open', deliverySelector, true);
    await measure(page.getByRole('button', { name: '关闭最终交付清单', exact: true }), 'delivery-close', deliverySelector, false);
  }
  const storage = await page.evaluate(async () => {
    const durations = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      await window.__TAURI_INTERNALS__.invoke('list_tasks');
      durations.push(performance.now() - start);
    }
    return durations;
  });
  const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
  const uiP95 = p95(measurements.map(item => item.ms));
  const uiP95ByAction = Object.fromEntries([...new Set(measurements.map(item => item.label))]
    .map(label => [label, p95(measurements.filter(item => item.label === label).map(item => item.ms))]));
  const storageP95 = p95(storage);
  const tasks = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_tasks'));
  check(JSON.stringify(tasks) === JSON.stringify(before.tasks), 'Performance check modified tasks');
  const result = {
    gate: 'final-pixel-local-ui-performance', version: before.version, taskCount: tasks.length,
    budgets: { uiP95Ms: 250, sqliteReadP95Ms: 250 }, uiP95, uiP95ByAction, storageP95, measurements, storage,
    at: new Date().toISOString(),
  };
  await page.evaluate(result => localStorage.setItem('oceanseo.qa.performance', JSON.stringify(result)), result);
  check(Object.values(uiP95ByAction).every(ms => ms <= result.budgets.uiP95Ms) && storageP95 <= result.budgets.sqliteReadP95Ms,
    `Local performance budget exceeded: UI ${uiP95} ms, SQLite ${storageP95} ms`);
  return result;
}
