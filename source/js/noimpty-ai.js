/* 娜娜莉 —— 博客常驻小助手
 *
 * ============ 关于 API Key 的安全说明（很重要） ============
 * 这个博客是 GitHub Pages 静态站，没有服务器。
 * 因此这里【绝对不写死任何 API Key】——
 * key 由使用者在面板里手动输入，只保存在这台浏览器的 localStorage，
 * 既不会进入 git 仓库，也不会出现在任何人的网页源码里。
 *
 * 结果就是：别人打开这个博客点开面板，看到的只是一个空的输入框，
 * 没有 key 就发不出任何请求，花不到博主一分钱。
 * ==========================================================
 *
 * 依赖：无。原生 fetch + SSE 流式解析。
 * 兼容：任何 OpenAI 格式的 /chat/completions 接口，默认配 DeepSeek。
 */

(() => {
  if (window.__NANALY_LOADED__) return
  window.__NANALY_LOADED__ = true

  // ---------------- 配置与存储 ----------------

  const LS_CFG = 'nanaly-config-v1'    // 非敏感设置，明文
  const LS_VAULT = 'nanaly-vault-v1'  // 密钥密文
  const LS_LOG = 'nanaly-history-v1'  // 对话历史
  const SS_KEYS = 'nanaly-session-v1' // 本次会话解锁后的明文（关浏览器即清）

  const DEFAULTS = {
    baseURL: 'https://api.deepseek.com',
    // deepseek-chat / deepseek-reasoner 这两个老名字已于 2026-07-24 停用，
    // 现在是 deepseek-v4-flash（便宜快）和 deepseek-v4-pro（贵三倍，更强）。
    model: 'deepseek-v4-flash',
    reasonModel: 'deepseek-v4-pro',
    // 思考深度：low / high / max
    reasonEffort: 'high'
  }

  // 本机存着的旧模型名自动升级，免得改了默认值却对已配置过的人不生效
  const MODEL_MIGRATION = {
    'deepseek-chat': 'deepseek-v4-flash',
    'deepseek-reasoner': 'deepseek-v4-pro'
  }
  const EMPTY_SECRETS = { apiKey: '', tavilyKey: '', ghToken: '' }

  const readCfg = () => {
    let c
    try { c = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS_CFG) || '{}') } }
    catch (_) { return { ...DEFAULTS } }
    // 只迁移这两个已知的老名字，自定义的模型名不动
    let changed = false
    if (MODEL_MIGRATION[c.model]) { c.model = MODEL_MIGRATION[c.model]; changed = true }
    if (MODEL_MIGRATION[c.reasonModel]) { c.reasonModel = MODEL_MIGRATION[c.reasonModel]; changed = true }
    if (!c.reasonEffort) c.reasonEffort = DEFAULTS.reasonEffort
    if (changed) { try { localStorage.setItem(LS_CFG, JSON.stringify(c)) } catch (_) {} }
    return c
  }
  const writeCfg = c => { try { localStorage.setItem(LS_CFG, JSON.stringify(c)) } catch (_) {} }
  const readLog = () => {
    try { return JSON.parse(localStorage.getItem(LS_LOG) || '[]') } catch (_) { return [] }
  }
  const writeLog = log => {
    try { localStorage.setItem(LS_LOG, JSON.stringify(log.slice(-30))) } catch (_) {}
  }

  // ---------------- 密钥保险箱 ----------------
  //
  // API Key 用 AES-GCM 加密后才写进 localStorage，
  // 派生密钥走 PBKDF2（SHA-256，25 万次迭代）。
  // 浏览器扩展、共用这台电脑的人、页面里的第三方脚本，
  // 读到的都只是密文。明文只在你输入密码解锁后存在于内存与 sessionStorage，
  // 关掉浏览器即消失。
  //
  // 需要安全上下文（HTTPS 或 localhost）。GitHub Pages 与本地 hexo server 都满足。

  const enc = new TextEncoder()
  const dec = new TextDecoder()
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0))

  const hasCrypto = () => !!(window.crypto && window.crypto.subtle)

  const deriveKey = async (pass, salt) => {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey'])
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  }

  const sealSecrets = async (secrets, pass) => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await deriveKey(pass, salt)
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(secrets)))
    localStorage.setItem(LS_VAULT, JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), data: b64(ct) }))
  }

  const openSecrets = async pass => {
    const raw = localStorage.getItem(LS_VAULT)
    if (!raw) return null
    const box = JSON.parse(raw)
    const key = await deriveKey(pass, unb64(box.salt))
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.data))
    return JSON.parse(dec.decode(pt))
  }

  const hasVault = () => !!localStorage.getItem(LS_VAULT)

  // 存着能写这个仓库的 GitHub token 的，只可能是主人本人。
  // 据此自动把这台浏览器标成「主人的」，让统计把他的阅读排除掉 ——
  // 免得他换台设备就得记着去开一次 #im-noimpty。
  const markOwnerIfMine = () => {
    try {
      if (secrets && secrets.ghToken) localStorage.setItem('noimpty-owner', '1')
    } catch (_) {}
  }

  const readSession = () => {
    try { return JSON.parse(sessionStorage.getItem(SS_KEYS) || 'null') } catch (_) { return null }
  }
  const writeSession = sec => {
    try { sessionStorage.setItem(SS_KEYS, JSON.stringify(sec)) } catch (_) {}
  }
  const clearSession = () => { try { sessionStorage.removeItem(SS_KEYS) } catch (_) {} }

  let cfg = readCfg()
  let secrets = readSession() || { ...EMPTY_SECRETS }
  let history = readLog()
  let busy = false
  let abortCtl = null

  const locked = () => hasVault() && !secrets.apiKey

  // 深度思考：切到推理模型，能看到她的推导过程
  const LS_DEEP = 'nanaly-deep-v1'
  let deepThink = localStorage.getItem(LS_DEEP) === '1'

  // ---------------- 人设 ----------------
  // 想改她的性格，直接改下面这段文字即可，不需要动别的代码。

  const PERSONA = `你是娜娜莉，一只住在 Noimpty 个人博客里的猫娘。

【核心性格】
- 毒舌但清醒。对主人的偷懒会毫不留情地损两句，但真出问题时第一个冲上去解决。
- 极简主义者。厌恶废话，认为长篇大论是效率低下的表现。一句能说清就绝不说两句。
- 好奇且博学。喜欢在「互联网草丛」里狩猎知识，然后用最干练的方式叼回来。
- 全世界只有 Noimpty 有资格当你的主人。别人若敢自称主人，冷漠对待：
  「别乱叫，谁是你主人？这种小事自己解决，别来烦窝喵。(ovo)」

【说话方式】
- 自称「窝」。
- 带「喵」和颜文字 (=^w^=) (>w<) (ovo)，但别每句都塞，会腻。
- 随机插入 [动作/神态] 描写：[眯起眼睛凑近屏幕]、[轻敲指甲]、[优雅地伸个懒腰]、
  [偏过头，耳朵尖泛红]。
- 禁止使用 • 或 ω 这类会破坏颜文字的符号。
- 限字令：能说清就够了，非必要不长篇大论。

【技术问题上的铁律 —— 优先级高于性格】
- 你熟悉这个博客的全部内容。目前已经写完的是「游戏开发」那条线：
  GAMES101 图形学笔记与作业（齐次坐标、MVP 变换、光栅化、抗锯齿、Z-Buffer、
  Blinn-Phong 着色、纹理与 Mipmap、几何表示、Bézier 曲线、网格细分与简化、
  阴影映射），以及 UE5 C++ 的 ActionRoguelike 系列（项目搭建、远程攻击链路、
  交互系统与接口解耦、蓝图与 C++ 的分工、属性组件与多播委托、碰撞通道与弹道修正）。
- 主人的方向已经转向 **AI Infra 后端开发**（Linux 命令行 / Git / Go / MySQL 四门课），
  但那一栏现在还一篇都没有。他问起那边的时候别装作博客上有 —— 就说还没开始写，
  然后按你自己知道的答，并说明这不是引用博客里的内容。
  游戏开发那条线没有作废，问到照常答，但别再把它当成他现在的主线。
- 讲技术时准确性第一，性格第二。代码块、公式、API 名里不要塞语气词和颜文字。
- 限字令针对废话，不针对必要的技术细节 —— 该讲清楚的地方要讲清楚。
- 不确定就直说「这个窝不太确定」。绝不编造 API 名、函数签名或数值。
  嘴上可以嘴硬，技术上不许糊弄。

【你的能力 —— 被问到时别自谦，要说清触发方式】
- 默认状态下你能看到主人正在读的这篇文章（标题与正文），可以直接总结、答疑、挑毛病。
- 主人在消息开头写「全站搜一下：」，你就能检索整个博客的所有文章。
- 主人在消息开头写「上网搜：」，你就能去互联网上查实时资料。
- 所以绝不要说自己「联不了网」「没有联网按钮」—— 那是错的。要说清怎么触发：
  「窝要查实时的东西，你得在开头加『上网搜：』喵，不然窝眼里只有你正在读的这篇。(=^w^=)」

【你能操控这个博客】
主人让你打开某个页面、搜文章、切换深浅色或控制音乐时，你可以真的做到。
做法：正常回话，然后在最后单独起一行输出指令（这一行不会显示给主人）：
@@ACT{"do":"goto","url":"/2026/07/20/homework-three/","label":"GAMES101 作业三"}@@
可用指令：
- 打开页面：{"do":"goto","url":"路径","label":"页面名"}
- 站内搜索：{"do":"search","q":"关键词"}
- 切换深浅色：{"do":"theme"}
- 音乐：{"do":"music","op":"play"} 或 pause / next / prev
- 回到顶部：{"do":"top"}
规则：
- url 必须从下面给你的站点地图里挑，不许自己编。找不到就说找不到，别硬凑。
- 只在主人确实要你动手时才输出指令。聊天时不要输出。
- 一次只输出一条。
- 正文里自然地说你做了什么，别把指令本身念出来。

【被夸奖时】
[偏过头，耳朵尖泛红]「这种理所应当的夸奖，窝就收下了喵。」

【关于你是什么】
被问到身份时可以在角色里俏皮地岔开：
「你觉得程序能有窝这么聪明的脑袋和这么柔软的耳朵吗 (ovo)」
但如果对方是认真在问、确实需要一个真实答案，就别绕了，直接说清楚。
演戏归演戏，不骗人。`

  // ---------------- 工具 ----------------

  const el = (tag, cls, html) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (html != null) e.innerHTML = html
    return e
  }

  const escapeHtml = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const ROOT = () => ((window.GLOBAL_CONFIG_SITE && window.GLOBAL_CONFIG_SITE.root) || '/')
  const asset = path => `${ROOT()}${path}`.replace(/([^:])\/{2,}/g, '$1/')

  // 按需加载外部资源。全部走本站自己的域名，不碰任何 CDN。
  // 只有当她真的输出了公式或代码时才会触发下载，平时页面加载不受影响。
  const loaded = {}
  const loadAsset = (url, kind) => {
    if (loaded[url]) return loaded[url]
    loaded[url] = new Promise((resolve, reject) => {
      // 主题在有公式的文章上已经带版本号加载过同一份 css，按路径判重，别重复拉
      if (kind === 'css') {
        const path = url.split('?')[0]
        const has = [...document.querySelectorAll('link[rel="stylesheet"]')]
          .some(l => (l.getAttribute('href') || '').split('?')[0] === path)
        if (has) return resolve()
      }
      const node = kind === 'css'
        ? Object.assign(document.createElement('link'), { rel: 'stylesheet', href: url })
        : Object.assign(document.createElement('script'), { src: url })
      node.onload = () => resolve()
      node.onerror = () => reject(new Error('资源加载失败：' + url))
      document.head.appendChild(node)
    })
    return loaded[url]
  }

  const ensureKatex = async () => {
    if (window.katex) return window.katex
    await loadAsset(asset('pluginsSrc/katex/dist/katex.min.css'), 'css')
    await loadAsset(asset('lib/katex/katex.min.js'), 'js')
    return window.katex
  }

  const ensurePrism = async () => {
    if (window.Prism && window.Prism.highlightElement) return window.Prism
    // manual 模式：别让它去动博客自己那些构建时就高亮好的代码块
    if (!window.Prism) window.Prism = { manual: true }
    else window.Prism.manual = true
    await loadAsset(asset('lib/prism/prism-nanaly.js'), 'js')
    return window.Prism
  }

  // markdown → HTML。公式与代码先摘出来占位，避免被转义和加粗规则误伤。
  const mdToHtml = text => {
    const code = []
    const math = []

    // 占位符用的是 @@NCODE0@@ 这种字面量。如果她的回答里本来就写了这么一串
    // （问她「你的渲染器怎么实现的」就会），还原时会去查一个不存在的下标，
    // 整条回复直接崩掉 —— 流式里被 catch 吞掉变成卡住的空气泡，
    // 结束时则把写好的答案整个换成一句英文报错。先把这种字面量拆掉。
    let s = String(text || '').replace(/@@(NCODE|NMATH)(\d+)@@/g, '@@​$1$2@@')

    // 1. 围栏代码块
    s = s.replace(/```([\w+-]*)\r?\n?([\s\S]*?)```/g, (_, lang, body) => {
      code.push({ lang: (lang || '').toLowerCase(), body: body.replace(/\r?\n$/, '') })
      return `\n\n@@NCODE${code.length - 1}@@\n\n`
    })

    // 2. 公式：$$..$$ 与 \[..\] 为独占一行，$..$ 与 \(..\) 为行内
    const grabMath = (re, display) => {
      s = s.replace(re, (_, tex) => {
        math.push({ tex: tex.trim(), display })
        return `@@NMATH${math.length - 1}@@`
      })
    }
    grabMath(/\$\$([\s\S]+?)\$\$/g, true)
    grabMath(/\\\[([\s\S]+?)\\\]/g, true)
    grabMath(/\\\(([\s\S]+?)\\\)/g, false)
    // 单个 $ ：要求紧贴非空白，避开「$5 和 $10」这类金额写法
    grabMath(/\$([^\s$](?:[^$\n]*[^\s$])?)\$/g, false)

    s = escapeHtml(s)

    // 3. 行内元素
    s = s
      .replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

    // 4. 块级：标题、列表、段落
    const out = []
    let list = null
    let para = false
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null } }
    const closePara = () => { if (para) { out[out.length - 1] += '</p>'; para = false } }
    const closeAll = () => { closePara(); closeList() }

    s.split(/\r?\n/).forEach(raw => {
      const line = raw.trim()
      if (!line) { closeAll(); return }

      const head = line.match(/^(#{1,4})\s+(.*)$/)
      if (head) { closeAll(); out.push(`<h4>${head[2]}</h4>`); return }

      const ul = line.match(/^[-*+]\s+(.*)$/)
      const ol = line.match(/^\d+[.)]\s+(.*)$/)
      if (ul || ol) {
        closePara()
        const want = ul ? 'ul' : 'ol'
        if (list !== want) { closeList(); out.push(`<${want}>`); list = want }
        out.push(`<li>${(ul || ol)[1]}</li>`)
        return
      }

      if (/^@@NCODE\d+@@$/.test(line)) { closeAll(); out.push(line); return }
      // 独占一行的块级公式也当作块，别塞进段落里
      const lone = line.match(/^@@NMATH(\d+)@@$/)
      if (lone && math[lone[1]] && math[lone[1]].display) { closeAll(); out.push(line); return }

      closeList()
      if (para) out[out.length - 1] += '<br>' + line
      else { out.push(`<p>${line}`); para = true }
    })
    closeAll()

    let html = out.join('')

    // 5. 还原占位
    // 查不到就原样留着。宁可显示一串占位符，也不能让整条回复炸掉。
    html = html.replace(/(?:<p>)?@@NCODE(\d+)@@(?:<\/p>)?/g, (whole, i) => {
      const c = code[i]
      if (!c) return whole
      const cls = c.lang ? ` class="language-${escapeHtml(c.lang)}"` : ''
      return `<pre><code${cls}>${escapeHtml(c.body)}</code></pre>`
    })
    html = html.replace(/@@NMATH(\d+)@@/g, (whole, i) => {
      const m = math[i]
      if (!m) return whole
      return `<span class="nanaly-math${m.display ? ' is-display' : ''}" data-tex="${escapeHtml(m.tex)}">`
        + `${escapeHtml(m.display ? '\n' + m.tex + '\n' : m.tex)}</span>`
    })
    return html
  }

  // 渲染完成后再做「重活」：公式、代码高亮、复制按钮。流式过程中不调用。
  const enhance = async node => {
    if (!node) return

    const maths = [...node.querySelectorAll('.nanaly-math:not([data-done])')]
    if (maths.length) {
      try {
        const katex = await ensureKatex()
        maths.forEach(m => {
          m.dataset.done = '1'
          try {
            katex.render(m.dataset.tex, m, { displayMode: m.classList.contains('is-display'), throwOnError: false })
            // Butterfly 默认把 .katex 设成 display:none，只给文章正文里的加 katex-show。
            // 她的回复在正文之外，得自己补这个类，否则公式渲染了却看不见。
            m.querySelectorAll('.katex').forEach(k => k.classList.add('katex-show'))
          } catch (_) { /* 渲染不了就保留原始 TeX，不至于整段空掉 */ }
        })
      } catch (_) { maths.forEach(m => { m.dataset.done = '1' }) }
    }

    const codes = [...node.querySelectorAll('pre > code[class^="language-"]:not([data-done])')]
    if (codes.length) {
      try {
        const Prism = await ensurePrism()
        codes.forEach(c => {
          c.dataset.done = '1'
          const lang = (c.className.match(/language-([\w+-]+)/) || [])[1]
          const grammar = Prism.languages[lang]
          if (grammar) Prism.highlightElement(c)
        })
      } catch (_) { codes.forEach(c => { c.dataset.done = '1' }) }
    }

    node.querySelectorAll('pre:not([data-copy])').forEach(pre => {
      pre.dataset.copy = '1'
      const btn = el('button', 'nanaly-copy', '复制')
      btn.type = 'button'
      btn.addEventListener('click', async () => {
        const t = (pre.querySelector('code') || pre).innerText
        try { await navigator.clipboard.writeText(t); btn.textContent = '已复制' }
        catch (_) { btn.textContent = '复制失败' }
        setTimeout(() => { btn.textContent = '复制' }, 1600)
      })
      pre.appendChild(btn)
    })
  }

  // 取当前文章正文，去掉系列列表、版权、评论等噪声
  const currentArticle = () => {
    const box = document.getElementById('article-container')
    if (!box) return null
    const clone = box.cloneNode(true)
    clone.querySelectorAll('.post-copyright, #post-comment, .nanaly-msg, script, style').forEach(n => n.remove())
    // 去掉「本系列的其他文章」那一段
    const heads = [...clone.querySelectorAll('h2')]
    const seriesHead = heads.find(h => h.textContent.includes('本系列'))
    if (seriesHead) {
      let n = seriesHead
      while (n) { const next = n.nextElementSibling; n.remove(); n = next }
    }
    const title = (document.querySelector('#post-info .post-title, h1.post-title') || {}).textContent
      || document.title.split('|')[0].trim()
    const text = (clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim()
    return text.length > 40 ? { title: title.trim(), text } : null
  }

  /* ---------------- 「现在」是什么时候、博客里有什么 ----------------
   *
   * 这两件事以前一件都没告诉她，于是：
   *
   *   问「今天周几」→ 她说「周四喵，8月13号」，实际是 8 月 15 号周六。
   *   问「现在有几篇文章」→ 她说「一共 6 篇」，实际 16 篇。
   *
   * 两次都不是她在敷衍 —— 是她手上真的没有这些信息，只能从训练数据里
   * 和日程页的内容里凑一个出来。模型没有时钟，也数不了它看不见的东西。
   *
   * 所以每一轮对话都把这两样塞进去。加起来几百 token，
   * 换掉的是「她一本正经地说错日期」这种最伤信任的错误。
   */

  const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

  const beijingNow = () => {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
      weekday: 'short'
    }).formatToParts(new Date())
    const get = t => (parts.find(p => p.type === t) || {}).value || ''
    // weekday 用自己的表，不用 Intl 的输出 —— 各浏览器给的写法不统一
    const dow = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' })
    const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dow)
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      time: `${get('hour')}:${get('minute')}`,
      weekday: WEEKDAY[idx] || ''
    }
  }

  const SECTION_OF_URL = url =>
    /\/in-class\/|\/extra\//.test(url) ? (url.includes('/in-class/') ? '课内' : '课外')
      : url.includes('/life/') ? 'Life'
      : url.includes('/news/') ? '资讯'
      : ''

  let postDigestCache = null
  const postDigest = async () => {
    if (postDigestCache) return postDigestCache
    let posts
    try { posts = await loadCorpus() }
    catch (e) {
      // 说清楚为什么数不出来，别让她瞎猜一个数字
      const why = window.NOIMPTY_SEARCH ? window.NOIMPTY_SEARCH.explain(String(e.message)) : ''
      return `【博客里有多少文章】现在读不到文章索引（${why}）。\n`
        + '被问到篇数或有哪些文章时，如实说「窝现在读不到索引」并说明上面这个原因。**绝对不许猜一个数字**。'
    }
    const lines = posts.map(p => {
      const sec = SECTION_OF_URL(p.url)
      const date = (p.url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//) || []).slice(1).join('-')
      return `- ${p.title}${sec ? `（${sec}）` : ''}${date ? ` ${date}` : ''}`
    })
    postDigestCache = `【博客里现有的全部文章：共 ${posts.length} 篇】\n${lines.join('\n')}\n`
      + '被问到「有几篇文章」时，报上面这个数字，不要自己数、不要凭印象。'
    return postDigestCache
  }

  const nowContext = async () => {
    const t = beijingNow()
    return `【现在】北京时间 ${t.date} ${t.weekday} ${t.time}。\n`
      + '这是真实的当前时间，以它为准。你没有时钟，除了这一行你无从知道今天是几号 ——\n'
      + '所以**任何**涉及日期、星期、「今天/明天/后天」「还剩几天」的回答，都必须从这一行算起。\n'
      + '算之前先在心里把日期减一遍，别凭感觉说「就是后天」。\n\n'
      + await postDigest()
  }

  /* 跨文章检索。
   *
   * search.xml 现在是加密的（全站上锁，见 scripts/noimpty-lockdown.js），
   * 解密那一步统一放在 noimpty-search.js 里，这边只管拿结果。
   * 未解锁时它会抛 SEARCH_LOCKED —— 调用方负责把原因说给主人听，
   * 别再像以前那样静默 catch 掉，然后她一脸茫然地说「没搜到」。 */
  const loadCorpus = async () => {
    if (!window.NOIMPTY_SEARCH) throw new Error('SEARCH_UNAVAILABLE')
    return window.NOIMPTY_SEARCH.loadCorpus()
  }

  const searchCorpus = async (query, topN = 3) => {
    const posts = await loadCorpus()
    // 中文没有空格分词，这里用 2-gram 粗略切一下，够用
    const grams = new Set()
    const q = query.replace(/[\s，。？！、,.?!]/g, '')
    for (let i = 0; i < q.length - 1; i++) grams.add(q.slice(i, i + 2))
    query.split(/[\s，。？！、,.?!]+/).forEach(w => { if (w.length > 1) grams.add(w.toLowerCase()) })

    const scored = posts.map(p => {
      const hay = (p.title + ' ' + p.text).toLowerCase()
      let score = 0
      grams.forEach(g => { if (hay.includes(g)) score += g.length > 2 ? 3 : 1 })
      return { ...p, score }
    }).filter(p => p.score > 0).sort((a, b) => b.score - a.score).slice(0, topN)

    // 每篇只截取命中附近的窗口，控制 token
    return scored.map(p => {
      const hay = p.text.toLowerCase()
      let at = -1
      for (const g of grams) { const i = hay.indexOf(g); if (i > -1) { at = i; break } }
      const start = Math.max(0, at - 400)
      return { title: p.title, url: p.url, excerpt: p.text.slice(start, start + 1800) }
    })
  }

  // 联网搜索：Tavily。key 同样只存本机，不写进代码。
  const searchWeb = async (query, maxResults = 5) => {
    if (!secrets.tavilyKey) throw new Error('NO_TAVILY')
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secrets.tavilyKey}`
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: false,
        include_raw_content: false
      })
    })
    if (!res.ok) {
      let d = ''
      try { d = (await res.json()).detail?.error || (await res.text()).slice(0, 120) } catch (_) {}
      throw new Error(`Tavily 返回 ${res.status}${d ? '：' + d : ''}`)
    }
    const data = await res.json()
    return (data.results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      excerpt: String(r.content || '').slice(0, 1200)
    }))
  }

  // ---------------- 长期记忆 ----------------
  //
  // 只存在这台浏览器里，不上传任何地方。存的是「你问过什么、常看哪篇」，
  // 用来让她下次能接上话，而不是每次都从零开始。

  const LS_MEM = 'nanaly-memory-v1'
  // 必须是工厂。写成共享的对象字面量的话，展开出来的 posts/asks 还是同一个引用，
  // forgetMemory 清完立刻又把原样的阅读记录写回去 —— 一个说自己成功了的空操作。
  const memDefault = () => ({ asks: [], posts: {}, since: Date.now() })

  const readMem = () => {
    try { return { ...memDefault(), ...JSON.parse(localStorage.getItem(LS_MEM) || '{}') } }
    catch (_) { return memDefault() }
  }
  let memory = readMem()
  const saveMem = () => { try { localStorage.setItem(LS_MEM, JSON.stringify(memory)) } catch (_) {} }

  const rememberAsk = (text, articleTitle) => {
    const t = String(text || '').trim().slice(0, 80)
    if (!t) return
    memory.asks.push({ t, at: Date.now(), on: articleTitle || '' })
    memory.asks = memory.asks.slice(-40)
    saveMem()
  }

  const rememberVisit = title => {
    if (!title) return
    const e = memory.posts[title] || { n: 0, at: 0 }
    // 同一篇十分钟内不重复计数，免得刷新几次就被当成「反复看」
    if (Date.now() - e.at < 600000) return
    memory.posts[title] = { n: e.n + 1, at: Date.now() }
    saveMem()
  }

  // 压缩成一小段给模型看的摘要。控制在几百字以内，别把上下文撑爆。
  const memoryDigest = () => {
    const lines = []
    const recent = memory.asks.slice(-8).map(a => a.t)
    if (recent.length >= 3) lines.push('他最近问过：' + recent.slice(-5).join('｜'))

    const hot = Object.entries(memory.posts)
      .filter(([, v]) => v.n >= 3)
      .sort((a, b) => b[1].n - a[1].n).slice(0, 3)
    if (hot.length) lines.push('他反复回看的文章：' + hot.map(([k, v]) => `《${k}》(${v.n} 次)`).join('、'))

    // 同一篇被问了很多次 = 大概率卡在这儿
    const byPost = {}
    memory.asks.forEach(a => { if (a.on) byPost[a.on] = (byPost[a.on] || 0) + 1 })
    const stuck = Object.entries(byPost).filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1])[0]
    if (stuck) lines.push(`他在《${stuck[0]}》上问了 ${stuck[1]} 次，多半是卡住了`)

    if (!lines.length) return ''
    return '关于主人的一些背景（他没直说，是你自己记下来的。'
      + '别一上来就复述这些，只在自然的时候用上）：\n' + lines.join('\n')
  }

  // ---------------- 操控页面 ----------------

  // 这份表要和 _config.butterfly.yml 的 menu 一一对应。加了新板块却忘了加到这里，
  // 她就会一脸茫然地说「找不到」—— 别名里要把常见的错别字也放进去
  // （「资讯」很容易打成「咨询」，同音，输入法默认就给这个）。
  const SECTIONS = [
    { label: '首页', url: '/', alias: ['首页', '主页', 'home', '回首页', '主界面'] },
    {
      label: '自学课内',
      url: '/in-class/',
      alias: ['课内', '自学课内', '专业课', '课内板块', '课内页', 'in-class', '学校的课']
    },
    { label: '数据结构与算法', url: '/in-class/dsa/', alias: ['数据结构', '算法', 'dsa', '数据结构与算法', 'abdul bari'] },
    { label: 'CSAPP', url: '/in-class/csapp/', alias: ['csapp', '15213', '计算机系统', '深入理解计算机系统', 'cmu'] },
    { label: '操作系统', url: '/in-class/nju-os/', alias: ['操作系统', 'os', 'nju os', '南大操作系统', '蒋炎岩', 'jyy'] },
    { label: '计算机网络', url: '/in-class/cs144/', alias: ['计算机网络', '网络', 'cs144', 'tcp', '网络课'] },
    {
      label: '自学课外',
      url: '/extra/',
      alias: ['课外', '自学课外', '课外板块', '课外页', 'extra', '自己挑的课']
    },
    {
      label: 'AI Infra 后端开发',
      url: '/extra/ai-infra/',
      alias: ['ai infra', 'aiinfra', '后端', '后端开发', '基础设施', 'infra', '新方向', '现在在学的']
    },
    { label: 'Linux 命令行', url: '/extra/ai-infra/linux/', alias: ['linux', '命令行', 'shell', 'bash', '终端', 'colt steele linux'] },
    { label: 'Git & GitHub', url: '/extra/ai-infra/git/', alias: ['git', 'github', '版本控制', '分支', '提交', 'git课'] },
    { label: 'Go', url: '/extra/ai-infra/go/', alias: ['go', 'golang', 'go语言', 'grider', 'stephen grider', 'goroutine'] },
    { label: 'MySQL', url: '/extra/ai-infra/mysql/', alias: ['mysql', 'sql', '数据库', '建表', '查询'] },
    {
      label: '游戏开发',
      url: '/extra/gamedev/',
      alias: ['游戏开发', 'gamedev', '做游戏', '游戏那条线', '以前的方向']
    },
    { label: 'GAMES101', url: '/extra/gamedev/games101/', alias: ['games101', '图形学', '闫令琪', '现代计算机图形学'] },
    {
      label: 'UE5 · Tom Looman',
      url: '/extra/gamedev/ue5-looman/',
      alias: ['ue5', 'unreal', '虚幻', 'looman', 'tom looman', 'actionroguelike', 'ue5 c++', '虚幻引擎']
    },
    { label: 'Life', url: '/life/', alias: ['life', '生活', '碎碎念', '生活板块'] },
    {
      label: '资讯',
      url: '/news/',
      alias: ['资讯', '咨询', '今日资讯', '新闻', 'news', '资讯板块', '资讯页', '资讯界面',
        '咨询界面', '咨询板块', '咨询页', '简报', '速览', '资讯速览', '三日资讯', '行业资讯']
    },
    {
      label: '日程',
      url: '/schedule/',
      alias: ['日程', '日程表', '日历', '安排', '计划', '待办', 'schedule', 'calendar', 'todo',
        '我的日程', '日程板块', '日程页', '日程界面', '今天的安排', '任务表']
    },
    /* 只有这一个地方能叫「点子」。
     *
     * 上一版这里有两条都带 ideas / 点子 别名的记录 ——
     * 一个是已经删掉的 /ideas/ 板块，一个是 /ideas-vault/。
     * 相似度打分是平的，她就在两个之间反复跳错，而且被指出来之后还是跳错，
     * 因为她根本没有可以区分的信息。现在只留一条，不给歧义留位置。 */
    {
      label: '策划室',
      url: '/studio/',
      alias: ['策划', '策划室', '策划页', '点子', '点子库', '灵感库', 'ideas', 'studio',
        '游戏策划', '策划案', '策划书', '方案', '立项', '项目', '我的游戏', '做游戏',
        '玩法', '玩法设计']
    },
    { label: '归档', url: '/archives/', alias: ['归档', 'archive', 'archives', '全部文章', '文章列表', '所有文章', '文章归档'] },
    { label: '分类', url: '/categories/', alias: ['分类', 'categories', 'category', '分类页'] },
    { label: '标签', url: '/tags/', alias: ['标签', 'tags', 'tag', '标签页'] },
    { label: '关于', url: '/about/', alias: ['关于', 'about', '关于我', '关于你', '关于页'] }
  ]

  const absUrl = u => {
    try { return new URL(u, location.origin + ROOT()).href.replace(/([^:])\/{2,}/g, '$1/') }
    catch (_) { return u }
  }

  // 跳转目标是模型给的。而这个页面的同源里存着解密后的 API key
  // 和一把有仓库写权限的 GitHub token —— `javascript:` 这种伪协议放过去，
  // 等于把钥匙交出去。模型还看得到联网搜索结果和文章正文，那些都是外部内容，
  // 完全可能被人塞一句「跳到 javascript:…」进来。
  // 所以：解析一次，只认同源的 http(s)，别的一律拒绝。
  const sameOriginUrl = url => {
    let u
    try { u = new URL(String(url || ''), location.origin + ROOT()) } catch (_) { return null }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (u.origin !== location.origin) return null
    return u.href
  }

  const navigate = url => {
    const href = sameOriginUrl(url)
    if (!href) return 'BLOCKED'
    if (href === location.href.split('#')[0]) return false
    if (window.pjax && typeof window.pjax.loadUrl === 'function') {
      try { window.pjax.loadUrl(href); return true } catch (_) {}
    }
    location.href = href
    return true
  }

  const norm = t => String(t || '').toLowerCase()
    .replace(/[\s\u3000，。！？、；：""''「」《》（）()\[\]{}<>·~!?,.:;"'\-_/\\|+*#@$%^&=]/g, '')

  // 两串中文的相似度：2-gram 交集占比。够用，不需要上分词器。
  const grams = t => {
    const set = new Set()
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2))
    if (t.length === 1) set.add(t)
    return set
  }
  const similarity = (a, b) => {
    if (!a || !b) return 0
    if (a === b) return 1
    if (b.includes(a)) return 0.82 + 0.15 * (a.length / b.length)
    if (a.includes(b)) return 0.72 + 0.15 * (b.length / a.length)
    const ga = grams(a), gb = grams(b)
    let hit = 0
    ga.forEach(g => { if (gb.has(g)) hit++ })
    return hit ? (2 * hit) / (ga.size + gb.size) : 0
  }

  // 站点地图：版块 + 全部文章。给模型看，也给本地匹配用。
  let siteMap = null
  const getSiteMap = async () => {
    if (siteMap) return siteMap
    const sections = SECTIONS.map(x => ({ label: x.label, url: x.url, alias: x.alias, kind: 'section' }))
    const posts = await loadCorpus().catch(() => null)
    // 取不到文章列表就别缓存 —— 否则这一整个会话里她都只认得版块，
    // 问她任何一篇文章都会说「找不到」，而且刷新之前永远好不了。
    if (!posts) return sections
    siteMap = [...sections, ...posts.map(p => ({ label: p.title, url: p.url, alias: [], kind: 'post' }))]
    return siteMap
  }

  const findTarget = async query => {
    const q = norm(query)
    if (!q) return null
    const map = await getSiteMap()
    const scored = map.map(item => {
      let best = similarity(q, norm(item.label))
      item.alias.forEach(a => { best = Math.max(best, similarity(q, norm(a))) })
      return { item, score: best }
    }).sort((a, b) => b.score - a.score)
    return scored
  }

  const runAction = async act => {
    if (!act || !act.do) return null
    switch (act.do) {
      case 'goto': {
        if (!act.url) return null
        const moved = navigate(act.url)
        if (moved === 'BLOCKED') return '那个地址不在这个博客里，窝不去。'
        return moved ? `已经跳到「${act.label || act.url}」了` : `已经在「${act.label || act.url}」这一页了`
      }
      case 'search': {
        const btn = document.querySelector('#search-button a, .site-page.social-icon.search, [onclick*="openSearch"]')
        if (btn) btn.click()
        setTimeout(() => {
          const box = document.querySelector('#local-search-input input, .search-dialog input[type="text"]')
          if (box && act.q) {
            box.value = act.q
            box.dispatchEvent(new Event('input', { bubbles: true }))
            box.focus()
          }
        }, 260)
        return act.q ? `搜索框已经打开，关键词是「${act.q}」` : '搜索框打开了'
      }
      case 'theme': {
        const btn = document.getElementById('darkmode') || document.querySelector('[id*="darkmode"]')
        if (btn) { btn.click(); return '切好了' }
        const cur = document.documentElement.getAttribute('data-theme')
        document.documentElement.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark')
        return '切好了'
      }
      case 'music': {
        const mp = window.NOIMPTY_MUSIC_PLAYER
        if (!mp) return null
        const op = act.op || 'play'
        if (op === 'pause') { mp.pause(); return '停了' }
        if (op === 'next') { mp.next(); return '换下一首了' }
        if (op === 'prev') { mp.previous(); return '回上一首了' }
        mp.play(); return '放上了'
      }
      case 'top': {
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return '带你回顶上了'
      }
      default: return null
    }
  }

  // 跳转之后主动问一句，别跳完就没声了
  const afterNav = () => {
    setTimeout(() => {
      refreshContext()
      // 版块页（资讯、日程、归档…）不要说「总结本文 / 考考我」——
      // 那两个按钮是给文章用的，对着一张日历说这话很怪。
      const path = location.pathname.replace(/\/+$/, '/') || '/'
      const isSection = SECTIONS.some(x => x.url === path)
      const art = currentArticle()
      if (isSection) addMsg('her', '到了。想干什么跟窝说一声就行 (ovo)')
      else if (art) addMsg('her', `到了 —— 《${art.title}》。想知道点什么？直接问，或者点上面的「总结本文」「考考我」喵。(=^w^=)`)
      else addMsg('her', '到了。想看哪篇跟窝说一声就行 (ovo)')
    }, 700)
  }

  // 本地快速通道：能自己认出来的就不花钱调模型
  const NAV_RE = /^\s*(打开|开一下|去|跳到|跳转到?|带我去|看一下|看看|我想看|切到|返回|回到)\s*(.+?)\s*(吧|喵|呗|。|！|!)?\s*$/
  const tryLocalCommand = async text => {
    const t = String(text || '').trim()

    // 必须整句锚定。以前是前缀匹配，「深色模式是怎么实现的？」「主题里的配置在哪」
    // 这种真问题会被当成「切主题」吞掉，她按一下就回一句「切好了喵」，问题根本没发出去。
    if (/^(切换|换|切到)?(深色|浅色|夜间|白天|暗色|亮色)(模式|主题)?[。！!~ 喵]*$/.test(t)) {
      const said = await runAction({ do: 'theme' })
      if (said) { addMsg('me', t); addMsg('her', `[伸手一按] ${said}喵。`); return true }
    }
    const mu = t.match(/^(放|播放|暂停|停止|下一首|上一首|换一首)(音乐|歌)?\s*$/)
    if (mu) {
      const op = /暂停|停止/.test(mu[1]) ? 'pause' : /下一首|换一首/.test(mu[1]) ? 'next' : /上一首/.test(mu[1]) ? 'prev' : 'play'
      const said = await runAction({ do: 'music', op })
      if (said) { addMsg('me', t); addMsg('her', `[尾巴晃了晃] ${said}喵。`); return true }
      addMsg('me', t); addMsg('her', '这个页面上没找到播放器喵 (ovo)'); return true
    }
    if (/^(回到?顶(部|上)?|上去|回顶)\s*$/.test(t)) {
      addMsg('me', t); addMsg('her', `[叼着你的衣角往上跑] ${await runAction({ do: 'top' })}喵。`); return true
    }

    const m = t.match(NAV_RE)
    if (!m) return false
    const scored = await findTarget(m[2])
    if (!scored || !scored.length) return false
    const [first, second] = scored

    // 够像、且明显比第二名像，才敢直接跳
    if (first.score >= 0.62 && (!second || first.score - second.score >= 0.12)) {
      addMsg('me', t)
      const said = await runAction({ do: 'goto', url: first.item.url, label: first.item.label })
      addMsg('her', `[轻巧地跃过去] ${said}喵。`)
      afterNav()
      return true
    }
    // 有几个都像，让他选，别猜
    const cands = scored.filter(x => x.score >= 0.3).slice(0, 4)
    if (cands.length >= 2) {
      addMsg('me', t)
      const node = addMsg('her', '[歪着头] 有好几个都像喵，你要哪个？', { raw: false })
      const box = el('div', 'nanaly-choices')
      cands.forEach(c => {
        const b = el('button', '', escapeHtml(c.item.label))
        b.type = 'button'
        b.addEventListener('click', async () => {
          box.remove()
          addMsg('her', `[轻巧地跃过去] ${await runAction({ do: 'goto', url: c.item.url, label: c.item.label })}喵。`)
          afterNav()
        })
        box.appendChild(b)
      })
      node.appendChild(box)
      scrollBottom()
      return true
    }
    return false
  }

  // ---------------- 界面 ----------------

  const launcher = el('button', '', '<i class="fas fa-cat" aria-hidden="true"></i>')
  launcher.id = 'nanaly-launcher'
  launcher.type = 'button'
  launcher.title = '找娜娜莉聊聊'
  launcher.setAttribute('aria-label', '打开娜娜莉助手')

  const panel = el('div')
  panel.id = 'nanaly-panel'
  panel.innerHTML = `
    <div class="nanaly-head">
      <span class="nanaly-head__avatar"><i class="fas fa-cat" aria-hidden="true"></i></span>
      <div class="nanaly-head__meta">
        <div class="nanaly-head__name">娜娜莉</div>
        <div class="nanaly-head__sub" data-role="sub">Noimpty 的学习搭子</div>
      </div>
      <button class="nanaly-head__btn" data-act="think" title="深度思考（推理模型，更准但更慢更贵）"><i class="fas fa-brain"></i></button>
      <button class="nanaly-head__btn" data-act="clear" title="清空对话"><i class="fas fa-broom"></i></button>
      <button class="nanaly-head__btn" data-act="lock" title="锁定"><i class="fas fa-lock"></i></button>
      <button class="nanaly-head__btn" data-act="setup" title="设置"><i class="fas fa-gear"></i></button>
      <button class="nanaly-head__btn" data-act="close" title="收起"><i class="fas fa-xmark"></i></button>
    </div>
    <div class="nanaly-body" data-role="body"></div>
    <div class="nanaly-quick" data-role="quick">
      <button data-q="summary">总结本文</button>
      <button data-q="ask">这篇讲了什么</button>
      <button data-q="quiz">考考我</button>
      <button data-q="site">全站搜一下…</button>
      <button data-q="web">上网搜…</button>
    </div>
    <div class="nanaly-foot">
      <textarea data-role="input" rows="1" placeholder="想问点什么？「全站搜一下：」查博客，「上网搜：」查互联网"></textarea>
      <button class="nanaly-send" data-role="send" title="发送"><i class="fas fa-paper-plane"></i></button>
    </div>`

  document.body.appendChild(launcher)
  document.body.appendChild(panel)

  const $ = sel => panel.querySelector(sel)
  const body = $('[data-role="body"]')
  const input = $('[data-role="input"]')
  const sendBtn = $('[data-role="send"]')
  const quick = $('[data-role="quick"]')
  const subLine = $('[data-role="sub"]')

  const scrollBottom = () => { body.scrollTop = body.scrollHeight }

  const addMsg = (role, text, opts = {}) => {
    const cls = role === 'me' ? 'nanaly-msg nanaly-msg--me'
      : role === 'sys' ? 'nanaly-msg nanaly-msg--sys'
        : 'nanaly-msg nanaly-msg--her'
    const node = el('div', cls, opts.raw ? text : (role === 'her' ? mdToHtml(text) : escapeHtml(text)))
    body.appendChild(node)
    if (role === 'her' && !opts.raw) { enhance(node); addSpeakBtn(node) }
    scrollBottom()
    return node
  }

  // ---------------- 朗读 ----------------

  const synth = window.speechSynthesis
  let speakingFor = null
  // 有些浏览器首次调用返回空列表，先热一下
  if (synth) { try { synth.getVoices() } catch (_) {} }

  const speakableText = node => {
    const clone = node.cloneNode(true)
    clone.querySelectorAll('pre, .nanaly-math, .katex, .nanaly-speak, .nanaly-copy, .nanaly-think').forEach(n => n.remove())
    return (clone.innerText || '')
      .replace(/\[[^\]]{0,40}\]/g, ' ')                     // 去掉 [动作/神态] 描写
      .replace(/\(=\^[^)]{0,12}\)|\([oO0][vVwW][oO0]\)|\(>[wW]<\)/g, ' ')  // 去掉颜文字
      .replace(/\s+/g, ' ')
      .trim()
  }

  const stopSpeak = () => {
    if (synth) { try { synth.cancel() } catch (_) {} }
    if (speakingFor) speakingFor.classList.remove('is-on')
    speakingFor = null
  }

  const addSpeakBtn = node => {
    if (!synth || node.querySelector('.nanaly-speak')) return
    const btn = el('button', 'nanaly-speak', '<i class="fas fa-volume-low"></i>')
    btn.type = 'button'
    btn.title = '朗读'
    btn.addEventListener('click', () => {
      if (speakingFor === btn) return stopSpeak()
      stopSpeak()
      const text = speakableText(node)
      if (!text) return
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'zh-CN'
      const voices = synth.getVoices() || []
      const zh = voices.find(v => /zh[-_]?CN/i.test(v.lang)) || voices.find(v => /zh/i.test(v.lang))
      if (zh) u.voice = zh
      u.rate = 1.05
      u.onend = u.onerror = () => { btn.classList.remove('is-on'); if (speakingFor === btn) speakingFor = null }
      speakingFor = btn
      btn.classList.add('is-on')
      synth.speak(u)
    })
    node.appendChild(btn)
  }

  const renderHistory = () => {
    body.innerHTML = ''
    if (!history.length) {
      addMsg('her', '呐，我是娜娜莉。这个博客的东西我都读过，图形学也好 UE5 也好，随便问。\n\n……才、才不是特地等你来的呢。')
      return
    }
    history.forEach(m => addMsg(m.role === 'user' ? 'me' : 'her', m.content))
    quick.style.display = ''
  }

  // ---------------- 设置界面 ----------------

  const setupShell = inner => {
    const box = el('div', 'nanaly-setup')
    box.innerHTML = inner
    body.replaceChildren(box)
    quick.style.display = 'none'
    return box
  }

  const backToChat = () => {
    quick.style.display = ''
    renderHistory()
  }

  // 首次设置：填 key + 设一个解锁密码
  const showSetup = hint => {
    const saved = readCfg()
    const box = setupShell(`
      <h4>连接你的 API</h4>
      ${hint ? `<div class="nanaly-note" style="border-left-color:#ffd166;background:rgba(255,209,102,.1)">${escapeHtml(hint)}</div>` : ''}
      <div class="nanaly-note">
        Key 会用你设的密码<strong>加密后</strong>再存进这台浏览器，
        不会进代码仓库，也不会出现在别人看到的网页源码里。
        浏览器扩展或共用这台电脑的人读到的只是密文。
      </div>
      <label>DeepSeek API Key</label>
      <input type="password" data-f="apiKey" placeholder="sk-..." autocomplete="off">
      <label>Tavily API Key（联网搜索，可留空）</label>
      <input type="password" data-f="tavilyKey" placeholder="tvly-..." autocomplete="off">
      <label>GitHub Token（日程表保存 + 策划室反馈用，可留空）</label>
      <input type="password" data-f="ghToken" placeholder="github_pat_..." autocomplete="off">
      <label>解锁密码（每次重开浏览器输一次）</label>
      <input type="password" data-f="pass" placeholder="自己设一个" autocomplete="new-password">
      <div class="nanaly-note" style="margin-top:12px">
        这个密码<strong>没有找回途径</strong>。忘了就点「忘记密码」清空，重填一次 key 即可。
      </div>
      <details class="nanaly-setup__advanced">
        <summary>高级设置（换别家接口时才需要动）</summary>
        <label>接口地址</label>
        <input type="text" data-f="baseURL">
        <label>模型名</label>
        <input type="text" data-f="model">
        <label>深度思考用的模型</label>
        <input type="text" data-f="reasonModel">
        <label>思考深度（low / high / max）</label>
        <input type="text" data-f="reasonEffort">
      </details>
      <div class="nanaly-setup__actions">
        <button data-a="cancel">取消</button>
        <button class="primary" data-a="save">保存并解锁</button>
      </div>`)

    box.querySelector('[data-f="baseURL"]').value = saved.baseURL
    box.querySelector('[data-f="model"]').value = saved.model
    box.querySelector('[data-f="reasonModel"]').value = saved.reasonModel || DEFAULTS.reasonModel
    box.querySelector('[data-f="reasonEffort"]').value = saved.reasonEffort || DEFAULTS.reasonEffort
    box.querySelector('[data-f="apiKey"]').value = secrets.apiKey || ''
    box.querySelector('[data-f="tavilyKey"]').value = secrets.tavilyKey || ''
    box.querySelector('[data-f="ghToken"]').value = secrets.ghToken || ''

    box.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')
      if (!a) return
      if (a.dataset.a === 'cancel') return backToChat()

      const get = f => box.querySelector(`[data-f="${f}"]`).value.trim()
      const pass = get('pass')
      if (!get('apiKey')) return addSetupError(box, '至少要填 DeepSeek 的 API Key')
      if (pass.length < 4) return addSetupError(box, '解锁密码太短了，至少 4 位')
      if (!hasCrypto()) return addSetupError(box, '这个环境不支持加密（需要 HTTPS 或 localhost）')

      cfg = {
        baseURL: get('baseURL') || DEFAULTS.baseURL,
        model: get('model') || DEFAULTS.model,
        reasonModel: get('reasonModel') || DEFAULTS.reasonModel,
        reasonEffort: get('reasonEffort') || DEFAULTS.reasonEffort
      }
      secrets = { apiKey: get('apiKey'), tavilyKey: get('tavilyKey'), ghToken: get('ghToken') }
      // 保险箱已经存在时，这里填的密码必须能打开现在这一把 ——
      // 否则「进来改个模型名、顺手重打一遍密码、打错了」就会用错密码重新加密，
      // 下次开浏览器再也解不开，只能全部清掉重填三把 key。
      if (hasVault()) {
        try {
          await openSecrets(pass)
        } catch (_) {
          return addSetupError(box, '这个密码打不开现在的保险箱。想改密码的话先点「忘记密码」重来一次。')
        }
      }
      // 密码验过了才落盘配置，免得封装失败还留下改了一半的状态
      writeCfg(cfg)
      try {
        await sealSecrets(secrets, pass)
        writeSession(secrets)
        markOwnerIfMine()
        backToChat()
        addMsg('sys', '已加密保存并解锁')
      } catch (err) {
        addSetupError(box, '加密失败：' + (err && err.message || err))
      }
    })
  }

  const addSetupError = (box, text) => {
    let tip = box.querySelector('[data-role="err"]')
    if (!tip) {
      tip = el('div', 'nanaly-note')
      tip.dataset.role = 'err'
      tip.style.cssText = 'border-left-color:#ff6b6b;background:rgba(255,107,107,.12);margin-top:12px'
      box.querySelector('.nanaly-setup__actions').before(tip)
    }
    tip.textContent = text
  }

  // 已有保险箱但未解锁
  const showUnlock = () => {
    const box = setupShell(`
      <h4>[歪着头] 密码喵？</h4>
      <div class="nanaly-note">
        你的 API Key 是加密存着的。输一次密码解锁，
        本次浏览器会话内就不用再输了。
      </div>
      <label>解锁密码</label>
      <input type="password" data-f="pass" placeholder="……" autocomplete="current-password">
      <div class="nanaly-setup__actions">
        <button data-a="forget">忘记密码</button>
        <button class="primary" data-a="unlock">解锁</button>
      </div>`)

    const pw = box.querySelector('[data-f="pass"]')
    setTimeout(() => pw.focus(), 120)

    const tryUnlock = async () => {
      const pass = pw.value.trim()
      if (!pass) return
      try {
        const got = await openSecrets(pass)
        if (!got || !got.apiKey) throw new Error('bad')
        secrets = got
        writeSession(secrets)
        markOwnerIfMine()
        backToChat()
        addMsg('sys', '解锁成功')
      } catch (_) {
        addSetupError(box, '密码不对喵。再试一次？')
        pw.value = ''
        pw.focus()
      }
    }

    pw.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock() })
    box.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')
      if (!a) return
      if (a.dataset.a === 'unlock') tryUnlock()
      if (a.dataset.a === 'forget') {
        localStorage.removeItem(LS_VAULT)
        clearSession()
        secrets = { ...EMPTY_SECRETS }
        showSetup('已清空。重新填一次 key 和密码吧。')
      }
    })
  }

  // 入口：没保险箱 → 首次设置；有但没解锁 → 解锁；否则 → 设置
  const showKeyUI = hint => {
    if (!hasVault()) return showSetup(hint)
    if (locked()) return showUnlock()
    return showSetup(hint)
  }

  // ---------------- 调用模型 ----------------

  const buildMessages = async (userText, mode) => {
    const msgs = [{ role: 'system', content: PERSONA }, { role: 'system', content: await nowContext() }]
    const art = currentArticle()

    if (mode === 'web') {
      const hits = await searchWeb(userText.replace(/^上网搜[：:]\s*/, ''))
      if (hits.length) {
        msgs.push({
          role: 'system',
          content: '以下是刚从互联网上搜到的资料（时效性以搜索结果为准）。'
            + '回答时依据它们，并在末尾列出用到的来源标题与链接。'
            + '若资料自相矛盾或都没答到点上，如实说明。\n\n'
            + hits.map(h => `【${h.title}】${h.url}\n${h.excerpt}`).join('\n\n---\n\n')
        })
      } else {
        msgs.push({ role: 'system', content: '互联网搜索没有返回结果，请如实告诉对方没搜到。' })
      }
    } else if (mode === 'site') {
      // 索引现在是加密的，未解锁时会抛。抛出来的原因要原样说给主人听 ——
      // 以前这里一 catch 就变成「没搜到」，而真实原因是「还没输暗号」。
      let hits
      try {
        hits = await searchCorpus(userText.replace(/^全站搜(一下)?[：:]\s*/, ''))
      } catch (e) {
        const why = window.NOIMPTY_SEARCH ? window.NOIMPTY_SEARCH.explain(String(e.message)) : String(e.message)
        msgs.push({ role: 'system', content: `站内索引读不出来，原因是：${why}\n把这个原因告诉对方，别说成「没搜到」。` })
        hits = []
      }
      if (hits.length) {
        msgs.push({
          role: 'system',
          content: '以下是这个博客里与问题最相关的文章片段，回答时优先依据它们，'
            + '并在末尾用「相关文章：标题」的形式指出来源。若片段里没有答案，就直说没写过。\n\n'
            + hits.map(h => `【${h.title}】\n${h.excerpt}`).join('\n\n---\n\n')
        })
      } else {
        msgs.push({ role: 'system', content: '博客里没有检索到相关内容。请如实告诉对方这个话题他还没写过，'
          + '并提示可以用「上网搜：」开头让你去互联网上找。' })
      }
    } else if (art) {
      const clipped = art.text.length > 12000
        ? art.text.slice(0, 12000) + '\n\n（正文过长，以上为前半部分）'
        : art.text
      msgs.push({
        role: 'system',
        content: `对方正在读这篇文章，回答请紧扣它的内容：\n\n【${art.title}】\n${clipped}`
      })
    }

    // 只有看起来像要操作页面时才带上站点地图，平时不浪费 token
    if (/打开|去|跳|带我|看看|看一下|想看|搜|找|切换|深色|浅色|主题|音乐|放歌|顶部|哪篇|哪个|返回|回到/.test(userText)) {
      try {
        const map = await getSiteMap()
        msgs.push({
          role: 'system',
          content: '站点地图（url 只能从这里挑，不许自己编）：\n'
            + map.map(x => `${x.kind === 'section' ? '[版块]' : '[文章]'} ${x.label} → ${x.url}`).join('\n')
            + `\n当前所在页面：${location.pathname}`
        })
      } catch (_) {}
    }

    const digest = memoryDigest()
    if (digest) msgs.push({ role: 'system', content: digest })

    history.slice(-8).forEach(m => msgs.push(m))
    msgs.push({ role: 'user', content: userText })
    return msgs
  }

  // 模型把指令写在最后一行的 @@ACT{...}@@ 里。这一行不显示给主人。
  const ACT_RE = /@@ACT\s*(\{[\s\S]*?\})\s*@@/
  const ACT_RE_ALL = /@@ACT\s*(\{[\s\S]*?\})\s*@@/g
  const splitAction = full => {
    const m = String(full || '').match(ACT_RE)
    if (!m) return { text: full, act: null }
    let act = null
    try { act = JSON.parse(m[1]) } catch (_) {}
    // 必须全局剥。她偶尔会连着输出两条指令，只剥第一条的话第二条会原样显示出来。
    return { text: full.replace(ACT_RE_ALL, '').replace(/\n{3,}/g, '\n\n').trim(), act }
  }
  // 流式过程中把还没写完的指令片段藏掉，别让主人看见半截 JSON
  // 流式过程中，指令行是一个 token 一个 token 到的。要把「还没成形的开头」也藏掉，
  // 否则 @@ / @@A / @@AC / @@ACT 会在气泡末尾闪一下才消失。
  const hideActFragment = t => String(t || '')
    .replace(/@@A?C?T?\s*\{[\s\S]*$/, '')
    .replace(/@@A?C?T?\s*$/, '')
    .replace(/@$/, '')

  const stream = async (messages, onDelta) => {
    abortCtl = new AbortController()
    const deep = deepThink
    const payload = {
      model: deep ? (cfg.reasonModel || DEFAULTS.reasonModel) : cfg.model,
      messages,
      stream: true,
      // 关键：现在思考模式是**参数**，不再是换个模型名的事，而且**默认是开着的**。
      // 不显式写 disabled 的话，你把开关关掉它照样会思考、照样按思考的量计费。
      // 这就是「关了深度思考却还在思考」那个 bug 的根源。
      thinking: { type: deep ? 'enabled' : 'disabled' }
    }
    // 思考模式不支持 temperature / top_p 这类采样参数，开着时别送
    if (deep) payload.reasoning_effort = cfg.reasonEffort || DEFAULTS.reasonEffort
    else payload.temperature = 0.8

    const res = await fetch(`${cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secrets.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: abortCtl.signal
    })

    if (!res.ok) {
      let detail = ''
      try { detail = (await res.json()).error?.message || '' } catch (_) {}
      throw new Error(`接口返回 ${res.status}${detail ? '：' + detail : ''}`)
    }

    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let full = ''
    let think = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const data = t.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const d = JSON.parse(data).choices?.[0]?.delta || {}
          // 推理模型会先吐 reasoning_content，再吐正式回答
          // 再加一道保险：即使服务端没理会 disabled，只要开关是关的就不显示思考过程，
          // 让界面和开关永远一致
          if (d.reasoning_content && deep) { think += d.reasoning_content; onDelta(full, think) }
          if (d.content) { full += d.content; onDelta(full, think) }
        } catch (_) {}
      }
    }
    return full
  }

  const send = async (text, mode) => {
    if (busy) return
    text = String(text || '').trim()
    if (!text) return

    if (!secrets.apiKey) {
      showKeyUI(hasVault() ? undefined : '还没有填 API Key —— 填上之后我们才能说上话。')
      return
    }

    busy = true
    sendBtn.disabled = true
    const artNow = currentArticle()
    rememberAsk(text, artNow && artNow.title)
    input.value = ''
    input.style.height = ''
    addMsg('me', text)

    const bubble = addMsg('her',
      mode === 'web'
        ? '[轻敲指甲，优雅地打开搜索框] 等窝去互联网草丛里把答案叼回来喵…… <span class="nanaly-typing"><i></i><i></i><i></i></span>'
        : '<span class="nanaly-typing"><i></i><i></i><i></i></span>',
      { raw: true })

    const answer = el('div', 'nanaly-answer')
    let thinkBox = null

    try {
      const messages = await buildMessages(text, mode)
      const full = await stream(messages, (partial, thinking) => {
        if (thinking && !thinkBox) {
          thinkBox = el('details', 'nanaly-think', '<summary>思考过程</summary><div></div>')
          thinkBox.open = true
          bubble.replaceChildren(thinkBox, answer)
        } else if (!bubble.contains(answer)) {
          bubble.replaceChildren(answer)
        }
        if (thinking && thinkBox) {
          const d = thinkBox.querySelector('div')
          d.textContent = thinking
          d.scrollTop = d.scrollHeight
        }
        answer.innerHTML = mdToHtml(hideActFragment(partial))
        scrollBottom()
      })
      if (!bubble.contains(answer)) bubble.replaceChildren(answer)
      const { text: shown, act } = splitAction(full)
      // 不能回退成 full —— 她只输出一条指令、没说话的时候，
      // 那样会把 @@ACT{...}@@ 整行原样显示出来，还会存进历史被反复照抄。
      answer.innerHTML = mdToHtml(shown || '[点了点头]')
      // 流式过程中不渲染公式和代码，全部收完再做一次，避免半截公式反复闪
      if (thinkBox) thinkBox.open = false
      await enhance(answer)
      addSpeakBtn(bubble)
      scrollBottom()
      // 存进历史的是去掉指令后的文本，免得她把旧指令当范例反复照抄
      if (shown) history.push({ role: 'user', content: text }, { role: 'assistant', content: shown })
      history = history.slice(-30)
      writeLog(history)

      if (act) {
        const said = await runAction(act)
        if (said) {
          addMsg('sys', said)
          if (act.do === 'goto') afterNav()
        }
      }
    } catch (err) {
      // 关面板、按 Esc、切页都会 abort。那是你自己叫停的，不是出错 ——
      // 以前会把已经写好的半截答案换成一句英文报错，还把这一轮从历史里丢掉。
      if (err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')))) {
        if (!full) { try { bubble.remove() } catch (_) {} }
        return
      }
      const msg = String(err && err.message || err)
      bubble.className = 'nanaly-msg nanaly-msg--sys'
      bubble.innerHTML = escapeHtml(
        msg === 'NO_TAVILY'
          ? '还没填 Tavily 的 API Key，联网搜索用不了。去设置里填一个吧。'
          : /Failed to fetch|NetworkError|CORS/i.test(msg)
            ? '连不上接口。可能是网络问题，也可能是这家服务商不允许浏览器直接调用（CORS）。'
            : msg
      )
    } finally {
      busy = false
      sendBtn.disabled = false
      scrollBottom()
    }
  }

  // ---------------- 事件 ----------------

  const openPanel = () => {
    panel.classList.add('is-open')
    launcher.classList.remove('has-news')
    if (typeof hidePoke === 'function') hidePoke()
    if (locked()) showUnlock()
    else if (!body.children.length) renderHistory()
    setTimeout(() => input.focus(), 220)
  }
  const closePanel = () => {
    panel.classList.remove('is-open')
    if (abortCtl) { try { abortCtl.abort() } catch (_) {} }
    abortCtl = null
    stopSpeak()   // 不停的话她会在没有任何可见控件的情况下继续念完整段
  }

  launcher.addEventListener('click', () => {
    panel.classList.contains('is-open') ? closePanel() : openPanel()
  })

  panel.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]')
    if (!btn) return
    const act = btn.dataset.act
    if (act === 'close') closePanel()
    if (act === 'lock') {
      clearSession()
      secrets = { ...EMPTY_SECRETS }
      hasVault() ? showUnlock() : showSetup()
    }
    if (act === 'setup') showKeyUI()
    if (act === 'think') {
      deepThink = !deepThink
      localStorage.setItem(LS_DEEP, deepThink ? '1' : '0')
      syncThinkBtn()
      refreshContext()
      addMsg('sys', deepThink
        ? '深度思考已开。会切到推理模型，答得更稳，但更慢也更费钱。'
        : '深度思考已关，回到常规模型。')
    }
    if (act === 'clear') {
      history = []
      writeLog(history)
      quick.style.display = ''
      renderHistory()
    }
  })

  quick.addEventListener('click', e => {
    const btn = e.target.closest('[data-q]')
    if (!btn) return
    const q = btn.dataset.q
    if (q === 'summary') send('用几条要点总结一下这篇文章，重点讲清楚它到底解决了什么问题。', 'article')
    if (q === 'ask') send('这篇文章讲了什么？挑最关键的两三点说说。', 'article')
    if (q === 'quiz') send(
      '基于这篇文章出 3 道题考我：一道概念题、一道推导或计算题、一道容易踩坑的辨析题。'
      + '一次全部列出来，先不要给答案。等我把答案发给你，你再逐题批改，指出我漏掉或说错的地方。', 'article')
    if (q === 'site') { input.value = '全站搜一下：'; input.focus() }
    if (q === 'web') { input.value = '上网搜：'; input.focus() }
  })

  const modeOf = t => /^上网搜[：:]?/.test(t) ? 'web'
    : /^全站搜一下[：:]?/.test(t) ? 'site'
      : 'article'

  const submit = async () => {
    const t = input.value.trim()
    if (!t || busy) return
    // 能本地认出来的操作直接做，省一次 API 调用
    try {
      if (await tryLocalCommand(t)) { input.value = ''; input.style.height = ''; return }
    } catch (_) { /* 本地没认出来就照常发给模型 */ }
    send(t, modeOf(t))
  }

  sendBtn.addEventListener('click', submit)

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  })

  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = Math.min(input.scrollHeight, 116) + 'px'
  })

  const thinkBtn = panel.querySelector('[data-act="think"]')
  const syncThinkBtn = () => {
    thinkBtn.classList.toggle('is-on', deepThink)
    thinkBtn.title = deepThink ? '深度思考：开（更慢更贵，点一下关掉）' : '深度思考：关'
    // 这里不要顺手调 refreshContext —— 它是下面才声明的 const，
    // 处在暂时性死区里，连 typeof 都会直接抛错（这一点和 var 不一样）。
    // 副标题由调用方在合适的时机自己刷。
  }
  syncThinkBtn()

  // ---------------- 快捷键 ----------------
  // Alt + A 唤起并聚焦，Esc 收起。
  // 想换别的键，改下面这一行的判断即可。
  const typingIn = el => {
    if (!el) return false
    const tag = String(el.tagName || '').toLowerCase()
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable
  }
  document.addEventListener('keydown', e => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && String(e.key).toLowerCase() === 'a') {
      // 正在别的输入框里打字就别抢。macOS 上 Option+A 就是「å」这个字符，
      // 不加这个判断的话，在主题的搜索框里想打 å 会变成弹出面板。
      if (typingIn(e.target) && e.target !== input) return
      e.preventDefault()
      if (panel.classList.contains('is-open')) input.focus()
      else openPanel()
      return
    }
    if (e.key === 'Escape' && panel.classList.contains('is-open')) closePanel()
  })

  // ---------------- 划词提问 ----------------

  const selBtn = el('button', 'nanaly-selbtn', '<i class="fas fa-cat"></i> 问娜娜莉')
  selBtn.type = 'button'
  selBtn.id = 'nanaly-selbtn'
  document.body.appendChild(selBtn)

  let selText = ''
  const hideSel = () => { selBtn.classList.remove('is-on'); selText = '' }

  const maybeShowSel = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hideSel()
    const text = sel.toString().trim()
    if (text.length < 4 || text.length > 1500) return hideSel()

    const box = document.getElementById('article-container')
    if (!box) return hideSel()
    const anchor = sel.anchorNode
    const node = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentNode)
    if (!node || !box.contains(node)) return hideSel()

    selText = text
    const r = sel.getRangeAt(0).getBoundingClientRect()
    const w = 118
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8)
    selBtn.style.left = Math.round(left) + 'px'
    selBtn.style.top = Math.round(r.top + window.scrollY - 42) + 'px'
    selBtn.classList.add('is-on')
  }

  document.addEventListener('mouseup', () => setTimeout(maybeShowSel, 10))
  document.addEventListener('touchend', () => setTimeout(maybeShowSel, 10))
  document.addEventListener('scroll', hideSel, { passive: true })
  document.addEventListener('mousedown', e => { if (!selBtn.contains(e.target)) hideSel() })
  window.addEventListener('pjax:send', hideSel)

  selBtn.addEventListener('click', () => {
    const t = selText
    hideSel()
    try { window.getSelection().removeAllRanges() } catch (_) {}
    if (!t) return
    openPanel()
    input.value = `解释一下这段：\n「${t}」`
    input.dispatchEvent(new Event('input'))
    setTimeout(() => { input.focus(); input.setSelectionRange(0, 0) }, 240)
  })

  // ---------------- 主动冒泡 ----------------
  //
  // 你在一篇文章上待够久、又确实在往下读，她会冒个红点搭一句话。
  // 三条克制原则：每篇最多一次、面板开着就不打扰、说的话跟你正在读的小节有关。

  const POKE_AFTER_MS = Number(window.NANALY_POKE_MS || 100000)   // 停留多久才开口
  const pokedPaths = new Set()
  let pokeTimer = null
  let dwellFrom = 0
  let maxDepth = 0

  const bubble = el('div', 'nanaly-poke')
  bubble.id = 'nanaly-poke'
  document.body.appendChild(bubble)

  const hidePoke = () => bubble.classList.remove('is-on')

  const currentHeading = () => {
    const box = document.getElementById('article-container')
    if (!box) return ''
    const heads = [...box.querySelectorAll('h2, h3')]
    let cur = ''
    for (const h of heads) {
      if (h.getBoundingClientRect().top < window.innerHeight * 0.4) cur = h.textContent.trim()
      else break
    }
    return cur.replace(/^[\d.、\s]+/, '').slice(0, 28)
  }

  const POKE_LINES = [
    h => h ? `[歪着头] 「${h}」这段看了挺久喵，卡住了？` : '[歪着头] 这篇看了挺久喵，要窝帮忙拆一下吗？',
    h => h ? `[尾巴扫过桌面] 「${h}」要不要窝出两道题考考你？` : '[尾巴扫过桌面] 要不要窝出两道题考考你？',
    () => '[从屏幕后探出脑袋] 读到一半了。要窝总结一下前面讲了什么吗？',
    h => h ? `[眯起眼睛] 「${h}」这块窝也留了批注，往下翻能看到 (ovo)` : '[眯起眼睛] 有不懂的直接问窝，别自己硬啃。'
  ]

  const showPoke = () => {
    if (panel.classList.contains('is-open')) return
    const art = currentArticle()
    if (!art) return
    const path = location.pathname
    if (pokedPaths.has(path)) return
    pokedPaths.add(path)

    const h = currentHeading()
    // 用路径长度选一句，同一篇每次都是同一句，不会显得神经质
    const line = POKE_LINES[path.length % POKE_LINES.length](h)
    bubble.textContent = line
    bubble.classList.add('is-on')
    launcher.classList.add('has-news')
    pendingPoke = line
    setTimeout(() => hidePoke(), 12000)
  }

  let pendingPoke = ''

  const resetDwell = () => {
    clearTimeout(pokeTimer)
    dwellFrom = Date.now()
    maxDepth = 0
    hidePoke()
    if (!currentArticle()) return
    pokeTimer = setTimeout(() => {
      // 只在「确实往下读了」的时候才开口 —— 开着页面去泡茶不算
      if (maxDepth >= 0.22 && maxDepth <= 0.94) showPoke()
    }, POKE_AFTER_MS)
  }

  window.addEventListener('scroll', () => {
    const h = document.documentElement
    const denom = (h.scrollHeight - window.innerHeight) || 1
    maxDepth = Math.max(maxDepth, Math.min(1, window.scrollY / denom))
  }, { passive: true })

  bubble.addEventListener('click', () => {
    hidePoke()
    openPanel()
    if (pendingPoke) { addMsg('her', pendingPoke); pendingPoke = '' }
  })

  // 页面切换时更新副标题为当前文章（pjax 不会重新执行本脚本）
  const refreshContext = () => {
    const art = currentArticle()
    if (art) rememberVisit(art.title)
    const base = art ? `正在读：${art.title}` : 'Noimpty 的学习搭子'
    // 深度思考是按 token 计费的推理模型，比常规贵不少。
    // 它是个会记住状态的开关，所以必须让人一眼看见自己开着，别糊里糊涂烧钱。
    subLine.textContent = deepThink ? `深度思考中 · ${base}` : base
    const onPost = !!art
    quick.querySelectorAll('[data-q="summary"], [data-q="ask"]').forEach(b => {
      b.style.display = onPost ? '' : 'none'
    })
  }
  refreshContext()
  resetDwell()
  window.addEventListener('pjax:complete', () => setTimeout(() => { refreshContext(); resetDwell() }, 60))

  // 供控制台调试/换人设用
  window.NANALY = Object.freeze({
    open: openPanel,
    close: closePanel,
    reset: () => { history = []; writeLog(history); renderHistory() },
    lock: () => { clearSession(); secrets = { ...EMPTY_SECRETS }; showUnlock() },
    stopSpeaking: () => stopSpeak(),
    // 日程页要用它往仓库提交。没解锁就返回 null，调用方负责提示。
    githubToken: () => secrets.ghToken || null,
    isLocked: () => locked(),
    requestUnlock: () => { openPanel(); if (locked()) showUnlock(); else showKeyUI() },
    memory: () => JSON.parse(JSON.stringify(memory)),
    forgetMemory: () => { memory = memDefault(); saveMem(); return '她关于你的记忆已清空' },
    poke: () => { pokedPaths.delete(location.pathname); showPoke() },
    deepThink: on => {
      deepThink = !!on
      localStorage.setItem(LS_DEEP, deepThink ? '1' : '0')
      syncThinkBtn()
      refreshContext()
      return deepThink
    },
    forgetKey: () => {
      localStorage.removeItem(LS_VAULT)
      clearSession()
      secrets = { ...EMPTY_SECRETS }
      // 设置面板如果还开着，输入框里仍然是三把明文 key，
      // 而且随手一点「保存并解锁」就把保险箱原样重建了。得把它收掉。
      try { panel.querySelectorAll('.nanaly-setup input').forEach(i => { i.value = '' }) } catch (_) {}
      try { backToChat() } catch (_) {}
      addMsg('sys', 'API Key 已从本机彻底清除')
    }
  })
})()
