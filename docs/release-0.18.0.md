# 0.18.0 · Oceanseo 界面与内测发布

日期：2026-10-04；验收与发布完成于 2026-10-05（America/New_York）。按已确认顺序完成应用基础、核心流程、Android 操作、安装升级及真实双端隔离同步。本轮 UI/UX 与 0.18.0 内测交付已完成，不代表 Android 全部内测阶段或正式 1.0 发行已完成。

## 范围与约束

- React / Vite / Tauri 原有技术栈，沿用下载页海玻璃配色；不引入业务界面的 Lenis、Vanta 或新 AI 权限。
- 展示名称改为 Oceanseo，小汐采用已有刺猬位图。保留 Tideplan 产品/二进制标识、桌面与手机 applicationId、数据库位置和备份格式，旧潮汐计划备份仍可读取。
- 保留单界面对话、只读理解图、可微调交付抽屉，以及逐条/批量确认、事务、防重复和执行回执。
- 不改生态 contracts，不启动下游任务，不上传真实个人资料，不覆盖手机日常安装。

## 顺序及证据

| 阶段 | 当前进展 | 验证边界 |
| --- | --- | --- |
| 1 应用基础 | 完成：集中 token、阅读字号、按钮/表单、品牌、弹层焦点与恢复；Linux 原生明暗背景与 Android 原生大字体通过 | 系统字体与横屏使用隔离模拟器，不冒称已覆盖全部真机 |
| 2 核心流程 | 完成：浏览器、Linux 原生和最终 Pixel APK 对话/理解图/微调交付/日历/任务/笔记/完成流程通过 | AI 使用隔离 HTTP 模拟服务，实际模型效果不属于本轮结论 |
| 3 Android 与工具 | 完成：工具分组、大画布、Pixel 键盘/返回与工具回归；模拟器字体、短横屏、后台提醒、权限变化和重启恢复通过 | 未覆盖多厂商省电策略；非精确提醒不承诺分钟级准时 |
| 4 安装与数据 | 完成：最终 APK/DEB 构建、两平台 0.17 → 0.18 升级、Pixel 系统文件备份恢复、最终双端隔离库同步及公网发布校验通过 | 正式签名、正式资料库连续使用与商店分发不在本轮范围 |

正式签名、长期支持入口及自动异地备份仍属公开发行准备，不能通过界面改造视为完成。

## 已验证

- `npm test`：78 项通过；`cargo test --lib`：63 项通过。包含真实 SQLite 事务/恢复、同步合并/冲突和本地 HTTP 模拟服务，不能等同实际手机升级。`cargo clippy --lib -- -D warnings` 通过。
- `npm run test:sync-server`：5 项通过。`git diff --check` 通过。
- `npm run build` 通过。主入口仍有大于 500 kB 的既存分包提示；不隐藏警告。
- `scripts/mobile-ui-smoke.js`：移动导航、输入回车换行、日历年份、创建任务、笔记、设置及模拟原生返回通过。
- `scripts/uiux-foundation-smoke.js`：320/390/768 周历无横向滚动；320/390 日历日期目标至少 44 px；年份调整、编辑弹层正反向焦点循环、日期选择器 Escape 只关闭内层并恢复焦点、长标题笔记、任务完成、六种工具窄屏、短视口设置、只读理解图、手机全宽交付层及减少动效通过。
- `scripts/conversation-smoke.js` 与 `scripts/conversation-agent-smoke.js`：只读理解图、未明确分支阻止执行、微调、逐条/批量执行、撤销、过期清单、取消、重试与重启草稿通过。后者使用明确的浏览器原生接口/AI 模拟，不调用付费模型。
- `scripts/release-smoke.js`：人物/训练/旅行/任务/笔记草稿、未完成训练校验、匿名化历史关联和共用 AI 配置回归通过。
- Android 构建环境检查通过；Pixel 9a 已连接，日常包仍为 `com.tideplan.mobile.debug`。

截图：`output/playwright/oceanseo-overview-desktop.png`、`oceanseo-calendar-320.png`、`oceanseo-notebook-320.png`、`oceanseo-delivery-mobile.png` 及工具截图。只使用隔离浏览器与合成记录。

## 原生与大画布追加验收

- `scripts/native-desktop-qa.mjs` 使用 WebKitWebDriver 控制真实 Tauri 程序。临时 XDG 数据目录先运行从 0.17.0 DEB 提取的程序，通过点击和输入创建任务、保存笔记、暂存未提交笔记；退出后在同目录运行 0.18.0，任务所有字段/ID 与旧版相同，草稿可打开并继续保存。
- 原生备份接口导出真实 SQLite 与业务数据，界面创建可丢弃任务，再恢复备份并重新载入，任务列表与导出快照一致，恢复前安全副本位于隔离数据目录。本项验证原生恢复事务，不等同本轮已操作系统文件选择器。
- Linux 原生共用 AI 配置连到仅接受合成密钥的 localhost 测试服务，真实 HTTP 请求成功；界面完成输入想法 → 回复 → 只读理解图 → 确认批量交付 → 当日日历 → 保存笔记 → 完成任务。不是付费 AI 效果评测。
- Linux 原生通过设置界面上传记录至独立 localhost 空同步库；Pixel 接收同 ID 任务、修改笔记并完成，随后上传，Linux 收到相同 ID 与更新字段。首轮结束时双方 revision 3、pending 0；目标整体冲突由界面明确选择，同标题不同 ID 的任务仍独立保留。最终追加验收见下文，`output/playwright/oceanseo-native-018-evidence.json` 的 `sync-receive` 已更新为 revision 4。正式私人资料库未写入。
- `scripts/bead-workbench-ui-smoke.js`：1024/1440/1920 桌面无溢出、画布优先且像素检查非空；专注模式、缩放、拖动、整笔撤销/重做、定位图嵌套 Escape、封闭填充、外轮廓加厚、160×160 调整和 PNG 下载通过。导出图为 4592×4822，完整网格和图例，定位标记不参与原图修改。
- Tauri 构建工具会重写 `applicationIdSuffix`，新增 `androidComponents.finalizeDsl` 在配置完成后落实验收后缀；另用 `scripts/android-qa-package-check.mjs` 安装前强制核对 `.uiuxqa`，避免覆盖日常包。
- Pixel 9a 已重新连接并完成原生核心流程、Android 系统文档导出/选择/确认恢复、七类工具无横向溢出及日历年份调整。备份仅含合成记录，不含凭证。
- 真机发现并修复 BACK 同时关闭键盘与编辑器的问题：先隐藏 IME，再交给应用关闭最内层弹窗。IME-only BACK、日期弹层-only BACK 与焦点恢复、编辑器关闭保留草稿均通过。相同 0.18 版本重新安装后，SQLite 数据及加密 AI 配置保留；不能用此项代替跨版本升级。
- 真机移除测试同步端口转发时，同步明确失败但任务保留，随后恢复转发。仅使用测试服务，不对正式资料库做故障注入。
- WebView 随系统 `fontScale` 设置 `textZoom`，实际放大字体与横屏验收通过，详见下文。模拟器使用临时 userdata 文件，不覆盖既有模拟器数据；模拟器证据不替代多厂商真实手机门槛。
- Android 跨版本升级：隔离 `emulator-5580` 从公开 0.17 APK 创建真实 SQLite 任务、保存笔记和未提交草稿，再以同签名 0.18 APK 覆盖安装。`scripts/android-upgrade-baseline.js` / `android-upgrade-verify.js` 通过，任务字段与 ID 完全保留，草稿可继续保存，原生备份恢复及重载后持久性通过。合成任务 ID `9863d580-ac69-4eed-8219-d9bec31e9e86`；恢复安全副本 `before-restore-8f4bfc84-c915-494b-976d-b5301d9bedde.json`。截图 `oceanseo-emulator-017-baseline.png` / `oceanseo-emulator-018-upgrade.png`。未在真机日常安装上进行覆盖操作。

Linux 产物：`src-tauri/target/release/bundle/deb/Tideplan_0.18.0_amd64.deb`，9,090,852 bytes；包名 `tideplan`、版本 `0.18.0`、架构 `amd64`。SHA-256：`267b4c53afddaa2f1c113cb5e2af8678aa276ca9c1874e1b6b4502bf406ec7d3`。未进行系统级覆盖安装。桌面菜单名称仍是 Tideplan，命令仍为 `tideplan`，窗口及应用内显示 Oceanseo；保留旧标识以避免影响数据目录。

原生截图：`oceanseo-native-017-baseline.png`、`oceanseo-native-018-upgrade.png`、`oceanseo-native-018-delivery.png`、`oceanseo-native-018-calendar.png`；拼豆截图及导出均在 `output/playwright/`。

## 构建与发布边界

公开下载页 <https://oceanseo.gellaronline.cc/> 已更新至 0.18.0，活动目录为 `/var/www/oceanseo/releases/web-20261005T054845Z`；Android/Linux 两个最终安装包与相邻 `.sha256` 已发布，旧 0.17 文件保留。SSH 只读检查确认活动目录及服务器散列；公网全量下载大小和散列与本地产物一致，部分下载返回 206。主页、隐私、媒体、字体及许可证正常；私有接口未认证仍为 401，源码、配置和目录列表不公开。历史首次下载页报告另见 [2026-10-04 报告](landing-release-2026-10-04.md)，不能将其当日 0.17 记录改写为当时已发布 0.18。

Android 产物：`src-tauri/target/release/bundle/apk/Tideplan_0.18.0_android_arm64_internal.apk`，67,073,867 bytes。SHA-256：`37f013e8da37afaee137b14fbf15651647e492b4d31c5bbdf97a7347c6b12adf`。调试签名与 0.17 保持一致，16 KB ZIP 对齐验证通过，仍为内测包而非正式签名发行包。此前候选 APK/DEB 保留在 `/tmp/oceanseo-android-ui-MVFGYx/`，不代表下载目录的最终构建。

## 字体、短屏与提醒追加验收

- 首轮原生 `fontScale` 1.0 / 1.3 / 2.0 下，八类工具无横向溢出；标题文字实测高度分别 31.64 / 41.45 / 63.64 CSS px，确认不是仅修改模拟器设置而文字不变。
- 200% 字体横屏中发现对话空间被顶部与输入区挤占，已修改 `src/mobile.css`：短屏隐藏重复品牌栏和辅助提示、输入区有界滚动、导航横向排列。最终 APK 在 829×344 CSS px / 200% 字体下回归通过：对话区 97.95 px、文本框 72 px、输入区底部 284.73 px、导航顶部 296.73 px；八类工具无横向溢出，设置关闭后对话草稿保留。原生证据 `output/playwright/oceanseo-emulator-final-evidence.json`；清晰截图 `oceanseo-emulator-clear-landscape200.png`。资源紧张时曾出现模拟器系统 ANR 遮罩，不把被遮挡截图当成视觉通过证据。
- 浏览器 320 px 窄屏回归发现滚动条挤占日期点击目标，手机布局隐藏常驻滚动条但保留正常触控滚动；完整 `uiux-foundation-smoke.js` 重跑通过，并新增 320×430 / 844×344 对话空间检查。
- 隔离模拟器系统闹钟在 01:14 实际送达；应用退至后台、屏幕进入 Dozing 后，01:19 提醒再次实际送达，SharedPreferences 回执及次日重新排程已核对。由于使用非精确闹钟，允许系统送达窗口，不以测试结果承诺每次分钟级准点。
- 隔离模拟器真实重启后，开机广播曾在系统队列延迟投递；投递完成后、没有打开应用前，19:00 与次日 01:19 的两个系统闹钟已恢复。用户日常手机及生产服务器没有重启。
- `testUniversalDebugUnitTest`：6 项通过（0 failures/errors），覆盖春季/秋季夏令时、当日/次日计算、同日延迟保留和时区变化。此项不是多厂商省电测试。
- 构建环境检查新增 `javac` 检查，提前区分 JRE 与完整 JDK；最终 Android 构建使用已有 Android Studio JBR 21，不改系统 Java 安装。

## 最终 APK 核心流程与同步

- Pixel `.uiuxqa` 最终构建重新验收：记录想法 → AI HTTP 模拟回复 → 只读理解图 → 微调名称 → 确认创建独立事项 → 当日日历 → 保存笔记 → 完成任务 → 设置检查与确认同步。记录 ID `d66acb4c-cac8-45e4-89bb-becf8462e95f`；Linux 原生接收后全部任务字段一致，两端 revision 4、pending 0。证据 `output/playwright/oceanseo-pixel-final-evidence.json` 与 `oceanseo-native-018-evidence.json`，真机系统截图 `oceanseo-pixel-final-calendar-screen.png`。这是真实两平台程序和 SQLite/HTTP 同步，不是生产资料库验收。
- 最后一次流程脚本曾停在日历，核查证明是模拟 AI 重复 `verify` 行动编号却遗漏已有任务关联，应用报「已有行动必须保留关联的任务」并拒绝创建，并非日历丢失事项。模拟服务已按明确新增请求生成独立行动编号；验收脚本同时检查精确标题、任务 ID 与执行回执，不再仅以数量判断成功。新增回归测试验证错误关联被拒绝、原事项不变及独立新行动可正常创建。本次修正只涉及验收工具与测试，不改变已公布的不可覆盖安装包。
- `scripts/android-ui-performance.js` 在最终 Pixel APK 的 4 条合成事项上完成热态本地操作检查，任务数据保持完全相同。每种理解图/交付层开关各 10 次，记录点击事件至目标 DOM 出现/移除并跨过两帧的响应：各操作 p95 为 22.4 / 29.8 / 37.7 / 26.4 ms，均小于预设 250 ms；30 次 SQLite/IPC 读取 p95 为 9.3 ms，小于 250 ms。证据 `output/playwright/oceanseo-pixel-performance-evidence.json`。这不是完整动画结束、冷启动、万条数据、电量或真实网络/模型耗时的基准，不扩大结论到所有设备。

## 后续边界

本轮四步交付完成，后续另立范围：实际模型效果、正式服务器日常资料连续同步、多厂商通知、稳定签名与密钥备份、支持入口、自动异地备份、商店合规。当前同步仍是任务/笔记/目标/已保存对话的手动确认同步；不含全部生活模块，不提供公众账户或官方 AI 额度。

Linux 原生验收使用临时 XDG 配置/数据/缓存目录与从旧 DEB 提取的程序，不覆盖系统安装。Android 使用独立 `.uiuxqa` 验收沙箱，安装前检查实际包名和签名；不清除日常包数据。真实双端同步使用隔离测试库，不向正式私人资料库写入合成数据。
