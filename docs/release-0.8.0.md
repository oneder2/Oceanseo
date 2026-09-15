# 潮汐计划 0.8.0：拼豆工作台重构

日期：2026-09-15。入口：个人项目 → 拼豆图纸。

## 交付

画布优先布局替代原先堆叠的设置区：紧凑文档栏、绘图工具、按需属性面板、剩余高度画布与底部状态栏。默认收起面板；宽屏停靠，窄屏覆盖且独立滚动；专注画布可以隐藏全局导航。面板开合保持缩放，尺寸改变才重新适应。

所有编辑进入统一文档事务。画笔/橡皮一次拖动对应一次历史；标题、色卡和豆距同样可撤销。导入、填充、加边、调整尺寸和新建共用前后对比预览，应用后才保存。取消转换会终止作业并忽略迟到结果。修复定位弹窗 Ctrl+Z 触发背后输入框原生撤销的问题，统一两处取消入口的状态反馈。

采用已有 React / TypeScript / Canvas / Tauri 框架。根据 frontend-design 和 ui-design 技能，将设计重点放在蓝灰原色画布与紫色独立定位图、紧凑常用工具和按需属性面板；未使用外部组件参考。主要变更为 `BeadWorkbench.tsx`、`BeadCanvas.tsx`、各功能面板、`document.ts`、`useBeadDocument.ts`、`useImageImport.ts`、`camera.ts`、`export.ts`、`studio.css`。原 `BeadStudio.tsx` 保留为兼容入口。

详细状态归属、事务约束、交互表、模块职责及扩展要求见 [工作台规范](bead-workbench-architecture.md)。图纸数据格式、存储键、填充与转换算法继续兼容既有功能。

## 验证

- `npm test`：19/19 通过。包括新增事务顺序、无变化与重做、预览隔离、20 步历史及损坏文档、视口变化保留镜头、鼠标锚点缩放；继续覆盖既有算法、尺寸和日期测试。
- TypeScript / Vite 生产构建通过；Tauri release 编译及 Debian 打包通过；`git diff --check` 通过。
- 开发浏览器交互：整笔绘制/撤销/重做、笔画期间不保存、标题与豆距撤销、豆色新增/重做/名称及色值撤销、定位图弹窗快捷键隔离、填充前后预览/取消/应用/撤销、真实文件输入与像素原稿 Worker 转换、PNG 下载、重载恢复。
- 取消导入：使用受控 Worker 替身保持作业未完成，取消后触发过期回调，确认无预览、无覆盖、解除编辑锁及正确取消提示。真实 Worker 转换另行通过，替身只用于可重复制造取消竞态。
- 1240×790 桌面默认画布大于 900×500；专注模式增加 220px 宽。390×844 下画布大于 350×400，主区域无横向或纵向溢出，面板可滚动及收起。目视检查默认/属性面板/专注/预览/窄屏截图。
- 独立生产预览：整笔绘制和撤销重做、尺寸预览应用、轮廓加厚、专注模式、F11 与 Escape 先关闭属性面板再退出全屏、设置显示 0.8.0。1240×790 专注画布实测 1218×523，主区域无纵向滚动。该次控制台 0 错误、0 警告。
- 本机截图：`output/playwright/workbench-default.png`、`workbench-colors.png`、`workbench-focus.png`、`workbench-preview.png`、`workbench-mobile.png`、`workbench-mobile-panel.png`、`workbench-production.png`；导出样例 `workbench-export.png`。这些验证产物不提交 Git。

本轮未修改 Rust 业务逻辑，未重复运行其全量测试。未安装覆盖用户应用，未实测原生保存对话框或 Linux 窗口管理器行为；全屏及保存恢复交互验证在浏览器环境完成。继续仅保存一份图纸，撤销历史、原图与会话布局不跨页面卸载保留。

## 构建产物

路径：`src-tauri/target/release/bundle/deb/Tideplan_0.8.0_amd64.deb`。

元数据：Package `tideplan`，Version `0.8.0`，Architecture `amd64`；大小 8,174,478 字节（约 7.8 MiB）。

SHA-256：`12be3509c73e853fca321bd571ea275013d3be8f6a22120ed8abc6afbf1bc1a0`。

本环境构建命令（沿用已有本机 pkg-config 路径）：

```bash
PKG_CONFIG_PATH=/home/gellar/Desktop/program/personal/Oceanseo/output/pkgconfig npm run tauri -- build --bundles deb
```

安装后退出旧托盘进程，再启动 `tideplan`，在偏好设置中核对 0.8.0。也可在安装前运行 `pkill -x tideplan` 退出旧进程，避免看到旧版页面。
