# Oceanseo 下载页发布报告

后续更新：2026-10-05 已发布采用统一视觉的 0.18.0 Android/Linux 内测包和新版下载页；2026-10-06 重新构建隐私页并部署静态页，活动目录为 `/var/www/oceanseo/releases/web-20261006T235353Z`。本次保留公开 APK/DEB 字节和 SHA-256，不替换应用下载版本。下文保留首次 0.17 下载页发布时的事实与边界。

日期：2026-10-04（America/New_York，部署操作为次日 UTC）。此次完成下载网站、参考库调研及应用 UI/UX 优化计划，不替换应用业务页面，不重建或冒称 APK 已采用新视觉。不修改包标识、数据库或生态 contracts，不启动 GWorkspace 或其他下游任务。

## 公开入口

- 网站：<https://oceanseo.gellaronline.cc/>。
- 隐私与数据边界：<https://oceanseo.gellaronline.cc/privacy/>。
- Android：`/downloads/Tideplan_0.17.0_android_arm64_internal.apk`，66,942,667 字节，SHA-256 `551440407a866cefe7e32fb9ed5fac76ae4e576a87490c5e7a7561d218696ad2`。
- Linux：`/downloads/Tideplan_0.17.0_amd64.deb`，9,029,490 字节，SHA-256 `cf4e077b0bcf32386f09322819c2c230ca1597682d2323239c0fda1af65e0e23`。
- 两个文件均有相邻 `.sha256` 下载；安装包已逐字节与本地产物校验一致，支持 Range 部分下载。

Android 为 ARM64 / Android 9+ 内部调试签名包，包名 `com.tideplan.mobile.debug`，版本 0.17.0-internal。安装后仍显示「潮汐计划」，不是商店正式版。网站明确告知更新前备份、签名冲突处理、AI 自行配置及私人同步默认关闭；不向下载用户发放维护者令牌。Linux 为 Debian / Ubuntu / Linux Mint 的 amd64 DEB。没有 iOS 包。

## 服务器上有哪些功能

| 功能 | 当前状态与范围 |
| --- | --- |
| 下载网站 | 根路径从首次部署的 404 改为公开静态网站；Android/Linux 下载、扫码、安装提示、隐私说明 |
| 私人同步 `/v1/vault` | 正常，独立令牌；任务与笔记、目标、已保存对话/理解图/交付清单/回执，不是全部生活数据同步 |
| 资源采集 `/metrics` | 正常，独立采集令牌；CPU、内存、磁盘、运行时间、网络等只读采样 |
| 健康检查 `/health` | 公开返回 `ok`；网站只检查此端点，不访问私人采集或资料库 |
| 每日 SQLite 备份 | 现有定时器维持启用；服务器本地备份，不是持续异地备份 |

没有部署网页版应用、公众账户、官方 AI 代理/额度或云端食谱/旅行服务。应用 AI 仍连接用户自行配置的服务商。正式同步库验证时仍 revision 0、0 条记录；本次没有上传真实个人资料或修改任何设备的连接参数。服务器仍有此前系统更新的待重启标记，本次未重启。

## 设计与交互

采用“海玻璃”：雾白、深海墨、海绿、少量珊瑚色；Outfit 自托管展示字体、系统中文正文。品牌优先的全幅真实产品媒体首屏、无框内容带、只含必要信息的下载区。小汐沿用潮汐刺猬品牌资产。

- 页面签名体验为“想法 → 目标 → 行动”三段可切换示例，注明未来交互方向、非在线 AI，不创建或同步记录。
- 当前应用截图来自隔离 `127.0.0.1:1439` 浏览器、当前源代码的 Android 布局和合成数据；不是手机原生实测截图，不包含真实用户记录。完整截图可放大查看；手机图库可原生横向滑动。
- 安装确认、二维码、截图放大使用原生 dialog，加显式 Tab 循环、Escape 关闭和触发点焦点恢复。
- Android 下载说明、平台与版本、字节校验文件、复制 SHA-256、FAQ、服务端点成功/失败/重试均已实现。手机悬浮下载入口仅在主要下载按钮不在视口时出现，避免首屏重复遮挡。
- GSAP core/ScrollTrigger 负责短位移与一次性显现；Lenis 仅桌面细指针、宽度至少 768 px 时启用，不接管弹层和手机滚动。减少动态效果使用原生滚动；后台与弹层暂停 Lenis，离开组件清理实例。内容不靠动画才能可见。
- Vanta 不进入网站或应用，React Bits 只参考交互模式、不分发源码。许可依据与应用分阶段改造见 [优化计划](uiux-oceanseo-plan.md)；发布目录保留第三方许可证通知及 Outfit OFL。

## 实现与部署

沿用 React/Vite，独立 `landing/` 入口，不添加 Next.js、网站 Node 常驻进程或新后端。`scripts/build-landing.mjs` 预渲染主页与隐私页面，下载锚点在禁用 JavaScript 时仍可用。图片为 WebP，二维码本地生成，字体不发第三方请求。

```sh
npm run landing:dev     # http://127.0.0.1:1441
npm run landing:build   # dist-landing/
bash services/deployment/deploy-landing.sh
```

发布脚本校验两个固定版本产物，不静默覆盖既有发行文件。仅打包 `dist-landing` 和明确列出的安装包，不上传源代码或本地连接文件。网站存放 `/var/www/oceanseo/releases/web-<UTC 时间>/`，`/var/www/oceanseo/current` 原子切换；安装包为 `/var/www/oceanseo/downloads/`。Caddy 原配置另存 `/etc/caddy/Caddyfile.before-web-<UTC 时间>`，validate 成功后 reload，reload 失败恢复前配置/已有网站链接。

最终活动目录为 `/var/www/oceanseo/releases/web-20261006T235353Z/`，对应配置备份 `/etc/caddy/Caddyfile.before-web-20261006T235353Z`。本轮保留了前几次布局/响应头修正的发布目录，没有删除历史版本。

HTTPS、API 路由与独立令牌保留。公网未认证请求仍返回 401，后端继续只监听回环地址。网站 CSP 限制脚本/图片/字体到本域，禁止嵌入框架与对象；不发布目录索引，未知页面/配置/源码路径返回 404。静态响应有 `no-transform`，依据 [Cloudflare 官方说明](https://developers.cloudflare.com/web-analytics/get-started/) 禁止自动注入统计脚本；原先被 CSP 阻止的 Beacon 不通过放宽安全策略处理。私人接口维持 `no-store`。

回滚：管理员选择报告中的既有发布目录和对应 Caddy 备份，校验后恢复链接及配置并 reload。首次原配置备份为 `/etc/caddy/Caddyfile.before-web-20261005T013530Z`，恢复它会使根路径回到最初 404，私人后端照常工作。不要删除数据库或改用首次安装脚本回滚网站。

## 验证

- `npm run landing:build` 与现有 `npm run build` 通过；后者仍有既存主包 >500 kB 的优化提示。
- `npm test`：77 项通过；`npm run test:sync-server`：5 项通过；`npm audit --omit=dev`：0 已知漏洞。
- 浏览器：320/390/768/1440/1920 宽度、缩短视口、截图非空、无页面横向溢出；标签鼠标/键盘切换、弹层焦点限制/恢复、Esc、扫码/截图、散列复制、服务状态失败与重试、隐私页、减少动态效果与实际 Lenis 启停。
- 禁用 JavaScript 的独立浏览器上下文：下载说明与隐私正文可读，APK 锚点触发正确文件名的下载；测试随后取消重复下载，完整网络字节校验由发布检查脚本完成。
- 公网检查：主页、隐私、媒体、字体与许可 200；不存在页面、`.env`、源代码、连接文件及目录列表 404；APK/DEB 全量下载长度和 SHA-256 一致，Range 206。
- 私人接口回归：健康 200，未认证 401，正确令牌 200，令牌互用 401；同步库仍为空，无数据改写。发布文件扫描未包含两个真实私人服务令牌，检查输出不包含令牌值。

复核命令：

```sh
node scripts/landing-public-check.mjs
python3 services/deployment/verify-https.py /home/gellar/.local/share/oceanseo-server/connection.json
# playwright-cli run-code 的脚本：scripts/landing-smoke.js、scripts/landing-nojs.js
```

截图在 `output/playwright/landing-*.png`。本轮浏览器测试不是 Android 真机安装验收；没有重新安装手机、调用付费 AI 或验证商店发布。当前隐私页为内测数据说明，正式发布还需发行主体、长期支持联系方式、正式签名和迁移/渠道合规审查。
