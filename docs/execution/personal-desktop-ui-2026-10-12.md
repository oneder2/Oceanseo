# Linux 个人版 0.19.1：桌面 UI

实现、最终 DEB 原生验收与用户级安装完成。本轮按用户要求优化个人版侧栏、工作区选择器、动效与 Linux 窗口缩放。设计和商业项目边界建议见 [方案](../../proposals/2026-10-12-personal-desktop-ui-and-project-boundaries.md)。

## 实现

- 侧栏拖动调整，200–360 px，受窗口宽度约束；键盘微调、双击重置、本机记忆。首次绘制前应用已记忆的宽度，避免重载时跳动。
- 工作区菜单使用独立 portal 与固定定位，不改变左侧导航高度。半透明模糊、选中标识、场景图标、独立滚动、键盘选择、Esc 和外部点击关闭。
- 主工作台采用蓝灰底色与白色阅读面板，时钟搭配静态弧线；各工作区可自由选择墨蓝、青色网格、柔绿或紫灰风格。
- 语义导航图标、短距离页面淡入、菜单进入与工具卡片局部高光；包括弹窗中的高光过渡，均适配系统减少动态效果。
- 工具库按需加载；搜索、添加、实际使用和移除的浏览器流程通过。启动 JavaScript 490,460 字节、gzip 158,886 字节，低于原有 480 KiB / 160 KiB 预算，重型工具与 GSAP 仍延迟加载。
- Linux 无边框窗口的四边和四角调用 Tauri 原生缩放；右下角有提示，全屏隐藏。新增权限仅位于个人版 Linux overlay。

## 验收

类型检查通过。浏览器实际拖动、键盘边界/重置、重载与跨工作区宽度记忆、菜单 portal/透明度/焦点/外部关闭、风格选择和减少动态效果通过。1400×950、780×820、620×560 下内容没有横向溢出，菜单保持在窗口内。

证据：`output/playwright/personal-desktop-ui-browser-result.json`、`personal-desktop-ui-highlight.txt`；截图：`personal-desktop-ui-home.png`、`personal-desktop-ui-picker.png`、`personal-desktop-ui-library.png`、`personal-desktop-ui-620.png`。

最终浏览器复测：`personal-desktop-ui-browser-final.txt`、`personal-desktop-ui-library-final.txt`、`bundle-budget.json`。初次包体检查超出预算 852 字节，工具库独立按需加载后通过；没有调高预算。

首包原生诊断通过侧栏、菜单和宽度记忆，并以 XTest 实际命中右下角手柄，将窗口从 1240×818 改为 1313×864。初次手势使用 WebKit 外框坐标，未命中内容区手柄；改用 X11 内容区坐标后通过。这是验收坐标校准，没有将初次失败当成窗口能力通过。

诊断包与最终资源不同，`personal-desktop-ui-native-diagnostic-result.json` 明确记录 `frontendMatches=false`，不作为最终包资源一致性的证据。

最终 DEB 通过严格原生验收，`personal-desktop-ui-native-result.json` 记录 `diagnostic=false`、`frontendMatches=true`。确认 11 张工具卡片可按需打开、首次零工具、悬浮菜单不挤导航、Esc 焦点返回、侧栏宽度重载保留、8 个边缘命中区、原生拖动 1240×818 → 1313×864，以及 620×560 窗口内容宽度 420/420、无横向溢出。缩放前先在静态文字上激活测试窗口，并确认鼠标命中手柄，避免桌面焦点策略吞掉首次点击。最终日志：`personal-desktop-ui-native-release-v2.log`；截图：`personal-desktop-ui-native-picker.png`、`personal-desktop-ui-native-resized.png`、`personal-desktop-ui-native-narrow.png`。

原生 QA 使用隔离 XDG 资料目录与 D-Bus，保存/恢复安装级自启配置，并恢复鼠标位置。日常个人应用与资料不作为测试资料。

## 发行收尾

最终版归档到 `output/releases/personal-linux/0.19.1/Tideplan_0.19.1_amd64.deb`，SHA-256 为 `c4c0388ecf4e5089222038197a5b9cd7decf01e7bd7c04878b6d57a6bc25651f`。同目录保留按需加载前的本轮候选、校验值和发行 manifest；原 0.19.0 包与安装目录保留。

已安装至 `/home/gellar/.local/opt/oceanseo-personal/0.19.1/usr/bin/tideplan`，二进制 SHA-256 `3d67887db1d8e146cd12317ba6390ea3ffb7ae32b1dcb5e1a8cb53d9cd608f02` 与验收包一致。桌面菜单、协议、自启和用户命令已指向新版。记录：[安装](personal-workspaces-install-0.19.1.json)、[安装核对](personal-desktop-ui-install-verification.json)。没有强制停止日常应用；从托盘菜单退出当前应用，再重新打开即可加载新版。

构建与 QA 进程结束后完成预算清理，未跳过，释放 8,912,896 字节，受管理缓存 5,461,221,376 字节，低于 8 GiB。项目约 5.1 GiB，磁盘剩余约 18 GiB。证据：`personal-desktop-ui-cleanup.json`。没有在清理后重建。
