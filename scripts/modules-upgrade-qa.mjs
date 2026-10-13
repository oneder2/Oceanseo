// Real old personal DEB -> candidate -> old DEB roundtrip in private XDG roots.
// Never installs a package, copies daily data, or launches a downstream adapter.
import assert from "node:assert/strict";
import {mkdtemp,mkdir,copyFile,readFile,writeFile} from "node:fs/promises";
import {spawn,execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHash} from "node:crypto";
import net from "node:net";

const execute=promisify(execFile),[oldDeb,candidateSource,driverPath,evidencePrefix="output/playwright/module-upgrade"]=process.argv.slice(2);
assert.ok(oldDeb&&candidateSource&&driverPath,"Supply an old personal DEB/binary, current personal binary and WebKitWebDriver");
const root=await mkdtemp("/tmp/oceanseo-upgrade-native-");
const actualOldDeb=oldDeb.endsWith(".deb");
if(actualOldDeb)await execute("dpkg-deb",["-x",oldDeb,`${root}/old`]);
else{await mkdir(`${root}/old/usr/bin`,{recursive:true});await copyFile(oldDeb,`${root}/old/usr/bin/tideplan`);}
await mkdir(`${root}/candidate`);await copyFile(candidateSource,`${root}/candidate/tideplan`);
for(const dir of ["data","config","cache"])await mkdir(`${root}/${dir}`,{mode:0o700});
const oldBinary=`${root}/old/usr/bin/tideplan`,candidate=`${root}/candidate/tideplan`;
// App identifiers remain exactly personal. Isolate its single-instance D-Bus
// name as well as its files; XDG roots alone cannot separate two personal apps.
const bus=spawn("dbus-daemon",["--session","--nofork","--print-address=1"],{stdio:["ignore","pipe","ignore"]});
const dbusAddress=await new Promise((resolve,reject)=>{let raw="";bus.stdout.on("data",chunk=>{raw+=chunk;if(raw.includes("\n"))resolve(raw.split("\n")[0]);});bus.once("error",reject);bus.once("exit",()=>reject(Error("Private D-Bus exited")));});
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const driver=spawn(driverPath,[`--port=${port}`],{env:{...process.env,DBUS_SESSION_BUS_ADDRESS:dbusAddress,XDG_DATA_HOME:`${root}/data`,XDG_CONFIG_HOME:`${root}/config`,XDG_CACHE_HOME:`${root}/cache`,TAURI_WEBVIEW_AUTOMATION:"true"},stdio:"ignore"});
const service=spawn("python3",["-u","-m","scripts.native_policy_qa_service"],{env:{...process.env,QA_ROOT:root},stdio:["ignore","pipe","pipe"]});
let session,binary,endpoint,legacyWithoutAccounts=false;
const evidence={root,actualNative:true,actualOldDeb,systemInstalled:false,sourceDailyData:false,isolatedDbus:true,identifier:"com.tideplan.desktop",oldSource:oldDeb,oldSourceSha256:createHash("sha256").update(await readFile(oldDeb)).digest("hex"),candidateSha256:createHash("sha256").update(await readFile(candidate)).digest("hex"),gates:[]};
async function wait(check,message,ms=45000){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,150));}throw Error(message);}
async function request(route,body,method="POST"){
 const response=await fetch(`http://127.0.0.1:${port}${route}`,{method,signal:AbortSignal.timeout(route==="/session"?45000:20000),headers:{"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const value=await response.json();assert.ok(response.ok,value.value?.message??"WebDriver failed");return value.value;
}
const js=(script,...args)=>request(`/session/${session}/execute/sync`,{script,args});
async function ipc(name,args={},allowMissing=false){const value=await request(`/session/${session}/execute/async`,{script:"const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({error:String(error)}));",args:[name,args]});if(allowMissing&&value.error===`Command ${name} not found`)return undefined;assert.ok(!value.error,value.error);return value.value;}
async function ownPids(){if(!binary)return[];try{return(await execute("pgrep",["-f",`^${binary}$`])).stdout.trim().split(/\s+/).map(Number);}catch(error){if(error.code===1)return[];throw error;}}
async function close(){for(const pid of await ownPids())process.kill(pid,"SIGTERM");await wait(async()=>!(await ownPids()).length,"Private upgrade process did not exit");if(session){await request(`/session/${session}`,undefined,"DELETE").catch(()=>{});session=undefined;}}
async function open(path,key){binary=path;console.log(JSON.stringify({stage:path===oldBinary?"old-personal-package":"candidate-personal-binary",key}));const result=await request("/session",{capabilities:{alwaysMatch:{"webkitgtk:browserOptions":{binary}}}});session=result.sessionId;await request(`/session/${session}/timeouts`,{script:60000});await wait(()=>js("return !!window.__TAURI_INTERNALS__&&document.querySelectorAll('button').length>3&&!document.body.innerText.includes('正在读取本机数据')"),"Personal upgrade UI did not hydrate");assert.equal(await ipc("plugin:path|resolve_directory",{directory:14}),`${root}/data/com.tideplan.desktop`);const profile=await ipc("get_profile_status",{},path===oldBinary);if(profile)assert.equal(profile.current.key,key);else{assert.equal(key,"local");legacyWithoutAccounts=true;}}
async function reload(){await js("location.reload();return true");await wait(()=>js("return document.querySelectorAll('button').length>3&&!document.body.innerText.includes('正在读取本机数据')"),"Reload failed");}
const mutation=title=>({title,notes:"原文 normal / local；旧版笔记",horizon:"short",priority:"normal",startDate:"2026-10-11",dueDate:"2026-11-01"});
function sameData(actual,expected){assert.equal(actual.tasks.length,expected.tasks.length);for(const task of expected.tasks){const current=actual.tasks.find(t=>t.id===task.id);assert.ok(current);for(const[key,value]of Object.entries(task))assert.deepEqual(current[key],value);}for(const[key,value]of Object.entries(expected.appState))assert.deepEqual(actual.appState[key],value);}
try{
 const setup=await new Promise((resolve,reject)=>{let raw="";service.stdout.on("data",chunk=>{raw+=chunk;if(raw.includes("\n"))resolve(JSON.parse(raw.split("\n")[0]));});service.once("error",reject);service.once("exit",()=>reject(Error("Upgrade fixture exited")));});endpoint=`http://127.0.0.1:${setup.port}`;
 await wait(async()=>{try{return(await fetch(`http://127.0.0.1:${port}/status`)).ok;}catch{return false;}},"WebDriver not ready");
 await open(oldBinary,"local");
 const original=await ipc("create_task",{mutation:mutation("Old local record")});
 if(legacyWithoutAccounts){
  await ipc("save_ai_settings",{apiKey:"synthetic-upgrade-provider-key",baseUrl:"https://example.com/v1",clearApiKey:false,model:"synthetic-model"});
  await ipc("save_map_settings",{key:"synthetic-upgrade-map-key",clear:false});
  await ipc("set_app_state",{key:"tideplan.bead-pattern.v1",value:{version:1,title:"旧图纸",width:2,height:1,palette:[{hex:"#ed8467",name:"Coral"}],cells:[0,-1]}});
  await ipc("set_app_state",{key:"tideplan.reminders.v1",value:{enabled:false,times:["09:00","19:00"],countdownAdvanceDays:3}});
  await reload();const before=await ipc("export_data_backup"),ai=await ipc("get_ai_settings"),maps=await ipc("get_map_settings");
  await close();await open(candidate,"local");sameData(await ipc("export_data_backup"),before);assert.deepEqual(await ipc("get_ai_settings"),ai);assert.deepEqual(await ipc("get_map_settings"),maps);
  await close();await open(oldBinary,"local");sameData(await ipc("export_data_backup"),before);
  await ipc("create_task",{mutation:mutation("Old offline package after candidate")});await reload();const updated=await ipc("export_data_backup");
  await close();await open(candidate,"local");sameData(await ipc("export_data_backup"),updated);
  evidence.gates.push({gate:"old-offline-deb-upgrade-return-and-second-upgrade",oldTaskFieldsAndAppStatePreserved:true,aiAndMapCredentialsPreserved:true,notesAndDatesPreserved:true,oldSchemaReadableAfterCandidate:true,oldWritesReadableAfterSecondUpgrade:true,accountsAbsentInThisOldArtifact:true});
 }else{
 await reload();const localBefore=await ipc("export_data_backup");
 const selected=await ipc("sign_in_account",{input:{endpoint,username:"qa-owner",password:"Synthetic-policy-native-123!",deviceName:"Old compatibility QA",invite:null}});
 const oldIdentity=JSON.parse(await readFile(`${root}/data/com.tideplan.desktop/profiles/${selected.key}/account-session.json`,"utf8"));
 assert.equal(selected.key,createHash("sha256").update(`${endpoint}\n${oldIdentity.userId}`).digest("hex"));
 // Read only the exact synthetic account created above, never a daily credential.
 assert.match(selected.key,/^[a-f0-9]{64}$/);
 await ipc("select_local_profile",{key:selected.key,expectedCurrent:"local"});await close();await open(oldBinary,selected.key);
 await ipc("set_automatic_sync_enabled",{profileKey:selected.key,enabled:false});
 const task=await ipc("create_task",{mutation:mutation("Old account record")});
 await ipc("save_ai_settings",{apiKey:"synthetic-upgrade-provider-key",baseUrl:"https://example.com/v1",clearApiKey:false,model:"synthetic-model"});
 await ipc("save_map_settings",{key:"synthetic-upgrade-map-key",clear:false});
 const pattern={version:1,title:"旧图纸",width:2,height:1,palette:[{hex:"#ed8467",name:"Coral"}],cells:[0,-1]};
 await ipc("set_app_state",{key:"tideplan.bead-pattern.v1",value:pattern});
 await ipc("set_app_state",{key:"tideplan.reminders.v1",value:{enabled:false,times:["09:00","19:00"],countdownAdvanceDays:3}});
 await reload();
 const plan=await ipc("preview_sync");await ipc("commit_sync",{previewId:plan.previewId,choices:{}});
 const before=await ipc("export_data_backup"),aiBefore=await ipc("get_ai_settings"),mapBefore=await ipc("get_map_settings"),syncBefore=await ipc("get_sync_status");
 assert.ok(syncBefore.linked);assert.ok(before.tasks.some(t=>t.id===task.id));
 await close();await open(candidate,selected.key);await ipc("refresh_module_capabilities");
 sameData(await ipc("export_data_backup"),before);assert.deepEqual(await ipc("get_ai_settings"),aiBefore);assert.deepEqual(await ipc("get_map_settings"),mapBefore);assert.equal((await ipc("get_sync_status")).linked,true);
 const policy=await ipc("get_module_capabilities");assert.equal(policy.source,"verified");assert.equal(policy.edition,"personal");
 const candidatePlan=await ipc("preview_sync");await ipc("commit_sync",{previewId:candidatePlan.previewId,choices:{}});
 sameData(await ipc("export_data_backup"),before);
 evidence.gates.push({gate:"old-personal-account-upgrade",legacyKeyPreserved:true,exactRecordsAndAppState:true,notesAndDatesPreserved:true,aiAndMapCredentialsPreserved:true,oldHttpLoginAndSync:true,newHttpSync:true,policyNegotiated:true});
 await close();await open(oldBinary,selected.key);sameData(await ipc("export_data_backup"),before);assert.deepEqual(await ipc("get_ai_settings"),aiBefore);assert.deepEqual(await ipc("get_map_settings"),mapBefore);
 const oldAgain=await ipc("create_task",{mutation:mutation("Old client after candidate")});await reload();const afterOld=await ipc("export_data_backup");
 await close();await open(candidate,selected.key);sameData(await ipc("export_data_backup"),afterOld);assert.ok((await ipc("list_tasks")).some(t=>t.id===oldAgain.id));
 evidence.gates.push({gate:"old-binary-return-and-second-upgrade",oldSchemaAndSessionReadable:true,oldClientWritesStillWork:true,candidateReadsOldWrites:true});
 await ipc("select_local_profile",{key:"local",expectedCurrent:selected.key});await close();await open(candidate,"local");sameData(await ipc("export_data_backup"),localBefore);assert.deepEqual(await ipc("list_tasks"),[original]);
 evidence.gates.push({gate:"original-local-profile-preserved",separateFromAccount:true,coldRestart:true});
 }
 await writeFile(`${evidencePrefix}${actualOldDeb?"-deb":"-binary"}-evidence.json`,JSON.stringify({...evidence,passed:true},null,2));console.log(JSON.stringify({passed:true,gates:evidence.gates.length,root,actualOldDeb,systemInstalled:false}));
}catch(error){await writeFile(`${evidencePrefix}${actualOldDeb?"-deb":"-binary"}-failure.json`,JSON.stringify({...evidence,error:String(error)},null,2));throw error;}
finally{await close().catch(()=>{});for(const child of [service,driver,bus])if(child.exitCode===null&&child.signalCode===null){child.kill("SIGTERM");await new Promise(resolve=>child.once("exit",resolve));}}
