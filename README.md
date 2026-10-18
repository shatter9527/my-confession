# My Confession

彰武县高级中学 2022 级一班的班级纪念站，收录班规、往事、轶闻、人物册和《岁月史书》。

界面参考 Delineate 的纸色与手绘风格，提供日夜模式、键盘搜索和手机导航。

这是一个静态 HTML/CSS/JavaScript 网站，附带一个零第三方依赖的 Node.js 服务。静态内容可直接打开 `index.html` 浏览；人物册、留言板、评论和在线正文编辑需要启动服务。

## 快速开始

需要 Node.js 22.5 或更高版本。项目使用 Node 内置的 `node:sqlite`，无需运行 `npm install`。

```bash
# macOS / Linux
./start.sh
```

Windows 用户运行 `start.bat`。然后访问 <http://127.0.0.1:8080/>。服务默认监听 `0.0.0.0`，同一局域网的设备也可以访问运行服务电脑的内网 IP。

也可以用 Docker Compose 部署：

```bash
docker compose up -d --build
```

默认映射到主机的 8080 端口。NAS 部署、数据保留和备份说明见[部署指南](docs/DEPLOYMENT.md)。

## 站点内容

| 栏目 | 页面 |
|---|---|
| 首页与搜索 | `index.html` |
| 班规 | `pages/rules/` |
| 往事 | `pages/memories/` |
| 轶闻 | `pages/anecdotes/` |
| 人物册 | `pages/people/` |
| 岁月史书 | `pages/memories/suishu.html` |
| 管理台和正文编辑 | `pages/admin.html`、`pages/admin-content.html` |
| 其他 | `pages/info/` |

## 维护文档

- [设计说明](docs/DESIGN.md)：页面组织、设计参考和交互约定
- [第三方素材许可](docs/THIRD_PARTY_NOTICES.md)：Delineate 手绘花园的 MIT 署名
- [开发指南](docs/DEVELOPMENT.md)：项目结构、内容修改、前后端职责和本地检查
- [部署指南](docs/DEPLOYMENT.md)：本机、局域网、Docker/NAS、备份和公开访问
- [服务器更新记录](docs/releases/UPDATE-20261018.md)：2026-10-18 的一次性上线步骤
- [旧部署文档入口](DEPLOY.md)：保留的兼容链接
- 旧部署包说明：归档在 `docs/legacy/README-DEPLOY.txt`

## 数据与安全

访客提交的人物册内容和留言存放在 `data/app.db`。首次启动时，服务会生成管理口令并写入 `config.json`；这两个路径已加入 `.gitignore`，不要提交或公开它们。部署到互联网前，请配置 HTTPS 和强管理口令。

项目没有构建步骤或第三方运行时依赖。`npm run check` 可直接检查页面与脚本；安装可选开发依赖后运行 `npm test` 进行浏览器回归。正文页面按栏目放在 `pages/`；共用代码在 `css/`、`js/`，图片和录音在 `assets/media/`。旧页面与素材 URL 会跳转到新位置。

<p align="center"><sub>2022 级一班 · 留个念想</sub></p>
