# 开发指南

本文面向要修改页面、内容或后端行为的维护者。项目没有前端构建流程，也没有第三方运行时依赖。浏览器回归测试使用可选的 Playwright 开发依赖。

## 环境与启动

- Node.js 22.5 或更高版本（需要内置 `node:sqlite`）；建议使用 Node.js 24。
- 启动网站无需 `npm install`。`package.json` 提供启动、检查和可选浏览器测试命令。
- macOS/Linux：`./start.sh`；Windows：运行 `start.bat`。
- 默认地址：<http://127.0.0.1:8080/>。可用 `PORT=9000 ./start.sh` 更改 macOS/Linux 的端口；服务默认绑定 `0.0.0.0`。

启动前可用以下命令检查 Node 源码语法：

```bash
node --check server.js
node --check backup.js
```

## 目录与职责

```text
index.html             首页入口
1.5.html               旧首页兼容入口
assets/media/          首页图片和录音
assets/illustrations/  本地手绘 SVG 插画（许可见 docs/THIRD_PARTY_NOTICES.md）
css/style.css          全站设计变量、公共样式与响应式布局
css/admin.css          管理台和正文编辑器样式
js/site.js             主题、导航、回忆标签、轻量动画
js/app.js              页面搜索与键盘操作
js/content.js          整页在线覆盖与 MFContentReady 初始化同步
js/entries.js          正文逐条覆盖、隐藏、新增与评论
js/search-data.js      静态搜索索引
js/people.js           人物册和留言板的 API 客户端
server.js              静态文件服务、API、管理接口和 SQLite 初始化
pages/rules/           班规内容页
pages/people/          人物册页面
pages/anecdotes/       轶闻页面
pages/memories/        往事与《岁月史书》
pages/info/            关于、联系、帮助和版权页面
pages/admin.html       管理审核页面
pages/admin-content.html 在线正文编辑页面
backup.js              SQLite 一致性备份
scripts/check.cjs      链接、锚点和脚本静态检查
tests/                 使用隔离 SQLite 的 Playwright 回归测试
docs/                  开发和部署指南
docs/releases/         按版本归档的一次性更新说明
docs/legacy/           历史部署包说明
materials/             网站原始文本资料
deploy/confession.service  Linux systemd 单元示例
README-DEPLOY.txt      指向归档部署说明的根目录兼容指针
UPDATE-20261018.md     指向版本更新记录的根目录兼容指针
materials/source-text.txt  网站原始文本资料，不由运行时代码读取
data/app.db            运行时数据库（自动生成，不提交）
config.json            管理口令等运行配置（自动生成，不提交）
```

### 页面目录与 URL 兼容

首页 `index.html` 和旧版入口 `1.5.html` 留在根目录；正文与管理页面按栏目存放在 `pages/` 下。共用 CSS 和 JavaScript 留在 `css/`、`js/`，首页图片和录音归档在 `assets/media/`，原始文本存放在 `materials/`。`server.js` 会把原先的根级页面和媒体 URL 永久跳转到新地址；新代码和书签应使用 `pages/`、`assets/media/` 下的路径。

直接用 `file://` 打开首页时，页面链接和搜索仍使用相对路径，不需要启动构建工具。新增页面时放入对应栏目目录，使用相对路径指向页面资源；所有脚本使用与页面深度匹配的相对路径，并通过 `defer` 顺序加载。同步更新首页目录、其他页面导航以及 `js/search-data.js` 中的页面路径。

## 修改页面和内容

班规、往事、轶闻和《岁月史书》的正文保存在对应 HTML 页面里，直接编辑页面即可。修改标题、描述或正文后，在浏览器刷新查看；无需编译。

新增一条内容时，先选对应栏目页面，在相邻条目附近复制现有 HTML 结构；检查该页的目录和页间链接，并确认搜索索引是否需要加入新内容。新增页面时，沿用同栏目页面的 `<head>`、样式引用和页脚链接，再把新文件加入入口链接。保持文件名和大小写在链接中一致。

搜索索引位于 `js/search-data.js`。如果加入了新的可搜索内容，要同步维护该索引；搜索需要兼容直接打开 HTML 的方式，因此不要把索引加载改成依赖 `fetch` 的外部文件。修改正文 ID 时同步更新搜索目标。不要给多个条目重复使用 ID。

首页图片和录音位于 `assets/media/`。替换素材时沿用原文件名，或同步修改 `index.html` 的 `src`；旧根路径仍会跳转到新地址。

人物册页面的 `#people-static` 保存内置原始词条，始终显示；`#people-list` 只展示 SQLite 中的在线新增人物。空库、其他分类有数据或接口失败都不能隐藏内置词条，原始词条不自动写入数据库。

人物册、留言板和评论是动态功能：前端交互在 `js/people.js`，服务端校验、管理权限和数据持久化在 `server.js`。服务端使用 Node 内置 `node:http` 和 `node:sqlite`，数据库文件在 `data/app.db`。新增或调整数据字段时，同时检查 API 输入校验、`pages/admin.html` 展示以及现有数据库的兼容性。静态正文页可通过 `pages/admin-content.html` 在线编辑，服务端以页面文件名保存覆盖内容和历史版本。原始文本目录不由静态服务器公开。

常用 API：

| 路由 | 用途 |
|---|---|
| `GET/POST /api/people` | 读取或提交人物词条；开启词条审核后，新词条进入待审核状态 |
| `DELETE /api/people/:id` | 删除词条或提交删除申请，行为由审核开关决定 |
| `GET/POST /api/messages` | 读取或提交留言；留言审核开启时，新留言不会立即公开 |
| `GET/POST /api/people/:id/comments` | 读取或提交指定人物词条的评论；评论审核独立控制 |
| `GET /api/settings` | 返回公开的审核开关状态，供页面提示使用 |
| `GET/POST /api/admin/settings` | 读取或调整审核开关 |
| `GET /api/admin/all` | 读取管理台词条、留言、申请和待处理数量 |
| `/api/admin/people-review`, `/api/admin/delete-review` | 审核新增词条和删除申请 |
| `/api/admin/pages`, `/api/admin/content/*` | 在线编辑正文、恢复默认内容和查看/恢复历史版本 |
| 其他 `/api/admin/*` | 管理员直接新增、下架、恢复、删除或导出数据 |

正文加载先等待 `js/content.js` 的 `MFContentReady`，再附加逐条评论；服务端以已保存的全文为条目解析基础。保留 `.content-left`、条目的 class/id 顺序以及唯一 ID，避免破坏在线编辑、搜索和旧评论的关联。

所有 `/api/admin/*` 请求都需要管理口令。修改 API 时，沿调用链同时核对 `js/people.js`、`server.js` 和 `pages/admin.html`；修改审核流程时，要分别检查 `peopleModerated`、`messagesModerated` 与 `commentsModerated` 三个开关。

## 日常开发流程

1. 运行 `./start.sh` 或 `start.bat`，打开 <http://127.0.0.1:8080/>。
2. 按上面的目录表改 HTML、CSS、前端脚本或后端；静态页面改完直接刷新，Node 服务改完重启。
3. 运行下方核对命令，再检查改动页面。改了动态功能时，也检查人物册、留言板和管理页；改了审核流程时，分别验证开关关闭和开启后的提交、审核结果。
4. 看 `git status`，确认没有把 `data/`、`config.json`、备份或临时文件加入提交。

如果页面内容能直接打开，但人物册或留言板提示无法连接，请确认使用 `http://127.0.0.1:8080/` 而不是 `file://` 打开，并查看启动终端是否有错误。

## 数据与备份

服务启动时会创建 `data/` 和 SQLite 数据库；首次启动还会生成 `config.json` 中的管理口令，并输出到启动终端。不要提交数据库、口令或备份，也不要公开分享包含管理口令的启动日志。

运行 `node backup.js` 可在服务所在目录的 `data/backup/` 生成 SQLite 一致性快照，脚本最多保留 30 份。Docker 部署的数据目录挂载在命名卷中；容器内没有安装项目开发工具，源码修改后需重新构建镜像。

## 本地核对清单

修改完成后，根据改动范围核对：

```bash
npm run check
docker compose config --quiet
```

然后启动站点检查首页、改动页面和相关功能。若改了后端或 API，也要检查人物册、留言板和管理页面。Docker 配置检查只验证 Compose 文件格式；要验证镜像能否启动，还需要可用的 Docker daemon。

## 浏览器回归测试

网站运行无需安装依赖。要跑开发测试，执行：

```bash
npm ci
npx playwright install chromium
npm test
```

Linux 新环境缺少浏览器依赖时，可使用 `npx playwright install --with-deps chromium`。已有 Chromium 可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium npm test` 指定。

测试会分别使用桌面和手机视口，自动创建临时网站副本、独立管理口令和数据库；完成后停止测试服务并清理临时数据。失败截图与 trace 在已忽略的 `test-results/` 下。`npm run check` 不需要安装开发依赖。

界面约定与来源说明见 [设计说明](DESIGN.md)。改版后仍可使用原来的 `./start.sh`、`start.bat` 和 Docker Compose 启动。
