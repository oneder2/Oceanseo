# 潮汐刺猬 · 0.14.1

2026-09-28，依用户要求通过图像 API 生成，以用户上传的侧身刺猬 SVG 为参考。保留向前行走、圆耳和分层背刺，背部用潮汐曲线表达将杂乱想法整理成行动；海绿色、纸白和珊瑚色呼应现有界面。没有在图标中塞入具体业务工具，避免随功能扩充而失去一致性。

## 来源与复现

- 用户参考：`assets/branding/hedgehog-reference.svg`，原上传文件未修改。
- API 原始结果：`assets/branding/tideplan-hedgehog-api-original.png`。
- 透明底母版：`assets/branding/tideplan-hedgehog.png`。
- 应用图标母版：`assets/branding/tideplan-app-icon.png`。
- 完整最终提示词：[icon-prompt.txt](icon-prompt.txt)。
- 使用 imagegen 技能的 CLI/API 模式，模型 `gpt-image-2`，1024×1024，high quality，共一次成功调用；参考图经本地 PNG 转换后传入 images/edits 接口。用途是以参考生成新标志，而非逐像素编辑原图。使用环境配置的服务地址与密钥，未将密钥写入项目。
- 图像 API 返回实色洋红背景，随后使用技能自带 remove_chroma_key.py 去底和净化边缘，生成真实 alpha 透明通道；不是原生透明输出。未伪称生成了可编辑矢量图。

平台资源可离线重复生成：

```sh
uv run --with pillow python scripts/build-brand-icons.py
```

脚本只派生图片，不调用 API。输出包含桌面 PNG、网页 favicon、应用内标志、五档 Android 密度资源和尺寸检查图。透明母版无需重新生成。

## 应用位置

| 位置 | 资源 |
| --- | --- |
| Linux 安装器、启动菜单、窗口默认图标、系统托盘 | `src-tauri/icons/*.png`，现有 Tauri 默认图标链路 |
| 浏览器标签页 | `public/favicon.png` |
| 应用标题栏、偏好设置底部 | `public/brand/hedgehog.png` |
| Android 常规 / 圆形启动器、系统启动页 | `mipmap-*/ic_launcher*.png` 与自适应图标 XML |
| Android 13+ 主题图标 | `ic_launcher_monochrome.png` |
| Android 通知小图标 | `drawable-*/ic_notification.png`，白色 alpha 轮廓 |

Android 前景与底色分开，不把圆角方块重复塞进系统裁切框；前景所有有效像素均处在 66/108 的圆形安全区内。通知和主题图标仅使用单色轮廓，符合系统着色方式。桌面图标用浅海绿衬底，在深色和浅色面板上都能辨认。

本次统一应用品牌入口，保留用户先前选定的小汐潮汐精灵及其配色设置；完成按钮等功能性勾号也保留。新 PNG 母版取代旧应用 icon.svg；Android 勾号 / 波浪标志定义也已替换为刺猬资源。

16、24、32、48、64、96 像素以及深浅背景、圆形 / 圆角遮罩预览：`output/imagegen/icon-size-and-mask-review.png`。16 像素主要依赖整体轮廓，细节随尺寸减小而自然收敛。
