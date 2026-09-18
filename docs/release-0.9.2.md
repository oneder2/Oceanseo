# 0.9.2 验收报告

日期：2026-09-18。范围：多品牌拼豆色卡、复杂图片的杂色与配色改进。未修改其他项目或 ecosystem contracts。

## 交付

- MARD、COCO、漫漫、盼盼、咪小窝：每品牌 221 个普通色。提供导入选择、已有图纸配色预览、按厂家色号添加颜色；画布、定位、编辑操作与 PNG 使用一致的色号。
- 区分厂家色号与图纸内部编号。修改 RGB 后解除厂家身份；旧文档兼容，元数据参与撤销、持久化与备份验证。
- 面积采样、邻域偏色识别、保边平滑、簇内代表色、CIEDE2000 品牌匹配、最终配色的邻域约束和未用色清理。完整来源、许可、算法与限制见 [色卡说明](bead-palettes-and-quality.md)。

## 验证

- `npm test`：42 项通过，包括 CIEDE2000 公开参考数值、噪点清理与细节保护、五品牌色表、元数据、历史与面积采样。
- `PKG_CONFIG_PATH=output/pkgconfig cargo test --manifest-path src-tauri/Cargo.toml`：34 项通过，包括品牌色号/色值错配拒绝与旧文档兼容。
- TypeScript 与 Vite 生产构建通过；Tauri Debian 包构建通过；包元数据确认为 tideplan / 0.9.2 / amd64。
- Chromium 对生产静态页面实际执行：本地图片上传 → 64×64 / 16 色 / 较强去杂色 / MARD 预览 → 应用 → 切换 COCO 预览 → 应用 → 撤销恢复 MARD → 重做恢复 COCO → PNG 下载 → 页面重载后 COCO 恢复。验证了 4096 颗豆、15 色、用色清单与画布色号。浏览器验证不替代 Tauri 原生保存对话框或跨系统安装测试。
- NASA 人像视觉对照：旧版 238 个四邻域孤立格，新版自定义色 171 个，MARD 126 个（最终 15 色）。这些数字包含真实细节，不能单独当作准确度评分。64×64 有限分辨率仍会损失五官细节。
- 最大网格实验：160×160、最多 48 色、较强降噪、MARD；25600 格、输出 30 色、全部属于品牌色表，本机约 4.08 秒（同时在编译安装包），不作为跨硬件性能保证。

本地视觉产物：`output/playwright/bead-quality-comparison.png`、`bead-brand-panel.png`、`bead-coco-restored.png`、`bead-coco-export.png`。测试使用隔离浏览器数据，未覆盖真实用户数据库、未安装替换运行中的应用。

## 安装产物

`src-tauri/target/release/bundle/deb/Tideplan_0.9.2_amd64.deb`

大小：8,371,662 字节。

SHA256：`a03a2b25823f64e81391ce861ed51a086d9eb87bf172a61013fe155e928e7c5f`

品牌色卡是固定历史版本的社区数据，RGB 为屏幕近似色，未逐项实体测量。强降噪可能简化低对比细节；本版没有语义分割，不保证所有复杂图自动生成最佳图纸。原安装升级、Mint/Ubuntu/Debian 多环境验证仍属于正式 1.0 的后续验收。
