# Oceanseo 内测运维闭环记录

日期：2026-10-07 UTC

本轮完成了内测发布闭环中可以自动化、且不需要正式签名密钥或外部服务选择的部分。没有修改生产业务数据，没有替换公开 APK/DEB，也没有创建合成账号。

## 已完成

- 新增只读 SQLite 备份审计器 `services/deployment/backup-audit.py`。
- 审计每套备份的目录和文件私有权限、最新备份新鲜度（默认 30 小时）、SQLite `integrity_check` 和所需 schema。
- 为个人同步和邀请制账号分别增加 systemd oneshot service/timer。
- 健康端点现在会读取审计 service 的私有状态标记；标记缺失、失败或超过 30 小时，`/health/sync` 或 `/health/accounts` 返回 503，便于外部监控发现备份故障。
- Android 签名候选 workflow 增加稳定包名、版本、证书摘要和 AAB 签名校验，并上传 `release-metadata.json`。
- 首次安装脚本和增量部署脚本均会安装并启用审计 timer；增量部署保留原文件和 systemd 单元回滚副本。
- 本机备份审计测试 5 项通过，核心测试 98 项通过，同步服务 7 项通过，账号服务 20 项通过，生产构建和 release contract 通过。
- 已部署到 `oceanseo.gellaronline.cc`。两个审计 service 均实际退出 `0/SUCCESS`，两个 timer 为 `active`。
- 线上 HTTPS、账号健康、同步健康和未授权边界复核通过；最新两套备份的完整性均为 `ok`，备份文件权限为私有模式。

## 运维边界

审计失败会使对应 oneshot service 失败并留下 systemd/journal 证据，但本轮尚未配置外部告警渠道。异地加密副本、留存策略和灾难恢复目标仍需在确定存储位置后配置；同机备份不能视为灾备。

## 下一步验收

1. 准备并离线备份正式 Android keystore，配置签名 workflow secrets。
2. 构建签名 APK/AAB，验证连续升级、迁移和恢复。
3. 在两台真实设备完成断网、冲突、删除、撤销、token 过期、重启和通知矩阵。
4. 确认 AI 采用邀请制 BYOK 还是托管 gateway，并补齐费用、限流和隐私告知。
5. 配置异地备份与外部告警后，再邀请少量内测用户。

上述门槛未完成前，Oceanseo 仍是邀请制技术内测候选，不应宣称已经达到普通用户公开发行标准。
