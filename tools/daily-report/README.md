# 博客日报 · 配置说明

每晚北京时间 22:00，仓库里的定时任务会跑一遍：采数据 → 做检查 → 让娜娜莉写小结 → 发邮件给你。

**设计原则：任何一个环节挂了，报告照发**，把失败原因写进那一格里。宁可收到一份「访问数据没取到」的邮件，也不要因为一个接口 500 就整晚没消息。

---

## 一、这份报告里有什么

| 板块 | 数据来源 | 没配凭据时 |
|---|---|---|
| 访问情况 | GoatCounter 或 Umami API | 显示「没取到」，其余照常 |
| 新评论 + 垃圾筛查 | GitHub Discussions（Giscus 的后端） | 自动可用，无需配置 |
| 新文章 + 娜娜莉读后反馈 | 仓库里的 git 记录 | 自动可用；没有 DeepSeek key 则跳过反馈 |
| 健康检查 | 你的线上站点 + GitHub API | 自动可用 |

### 健康检查查什么

你这个站是 GitHub Pages 上的纯静态 HTML —— 没有服务器、没有数据库、没有后台登录。
「被入侵」「SQL 注入」这类威胁在这里**物理上不成立**。真正的风险是**不小心漏出去**和**悄悄坏掉**：

1. **加密文章泄漏** —— 标了 `privacy: protected` 的文章有没有混进 `atom.xml` / `sitemap.xml` / `search.xml` / 首页 / 归档页。**这条最重要**
2. **站点可用性** —— 首页能不能打开、SSL 证书还有多少天
3. **自动部署** —— 最近的构建有没有失败（红了你可能好几天发现不了）
4. **依赖漏洞** —— Dependabot 的新增告警，翻译成人话
5. **死链与坏图** —— 从 sitemap 出发爬一遍，检查站内链接和图片

---

## 二、要往仓库 Secrets 里放什么

位置：仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

> Secrets 是加密存储的。**存进去之后连你自己都看不到明文**，也不会出现在 Actions 日志里。
> 这和娜娜莉在浏览器里那把 key 是同一把，但存的地方完全不同，互不影响。

### 必需（不配就发不出邮件）

| 名字 | 值 | 怎么拿 |
|---|---|---|
| `GMAIL_USER` | 你的 Gmail 地址 | — |
| `GMAIL_APP_PASSWORD` | 16 位应用专用密码 | <https://myaccount.google.com/apppasswords>（需先开两步验证）。**不是你的登录密码** |
| `REPORT_TO` | 收件地址 | 不填就发给 `GMAIL_USER` 自己 |

### 建议配（不配则降级）

| 名字 | 值 | 不配的后果 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 和娜娜莉用的同一把 | 小结和读后反馈变成模板文字，其余不受影响 |

### 访问统计：二选一

**方案 A — GoatCounter（推荐，免费）**

| 名字 | 值 |
|---|---|
| `GOATCOUNTER_CODE` | 你注册时选的站点代号，也就是 `xxx.goatcounter.com` 里的 `xxx` |
| `GOATCOUNTER_TOKEN` | 设置 → API → 新建 token，勾选「读取统计」权限 |

**方案 B — Umami（API 需付费订阅）**

| 名字 | 值 |
|---|---|
| `UMAMI_API_KEY` | cloud.umami.is → Settings → API keys |
| `UMAMI_WEBSITE_ID` | 就是埋点脚本里的 `data-website-id` |

两个都不配也能跑，只是访问那一格显示「没取到」。

---

## 三、先手动跑一次

别等到晚上才发现配错了。

仓库 → **Actions** → 左侧选「博客日报」→ 右上 **Run workflow**：

- **勾上 `dry`** → 只生成不发送，报告会作为构建产物（Artifacts）上传，下载下来用浏览器打开看
- **不勾** → 真发一封给你

先勾着跑一次，确认内容对了，再取消勾选跑一次验证发信。

---

## 四、本地调试

```bash
# 只生成 report.html，不发邮件
node tools/daily-report/run.mjs --dry

# 想看某一项为什么失败
SITE_URL=http://localhost:4000 node -e "
  import('./tools/daily-report/health.mjs').then(async m => {
    const h = await m.runHealth()
    h.checks.forEach(c => console.log('['+c.level+']', c.name+':', c.detail))
  })"
```

---

## 五、想调整

| 想改什么 | 改哪里 |
|---|---|
| 发送时间 | `.github/workflows/daily-report.yml` 里的 `cron`。**用 UTC**，北京时间减 8 小时 |
| 改成「没事就不发」 | 同一文件里 `REPORT_ONLY_WHEN_NOTEWORTHY` 改成 `'true'` |
| 统计窗口（默认 24 小时） | 加环境变量 `REPORT_WINDOW_HOURS` |
| 娜娜莉在报告里的语气 | `tools/daily-report/narrate.mjs` 顶部的 `PERSONA` |
| 邮件长相 | `tools/daily-report/render.mjs`。**邮件客户端不支持 flex/grid**，所以全是表格布局和内联样式，别改成现代 CSS |
| 单次最多点评几篇新文章 | `tools/daily-report/sources.mjs` 里的 `CAP`（默认 3） |

---

## 六、已知限制

- **GitHub 定时任务会漂移**，几分钟到半小时都正常，尤其是整点。想要准时得换别的调度器
- **Dependabot 告警**默认的 `GITHUB_TOKEN` 读不到，需要额外权限。读不到时那一格会显示「先跳过」，不影响其他检查
- **死链检查**最多扫 60 个页面、400 个地址，够你现在的规模用，文章多了要调
- **新文章判据**是「git 里有改动 **且** front-matter 的 `date` 在两天内」。只改错别字不会重新触发点评；批量重构也不会被误判成发了十几篇新文章
