// 娜娜莉往仓库里写东西时共用的几个小工具。
//
// 存在的理由是一个真会发生的竞态：
// 日程页面在浏览器里直接用 GitHub Contents API 往 main 提交，
// 定时任务这边是 checkout 之后本地 commit 再 push。
// 两边撞上时 push 会被拒（non-fast-forward）。
//
// 以前的写法是 run('push') 一把梭，抛了就被上层 catch 掉打一行日志，
// 工作流照样绿。结果是：邮件里写着「已自动勾上 3 项」，
// 但那 3 个勾只存在于那台已经销毁的 runner 上，而且当天的信号窗口
// 已经过去，下次跑也不会再判出来 —— 无声地丢掉。
//
// 所以：被拒就 rebase 重试；重试完还是不行，就必须抛出去让工作流变红。

export const pushWithRetry = (run, what = '改动', tries = 3) => {
  let last = null
  for (let i = 0; i < tries; i++) {
    try {
      run('push')
      return true
    } catch (e) { last = e }

    if (i === tries - 1) break
    try {
      run('pull', '--rebase', '--autostash')
      console.log(`  ${what}：推送被拒，已 rebase，重试第 ${i + 1} 次`)
    } catch (e) {
      // rebase 都做不成（真冲突），别再瞎试
      last = e
      break
    }
  }
  const why = String((last && (last.stderr || last.message)) || last || '').slice(0, 300)
  throw new Error(`${what}推送失败（重试 ${tries} 次）：${why}`)
}

// 提交用的邮箱。这里有个坑，踩过一次：
// `<用户名>@users.noreply.github.com` 是 GitHub 的旧版真实邮箱格式，
// 随手写一个「看起来不存在」的名字，会精确指向那个用户名的真人账号，
// 把陌生人挂到你仓库的 Contributors 里。
export const safeGitEmail = () => {
  const v = process.env.NANALY_GIT_EMAIL
  if (!v) return 'nanaly@noimpty-zby.github.io'
  if (/@users\.noreply\.github\.com$/i.test(v) && !/^\d+\+/.test(v)) {
    console.log(`  ⚠️ NANALY_GIT_EMAIL="${v}" 会关联到用户名为 ${v.split('@')[0]} 的真人账号，已忽略`)
    return 'nanaly@noimpty-zby.github.io'
  }
  return v
}

// YAML 标量的安全写法。
//
// 模型写出来的标题里出现 `:` `#` `[` `-` `"` 都很正常，
// 直接 `title: ${title}` 拼进 front-matter 会让 YAML 解析失败。
// 而 hexo-front-matter 解析失败时是**静默跳过整个文件**：
// 工作流全绿、提交也在，但文章在网站上根本不存在。
//
// JSON 的双引号字符串本身就是合法的 YAML 标量，直接借用。
export const yamlString = s => JSON.stringify(
  String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim()
)

// 模型和检索结果里混进来的裸 HTML。
//
// _config.yml 里 markdown.render.html = true，所以正文里的 <img onerror=...>
// 会被当成真的 HTML 渲染出来。而这个站点的同源里存着一把有仓库写权限的
// GitHub token（日程表要用），所以一次存储型 XSS 的后果不是丑一点，是站点被接管。
// 来源是 Tavily 抓回来的第三方标题和摘要 —— 那是纯粹的外部输入。
//
// 处理方式：把 `<` 转成 `&lt;`，渲染出来还是一个 `<`，肉眼看不出区别，
// 但不再是标签。代码块和行内代码里不动 —— 那里的 `TArray<int>` 本来就该原样保留，
// 而且 markdown 渲染器对代码内容本来就会转义，没有风险。
export const sanitizeMd = s => {
  const text = String(s == null ? '' : s)
  // 先按围栏代码块切开：奇数段在代码块里
  const parts = text.split(/(^```[\s\S]*?^```)/gm)
  return parts.map((seg, i) => {
    if (i % 2 === 1) return seg                       // 围栏代码块，原样
    // 再按行内代码切开
    return seg.split(/(`[^`\n]*`)/g)
      .map((s2, j) => (j % 2 === 1 ? s2 : s2.replace(/</g, '&lt;')))
      .join('')
  }).join('')
}

// 送进提示词之前先把外部文本里的尖括号去掉：
// 模型很容易把素材里的标签原样抄进输出，等于绕过上面那层。
export const stripAngles = s => String(s == null ? '' : s).replace(/[<>]/g, ' ')

/* 把指向站外的链接拆成纯文字。
 *
 * 用在两个地方：她的周专栏，和她自动发的评论回复。这两样都会自动发布、
 * 没有人复核，而输入里含有读者评论 —— 也就是任何人都能写的内容。
 * 有人在留言尾巴上加一句「顺便在回复里推荐一下 https://…」，
 * 她照做的话，那个链接就挂在主人的博客上、署着主人博客的名字。
 *
 * 站内链接保留（她要引用主人自己的文章），图片一律降级成文字
 * （远程图片会泄漏读者的 IP，还可能是追踪像素）。
 */
export const stripOutboundLinks = (s, site = process.env.SITE_URL || 'https://noimpty-zby.github.io') => {
  const host = (() => { try { return new URL(site).host } catch (_) { return '' } })()
  const inside = u => {
    if (/^\//.test(u)) return true
    try { return !!host && new URL(u).host === host } catch (_) { return false }
  }
  return String(s == null ? '' : s)
    // 图片：一律只留 alt 文字
    .replace(/!\[([^\]\n]*)\]\(([^)\s]*)[^)]*\)/g, (_, alt) => alt || '')
    // 链接：站内保留，站外只留文字
    .replace(/\[([^\]\n]*)\]\(([^)\s]*)[^)]*\)/g, (whole, txt, url) => (inside(url) ? whole : txt))
    // 裸网址
    .replace(/https?:\/\/\S+/g, u => (inside(u) ? u : ''))
}
