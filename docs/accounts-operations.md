# 邀请制账号服务运维

独立服务已于 2026-10-05 首次部署并验证。本文件是运维操作说明，实际上线范围和证据见 [部署报告](account-center-deployment-2026-10-05.md)。

## 边界

- `/v2/*` 使用独立 `oceanseo-accounts.service`、回环端口 4791、数据库 `/var/lib/oceanseo-accounts/accounts.sqlite3`。
- 服务级只读健康检查为 `/health/accounts`；它只返回服务名和 schema 版本，不需要账号 token，也不返回用户数量、资料库 ID 或业务内容。
- `/v1/vault`、原同步令牌、原个人资料和 `/metrics` 不迁移、不复用、不关闭。下载页与已发布安装包保持不变。
- 不开放公开注册。注册必须提供一次性邀请，默认 72 小时有效。每个用户名拥有独立用户和资料库，登录签发独立设备会话。
- 云端业务资料不是端到端加密；服务器维护者可访问数据。备份包含密码哈希和会话摘要，必须私人保管。

## 首次安装

在 Linux 与 Android 联合验收通过、取得部署授权之后：

1. 只打包账号模块、共享同步校验/备份模块和部署文件，保留 `services/` 模块结构。不要上传本机凭据、应用业务数据库或签名密钥。
2. 读取生产 Caddyfile 的 SHA-256，并核对配置。`install-accounts-first.sh EXPECTED_CADDY_SHA256` 要求 root，遇到已有账号部署或 Caddyfile 变更会拒绝安装，不覆盖旧数据库。
3. 脚本建立专用无登录用户、700 数据/备份目录、600 环境文件；只监听回环地址。配置验证通过后增加 `/v2/*` 代理并 reload Caddy，不重启 VPS 或旧服务。
4. 自动启用独立备份 timer，UTC 03:35 起随机延后最多 10 分钟；每次生成新文件，拒绝覆盖已有备份。
5. 执行 HTTPS、邀请限制、两个合成用户隔离、设备撤销、服务重启与独立备份恢复检查。前后复核旧同步和采集器认证、个人资料、下载页与安装包校验值。

安装失败会尽可能恢复旧 Caddyfile、停用本轮新增服务/timer，保留新增私人目录供检查，不自动删库。不要反复重跑首次安装脚本来覆盖半完成部署。

## 邀请与密码恢复

在服务器代码根目录，以账号服务用户运行：

```sh
cd /opt/oceanseo-accounts
sudo -n -u oceanseo-accounts python3 -m services.accounts.admin \
  --database /var/lib/oceanseo-accounts/accounts.sqlite3 invite --hours 72
```

只输出一次邀请码，通过私人渠道发给测试者。不要写到公开下载页、Git、终端日志分享或错误报告。新版客户端默认连接 `https://oceanseo.gellaronline.cc`，普通用户无需设置服务地址；自托管地址只在高级连接选项中修改，不需要手动附加 `/v2`。

密码重置需交互终端，不把新密码放到命令参数或环境变量：

```sh
cd /opt/oceanseo-accounts
sudo -u oceanseo-accounts python3 -m services.accounts.admin \
  --database /var/lib/oceanseo-accounts/accounts.sqlite3 reset-password 用户名
```

维护者输入隐藏密码；重置撤销该用户全部设备会话。本机离线资料仍保留。没有邮箱自助找回或第三方登录。

## 检查与备份

```sh
sudo systemctl status oceanseo-accounts oceanseo-accounts-backup.timer
sudo journalctl -u oceanseo-accounts --since today
sudo systemctl start oceanseo-accounts-backup.service
sudo ls -l /var/backups/oceanseo-accounts
```

在线备份使用 SQLite backup API，并做 `integrity_check`。不要直接复制活动 WAL 数据库当作完整备份。新备份文件权限 600，目录权限 700；本机备份不等于异地灾备，目前没有替用户配置外部存储或自动删除策略。

备份审计失败会触发 `oceanseo-backup-alert@accounts.service`。告警默认关闭；只有在服务器上以 root 600 权限创建 `/etc/oceanseo-alert.env` 并配置 HTTPS `OCEANSEO_ALERT_WEBHOOK_URL` 后才会发送脱敏事件。告警请求不包含数据库路径、业务资料、密码或令牌。

先把备份恢复到独立私人目录并核对用户、资料库及撤销状态，不覆盖在线库。正式恢复需维护窗口、停止 v2 服务、保存当前数据库及 WAL、核实备份并制定会话全量撤销/重新邀请方案。恢复旧数据库可能使已撤销会话和邀请码恢复有效，客户端也会因云端 revision 回退暂停；不能只替换文件后让所有设备自动写入。

## 部署验证工具

`services/deployment/verify-accounts.py` 仅修改本轮精确生成的两个合成用户名，不按前缀批量操作。`exercise` 保存私有临时会话状态，之后仅重启 v2 服务，再执行 `resume` 验证真实重启和独立恢复，最后停用合成账号、撤销其全部会话，保留合成资料作为验收记录。输出不包含邀请码、密码或会话令牌。

状态文件及恢复副本必须在仓库外的 700 目录；文件权限 600。正式域名验证只允许 HTTPS，拒绝跟随重定向。`--allow-local` 只用于临时回环 HTTP 服务测试。

本地回归：`npm run test:accounts-server` 包含账号服务 17 项和部署验证 2 项，检查既有账号不会被合成账号清理影响。

服务更新使用 `services/deployment/deploy-services.sh`。脚本只上传服务代码和 Caddyfile，拒绝携带环境文件、邀请码、数据库或密钥；部署期间先暂停审计 timer，保存远端代码副本并等待两个回环端口监听，再运行审计、恢复 timer，最后校验 Caddy 并 reload。任一健康检查失败会恢复代码与配置，不会自动修改业务数据库。
