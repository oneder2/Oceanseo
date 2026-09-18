# 0.10.0 验收报告

日期：2026-09-18。范围：内置潮汐助手。未修改下游项目或 ecosystem contracts。

## 交付

- 默认「小汐」水滴精灵，安静、有陪伴感；顶栏入口及 Ctrl+Shift+Space 快捷键。沿用 React/Tauri 和原有半透明界面，以水色侧栏、纸面正文和 SVG 形象呈现。
- 名字、交流风格、配色、明确偏好和摘要范围可设置；支持摘要预览、停止请求、清空对话、输入恢复和最近 40 条本机消息持久化。
- 共用现有 AI 配置，通过 Responses function calling 按需读取摘要、提出页面入口和待办草稿。草稿进入原任务编辑器，由用户检查保存；保护已有未完成草稿。
- 助手记录纳入 SQLite、可靠写入队列、JSON 备份及恢复校验。摘要使用字段白名单，不含人物档案、任务笔记、项目路径或源码。

能力、数据范围、工具循环和服务要求见 [助手说明](assistant.md)。

## 验证

- 前端测试 45 项通过：包括摘要字段投影、日期与动作校验、历史截断及助手状态恢复。
- Rust 测试 38 项通过：包括工具范围拒绝、草稿只建议不保存、重复操作去重、备份恢复和重启读取。
- `cargo clippy --all-targets -- -D warnings` 通过。
- 本地 HTTP 模拟两轮 Responses 请求，验证按需读取、call_id 回传、store:false 和草稿 saved:false。未调用真实付费模型，未向外部服务发送用户资料。
- TypeScript、Vite 生产构建通过。生产静态页面的 Chromium 验收通过：改名/配色/偏好、输入重载恢复、浏览器模式提示、620×560 小窗口边界、Escape 焦点、已有草稿保护、草稿交接保存、已消费卡片防重复、日历导航、清空对话。成功交接后旧错误提示消失，无页面运行异常。
- 浏览器操作卡为明确的本地测试数据，不作为真实模型生成结果。截图在 `output/playwright/assistant-welcome.png`、`assistant-narrow.png`、`assistant-action-handoff.png`；可复现脚本为 `scripts/assistant-smoke.js`。

## 安装与边界

安装包：`src-tauri/target/release/bundle/deb/Tideplan_0.10.0_amd64.deb`。

Tauri Debian 构建成功，包元数据为 tideplan / 0.10.0 / amd64。大小：8,435,414 字节。

SHA256：`f8cef2918ac8f33fba497000a312cc986f416113639ce428c2df9a36ff12a544`。

没有安装覆盖运行中的应用，没有修改真实用户数据库。尚未完成真实服务兼容性及 Mint/Ubuntu/Debian 多环境原生安装升级验收；现有 AI 连接测试只验证结构化输出，助手还需要服务支持 function calling。

第一版提供业务摘要、功能导航和待办草稿。食谱、训练、旅行等生成及项目同步继续由原页面处理；没有定时自主行动、语音、跨设备同步或桌面外常驻宠物。
