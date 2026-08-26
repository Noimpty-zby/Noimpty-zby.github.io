# Noimpty 的个人空间

基于 Hexo 8 与 Butterfly 5 的个人博客。

## 本地运行

需要 Node.js 20.19 或更高版本，推荐使用项目 `.nvmrc` 中的 Node.js 24。

```bash
npm install
npm run clean
npm run server
```

浏览器打开 `http://localhost:4000`。

## 常用目录

- `source/_posts/`：博客文章
- `source/img/`：图片资源
- `source/css/custom.css`：自定义视觉样式
- `_config.yml`：Hexo 主配置
- `_config.butterfly.yml`：Butterfly 主题配置

不要直接修改 `node_modules/hexo-theme-butterfly/`，重新安装依赖会覆盖里面的内容。

## 内容模块

首页是三个入口，除首页和 `/about/` 之外**全站上锁**（见下节）。

```
/in-class/    自学课内 —— 数据结构与算法 / CSAPP / 操作系统 / 计算机网络
/extra/       自学课外 —— 两条线：
  /extra/ai-infra/   AI Infra 后端开发（现在这条）—— Linux / Git / Go / MySQL
  /extra/gamedev/    游戏开发（之前那条，已告一段落）—— GAMES101 / UE5·Tom Looman
/life/        Life
/studio/      策划室（游戏策划，内容存在私有仓库里）
/news/        资讯
/schedule/    日程
```

### 写新文章时的 front-matter

```yaml
categories:
  - [课外, AI Infra, Go]    # 三级，见下表
tags:
  - 具体的技术标签           # 别再写和分类重复的标签
privacy: protected          # 全站上锁，每篇都要
sitemap: false
private_section: 课外        # 课外 / 课内 / Life，决定解锁框上显示的板块名
```

| 内容 | categories |
|---|---|
| Linux 命令行 | `- [课外, AI Infra, Linux]` |
| Git & GitHub | `- [课外, AI Infra, Git]` |
| Go | `- [课外, AI Infra, Go]` |
| MySQL | `- [课外, AI Infra, MySQL]` |
| GAMES101 | `- [课外, 游戏开发, GAMES101]` |
| UE5 · Tom Looman | `- [课外, 游戏开发, UE5-Looman]` |
| 数据结构与算法 | `- [课内, DSA]` |
| CSAPP | `- [课内, CSAPP]` |
| 操作系统 | `- [课内, NJU-OS]` |
| 计算机网络 | `- [课内, CS144]` |
| 生活 | `- Life` |

分类的 slug 映射在 `_config.yml` 的 `category_map` 里 —— 加新分类记得同步，
否则 URL 会变成一长串百分号编码。

### 首页分区图片来源

首页三张分区背景图片均来自 Pixiv（P站）：

1. `自学课内` 背景图：KirinMusic
2. `自学课外` 背景图：Matchacora
3. `Life` 背景图：安哈娜

## 全站上锁

`scripts/noimpty-lockdown.js` 负责，采用**默认拒绝**：白名单（`/` 和 `/about/`）之外一律锁。
新加板块会自动被锁，不需要记着往清单里加。

它同时处理这几个「不用打开页面就能拿到内容」的口子：

- `search.xml`（全站正文）→ **AES-256-GCM 加密**，密钥由暗号经 PBKDF2 派生
- `atom.xml` / `sitemap.xml` → 移除
- `robots.txt` → 拒绝全站抓取
- 侧边栏的最新文章 / 分类 / 标签 / 归档 → 从构建源头关掉，不是用 JS 藏
- 首页文章列表 → 构建时清空

⚠️ **这是前端软锁。** 打开任何一个上锁页面按 F12，正文就在 HTML 里。
它挡的是路过的人和搜索引擎，不是有心的人。真正挡住需要正文加密或平台鉴权 ——
详见 `scripts/noimpty-lockdown.js` 顶部的说明。

构建时需要环境变量 `NOIMPTY_PASSPHRASE`（线上是仓库 secret `SITE_PASSPHRASE`）。
不设的话构建仍然成功，但 `search.xml` 会被清空，站内搜索用不了。

`pages.yml` 里有一步「上锁自检」，上述任何一条不过就直接让部署失败。

## 自动化

| 工作流 | 干什么 | 频率 |
|---|---|---|
| `pages.yml` | 测试 → 构建 → 上锁自检 → 部署 | push 到 main |
| `nanaly.yml` | 回评论 / 巡逻 / 批注 / 资讯 / 随笔 | 见文件内的 cron |
| `studio.yml` | 策划室：探索 / 立项 / 深化 / 修订 / 停更 | 周一、四、六 21:00 |
| `daily-report.yml` | 每晚站点日报邮件 | 每天 22:00 |

`npm test` 会跑 `tools/tests/` 下的全部测试。部署前会自动跑一遍，红了就不部署。

## 文章推荐与目录

- 文章底部只推荐拥有共同标签的文章；越少见、越具体的共同标签权重越高，同分时按发布日期和标题稳定排序，不使用随机推荐。
- 推荐卡片会直接显示“共同标签”，方便确认推荐依据。
- 右侧目录根据标题在当前页面中的实时位置更新。图片或字体加载导致文章高度变化时也会重新计算；目录只在当前项超出可视范围时滚动，不会不断抢先居中。

## 背景音乐

播放器位于页面左下角，包含 10 首本地音乐，默认开启随机模式。支持播放/暂停、上一首、下一首、随机/顺序切换、进度拖动、音量调节与收起。播放器会保存当前曲目、进度、音量和播放模式；站内页面使用 PJAX 切换，因此播放中的音乐不会因普通站内跳转而中断。

音乐文件位于 `source/music/`，播放清单在 `source/js/music-player.js`。浏览器不允许网页在用户没有操作时自动播放，所以首次访问需要点击一次播放键。将音乐公开部署前，请确认拥有相应授权。

音乐来源：网易云音乐；音乐作者：三Z-STUDIO、HOYO-MiX。网页播放器中将这些曲目标注为“我喜欢的音乐”。

## 替换头像

当前头像位于 `source/img/avatar.png`。以后需要替换时：

1. 用新的正方形图片覆盖 `source/img/avatar.png`。
2. 执行 `npm run clean && npm run server` 检查效果。

建议使用正方形图片，并避免把重要内容贴近边缘。

## 发布到 GitHub Pages

项目已包含 `.github/workflows/pages.yml`。将代码推送到 `main` 分支后，在仓库的 **Settings → Pages → Source** 中选择 **GitHub Actions**。

当前按用户站点 `https://noimpty-zby.github.io` 配置。如果仓库名称不是 `noimpty-zby.github.io`，需要把 `_config.yml` 中的 `url` 改成 `https://noimpty-zby.github.io/仓库名`，并把 `root` 改成 `/仓库名/`。