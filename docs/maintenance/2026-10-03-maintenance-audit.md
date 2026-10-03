# 2026-10-03 每周维护审查

本轮从 `99a096d`（复习卡改版）开始，修复和清理分成 `d4e512f`、`53c25df`、`7d186ad` 三个提交，检查线上运行状态、服务器、仓库和产物里的泄露风险、依赖、工作流、后端鉴权、前端注入点、代码质量，最后在本地和线上把全站每个页面都打开一遍。文章正文、图片和音乐没有改动。

## 线上状态

- GitHub Actions 最近 40 次运行里只有 10-02 两次部署失败，原因是北京零点后一分钟内必挂的那个测试，当天的 `aee00c1` 已经修好，后面的部署都成功了。娜娜莉的日常、日报这两条定时任务的日志里没有任务本身的错误。
- 后端 `/api/health` 正常，线上版本 `8b568bc` 之后 `server/` 和部署脚本都没有改动，所以不需要重新部署。
- 服务器开机 7 天，磁盘用了 18%，没有失败的服务，nanaly 服务没有重启过，近 7 天没有错误日志。证书由 Caddy 管理，到 12 月 24 日。SSH 只允许密钥登录，7 天里有 6456 次猜密码的尝试，因为密码登录已经关掉，这些都进不来。
- 代码运行用的是 nanaly 用户下的 rootless Docker，所以系统级 docker 服务没有启用是正常的。重启以后 nanaly、caddy 和 rootless Docker 都会自己起来（服务已设为开机自启，nanaly 用户开了 linger）。

## 发现的问题

### 服务器的安全更新一直没有自动安装

`/etc/apt/apt.conf.d/50unattended-upgrades` 里 `"${distro_id}:${distro_codename}-security";` 这一行被注释掉了，这多半是云厂商镜像的默认设置。于是自动更新只看 `noble` 这个源，日志里每天都是「No packages found that can be upgraded unattended」，而系统里已经积了 99 个安全更新，同时提示需要重启（`apparmor` 更新）。服务器写操作要由主人执行，命令见文末。

### 旧提交号下的私有资料仍然能取到

9-27 重写历史以后，旧提交 `0b7ca4b` 下的 `schedule.json`、`noimpty-profile.md`、`nanaly-journal.json` 在 raw.githubusercontent.com 上仍然返回 200（本轮只看了状态码，没有下载内容）。要彻底删掉，需要向 GitHub Support 提交回收请求，工单草稿在 `D:\WSL\blog-security-20260927\github-support-message.txt`。

### 依赖告警

`npm audit` 报 11 条（9-28 那次是 0 条，都是这周新公布的），另外有 5 个 Dependabot 升级 PR 一直开着没合。本轮处理以后还剩 8 条，全部在 hexo 的构建链里（braces、micromatch、chokidar、nunjucks 等）。npm 给的修法是降级到 hexo 3.9，不能采纳；braces 3.0.3 和 nunjucks 3.2.4 已经是最新版，上游还没出修复。它们只在构建时处理自己写的文章，所以暂时接受。

### 首页时钟的对比度修复一直没生效

线上无障碍检查（axe）报首页时钟的星期和倒计时文字对比度只有 3.6 和 3.2。9-29 已经在 `custom.css` 里定过颜色（`#5c2539`、`#c2385a`，对比度 5.55 和 4.98），但是 `site-clock.css` 在它之后加载、选择器又一样，于是一直被 `var(--cat-line)` 盖掉。同一次检查还报复习页没有一级标题，因为页面上只有主题隐藏掉的 `h1.title-seo`。

## 修复与清理

- 依赖（`d4e512f`）：合并 5 个 Dependabot 升级。nodemailer 9.1.1 → 10.0.13 修掉 5 条告警，10 版只要求 Node 20 以上，日报的 `await import('nodemailer')`、`createTransport`、`sendMail` 实测可用，`service: 'gmail'` 仍解析到 smtp.gmail.com:465。katex 0.18.4 → 0.18.10，同时把 `source/lib/katex/katex.min.js` 换成同一版本，否则娜娜莉渲染公式时 JS 和构建复制的 CSS、字体版本不一致。@fancyapps/ui 6.1.15、mammoth 1.13.0（继续锁精确版本）、postcss 8.5.28。在原有版本范围内顺带升级传递依赖 dompurify 3.4.16、moment 2.31.0。
- 无障碍（`53c25df`）：时钟两条规则前加 `html` 提高一级优先级，颜色还是 9-29 定的那两个；复习页补一个只给读屏软件看的 h1，页面外观不变。
- 清理（`7d186ad`）：删掉 `noimpty-ai.js` 里没有调用方的 `searchCorpus`（26 行，站内检索早就改走 `NanalyResearch.search`）、`absUrl` 和只写不读的 `dwellFrom`。两个测试原来拿这两个函数名当切片的结束标记，改成紧跟其后的注释行，切出来的代码不变。
- 删掉日报、资讯、巡逻脚本里没用到的 `WINDOW`、`digest`、`pad`、`grab`。
- `.gitignore` 加上 `.env` 和 `.env.*`，防止本地调试时放密钥的环境变量文件被提交进公开仓库。

## 查过、没有发现问题的

- 本机四个真实密钥（硅基流动、后端令牌、站点暗号、gh 令牌）逐字搜索当前文件、全部 git 历史和构建产物，都没有出现。按常见密钥格式（各家 API key、私钥头、JWT）再扫一遍，也是干净的；仓库没有跟踪任何敏感文件名。GitHub 的密钥扫描和推送拦截都开着。
- 工作流：actionlint 无报错；只用 GitHub 官方 action；手动触发的输入都经环境变量传进脚本，没有拼进 shell；文章检查任务只接受已发布文章清单里的路径；没有 `pull_request_target`。
- 后端：令牌用定长比较，跨域只放行白名单，请求体上限 1.2 MB，失败、主人操作和后台任务分开限流，后台令牌碰不到主人资料接口，终端用一次性的 48 位随机票据。从外网实测，没令牌和错令牌都是 401，陌生来源 403，明文 http 跳转到 https。
- 前端：模型回答先整体转义再渲染，链接只放行 http/https；娜娜莉写进仓库的资讯和随笔会把代码以外的 `<` 转义并去掉外链；其余 `innerHTML` 拼的都是写死的模板或转义过的文本。
- 产物：`leakcheck` 通过；`search.xml` 是 AES-GCM 密文。文章页和复习页的 HTML 里是明文，这是软锁的设计，原文本来就在公开仓库里，不是新的泄露。
- 代码质量：ESLint 没有发现真正的错误（控制字符正则、`typeof module` 守卫、故意的全角空格都是有意为之）；三处「赋值后没用」只是初始值被覆盖。shellcheck 无报错，ruff 只报有意的写法。已删功能没有留下残留代码，`source/js`、`source/css` 里没有没人引用的文件，package.json 里没有不用的依赖，`npm ls` 只缺其他平台的可选包。

## 验证

- `npm test`：113 个测试文件全部通过（升级依赖、清理代码以后各跑了一遍）。`npm run build` 成功，`linkcheck` 检查 224 个 HTML、26179 个站内链接没有死链，`leakcheck` 通过。
- 本地全站巡检（`~/.cache/claude-browser/sweep.js`）：224 个页面在桌面和手机宽度下各打开一遍，只有一页在手机宽度下因为 WSL 网络抖动（`ERR_NETWORK_CHANGED`）没加载到 Pjax，单独重跑后没有问题。
- 线上全站巡检（`sweep-live.js`，部署的还是 `f05e15e` 那一版）：手机宽度 224 页全部正常。桌面那一轮中途本机代理断了一阵，47 页报 `ERR_PROXY_CONNECTION_FAILED` 或超时，打开成功的页面里没有任何错误；给脚本加了按清单重跑的 `ONLYLIST`，把这 47 页单独重跑以后也全部正常。
- 无障碍：线上 7 个页面（首页、课外、复习、Linux 第九章、日程、学习台、资讯）报 2 类问题，修复后本地复查首页、复习页、学习台为 0。
- 依赖升级后的浏览器实测：用新版 katex 渲染求和与对数公式，排版和字体正常；点开文章配图，fancybox 大图层正常打开；复习页从解锁、出题、答题到再来一组的完整流程正常，手机宽度没有横向溢出。
- `npm ls` 只缺其他平台的可选包，`git diff --check` 通过。

## 需要主人处理的

1. 在服务器窗口执行（不要加 `!`）。先让自动更新包含安全源，再装上积压的更新并重启，重启期间后端会断一两分钟：

   ```
   sudo sed -i 's|^\s*//\s*"${distro_id}:${distro_codename}-security";|\t"${distro_id}:${distro_codename}-security";|' /etc/apt/apt.conf.d/50unattended-upgrades
   sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::=--force-confold upgrade
   sudo reboot
   ```

2. 决定要不要向 GitHub Support 提交回收旧提交的请求。
3. 在仓库 Settings → Advanced Security 里打开 Dependabot alerts，这样新公布的漏洞会主动提醒，不用等每周维护。
4. 服务器是 9-25 买的一个月，大约 10-24 到期，记得在控制台确认到期日或者打开自动续费。

## 范围边界

- 没有调用付费模型、语音、发信接口，也没有动线上的评论和讨论区。
- 服务器只做了只读检查，没有改任何配置。
- API 没有发 HSTS 头。它只被自己的前端用 https 地址调用，收益很小，所以只记下来，没有改线上的 Caddy 配置。
- CI 上新版 npm 提示 esbuild、hexo-util 的安装脚本还没被 allowScripts 批准。现在只是警告，本机的 npm 11.17 还没有对应的命令，没法核实配置格式，所以这轮不改，下次 npm 升级后再处理。
