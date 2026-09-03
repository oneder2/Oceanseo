# 潮汐计划

面向 Linux Mint、Ubuntu 和 Debian 的本地桌面计划助手，用短期、中期、长期三个时间跨度管理待办事项，并通过月历与可调节的每日通知管理时间轨迹。

应用内的“AI 食谱”可以根据用餐人数、饮食偏好、忌口、预算和营养目标生成一周三餐，并自动汇总食材。独立的“采购清单”支持手动增删改、分类整理、完成勾选，以及从 AI 食谱一键导入；手动与 AI 来源会分开标识和筛选，当前清单可导出为 Markdown 或 CSV。“工作观察”会定期检查个人 Git 项目的近期活动，生成周报，并在人工批准后把明显进展同步到 GWorkspace。

AI 食谱与工作周报共用“偏好设置”中的 `API_KEY` 和 `BASE_URL`。配置由桌面后端保存在本机应用数据目录，密钥不会写入浏览器存储；Linux 下配置文件权限限制为当前用户读写。`BASE_URL` 支持 OpenAI Responses API 及兼容接口。

## 开发运行

先安装 Linux 原生构建依赖（Mint 22 / Ubuntu 24.04）：

```bash
sudo apt install build-essential libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
```

```bash
npm install
npm run tauri dev
```

## 构建安装包

```bash
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`。应用首次启动时默认注册为开机自启，并在 09:00 与 19:00 发送计划提醒；两项设置均可在“偏好设置”中调整。关闭窗口后应用会驻留系统托盘，以保证提醒继续运行。

AI 功能通过 Responses API 生成内容，使用前需要在“偏好设置”中填写可用的 API 密钥与服务地址。
