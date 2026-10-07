# 下载页发布记录（2026-10-07）

本次发布只更新静态下载页与隐私页，不替换公网现有的 0.18.0 Android/Linux 安装包。

## 构建与部署

- 构建命令：`npm run landing:build`
- 部署命令：`bash services/deployment/deploy-landing.sh`
- 线上活动目录：`/var/www/oceanseo/releases/web-20261007T023929Z`
- 发布域名：`https://oceanseo.gellaronline.cc/`
- Git 提交：`1ee554e docs: clarify account deletion privacy flow`

部署脚本重新校验了既有安装包的 SHA-256，并在 Caddy 校验通过后原子切换活动目录；没有上传源代码、配置文件或密钥。

## 验收

- `scripts/landing-public-check.mjs`：首页、隐私页、媒体、字体、下载文件和安全边界通过；APK/DEB 全量与 Range 下载散列一致。
- `services/deployment/verify-live.py`：`/health`、`/health/accounts`、`/health/sync` 返回 200；未授权业务接口与 `/metrics` 返回 401。
- Playwright landing smoke：320、390、768、1440、1920px 无横向溢出；键盘焦点、弹窗、下载、剪贴板校验值、健康异常态和隐私页通过。
- Playwright no-JS smoke：静态下载和隐私页通过。
- GitHub Actions Release readiness：run `37563196707`，结果为 success。

本记录不代表已经生成正式签名 Android APK/AAB；正式 keystore、异地备份和真机解锁验收仍是内测发布门槛。

## Android 候选构建（未发布）

2026-10-07 本机运行 `npm run android:doctor` 与 `npm run android:build` 成功。候选 APK 位于：

`src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`

- 包名：`com.tideplan.mobile.debug`
- 版本：`0.18.0-internal`，versionCode `1800`
- 架构：ARM64；16 KB ZIP 对齐通过
- 调试证书 SHA-256：`bf0f8fba77581487229bcf6a6507c2a88c8629a605f147d64f3c591f51529630`
- 本次候选 SHA-256：`5919b73715a47702266764c9986c84c8dc0cd7b66e6e0245f54e6f03a29ab60c`

现有公网 0.18.0 APK 的 SHA-256 为 `37f013e8da37afaee137b14fbf15651647e492b4d31c5bbdf97a7347c6b12adf`。交付脚本因此拒绝用同版本不同字节的候选覆盖公网文件；候选仍需解锁真机验收并经明确批准后才能进入新的发布版本。
