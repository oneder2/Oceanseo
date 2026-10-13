// W3C WebDriver runs the built Linux app in private XDG directories and D-Bus.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { build } from "esbuild";

const [binary, driverPath, mode] = process.argv.slice(2);
assert.ok(binary && driverPath, "Supply personal Linux binary and WebKitWebDriver");
// auto-launch uses ~/.config directly rather than XDG_CONFIG_HOME on Linux.
// Preserve that installation-level preference around isolated profile QA.
const autostartPath=path.join(os.homedir(),".config/autostart/Tideplan.desktop");
const previousAutostart=await readFile(autostartPath).catch(error=>{if(error.code!=="ENOENT")throw error;return null;});
const root = await mkdtemp("/tmp/oceanseo-personal-native-");
for (const name of ["data","config","cache"]) await mkdir(`${root}/${name}`,{ mode:0o700 });
const port = await new Promise(resolve => { const server=net.createServer();server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(()=>resolve(port));}); });
const bus=spawn("dbus-daemon",["--session","--nofork","--print-address=1"],{stdio:["ignore","pipe","ignore"]});
const address=await new Promise((resolve,reject)=>{let output="";bus.stdout.on("data",chunk=>{output+=chunk;if(output.includes("\n"))resolve(output.split("\n")[0]);});bus.once("error",reject);});
const driver=spawn(driverPath,[`--port=${port}`],{env:{...process.env,DBUS_SESSION_BUS_ADDRESS:address,XDG_DATA_HOME:`${root}/data`,XDG_CONFIG_HOME:`${root}/config`,XDG_CACHE_HOME:`${root}/cache`,TAURI_WEBVIEW_AUTOMATION:"true"},stdio:["ignore","pipe","pipe"]});
let session;
const endpoint=`http://127.0.0.1:${port}`;
async function request(route,body,method="POST") {
  const response=await fetch(`${endpoint}${route}`,{method,signal:AbortSignal.timeout(60000),headers:{"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
  // Native IPC rejections are returned as { error } by the callback. Only an
  // unsuccessful HTTP response is a WebDriver protocol failure.
  const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result.value;
}
const command=(route,body,method)=>request(`/session/${session}${route}`,body,method);
const js=(script,...args)=>command("/execute/sync",{script,args});
async function invoke(name,args={},reject=false) {
  const result=await command("/execute/async",{script:"const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({error:String(error)}));",args:[name,args]});
  if(reject){assert.ok(result.error,`${name} should reject`);return result.error;}assert.ok(!result.error,`${name}: ${result.error}`);return result.value;
}
async function wait(fn,message) { const deadline=Date.now()+60000;while(Date.now()<deadline){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,120));}throw Error(message); }
const live=()=>invoke("personal_workspaces");
async function save(change) {const doc=await live();change(doc);return invoke("save_personal_workspaces",{document:doc,expectedRevision:doc.revision});}
async function reload() {await js("location.reload();return true");await wait(()=>js("return !!document.querySelector('.scene-current')"),"Reload did not mount");}
async function screenshot(name) {await mkdir("output/playwright",{recursive:true});await writeFile(`output/playwright/${name}.png`,Buffer.from(await command("/screenshot",undefined,"GET"),"base64"));}
const scene=name=>({id:crypto.randomUUID(),name,main:false,style:name==="CEO"?"executive":"living",deleted:false,tools:[]});
const tool=module=>({id:crypto.randomUUID(),module,archived:false});
const mutation=title=>({title,notes:"原生隔离验收",horizon:"short",priority:"normal",startDate:null,dueDate:null});
try {
  await wait(async()=>{try{return (await fetch(`${endpoint}/status`)).ok;}catch{return false;}},"WebDriver did not start");
  session=(await request("/session",{capabilities:{alwaysMatch:{"webkitgtk:browserOptions":{binary:path.resolve(binary)}}}})).sessionId;
  await command("/timeouts",{script:60000,implicit:0});
  await wait(()=>js("return !!document.querySelector('.personal-home')"),"Personal Linux home did not load");
  assert.equal(await invoke("plugin:path|resolve_directory",{directory:14}),`${root}/data/com.tideplan.desktop`);
  assert.equal(await invoke("plugin:app|version"),"0.19.0");
  const entry=(await readFile("dist/index.html","utf8")).match(/src="([^"]+\.js)"/)[1];
  assert.ok((await js("return document.querySelector('script[type=module]').src")).endsWith(entry),"Candidate must embed the latest frontend build");
  let doc=await live();assert.equal(doc.workspaces.length,1);assert.deepEqual(doc.workspaces[0].tools,[]);
  assert.ok(await js("return ['天气','时间','主页日历','总体待办'].every(label=>document.querySelector(`[aria-label='${label}']`))"));
  if (mode === "--legacy") {
    // Populate the original IPC/storage contract, then remove only our private
    // test registry while its app is stopped to reproduce a pre-upgrade profile.
    const oldTask=await invoke("create_task",{mutation:mutation("升级前的任务与笔记")});
    await invoke("set_task_completed",{id:oldTask.id,completed:true});
    const oldItem={id:crypto.randomUUID(),name:"旧版采购保留",amount:"2",category:"其他",checked:true,source:"manual",sourceLabel:null,sourceId:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    await invoke("set_app_state",{key:"tideplan.purchase-list.v1",value:[oldItem]});
    const config=(await invoke("get_work_dashboard")).config;
    const projectRoot=`${root}/legacy-projects`;await mkdir(projectRoot);
    await invoke("save_work_monitor_config",{config:{...config,enabled:false,workspaceRoot:projectRoot,scheduleTime:"07:30"}});
    await invoke("save_map_settings",{key:"synthetic-legacy-map-key",clear:false});
    const draft={title:"升级前尚未保存的草稿",notes:"草稿笔记",horizon:"short",priority:"normal",startDate:"",dueDate:""};
    await js("localStorage.setItem('tideplan.draft.task:new',JSON.stringify(arguments[0]));localStorage.setItem('tideplan.purchase-list.v1',JSON.stringify(arguments[1]));return true",draft,[oldItem]);
    const original=await invoke("export_data_backup");
    await request(`/session/${session}`,undefined,"DELETE");session=null;
    await rm(`${root}/data/com.tideplan.desktop/personal-workspaces`,{recursive:true});
    session=(await request("/session",{capabilities:{alwaysMatch:{"webkitgtk:browserOptions":{binary:path.resolve(binary)}}}})).sessionId;
    await wait(()=>js("return !!document.querySelector('.personal-home')"),"Legacy upgrade did not mount");
    doc=await live();const legacy=doc.workspaces.find(w=>w.name==="旧版资料");assert.ok(legacy);
    assert.equal(doc.workspaces.length,2);assert.deepEqual(doc.workspaces.find(w=>w.main).tools,[]);
    assert.equal(doc.taskOwners[oldTask.id],"pending");
    assert.deepEqual(await invoke("list_tasks"),original.tasks);
    assert.deepEqual((await invoke("bootstrap_app_state",{personalScope:legacy.id,legacy:{}}))["tideplan.purchase-list.v1"],[oldItem]);
    assert.ok(legacy.tools.some(t=>t.module==="shopping-list"));assert.ok(legacy.tools.some(t=>t.module==="work-monitor"));
    assert.equal((await invoke("get_work_dashboard",{personalScope:legacy.id})).config.scheduleTime,"07:30");
    assert.equal((await invoke("get_map_settings",{personalScope:legacy.id})).configured,true);
    assert.deepEqual((await invoke("export_data_backup")).appState,original.appState);
    assert.deepEqual(JSON.parse(await js("return localStorage.getItem('tideplan.draft.task:new')")),draft);
    const safety=JSON.parse(await readFile(`${root}/data/com.tideplan.desktop/personal-workspaces/${legacy.id}/before-workspaces.json`,"utf8"));
    assert.deepEqual(safety.tasks,original.tasks);
    await save(d=>{d.activeId=legacy.id;});await reload();
    await js("[...document.querySelectorAll('.scene-navigation button')].find(b=>b.textContent.trim()==='采购清单').click();return true");
    await wait(()=>js("return document.querySelector('main').textContent.includes('旧版采购保留')"),"Migrated purchase not visible");
    await screenshot("personal-workspaces-native-legacy");
    await reload();assert.equal((await live()).workspaces.length,2);
    const bundled=await build({entryPoints:["src/personal/backup.ts"],bundle:true,platform:"node",format:"esm",write:false});
    const { legacyPersonalBackup }=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
    await invoke("restore_personal_backup",{backup:legacyPersonalBackup(original)});await reload();
    const imported=await live();assert.equal(imported.workspaces.length,2);assert.deepEqual(imported.workspaces[0].tools,[]);
    assert.equal(imported.taskOwners[oldTask.id],"pending");assert.deepEqual(await invoke("list_tasks"),original.tasks);
    const importedScene=imported.workspaces.find(w=>!w.main);
    assert.deepEqual((await invoke("bootstrap_app_state",{personalScope:importedScene.id,legacy:{}}))["tideplan.purchase-list.v1"],[oldItem]);
    const evidence={version:"0.19.0",root,legacyUpgrade:true,taskIdAndContentPreserved:true,completionPreserved:true,pendingOwnership:true,toolsMigrated:true,workConfigMigrated:true,mapConfigMigrated:true,originalsPreserved:true,safetySnapshot:true,draftPreserved:true,idempotent:true,oldBackupImport:true,latestFrontend:true,at:new Date().toISOString()};
    await writeFile("output/playwright/personal-workspaces-legacy-evidence.json",JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
  } else {
  const invalid=structuredClone(doc);invalid.workspaces[0].deleted=true;
  await invoke("save_personal_workspaces",{document:invalid,expectedRevision:doc.revision},true);
  const ceo=scene("CEO"),clo=scene("CLO");
  const modules=["shopping-list","meal-planner","travel","fitness","people","goals","countdowns","calendar","infrastructure","work-monitor","bead-studio"];
  ceo.tools=modules.map(tool);clo.tools=modules.map(tool);
  await save(d=>{d.workspaces.push(ceo,clo);d.activeId=ceo.id;});await reload();
  await command("/window/rect",{width:1400,height:950});
  const sourceItem={id:crypto.randomUUID(),name:"CEO专属采购",amount:"1",category:"其他",checked:false,source:"manual",sourceLabel:null,sourceId:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  await invoke("set_app_state",{personalScope:ceo.id,key:"tideplan.purchase-list.v1",value:[sourceItem]});
  await invoke("set_app_state",{personalScope:clo.id,key:"tideplan.purchase-list.v1",value:[]});
  const first=await invoke("bootstrap_app_state",{personalScope:ceo.id,legacy:{}}),second=await invoke("bootstrap_app_state",{personalScope:clo.id,legacy:{}});
  assert.equal(first["tideplan.purchase-list.v1"][0].name,sourceItem.name);assert.deepEqual(second["tideplan.purchase-list.v1"],[]);
  await invoke("create_task",{personalScope:ceo.id,mutation:mutation("无归属应拒绝")},true);
  await invoke("create_task",{personalScope:ceo.id,taskOwner:"unknown",mutation:mutation("错误归属应拒绝")},true);
  const taskA=await invoke("create_task",{personalScope:ceo.id,taskOwner:ceo.id,mutation:mutation("CEO任务")});
  await invoke("create_task",{personalScope:clo.id,taskOwner:clo.id,mutation:mutation("CLO任务")});
  await invoke("create_task",{personalScope:clo.id,taskOwner:"pending",mutation:mutation("待定任务")});
  const raw=await invoke("list_tasks");assert.equal(raw.length,3);
  await save(d=>{d.activeId=clo.id;});await reload();
  await js("[...document.querySelectorAll('.scene-navigation button')].find(b=>b.textContent.trim()==='所有待办').click();return true");
  await wait(async()=> (await js("return [...document.querySelectorAll('.task-title-row strong')].map(e=>e.textContent)")).length===3,"Tasks missing");
  assert.deepEqual(await js("return [...document.querySelectorAll('.task-title-row strong')].map(e=>e.textContent)"),["CLO任务","待定任务","CEO任务"]);
  const results={};
  // Visit every real tool through UI routing, including native-backed modules.
  for(const label of ["采购清单","AI 食谱","旅行规划","训练计划","人物档案","想法与目标","关键日期","计划日历","主机与服务","工作观察","我的作品","拼豆图纸"]){
    await js("const button=[...document.querySelectorAll('.scene-navigation button')].find(b=>b.textContent.trim()===arguments[0]);if(!button)throw Error('Missing tool '+arguments[0]);button.click();return true",label);
    const expectedTitle=label==="AI 食谱"?"AI 一周食谱":label;
    await wait(()=>js("return document.querySelector('main h1')?.textContent===arguments[0] && !document.querySelector('main')?.textContent.includes('正在打开')",expectedTitle),`Tool ${label} did not settle`);
    const text=await js("return document.querySelector('main').textContent");
    assert.ok(!text.includes("页面暂时无法打开")&&!text.includes("加载失败"),`Tool ${label} failed`);results[label]=true;
  }
  assert.deepEqual(await invoke("get_work_dashboard",{personalScope:clo.id}).then(r=>r.projects),[]);
  assert.equal((await invoke("get_map_settings",{personalScope:clo.id})).configured,false);
  await invoke("save_map_settings",{personalScope:ceo.id,key:"synthetic-workspace-map-key",clear:false});
  assert.equal((await invoke("get_map_settings",{personalScope:ceo.id})).configured,true);
  assert.equal((await invoke("get_map_settings",{personalScope:clo.id})).configured,false);
  const hostId=crypto.randomUUID(),hostUrl="https://workspace-qa.invalid/metrics";
  await invoke("save_host_credential",{personalScope:ceo.id,hostId,url:hostUrl,token:"synthetic_qa_token_".padEnd(40,"x")});
  assert.equal(await invoke("host_credential_configured",{personalScope:ceo.id,hostId,url:hostUrl}),true);
  assert.equal(await invoke("host_credential_configured",{personalScope:clo.id,hostId,url:hostUrl}),false);
  const configA=(await invoke("get_work_dashboard",{personalScope:ceo.id})).config;
  await invoke("save_work_monitor_config",{personalScope:ceo.id,config:{...configA,scheduleTime:"08:45"}});
  assert.equal((await invoke("get_work_dashboard",{personalScope:ceo.id})).config.scheduleTime,"08:45");
  assert.notEqual((await invoke("get_work_dashboard",{personalScope:clo.id})).config.scheduleTime,"08:45");
  await save(d=>{d.workspaces.find(w=>w.id===ceo.id).tools.find(t=>t.module==="shopping-list").archived=true;});
  await invoke("set_app_state",{personalScope:ceo.id,key:"tideplan.purchase-list.v1",value:[]},true);
  await save(d=>{d.workspaces.find(w=>w.id===ceo.id).tools.find(t=>t.module==="shopping-list").archived=false;});
  assert.equal((await invoke("bootstrap_app_state",{personalScope:ceo.id,legacy:{}}))["tideplan.purchase-list.v1"][0].name,sourceItem.name);
  const backup=await invoke("export_personal_backup");assert.equal(backup.document.taskOwners[taskA.id],ceo.id);
  await invoke("set_app_state",{personalScope:ceo.id,key:"tideplan.purchase-list.v1",value:[]});
  await invoke("restore_personal_backup",{backup});await reload();
  assert.equal((await invoke("bootstrap_app_state",{personalScope:ceo.id,legacy:{}}))["tideplan.purchase-list.v1"][0].name,sourceItem.name);
  await save(d=>{d.workspaces.find(w=>w.id===clo.id).name="自由命名";});
  assert.equal((await live()).workspaces.find(w=>w.id===clo.id).name,"自由命名");
  await save(d=>{d.workspaces.find(w=>w.id===clo.id).deleted=true;d.activeId="main";});await reload();
  doc=await live();assert.equal((await invoke("list_tasks")).length,3);assert.equal(Object.values(doc.taskOwners).filter(v=>v==="pending").length,2);
  await invoke("bootstrap_app_state",{personalScope:clo.id,legacy:{}},true);
  await screenshot("personal-workspaces-native-home");
  await request(`/session/${session}`,undefined,"DELETE");session=null;
  session=(await request("/session",{capabilities:{alwaysMatch:{"webkitgtk:browserOptions":{binary:path.resolve(binary)}}}})).sessionId;
  await wait(()=>js("return !!document.querySelector('.personal-home')"),"Relaunch failed");
  assert.equal((await invoke("list_tasks")).length,3);assert.equal((await live()).workspaces.filter(w=>!w.deleted).length,2);
  const evidence={version:"0.19.0",root,mainProtected:true,zeroTools:true,requiredOwnership:true,sharedTaskCount:3,currentWorkspaceFirst:true,tools:results,storageIsolation:true,configIsolation:{map:true,hostCredentials:true,workMonitor:true},backupRestore:true,rename:true,deleteReassigns:true,relaunch:true,latestFrontend:true,at:new Date().toISOString()};
  await writeFile("output/playwright/personal-workspaces-native-evidence.json",JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
  }
} finally {
  if(session)await request(`/session/${session}`,undefined,"DELETE").catch(()=>{});
  if(driver.exitCode===null)driver.kill("SIGTERM");if(bus.exitCode===null)bus.kill("SIGTERM");
  const currentAutostart=await readFile(autostartPath,"utf8").catch(error=>{if(error.code!=="ENOENT")throw error;return "";});
  if(currentAutostart.includes(path.resolve(binary))) {
    if(previousAutostart)await writeFile(autostartPath,previousAutostart);
    else await rm(autostartPath,{force:true});
  }
}
