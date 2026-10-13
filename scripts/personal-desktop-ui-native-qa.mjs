// W3C WebDriver runs the built Linux app in private XDG directories and D-Bus.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
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

try {
  await wait(async()=>{try{return (await fetch(`${endpoint}/status`)).ok;}catch{return false;}},"WebDriver did not start");
  session=(await request("/session",{capabilities:{alwaysMatch:{"webkitgtk:browserOptions":{binary:path.resolve(binary)}}}})).sessionId;
  await command("/timeouts",{script:60000,implicit:0});
  await wait(()=>js("return !!document.querySelector('.personal-home')"),"Personal Linux home did not load");
  assert.equal(await invoke("plugin:path|resolve_directory",{directory:14}),`${root}/data/com.tideplan.desktop`);
  assert.equal(await invoke("plugin:app|version"),"0.19.1");
  const entry=(await readFile("dist/index.html","utf8")).match(/src="([^"]+\.js)"/)[1];
  const frontendMatches = (await js("return document.querySelector('script[type=module]').src")).endsWith(entry);
  if (mode !== "--diagnostic") assert.ok(frontendMatches,"Native candidate must embed the checked frontend");
  const initial=await live();assert.equal(initial.workspaces.length,1);assert.deepEqual(initial.workspaces[0].tools,[]);
  await js("[...document.querySelectorAll('.scene-navigation button')].find(button=>button.textContent.trim()==='添加工具').click();return true");
  await wait(()=>js("return document.querySelectorAll('.scene-tool-card').length===11"),"Deferred native tool library did not load");
  await js("document.querySelector('[aria-label=\"关闭工作区面板\"]').click();return true");
  await wait(()=>js("return !document.querySelector('.scene-dialog')"),"Tool library did not dismiss");
  const before=await js("return document.querySelector('.scene-navigation').getBoundingClientRect().top");
  await js("document.querySelector('.scene-current').click();return true");
  await wait(()=>js("return !!document.querySelector('.scene-options')"),"Floating menu not mounted");
  assert.equal(await js("return document.querySelector('.scene-navigation').getBoundingClientRect().top"),before);
  assert.ok(await js("return document.querySelector('.scene-options').parentElement===document.body"));
  await screenshot("personal-desktop-ui-native-picker");
  await js("document.querySelector('.scene-options').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true");
  await wait(()=>js("return !document.querySelector('.scene-options') && document.activeElement===document.querySelector('.scene-current')"),"Escape did not dismiss the menu and restore trigger focus");
  await js("document.querySelector('.personal-sidebar-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));return true");
  await wait(()=>js("return document.querySelector('.sidebar').getBoundingClientRect().width===256"),"Native sidebar keyboard resize failed");
  await reload();
  await wait(()=>js("return document.querySelector('.sidebar').getBoundingClientRect().width===256"),"Native sidebar width did not persist after renderer effects settled");
  assert.equal(await js("return document.querySelectorAll('.personal-window-edge').length"),8);
  // Invoke the actual pointer path through XTest, so GTK receives a real button
  // event and the window manager performs resizing (not a DOM style change).
  const rect=await command("/window/rect",undefined,"GET");
  await mkdir("output/playwright",{recursive:true});
  await writeFile("output/playwright/personal-desktop-ui-native-ready.json",JSON.stringify({session,endpoint,root,rect,beforeResize:await js("return {width:innerWidth,height:innerHeight,x:screenX,y:screenY}"),driverPid:driver.pid},null,2));
  console.log(JSON.stringify({nativeReady:true,endpoint,session,rect}));
  await js("window.__resizeEvents=[];document.addEventListener('mousedown',event=>window.__resizeEvents.push({target:event.target.className,x:event.clientX,y:event.clientY}),true);document.addEventListener('mousemove',event=>window.__resizePointer={target:event.target.className,x:event.clientX,y:event.clientY},true);return true");
  await promisify(execFile)("python3",["scripts/personal-desktop-resize-gesture.py","output/playwright/personal-desktop-ui-native-ready.json"],{timeout:30000});
  const gesture=JSON.parse(await readFile("output/playwright/personal-desktop-ui-native-resize-done.json","utf8"));
  assert.ok(gesture.after.width!==gesture.before.width || gesture.after.height!==gesture.before.height,"Real pointer must resize native window");
  assert.ok(await js("return !document.body.textContent.includes('窗口缩放未开始')"));
  await screenshot("personal-desktop-ui-native-resized");
  const dimensions=await js("const el=document.querySelector('main.workspace');return {width:innerWidth,height:innerHeight,scroll:el.scrollWidth,client:el.clientWidth}");
  assert.ok(dimensions.scroll<=dimensions.client+1);
  await command("/window/rect",{width:620,height:560});
  await wait(()=>js("return innerWidth===620"),"Native narrow window did not settle");
  const narrow=await js("const el=document.querySelector('main.workspace');return {width:innerWidth,height:innerHeight,scroll:el.scrollWidth,client:el.clientWidth}");
  assert.ok(narrow.scroll<=narrow.client+1,"Native minimum-width window must not overflow horizontally");
  await screenshot("personal-desktop-ui-native-narrow");
  assert.deepEqual(await live(),initial,"UI resizing must not change workspace data");
  const result={version:"0.19.1",diagnostic:mode === "--diagnostic",isolatedProfile:true,frontendMatches,zeroTools:true,deferredLibrary:true,floatingMenu:true,navigationStable:true,keyboardFocus:true,sidebarResize:true,persistedWidth:true,edgeHandles:8,nativeGesture:gesture,dimensions,narrow};
  await writeFile(`output/playwright/personal-desktop-ui-native-${mode === "--diagnostic" ? "diagnostic-" : ""}result.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {
  if(session)await request(`/session/${session}`,undefined,"DELETE").catch(()=>{});
  driver.kill("SIGTERM");bus.kill("SIGTERM");
  await new Promise(resolve=>{if(driver.exitCode!==null)resolve();else driver.once("exit",resolve);});
  if(previousAutostart!==null)await writeFile(autostartPath,previousAutostart);else await rm(autostartPath,{force:true});
  await rm(root,{recursive:true,force:true});
}
