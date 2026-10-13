# Linux 个人版 0.19.2：工具与窗口打磨

本轮仅处理个人应用的工作区工具移除、保留系统面板的窗口扩展，以及拼豆模块入口合并。域名与线上路由保持在后续讨论范围。

## 实现

- 已安装工具的侧栏入口旁增加移除按钮。移除前等待当前资料写入，保存工作区时检查修订版本；移除工具只归档实例，保留资料。重新添加时恢复原实例；移除正在打开的工具后返回主页或通用待办。
- 桌面「全屏」按钮与 F11 改为原生最大化，使用窗口管理器保留系统面板的工作区域。Esc 恢复普通窗口；存在弹窗时优先处理弹窗。浏览器预览在既有浏览器窗口内展开应用。
- 拼豆只保留一个工作区入口「拼豆图纸」。图纸编辑、作品管理、拼放进度在模块内切换，切换前等待保存。旧的 `bead-home` / `bead-progress` 持久化路由映射到统一入口。作品、图纸与拼放资料沿用现有格式。

## 已完成的回归

`npm test` 119 项通过；类型检查与前端构建通过。浏览器实际验证打开工具后移除、重载后仍保持移除、重新添加恢复原资料；验证拼豆三个内部流程切换和单一侧栏入口。1400、780、620 px 下没有横向溢出。浏览器扩展没有调用浏览器全屏。

证据：`output/personal/tools-polish-tests.log`、`tools-polish-browser.log`；截图：`output/playwright/personal-tools-polish-beads.png`。

## 原生发行验证

最终 Linux DEB 构建通过；启动 JavaScript 484,423 字节、gzip 157,003 字节，低于原有 491,520 / 163,840 字节预算。证据：`output/personal/tools-polish-native-build.log`、`tools-polish-bundle.log`。

原生验收使用隔离 XDG 目录和 D-Bus，并保存/恢复安装级自启文件。实际安装文件确认版本 0.19.2、嵌入前端与本轮构建一致；实际添加采购资料、移除工具、恢复后从原生备份读出原资料。工作区添加会触发重载，验收等待工具库弹窗消失后再操作导航，避免将重载中间状态当成完成。

X11 原生窗口没有 `_NET_WM_STATE_FULLSCREEN`，具有两个最大化状态；工作区域为 `[0, 0, 1920, 1040]`，实际窗口为 `(0, 0, 1920, 1040)`，避开 1080 px 屏幕底部的 40 px 面板。Esc 后回到原 `(340, 97, 1240, 818)`。日志：`output/personal/tools-polish-installed-native-qa.log`；证据与截图：`output/playwright/personal-tools-polish-native.json`、`personal-tools-polish-native-maximized.png`。

## 安装与收尾

DEB 归档：`output/releases/personal-linux/0.19.2/Tideplan_0.19.2_amd64.deb`，SHA-256 `b78dbb0beca91810a3ceec1764144f1673e97a0faaf9e59d37d4bec25968c4f5`。

已用户级安装至 `/home/gellar/.local/opt/oceanseo-personal/0.19.2/usr/bin/tideplan`，二进制 SHA-256 `699e1cbeff50415646b46f1b35306a1bf87561ea813301feac51a3f661edcf77`，与 DEB 内容一致。Tauri 会为包内二进制写入发行类型元数据，构建目录二进制和包内二进制校验值分别记录在发行 manifest 中；两者差异仅为三字节 `UNK` / `DEB` 标记，最终严格验收针对安装文件完成。

桌面菜单、协议处理、自启与命令入口指向新版。修正用户命令和协议文件中的换行写入，检查 shell 语法、协议关联和安装校验值通过。记录：[安装](personal-workspaces-install-0.19.2.json)、[核对](personal-tools-polish-install-verification.json)。原 0.19.1 安装与既有资料保留。没有强制关闭日常应用；从托盘退出当前应用，再重新打开即可加载新版。

本轮浏览器、开发服务与原生 QA 已结束。构建后预算清理执行成功，未跳过；释放 8,925,184 字节可再生缓存。最终复验后再执行一次清理，保留发行包、源码、数据库和验收证据。
