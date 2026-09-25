# Noimpty 的个人空间

基于 Hexo 8 与 Butterfly 5 的个人博客。

## 本地运行

需要 Node.js 20.19 或更高版本，推荐使用项目 `.nvmrc` 中的 Node.js 24。

```bash
npm ci
npm run clean
npm run server
```

浏览器打开 `http://localhost:4000`。

## 常用目录

- `source/_posts/`、`source/news/`：文章与资讯
- `source/_data/`：日程、旁注、日志与用量数据
- `source/js/`、`source/css/`：自有功能与样式
- `source/img/`、`source/music/`、`source/live2d/`：图片、音乐和角色模型
- `scripts/`：Hexo 构建插件
- `tools/nanaly/`、`tools/daily-report/`：助手自动任务与日报
- `tools/checks/`、`tools/assets/`：检查入口与模型资源工具
- `tools/tests/`：按功能分类的离线回归
- `docs/features/`、`docs/maintenance/`：使用说明与维护记录
- `_config.yml`：Hexo 主配置
- `_config.butterfly.yml`：Butterfly 主题配置

完整的功能与文件映射见 [项目结构](docs/architecture.md)。

不要直接修改 `node_modules/hexo-theme-butterfly/`，重新安装依赖会覆盖里面的内容。

## 内容模块

首页是三个入口，**除首页之外全站上锁**（见下节）—— 包括 `/about/`。

```
/in-class/    自学课内 —— 数据结构与算法 / CSAPP（操作系统、计算机网络跟学校课走，不再自学）
/extra/       自学课外 —— 两条线：
  /extra/ai-infra/   AI Infra 后端开发（现在这条）—— Linux（入门/深入）/ Git / Go / MySQL / Docker / Transformer 推理机制 / Python
  /extra/gamedev/    游戏开发（之前那条，已告一段落）—— GAMES101 / UE5·Tom Looman
/life/        Life
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
| Linux 入门 | `- [课外, AI Infra, Linux入门]` |
| Linux 深入 | `- [课外, AI Infra, Linux深入]` |
| Git & GitHub | `- [课外, AI Infra, Git]` |
| Go | `- [课外, AI Infra, Go]` |
| MySQL | `- [课外, AI Infra, MySQL]` |
| Docker | `- [课外, AI Infra, Docker]` |
| Transformer 推理机制 | `- [课外, AI Infra, Transformer 推理机制]` |
| Python | `- [课外, AI Infra, Python]` |
| GAMES101 | `- [课外, 游戏开发, GAMES101]` |
| UE5 · Tom Looman | `- [课外, 游戏开发, UE5-Looman]` |
| 数据结构与算法 | `- [课内, DSA]` |
| CSAPP | `- [课内, CSAPP]` |
| 生活 | `- Life` |

分类的 slug 映射在 `_config.yml` 的 `category_map` 里 —— 加新分类记得同步，
否则 URL 会变成一长串百分号编码。

### 「这一栏有几篇」不要手写

板块页上的篇数由两个标签在构建时现数，别再写死数字（`scripts/noimpty-sections.js`）：

```
{% section_stat Git %}                         → 已写 2 篇 / 还没开始
{% section_stat 入门=Linux入门|深入=Linux深入 %}   → 入门 3 篇 · 深入还没开始
{% section_stat GAMES101|UE5-Looman %}          → 已写 16 篇（不带标签就是求和）
{% section_progress DSA %}                      → 已写 2 篇，最近一篇 09-14
```

分隔符用 `|` 不用空格 —— 叶子名里本来就带空格（`Transformer 推理机制`）。

**语义那半仍然要手写**：「递归」「第三章已完成」「告一段落」说的是学到哪了，
数不出来。写法是 `<span>递归 · {% section_progress DSA %}</span>`。

为什么非要这样：这个数字以前在四个地方各写一遍（hub 卡片、track 页进度、
娜娜莉的 `PERSONA`、`noimpty-profile.md`），发一篇文章要记得同步四处，
漏了**不报错、构建全绿、测试也全过**。2026-08-28 发 DSA 开篇那次就漏了 ——
首页还写着「还没开始」，而娜娜莉当面否认了刚发布的文章。
现在前三处自动，profile 那处在 `news.mjs` 读取时自动追加一份真实清单。
`tools/tests/site/section-stats.test.mjs` 拦着，不许再写回去。

### 首页分区图片来源

首页三张分区背景图片均来自 Pixiv（P站）：

1. `自学课内` 背景图：KirinMusic
2. `自学课外` 背景图：Matchacora
3. `Life` 背景图：安哈娜

## 全站上锁

`scripts/noimpty-lockdown.js` 负责，采用**默认拒绝**：白名单（现在只有 `/`）之外一律锁。
`/about/` 一度也在白名单里，后来收回去了 —— 那一页把站上有什么逐条列了出来，
放在锁外面等于这整套上锁没有意义。理由写在 `PUBLIC_PATHS` 上面的注释里。
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
不设的话构建仍然成功，但 `search.xml` 会被清空，站内搜索用不了，日程和行动日志也不会发布。日程数据与搜索索引使用相同的 AES-GCM 信封，仅在输入站点暗号后解密；源数据文件不变。

`pages.yml` 里有一步「上锁自检」，上述任何一条不过就直接让部署失败。

## 自动化

| 工作流 | 干什么 | 频率 |
|---|---|---|
| `pages.yml` | 测试 → 构建 → 上锁自检 → 部署 | push 到 main |
| `nanaly.yml` | 回评论 / 巡逻 / 批注 / 资讯 / 随笔 | 见文件内的 cron |
| `daily-report.yml` | 每晚站点日报邮件 | 每天 22:00 |

`npm test` 会跑 `tools/tests/` 下各分类目录中的全部测试。部署前会自动跑一遍，红了就不部署。

**策划室已于 2026-08-26 整个删掉**（原本是一周三次自动写游戏策划书）。方向转去
AI Infra 之后它没有存在意义了，页面、脚本、工作流和测试都已移除。它的产出在一个
独立的私有仓库里，那边一个字没动；仓库设置里的 `IDEAS_TOKEN` / `IDEAS_REPO`
两个 secret 现在没有任何工作流会用，可以删掉。

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

## 代码健壮性检查

`npm run check` 会依次运行全部离线回归、干净构建、站内链接检查与公开页内容检查。
`npm run build` 现在会先清理 Hexo 生成缓存，避免文章日期或板块列表沿用旧缓存。
发布前设置 `NOIMPTY_PASSPHRASE`，否则搜索、日程和行动日志按上文的缺省规则处理。

另有三个**手动**检查，都不在 `npm test` 里，需要时自己跑：

| 命令 | 做什么 | 为什么不进 `npm test` |
| --- | --- | --- |
| `npm run voicecheck` | 对着真实语音服务跑完整链路，报告语气提示泄漏率和补尾音是否生效 | 要花钱、要联网，结果带随机性 |
| `npm run emotioncheck` | 校验情绪样例与分段契约；加 `--live` 才会真调模型 | 默认离线免费，`--live` 要花钱 |
| `npm run svgcheck <文件…>` | 估算配图里文字的包围盒，查出框和压字 | 只在写文章配图时用得上 |

`svgcheck` 仅估算文字几何范围，配图仍应在浏览器中检查实际渲染。

聊天取消、清空、保险箱锁定会终止旧轮请求；截断或错误的流式回答会保留已收到内容并提示未完成。
日程未提交草稿使用本机缓存保留，刷新时按原基线合并；保存期间继续编辑不会被较早的保存结果覆盖。
撤销自动完成会保留原 `autoAt` 作为手动覆盖标记，后台不会再自动勾上；修改完成条件后旧标记失效，新规则重新生效。

Hexo 与娜娜莉统一使用 Markdown-it 15；本地渲染适配器保留原有数学公式、任务列表、图片与标题锚点配置。
主题资源按当前启用功能生成，不再安装所有可选评论系统；新增本地插件时需声明其依赖，或配置对应的 `CDN.option`。
自动任务统一使用 `npm ci`；日报的邮件依赖也已纳入锁文件。2026-09-25 的 `npm audit` 结果为 0 项已知漏洞。

最新修复与验证见 [2026-09-25 维护记录](docs/maintenance/2026-09-25-audit.md)；此前记录见 [2026-09-19 代码审查](docs/maintenance/2026-09-19-audit.md)。

## 视觉设计

首页以原有二次元插画为主体，保留圆润卡片和动态效果，配色恢复为视觉改版前的原始主题。桌面端将人物与文字分开排布，手机端使用上图下文。保留三张入口插画和暗号校验，不在公开首页展示文章信息。

样式集中在 `source/css/sakura.css` 与 `source/css/sakura-components.css`；`source/js/sakura-motion.js` 管理短页面入场、卡片动效与首屏花瓣。动画不阻挡路由，不改变内容的默认可见性。减少动态、后台或省流量模式下停止增强；首屏离开视口后暂停环境动画。

首页插画周围增加少量萤光、轻漂的心形光点和间歇流星，沿用原始玫瑰粉配色。装饰只挂在首屏、不接收点击，也不进入无障碍朗读；手机减少数量，减少动态时隐藏。它们复用现有环境动画开关，无需额外计时器、动画脚本或外部资源。

恢复原来的默认暗色，仍保留主题原生深浅色切换和已有用户偏好。全局颜色由 `source/css/custom.css` 管理，聊天、音乐、日程和暗号页使用各自原有的颜色样式；增强层只负责布局、圆角和动态反馈，没有新增第三方运行依赖。

### 娜娜莉聊天小屋

娜娜莉默认在右侧展开宽敞聊天窗口，可切换靠边、可拖动浮窗和专注模式，拖动边缘或使用方向键调整尺寸。手机接近全屏，并适配软键盘；话题与记忆使用独立侧栏，减少长回答、输入框和工具挤在一起的情况。

新话题无需命名：第一次回答后由模型概括标题，空白话题不会堆积到历史中。“话题”里的“⋯”菜单支持重命名和删除，删除/清空可在 15 分钟内撤销最近一次操作。

输入区支持图片，以及 PDF、DOCX、文本、CSV、JSON 和常见代码文件。文件在本机解析，点击发送后才把读取到的内容交给模型；每次两份、每份 10 MB，单份文字最多 60,000 字符。PDF 最多读取前 30 页，扫描图与普通图片共享每轮两张的名额，文件卡会明确列出未读取范围。

声音共用已保存的硅基流动密钥：默认 `FunAudioLLM/CosyVoice2-0.5B` 的 `diana` 女声，提供清甜猫娘、温柔陪伴和元气声线，可试听、朗读回复、调语速及关闭提示音。自动朗读默认关闭；试听/朗读按硅基流动实际用量收费，本机提示音不请求模型。图文与文件默认使用 `Pro/moonshotai/Kimi-K2.6`，文字模型保留现有配置。

布局、历史和声音偏好保存在当前浏览器；文件和图片保存在本机 IndexedDB。配置、读取限制、费用说明及操作方法见 [娜娜莉聊天工作区](docs/features/nanaly-chat.md)。


### 娜娜莉表情与音乐小舞台

娜娜莉的猫猫头像在打开、思考和成功回复时给出小表情。历史恢复不触发完成庆祝；取消、错误、锁定或收起时结束当前反馈。装饰与聊天请求分开管理，不依赖额外接口或图片资源。

音乐面板中的迷你耳机包含真实音频频谱，切歌时歌名短暂滑入。浏览器支持音频捕获时，频谱使用旁路读取，不接管原播放器的声音输出；不支持时保留静态耳机，不影响播放。动画在暂停、面板收起、后台、减少动态或省流量模式下停止。

两项样式分别放在 `source/css/nanaly-delight.css`、`source/css/music-stage.css`，与原始配色和页面动效一起加载。
