# 潮汐计划 0.9.1 发布准备报告

日期：2026-09-16。此版本是 1.0 发布准备版，不是已经完成跨系统验收的正式 1.0。

## 已执行的修改

- 保存：先记入持久化待写队列，再写 SQLite。失败后可在顶栏重试，重启优先恢复最新待写内容；写入带独立版本标记，连续 A→B→A 修改不会因较早确认而丢失最后一次待写。磁盘/缓存写入失败明确提示，数据库启动失败时暂停生活页面编辑。
- 备份：导出前等待保存完成。恢复时校验八类 app_state 数据的嵌套结构、数值、日期及图纸索引；覆盖前在数据库锁内创建并同步恢复副本，再执行事务。副本失败、校验失败或事务失败时不覆盖。成功后隔离旧页面写入并清理旧编辑草稿，防止旧内容再次覆盖恢复结果。
- 草稿：人物、训练计划、逐组记录、旅行、新任务、任务编辑与记事本支持本机暂存。人物/旅行可恢复多份草稿；人物切换保留各自修改，放弃草稿恢复正式内容。未填训练组数不会被当成 0。草稿不进入正式日历或 JSON 备份。
- 闭环：总览新增未来七天的训练与旅行入口，打开时定位对应对象和日期；修正今日任务数量被列表截断上限影响的问题。日常提醒加入训练和旅行，启动、恢复焦点、运行时定期检查，最多补发两小时内错过时段，按本地日期和时间去重。
- 配置：所有 AI 功能共用可编辑模型名称；旧配置自动使用原默认模型。AI 保存失败不改变内存中的有效配置。设置可测试 Responses 结构化输出，以及高德地点检索/步行路线；诊断不显示完整密钥，调用前明确说明额度消耗。AI 调用使用 `store: false`。
- 隐私：人物信息可经确认清除为匿名档案，保留历史计划关联；说明既有计划文本、第三方记录、备份需另行处理。补齐 [数据与服务说明](privacy-and-data.md)。
- 工程：增加持久化/提醒回归、备份安全测试、真实本地 HTTP 服务测试、可重复执行的浏览器脚本和 GitHub Actions 工作流。

## 设计及主要文件

依据 ui-design 技能沿用当前青灰、暖白和珊瑚色设计；增加顶栏保存状态、柔和草稿提示、内联清除确认、总览生活安排入口。没有引入新的组件框架或外部设计素材。

持久化核心为 `src/reliableState.ts` 与 `src/appDataStore.ts`；草稿为 `src/drafts.tsx`、`src/editorDrafts.ts`；提醒策略为 `src/reminderPolicy.ts`；恢复校验为 `src-tauri/src/backup_validation.rs`。页面入口及诊断在 `App.tsx`、`HomeDashboard.tsx`、`src/life/` 与 `ai_settings.rs`。

AI 连接测试的格式依据 [OpenAI Structured Outputs 官方文档](https://developers.openai.com/api/docs/guides/structured-outputs)，2026-09-16 获取。兼容服务仍需实际账号验证。

## 验证结果

- 前端测试 37 项通过：包含新增队列重启/重试、A→B→A 顺序、恢复互斥、存储空间失败、损坏队列保护、NaN 草稿、提醒补发/去重/跨日/夏令时及训练旅行汇总。
- Rust 测试 33 项通过；`cargo clippy --all-targets --locked -- -D warnings`、`cargo fmt --all --check` 通过。新增测试覆盖恢复副本再还原、嵌套损坏文档拒绝、副本写入失败、配置升级和失败保留，以及本地 HTTP 服务下的模型/结构化输出/鉴权错误。
- TypeScript、Vite 生产构建和 Tauri release Debian 打包通过。安装包内含可执行文件、desktop 入口及图标；本机构建产物动态依赖无缺失。
- Playwright 对生产预览的 11 组场景通过，无页面异常：人物草稿、人物切换/放弃、训练草稿、未填组数拦截及完成、旅行草稿、总览跳转、任务草稿、记事本草稿、清除个人信息及保留匿名关联、AI 设置入口、640px 无横向溢出。
- 另通过保存失败专项：模拟本机存储空间不足，页面显示「自动保存尚未完成」；恢复可写后点击重试，最新内容成功保存，旧错误提示不残留。脚本为 `scripts/save-recovery-smoke.js`，截图为 `output/playwright/release-0.9.1-save-error.png`。
- 浏览器预览的正式任务存储为内存模拟，因此记事本刷新测试注入同 ID 的已提交任务样例；真实 SQLite 重启由 Rust 测试覆盖。没有把浏览器预览当作原生桌面实测。
- 截图：`output/playwright/release-0.9.1-dashboard.png`、`release-0.9.1-settings.png`、`release-0.9.1-narrow.png`。样例只在隔离浏览器和临时测试目录中使用，未安装覆盖现有应用或修改用户真实资料。

复现浏览器回归：启动 `npm run preview -- --host 127.0.0.1 --port 1420`，在新的隔离 playwright-cli 会话打开该地址，再执行 `run-code "$(cat scripts/release-smoke.js)"`。该脚本会清空测试浏览器的 localStorage，不可用于日常资料所在的浏览器配置。

```bash
npx --yes @playwright/cli -s=release-smoke open http://127.0.0.1:1420
npx --yes @playwright/cli -s=release-smoke run-code "$(cat scripts/release-smoke.js)"
npx --yes @playwright/cli -s=release-smoke run-code "$(cat scripts/save-recovery-smoke.js)"
npx --yes @playwright/cli -s=release-smoke close
```

CI 已配置在 `.github/workflows/ci.yml`；本报告的通过结果来自本机执行，不代表 GitHub 托管流水线已经成功。

## 安装与升级

安装包：`src-tauri/target/release/bundle/deb/Tideplan_0.9.1_amd64.deb`。命令行程序为 `tideplan`，软件包版本为 `0.9.1`。

最终安装包大小 8,343,288 字节；Package 为 `tideplan`，Architecture 为 `amd64`。偏好设置页面也已核对显示 0.9.1。

SHA-256：`aa5f5743179df5c9e8ae7302d953ec21084671b7fc701333a2d3d50f0a7f5c00`。

本环境构建命令：

```bash
PKG_CONFIG_PATH=/home/gellar/Desktop/program/personal/Oceanseo/output/pkgconfig npm run tauri -- build --bundles deb
```

从仓库根目录安装：

```bash
sudo apt install ./src-tauri/target/release/bundle/deb/Tideplan_0.9.1_amd64.deb
```

升级前先在旧版导出备份。安装后从托盘菜单彻底退出旧进程，再从应用菜单打开 Tideplan / 潮汐计划，或执行 `tideplan`。窗口右上角关闭按钮只是隐藏到托盘；未退出旧进程时可能仍看到旧版本。请在偏好设置底部核对版本 0.9.1。

构建环境为 Linux Mint 22.1，amd64；声明的系统依赖为 `libayatana-appindicator3-1`、`libwebkit2gtk-4.1-0`、`libgtk-3-0`。其他发行版兼容性以实机验收为准。

## 正式 1.0 尚待完成

1. Mint / Ubuntu / Debian 各目标版本的全新安装与旧版升级，真实资料副本迁移，托盘、开机自启、通知权限、休眠唤醒、原生文件对话框及桌面缩放。
2. 使用实际 AI 服务/高德账号验证模型权限、额度、完整计划质量和真实路线；本轮没有调用用户的付费账号。
3. 在真实桌面演练备份导出、失败写入、恢复及恢复前副本回退。JSON 备份不包含工作观察数据库、服务密钥和编辑草稿，应按数据文档分别处理。

以上项目在缺少相应环境和账号时不能标为通过。训练按星期安排、单次调课、旅行导出、拼豆多文档与饮食复用人物画像仍按 [1.0 计划](release-1.0-plan.md) 的后续迭代处理。本轮未启动任何下游任务或修改生态 contracts。
