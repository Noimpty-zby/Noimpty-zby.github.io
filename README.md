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

首页使用三个主要入口：

- `Study`：公开的学习内容，下分 `GAMES101`、`UE5` 和 `竞赛`
- `Ideas`：想法与灵感记录，进入页面需要暗号
- `Life`：生活记录，进入页面和文章页都需要暗号

### 首页分区图片来源

首页三张分区背景图片均来自 Pixiv（P站），按页面显示顺序署名如下：

1. `Study` 背景图：Matchacora
2. `Ideas` 背景图：KirinMusic
3. `Life` 背景图：安哈娜

GAMES101 文章使用层级分类，并保留对应标签：

```yaml
categories:
  - [Study, GAMES101]
tags:
  - Study
  - GAMES101
```

以后添加 Ideas 或 Life 文章时，需要标记为受保护内容。例如 Life：

```yaml
categories:
  - Life
tags:
  - Life
privacy: protected
private_section: Life
```

Ideas 使用同样的写法，将 `Life` 改为 `Ideas` 即可。受保护文章会从站内搜索和普通文章列表中隐藏，并在直接访问时显示暗号输入框。

这里采用的是静态站点前端门禁，只适合普通访问限制，不等同于服务端鉴权或内容加密。

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