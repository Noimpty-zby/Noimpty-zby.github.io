# 项目结构与功能索引

这个仓库是 Hexo 静态博客。文章、站点代码、构建插件、离线测试与联网自动任务分别维护。

## 目录职责

| 目录 | 用途 |
|---|---|
| source/_posts、source/news、source/in-class、source/extra、source/life | 博文、资讯与栏目源码 |
| source/_data | 日程、助手旁注、行动日志、用量和背景资料 |
| source/js、source/css | 自有前端脚本与样式；保持现有 URL 以兼容浏览器缓存和页面引用 |
| source/img、source/music、source/live2d | 图片、音乐和 Live2D 模型素材 |
| source/lib | 已随站点分发的第三方运行库；保留许可证 |
| scripts | Hexo 构建插件，不能移入其他目录而不修改 Hexo 加载机制 |
| tools/nanaly | 自动回评、巡逻、批注、资讯、随笔及 GitHub 操作 |
| tools/daily-report | 数据采集、健康检查、自动日程与邮件报告 |
| tools/checks | 链接、公开页面、SVG、语音和情绪检查入口 |
| tools/assets | Live2D 资源导入与运行库整理 |
| tools/tests | 按 ai、media、automation、schedule、site、tooling 分类的离线回归 |
| docs/features | 功能使用说明 |
| docs/maintenance | 按日期保存的审查和维护记录 |
| .github/workflows | 发布、助手自动任务、日报与只读文章检查 |
| public、db.json、node_modules | 可重建的产物、缓存与安装依赖，不提交进 Git |

## 功能到实现的映射

| 功能 | 入口与协作模块 |
|---|---|
| 文章渲染、数学公式、任务清单 | scripts/noimpty-markdown.js、tools/markdown-renderer.cjs |
| 栏目与学习进度 | scripts/noimpty-sections.js、noimpty-study.js、source/js/section-hub.js |
| 系列上下篇、相关文章、旧链接 | scripts/noimpty-pagination.js、noimpty-related-posts.js、noimpty-redirects.js |
| 暗号门、加密搜索与日志 | scripts/noimpty-lockdown.js、source/js/privacy-gate.js、noimpty-search.js |
| 日程与三方合并 | source/js/schedule.js、scripts/noimpty-schedule.js、tools/daily-report/schedule-auto.mjs |
| 娜娜莉主对话与密钥保险箱 | source/js/noimpty-ai.js |
| 多话题、草稿、记忆与撤销 | source/js/nanaly-workspace.js |
| 检索、来源与检查任务 | source/js/nanaly-research.js、nanaly-tasks.js |
| 服务商、图片与文件 | source/js/nanaly-provider.js、nanaly-vision.js、nanaly-files.js |
| 聊天窗口与语音 | source/js/nanaly-shell.js、nanaly-prosody.js、nanaly-voice.js、nanaly-audio.js |
| Mao 看板娘 | source/js/mao-pet.js、mao-controls.js、source/css/mao-*.css、source/live2d/mao；Mao 是显示与互动组件，娜娜莉负责对话 |
| 音乐与页面动态 | source/js/music-player.js、sakura-motion.js、site-clock.js、toc-sync.js |
| 访问统计 | source/js/analytics.js；区分访客浏览与主人心跳 |
| 后台自动生成内容 | tools/nanaly；在构建前产生 Markdown 或 _data 数据 |
| 部署质量门禁 | npm run check、.github/workflows/pages.yml |

## 数据边界

- 本人文章与后台生成内容分别维护。模型生成的文章关闭 Nunjucks 执行，避免把模型输出当构建指令。
- 搜索、日程和行动日志使用 AES-GCM 信封；没有构建暗号时不发布私有 JSON。
- 现有页面暗号门仍属于前端软锁：HTML 正文仍在静态产物中。其用途和全文加密、服务器鉴权不同。
- API 密钥存入当前浏览器的加密保险箱；解锁后同源脚本仍有能力读取使用中的密钥。
- 聊天附件在浏览器本机解析、存储，发送后才进入模型请求；图片、文本、音频均有读取或传输上限。
- 浏览器日程只在主动保存时写仓库；自动日程根据可查证信号更新，手动撤销标记会保留。
- 自动化提交明确限定文件路径，不应夹带其他已暂存文件。
- 测试不应读取真实密钥、调用付费模型、发送邮件、评论或部署。

## 修改后的验证

从仓库根目录运行：

1. npm test：递归发现所有分类目录中的 *.test.mjs。
2. npm run build：清除旧生成缓存后重新构建。
3. npm run linkcheck 与 npm run leakcheck：检查生成内容。
4. npm run check：合并执行上述步骤。
5. 涉及图片、音频、布局或 PJAX 时，额外检查浏览器中的真实页面。

npm run emotioncheck 默认离线。npm run voicecheck 是付费服务实测，应明确需要时再运行；--help 只显示说明。
