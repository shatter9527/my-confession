# 部署指南

本指南说明如何在个人电脑、局域网和 Docker/NAS 上运行 My Confession。公开访问时还需要 HTTPS 反向代理。

## 在个人电脑运行

安装 Node.js 22.5 或更高版本（建议 Node.js 24），然后在项目目录启动：

```bash
# macOS / Linux
./start.sh
```

Windows 用户运行 `start.bat`。浏览器打开 <http://127.0.0.1:8080/>。首次安装且没有旧配置时会生成管理令牌并仅在第一次启动终端显示；请保存好口令。停止服务可在终端按 `Ctrl+C`，Windows 则关闭启动窗口。

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

等容器健康状态变为 `healthy` 后，在局域网打开 `http://NAS的IP:8080/`。首次安装时日志会显示一次初始管理令牌；保存好后，不要把日志或口令公开分享。

常用操作：

```bash
docker compose up -d --build  # 构建或更新并启动
docker compose logs -f        # 查看日志
docker compose stop           # 停止，保留容器和数据
docker compose start          # 重新启动
docker compose down           # 删除容器，保留数据卷
```

Compose 将 SQLite 数据（包含管理员、令牌、审核开关和日志）、备份及旧配置保存在命名卷 `confession_data`。普通重启、镜像更新以及 `docker compose down` 都会保留数据。**不要运行 `docker compose down -v`**，它会删除数据卷。

### 绿联 NAS 图形界面更新

UGOS Pro 不同版本的菜单名称可能不同。先打开 Docker 应用，在网站容器详情中查看「存储空间 / 挂载目录」，记录容器的镜像、端口和数据挂载。

- 只有 `/app/data` 挂载：网页代码在镜像里。在 NAS 文件管理器替换源码或点击容器「重启」，不会更新镜像里的页面。
- 挂载了 `/app` 或 `/app/pages`：对应的 NAS 目录会覆盖镜像中的文件，需同步更新该目录。也要检查是否曾单独挂载过 `people-normal.html`，旧文件挂载会遮住新镜像内的页面。

更新前停止容器，将现有数据目录或数据卷完整备份到独立位置，保留可能存在的 WAL 文件和旧配置。把新版源码放回原项目目录，保留现有 Compose 项目名、端口和 `/app/data` 挂载。使用项目界面的重新构建 / 更新功能重新构建镜像并重建容器；如果界面只提供重启，则需要先通过镜像构建功能从项目中的 `Dockerfile` 构建新版镜像，再让原服务使用它。不要勾选删除数据卷或清空关联目录。

更新后先访问 `http://NAS的IP:端口/api/version`，再访问公开域名的同一路径，均应返回 `2026.10.18-admin4`。若内网已更新而公开域名仍旧，核对反向代理或 Tunnel 指向的 NAS 地址和端口。若都旧，核对容器镜像与源码挂载。只有确认新版文件已被实际提供，才检查额外的代理缓存。

### 用替换文件的方式更新（保留数据）

程序文件与 Docker 数据卷分开。先记录当前挂载，停止容器并把整个数据目录复制到项目目录之外：

```bash
docker inspect my-confession --format '{{range .Mounts}}{{println .Type .Name .Source "->" .Destination}}{{end}}'
docker stop my-confession
mkdir -p ../my-confession-backup-before-update
docker cp my-confession:/app/data ../my-confession-backup-before-update/
```

每次更新使用新的备份目录名。确认备份包含 `app.db`，保留 `app.db-wal`/`app.db-shm`（若存在）以及旧 `config.json`。运行中的数据库可能把实际数据放在 WAL 中，不能仅复制 4096 字节的 `app.db` 就认为备份完整。

把发布包解压覆盖到**原项目目录**；保持原 Compose 项目名、挂载配置、`.env` 和数据卷不变。如果 inspect 显示 `bind`，绝不能删除其中指向 `/app/data` 的宿主目录。项目提供的发布包不包含运行时数据，也不包含 `.env`，可用于覆盖程序文件。

```bash
docker compose up -d --build
docker compose logs --tail=50 my-confession
docker exec my-confession node admin.js list
```

在浏览器打开 `http://服务器地址:8080/api/version`，应返回 `2026.10.18-admin4` 及构建指纹。返回 404 表示该访问路径没有提供当前版本接口，应核对容器和反向代理指向。更新后用原令牌确认人物、留言及审核开关；查看完整令牌可执行 `docker exec my-confession node admin.js token`。

本版 HTML、JS、CSS 使用禁止缓存响应头，页面内脚本/样式地址附带发布版本，避免继续加载旧版隐藏人物词条的脚本。若反向代理强制缓存了旧 HTML，需要清除对应缓存并重新加载。

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
docker cp data/.  my-confession:/app/data/  # 整个已停止写入的数据目录，含可能存在的 WAL
# 仅当来源仍是旧版、管理员尚未迁入数据库时需要：
docker cp config.json  my-confession:/app/data/config.json

# 4. 起回来并确认
docker compose start my-confession
docker compose logs -f my-confession
```

如果来源是旧版，第 3 步的 `config.json` **不能漏**，其中的 `adminToken`/`adminTokens` 和审核设置会在首次启动时导入数据库。已完成管理员迁移的新版本只需迁移一致的数据库快照；旧配置不再决定当前令牌。参见 [管理员升级与恢复](ADMINISTRATION.md)。

迁移完成后，根目录的 `data/` 和 `config.json` 就不再被容器使用（容器只认卷），可以留着当备份，别急着删。

## Docker 部署后人物词条不见了

先区分两类内容：

- **页面内置词条**：其他人物分类仍随 HTML 发布，不依赖数据库，固定显示在在线列表之前。“正常人”的六条内置原文已在当前版删除，只展示在线添加的人物。如果仍先闪现六条再消失，检查实际返回的 `pages/people/people-normal.html` 是否还有 `people-static`，以及当前容器和源码挂载是否已更新。
- **网页新增的人物、留言和评论**：存储在 SQLite。若从 Node 切换至 Docker、换了 Compose 项目目录/名称或删除过数据卷，容器可能正在使用另一份数据库。前端修复不会恢复这些内容，需要确认旧数据库或旧卷的位置后迁移。

在 Compose 目录检查当前挂载和数据数量（不输出口令或正文）：

```bash
docker inspect my-confession --format '{{range .Mounts}}{{println .Type .Name .Source "->" .Destination}}{{end}}'
docker compose exec my-confession node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/app/data/app.db',{readOnly:true});console.log(db.prepare('SELECT category,status,COUNT(*) AS count FROM people GROUP BY category,status').all());db.close()"
docker volume ls
```

Compose 默认会给卷名加项目名前缀，因此换目录或 `-p` 参数可能创建新的空卷。确认旧卷仍在后再调整挂载；不要用 `docker compose down -v` 排查，它会删除数据卷。

更新代码及镜像（保留当前卷）：

```bash
git pull --ff-only origin main
docker compose up -d --build
```

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

- [ ] 管理口令足够强，并且你知道它存在哪（`data/app.db` 的管理员表；Docker 为 `/app/data/app.db`）
- [ ] `config.json`、`data/`、`server.js` 无法通过网址下载（`server.js` 已内置拦截，实测 404）
- [ ] 走 HTTPS，否则留言和提交内容是明文传输
- [ ] 想开审核：打开 `/pages/admin.html`，在里面切换「词条审核 / 评论审核 / 留言审核」，改完即时生效，不用重启
- [ ] 限制 NAS 管理界面、备份目录和 Docker 卷的访问权限

## Windows 开机自启与定时备份

**开机自启**（管理员 PowerShell 跑一次）：

```powershell
$dir = "D:\code\01_站点\My Confession"
$act = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$dir\start.bat`"" -WorkingDirectory $dir
$trg = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "My Confession" -Action $act -Trigger $trg -Description "校园同好站（人物册+留言板）"
```

**每天 23:00 自动备份**：

```powershell
$act = New-ScheduledTaskAction -Execute "node" -Argument "backup.js" -WorkingDirectory $dir
$trg = New-ScheduledTaskTrigger -Daily -At 23:00
Register-ScheduledTask -TaskName "My Confession 备份" -Action $act -Trigger $trg
```

## 生成部署包

安装 Python 3 后，在项目目录执行（Windows 也可用 `py -3`）：

```bash
python3 scripts/package-release.py
```

产物为 `releases/my-confession-<版本>.zip`，终端同时输出 SHA256。脚本按白名单收集源码、资源、文档和验证工具；不包含数据库、旧配置、`.env`、依赖目录或测试产物。部署包不是数据备份，不能代替下面的数据库备份流程。

`releases/` 仅用于本地交付，不提交 Git。GitHub 下载的源码 ZIP 也可用于构建；解压后以包含 `Dockerfile` 和 `compose.yaml` 的目录为项目目录。

## 交接清单

- [ ] 对方 Node 版本 ≥ 22.5（Docker 部署可跳过，镜像内已是 Node 24）
- [ ] 解压即能 `./start.sh` 跑起来（或容器变成 `healthy`）
- [ ] 打开站点能看到人物册数据、留言板正常
- [ ] **视频/图片能正常显示**：`curl -I <站点>/assets/media/nanchenglu-54-15.m4a` 应为 200
- [ ] 改掉默认管理口令，并且知道它在哪（`data/app.db`；Docker 数据卷内）
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
