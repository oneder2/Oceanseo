// Unpacks and runs the actual DEB with private XDG roots; never installs it.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import net from 'node:net';

const execute=promisify(execFile), [deb, driverPath]=process.argv.slice(2);
assert.ok(deb&&driverPath,'Supply the QA DEB and WebKitWebDriver');
const root=await mkdtemp('/tmp/oceanseo-package-native-');
await execute('dpkg-deb',['-x',deb,`${root}/package`]);
const binary=`${root}/package/usr/bin/oceanseo-moduleqa`;
const fields=await execute('dpkg-deb',['-f',deb,'Package','Architecture']);
assert.match(fields.stdout,/Package: oceanseo-module-qa/);
assert.match(fields.stdout,/Architecture: amd64/);
const files=(await execute('dpkg-deb',['-c',deb])).stdout;
assert.ok(!files.includes('./usr/bin/tideplan'));
const desktop=await readFile(`${root}/package/usr/share/applications/Oceanseo Module QA.desktop`,'utf8');
assert.match(desktop,/Exec=oceanseo-moduleqa/);
assert.ok(!desktop.includes('x-scheme-handler/oceanseo;'));
for(const dir of ['data','config','cache'])await mkdir(`${root}/${dir}`,{mode:0o700});
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))})});
const driver=spawn(driverPath,[`--port=${port}`],{env:{...process.env,XDG_DATA_HOME:`${root}/data`,XDG_CONFIG_HOME:`${root}/config`,XDG_CACHE_HOME:`${root}/cache`,TAURI_WEBVIEW_AUTOMATION:'true'},stdio:'ignore'});
let session;
async function wait(check,message){const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,150))}throw Error(message)}
async function request(route,body,method='POST'){
 const response=await fetch(`http://127.0.0.1:${port}${route}`,{method,signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const result=await response.json();assert.ok(response.ok,result.value?.message??'WebDriver failed');return result.value;
}
const js=(script,...args)=>request(`/session/${session}/execute/sync`,{script,args});
async function ipc(name,args={}){const result=await request(`/session/${session}/execute/async`,{script:'const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({error:String(error)}))',args:[name,args]});assert.ok(!result.error,result.error);return result.value;}
async function ownPids(){try{return(await execute('pgrep',['-f',`^${binary}$`])).stdout.trim().split(/\s+/).map(Number)}catch(error){if(error.code===1)return[];throw error}}
async function close(){for(const pid of await ownPids())process.kill(pid,'SIGTERM');await wait(async()=>!(await ownPids()).length,'QA package process did not close');if(session){await request(`/session/${session}`,undefined,'DELETE').catch(()=>{});session=undefined}}
async function open(){const value=await request('/session',{capabilities:{alwaysMatch:{'webkitgtk:browserOptions':{binary}}}});session=value.sessionId;await request(`/session/${session}/timeouts`,{script:30000});await request(`/session/${session}/window/rect`,{width:1280,height:900});await wait(()=>js('return !!window.__TAURI_INTERNALS__&&document.querySelectorAll("button").length>3'),'Packaged UI did not initialize');assert.equal(await ipc('plugin:path|resolve_directory',{directory:14}),`${root}/data/com.oceanseo.moduleqa`);const url=await js('return location.href');assert.ok(!url.includes(':1420'),`Package used development frontend: ${url}`);return url}
try{
 await wait(async()=>{try{return(await fetch(`http://127.0.0.1:${port}/status`)).ok}catch{return false}},'Driver not ready');
 const firstUrl=await open();assert.deepEqual(await ipc('list_tasks'),[]);
 const task=await ipc('create_task',{mutation:{title:'Standalone packaged QA record',notes:'local',horizon:'short',priority:'normal',startDate:null,dueDate:null}});
 await js('location.reload();return true');await wait(()=>js('return [...document.querySelectorAll("button")].some(el=>el.textContent.trim()==="偏好设置")'),'Preferences entry missing');
 await js('[...document.querySelectorAll("button")].find(el=>el.textContent.trim()==="偏好设置").click();return true');
 await wait(()=>js('return !!document.querySelector(".data-backup-section")'),'Packaged preferences not ready');
 await js('[...document.querySelectorAll(".data-backup-section button")].find(el=>el.textContent.trim()==="查看已有资料").click();return true');
 await wait(()=>js('return document.querySelector(".data-archive")?.textContent.includes("Standalone packaged QA record")'),'Packaged own-data archive missing');
 await wait(()=>js('const panel=document.querySelector(".data-archive"),backdrop=panel?.parentElement;return !!panel&&getComputedStyle(backdrop).opacity>0.99&&panel.getBoundingClientRect().height>280'),'Packaged archive did not become visible');
 assert.equal(await js('return document.elementFromPoint(innerWidth/2,innerHeight/2).closest(".data-archive")!==null'),true);
 assert.equal(await js('const reader=document.querySelector(".archive-reader");return [...reader.querySelectorAll(".archive-text")].some(el=>el.textContent==="local")&&reader.textContent.includes("记录来源")&&reader.textContent.includes("本机记录")&&!reader.textContent.includes("出发地")'),true);
 assert.equal(await js('return document.querySelectorAll(".data-archive input,.data-archive textarea,.data-archive select").length'),0);
 const screenshot=await request(`/session/${session}/screenshot`,undefined,'GET');await writeFile('output/playwright/module-packaged-own-data.png',Buffer.from(screenshot,'base64'));
 await close();const secondUrl=await open();assert.deepEqual(await ipc('list_tasks'),[task]);
 const evidence={passed:true,actualNative:true,actualDeb:true,installedIntoSystem:false,root,package:'oceanseo-module-qa',binary:'oceanseo-moduleqa',identifier:'com.oceanseo.moduleqa',firstUrl,secondUrl,independentFilesAndDeepLink:true,ownArchiveReadOnly:true,coldRestartPreservedRecord:true};
 await writeFile('output/playwright/module-package-native-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await close().catch(()=>{});if(driver.exitCode===null&&driver.signalCode===null){driver.kill('SIGTERM');await new Promise(resolve=>driver.once('exit',resolve))}}
