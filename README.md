# Noimpty 的个人空间

基于 Hexo 8 与 Butterfly 5 的个人博客，包含学习记录、资讯、日程、娜娜莉聊天与工作室、代码小屋和 Mao 看板娘。静态前端发布到 [noimpty-zby.cn](https://noimpty-zby.cn)，私有状态和 Docker 隔离执行由独立后端提供。

**隐私边界：页面暗号是前端软锁，文章正文仍在 HTML 中。** 不应把它当作服务器鉴权或正文加密。搜索索引使用浏览器加密；日程、行动日志、背景资料和用量保存在鉴权后端。

## 本地运行

使用 [.nvmrc](.nvmrc) 指定的 Node.js 24；安装了 nvm 时先运行 `nvm use`。以下命令在仓库根目录、Bash 或 WSL 中执行：

```sh
npm ci
export NOIMPTY_PASSPHRASE='local-preview-only'
npm run build
npm run server
```

打开 <http://localhost:4000>。上面的暗号仅用于本地预览，可自行替换，不要把线上暗号写进仓库。`npm run build` 会先重建编辑器与终端组件、清除 Hexo 缓存，再生成 `public/`；只需要清理产物时运行 `npm run clean`。

聊天需要在浏览器里配置自己的模型服务；代码执行还需要已配置的私有后端。后端安装、环境变量、令牌与运行条件见 [私有后端说明](docs/features/learning-backend.md)，本地启动入口为 `npm run server:agent`。

## 功能与文档

| 要做的事 | 文档 |
| --- | --- |
| 写文章、维护分类与进度、替换图片和音乐 | [内容与素材维护](docs/content-authoring.md) |
| 使用聊天、话题、附件和语音 | [娜娜莉聊天工作区](docs/features/nanaly-chat.md) |
| 管理共享记忆、笔记、目标与任务 | [娜娜莉工作室](docs/features/nanaly-agent.md) |
| 边读边练，使用 C/C++/Go/Python、Git/Linux 终端和 MySQL | [代码小屋](docs/features/learning-lab.md) |
| 安装、更新和验收私有后端 | [后端与隔离练习](docs/features/learning-backend.md) |
| 导出本机加密备份、迁移域名 | [本机备份与迁移](docs/features/nanaly-local-backup.md) |
| 设置 Mao、阅读快捷操作和互动 | [Mao 看板娘](docs/features/mao.md) |
| 找实现位置与后续工作 | [项目结构](docs/architecture.md) · [项目待办](docs/backlog.md) |

日程页 `/schedule/` 支持本地草稿、完成条件和三方合并；先在娜娜莉工作室连接私有后端，点击「保存日程」后立即同步。存储不可用或空间不足时会明确提示，避免把内存草稿当成已保存。普通站内跳转使用 PJAX，音乐播放与常驻组件会继续保留；代码小屋的编辑器、终端和其他较大的可选资源按需加载。

## 常用目录

| 路径 | 用途 |
| --- | --- |
| `source/_posts/`、`source/news/`、`source/in-class/`、`source/extra/`、`source/life/` | 文章、资讯和栏目页 |
| `source/_data/` | 可公开的助手旁注；私密资料禁止放入此目录 |
| `source/js/`、`source/css/` | 自有前端功能与样式 |
| `source/img/`、`source/music/`、`source/live2d/`、`source/lib/` | 素材及自托管运行库，保留署名与许可证 |
| `scripts/` | Hexo 构建插件 |
| `server/` | 私有后端、Docker 执行环境与服务配置示例 |
| `tools/assets/`、`tools/checks/`、`tools/tests/` | 资源构建、质量检查与分模块回归 |
| `tools/nanaly/`、`tools/daily-report/`、`tools/deploy/` | 助手自动任务、日报与后端部署 |
| `docs/features/`、`docs/maintenance/` | 功能说明与按日期保存的维护记录 |
| `_config.yml`、`_config.butterfly.yml` | Hexo 与主题配置 |

`public/`、`db.json` 和 `node_modules/` 是可重建的产物、缓存与依赖。不要直接修改 `node_modules/hexo-theme-butterfly/`，重新安装会覆盖修改；自有适配放在仓库代码中。

## 暗号与公开内容

[scripts/noimpty-lockdown.js](scripts/noimpty-lockdown.js) 使用默认拒绝规则：首页 `/` 公开，内容页和 `/about/` 默认上锁，新栏目自动继承规则。构建同时清空首页文章列表、关闭侧栏文章与分类入口，移除 RSS 和 sitemap，并让 `robots.txt` 拒绝全站抓取。

构建暗号来自 `NOIMPTY_PASSPHRASE`，GitHub Actions 中对应仓库 secret `SITE_PASSPHRASE`：

- 设置暗号：搜索索引 `search.xml` 使用 v2 AES-256-GCM 信封，每份信封随机盐，PBKDF2-SHA256 600000 轮。暗号门通过认证解密验证，不再公开快速暗号摘要。
- **未设置暗号：构建仍可成功，但搜索索引被清空，私密页面无法解锁。** 日程与行动日志始终不进入静态产物。
- 修改暗号后必须重新构建、部署；已有会话随新清单失效。
- 日程、行动日志、背景资料和用量使用鉴权后端的独立版本化记录。自动任务必须配置 `NANALY_AGENT_URL` / `NANALY_AGENT_TOKEN`，缺配置、尚未迁移或读取失败会明确停止。
- 从旧版本升级必须先完成[私密资料迁移与切换](docs/maintenance/2026-09-27-security-migration.md)，再发布新前端。删除当前文件不等于清理公开 Git 历史。

页面正文仍可从 HTML 源码读取，`robots.txt` 也不是访问控制；真正保密的正文需要另行加密或放在有服务器鉴权的系统中。

## 验证

```sh
npm run check
```

该命令依次执行 `npm test`、干净构建、站内链接检查和公开页内容检查。发布前应设置构建暗号；否则按上面的缺省规则生成。涉及布局、媒体、输入或 PJAX 的修改，还应在真实浏览器里检查。

| 命令 | 范围与条件 |
| --- | --- |
| `npm test` | 递归执行 `tools/tests/` 中的回归；默认不运行真实 Docker 场景，不部署、不调用付费模型 |
| `npm run test:runner` | 真实 Docker 隔离与语言集成，需要准备相应执行镜像；用 `NANALY_RUNNER_IMAGE` 选择镜像，见后端说明 |
| `npm run emotioncheck` | 默认离线校验情绪样例与分段契约；`npm run emotioncheck -- --live` 会调用真实模型 |
| `npm run voicecheck` | 联网、可能计费的真实语音链路检查，需要时明确运行 |
| `npm run svgcheck -- <文件…>` | 估算配图文字边界；仍需检查实际渲染 |

最近一次完整审查的环境、结果和未验边界见 [2026-09-27 健壮性审查](docs/maintenance/2026-09-27-robustness.md)。测试通过只说明相应环境和测试范围通过，不代表前后端已发布。

## 前后端部署

### 静态前端：GitHub Pages

仓库 **Settings → Pages → Source** 选择 **GitHub Actions**，并配置 `SITE_PASSPHRASE`。提交并推送到 `main` 后，[pages.yml](.github/workflows/pages.yml) 会执行测试、构建、空页面检查、链接检查、公开内容检查和上锁自检，再发布 `public/`；也可手动触发该工作流。

当前 `_config.yml` 使用 `url: https://noimpty-zby.cn` 和 `root: /`。更换域名前先处理 [浏览器本机数据迁移](docs/features/nanaly-local-backup.md)；改为仓库子路径站点时，还需核对页面及自有脚本中的根路径引用，不能只改 `url` 就认为迁移完成。

### 私有后端：独立部署

GitHub Pages 不会更新后端。首次安装按 [后端说明](docs/features/learning-backend.md) 配置；后续先提交需部署的代码，再运行：

```sh
npm run deploy:backend
# 强制重新运行真实 Docker 集成验收：
npm run deploy:backend -- --full
```

脚本只打包已提交内容，使用互斥锁避免并发发布，验收候选版本后再切换。配置、目录切换、重启或健康检查失败会尝试恢复上一版，并明确报告恢复失败；重启会中断正在运行的代码。验收缓存条件、部署连接配置和恢复边界见 [后端更新部署](docs/features/learning-backend.md#更新部署)。

## 自动化与维护记录

| 工作流 | 作用与触发 |
| --- | --- |
| [pages.yml](.github/workflows/pages.yml) | `main` 推送或手动触发，发布静态前端 |
| [nanaly.yml](.github/workflows/nanaly.yml) | 回评、巡逻、批注、资讯与随笔；具体班次和手动演练选项见工作流 |
| [daily-report.yml](.github/workflows/daily-report.yml) | 北京时间每天 22:00 计划生成日报，可手动运行；调度可能延迟 |
| [nanaly-article-check.yml](.github/workflows/nanaly-article-check.yml) | 手动派发的只读文章检查 |

- [2026-09-27 健壮性与轻量化审查](docs/maintenance/2026-09-27-robustness.md)：最新修复、资源体积口径及验证边界。
- [2026-09-27 修复记录](docs/maintenance/2026-09-27-fixes.md)：终端、内页角色与部署脚本修复。
- [2026-09-26 终端改版](docs/maintenance/2026-09-26-terminal.md) · [2026-09-25 审查](docs/maintenance/2026-09-25-audit.md) · [2026-09-19 审查](docs/maintenance/2026-09-19-audit.md)。

图片、音乐和模型的来源、署名与授权提醒集中在 [素材维护与署名](docs/content-authoring.md#素材维护与署名)。仓库中附带素材不意味着它们可以任意再分发。
