# 服务级健康检查部署记录

日期：2026-10-07 UTC
目标：为邀请制账号、个人同步服务补充不泄露业务数据的数据库就绪检查，并为内测发布提供可重复的只读线上验收。

## 已部署

- `GET /health/accounts`：通过 Caddy 代理到账号服务，检查账号数据库 schema 和 vault 表可读性。
- `GET /health/sync`：通过 Caddy 代理到个人同步服务，检查 vault 表和 singleton 行可读性。
- 两个端点均返回 `Cache-Control: no-store`、服务名和 schema 版本，不返回用户数、vault ID、记录、令牌或密码哈希。
- `/health`、`/v1/vault`、`/v2/*`、`/metrics` 的既有边界保持不变。

## 验收证据

本地 `python3 services/deployment/verify-live.py` 于部署后通过：

- 公共 `/health`：HTTP 200，正文为 `ok`。
- `/health/accounts`：HTTP 200，`schemaVersion: 1`。
- `/health/sync`：HTTP 200，`schemaVersion: 1`。
- 未携带凭据访问 `/v2/me`、`/v1/vault`、`/metrics`：均为 HTTP 401。
- 不跟随重定向，TLS 使用系统证书校验。

远端 `oceanseo-accounts`、`tideplan-sync`、`tideplan-monitor`、`caddy` 均为 active；账号和同步备份 timer 仍启用。部署脚本在远端保存了代码/Caddyfile 回滚副本，最终成功目录为 `/var/backups/oceanseo-services-20261007T001850Z/`。

随后手动触发 `tideplan-sync-backup.service` 与 `oceanseo-accounts-backup.service`，两者均为 `Result=success`、`ExecMainStatus=0`。新副本分别为 `vault-20261007T004114Z.sqlite3`（8192 bytes）和 `accounts-20261007T004114Z.sqlite3`（61440 bytes），权限均为 `0600`；以只读连接执行 `PRAGMA integrity_check` 均返回 `ok`。这证明了备份作业实际可执行，但仍不等于已经完成异地备份或灾难恢复演练。

随后将这两个副本恢复到隔离的临时目录，检查 `vault`、`users`、`vaults`、`invites`、`sessions`、`auth_limits` 表和完整性结果均通过（恢复文件权限 `0600`），演练结束后临时目录已删除。该演练没有覆盖在线数据库，也没有把副本复制到异地存储。

本轮没有创建账号、写入 vault、使用邀请码、修改环境文件或替换公开 APK/DEB。第一次尝试因服务启动竞态回滚，修正有界启动等待后重新部署成功。

## 边界

健康检查只证明服务进程能访问预期 schema，不证明 AI 请求、双设备冲突合并、通知投递、异地备份或高并发容量。普通用户内测前仍需完成正式签名、真实设备矩阵、恢复演练、外部备份/告警和支持流程。
