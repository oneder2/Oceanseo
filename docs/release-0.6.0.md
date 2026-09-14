# 潮汐计划 0.6.0 交付报告

日期：2026-09-14。

## 本次交付

- 计划日历和应用内日期选择器支持上一年、下一年、输入年份和选择月份，范围为 0100–9999 年。
- 侧边导航划分全局导航、任务管理、个人项目、生活饮食；偏好设置保留为全局入口。
- 新增「个人项目 → 拼豆图纸」：像素原稿导入、照片配色精简、后台转换和预览确认、平移缩放及坐标、逐格编号、画笔/橡皮/吸管、撤销重做、尺寸调整、完整 PNG 导出和保存位置选择。
- 图纸自动保存到本机，纳入数据库备份与恢复。版本号统一更新为 0.6.0。

设计保留现有透明桌面外框，在拼豆编辑区使用不透明浅色面板和蓝灰画布以保证色块、编号及坐标可读。算法依据、质量取舍和下一步建议见 [拼豆调研](bead-pattern-research.md)。

## 验证结果

- `npm test`：8 项通过，包括原色、透明、细节保留、配色确定性及上限、尺寸变更、无效数据和 160×160 最大网格。
- `npm run build`：通过，后台转换 Worker 已生成独立生产资源。
- `cargo test`：25 项通过，包含拼豆图纸备份恢复和数据库重启读取。
- `cargo clippy --all-targets -- -D warnings`、`cargo fmt --all -- --check`、`git diff --check`：通过。
- Playwright 交互检查：年份跳转与闰日选择、工作区切换、原稿保色、照片转换、绘制与撤销重做、平移缩放、尺寸调整和完整导出；390×844 窄屏未发现横向溢出。
- 独立生产预览：24×16 测试图转换为 2 色、384 颗豆，成功自动保存并导出 976×918 PNG；设置页显示 0.6.0，本次会话控制台记录为 0 错误、0 警告。
- 最大图纸 PNG 导出已验证为 4592×4822；截图和导出示例保存在本机 `output/playwright/`，不纳入 Git。
- Tauri release 构建与 Debian 打包成功，包元数据确认 `tideplan / 0.6.0 / amd64`。

未在本轮安装覆盖用户当前应用；原生保存位置对话框未进行桌面端到端操作验证。图片算法使用合成素材验证，尚未进行实际摆豆或用户访谈。

## 安装包

路径：`src-tauri/target/release/bundle/deb/Tideplan_0.6.0_amd64.deb`（约 7.8 MiB）。

SHA-256：`af9d003f376b35c16c79295348f6a74fae3a4219962fcc43d6b187496498e034`。

本机打包命令：

```bash
PKG_CONFIG_PATH=/home/gellar/Desktop/program/personal/Oceanseo/output/pkgconfig npm run tauri -- build --bundles deb
```

安装并重新打开：

```bash
sudo apt install /home/gellar/Desktop/program/personal/Oceanseo/src-tauri/target/release/bundle/deb/Tideplan_0.6.0_amd64.deb
pkill -x tideplan
tideplan
```

旧版本关闭窗口后可能仍在托盘运行，因此安装后需要退出旧进程。打开「偏好设置」可核对版本 0.6.0。

## 当前边界与建议

图纸最大 160×160，当前保存一份图纸；替换前预览，页面内最多撤销二十步。B01 等是应用内编号，可自行改名称填写品牌色号，尚无厂商色卡自动匹配。PNG 包含完整图纸和用色清单，不包含编辑按钮，也不是物理 1:1 打印模板。

下一步建议优先实现实体色卡与库存约束、底板分块与 A4/PDF 原尺寸打印、按行或按色施工进度；随后再扩展图纸库、填充选区和局部重新配色。

本次只修改 Oceanseo，未改动 Ecosystem contracts 或启动下游项目任务。
