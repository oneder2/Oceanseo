# Oceanseo 首次私有后端部署

后续更新：同日已新增公开下载网站，根路径现在返回 200，原有私人接口及权限保持不变。以下内容保留首次后端部署时的状态；下载网站的当前部署与验证见 [页面发布报告](landing-release-2026-10-04.md)。

日期：2026-10-04，America/New_York；服务器安装时间为 2026-10-05 00:40 UTC。SSH 使用用户已有别名 `Oceanseo`，账号 `deploy`、端口 2222。用户确认域名源站及提权豁免后执行。本轮不重命名应用包标识，不上传个人任务，不修改桌面/Android 同步配置，不触发其他生态项目。

## 部署结果

- 2 vCPU、约 3.8 GiB 内存、40 GB 云盘，部署后根分区约 2.4 GiB 已用、36 GiB 可用；内存约 501 MiB 已用。
- 安装全部当时可用系统更新，0 个剩余候选更新，未删除旧内核或执行 autoremove。系统版本更新到 Ubuntu 24.04.5 LTS。
- 新内核 `6.8.0-146-generic` 已安装，当前仍运行 `6.8.0-88-generic`。系统有 reboot-required 标记，本轮没有重启机器；需安排窗口完成新内核和部分系统组件切换。
- Caddy 使用 Ubuntu 签名仓库包 `2.6.2-6ubuntu0.24.04.3`。源站取得有效的 Let's Encrypt 域名证书；公网经过 Cloudflare。代理请求体上限 17 MB，后端仍执行自己的协议容量限制；增加请求超时及后端连接数量限制，不宣称已提供完整 WAF/每 IP 限流。
- 本次检查的源站证书到期时间为 2027-01-02 23:41:37 UTC，由 Caddy 自动续期。Cloudflare TLS 终止并不提供端到端加密：代理提供方和服务器管理员都具有读取请求数据的能力，设备首次同步前应接受这一边界。
- 同步服务、只读采集器和 Caddy 正常运行，均已设置开机启用。每日备份定时器启用。首次启动使用新空资料库，revision 0、0 条记录。

## 接口与接入

| 用途 | 地址 | 鉴权 |
| --- | --- | --- |
| 应用设置中的同步服务地址 | `https://oceanseo.gellaronline.cc` | 独立同步令牌 |
| 实际同步协议端点 | `https://oceanseo.gellaronline.cc/v1/vault` | 同步令牌，应用自动追加路径 |
| 主机档案的健康检查 | `https://oceanseo.gellaronline.cc/health` | 无敏感内容，无需令牌 |
| 主机档案的资源采集 | `https://oceanseo.gellaronline.cc/metrics` | 独立采集令牌 |

电脑与 Android：先从设置导出各自完整备份，再在「设置 → 跨设备同步」填写基础地址及同步令牌，保存后检查更改，处理冲突，再确认同步。两台设备属于同一用户，使用同一同步令牌。不要给不同用户共享这个资料库。

主机档案：健康检查填写 `/health` 完整地址，采集填写 `/metrics` 完整地址；保存档案后保存采集令牌，再点击立即检查。两个令牌不能混用，也不是 AI API_KEY。主机档案仍不在核心同步范围内。

根地址 `/` 刻意返回 404。这是应用的私有同步/采集后端，不是网页版应用，也没有新增公开注册或管理网站。

## 文件与服务

| 内容 | 服务器路径/服务 |
| --- | --- |
| 同步代码 | `/opt/tideplan-sync/server.py`、`backup.py`、`backup-daily.sh` |
| 同步私有数据 | `/var/lib/tideplan-sync/vault.sqlite3` |
| 同步环境与令牌 | `/etc/tideplan-sync.env`，root 所有、600 |
| 采集代码 | `/opt/tideplan-monitor/collector.py` |
| 采集环境与令牌 | `/etc/tideplan-monitor.env`，root 所有、600 |
| HTTPS 路由 | `/etc/caddy/Caddyfile`，root:caddy、640；安装前默认配置已另存副本 |
| systemd | `tideplan-sync.service`、`tideplan-monitor.service`、`caddy.service` |
| 备份任务 | `tideplan-sync-backup.service`、`tideplan-sync-backup.timer` |
| 本地备份 | `/var/backups/tideplan-sync/`，私有目录 700 |

同步使用无登录权限的专用 `tideplan-sync` 用户，采集器使用 systemd DynamicUser。两个进程仅监听 `127.0.0.1:4789` / `127.0.0.1:4790`。Caddy 管理接口只监听 `127.0.0.1:2019`。UFW 原有规则允许 2222/tcp、80/tcp、443/tcp，拒绝 22/tcp；本轮未改防火墙或 SSH 策略。最终 SSH 配置保留禁止 root/密码登录。

连接参数已安全取回到本机 `/home/gellar/.local/share/oceanseo-server/connection.json`，目录 700、文件 600。字段 `syncToken` / `metricsToken` 分别用于两个功能。文件在仓库外，不应提交 Git、上传公共附件或贴入聊天；报告不保存令牌。

## 备份与验收

每日 UTC 03:15 开始、随机延迟最多 10 分钟，使用 SQLite 在线 backup API 创建唯一文件名副本。Persistent 启用，错过运行可补执行。首次副本为 `vault-20261005T004004Z.sqlite3`，8192 字节。

该副本已另取回本机 `/home/gellar/.local/share/oceanseo-server/backups/`，权限 600，并执行完整性检查及临时数据库恢复：表内容、资料库标识和 revision 一致，未覆盖运行中数据库。

当前只有服务器本地每日自动备份，加上本次取回的一份空库副本。没有自动异地备份/加密上传，也没有自动删除备份；需要用户选择长期异地存储、保留策略并监测磁盘。仅本次空库恢复验收不代表日常资料已经完成恢复演练。

验证结果：

- VPS 上 5 项同步服务、2 项采集器测试通过，测试数据库隔离在临时目录，不污染正式资料库。
- 本机 2 项新增凭据文件测试通过：600 权限、已存在文件不可覆盖。
- Caddy 配置及 4 个 systemd unit 校验通过；系统无失败单元、无 dpkg 半安装状态。
- 直接连接源站，使用正确域名验证 TLS，`/health` 返回 200，SSL 校验结果 0；不是只验证 Cloudflare 边缘证书。
- 公网 HTTPS 健康检查 200，未带令牌的两个私有端点均 401；正确令牌均 200，两个令牌互用均 401，无重定向跟随。Cloudflare 响应标记 DYNAMIC，并带 no-store。
- 公网无法连接后端 4789，`ss` 确认两个后端仅监听回环地址。
- 两个后端服务重启后 HTTPS 复核通过，正式资料库仍为空。已经设置开机启用，但没有通过实际整机重启验收。

## 复用与运维

部署文件在 `services/deployment/`。`install-first.sh` 只供首次安装：发现已有代码目录、数据库目录或令牌即停止，不是更新脚本。Caddyfile 针对本域名，其他主机部署前必须修改并 validate。系统更新、软件包安装、域名/防火墙核查需单独完成。

```sh
ssh Oceanseo
sudo systemctl status tideplan-sync tideplan-monitor caddy
sudo systemctl list-timers tideplan-sync-backup.timer
sudo journalctl -u tideplan-sync -u tideplan-monitor --since '1 hour ago'
sudo systemctl start tideplan-sync-backup.service
```

本机只读公网复核，输出不含令牌：

```sh
python3 services/deployment/verify-https.py /home/gellar/.local/share/oceanseo-server/connection.json
```

下一步：安排重启并验证新内核/开机服务；收紧当前 `deploy NOPASSWD: ALL`；两台实际设备先备份再执行首次同步；确认 Cloudflare 使用 Full (strict) 而非 Flexible 并避免给私有 API 添加浏览器挑战；配置持续异地备份。当前公网调用正常，但本轮没有读写 Cloudflare 账户设置。
