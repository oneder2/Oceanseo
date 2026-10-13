// Run with playwright-cli run-code --filename. Mounts the real component with
// synthetic content only; does not fake IPC authorization or change app storage.
async (page) => {
  await page.reload();
  await page.evaluate(async () => {
    const ReactModule = await import('/node_modules/.vite/deps/react.js');
    const React = ReactModule.createElement ? ReactModule : ReactModule.default;
    const ReactDOM = await import('/node_modules/.vite/deps/react-dom_client.js');
    const createRoot = ReactDOM.createRoot ?? ReactDOM.default.createRoot;
    const { default: DataArchive } = await import('/src/modules/DataArchive.tsx');
    const host = document.createElement('div');
    host.id = 'archive-qa-fixture';
    document.body.append(host);
    const root = createRoot(host);
    const launcher = document.createElement('button');
    launcher.textContent = '资料验收入口';
    host.before(launcher);
    launcher.focus();
    window.__archiveQA = { closed: 0, exported: 0, workExported: 0 };
    const snapshot = {
      schemaVersion: '1.0.0', createdAt: new Date().toISOString(),
      tasks: Array.from({length: 35}, (_, i) => ({id: `qa-${i}`, title: `第 ${i+1} 条已有计划`, notes: '长笔记\n' + '记录想法与后续步骤，'.repeat(40) + 'https://example.invalid/' + 'a'.repeat(200), horizon: 'short', completed: false})),
      appState: {
        'tideplan.goals.v1': {goals: [{title: '已有目标', notes: '<script>仅作为文字显示</script>'}]},
        'tideplan.countdowns.v1': [{title: '关键日期', targetDate: '2026-12-01'}],
        'tideplan.life.v1': {people: [{name: '合成资料', hobbies: ['拼豆']}], training: [], workouts: [], trips: []},
        'tideplan.meal-plan.v1': {weekSummary: '合成食谱', days: [{breakfast: '燕麦', lunch: '蔬菜', dinner: '米饭'}]},
        'tideplan.purchase-list.v1': [{name: '燕麦', amount: '1袋'}],
        'tideplan.infrastructure.v1': {hosts: [{name: '合成主机', description: '仅本机测试内容'}]},
        'tideplan.bead-pattern.v1': {version: 1, title: '只读图纸', width: 160, height: 160, palette: [{hex:'#287b6a',name:'青绿色'}], cells: Array.from({length:25600},(_,i)=>i%7?0:-1)},
      },
    };
    snapshot.tasks[1].title = 'normal';
    snapshot.tasks[1].notes = 'local';
    snapshot.tasks[1].origin = {kind:'local',label:'手动录入',reference:null};
    const mount = () => root.render(React.createElement(DataArchive, {
      snapshot, exporting: false,
      workArchive: {workArchiveVersion:1, createdAt:new Date().toISOString(), tables:{reports:Array.from({length:45},(_,i)=>({weekly_summary:`第 ${i+1} 份总结`,feedback:'检查历史内容',project_analysis_json:[{name:'合成项目',notes:'https://example.invalid/'+'b'.repeat(200)}]}))}},
      onClose: () => { window.__archiveQA.closed++; root.render(null); },
      onExport: () => { window.__archiveQA.exported++; },
      onExportWork: () => { window.__archiveQA.workExported++; },
    }));
    launcher.onclick = mount;
    mount();
  });
  await page.getByRole('dialog', {name:'已有资料一直在这里'}).waitFor();
  const results = [];
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({width, height: width < 640 ? 844 : 1000});
    for (const category of ['任务与记事本', '拼豆图纸', '工作观察']) {
      await page.getByRole('navigation', {name:'已有资料分类'}).getByRole('button', {name:category, exact:true}).click();
      const stats = await page.locator('.data-archive').evaluate(el => {
        const reader = el.querySelector('.archive-reader');
        const buttons = [...el.querySelectorAll('button')];
        const box = el.getBoundingClientRect();
        return {
          dialogFits: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
          noReaderOverflow: reader.scrollWidth <= reader.clientWidth + 1,
          fontSize: parseFloat(getComputedStyle(reader).fontSize),
          touchTargets: buttons.every(b => b.getBoundingClientRect().height >= 44),
          fixedControlsWithinDialog: [...el.querySelectorAll('header button,footer button')].every(b => { const r=b.getBoundingClientRect(); return r.top >= box.top && r.bottom <= box.bottom; }),
          editableFields: el.querySelectorAll('input,textarea,select,[contenteditable=true]').length,
        };
      });
      if (!stats.dialogFits || !stats.noReaderOverflow || stats.fontSize < 16 || !stats.touchTargets || !stats.fixedControlsWithinDialog || stats.editableFields) throw Error(JSON.stringify({width,category,stats}));
      results.push({width,category,...stats});
      await page.screenshot({path:`output/playwright/archive-${width}-${category==='拼豆图纸'?'beads':category==='工作观察'?'work':'notes'}.png`});
    }
  }
  await page.getByRole('navigation', {name:'已有资料分类'}).getByRole('button', {name:'任务与记事本', exact:true}).click();
  const literalTextPreserved = await page.locator('.archive-reader').evaluate(el => {
    const values=[...el.querySelectorAll('.archive-text')].map(node=>node.textContent);
    return values.includes('normal')&&values.includes('local')&&values.includes('本机记录')&&el.textContent.includes('记录来源')&&!el.textContent.includes('出发地');
  });
  if (!literalTextPreserved) throw Error('Enum labels changed literal user text or task provenance');
  if (await page.locator('.archive-reader > .archive-records > article').count() !== 30) throw Error('Pagination not bounded');
  await page.getByRole('button', {name:'继续查看（还有 5 条）'}).click();
  if (await page.locator('.archive-reader > .archive-records > article').count() !== 35) throw Error('Pagination lost records');
  await page.getByRole('button', {name:'导出备份',exact:true}).click();
  await page.getByRole('navigation', {name:'已有资料分类'}).getByRole('button', {name:'工作观察', exact:true}).click();
  await page.getByRole('button', {name:'导出工作历史',exact:true}).click();
  await page.keyboard.press('Tab');
  if (await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')) !== '关闭已有资料') throw Error('Forward focus escaped');
  await page.keyboard.press('Shift+Tab');
  if (await page.evaluate(()=>document.activeElement?.textContent) !== '导出工作历史') throw Error('Reverse focus escaped');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', {name:'已有资料一直在这里'}).waitFor({state:'detached'});
  await page.getByRole('button', {name:'资料验收入口'}).waitFor();
  await page.waitForFunction(()=>document.activeElement?.textContent === '资料验收入口');
  const state = await page.evaluate(()=>({ ...window.__archiveQA, focusRestored: document.activeElement?.textContent === '资料验收入口'}));
  if (state.closed !== 1 || state.exported !== 1 || state.workExported !== 1 || !state.focusRestored) throw Error(JSON.stringify(state));
  return {passed:true, syntheticComponentOnly:true, actualNative:false, samples:results, literalTextPreserved, pagination:true, focusTrap:true, escape:true, ...state};
}
