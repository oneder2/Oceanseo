// Install the verified personal DEB for this user; no root access or app stop.
import { access, copyFile, mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
const exec = promisify(execFile);
const [deb] = process.argv.slice(2);
if (!deb) throw Error("Supply the verified personal DEB");
const version = (await exec("dpkg-deb",["-f",deb,"Version"])).stdout.trim();
const name = (await exec("dpkg-deb",["-f",deb,"Package"])).stdout.trim();
const personalVersion = JSON.parse(await readFile(new URL("../src-tauri/tauri.personal-workspaces.conf.json", import.meta.url), "utf8")).version;
if (name !== "tideplan" || version !== personalVersion) throw Error("Unexpected personal package");
const home = os.homedir();
const installRoot = path.join(home,".local/opt/oceanseo-personal",version);
const stage = `${installRoot}.staging-${Date.now()}`;
await mkdir(stage,{recursive:true,mode:0o700});
await exec("dpkg-deb",["-x",path.resolve(deb),stage]);
await access(path.join(stage,"usr/bin/tideplan"));
try { await access(installRoot); throw Error("Version directory already exists; preserve it and use a new release version"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
await rename(stage,installRoot);
const binary = path.join(installRoot,"usr/bin/tideplan");
const applications = path.join(home,".local/share/applications");
const bin = path.join(home,".local/bin");
await mkdir(applications,{recursive:true});await mkdir(bin,{recursive:true});
const stamp = new Date().toISOString().replace(/[:.]/g,"-");
const backups=[];
async function preserve(file) {
  const backup=`${file}.before-workspaces-${stamp}`;
  try { await copyFile(file,backup);backups.push({file,backup}); } catch(error) { if(error.code!=="ENOENT")throw error; }
}
async function replace(file,body) {
  await preserve(file);
  const temp=`${file}.tmp-${process.pid}`;await writeFile(temp,body,{mode:0o644});await rename(temp,file);
}
// Both the menu launcher and explicit oceanseo:// handler resolve to this
// persistent install, never to a Cargo cache which cleanup may remove.
let desktop=await readFile(path.join(installRoot,"usr/share/applications/Tideplan.desktop"),"utf8");
desktop=desktop.replace(/^Exec=.*$/m,`Exec="${binary}" %u`).replace(/^Name=.*$/m,"Name=Oceanseo").replace(/^Comment=.*$/m,"Comment=个人工作区、模块工具与共享待办");
const icon = path.join(installRoot,"usr/share/icons/hicolor/128x128/apps/tideplan.png");
try { await access(icon); desktop=desktop.replace(/^Icon=.*$/m,`Icon=${icon}`); } catch(error) { if(error.code!=="ENOENT")throw error; }
await replace(path.join(applications,"Tideplan.desktop"),desktop);
await replace(path.join(applications,"tideplan-handler.desktop"),`[Desktop Entry]\nType=Application\nName=Oceanseo\nTerminal=false\nNoDisplay=true\nMimeType=x-scheme-handler/oceanseo\nExec="${binary}" %u\n`);
const launcher=path.join(bin,"tideplan");
await replace(launcher,`#!/bin/sh\nexec '${binary.replaceAll("'","'\\''")}' "$@"\n`);await chmod(launcher,0o755);
const autostart = path.join(home,".config/autostart/Tideplan.desktop");
try {
  const previous=await readFile(autostart,"utf8");
  await replace(autostart,previous.replace(/^Exec=.*$/m,`Exec="${binary}"`));
} catch(error) { if(error.code!=="ENOENT")throw error; }
try { await exec("update-desktop-database",[applications]); } catch(error) { if(error.code!=="ENOENT")throw error; }
await preserve(path.join(home,".config/mimeapps.list"));
await preserve(path.join(applications,"mimeapps.list"));
await exec("xdg-mime",["default","Tideplan.desktop","x-scheme-handler/oceanseo"]);
const evidence={version,package:path.resolve(deb),installRoot,binary,desktop:path.join(applications,"Tideplan.desktop"),backups,at:new Date().toISOString(),runningApplicationStopped:false};
await mkdir("docs/execution",{recursive:true});await writeFile(`docs/execution/personal-workspaces-install-${version}.json`,JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence));
