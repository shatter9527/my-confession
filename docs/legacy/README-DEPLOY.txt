My Confession - 部署包 (20261017)

[运行要求]
  Node.js 22.5+ （推荐 24 LTS）。低版本没有内置 node:sqlite，会直接启动失败。
  零依赖，不需要 npm install。

[启动]
  Windows : 双击 start.bat
  Linux   : chmod +x start.sh && ./start.sh
  换端口   : PORT=9000 ./start.sh   (Windows: set PORT=9000)

  启动后控制台会打印站点地址、审核台地址和管理口令。

[数据]
  data/app.db 是 SQLite 干净快照（已 VACUUM，不带 WAL）。
  从旧机器搬数据：停服务，用旧 data/app.db 覆盖本文件的 data/app.db。
  备份：node backup.js  ->  data/backup/

[上线前必做]
  1. 改掉 config.json 里的 adminToken
  2. 用 HTTPS（Cloudflare Tunnel 自带；VPS 用 Caddy 反代）
  3. 详细步骤见 DEPLOY.md

[Linux 常驻]
  deploy/confession.service 是 systemd 单元，按其中注释部署。
