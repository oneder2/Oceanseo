# Linux 个人版 0.19.0：工作区与模块

2026-10-12：实现、安装包验收与用户级安装完成。依据用户后续“很好，请你进行更改和部署”的授权推进个人版；保留工作树原有修改。规则来源见 [重构方案](../../proposals/2026-10-12-personal-linux-workspaces.md)。

## 交付行为

- 首次使用只有一个不可删除的主工作区，已添加工具数为零；固定主页提供真实时间、天气城市查询、共享任务日历和总体待办。
- 普通工作区可创建、改名、删除和选择风格。名称、风格与工具组合独立，CEO/CTO/CLO/CSO 不会自动创建，也不是固定类型。
- To-do 保持一份任务、一组 ID。新建和编辑须指定工作区或明确的“待定”；普通工作区按“当前工作区 → 待定 → 其他工作区”展示，主主页展示全部并支持筛选。
- 删除普通工作区保留任务，归属改为“待定”；工具资料留在归档和完整备份中。移除工具可恢复原工具资料。
- 模块库按用途分类，当前提供 11 个现有模块：目标、日历、关键日期、人物、主机与服务、工作观察、拼豆、食谱、采购、训练、旅行。模块可以添加到不同工作区，各自保存业务资料；地图、主机凭据和工作观察配置也按工作区隔离。
- 非空旧工具资料复制至“旧版资料”，保留原始数据库/配置和迁移前快照；旧任务保留内容、ID、状态，归属为“待定”。旧版 JSON 备份恢复也会生成明确的旧资料工作区。

## 实现边界

前端增加 `src/personal/` 外壳、主页、任务板、工作区管理与备份适配器。沿用现有业务组件，由安装清单控制入口、相关后台工作和业务上下文。场景切换先刷新索引、完成写入，再重载当前窗口；同一原生进程继续运行，每个渲染器的存储/IPC 作用域固定，异步回执不会因切换改写另一工作区。

原生增加各 profile 内的 `personal-workspaces/registry.sqlite3` 和场景存储。共享任务数据库 schema 保持原有契约，归属位于个人版索引；场景业务状态通过附加数据库路由。归属写入具有恢复日志，完整恢复保留恢复前快照和回滚日志。旧资料迁移先完成复制，再提交索引，避免持有索引事务时阻塞关联数据库写入。

恢复前会归档当前 profile 内各场景的待写入队列、目标操作和草稿，恢复成功后清理这些队列，避免后续切换把旧写入重放到已恢复的数据。其他 profile 的队列保持不变。

第一版同一工作区内每类模块只有一个实例；移除后恢复原实例，尚未提供同工作区多实例或“重新添加为空白实例”。删除工作区的资料可通过完整备份保留/恢复，尚无单独的归档工作区恢复界面。共享 AI 基础服务设置仍属于应用管理；模块资料和会话按场景保存。

个人工作区、任务归属和新场景模块资料目前保存在本机并纳入新版备份，尚未扩展跨设备同步协议；保留兼容的任务内容同步，新同步进来的任务默认待定。普通 JSON 备份不包含地图 Key、主机令牌等独立凭据，换机器后须重新配置。语音转文字、格式转换、需求爬取、番茄钟、白噪音仍是后续候选工具。

## 验收证据

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| TypeScript、Vite、个人版 DEB | 通过，版本 0.19.0 | `output/playwright/personal-workspaces-logs/oceanseo-personal-package-build-final.log` |
| Rust 全套 | 136 项通过 | `output/playwright/personal-workspaces-logs/personal-tests-final.log` |
| JavaScript 全套 | 120 项通过，包含恢复队列隔离回归 | `output/playwright/personal-workspaces-logs/personal-js-tests-final.log` |
| 初始包体预算、重型工具延迟加载 | 通过 | `output/playwright/bundle-budget.json` |
| 浏览器交互 | 零工具、主工作区保护、自由名称/风格、采购隔离、共享任务/排序、改名/删除、窄窗口及真实天气查询通过 | `output/playwright/personal-workspaces-browser-evidence.json` |
| DEB 中的真实 Linux 应用 | 11 模块的 12 个页面、原生归属拒绝校验、共享任务、业务/配置隔离、移除恢复、完整备份恢复、重启通过；内嵌前端入口与最新构建一致 | `output/playwright/personal-workspaces-native-evidence.json` |
| 真实旧资料升级与旧备份导入 | ID/内容/完成状态/草稿保留，采购及工作观察/地图配置迁移，原件和安全快照保留，重复启动不重复迁移；旧备份恢复通过 | `output/playwright/personal-workspaces-legacy-evidence.json` |
| 安装 | 二进制校验值与已验收包一致，桌面/协议/自启/用户命令指向稳定路径 | [安装记录](personal-workspaces-install.json)、[安装核对](personal-workspaces-install-verification.json) |

原生 QA 使用隔离的 XDG 资料目录和 D-Bus，不将测试资料写入日常个人资料库。Linux 自启库使用真实 home 下的配置路径，QA 脚本额外保留并恢复该安装级配置。日常旧进程 PID 2332 保持运行；日常资料的首次升级会在用户重新打开新版时发生。

截图：`output/playwright/personal-workspaces-home.png`、`personal-workspaces-narrow.png`、`personal-workspaces-native-home.png`、`personal-workspaces-native-legacy.png`。最后执行 `git diff --check`，仅停止本任务的 Vite、浏览器和原生 QA 进程。构建结束后按项目规则执行清理脚本，保留发行包、源码、证据和已安装目录，不在清理后重建。

清理完成并释放 8,908,800 字节，受管理缓存为 3,635,957,760 字节，低于 8 GiB 预算；磁盘约有 20 GiB 可用。记录：`output/playwright/personal-workspaces-logs/cleanup.json`。

## 安装与使用

安装包保存在 `output/releases/personal-linux/0.19.0/Tideplan_0.19.0_amd64.deb`；其 SHA-256 为 `e85f2ba5df984d5260b045c6aac57cbee82789229ced45e6d5fa4ee1c2e91dfd`。

已安装二进制：`/home/gellar/.local/opt/oceanseo-personal/0.19.0/usr/bin/tideplan`。SHA-256 为 `78a33ea8b4960448c40fa18c08b2a859694339bfad363340e50a527e06f3b336`。个人版 overlay 单独提供 0.19.0，未将商业版或其他平台的基础版本统一升级。

菜单入口、`oceanseo://` 协议、自启与 `~/.local/bin/tideplan` 已更新。旧启动配置的副本列在安装记录的 `backups` 字段；原来已经从构建目录删除、但仍在运行的旧可执行文件另保存在 `output/releases/personal-linux/before-workspaces-running-tideplan`。安装不强制结束应用，关闭正在运行的 Oceanseo，再从应用菜单重新打开即可使用新版。

首次使用可在侧栏顶部新增任意命名工作区，选择风格；点击“添加工具”添加当前需要的模块。主工作区固定主页始终可访问，待办的“所属工作区”可以随时调整。
