// Synthetic native bridge in a real browser. Not HTTP/SQLite/Android proof.
async (page) => {
  const check = (value, message) => { if (!value) throw Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => sessionStorage.removeItem('__autoFixture'));
  await page.addInitScript(() => {
    const profileKey = 'a'.repeat(64);
    const current = { key: profileKey, username: 'alice', endpoint: 'https://accounts.example.test', sessionId: 'synthetic-session',
      expiresAt: 4000000000, signedIn: true, active: true };
    const f = window.__autoFixture = JSON.parse(sessionStorage.getItem('__autoFixture') ?? 'null') ?? {
      enabled: true, linked: false, mode: 'ready', calls: [], tasks: [], needsSync: true, pause: null, message: null,
    };
    const prefs = () => ({ version: 1, profileKey, enabled: f.enabled, pause: f.pause, message: f.message });
    const save = () => sessionStorage.setItem('__autoFixture', JSON.stringify(f));
    const plan = () => ({ previewId: 'synthetic-preview', uploadCount: 1, downloadCount: 0,
      conflicts: f.mode === 'conflict' ? [{ key:'task:synthetic', local:{title:'同一事项',notes:'这台设备的笔记'},remote:{title:'同一事项',notes:'另一台设备的笔记'} }] : [], firstConnection: !f.linked, changes: [] });
    const mobile = { permission: false, scheduled: false, appNotifications: false, channelEnabled: true, batteryOptimized: false,
      powerSaveMode: false, nextTimes: [], timeZone: 'UTC', profileKey };
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async (command, args = {}) => {
        f.calls.push(command); save();
        if (command === 'get_runtime_platform') return 'android';
        if (command === 'get_profile_status') return { current, selectedKey: profileKey, restartRequired: false };
        if (command === 'list_local_profiles') return [current];
        if (command === 'get_automatic_sync_settings') return prefs();
        if (command === 'set_automatic_sync_enabled') {
          f.enabled = args.enabled; f.pause = null; f.message = null; save(); return prefs();
        }
        if (command === 'preview_automatic_sync') {
          if (f.mode === 'conflict') { f.pause = 'conflict'; f.message = '发现 1 项两端冲突，请检查更改并选择保留版本'; save(); }
          return { state: f.pause ? 'paused' : f.needsSync ? 'ready' : 'unchanged', settings: prefs(), plan: f.pause || !f.needsSync ? null : plan() };
        }
        if (command === 'commit_automatic_sync') { f.needsSync = false; f.linked = true; save(); return { changed: !!f.receive, revision: 2, snapshotPath: null }; }
        if (command === 'get_sync_status') return { endpoint: current.endpoint, configured: true, pending: 0, lastSuccess: null, revision: 1, linked: f.linked, recoveryAvailable: false };
        if (command === 'preview_sync') return plan();
        if (command === 'commit_sync') { f.linked = true; f.pause=null; f.mode='ready'; f.choices=args.choices; save(); return { changed: false, revision: 1, snapshotPath: null }; }
        if (command === 'bootstrap_app_state') return {};
        if (command === 'list_tasks') return f.tasks;
        if (command === 'get_goal_state') return null;
        if (command === 'create_task') {
          const m = args.mutation, now = new Date().toISOString();
          const task = { schema_version: '1.0.0', id: crypto.randomUUID(), title: m.title, notes: m.notes, horizon: m.horizon,
            priority: m.priority, start_date: m.startDate, due_date: m.dueDate, created_at: now, updated_at: now, completed_at: null, origin: m.origin };
          f.tasks.push(task); f.needsSync = true; save(); return task;
        }
        if (command === 'get_ai_settings') return { model: 'synthetic', baseUrl: 'https://example.test', apiKeyConfigured: false, apiKeyHint: null };
        if (command === 'get_map_settings') return { configured: false, keyHint: null };
        if (command === 'configure_mobile_reminders' || command === 'get_mobile_reminder_status') return mobile;
        if (command === 'take_pending_deep_links') return [];
        if (command === 'plugin:app|version') return '0.18.0-internal';
        if (command === 'plugin:event|listen') return 1;
        if (['set_app_state', 'migrate_legacy_tasks', 'discard_sync_preview', 'plugin:event|unlisten'].includes(command)) return;
        throw Error(`Automatic sync fixture missing ${command}`);
      },
    };
  });
  await page.goto(new URL('/', page.url()).href);
  await page.waitForFunction(() => window.__autoFixture.calls.includes('commit_automatic_sync'), null, { timeout: 25000 });
  check(await page.locator('.sync-working').count() === 0, 'Upload-only sync kept interaction frozen');
  await page.locator('.mobile-settings').click();
  const preferences=page.getByRole('dialog',{name:'偏好设置',exact:true});
  check(await preferences.getByRole('region',{name:'账号与资料库',exact:true}).count()===0,'Account mixed with preferences');
  check(!await preferences.getByRole('region',{name:'AI 服务配置',exact:true}).isVisible(),'API config exposed');
  check(!await preferences.getByLabel('同步访问令牌',{exact:true}).isVisible(),'Token config exposed');
  await preferences.getByText('高级与开发者设置',{exact:true}).click();
  check(await preferences.getByRole('region',{name:'AI 服务配置',exact:true}).isVisible(),'Advanced AI config unavailable');
  await preferences.getByText('同步诊断与兼容连接',{exact:true}).click();
  const sync = page.getByRole('region', { name: '跨设备同步', exact: true });
  const toggle = sync.getByRole('switch', { name: '本设备自动同步', exact: true });
  await toggle.waitFor();
  check(await toggle.isChecked(), 'Account sync not enabled by default');
  await sync.getByRole('button', { name: '检查更改', exact: true }).click();
  await sync.getByRole('button', { name: '取消本次检查', exact: true }).click();
  await page.waitForFunction(() => window.__autoFixture.calls.includes('discard_sync_preview'));
  await page.getByRole('dialog', { name: '偏好设置', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForFunction(() => window.__autoFixture.calls.includes('commit_automatic_sync'), null, { timeout: 25000 });
  check(await page.locator('.sync-working').count() === 0, 'Upload-only sync kept interaction frozen');
  await page.evaluate(async () => {
    const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/appDataStore.ts')?.name;
    if(!url)throw Error('Mounted persistence module not found');
    const { persistAppState, APP_STATE_KEYS } = await import(url);
    await persistAppState(APP_STATE_KEYS.mealChecked, ['synthetic-save-after-upload']);
  });
  check(await page.evaluate(() => window.__autoFixture.calls.includes('set_app_state')), 'Write gate remained locked after upload');
  // A real editor remains open for more than one scheduling period.
  await page.getByRole('button', { name: '添加计划', exact: true }).click();
  await page.getByRole('textbox', { name: '计划名称', exact: true }).fill('自动同步后的新计划');
  const before = await page.evaluate(() => window.__autoFixture.calls.filter(c => c === 'commit_automatic_sync').length);
  await page.evaluate(() => { window.__autoFixture.needsSync = true; window.dispatchEvent(new Event('online')); });
  await page.waitForTimeout(10000);
  check(await page.getByRole('textbox', { name: '计划名称', exact: true }).inputValue() === '自动同步后的新计划', 'Sync lost editor input');
  check(await page.evaluate(() => window.__autoFixture.calls.filter(c => c === 'commit_automatic_sync').length) === before, 'Sync committed while editor open');
  await page.getByRole('button', { name: '保存计划', exact: true }).click();
  await page.waitForFunction(count => window.__autoFixture.calls.filter(c => c === 'commit_automatic_sync').length > count, before, { timeout: 25000 });
  await page.evaluate(() => { window.__autoFixture.mode = 'conflict'; window.dispatchEvent(new Event('online')); });
  await page.getByRole('button', { name: '查看账号状态', exact: true }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: '查看账号状态', exact: true }).click();
  const account=page.getByRole('dialog',{name:'我的账号',exact:true});
  check(!await account.getByLabel('账号服务地址',{exact:true}).isVisible(),'Default account exposes server config');
  await account.getByRole('button',{name:'确认待定内容',exact:true}).click();
  await account.getByRole('heading',{name:'哪份内容是你希望保留的？',exact:true}).waitFor();
  for (const width of [320, 390, 960]) {
    await page.setViewportSize({ width, height: 844 });
    await account.scrollIntoViewIfNeeded();
    check(await account.evaluate(el => el.scrollWidth <= el.clientWidth), `Account overflow at ${width}`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page overflow at ${width}`);
    await page.screenshot({ path: `output/playwright/automatic-sync-${width}.png` });
  }
  await account.getByRole('radio',{name:'这台设备的内容',exact:true}).check();
  await account.getByRole('button',{name:'确认保留并继续',exact:true}).click();
  await account.waitFor({state:'hidden'});
  check(await page.evaluate(()=>window.__autoFixture.choices['task:synthetic']==='local'),'Business confirmation not applied');
  await page.locator('.mobile-settings').click();
  await preferences.getByText('高级与开发者设置',{exact:true}).click();
  await preferences.getByText('同步诊断与兼容连接',{exact:true}).click();
  await toggle.uncheck(); await page.waitForFunction(()=>!window.__autoFixture.enabled);
  check(errors.length === 0, errors.join('\n'));
  const evidence = { fixture: true, actualHTTP: false, actualNative: false,
    gates: ['automatic first connection', 'account and preferences separated; credentials hidden', 'advanced preview disposal', 'upload-only no reload or permanent lock', 'editor deferral', 'saved-change sync', 'business conflict confirmation', '320/390/960 layouts', 'explicit pause'], pageErrors: errors };
  await page.evaluate(evidence => { window.__autoUiEvidence = evidence; sessionStorage.setItem('__autoUiEvidence',JSON.stringify(evidence)); }, evidence);
  console.log(JSON.stringify(evidence));
  // Cancel a real reload through beforeunload after a successful commit. The
  // mounted hook must preserve both the write gate and the recovery overlay.
  const dismissReload = dialog => dialog.dismiss().catch(() => {});
  page.on('dialog', dismissReload);
  await page.evaluate(() => {
    const f=window.__autoFixture; f.mode='ready'; f.pause=null; f.receive=true; f.needsSync=true;
    const preventReload=event=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',preventReload);
    window.__restoreNavigation=()=>window.removeEventListener('beforeunload',preventReload);
  });
  await toggle.check();
  await page.getByRole('dialog', { name: '偏好设置', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  // The CLI yields when beforeunload appears. Complete the recovery checks in
  // automatic-sync-reload-recovery.js after the cancellation is handled.
  await page.getByRole('dialog',{name:'正在处理同步',exact:true}).waitFor({timeout:25000});
}
