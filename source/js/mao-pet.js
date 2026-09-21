/* 页面角落里的 Live2D 看板娘 Mao。
 *
 * 她叫 Mao，不是娜娜莉 —— 娜娜莉是左下角猫爪那个对话窗里的助手，
 * Mao 只是站在角落的人偶，双击她可以把娜娜莉叫出来。两者别混。
 *
 * 模型是 Live2D 官方免费样例 Niziiro Mao（mao_pro），按《Free Material License Agreement》
 * 使用，授权原文在 source/live2d/mao/ReadMe.txt。贴图由 tools/build-live2d-model.mjs
 * 从官方包的 4096² 缩到 2048² 并转 webp —— 原图 7.9 MB，她在页面上只有三百来像素。
 * 三份运行时（Cubism Core / PixiJS / pixi-live2d-display）都自己存在 source/lib/l2d/，
 * 由 tools/vendor-live2d.mjs 搬运，那个脚本会拦下任何会被 fetch 的外部地址。
 *
 * 几个不显眼但要紧的决定：
 *
 * - **按需加载。** 三份运行时 800 KB + 模型 1.5 MB。全站每页都拉两兆三是不能接受的，
 *   所以关着的时候只有这个文件本身（十来 KB），按了开关才去取，取过一次不再重取。
 * - **默认不出现。** 两兆多的东西该由使用者主动打开，不该替他决定。开过一次会记住。
 *   她自己的层级压在对话面板之下，展开聊天时不会被一张脸挡住。
 * - **按设备像素比渲染。** 不这么做的话高分屏上她是糊的 —— 这一条之前踩过。
 * - **气泡是自己画的。** 现成库自带的气泡是另一套审美，跟这站不搭；自己画的这个
 *   用的是站里那套奶白 + 梅紫 + 粉的变量，看着像原本就长在这儿。
 *
 * ────────────────────────────────────────────────────────────────
 * 想调什么，改下面这个 CONFIG 就行，别的地方都是按它来的。
 * ──────────────────────────────────────────────────────────────── */
(() => {
  'use strict'

  const CONFIG = {
    // ── 她是谁 ──
    model: '/live2d/mao/mao_pro.model3.json',
    // 她在画布里占多高（0~1，1 就是顶满）。留一点余量，头发和帽子才不会被切掉
    fill: 0.94,
    anchorX: 0.58,       // 画布里的横向落点，0 最左 1 最右
    idleGroup: 'Idle',   // 待机动作所在的分组名
    tapGroup: '',        // 戳她时随机播的分组。Mao 这六段动作的分组名就是空字符串
    mouthParam: 'ParamA',// 说话时驱动的嘴型参数，取自模型 LipSync 组

    // ── 站在哪、多大 ──
    side: 'right',       // 'right' 或 'left'。左下角被音乐和对话两个按钮占了
    width: 380,          // 画布宽（px）
    height: 480,         // 画布高（px）。比宽高一些，站姿才不挤
    bottom: 0,           // 离底边多远（px）
    edge: 0,             // 离那一侧边缘多远（px）
    widthCapRatio: 0.52, // 窄屏上限：画布不超过视口宽度的这个比例
    zIndex: 8800,        // 压在对话面板（9002）和左下角三个按钮（9003）之下
    maxResolution: 3,    // 渲染分辨率上限（× CSS 像素）。手机普遍 3 倍屏，卡在 2 就是糊的来源

    // ── 怎么互动 ──
    followCursor: true,       // 视线跟着鼠标走（她会转头看你）
    tapToTalk: true,          // 戳她一下：随机动作 + 说一句
    openChatOnDoubleClick: true, // 双击她 = 叫出娜娜莉的对话窗
    doubleTapMs: 320,         // 两下算一次双击的最大间隔。手指比鼠标慢，别调到 250 以下
    defaultVisible: false,    // 头一回来的人看不看得到她

    // ── 她说什么 ──
    // 沿用对话窗口那版人设：自称「我」，毒舌但可靠，偶尔带喵和颜文字。
    // 间隔拉得很开 —— 每隔几秒说一句的看板娘是骚扰，不是陪伴。
    welcome: ['来啦。今天想看点什么喵？', '哟，又见面了 (=^w^=)', '我在这儿等你有一会儿了。'],
    idleLines: [
      '又在看这一页喵？',
      '累了就去翻翻生活那一栏。',
      '双击我，有事直接问。',
      '别熬太晚，明天还要学。',
      '这段卡住了？说出来我帮你理。',
      '左下角那个粉色的按钮能把我关掉，不过你舍得吗 (ovo)'
    ],
    tapLines: ['干嘛戳我。', '喵！', '别闹，我在看你写的东西。', '再戳就收你钱了 (ovo)', '……好吧，再戳一下也行。'],
    speakMs: 4200,       // 一句话停留多久
    idleEveryMs: 70000,  // 隔多久自己说一句
    typeMs: 90           // 打字速度（ms/字），嘴也按这个开合
  }

  // ────────────────────────────────────────────────────────────────

  if (window.MAO_PET) return

  // 键名保持原样。改了的话，已经把她打开过的人一回来又是关的 —— 存的是使用者的选择，
  // 不该因为内部改名就作废。
  const PREF = 'nanaly-pet-visible'
  // 顺序不能换：display 要在加载时就看到 PIXI 和 Live2DCubismCore
  const LIBS = ['/lib/l2d/cubismcore.min.js', '/lib/l2d/pixi.min.js', '/lib/l2d/live2d-display.min.js']

  const pick = list => list[Math.floor(Math.random() * list.length)]
  const read = () => {
    try {
      const saved = localStorage.getItem(PREF)
      return saved === null ? CONFIG.defaultVisible : JSON.parse(saved)
    } catch (_) { return CONFIG.defaultVisible }
  }
  const save = on => { try { localStorage.setItem(PREF, JSON.stringify(on)) } catch (_) {} }

  // 窄屏上她得让位给正文，等比缩
  const stageSize = () => {
    const cap = Math.round((window.innerWidth || CONFIG.width) * CONFIG.widthCapRatio)
    const w = Math.max(150, Math.min(CONFIG.width, cap))
    return { w, h: Math.round(w * CONFIG.height / CONFIG.width) }
  }

  let app = null, model = null, stage = null, bubble = null, button = null
  let loading = null, idleTimer = null, hideTimer = null, typeTimer = null, onMove = null, onResize = null

  const loadScript = src => new Promise((resolve, reject) => {
    const tag = document.createElement('script')
    tag.src = src
    tag.onload = resolve
    tag.onerror = () => reject(new Error('取不到 ' + src))
    document.head.appendChild(tag)
  })

  const loadLibs = () => {
    if (window.PIXI && window.PIXI.live2d && window.Live2DCubismCore) return Promise.resolve()
    if (loading) return loading
    loading = (async () => { for (const src of LIBS) await loadScript(src) })()
      .catch(error => { loading = null; throw error })
    return loading
  }

  const sync = () => {
    if (!button) return
    const on = !!app
    button.setAttribute('aria-pressed', String(on))
    button.title = on ? '把 Mao 收起来' : '把 Mao 放出来'
  }

  // ── 说话 ──

  const stopTalking = () => {
    clearTimeout(hideTimer); clearInterval(typeTimer)
    hideTimer = typeTimer = null
    if (model) { try { model.internalModel.coreModel.setParameterValueById(CONFIG.mouthParam, 0) } catch (_) {} }
  }

  /* 逐字上屏，嘴跟着开合。嘴型值取随机而不是定值 —— 匀速开合看着像机器人，
   * 随机幅度才有说话的样子。 */
  const say = text => {
    if (!bubble) return
    stopTalking()
    bubble.textContent = ''
    bubble.dataset.on = '1'
    let i = 0
    typeTimer = setInterval(() => {
      bubble.textContent = text.slice(0, ++i)
      if (model) {
        try {
          model.internalModel.coreModel.setParameterValueById(
            CONFIG.mouthParam, i < text.length ? 0.4 + Math.random() * 0.6 : 0)
        } catch (_) {}
      }
      if (i >= text.length) { clearInterval(typeTimer); typeTimer = null }
    }, CONFIG.typeMs)
    hideTimer = setTimeout(() => {
      delete bubble.dataset.on
      stopTalking()
    }, CONFIG.speakMs + text.length * CONFIG.typeMs)
  }

  const openChat = () => { window.NANALY?.open?.() }

  // ── 出场 ──

  const enable = async () => {
    if (app || button?.dataset.busy) return
    if (button) button.dataset.busy = '1'
    try {
      await loadLibs()
      const { w, h } = stageSize()

      stage = document.createElement('div')
      stage.id = 'mao-stage'
      stage.dataset.side = CONFIG.side
      stage.style.cssText = `width:${w}px;height:${h}px;bottom:${CONFIG.bottom}px;`
        + `${CONFIG.side}:${CONFIG.edge}px;z-index:${CONFIG.zIndex}`

      bubble = document.createElement('div')
      bubble.id = 'mao-bubble'
      stage.appendChild(bubble)

      const canvas = document.createElement('canvas')
      stage.appendChild(canvas)
      document.body.appendChild(stage)

      app = new window.PIXI.Application({
        view: canvas, width: w, height: h,
        backgroundAlpha: 0, antialias: true,
        /* 不跟着设备像素比走的话，高分屏上她就是糊的。
         * 上限原来是 2 —— 而手机普遍是 3 倍屏，等于她在手机上一直只按
         * 2/3 的分辨率画（实测 390×844@3x 上画布 172×218 CSS，位图只有
         * 344×436，屏幕实际能显示 516×654）。放到 3 补齐这一截。
         * 不取消上限：4 倍屏上按 4 画就是 16 倍填充率，不值。 */
        resolution: Math.min(window.devicePixelRatio || 1, CONFIG.maxResolution),
        autoDensity: true
      })

      model = await window.PIXI.live2d.Live2DModel.from(CONFIG.model, {
        autoHitTest: false, autoFocus: false, idleMotionGroup: CONFIG.idleGroup
      })
      app.stage.addChild(model)
      layout()

      /* 这一行没有的话戳她是没反应的。
       * 库只在 autoHitTest / autoFocus 至少开一个时才把模型设成可交互，
       * 而这两个我都关了 —— 视线跟随自己驱（要跟全页面而不只是这块画布），
       * 命中区也不能用它的：Mao 的 HitArea 只盖住脑袋那一小块，
       * 戳身子不算数。所以自己把 eventMode 打开，按她的包围盒算命中。 */
      model.eventMode = 'static'

      /* 戳一下说句话，戳两下把娜娜莉叫出来 —— 两件事共用这一个处理器。
       *
       * 这里**不能**用 canvas 的 dblclick：触屏上它基本等于不存在（iOS Safari
       * 对 touch 根本不派发 dblclick，安卓那边双击多半先被浏览器当成缩放手势吃掉），
       * 所以手机上双击她一直打不开对话窗。改成自己数 pointertap 的间隔 ——
       * PixiJS 的 pointertap 鼠标和手指都会发，一套代码两边都算数。
       * 配合 CSS 里画布那条 touch-action: manipulation，把浏览器的双击缩放让开。 */
      let lastTap = 0
      model.on('pointertap', () => {
        const now = Date.now()
        const isDouble = now - lastTap <= CONFIG.doubleTapMs
        // 连击只认一次。不清零的话三连点会被数成两次双击，对话窗开两遍
        lastTap = isDouble ? 0 : now

        if (isDouble) {
          if (!CONFIG.openChatOnDoubleClick) return
          // 第一下已经让她开口了，把那句收回去 ——
          // 否则对话窗开了，她头顶还挂着句“干嘛戳我”
          stopTalking()
          if (bubble) delete bubble.dataset.on
          openChat()
          return
        }

        if (!CONFIG.tapToTalk) return
        // 单击不等双击窗口过去就先说 —— 等 320ms 再开口，手感是卡的
        try { model.motion(CONFIG.tapGroup) } catch (_) {}
        say(pick(CONFIG.tapLines))
      })

      /* 视线跟随全页面，而不只是她那块画布 —— 鼠标在文章里划过时她也会转头看，
       * 「养在博客里」的感觉全靠这一条。 */
      if (CONFIG.followCursor) {
        onMove = e => { if (model) model.focus(e.clientX - stage.getBoundingClientRect().left, e.clientY - stage.getBoundingClientRect().top) }
        document.addEventListener('pointermove', onMove, { passive: true })
      }
      onResize = () => layout(true)
      window.addEventListener('resize', onResize)

      say(pick(CONFIG.welcome))
      idleTimer = setInterval(() => say(pick(CONFIG.idleLines)), CONFIG.idleEveryMs)
      requestAnimationFrame(() => stage && (stage.dataset.ready = '1'))
    } catch (error) {
      console.warn('[看板娘]', error && error.message)
      await teardown()
    } finally {
      if (button) delete button.dataset.busy
      sync()
    }
  }

  // 按画布高度等比放，脚底贴着下边缘站住
  const layout = (resize = false) => {
    if (!app || !model || !stage) return
    const { w, h } = stageSize()
    if (resize) {
      stage.style.width = w + 'px'
      stage.style.height = h + 'px'
      app.renderer.resize(w, h)
    }
    const scale = (h * CONFIG.fill) / (model.internalModel.originalHeight || model.height || 1)
    model.scale.set(scale)
    model.anchor.set(0.5, 1)
    model.position.set(w * CONFIG.anchorX, h)
    clipToBody(w, h)
  }

  /* 画布比她大一圈，四周那圈透明的地方也会拦下点击 ——
   * 她站在右下角，那一块正好压着卡片的边。clip-path 把命中判定一并裁掉：
   * 裁外的点击直接穿过去，裁内还是她接着。比监听 pointermove 再改
   * pointer-events 靠谱：触屏上没有“先移过去”这一步。 */
  const clipToBody = (w, h) => {
    const canvas = stage && stage.querySelector('canvas')
    if (!canvas || !model) return
    let box
    try { box = model.getBounds() } catch (_) { return }
    if (!box || !box.width) return
    const pad = 6
    const top = Math.max(0, box.y - pad), left = Math.max(0, box.x - pad)
    const right = Math.max(0, w - (box.x + box.width) - pad)
    const bottom = Math.max(0, h - (box.y + box.height) - pad)
    canvas.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`
  }

  const teardown = async () => {
    stopTalking()
    clearInterval(idleTimer); idleTimer = null
    if (onMove) { document.removeEventListener('pointermove', onMove); onMove = null }
    if (onResize) { window.removeEventListener('resize', onResize); onResize = null }
    try { model?.destroy() } catch (_) {}
    try { app?.destroy(false, { children: true }) } catch (_) {}
    try { stage?.remove() } catch (_) {}
    app = model = stage = bubble = null
  }

  const disable = async () => {
    if (!app) return
    await teardown()
    sync()
  }

  const toggle = async () => {
    const next = !app
    save(next)
    if (next) await enable()
    else await disable()
  }

  const mountToggle = () => {
    const existing = document.getElementById('mao-toggle')
    if (existing) { button = existing; return }
    button = document.createElement('button')
    button.id = 'mao-toggle'
    button.type = 'button'
    button.setAttribute('aria-label', '显示或隐藏看板娘')
    /* 她那顶魔法帽，和左下角另外两个按钮一样是 54×54 的圆。
     *
     * 帽子只有两笔：帽檐是一片闭合的透镜形，帽身是一条开放的线，
     * 两端正好落在帽檐的上弧上 —— 不再画帽身的底边，否则两条线交叉在一起，
     * 26px 下就糊成一团。帽带用填充而不是描边，同样是为了小尺寸下立得住。 */
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
      + '<path d="M7.7 15.3C8.5 10.9 10.4 6.9 12.6 4.7 13.9 3.4 14.8 4 14.4 5.8 13.7 9.2 13.9 12.8 15 15.3"/>'
      + '<path d="M2.6 16.6Q11.2 13.4 19.8 16.6 11.2 19.8 2.6 16.6Z"/>'
      + '<path class="solid" d="M8.7 12.9q2.9 1.05 5.6.05l.3 1.6q-3.1 1.1-6.2 0Z"/>'
      + '<path class="solid" d="M19.9 4.4q.4 1.75 1.75 2.15-1.35.4-1.75 2.15-.4-1.75-1.75-2.15 1.35-.4 1.75-2.15Z"/>'
      + '</svg>'
    button.addEventListener('click', toggle)
    document.body.appendChild(button)
    sync()
  }

  /* pjax 换的是 #body-wrap 里面那一块，挂在 body 下的按钮和她本人都在外面，
   * 照理翻页动不到。照理归照理 —— 主题哪天多换一个选择器，她就会悄无声息地消失，
   * 而开关还亮着。所以每次翻完页对一下：谁掉了就把谁补回来。 */
  const recover = () => {
    mountToggle()
    if (!app || !stage || document.contains(stage)) return
    teardown()
    if (!read()) { sync(); return }
    return enable()
  }

  const boot = () => {
    mountToggle()
    if (read()) enable()
  }

  window.MAO_PET = Object.freeze({
    show: () => { save(true); return enable() },
    hide: () => { save(false); return disable() },
    visible: () => !!app,
    say,
    model: () => model,
    config: () => CONFIG
  })

  document.addEventListener('pjax:complete', recover)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
