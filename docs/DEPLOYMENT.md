# 部署指南

本指南说明如何在个人电脑、局域网和 Docker/NAS 上运行 My Confession。公开访问时还需要 HTTPS 反向代理。

## 在个人电脑运行

安装 Node.js 22.5 或更高版本（建议 Node.js 24），然后在项目目录启动：

```bash
# macOS / Linux
./start.sh
```

Windows 用户运行 `start.bat`。浏览器打开 <http://127.0.0.1:8080/>。服务首次启动时会生成管理口令并在终端显示；请保存好口令。停止服务可在终端按 `Ctrl+C`，Windows 则关闭启动窗口。

默认监听 `0.0.0.0:8080`。macOS/Linux 可通过 `PORT=9000 ./start.sh` 更换端口。

## 局域网访问

让其他设备访问运行服务的电脑内网 IP，例如 `http://192.168.1.20:8080/`。请在路由器或操作系统防火墙中，仅对需要的网络开放该端口。内网部署默认使用 HTTP。

<a id="docker-nas"></a>
## Docker / NAS

NAS 需要安装 Docker 和 Compose。将项目目录放在 NAS 上，在该目录运行：

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f my-confession
```

等容器健康状态变为 `healthy` 后，在局域网打开 `http://NAS的IP:8080/`。首次启动时日志会显示管理口令；保存好后，不要把日志或口令公开分享。

常用操作：

```bash
docker compose up -d --build  # 构建或更新并启动
docker compose logs -f        # 查看日志
docker compose stop           # 停止，保留容器和数据
docker compose start          # 重新启动
docker compose down           # 删除容器，保留数据卷
```

Compose 将 SQLite 数据、备份和管理配置保存在命名卷 `confession_data`。普通重启、镜像更新以及 `docker compose down` 都会保留数据。**不要运行 `docker compose down -v`**，它会删除数据卷。

### 从已有的 Node.js 部署迁移到 Docker

如果这台机器上**已经在跑 `node server.js`**，`data/app.db` 和 `config.json` 里已经有真实数据和现用口令，**不要直接 `docker compose up -d --build` 然后访问**——容器会新建一个空卷，表现是「人物册空了」「后台口令变了」。

正确顺序：

```bash
# 1. 停掉旧的 node 进程
pkill -f "node server.js"          # Windows：关掉启动服务的黑窗口

# 2. 构建并起容器（此时卷是空的，先别访问）
docker compose up -d --build
docker compose stop my-confession

# 3. 把老数据塞进卷（路径按实际位置调整）
docker cp data/app.db  my-confession:/app/data/app.db
docker cp config.json  my-confession:/app/data/config.json

# 4. 起回来并确认
docker compose start my-confession
docker compose logs -f my-confession
```

第 3 步的 `config.json` **一定不能漏**——那是这台机器自己的管理员口令（`adminToken`），不带的话容器会生成新的，你会进不去 `/pages/admin.html`。

迁移完成后，根目录的 `data/` 和 `config.json` 就不再被容器使用（容器只认卷），可以留着当备份，别急着删。

## 公开访问

### Cloudflare Tunnel（没有公网 IP 时最省事）

不需要公网 IP、不用开端口、自带 HTTPS。需要一个托管到 Cloudflare 的域名。

```bash
# 安装
winget install --id Cloudflare.cloudflared      # Windows
# macOS: brew install cloudflared ／ Debian: 见官方文档

# 登录并建隧道
cloudflared tunnel login
cloudflared tunnel create my-confession

# 把域名指到隧道（示例）
cloudflared tunnel route dns my-confession class1.你的域名.top

# 指到本机 8080（Docker 部署也是指 8080，容器已经把端口映射到宿主机）
cloudflared tunnel run --url http://127.0.0.1:8080 my-confession

# 跑通后装成服务，开机自启
cloudflared service install
```

只想临时给几个人看（不需要域名）：

```bash
cloudflared tunnel --url http://127.0.0.1:8080
```

它会打印一个 `https://xxx.trycloudflare.com`，几小时内有效。

### Caddy 反向代理

服务器上已经有域名和 80/443 时最省事，自动签证书：

```
# /etc/caddy/Caddyfile
class1.你的域名.top {
    reverse_proxy 127.0.0.1:8080
}
```

### systemd（VPS 上直接跑 Node，不用 Docker）

```ini
# /etc/systemd/system/confession.service
[Unit]
Description=My Confession
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/confession
ExecStart=/usr/bin/node server.js
Environment=PORT=8080
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now confession
systemctl status confession
```

> 国内服务器需要备案；不备案就买境外机房（访问会慢一些）。

### 上线前安全检查

- [ ] 管理口令足够强，并且你知道它存在哪（`config.json` / Docker 卷内 `/app/data/config.json`）
- [ ] `config.json`、`data/`、`server.js` 无法通过网址下载（`server.js` 已内置拦截，实测 404）
- [ ] 走 HTTPS，否则留言和提交内容是明文传输
- [ ] 想开审核：打开 `/pages/admin.html`，在里面切换「词条审核 / 评论审核 / 留言审核」，改完即时生效，不用重启
- [ ] 限制 NAS 管理界面、备份目录和 Docker 卷的访问权限

## Windows 开机自启与定时备份

**开机自启**（管理员 PowerShell 跑一次）：

```powershell
$dir = "D:\code\01_站点\My Confession"
$act = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$dir\启动服务.bat`"" -WorkingDirectory $dir
$trg = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "My Confession" -Action $act -Trigger $trg -Description "校园同好站（人物册+留言板）"
```

**每天 23:00 自动备份**：

```powershell
$act = New-ScheduledTaskAction -Execute "node" -Argument "backup.js" -WorkingDirectory $dir
$trg = New-ScheduledTaskTrigger -Daily -At 23:00
Register-ScheduledTask -TaskName "My Confession 备份" -Action $act -Trigger $trg
```

## 一键出包（Windows 交接用）

```powershell
cd "D:\code\01_站点\My Confession"
powershell -ExecutionPolicy Bypass -File .\打包部署.ps1
# 产物：D:\code\01_站点\My Confession-deploy-<日期>.zip
```

脚本会：先 `node backup.js` 导一份干净数据库快照 → 只复制运行时需要的 46 个文件 → 包内中文文件名换成 ASCII（避免 Linux 解压乱码）→ 生成 `README-DEPLOY.txt`。

> 用 Docker 部署的话不需要这个包，直接 `docker compose up -d --build`。

## 交接清单

- [ ] 对方 Node 版本 ≥ 22.5（Docker 部署可跳过，镜像内已是 Node 24）
- [ ] 解压即能 `./start.sh` 跑起来（或容器变成 `healthy`）
- [ ] 打开站点能看到人物册数据、留言板正常
- [ ] **视频/图片能正常显示**：`curl -I <站点>/assets/media/nanchenglu-54-15.m4a` 应为 200
- [ ] 改掉默认管理口令，并且知道它在哪（`config.json` / Docker 卷内）
- [ ] 配好 HTTPS（Cloudflare Tunnel 或 Caddy）

## 数据备份与恢复

### Node.js 直接运行

服务运行期间也可执行：

```bash
node backup.js
```

脚本通过 SQLite `VACUUM INTO` 生成一致性快照，写入 `data/backup/`，最多保留 30 份。备份应复制到另一块磁盘或独立存储位置；仅留在原设备上无法应对磁盘故障。

### Docker / NAS

在项目目录执行以下命令，会在数据卷中生成备份：

```bash
docker compose exec my-confession node backup.js
```

该备份仍位于 `confession_data` 卷内。请使用 NAS 的 Docker 卷备份功能或平台提供的导出方式，将卷数据备份到独立存储。恢复前停止服务，并按 NAS 的卷恢复流程还原数据。删除卷或重建存储前，先确认独立备份可用。

## 相关说明

- 开发和本地检查见[开发指南](DEVELOPMENT.md)。
- `docker compose config --quiet` 可检查 Compose 配置格式；镜像构建和容器启动需要 Docker daemon 正常运行。
