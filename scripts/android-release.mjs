import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";

const names = ["TIDEPLAN_KEYSTORE_PATH", "TIDEPLAN_KEYSTORE_PASSWORD", "TIDEPLAN_KEY_ALIAS", "TIDEPLAN_KEY_PASSWORD"];
const missing = names.filter(name => !process.env[name]);
const path = process.env.TIDEPLAN_KEYSTORE_PATH;
if (missing.length || !path || !isAbsolute(path) || !existsSync(path)) {
  console.error("正式构建需要已有签名密钥。请设置 TIDEPLAN_KEYSTORE_PATH（绝对路径）、TIDEPLAN_KEYSTORE_PASSWORD、TIDEPLAN_KEY_ALIAS、TIDEPLAN_KEY_PASSWORD；不要将密钥或密码提交到仓库。");
  process.exit(1);
}
const result = spawnSync("npm", ["run", "tauri", "--", "android", "build", "--target", "aarch64", "--apk", "--aab", "--ci"], { stdio: "inherit", shell: false });
process.exit(result.status ?? 1);
