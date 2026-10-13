import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const json = async file => JSON.parse(await readFile(file, "utf8"));
const pkg = await json("package.json"), lock = await json("package-lock.json");
const base = await json("src-tauri/tauri.conf.json");
const linux = await json("src-tauri/tauri.personal-workspaces.conf.json");
const android = await json("src-tauri/tauri.android.conf.json");
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
assert.equal(base.version, pkg.version);
assert.equal(linux.version, pkg.version);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[""].version, pkg.version);
const cargo = await readFile("src-tauri/Cargo.toml", "utf8");
assert.equal(cargo.match(/^version = "([^"]+)"/m)?.[1], pkg.version);
assert.equal(pkg.license, "MIT");
assert.match(cargo, /^license = "MIT"/m);
const license = await readFile("LICENSE", "utf8");
assert.match(license, /^MIT License/);
assert.equal(await readFile("public/licenses/Oceanseo-MIT.txt", "utf8"), license);
for (const file of ["THIRD_PARTY_NOTICES.md", "public/licenses/bead-palettes-NOTICE.txt", "public/licenses/bead-palettes-Apache-2.0.txt", "public/brand/Outfit-OFL.txt"]) assert.ok((await readFile(file)).length);
assert.equal(base.identifier, "com.tideplan.desktop", "Preserve desktop upgrade identity");
assert.equal(android.identifier, "com.tideplan.mobile", "Preserve historical Android identity");
assert.equal(android.version, "0.18.0", "Linux release must not relabel Android acceptance");
assert.ok(base.app.windows[0].resizable);
assert.deepEqual(linux.bundle.targets, ["deb"]);
const artifact = process.argv[2];
if (artifact) {
  const field = name => execFileSync("dpkg-deb", ["-f", artifact, name], { encoding: "utf8" }).trim();
  assert.equal(field("Version"), pkg.version);
  assert.equal(field("Package"), "tideplan");
  assert.equal(field("Architecture"), "amd64");
  const contents = execFileSync("dpkg-deb", ["--contents", artifact], { encoding: "utf8" });
  for (const file of ["usr/bin/tideplan", "usr/share/doc/tideplan/LICENSE", "usr/share/doc/tideplan/THIRD_PARTY_NOTICES.md", "usr/share/doc/tideplan/public/licenses/bead-palettes-NOTICE.txt", "usr/share/doc/tideplan/public/licenses/bead-palettes-Apache-2.0.txt", "usr/share/doc/tideplan/public/brand/Outfit-OFL.txt"]) assert.ok(contents.split("\n").some(line => line.endsWith(` ${file}`) || line.endsWith(` ./${file}`)), `Missing ${file}`);
}
console.log(JSON.stringify({ version: pkg.version, platform: "linux-amd64-deb", license: "MIT", androidVersion: android.version, artifact: artifact ?? null }));
