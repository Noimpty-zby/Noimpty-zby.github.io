# Noimpty 的个人空间

基于 Hexo 8 与 Butterfly 5 的个人博客，包含学习记录、资讯、日程、娜娜莉聊天与工作室、代码小屋和 Mao 看板娘。

- 博客：[noimpty-zby.cn](https://noimpty-zby.cn)，由 GitHub Pages 发布。
- 私有后端：保存私密资料、记忆与练习工作区，提供 Docker 隔离执行；与静态前端分别部署。
- **页面暗号是前端软锁，文章正文仍在公开 HTML 中。** 日程、行动日志、个人背景和用量使用后端鉴权；站点解锁不等于获得后端权限。

## 日常发文章

只增加或修改文章时，不需要部署后端、修改暗号或调整自动任务。

1. 在 `source/_posts/` 新建或编辑 Markdown；资讯在 `source/news/`。也可运行 `npx hexo new post "文章标题"` 创建文章。
2. 填写标题、日期、分类和标签，按 [内容与素材维护](docs/content-authoring.md) 核对 front-matter、图片、公式和分类映射。不要把私密资料或密钥放进公开仓库。
3. 按下方步骤设置本地预览暗号，运行 `npm run check`；用 `npm run server` 预览正文、目录、图片和手机布局。
4. 提交文章相关文件并推送到 `main`。[Pages 工作流](.github/workflows/pages.yml) 自动检查并发布；在仓库 Actions 中确认 `deploy` 成功，再检查线上文章。

`public/`、`db.json` 和 `node_modules/` 都是可重建文件，不提交、不直接修改。后台自动生成的资讯和批注仍由现有工作流维护。

## 本地运行

使用 [.nvmrc](.nvmrc) 指定的 Node.js 24。以下命令在仓库根目录的 Bash / WSL 中执行；安装了 nvm 时先运行 `nvm use`。

```sh
npm ci
export NOIMPTY_PASSPHRASE='local-preview-only'
npm run build
npm run server
```

打开 [localhost:4000](http://localhost:4000)。示例暗号仅用于本地预览，不要把线上暗号写入文件或提交到 Git。`npm run build` 会重建编辑器与终端组件、清除 Hexo 缓存并生成站点；`npm run clean` 只清理产物。

聊天需要在浏览器保险箱中配置模型服务；日程、共享记忆、工作室和代码执行需要连接私有后端。前后端运行条件及环境变量见 [后端说明](docs/features/learning-backend.md)。

## 功能与使用说明

| 功能 | 使用说明 |
| --- | --- |
| 文章、分类、进度、图片与音乐 | [内容与素材维护](docs/content-authoring.md) |
| 娜娜莉聊天、话题、附件与语音 | [聊天工作区](docs/features/nanaly-chat.md) |
| 共享记忆、笔记、目标和后端连接 | [娜娜莉工作室](docs/features/nanaly-agent.md) |
| C/C++/Go/Python、Git/Linux 终端与 MySQL | [代码小屋](docs/features/learning-lab.md) |
| 本机加密备份、恢复与域名迁移 | [本机备份与迁移](docs/features/nanaly-local-backup.md) |
| Mao、阅读快捷操作与互动 | [Mao 看板娘](docs/features/mao.md) |
| 目录职责、实现位置与已完成需求 | [项目结构](docs/architecture.md) · [项目待办](docs/backlog.md) |

日程页 `/schedule/` 保留本机草稿，点击「保存日程」才同步到后端，无需等待整站部署。多设备修改使用版本检查和三方合并；连接失败时不会用空表覆盖服务器。草稿按后端身份隔离，但**锁定页面不会加密或擦除浏览器里的日程草稿**。

普通站内跳转使用 PJAX，音乐和常驻组件会保留；编辑器、终端等较大的可选资源按需加载。模型、语音和第三方服务是否可用，还取决于浏览器配置、网络、额度及服务商状态。

## 暗号与数据边界

三种凭据用途不同：站点暗号解开页面软锁和加密搜索；浏览器保险箱密码保护本机模型配置；后端令牌授权读取私密资料和执行练习。它们不能互相替代。

- 首页 `/` 公开，其余内容页默认软锁。构建会隐藏首页文章列表，移除 RSS / sitemap，并设置拒绝抓取的 `robots.txt`；这些措施不构成正文访问控制。
- 本地构建暗号使用 `NOIMPTY_PASSPHRASE`；Pages 从仓库 Secret `SITE_PASSPHRASE` 读取。搜索索引使用随机盐、PBKDF2-SHA256 600000 轮和 AES-256-GCM，不公开快速暗号摘要。
- 缺少构建暗号时仍可构建，但搜索索引清空，受保护页面无法解锁。更换暗号后必须重新部署，旧会话随新清单失效。
- 日程、行动日志、个人背景和用量不进入静态产物。自动任务通过受限后台令牌访问，缺配置或资料未迁移时明确停止；构建会拦截四份旧私密源文件再次出现。
- 从旧版本升级先读 [私密资料迁移与切换](docs/maintenance/2026-09-27-security-migration.md)。删除当前文件或重写主分支历史，不能保证旧缓存、克隆或第三方副本消失。

## 验证

设置本地构建暗号后运行：

```sh
npm run check
```

该命令依次执行全部离线回归、干净构建、站内链接检查和公开页内容检查。布局、媒体、输入和 PJAX 的变更还需真实浏览器检查；本地检查通过不等于已经发布。

| 命令 | 范围与条件 |
| --- | --- |
| `npm test` | 全部离线回归；默认跳过真实 Docker，不部署、不调用付费模型 |
| `npm run test:runner` | 真实 Docker 隔离与语言集成；需准备执行镜像，见 [后端说明](docs/features/learning-backend.md) |
| `node tools/checks/private-backend-check.mjs` | 使用后台连接配置，只读校验四类私密资料；不调用模型、不发信、不写入 |
| `npm run emotioncheck` | 默认离线；加 `-- --live` 会调用真实模型 |
| `npm run voicecheck` | 真实语音服务检查，需要凭据且可能计费 |
| `npm run svgcheck -- <文件…>` | 配图文字边界估算，仍需检查实际渲染 |

最新检查结果和未验范围见 [2026-09-28 收尾验收](docs/maintenance/2026-09-28-release-check.md)。

## 前后端部署

### 静态前端：GitHub Pages

仓库 **Settings → Pages → Source** 选择 **GitHub Actions**，并配置 `SITE_PASSPHRASE`。推送 `main` 或手动运行 [pages.yml](.github/workflows/pages.yml)，会执行测试、构建、空页面、链接、公开内容及上锁检查，再发布 `public/`。

同一次工作流中的 `private-backend` 独立检查后台连接、令牌和四类资料是否就绪，不把后端密钥传给构建或产物。失败会让工作流整体显示异常，但不会阻断静态文章发布；此时分别查看 `deploy` 和 `private-backend` 的结果。

当前站点使用 `https://noimpty-zby.cn` 与根路径 `/`。更换域名前先处理 [浏览器本机数据迁移](docs/features/nanaly-local-backup.md)；仓库子路径部署还需逐项核对根路径引用。

### 私有后端：独立部署

GitHub Pages 不会更新后端。首次安装按 [后端说明](docs/features/learning-backend.md) 配置；后续提交后端相关改动后运行：

```sh
npm run deploy:backend
# 强制重跑真实 Docker 验收：
npm run deploy:backend -- --full
```

脚本只打包已提交内容，先验收候选版本再切换；失败会尝试恢复上一版，并报告恢复结果。**重启会中断正在运行的代码和终端连接**，发布前先结束或保存练习。镜像、验收缓存、连接配置和恢复边界见 [后端更新部署](docs/features/learning-backend.md#更新部署)。

## 自动任务与日常维护

| 工作流 | 作用与触发 |
| --- | --- |
| [pages.yml](.github/workflows/pages.yml) | `main` 推送或手动触发，检查并发布静态前端 |
| [nanaly.yml](.github/workflows/nanaly.yml) | 回评、巡逻、批注、资讯与随笔；班次及演练选项见工作流 |
| [daily-report.yml](.github/workflows/daily-report.yml) | 北京时间每天 22:00 计划生成日报，也可手动运行；调度可能延迟 |
| [nanaly-article-check.yml](.github/workflows/nanaly-article-check.yml) | 手动派发的只读文章检查 |

自动任务必须配置 `NANALY_AGENT_URL` 和 `NANALY_AGENT_TOKEN`；使用后端的**受限后台令牌**，不要填主令牌。模型、邮件和搜索等其他配置见 [日报说明](tools/daily-report/README.md) 及各工作流的环境变量。自动任务的 `dry` / `dry-run` 不代表免费离线测试，仍可能调用模型或搜索服务。

日常维护以 Actions 的执行结果为准；后端健康状态可查看 `/api/health` 的 `build` 和 `runner.ready`。更新依赖或功能时重新执行相应验收，避免只凭构建成功判断可用。原始素材、模型与第三方库的来源和许可见 [素材维护与署名](docs/content-authoring.md#素材维护与署名)。
