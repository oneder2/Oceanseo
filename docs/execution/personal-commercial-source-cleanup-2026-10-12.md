# Oceanseo 个人版商业源码清理

日期：2026-10-12。用户已确认商业项目独立，并明确要求原仓库删除商业代码、只保留开源个人版。本轮按该指令更新原先的商业专用开发范围，没有修改相邻商业仓库，也没有暂存、提交或撤销原工作树改动。

## 清理与保留

相对阶段开始的 682 个源码/配置文件快照，移除 135 个文件，修改 44 个文件，增加个人清理脚本及本报告、域名讨论稿。清单见 `output/personal/cleanup-change-inventory.json`。包括移除 `src/commercial/`、`services/commercial/`、商业 Vite/PWA 入口、托管 AI、商业包配置/CI/测试/专用 QA 和 preview 部署脚本；个人 App/导航不再按商业发行切换，Android 产品清单仅剩个人包。

保留个人任务、工作区、日历、生活管理、原生提醒、拼豆编辑/作品/本地导出、BYOK AI、资料库、备份和个人账号同步。`control-admin/`、账号角色/邀请和权限服务仍有个人同步用途，已限制为个人发行，前端路径调整为 `/manage/`。个人自动同步的任务/目标边界保持原状，未把商业拼豆云端自动同步加给个人版。

旧 `commercial-beads` 字段仅在历史资料库身份读取类型、隔离/兼容测试和拒绝未知发行的测试中保留。不能删除此解析能力，否则同一索引中的个人资料也可能无法打开。原生资料库选择与工作空间列表不提供另一产品入口；不搬移或删除已有资料。

删除和修改前的源码保存在仓库外：`../Oceanseo-cleanup-archive-20261012/source-before-cleanup.tar.gz`，对应哈希为同目录 `source-hashes.json`。历史文档、候选包、个人发行包、数据库、密钥和 QA 证据保留。本轮新截图、日志写入 `output/personal/`，没有覆盖先前个人 UI 验收图片。

## 本地与线上边界

本地 Caddy 文件是个人站点模板，保留 `/v2/*`、`/v1/vault`、健康检查、下载和官网路径。个人服务发布脚本不再覆盖或重载中央 Caddy 配置，避免独立仓库互相覆盖站点。域名方案见 `proposals/2026-10-12-personal-commercial-domain-routing.md`。

没有 SSH 发布、修改 DNS/线上配置、迁移数据库、安装新包或变更公开下载。已安装个人 0.19.1 仍是先前验收的二进制；本轮验收的是源码、构建和测试，不代表重新验收 Android 实机、商业新 origin 或新个人安装包。

## 验证

- `npm test`：119 项通过，涵盖拼豆、可靠持久化、模块与同步等回归。
- 前端和个人账号管理 UI 构建通过；前端启动 JS 为 484,916 bytes，gzip 157,187 bytes，低于 491,520 / 163,840 的预算。
- Rust release library：132 项通过，涵盖个人工作区、备份恢复、账号来源隔离、资料空间同步、权限和 BYOK AI。日志 `output/personal/cleanup-rust-tests.log`。
- Playwright：默认零工具、主工作区不可删除、自定义工作区与风格、两工作区采购资料隔离、同一份待办归属/排序、重命名、删除后转待定、侧栏指针/键盘调节和持久化、悬浮菜单不挤导航、减少动效、1400/780/620 宽度通过。证据 `output/personal/cleanup-browser/`。天气网络查询未重复验收。
- 发布契约、脱敏诊断契约和 shell/JS 语法检查通过；同步 HTTP 7 项、部署/备份/告警 14 项通过。日志分别位于 `output/personal/cleanup-sync-tests.log` 和 `cleanup-service-contracts.log`。

拆分时两处旧测试夹具需要修正：个人策略 CAS 重复发布要带上既有 revision；创建个人测试资料空间要显式准备管理员权限。原生测试和针对 CAS 的复测已通过；最终完整账号/权限复测 **32 项通过**，见 `output/personal/cleanup-control-tests.log`。

本轮修改的 Rust 文件已格式化，`git diff --check` 通过。完整 `cargo fmt --all --check` 仍报告 9 个本轮未修改文件的既有格式差异（拼豆迁移、任务、工作观察、同步等）；这些文件与阶段快照字节一致，未为清理商业代码而扩展格式修改范围。完整 `cargo clippy --release --all-targets --locked -- -D warnings` 未通过：报告 16 处既有警告，涉及未使用的任务兼容方法、过多参数、冗余借用/布尔表达式及测试模块顺序等。对应内容已存在于阶段快照；本轮未扩展到无关个人业务的 lint 整理。日志 `output/personal/cleanup-clippy.log`。因此不能声称全仓 CI 已全部通过。

构建缓存清理由原 `commercial-build-cleanup.mjs` 改名为 `build-cleanup.mjs`，调用 `npm run cleanup`。保留运行中构建检查、8 GiB Cargo 预算和源码/发行包/证据保护，商业历史 APK 不再作为个人自动清理对象。

最终 `npm run cleanup` 已在构建进程退出后执行成功，释放 8,929,280 bytes 的可再生缓存，未触发深度清理；记录 `output/personal/build-cleanup-latest.json`。本轮 QA 浏览器和 Vite 服务均已关闭。
