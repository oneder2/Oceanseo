// Read-only UI check of the isolated QA package; never installs or clears data.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';

const execute = promisify(execFile);
const serial = process.argv[2];
assert.ok(serial, 'Supply an unlocked Android serial');
const pkg = 'com.tideplan.mobile.uiuxqa';
const port = 9278;
const session = `quality-android-${process.pid}`;
const adb = async (...args) => (await execute('adb', ['-s', serial, ...args], { timeout: 60000 })).stdout.trim();
const cli = async (...args) => (await execute('bash', ['/home/gellar/.codex/skills/playwright/scripts/playwright_cli.sh', `-s=${session}`, ...args], { timeout: 90000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const evaluate = async source => JSON.parse(await cli('eval', source, '--raw'));
const invoke = name => evaluate(`async () => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)})`);
let forwarded = false, attached = false;
try {
  assert.ok(!/showing=true/.test(await adb('shell', 'dumpsys', 'window', 'policy')), 'Android is locked');
  await adb('shell', 'am', 'start', '-n', `${pkg}/com.tideplan.mobile.MainActivity`);
  let pid;
  for (let i = 0; i < 40; i++) {
    pid = await adb('shell', 'pidof', pkg).catch(() => '');
    if (pid) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.match(pid, /^\d+$/);
  await adb('forward', '--no-rebind', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  forwarded = true;
  await cli('attach', `--cdp=http://127.0.0.1:${port}`); attached = true;
  await cli('snapshot');
  assert.ok((await evaluate('async () => window.__TAURI_INTERNALS__.invoke("plugin:path|resolve_directory",{directory:14})')).endsWith(`/${pkg}`));
  const profile = await invoke('get_profile_status');
  assert.equal(profile.current.key, 'local', 'Refusing an active account profile');
  const tasks = await invoke('list_tasks'), ai = await invoke('get_ai_settings');
  await cli('run-code', `async (page) => {
    const check = (value, message) => { if (!value) throw Error(message); };
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const samples = [], nav = page.getByRole('navigation',{name:'手机主导航'});
    for (const name of ['所有计划','计划日历','关键日期','AI 食谱','采购清单','人物档案','训练计划','旅行规划','主机与服务']) {
      await nav.getByRole('button',{name:'工具',exact:true}).click();
      await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name,exact:true}).click();
      await page.waitForFunction(() => !document.querySelector('[data-page-loading]'));
      const result = await page.locator('.workspace').evaluate(el=>({width:el.clientWidth,contentWidth:el.scrollWidth}));
      check(result.contentWidth <= result.width + 1,'Native page overflow: '+name);
      samples.push({name,...result});
    }
    await page.locator('.account-entry').click();
    const account = page.getByRole('dialog',{name:'我的账号',exact:true});
    await account.waitFor();
    check(!(await account.getByLabel('账号服务地址',{exact:true}).isVisible()),'Technical account config visible');
    await account.getByRole('button',{name:'关闭',exact:true}).click();
    await page.locator('.mobile-settings').click();
    const settings = page.getByRole('dialog',{name:'偏好设置',exact:true});
    check(await settings.getByLabel('账号用户名',{exact:true}).count()===0,'Account mixed into settings');
    check(!(await settings.getByRole('region',{name:'跨设备同步',exact:true}).isVisible()),'Technical sync config visible');
    await settings.getByRole('button',{name:'关闭',exact:true}).click();
    await nav.getByRole('button',{name:'助手',exact:true}).click();
    await page.getByRole('textbox',{name:'给小汐的消息'}).waitFor();
    check(errors.length===0,errors.join(';'));
    await page.evaluate(evidence => {window.__androidQualityEvidence=evidence;},{samples,errors,accountPreferencesSeparate:true,advancedHidden:true});
  }`);
  assert.deepEqual(await invoke('list_tasks'), tasks, 'Task data changed during read-only QA');
  assert.deepEqual(await invoke('get_ai_settings'), ai, 'AI configuration changed');
  assert.deepEqual(await invoke('get_profile_status'), profile, 'Profile changed');
  const evidence = { ...(await evaluate('() => window.__androidQualityEvidence')), actualAndroid: true, physicalDevice: !serial.startsWith('emulator-'), package: pkg,
    storedTasksUnchanged: true, aiConfigurationUnchanged: true, actualAI: false,
    scope: 'Native WebView navigation/layout and account/preferences separation; no fontScale, Doze, notifications, network or cold-start benchmark' };
  await mkdir('output/playwright', { recursive: true });
  await writeFile('output/playwright/ui-quality-android.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, pages: evidence.samples.length, actualAndroid: true, storedTasksUnchanged: true }));
} finally {
  if (attached) await cli('detach').catch(() => {});
  if (forwarded) await adb('forward', '--remove', `tcp:${port}`);
}
