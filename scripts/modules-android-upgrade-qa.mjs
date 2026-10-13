// Actual old-source personal APK -> new personal APK -> old -> new, without
// changing a physical phone, clearing app data, or copying daily user records.
import assert from "node:assert/strict";
import {spawn,execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,mkdir,readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";

const execute=promisify(execFile),[serial,oldApk,newApk,testApk]=process.argv.slice(2);
assert.equal(serial,"emulator-5590");assert.ok(oldApk&&newApk&&testApk);
const reuseOwnLocal=process.argv.includes("--reuse-own-local");
const pkg="com.tideplan.mobile.debug",testPackage=`${pkg}.test`,cdpPort=9284;
const root=await mkdtemp("/tmp/oceanseo-android-upgrade-");
const session=`android-upgrade-${process.pid}`,wrapper="/home/gellar/.codex/skills/playwright/scripts/playwright_cli.sh";
const adb=async(...args)=>(await execute("adb",["-s",serial,...args],{timeout:60000,maxBuffer:4*1024*1024})).stdout.trim();
const cli=async(...args)=>(await execute("bash",[wrapper,`-s=${session}`,...args],{timeout:60000,maxBuffer:4*1024*1024})).stdout.trim();
const evaluate=async source=>JSON.parse(await cli("eval",source,"--raw"));
const invoke=(name,args={})=>evaluate(`async()=>window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`);
const ui=source=>cli("run-code",`async(page)=>{${source}}`,"--raw");
let endpoint,servicePort,attached=false,forwarded=false,phase="setup";
const digest=async path=>createHash("sha256").update(await readFile(path)).digest("hex");
const evidence={root,actualAndroid:true,physicalDevice:false,serial,package:pkg,oldSourceCommit:"2fe149b96a9114b5b08b3bf1f66c40c842677b5c",oldApk,newApk,testApk,oldApkSha256:await digest(oldApk),newApkSha256:await digest(newApk),testApkSha256:await digest(testApk),publishedArm64ArtifactTested:false,dataCleared:false,gates:[]};
async function wait(check,message,ms=45000){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,150));}throw Error(message);}
async function attach(key){
 console.log(JSON.stringify({phase,profile:key}));
 await cli("detach").catch(()=>{});attached=false;
 let pid;await wait(async()=>{pid=await adb("shell","pidof",pkg).catch(()=>"");return /^\d+$/.test(pid);},"Personal QA app not running");
 await adb("forward",`tcp:${cdpPort}`,`localabstract:webview_devtools_remote_${pid}`);forwarded=true;
 await wait(async()=>{try{return(await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).ok;}catch{return false;}},"Personal WebView not ready");
 await cli("attach",`--cdp=http://127.0.0.1:${cdpPort}`);attached=true;await cli("snapshot");
 await wait(async()=>{try{return(await invoke("get_profile_status")).current.key===key;}catch{return false;}},"Wrong personal profile after upgrade");
 assert.ok((await invoke("plugin:path|resolve_directory",{directory:14})).endsWith(`/${pkg}`));
 await ui("await page.locator('.account-entry').waitFor();await page.waitForFunction(()=>!document.body.innerText.includes('正在读取本机数据'));");
}
async function install(apk,key){await cli("detach").catch(()=>{});attached=false;await adb("shell","am","force-stop",pkg);assert.match(await adb("install","-r",apk),/Success/);await adb("shell","am","start","-n",`${pkg}/com.tideplan.mobile.MainActivity`);await attach(key);}
async function switchUi(key){const oldPid=await adb("shell","pidof",pkg);await ui("await page.locator('.account-entry').click();await page.getByRole('dialog',{name:'我的账号',exact:true}).waitFor();");await ui(`await page.getByLabel('切换资料库',{exact:true}).selectOption(${JSON.stringify(key)});await page.locator('.account-confirm').waitFor();`);await ui("await page.locator('.account-confirm').getByRole('button',{name:/^(确认切换|保存并切换)$/}).click();").catch(()=>{});await wait(async()=>{const pid=await adb("shell","pidof",pkg).catch(()=>"");return pid&&pid!==oldPid;},"Profile switch did not restart Android");await attach(key);}
const mutation=title=>({title,notes:"旧版笔记 normal / local 保留",horizon:"short",priority:"normal",startDate:"2026-10-11",dueDate:"2026-11-01"});
async function seed(kind){
 const existing=kind==="local"&&reuseOwnLocal?(await invoke("list_tasks"))[0]:null;
 const task=existing??await invoke("create_task",{mutation:mutation(`Android old-source ${kind} record`)});
 await invoke("save_ai_settings",{apiKey:`Synthetic-upgrade-ai-${kind}-key`,baseUrl:"https://example.invalid/v1",clearApiKey:false,model:`synthetic-${kind}-model`});
 await invoke("save_map_settings",{key:`Synthetic-upgrade-map-${kind}-key`,clear:false});
 await invoke("set_app_state",{key:"tideplan.bead-pattern.v1",value:{version:1,title:`Old ${kind} pattern`,width:2,height:1,palette:[{hex:"#ed8467",name:"Coral"}],cells:[0,-1]}});
 await invoke("set_app_state",{key:"tideplan.reminders.v1",value:{enabled:false,times:["09:00","19:00"],countdownAdvanceDays:3}});
 await ui("await page.reload();await page.locator('.account-entry').waitFor();await page.waitForFunction(()=>!document.body.innerText.includes('正在读取本机数据'));");
 return {task,backup:await invoke("export_data_backup"),ai:await invoke("get_ai_settings"),map:await invoke("get_map_settings")};
}
async function same(expected){const actual=await invoke("export_data_backup");assert.equal(actual.tasks.length,expected.backup.tasks.length);for(const task of expected.backup.tasks){const current=actual.tasks.find(t=>t.id===task.id);assert.ok(current);for(const[key,value]of Object.entries(task))assert.deepEqual(current[key],value);}for(const[key,value]of Object.entries(expected.backup.appState))assert.deepEqual(actual.appState[key],value);assert.deepEqual(await invoke("get_ai_settings"),expected.ai);assert.deepEqual(await invoke("get_map_settings"),expected.map);}
async function credentials(key){
 await cli("detach").catch(()=>{});attached=false;
 const result=await adb("shell","am","instrument","-w","-e","class","com.tideplan.mobile.MobileUpgradeCredentialTest","-e","qaProfile",key,`${testPackage}/androidx.test.runner.AndroidJUnitRunner`);
 assert.match(result,/OK \(1 test\)/,result);assert.ok(!result.includes("FAILURES"));
 await adb("shell","am","start","-n",`${pkg}/com.tideplan.mobile.MainActivity`);await attach(key);
}
const service=spawn("python3",["-u","-m","scripts.native_policy_qa_service"],{env:{...process.env,QA_ROOT:root},stdio:["ignore","pipe","pipe"]});
try{
 const installed=(await adb("shell","pm","list","packages",pkg)).split("\n");
 if(installed.includes(`package:${pkg}`)){
  assert.ok(reuseOwnLocal,"Refusing an existing personal installation on this emulator");
  await adb("shell","am","start","-n",`${pkg}/com.tideplan.mobile.MainActivity`);await attach("local");
  const previous=await invoke("list_tasks");assert.equal(previous.length,1);
  assert.equal(previous[0].title,"Android old-source local record");
  assert.equal(previous[0].notes,mutation("").notes);
  const ai=await invoke("get_ai_settings");assert.equal(ai.model,"synthetic-local-model");assert.equal(ai.baseUrl,"https://example.invalid/v1");
  evidence.reusedOnlyOwnSyntheticLocal=true;
 }
 const buildTools="/home/gellar/Android/Sdk/build-tools/36.1.0";
 const certificates=[];
 for(const[apk,expected]of [[oldApk,pkg],[newApk,pkg],[testApk,testPackage]]){
  const metadata=(await execute(`${buildTools}/aapt`,["dump","badging",apk])).stdout;
  assert.equal(metadata.match(/^package: name='([^']+)'/m)?.[1],expected,"APK targets the wrong installation");
  const signature=(await execute(`${buildTools}/apksigner`,["verify","--print-certs",apk])).stdout;
  certificates.push(signature.match(/certificate SHA-256 digest: ([a-f0-9]+)/)?.[1]);
 }
 assert.ok(certificates.every(c=>c==="bf0f8fba77581487229bcf6a6507c2a88c8629a605f147d64f3c591f51529630"));
 evidence.certificateSha256=certificates[0];
 const setup=await new Promise((resolve,reject)=>{let raw="";service.stdout.on("data",chunk=>{raw+=chunk;if(raw.includes("\n"))resolve(JSON.parse(raw.split("\n")[0]));});service.once("error",reject);service.once("exit",()=>reject(Error("Private upgrade service exited")));});servicePort=setup.port;endpoint=`http://127.0.0.1:${servicePort}`;
 await adb("reverse",`tcp:${servicePort}`,`tcp:${servicePort}`);
 phase="old-source-local";await install(oldApk,"local");await adb("shell","pm","grant",pkg,"android.permission.POST_NOTIFICATIONS");if(!reuseOwnLocal)assert.deepEqual(await invoke("list_tasks"),[]);
 const missing=await evaluate("async()=>{try{await window.__TAURI_INTERNALS__.invoke('get_module_capabilities');return false;}catch(e){return String(e)==='Command get_module_capabilities not found';}}");assert.equal(missing,true,"Old APK unexpectedly contains the new policy commands");
 const local=await seed("local");await writeFile(`${root}/old-local-snapshot.json`,JSON.stringify(local));
 const selected=await invoke("sign_in_account",{input:{endpoint,username:"qa-owner",password:"Synthetic-policy-native-123!",deviceName:"Old personal Android compatibility",invite:null}});await switchUi(selected.key);await invoke("set_automatic_sync_enabled",{profileKey:selected.key,enabled:false});
 const account=await seed("account");const oldPlan=await invoke("preview_sync");await invoke("commit_sync",{previewId:oldPlan.previewId,choices:{}});account.backup=await invoke("export_data_backup");await writeFile(`${root}/old-account-snapshot.json`,JSON.stringify(account));
 phase="new-personal-upgrade";await install(newApk,selected.key);assert.equal((await invoke("refresh_module_capabilities")).source,"verified");await same(account);assert.equal((await invoke("get_sync_status")).linked,true);
 const newPlan=await invoke("preview_sync");await invoke("commit_sync",{previewId:newPlan.previewId,choices:{}});await same(account);
 assert.match(await adb("install","-r",testApk),/Success/);await credentials(selected.key);
 evidence.gates.push({gate:"old-personal-android-in-place-upgrade",sameApplicationId:true,oldDefaultProfileKeyPreserved:true,recordsNotesDatesAndPatternPreserved:true,realOldAndNewHttpSync:true,fullAiAndMapKeysDecryptedWithExistingKeystore:true});
 phase="return-old-personal";await install(oldApk,selected.key);await same(account);await invoke("create_task",{mutation:mutation("Android old-source after return record")});await ui("await page.reload();await page.locator('.account-entry').waitFor();");account.backup=await invoke("export_data_backup");
 phase="second-new-upgrade";await install(newApk,selected.key);await same(account);await credentials(selected.key);evidence.gates.push({gate:"android-old-binary-return-and-second-upgrade",oldSchemaReadable:true,oldWritesPreserved:true,credentialsStillDecrypt:true});
 phase="new-original-local";await switchUi("local");await same(local);await credentials("local");evidence.gates.push({gate:"android-original-local-preserved",localSeparateFromAccount:true,fullLocalAiAndMapKeysDecrypt:true,coldRestart:true});
 await mkdir("output/playwright",{recursive:true});await writeFile("output/playwright/module-android-upgrade-evidence.json",JSON.stringify({...evidence,passed:true},null,2));console.log(JSON.stringify({passed:true,root,gates:evidence.gates.length,physicalDevice:false,publishedArm64ArtifactTested:false}));
}catch(error){await mkdir("output/playwright",{recursive:true});await writeFile("output/playwright/module-android-upgrade-failure.json",JSON.stringify({...evidence,phase,error:String(error)},null,2));throw error;}
finally{if(attached)await cli("detach").catch(()=>{});if(forwarded)await adb("forward","--remove",`tcp:${cdpPort}`).catch(()=>{});if(servicePort)await adb("reverse","--remove",`tcp:${servicePort}`).catch(()=>{});if(service.exitCode===null&&service.signalCode===null){service.kill("SIGTERM");await new Promise(resolve=>service.once("exit",resolve));}}
