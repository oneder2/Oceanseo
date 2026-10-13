// Real WebKit/GTK window in isolated data and D-Bus; never opens the daily profile.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import os from "node:os";

const [binary, driverPath, previousBinary] = process.argv.slice(2);
const expectedVersion = JSON.parse(await readFile("src-tauri/tauri.personal-workspaces.conf.json", "utf8")).version;
const evidencePrefix = process.env.QA_EVIDENCE_PREFIX ?? "personal-shared-tools-native";
assert.ok(binary && driverPath && previousBinary, "Supply candidate binary and WebKitWebDriver");
const execute = promisify(execFile);
const autostart = path.join(os.homedir(), ".config/autostart/Tideplan.desktop");
const previous = await readFile(autostart).catch(e => { if (e.code !== "ENOENT") throw e; return null; });
const root = await mkdtemp("/tmp/oceanseo-shared-tools-");
for (const name of ["data", "config", "cache"]) await mkdir(`${root}/${name}`, { mode: 0o700 });
const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(() => resolve(port)); }); });
const bus = spawn("dbus-daemon", ["--session", "--nofork", "--print-address=1"], { stdio: ["ignore", "pipe", "ignore"] });
const address = await new Promise((resolve, reject) => { let raw = ""; bus.stdout.on("data", b => { raw += b; if (raw.includes("\n")) resolve(raw.split("\n")[0]); }); bus.once("error", reject); });
const driver = spawn(driverPath, [`--port=${port}`], { env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: address, XDG_DATA_HOME: `${root}/data`, XDG_CONFIG_HOME: `${root}/config`, XDG_CACHE_HOME: `${root}/cache`, TAURI_WEBVIEW_AUTOMATION: "true" }, stdio: ["ignore", "ignore", "pipe"] });
let session;
async function request(route, body, method = "POST") {
  const r = await fetch(`http://127.0.0.1:${port}${route}`, { method, signal: AbortSignal.timeout(60000), headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await r.json(); assert.ok(r.ok, JSON.stringify(result)); return result.value;
}
const cmd = (route, body, method) => request(`/session/${session}${route}`, body, method);
const js = (script, ...args) => cmd("/execute/sync", { script, args });
async function ipc(name, args = {}) {
  const r = await cmd("/execute/async", { script: "const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({error:String(error)}));", args: [name, args] });
  assert.ok(!r.error, `${name}: ${r.error}`); return r.value;
}
async function wait(fn, label) { const end = Date.now() + 60000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 150)); } throw Error(label); }
const click = label => js("const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===arguments[0] || b.textContent.trim()===arguments[0]);if(!b)throw Error('Button not found: '+arguments[0]);b.click();return true", label);
async function screenshot(name) { await writeFile(`output/playwright/${name}.png`, Buffer.from(await cmd("/screenshot", undefined, "GET"), "base64")); }

async function launch(candidate) {
  session = (await request("/session", {capabilities:{alwaysMatch:{"webkitgtk:browserOptions":{binary:path.resolve(candidate)}}}})).sessionId;
  await cmd("/timeouts", {script:60000, implicit:0});
  await wait(()=>js("return !!document.querySelector('.scene-current')"), "Workspace ready");
}
async function stopSession() {
  if (session) { await request(`/session/${session}`,undefined,"DELETE").catch(()=>{}); session=undefined; }
  // Only this QA profile's own application, never the daily desktop process.
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    const env = await readFile(`/proc/${pid}/environ`,'utf8').catch(()=>"");
    const args = await readFile(`/proc/${pid}/cmdline`,'utf8').catch(()=>"");
    if (env.includes(`XDG_DATA_HOME=${root}/data`) && path.basename(args.split('\0')[0])==='tideplan') {
      try { process.kill(Number(pid),'SIGTERM'); } catch(e) { if(e.code!=='ESRCH')throw e; }
      await wait(async()=>{try{process.kill(Number(pid),0);return false;}catch(e){return e.code==='ESRCH';}},'QA app exit');
    }
  }
}
async function stable(token, rect) {
  const state = await js("const q=window.__sharingQA;return q?{token:q.token,same:q.shell===document.querySelector('.desktop-shell'),lost:q.lost,frames:q.frames,origin:performance.timeOrigin}:null");
  assert.ok(state && state.token===token && state.same && state.lost===0,JSON.stringify(state));
  assert.deepEqual(await cmd('/window/rect',undefined,'GET'),rect);
  return state;
}
async function switchTo(name) {
  await js("document.querySelector('.scene-current').click();return true");
  await wait(()=>js("return !!document.querySelector('.scene-options')"),'Picker ready');
  await click(name);
  await wait(()=>js("return !document.querySelector('.scene-options') && document.querySelector('.scene-current strong').textContent===arguments[0]",name),'Workspace switched');
}
async function add(name) {
  if(await js("return [...document.querySelectorAll('.scene-tool-row>button:first-child')].some(b=>b.textContent.trim()===arguments[0])",name))return;
  await click('添加工具');
  await wait(()=>js("return document.querySelectorAll('.scene-tool-card').length===11"),'Tool library');
  await js("[...document.querySelectorAll('.scene-tool-card')].find(c=>c.querySelector('h4').textContent===arguments[0]).querySelector('button').click();return true",name);
  await wait(()=>js("return !document.querySelector('.scene-dialog') && !!document.querySelector('[aria-label=\"工具操作：'+arguments[0]+'\"]')",name),'Installed without reload');
}
try {
  await wait(async()=>{try{return(await fetch(`http://127.0.0.1:${port}/status`)).ok;}catch{return false;}},'Driver ready');
  await launch(previousBinary);
  assert.equal(await ipc('plugin:app|version'),'0.19.2');
  const doc = await ipc('personal_workspaces');
  const scenes = ['CTO','CEO'].map((name,index)=>({id:crypto.randomUUID(),name,main:false,style:index?'executive':'technical',deleted:false,tools:['shopping-list','bead-studio','travel'].map(module=>({id:crypto.randomUUID(),module,archived:false}))}));
  scenes[0].tools.push({id:crypto.randomUUID(),module:'people',archived:false});
  doc.workspaces.push(...scenes);doc.activeId=scenes[1].id;
  await ipc('save_personal_workspaces',{document:doc,expectedRevision:doc.revision});
  for(const scene of scenes){
    const item={id:crypto.randomUUID(),name:`${scene.name} 旧版独立资料`,amount:'1',category:'其他',checked:false,source:'manual',sourceLabel:null,sourceId:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    await ipc('set_app_state',{personalScope:scene.id,key:'tideplan.purchase-list.v1',value:[item]});
    await ipc('set_app_state',{personalScope:scene.id,key:'tideplan.bead-pattern.v1',value:{version:1,title:`${scene.name} 原图`,width:2,height:1,beadPitchMm:2.6,palette:[{hex:'#ffffff',name:'白色'}],cells:[0,-1]}});
  }
  await ipc('set_app_state',{personalScope:scenes[0].id,key:'tideplan.life.v1',value:{version:1,people:[{id:crypto.randomUUID(),name:'迁移后的共享人物',birthday:'',relationship:'自己',dietary:'',preferences:'',hobbies:'',strengths:'',healthNotes:'',notes:'',archived:false}],training:[],workouts:[],trips:[]}});
  await ipc('save_map_settings',{personalScope:scenes[0].id,key:'qa-test-map-key-1234',clear:false});
  const legacy=await ipc('export_personal_backup');
  assert.equal(legacy.states[scenes[0].id]['tideplan.purchase-list.v1'].length,1);
  assert.equal(legacy.states[scenes[1].id]['tideplan.purchase-list.v1'].length,1);
  await stopSession();
  await launch(binary);
  assert.equal(await ipc('plugin:app|version'),expectedVersion);
  const entry=(await readFile('dist/index.html','utf8')).match(/src="([^"]+\.js)"/)[1];
  assert.ok((await js("return document.querySelector('script[type=module]').src")).endsWith(entry));
  const migrated=await ipc('export_personal_backup');
  assert.equal(migrated.sharedTools,true);
  assert.equal(migrated.states.main['tideplan.purchase-list.v1'].length,2);
  assert.equal(migrated.states.main['tideplan.bead-works.v1'].works.length,2);
  assert.equal(migrated.states[scenes[0].id]['tideplan.purchase-list.v1'].length,1);
  assert.deepEqual((await ipc('get_map_settings',{personalScope:scenes[0].id})),(await ipc('get_map_settings',{personalScope:scenes[1].id})));
  assert.equal((await ipc('get_map_settings',{personalScope:scenes[1].id})).configured,true);
  const rect=await cmd('/window/rect',undefined,'GET');
  const token=await js("window.__sharingQA={token:crypto.randomUUID(),shell:document.querySelector('.desktop-shell'),lost:0,frames:0};function sample(){const q=window.__sharingQA;q.frames++;if(q.shell!==document.querySelector('.desktop-shell')||!q.shell.isConnected||getComputedStyle(q.shell).opacity!=='1')q.lost++;requestAnimationFrame(sample)}requestAnimationFrame(sample);return window.__sharingQA.token");
  await add('人物档案');await click('人物档案');
  await wait(()=>js("return document.body.textContent.includes('迁移后的共享人物')"),'Newly installed tool reads shared life data without restart');
  await click('采购清单');
  await wait(()=>js("return document.body.textContent.includes('CTO 旧版独立资料') && document.body.textContent.includes('CEO 旧版独立资料')"),'Both old datasets visible');
  const input=await cmd('/element',{using:'css selector',value:'input[aria-label="物品名称"]'});
  await cmd(`/element/${input['element-6066-11e4-a52e-4f735466cecf']}/value`,{text:'跨工作区原生新增资料'});await click('添加');
  await wait(async()=> (await ipc('export_data_backup',{personalScope:scenes[0].id})).appState['tideplan.purchase-list.v1'].length===3,'Native write persisted');
  await switchTo('CEO');await click('采购清单');
  await wait(()=>js("return document.body.textContent.includes('跨工作区原生新增资料')"),'Shared UI reads new content');
  await stable(token,rect);
  await click('工具操作：采购清单');await wait(()=>js("return !!document.querySelector('.scene-tool-menu')"),'Actions menu');await click('属性');
  await wait(()=>js("return document.body.textContent.includes('所有工作区共享同一份资料')"),'Tool properties');await click('关闭工具属性');
  await click('工具操作：采购清单');await wait(()=>js("return !!document.querySelector('.scene-tool-menu')"),'Actions menu');await click('删除工具');
  await wait(()=>js("return !document.querySelector('[aria-label=\"工具操作：采购清单\"]')"),'Remove just current entry');
  const removed=await ipc('personal_workspaces');
  assert.equal(removed.workspaces.find(w=>w.name==='CEO').tools.find(t=>t.module==='shopping-list').archived,true);
  assert.equal(removed.workspaces.find(w=>w.name==='CTO').tools.find(t=>t.module==='shopping-list').archived,false);
  await switchTo('CTO');await click('采购清单');await wait(()=>js("return document.body.textContent.includes('跨工作区原生新增资料')"),'Other workspace entry and data remain');
  await switchTo('CEO');await add('采购清单');await click('采购清单');
  await wait(()=>js("return document.body.textContent.includes('跨工作区原生新增资料')"),'Restored entry retains shared content');
  await click('拼豆图纸');await wait(()=>js("return !!document.querySelector('.bead-workbench')"),'Unified bead editor');await click('作品管理');
  await wait(()=>js("return document.querySelectorAll('.work-card').length===2"),'Both original patterns preserved');
  for(const name of ['想法与目标','主机与服务','工作观察','AI 食谱','训练计划','人物档案','计划日历','关键日期'])await add(name);
  const finalState=await stable(token,rect);
  assert.deepEqual((await ipc('export_data_backup',{personalScope:scenes[0].id})).appState,(await ipc('export_data_backup',{personalScope:scenes[1].id})).appState);
  if (process.env.QA_SIDEBAR_PADDING) await js("const s=document.createElement('style');s.textContent='.personal-shell .workspace-nav{padding-right:'+arguments[0]+'px!important}';document.head.append(s);return true",Number(process.env.QA_SIDEBAR_PADDING));
  await cmd('/window/rect',{width:620,height:560});
  await wait(()=>js("return innerWidth===620"),'Native resized viewport settled');
  await js("document.querySelector('[aria-label=\"工具操作：旅行规划\"]').scrollIntoView({block:'center',behavior:'instant'});return true");
  await wait(()=>js("const n=document.querySelector('.workspace-nav').getBoundingClientRect(),b=document.querySelector('[aria-label=\"工具操作：旅行规划\"]').getBoundingClientRect(),r=JSON.stringify([b.x,b.y,n.x,n.y,n.height]);const q=window.__scrollQA??={rect:'',count:0};q.count=q.rect===r?q.count+1:0;q.rect=r;return q.count>=3&&b.top>=n.top&&b.bottom<=n.bottom"),'Sidebar scroll settled');
  await click('工具操作：旅行规划');await wait(()=>js("return !!document.querySelector('.scene-tool-menu')"),'Narrow menu');
  await wait(()=>js("const m=document.querySelector('.scene-tool-menu');return !!m && getComputedStyle(m).opacity==='1' && m.getAnimations().every(a=>a.playState==='finished')"),'Menu animation settled');
  const layout=await js("const n=document.querySelector('.workspace-nav'),b=document.querySelector('[aria-label=\"工具操作：旅行规划\"]'),m=document.querySelector('.scene-tool-menu');const nr=n.getBoundingClientRect(),br=b.getBoundingClientRect(),mr=m.getBoundingClientRect();return{gap:nr.right-br.right,hit:document.elementFromPoint(br.right-2,br.top+br.height/2)?.closest('button')===b,menuFits:mr.left>=0&&mr.top>=0&&mr.right<=innerWidth&&mr.bottom<=innerHeight,portal:!m.closest('.workspace-nav'),scrollable:n.scrollHeight>n.clientHeight,hitTag:document.elementFromPoint(br.right-2,br.top+br.height/2)?.tagName,hitClass:document.elementFromPoint(br.right-2,br.top+br.height/2)?.getAttribute('class'),button:{x:br.x,y:br.y,width:br.width,height:br.height},nav:{x:nr.x,y:nr.y,width:nr.width,height:nr.height},menu:{x:mr.x,y:mr.y,width:mr.width,height:mr.height}}");
  await screenshot(`${evidencePrefix}-menu`);
  console.log(JSON.stringify({diagnosticLayout:layout}));
  assert.ok(layout.gap>=12&&layout.hit&&layout.menuFits&&layout.portal&&layout.scrollable,JSON.stringify(layout));
  const evidence={version:expectedVersion,upgradeFrom:'0.19.2',frontendMatches:true,injectedPadding:process.env.QA_SIDEBAR_PADDING?Number(process.env.QA_SIDEBAR_PADDING):null,legacyDataMerged:true,legacyPatternsPreserved:2,sharedNativeData:true,sharedLifeData:true,sharedMapSettings:true,removeOnlyCurrentEntry:true,properties:true,webviewPreserved:finalState,windowGeometryPreserved:true,layout};
  await writeFile(`output/playwright/${evidencePrefix}${process.env.QA_SIDEBAR_PADDING?'-diagnostic':''}.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
} finally {
  try { await stopSession(); } finally {
  driver.kill('SIGTERM');bus.kill('SIGTERM');
  await new Promise(resolve=>{if(driver.exitCode!==null||driver.signalCode!==null)resolve();else driver.once('exit',resolve);});
  if(previous!==null)await writeFile(autostart,previous);else await rm(autostart,{force:true});
  await rm(root,{recursive:true,force:true});
  }
}
