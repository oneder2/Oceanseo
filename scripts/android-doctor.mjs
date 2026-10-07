import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "OK" : "MISSING"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
}
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const java = process.env.JAVA_HOME;
const ndk = process.env.NDK_HOME;
check("JAVA_HOME", !!java && existsSync(join(java, "bin", "java")), "使用 JDK 17 或 21");
check("Java compiler", !!java && existsSync(join(java, "bin", "javac")), "需要完整 JDK，只有 JRE 无法打包 APK");
check("ANDROID_HOME", !!sdk && existsSync(sdk));
check("NDK_HOME", !!ndk && existsSync(join(ndk, "source.properties")));
check("Android SDK 36", !!sdk && existsSync(join(sdk, "platforms", "android-36")));
check("Android build-tools", !!sdk && existsSync(join(sdk, "build-tools")) && readdirSync(join(sdk, "build-tools")).length > 0);
const targets = spawnSync("rustup", ["target", "list", "--installed"], { encoding: "utf8" });
check("Rust aarch64-linux-android", targets.status === 0 && targets.stdout.includes("aarch64-linux-android"));
check("Android project", existsSync("src-tauri/gen/android/app/build.gradle.kts"));
if (sdk) {
  const devices = spawnSync(join(sdk, "platform-tools", "adb"), ["devices"], { encoding: "utf8" });
  // Device identifiers are intentionally omitted from the diagnostic report.
  console.log(`INFO 可用测试设备: ${(devices.stdout?.match(/\tdevice\b/g) || []).length}（不影响离线构建）`);
}
console.log(failures ? "补齐以上环境后运行 npm run android:build。" : "构建环境就绪：npm run android:build。产物使用调试签名，仅供内测。");
process.exitCode = failures ? 1 : 0;
