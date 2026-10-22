# 内容与素材维护

本页集中记录文章、栏目、进度标签和素材维护规则。运行、验证与发布入口见 [README](../README.md)，实现位置见 [项目结构](architecture.md)。

## 内容目录

```text
/in-class/       课内：数据结构与算法、CSAPP
/extra/ai-infra/ AI Infra：Linux 入门/深入、Git、Go、MySQL、Docker、Transformer 推理机制、Python
/extra/gamedev/  游戏开发：GAMES101、UE5 · Tom Looman
/life/          生活记录
/news/          资讯
/schedule/      日程
```

文章主要位于 `source/_posts/`，资讯位于 `source/news/`，栏目页位于对应的 `source/` 子目录。开放之前首页只有头像、一句中性的介绍和课内、课外两个入口，不展示文章标题或具体学习内容（主题配置 `home.lists: false`，`leakcheck` 会查）；开放时把它改成 `true`，首页才列出系列和最近更新。

## 新文章的 front-matter

保留文章自己的标题、日期等字段，并设置分类、标签及隐私字段：

```yaml
categories:
  - [课外, AI Infra, Go]
tags:
  - 具体的技术标签
privacy: protected
sitemap: false
private_section: 课外
```

`private_section` 使用 `课外`、`课内` 或 `Life`，决定解锁框显示的板块名。标签描述具体主题，不重复分类名；文章推荐按共同标签匹配，越少见、越具体的共同标签权重越高，同分时按发布日期和标题稳定排序。推荐卡片会标出共同标签。

| 内容 | categories |
| --- | --- |
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

新增分类时同步 [_config.yml](../_config.yml) 的 `category_map`，保持分类 URL 可读；不要只修改页面显示名而漏掉分类、叶子名和路径映射。

正文由 Markdown-it 渲染，支持既有数学公式、任务列表、图片与标题锚点配置。右侧目录会随标题的实际位置更新，也会响应图片和字体引起的布局变化；不要为配合目录另写一套标题锚点。

## 进度与篇数

篇数和最近发表时间由 [noimpty-sections.js](../scripts/noimpty-sections.js) 在构建时统计，不在卡片、栏目页或助手提示词里手写数字。

```text
{% section_stat Git %}
{% section_stat 入门=Linux入门|深入=Linux深入 %}
{% section_stat GAMES101|UE5-Looman %}
{% section_progress DSA %}
```

- 单个叶子名显示「已写 N 篇」或「还没开始」。
- `标签=叶子名` 为每项加显示标签，例如「入门 3 篇 · 深入还没开始」。
- 多个不带标签的叶子名求和。
- `section_progress` 还显示最近一篇的日期。

多项用 `|` 分隔，不用空格，因为 `Transformer 推理机制` 等叶子名本身包含空格。这几个标签留给正文里需要的地方；栏目页的篇数由主题直接数，章节与阶段写在系列页 front-matter 的 `progress:` 里（见下面「栏目页与页面样式」）。

「已写几篇」不能代替「学完几章」。后台读取 profile 时会追加实际文章清单，不需要再维护一份篇数。[section-stats.test.mjs](../tools/tests/site/section-stats.test.mjs) 检查这些约束。

## 栏目页与页面样式

栏目页由主题按 front-matter 渲染，页面文件里不写页头 HTML。板块和系列的名字、英文名、代号、角色色、出处写在 [_config.noimpty.yml](../_config.noimpty.yml) 的 `hubs` / `series` 里；系列页的 front-matter 只写这门课自己的信息：

```yaml
type: noimpty-track
track: DSA                       # 分类叶子名，主题和学习总览都靠它数篇数
lead: Mastering Data Structures & Algorithms using C and C++
course:
  - [讲师, Abdul Bari]
  - [时长, 约 53 小时视频]
progress: 字符串                  # 学到哪了；篇数和最近一篇由主题现数，不要写进来
about_title: 关于这门课
```

正文就是页面底部「关于这门课」那一段。板块页（`type: noimpty-hub`）只写 `lead` 和 `about_title`，下一级有哪些课由 `hubs.<路径>.children` 决定。新增一门课要改三处：`category_map`、`_config.noimpty.yml` 的 `series`（以及上一级板块的 `children`）、新建系列页。

| 位置 | 用途 |
| --- | --- |
| `themes/noimpty/source/css/noimpty.css` | 主题的全部样式：暖纸 + 墨色配色、正文排版、代码高亮、角色卡、转场 |
| `themes/noimpty/source/js/noimpty-theme.js` | 无刷新换页与转场、目录高亮、阅读进度、首页选曲、搜索框 |
| `themes/noimpty/source/css/noimpty-compat.css` | 主题和私人功能接头的地方（练习台分栏、娜娜莉批注只给主人看） |
| `source/css/widgets.css` | 私人组件共用的变量和左下角按钮坐标 |
| `source/css/nanaly-delight.css`、`music-stage.css` | 聊天表情与音乐频谱样式 |

各系列的角色色只当色块用，上面压黑字（对比度都在 5 以上），不拿来当浅底上的文字色。转场遵守减少动态效果的设置；转场盖满之前不换内容，新页面不会从没盖住的地方露出来。

## 素材维护与署名

### 头像

`source/img/avatar/noimpty.webp`（方形，首页圆形头像）和 `noimpty-card.webp`（竖版，换页时的角色卡、关于页）是从主人给的立绘里裁出的头部和上半身。

### 背景音乐

本地音乐位于 `source/music/`，播放清单在 [music-player.js](../source/js/music-player.js)。现有 10 首曲目来源为网易云音乐，作者为 **三Z-STUDIO、HOYO-MiX**，播放器标注为「我喜欢的音乐」。公开部署前确认拥有相应授权。

播放器默认随机，支持播放、切歌、进度、音量和收起，偏好保存在本机。首次播放受浏览器自动播放策略约束，通常需要点击播放；普通 PJAX 跳转保持播放。音乐频谱使用真实音频的旁路捕获，不接管声音输出；浏览器不支持时保留静态装饰，不影响播放。

### Live2D 与第三方运行库

Mao 模型的原始说明、作者和许可要求保留在 [source/live2d/mao/ReadMe.txt](../source/live2d/mao/ReadMe.txt)。自托管运行库位于 `source/lib/`；导入或更新时保留随包许可证，不把自托管误当作获得任意使用权限。操作入口为 `npm run vendor:live2d`，角色功能说明见 [Mao 看板娘](features/mao.md)。

编辑器、终端等生成 bundle 的第三方许可由构建工具一并保留，不手改压缩产物；修改 `tools/assets/*-entry.mjs` 后运行 `npm run build:learning-editor`。

### 头像

用正方形图片覆盖 `source/img/avatar.png`，重要内容不要贴近边缘。执行 `npm run clean`、`npm run server` 检查裁切和显示；图片来源及使用授权也应随替换一起核对。

## 内容修改后的检查

1. 核对 front-matter、分类叶子名和 `category_map`，进度篇数使用构建标签。
2. 设置本地构建暗号，运行 `npm run check`；配图可额外运行 `npm run svgcheck -- <文件…>` 检查文字边界。
3. 在浏览器检查正文、数学公式、目录、推荐、图片与窄屏布局。几何估算和离线测试不能代替真实渲染检查。
4. 按 [README 的部署步骤](../README.md#前后端部署) 发布；有模型、音乐或插画变更时保留署名和许可证。
