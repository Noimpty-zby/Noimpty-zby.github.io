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

文章主要位于 `source/_posts/`，资讯位于 `source/news/`，栏目页位于对应的 `source/` 子目录。首页只有三个公开分区入口，不展示文章标题或具体学习内容；详细介绍放在锁后的栏目页。

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

多项用 `|` 分隔，不用空格，因为 `Transformer 推理机制` 等叶子名本身包含空格。章节与阶段仍由作者维护，例如：

```html
<span>递归 · {% section_progress DSA %}</span>
```

「已写几篇」不能代替「学完几章」。后台读取 profile 时会追加实际文章清单，不需要再维护一份篇数。[section-stats.test.mjs](../tools/tests/site/section-stats.test.mjs) 检查这些约束。

## 内页角色与页面样式

课程卡片和页头的小角色是 [tools/kawaii-art.cjs](../tools/kawaii-art.cjs) 中的手写 SVG，由 [noimpty-kawaii.js](../scripts/noimpty-kawaii.js) 注册的标签生成：

```text
{% kawaii core %}          页头场景，可选 core、extra、life、news 等
{% kawaii penguin stage %} 单个角色与小彩虹
{% kawaii penguin %}       课程卡片图标
```

页头场景包在 `<figure class="noimpty-scene" data-lines="第二句|第三句">` 中，第一句写在 `<figcaption class="noimpty-scene__bubble">` 中。点击角色，或 `Tab` 聚焦后按 `Enter` / 空格，可以切换台词；保留键盘焦点与状态播报。手机课程页的气泡显示在角色下方，避免被页头裁切。

新增课程可参考同级页面，从 `kawaii-art.cjs` 的 `SINGLE` 选择角色；新增角色沿用低位小脸、粉彩填色和深梅色描边。构建还会生成 `/img/kawaii/<名字>.svg`，供归档、分类和标签页头使用。

主要样式与交互入口：

| 位置 | 用途 |
| --- | --- |
| `source/css/custom.css` | 全局颜色与基础适配 |
| `source/css/sakura.css`、`sakura-components.css` | 首页与卡片布局 |
| `source/js/sakura-motion.js` | 页面入场、卡片与首屏环境动效 |
| `source/js/interior-deco.js` | 内页角色台词、视线与装饰 |
| `source/js/toc-sync.js` | 文章目录同步 |
| `source/css/nanaly-delight.css`、`music-stage.css` | 聊天表情与音乐频谱样式 |

装饰不应拦截页面操作或进入无障碍朗读。保留减少动态、后台和省流量模式下的降级，以及首屏离开视口后的环境动画暂停；详细聊天和 Mao 行为由各自的功能文档维护。

## 素材维护与署名

### 首页分区图片

三张分区背景图片来自 Pixiv，维护或再分发时保留作者信息，并确认相应用途已获授权：

| 分区 | 作者 |
| --- | --- |
| 自学课内 | KirinMusic |
| 自学课外 | Matchacora |
| Life | 安哈娜 |

文件位于 `source/img/sections/`，卡片引用由 `source/js/section-hub.js` 维护。署名不是授权证明，替换素材时一起核对来源与许可。

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
