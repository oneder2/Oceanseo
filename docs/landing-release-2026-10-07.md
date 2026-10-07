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
