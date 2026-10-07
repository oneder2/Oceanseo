// Browser interaction fixture, not native profile/process or HTTP verification.
async (page) => {
  const check = (value, message) => { if (!value) throw Error(message); };
  await page.goto(new URL('/', page.url()).href);
  await page.getByRole('button', { name: '偏好设置', exact: true }).waitFor();
  await page.evaluate(() => {
    const local = { key: 'local', username: null, endpoint: null, sessionId: null, expiresAt: null, signedIn: false, active: true };
    const alice = { key: 'a'.repeat(64), username: 'alice', endpoint: 'https://accounts.example.test', sessionId: '00000000-0000-4000-8000-000000000001', expiresAt: 4000000000, signedIn: true, active: false };
    window.__accountFixture = { current: local, selectedKey: 'local', restartRequired: false, profiles: [local, alice], calls: [], sessions: [
      { id: alice.sessionId, deviceName: '合成验收电脑', platform: 'linux', createdAt: 1791000000, lastSeen: 1791000010, expiresAt: alice.expiresAt, current: true },
      { id: '00000000-0000-4000-8000-000000000002', deviceName: '合成验收手机：用于验证很长的名称不会遮挡撤销操作', platform: 'android', createdAt: 1791000000, lastSeen: 1791000010, expiresAt: alice.expiresAt, current: false },
    ] };
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      const f = window.__accountFixture;
      // Record action names only; no passwords or invitations in evidence.
      f.calls.push(command);
      if (command === 'get_profile_status') return { current: f.current, selectedKey: f.selectedKey, restartRequired: f.restartRequired };
      if (command === 'list_local_profiles') return f.profiles.map(p => ({ ...p, active: p.key === f.current.key }));
      if (command === 'get_sync_status') return { endpoint: f.current.endpoint ?? '', configured: f.current.signedIn, pending: 0, lastSuccess: null, revision: 0, linked: false, recoveryAvailable: false };
      if (command === 'get_map_settings') return { configured: false, keyHint: null };
      if (command === 'set_app_state') return;
      if (command === 'sign_in_account') {
        if (args.input.password === 'Incorrect-synthetic-password!') throw '用户名或密码不正确';
        return f.profiles[1];
      }
      if (command === 'select_local_profile') {
        f.selectedKey = args.key; f.restartRequired = args.key !== f.current.key;
        return { current: f.current, selectedKey: f.selectedKey, restartRequired: f.restartRequired };
      }
      if (command === 'restart_selected_profile') throw '资料库已选定，但应用未能重新打开。请完全关闭后再打开 Oceanseo；当前资料仍保留';
      if (command === 'list_account_sessions') return { sessions: f.sessions };
      if (command === 'revoke_account_session') {
        f.sessions = f.sessions.filter(s => s.current || (args.sessionId !== 'others' && s.id !== args.sessionId));
        return;
      }
      if (command === 'change_account_password' || command === 'logout_account') {
        f.current = { ...f.current, signedIn: false }; return;
      }
      throw Error(`Account fixture does not implement ${command}`);
    } };
  });
  await page.locator('.account-entry').click();
  const accounts = page.getByRole('region', { name: '账号与资料库', exact: true });
  check(!await accounts.getByLabel('账号服务地址', { exact: true }).isVisible(), 'Service address exposed by default');
  await accounts.getByText('高级连接选项', { exact: true }).click();
  await accounts.getByLabel('账号服务地址', { exact: true }).fill('https://accounts.example.test');
  await accounts.getByLabel('账号用户名', { exact: true }).fill('alice');
  await accounts.getByLabel('账号密码', { exact: true }).fill('Incorrect-synthetic-password!');
  check(await accounts.getByLabel('账号用户名', { exact: true }).evaluate(el => el.checkValidity()), 'Username pattern invalid');
  await accounts.getByRole('button', { name: '登录账号', exact: true }).click();
  await accounts.getByText('用户名或密码不正确', { exact: true }).waitFor();
  await accounts.getByLabel('账号密码', { exact: true }).fill('Correct-synthetic-password!');
  await accounts.getByRole('button', { name: '显示账号密码', exact: true }).click();
  check(await accounts.getByLabel('账号密码', { exact: true }).getAttribute('type') === 'text', 'Password toggle failed');
  await accounts.getByRole('button', { name: '登录账号', exact: true }).click();
  await accounts.getByText('切换至 alice？', { exact: true }).waitFor();
  check(await accounts.getByLabel('账号密码', { exact: true }).inputValue() === '', 'Successful login retained password');
  check(await page.evaluate(() => window.__accountFixture.current.key) === 'local', 'Login implicitly switched local data');
  await accounts.getByRole('button', { name: '确认切换', exact: true }).click();
  await accounts.getByText('待打开：alice', { exact: true }).waitFor();
  await accounts.getByText(/资料库已选定，但应用未能重新打开/).waitFor();
  await accounts.getByRole('button', { name: '取消待切换', exact: true }).click();
  check(await page.evaluate(() => window.__accountFixture.selectedKey) === 'local', 'Pending selection cancel failed');
  const modal = page.getByRole('dialog', { name: '我的账号', exact: true });
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  // Simulate a fresh native process for UI rendering only, not an isolation claim.
  await page.evaluate(() => {
    const f = window.__accountFixture; f.current = { ...f.profiles[1], active: true }; f.selectedKey = f.current.key;
  });
  await page.locator('.account-entry').click();
  await accounts.getByText('alice', { exact: true }).waitFor();
  check(await modal.getByLabel('同步访问令牌', { exact: true }).count() === 0, 'Account exposes shared token');
  check(await modal.getByLabel('账号服务地址', { exact: true }).isVisible() === false, 'Account exposes service address');
  await accounts.getByRole('button', { name: '刷新设备', exact: true }).click();
  await accounts.getByText('合成验收电脑', { exact: false }).waitFor();
  for (const width of [320, 390, 960]) {
    await page.setViewportSize({ width, height: 844 });
    await accounts.scrollIntoViewIfNeeded();
    check(await accounts.evaluate(el => el.scrollWidth <= el.clientWidth), `Account overflow ${width}`);
    check(await modal.evaluate(el => el.scrollWidth <= el.clientWidth), `Settings overflow ${width}`);
    await page.screenshot({ path: `output/playwright/accounts-ui-${width}.png` });
  }
  await accounts.getByRole('button', { name: '撤销', exact: true }).click();
  check(await page.evaluate(() => window.__accountFixture.calls.filter(c => c === 'revoke_account_session').length) === 0, 'Revocation skipped confirmation');
  await accounts.getByRole('button', { name: '确认撤销', exact: true }).click();
  check(await accounts.locator('.account-devices li').count() === 1, 'Revoked device remained');
  await accounts.getByText('修改密码', { exact: true }).click();
  await accounts.getByLabel('当前密码', { exact: true }).fill('Correct-synthetic-password!');
  await accounts.getByLabel('新密码', { exact: true }).fill('Next-synthetic-password!');
  await accounts.getByLabel('再次输入新密码', { exact: true }).fill('Mismatch-synthetic-password!');
  await accounts.getByRole('button', { name: '修改密码并退出全部设备', exact: true }).click();
  await accounts.getByText('两次新密码不一致', { exact: true }).waitFor();
  check(await page.evaluate(() => window.__accountFixture.calls.includes('change_account_password')) === false, 'Mismatched password submitted');
  await accounts.getByLabel('再次输入新密码', { exact: true }).fill('Next-synthetic-password!');
  await accounts.getByRole('button', { name: '修改密码并退出全部设备', exact: true }).click();
  await accounts.getByText('密码已修改，全部设备会话已退出，请重新登录。', { exact: true }).waitFor();
  check(await accounts.getByLabel('当前密码', { exact: true }).count() === 0, 'Signed-out password form remained');
  check(await accounts.getByRole('button', { name: '刷新设备', exact: true }).isDisabled(), 'Signed-out session management enabled');
  await page.evaluate(() => { window.__accountUiEvidence = { fixture: true, actualNativeProfileSwitch: false, actualHTTP: false,
    passed: ['login failure', 'password visibility and clearing', 'explicit profile confirmation', 'restart failure and cancellation',
      'account sync credential binding', '320/390/960 layouts', 'confirmed single-device revocation', 'password mismatch and sign-out'] }; });
}
