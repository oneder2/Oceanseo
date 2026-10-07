# 0.14.1 · 潮汐刺猬图标

日期：2026-09-28。本版更换应用品牌图标，业务逻辑延续 0.14.0。

按用户要求，以提供的 Q 版刺猬为参考，通过 imagegen CLI 调用 `gpt-image-2` 图像 API 生成。侧身向前行走表达一步步行动，背刺融入潮汐曲线，海绿、奶油白和珊瑚色对应现有界面。完整提示词、API 原图、透明母版和离线派生方式见 [品牌说明](branding/README.md)。

## 应用范围

- 应用标题栏与设置页标志、网页 favicon。
- Linux 启动菜单、安装资源及默认窗口 / 托盘图标。
- Android 常规和圆形启动图标、自适应前景 / 背景、主题单色图标、通知小图标。
- Android versionCode 升至 1401，应用版本统一为 0.14.1。

## 验证

- 透明边缘、16–96 像素小图标、深浅背景和 Android 圆形 / 圆角遮罩已目视检查。派生脚本检查前景位于 Android 66/108 圆形安全区内。
- TypeScript / Vite 构建通过。浏览器桌面标题栏与设置页图标加载通过，手机布局 390 / 320 宽度检查通过。
- Android APK 构建成功，签名校验和 ZIP 16 KB 对齐检查通过；包内自适应图标实际引用新的彩色前景和单色资源，五档密度通知 PNG 已打包。
- Linux release 编译及 Debian 安装包生成成功，包元数据为 0.14.1 / amd64，hicolor 中 32、128、256、512 像素图标均已打包；未修改本机已安装的桌面应用。
- Debian 包中 512 像素图标的 SHA-256 与项目新图标一致。额外 AppImage 打包在 linuxdeploy / GTK 依赖归属查询阶段耗时较长，本轮主动停止该可选步骤；未生成或宣称交付新的 AppImage。已经完成的 release 可执行程序、DEB 和 APK 保留，本次图标变更没有因此回退。
- 已向连接的 Pixel 9a 覆盖安装，包管理器报告 `0.14.1-internal` / versionCode 1401，启动命令成功。WebView 中新品牌图片已加载；随后应用切至后台，未完成原生元素截图，不能据此声称已目视验收启动器主题切换和状态栏图形。
- 本次没有修改数据库、AI 配置、任务或用户输入；保留之前版本安装包。未重新运行与图标无关的完整业务测试，0.14.0 的验证范围见其交付报告。

## 安装产物

Android 内测 ARM64 APK：`src-tauri/target/release/bundle/apk/Tideplan_0.14.1_android_arm64_internal.apk`。

大小 41,144,419 字节；SHA-256：`9b7723d944f0817c9c0b251bfee97d4da3fdac8f3929466c1d4e57d40679ac82`。保持调试签名与 `.debug` 包名，不是商店正式发行包。

Linux Mint / Ubuntu / Debian 安装包：`src-tauri/target/release/bundle/deb/Tideplan_0.14.1_amd64.deb`。

SHA-256：`4f8c5f16335155b47908b576f1d4fc99b51a69dd7c4ad9a183d7d160bbf29fd8`。

图标母版：`assets/branding/tideplan-app-icon.png`；透明形象：`assets/branding/tideplan-hedgehog.png`。所有实际被应用引用的资源已保存到项目，运行不依赖 API 或外部图片地址。
