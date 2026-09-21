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

    /* ── 她的八张脸 ──
     * 名字是把 expressions/*.exp3.json 里的参数读出来命名的，不是看图猜的：
     *   exp_01 眼睛正常睁开、其余全归零      → 平静（也是复位用的那张）
     *   exp_02 闭眼 + EyeSmile=1             → 笑眯眯
     *   exp_03 只闭眼、不笑                   → 闭眼
     *   exp_04 睁大 1.2 倍 + EyeEffect=1      → 星星眼
     *   exp_05 眉毛内压 + 嘴角向下            → 难过
     *   exp_06 ParamCheek=1                  → 脸红
     *   exp_07 睁大 + 眼球变形 + 嘴角向下     → 为难
     *   exp_08 MouthAngry + MouthAngryLine   → 生气 */
    faces: {
      平静: 'exp_01', 笑: 'exp_02', 闭眼: 'exp_03', 星星眼: 'exp_04',
      难过: 'exp_05', 脸红: 'exp_06', 为难: 'exp_07', 生气: 'exp_08'
    },
    restFace: '平静',    // 一句话说完之后回到哪张脸
    /* 一条实测出来的脾气：待机动作（Idle 组的 mtn_01）是一直循环播着的，
     * 而它动了表情用到的全部 28 个参数。表情是叠在动作之上生效的，所以能看见，
     * 但 EyeOpen 这几个是 Multiply 混合 —— 星星眼的 ×1.2 撞上动作正在眨眼那一帧
     * 就是 0×1.2=0，于是看着成了「笑眯眯」。同一张脸在不同时刻不完全一样，
     * 这是模型自己的做法，不是这边的 bug。 */

    // ── 她说什么 ──
    // 每条写成 ['台词', '表情']，表情名取上面 faces 里的键；只写字符串也行，
    // 那就用 restFace 那张脸。间隔拉得很开 —— 每隔几秒说一句的是骚扰，不是陪伴。
    welcome: [
      ['来啦。今天想看点什么喵？', '笑'],
      ['哟，又见面了 (=^w^=)', '星星眼'],
      ['我在这儿等你有一会儿了。', '难过']
    ],
    idleLines: [
      ['又在看这一页喵？', '闭眼'],
      ['累了就去翻翻生活那一栏。', '笑'],
      ['双击我，有事直接问。', '星星眼'],
      ['别熬太晚，明天还要学。', '生气'],
      ['这段卡住了？说出来我帮你理。', '平静'],
      ['左下角那个粉色的按钮能把我关掉，不过你舍得吗 (ovo)', '脸红']
    ],

    /* ── 她知道自己站在哪一页 ──
     * 栏目不在这里认，走 window.NANALY.sectionOf() —— 那张 SECTIONS 表是娜娜莉
     * 导航用的，抄一份到这儿早晚会和它对不上（左下角三个按钮的坐标就是这么散的）。
     * 这里只按栏目的 url 配台词；配不到就退回上面那组通用的 idleLines。 */
    pageLines: {
      '/': [
        ['从这儿往下翻，能看到他都在学什么。', '笑'],
        ['首页这张图是他挑的，好看吧 (=^w^=)', '星星眼']
      ],
      '/in-class/': [
        ['课内这两门是硬骨头，慢慢啃。', '平静'],
        ['数据结构写到第二章了，后面还长着呢。', '为难']
      ],
      '/extra/': [
        ['课外这条线是他自己挑的，没人逼。', '笑'],
        ['一门一门来，别跳着看。', '闭眼']
      ],
      '/extra/ai-infra/': ['AI Infra 这条线刚铺开，Go 还一行没写呢 (ovo)'],
      '/extra/ai-infra/git/': [
        ['分支就是个 41 字节的文件，知道这个之后好懂多了。', '星星眼'],
        ['冲突不可怕，看清楚共同祖先就行。', '平静']
      ],
      '/extra/ai-infra/linux/': ['命令行这东西，敲熟了比什么都快。'],
      '/life/': [['这一栏轻松点，歇会儿再学。', '笑']],
      '/news/': [['这些是我每周捞回来的，挑着看。', '星星眼']],
      '/schedule/': [['日程排得挺满，今天的做完了吗喵？', '为难']]
    },
    /* ── 按时段换话 ──
     * until 是「几点之前」，24 小时制，本地时间。深夜那档是有意留的：
     * 她这时候只劝你睡，不聊别的。 */
    dayParts: [
      { until: 5, name: '深夜', face: '难过', lines: ['几点了还不睡喵。', '明天起不来我可不管。', '这个点写的代码，明天自己都看不懂。'] },
      { until: 11, name: '早上', face: '笑', lines: ['早喵。今天想学点什么？', '趁脑子还清醒，先啃难的那块。'] },
      { until: 18, name: '下午', face: '平静', lines: ['下午容易困，起来走两步。', '这会儿适合把上午没写完的补掉。'] },
      { until: 24, name: '晚上', face: '闭眼', lines: ['晚上安静，正好写东西。', '别又刷到半夜喵。'] }
    ],

    /* ── 节日 ──
     * 键是 'MM-DD'，只认公历。农历的要另算，现在没接。
     * 想加生日就在这儿加一行 —— 我不知道是哪天，没替你编。 */
    festivals: {
      '01-01': { face: '星星眼', lines: ['新年好喵！今年也一起加油。', '又长一岁了，博客也是。'] },
      '12-25': { face: '笑', lines: ['圣诞快乐喵 (=^w^=)', '今天可以不学，就今天。'] },
      '12-31': { face: '为难', lines: ['今年就剩这几个小时了。', '回头看看年初立的那些 flag 喵。'] }
    },

    /* ── 她记得你上次什么时候来 ──
     * 只用 localStorage，不碰任何被锁住的数据，所以哪怕没解锁也有效。 */
    missYouAfterH: 20,   // 隔多久算「有一阵没见」（小时）
    missLines: [
      ['{隔}没见了，还以为你不来了呢。', '难过'],
      ['{隔}没见。学得怎么样了喵？', '为难'],
      ['哟，{隔}没见 —— 我一直在这儿站着呢。', '闭眼']
    ],

    /* ── 今天的日程 ──
     * 数据来自 /schedule/data.json（加密的），没解锁就拿不到，这时候她不播报。
     * busyLeft：剩这么多件没做就开始摆「为难」那张脸。 */
    busyLeft: 3,
    scheduleLines: {
      发了文章: [['今天有产出喵，给你记一功。', '星星眼'], ['刚发了东西，值得歇一会儿。', '笑']],
      全做完: [['今天的都勾掉了，可以了。', '笑'], ['一件不剩，难得喵 (=^w^=)', '星星眼']],
      还剩: [['今天还有 {剩} 件没做喵。', '为难'], ['{剩} 件挂着呢，先挑最难那件。', '平静']],
      堆着: [['{剩} 件没做，再拖就滚雪球了。', '生气'], ['{剩} 件……要不先做掉一件？', '难过']]
    },

    // 文章页：读页面上的 <h1.post-title>，套进这几句里
    postLines: [
      ['《{题}》，这篇我看过。', '闭眼'],
      ['又在翻《{题}》喵？', '笑'],
      ['《{题}》这篇有点长，慢慢看。', '为难']
    ],
    /* ── 戳哪儿算哪儿 ──
     * 按她包围盒的纵向比例切三段（0 是头顶，1 是脚底）。模型自带的 HitArea
     * 只盖住脑袋那一小块，戳身子不算数，所以这里自己分。
     *
     * 这三段的台词**都不带表情**，是实测之后定的：七段动作每一段都动了表情
     * 用到的全部 28 个参数，而动作 3.5~9.4 秒、气泡才 4.7 秒 —— 戳她的时候
     * 设表情是白设的，截图里她顶着的还是动作自带的脸。
     * 规矩：**播动作的时候，脸归动作管。** 表情只用在不播动作的场合 ——
     * 出场、闲聊、页面台词、双击、闹别扭。 */
    zones: [
      { until: 0.34, name: '头', lines: ['别摸头，帽子要歪了。', '喵！吓我一跳。', '……摸吧摸吧，就一下。'] },
      { until: 0.72, name: '身', lines: ['干嘛戳我。', '别闹，我在看你写的东西。', '再戳就收你钱了 (ovo)'] },
      { until: 1.01, name: '裙', lines: ['喂！往哪儿戳呢。', '再往下就不理你了。', '……你故意的吧。'] }
    ],

    /* ── 戳太多次她会转过头去 ──
     * 2D 模型转不了身，能做的是把头和身子扭到最大再别回来，读起来就是「不理你了」。 */
    sulkAfter: 6,        // 连戳几下开始闹别扭
    sulkWindowMs: 4000,  // 连戳判定：两下之间超过这个就重新数
    sulkMs: 5000,        // 闹多久
    sulkLines: ['不理你了。', '哼。', '自己玩去吧 (ovo)'],

    /* ── 跟着音乐摆 ──
     * 能量取 NOIMPTY_MUSIC_PLAYER.energy()，那是播放器给自己可视化条算的值，
     * 这边只是搭个便车 —— 别再建第二套 AudioContext。
     * 驱动的是头发/帽子/罩袍这些摆动参数，比只晃身子自然得多。 */
    danceWith: [
      ['ParamHairFront', 0.6], ['ParamHairSideL', 1], ['ParamHairSideR', -1],
      ['ParamHairBack', 0.8], ['ParamRibbon', 1], ['ParamHatBrim', 0.5],
      ['ParamHatTop', 0.7], ['ParamRobeL', 1], ['ParamRobeR', -1], ['ParamWing', 0.8]
    ],
    danceBody: 0.45,     // 身体跟着晃的幅度（0 就是只动头发和衣服）
    danceHz: 1.1,        // 摆动快慢
    danceGain: 1.6,      // 能量放大倍数，1 左右太蔫

    /* ── 出声 ──
     * 借娜娜莉那个声音控制器（window.NANALY.voice()）—— 密钥、分句、缓存、打断
     * 都在里面，Mao 自己再建一个就是第二份缓存和第二条取密钥的路。
     *
     * **默认关，而且只在你主动招呼她的时候出声。** TTS 是按次计费的，
     * 她每 70 秒闲聊一句，全接上语音就是每 70 秒烧一次额度。
     * voiceOnIdle 留在这儿是为了写明这个决定，想开自己改，但那个账会很难看。 */
    voiceDefault: false,
    voiceOnIdle: false,
    voiceVolume: 0.85,
    voiceHoldMs: 600,    // 长按帽子按钮多久算「切换出声」
    voiceLines: { on: ['好，我出声喵。', '听得见我吗？'], off: ['那我闭嘴。', '好吧，安静点也行。'] },

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
  let sulkUntil = 0, tapStreak = 0, lastTapAt = 0, greetTimer = null, voiceTimer = null
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
    button.dataset.voice = voiceOn ? 'on' : 'off'
    button.title = (on ? '把 Mao 收起来' : '把 Mao 放出来')
      + '（长按' + (voiceOn ? '让她闭嘴' : '让她出声') + '）'
  }

  // ── 说话 ──

  /* 换一张脸。名字认不出来就什么都不做 —— 与其挂着上一张脸不如别动，
   * 至少不会出现「说着难过的话顶着星星眼」。 */
  const face = name => {
    if (!model) return
    const id = CONFIG.faces[name]
    if (!id) return
    try { model.expression(id) } catch (_) {}
  }

  /* 戳到哪一段了。把指针的纵坐标换算成她包围盒里的比例，再查 CONFIG.zones。
   * 拿不到坐标（比如脚本触发的点击）就当戳在身上。 */
  const zoneAt = e => {
    const mid = CONFIG.zones[Math.min(1, CONFIG.zones.length - 1)]
    try {
      const box = model.getBounds()
      if (!box || !box.height) return mid
      const y = e && e.global ? e.global.y : null
      if (y === null) return mid
      // e.global 和 getBounds() 都是画布内坐标，同一套，直接比
      const t = (y - box.y) / box.height
      return CONFIG.zones.find(z => t < z.until) || CONFIG.zones[CONFIG.zones.length - 1]
    } catch (_) { return mid }
  }

  /* ── 每帧往模型里写参数 ──
   *
   * 挂在 afterMotionUpdate 上，这个时机很要紧：动作和表情都是在它之前算完的，
   * 在这里写的值盖在最上面，不会被下一帧的动作冲掉。挂 beforeMotionUpdate
   * 或者在外面定时写都是白写 —— 动作每帧都会把 128 个参数重新刷一遍。
   *
   * 这里只写两件事，都是「叠加在动作之上」而不是接管：
   *   跟着音乐摆 —— 头发、帽子、罩袍这些摆动参数
   *   闹别扭     —— 把头和身子扭开
   */
  const driveFrame = () => {
    if (!model) return
    const core = model.internalModel && model.internalModel.coreModel
    if (!core) return
    const set = (id, v) => { try { core.setParameterValueById(id, v) } catch (_) {} }

    if (sulkUntil > Date.now()) {
      // 越靠近结束扭得越轻，别在别扭结束那一刻「啪」地弹回来
      const left = Math.min(1, (sulkUntil - Date.now()) / 600)
      set('ParamAngleY', -28 * left)
      set('ParamAngleX', -22 * left)
      set('ParamBodyAngleX', -8 * left)
      set('ParamEyeBallX', -1 * left)
    }

    const energy = musicEnergy()
    if (energy > 0.02) {
      const phase = Date.now() / 1000 * CONFIG.danceHz * Math.PI * 2
      const wave = Math.sin(phase) * Math.min(1, energy * CONFIG.danceGain)
      for (const [id, weight] of CONFIG.danceWith) set(id, wave * weight)
      if (CONFIG.danceBody) {
        set('ParamBodyAngleZ', wave * 6 * CONFIG.danceBody)
        set('ParamAngleZ', wave * 8 * CONFIG.danceBody)
      }
    }
  }

  /* 播放器给它自己的可视化条算好的能量，搭个便车。它没在放、可视化没起来、
   * 或者用户要求减少动效，拿到的都是 0，这边自然就不动。 */
  const musicEnergy = () => {
    try {
      const v = window.NOIMPTY_MUSIC_PLAYER?.energy?.()
      return typeof v === 'number' && v > 0 ? v : 0
    } catch (_) { return 0 }
  }

  const resetMood = () => { sulkUntil = 0; tapStreak = 0; lastTapAt = 0 }

  /* ── 出声 ──
   *
   * 声音控制器是娜娜莉那一个，没解锁 / 没装声音模块时是 null。
   * 她说话的时候嘴跟着动：接上语音之后，嘴的节奏跟的是**真的有没有声音在响**
   * （订阅控制器的状态），而不是打字机打到第几个字。 */
  const VOICE_PREF = 'mao-voice'
  let voiceOn = (() => {
    try {
      const saved = localStorage.getItem(VOICE_PREF)
      return saved === null ? CONFIG.voiceDefault : JSON.parse(saved)
    } catch (_) { return CONFIG.voiceDefault }
  })()
  let voiceSeq = 0, voiceId = null, unsubVoice = null

  const voiceCtl = () => {
    try {
      /* 锁着就别去要声音。控制器本身一直在，但它的密钥在保险箱里 ——
       * 锁着调 speak() 会触发 onNeedKey，把对话窗弹出来问密码。
       * 「戳一下看板娘，结果蹦出个输密码的面板」不是人想要的。 */
      if (window.NOIMPTY_GATE && !window.NOIMPTY_GATE.unlocked()) return null
      return window.NANALY?.voice?.() || null
    } catch (_) { return null }
  }

  const mouth = v => {
    if (!model) return
    try { model.internalModel.coreModel.setParameterValueById(CONFIG.mouthParam, v) } catch (_) {}
  }

  /* 订阅控制器：只认自己那条 id，别把娜娜莉在对话窗里说的话也当成自己在说。 */
  const watchVoice = () => {
    const ctl = voiceCtl()
    if (!ctl || unsubVoice) return
    unsubVoice = ctl.subscribe(state => {
      if (!model) return
      const mine = state && state.id === voiceId
      if (!mine) { if (!typeTimer) mouth(0); return }
      // planning / loading 时还没出声，嘴先别动
      if (state.phase === 'planning' || state.phase === 'loading') { mouth(0); return }
      if (!voiceTimer) {
        voiceTimer = setInterval(() => mouth(0.35 + Math.random() * 0.65), CONFIG.typeMs)
      }
    })
  }

  const stopVoiceMouth = () => {
    clearInterval(voiceTimer); voiceTimer = null
    mouth(0)
  }

  const setVoice = on => {
    voiceOn = !!on
    try { localStorage.setItem(VOICE_PREF, JSON.stringify(voiceOn)) } catch (_) {}
    sync()
    if (model) say(pick(CONFIG.voiceLines[voiceOn ? 'on' : 'off']), { aloud: voiceOn })
    return voiceOn
  }

  const stopTalking = () => {
    clearTimeout(hideTimer); clearInterval(typeTimer)
    hideTimer = typeTimer = null
    stopVoiceMouth()
    // 上一句还在放就掐掉，不然新台词的字和旧句子的声音对不上
    if (voiceId) { try { voiceCtl()?.stop() } catch (_) {} voiceId = null }
  }

  /* 逐字上屏，嘴跟着开合。嘴型值取随机而不是定值 —— 匀速开合看着像机器人，
   * 随机幅度才有说话的样子。 */
  const say = (line, { aloud = false } = {}) => {
    if (!bubble) return
    // 台词可以写成 '一句话'，也可以写成 ['一句话', '表情']
    const [text, mood] = Array.isArray(line) ? line : [line, null]
    stopTalking()
    face(mood || moodFace())

    /* 出声。只有主动招呼她的时候才给 aloud —— 闲聊一律不出声，
     * 那是按次计费的，每 70 秒烧一次额度的账很难看。 */
    const ctl = voiceOn && (aloud || CONFIG.voiceOnIdle) ? voiceCtl() : null
    if (ctl) {
      voiceId = 'mao-' + (++voiceSeq)
      watchVoice()
      try { ctl.speak(text, { id: voiceId }) } catch (_) {}
    }

    bubble.textContent = ''
    bubble.dataset.on = '1'
    let i = 0
    typeTimer = setInterval(() => {
      bubble.textContent = text.slice(0, ++i)
      // 有声音在响的时候，嘴归声音那条线管 —— 两边一起写会打架
      if (model && !voiceTimer) mouth(i < text.length ? 0.4 + Math.random() * 0.6 : 0)
      if (i >= text.length) { clearInterval(typeTimer); typeTimer = null }
    }, CONFIG.typeMs)
    hideTimer = setTimeout(() => {
      delete bubble.dataset.on
      stopTalking()
      // 脸也收回去。不收的话她会一直顶着刚才那张，气泡早没了人还在生气。
      // 收回的是「当前心情」那张，不是固定的平静 —— 今天发了东西她就该一直精神着
      face(moodFace())
    }, CONFIG.speakMs + text.length * CONFIG.typeMs)
  }

  const openChat = () => { window.NANALY?.open?.() }

  /* 出场那一句。优先级：有一阵没见 > 今天的日程 > 普通招呼。
   *
   * 日程要等解密拿回来，所以这里等一下 —— 但最多等 1.5 秒，不能让她杵在那儿
   * 半天不开口。锁着的时候 loadState() 立刻返回 null，这一等是没有的。 */
  const greet = async () => {
    const st = await Promise.race([
      loadState(),
      new Promise(resolve => {
        greetTimer = setTimeout(() => { greetTimer = null; resolve(null) }, 1500)
      })
    ]).catch(() => null)
    // 日程先回来的话那个闹钟还挂着，收掉 —— 不收就是一个没人管的定时器
    if (greetTimer) { clearTimeout(greetTimer); greetTimer = null }
    if (!model) return                   // 等的这一会儿她可能已经被关掉了

    if (awayFor >= CONFIG.missYouAfterH) {
      const [text, mood] = pick(CONFIG.missLines)
      say([text.replace('{隔}', awayText()), mood], { aloud: true })
      return
    }
    const line = st ? scheduleLine() : null
    say(line || pick(CONFIG.welcome), { aloud: true })
  }

  /* ── 她在哪一页 ──
   * 栏目认定借娜娜莉那张 SECTIONS 表（她本来就靠它导航），这边不另存一份。
   * 她没加载好、或者这一页不在表里，就返回 null，调用方退回通用台词。 */
  const whereAmI = () => {
    try { return window.NANALY?.sectionOf?.() || null } catch (_) { return null }
  }

  const postTitle = () => {
    try {
      const h = document.querySelector('h1.post-title')
      const t = h && (h.textContent || '').trim()
      // 太长的标题塞进气泡会撑成一坨，这种就当认不出来
      return t && t.length <= 24 ? t : null
    } catch (_) { return null }
  }

  const rightNow = () => new Date()
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

  /* ── 她上次什么时候来 ── 只碰 localStorage，不受暗号影响。 */
  const LAST_SEEN = 'mao-last-seen'
  let awayFor = 0                        // 这次进来时，距上次多少小时
  const rememberVisit = () => {
    try {
      const prev = Number(localStorage.getItem(LAST_SEEN)) || 0
      awayFor = prev ? (Date.now() - prev) / 3600000 : 0
      localStorage.setItem(LAST_SEEN, String(Date.now()))
    } catch (_) { awayFor = 0 }
  }
  const awayText = () => {
    const d = Math.floor(awayFor / 24)
    if (d >= 1) return d + ' 天'
    return Math.max(1, Math.round(awayFor)) + ' 个小时'
  }

  /* ── 今天的日程 ──
   *
   * 数据只有一处真相：source/_data/schedule.json，发布时整份加密成
   * /schedule/data.json。**没解锁就拿不到** —— 这时候 loadState() 返回 null，
   * 她不播报、也没有「心情」，只闲聊。那是对的，不是坏了。
   *
   * 解密走 NOIMPTY_SEARCH.decryptPayload，和 schedule.js 同一条路 ——
   * 自己再写一份 AES-GCM 解密早晚会和它对不上。 */
  let siteState = null, statePending = null

  const summarize = data => {
    const days = data && data.days
    if (!days || typeof days !== 'object') return null
    const today = Array.isArray(days[ymd(rightNow())]) ? days[ymd(rightNow())] : []
    const done = today.filter(t => t && t.done).length
    return {
      total: today.length,
      done,
      left: today.length - done,
      // 自动判定会把「你发了《…》」写进 autoWhy，等于一份现成的「今天发没发东西」
      published: today.some(t => t && t.done && /^你发了/.test(String(t.autoWhy || '')))
    }
  }

  const loadState = () => {
    if (siteState) return Promise.resolve(siteState)
    if (statePending) return statePending
    try {
      if (window.NOIMPTY_GATE && !window.NOIMPTY_GATE.unlocked()) return Promise.resolve(null)
    } catch (_) { return Promise.resolve(null) }
    statePending = (async () => {
      try {
        const res = await fetch('/schedule/data.json?t=' + Date.now(), { cache: 'no-store' })
        if (!res.ok) return null
        const payload = await res.json()
        const raw = payload && payload.alg === 'AES-GCM'
          ? JSON.parse(await window.NOIMPTY_SEARCH.decryptPayload(payload))
          : payload
        siteState = summarize(raw)
        return siteState
      } catch (_) { return null } finally { statePending = null }
    })()
    return statePending
  }

  /* 默认那张脸跟着站点的真实状况走：今天发了东西就精神，日程堆着就发愁。
   * 拿不到状况（没解锁）就用 CONFIG.restFace，和以前一样。 */
  const moodFace = () => {
    const st = siteState
    if (!st) return CONFIG.restFace
    if (st.published) return '星星眼'
    if (st.total && st.left === 0) return '笑'
    if (st.left >= CONFIG.busyLeft) return '为难'
    return CONFIG.restFace
  }

  const scheduleLine = () => {
    const st = siteState
    if (!st || !st.total) return null
    const group = st.published ? '发了文章'
      : st.left === 0 ? '全做完'
        : st.left >= CONFIG.busyLeft ? '堆着' : '还剩'
    const [text, mood] = pick(CONFIG.scheduleLines[group])
    return [text.replace('{剩}', String(st.left)), mood]
  }

  const festivalToday = () => {
    const d = rightNow()
    const key = String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    return CONFIG.festivals[key] || null
  }

  const dayPartNow = () => {
    const h = rightNow().getHours()
    return CONFIG.dayParts.find(p => h < p.until) || CONFIG.dayParts[CONFIG.dayParts.length - 1]
  }

  /* 这一页、这个时候该说什么。
   *
   * 按优先级一档档往下试，第一个给得出话的赢：
   *   节日   —— 一年就那么几天，压过一切
   *   深夜   —— 「快睡」比「这篇讲合并」要紧，所以排在页面前面
   *   文章   —— 读得出标题就念标题
   *   栏目   —— 这一栏自己的话
   *   时段   —— 早上 / 下午 / 晚上
   *   通用   —— 兜底，保证永远有东西可说
   * 每一档都可能落空（她不在表里、标题太长、这一栏没配话），所以最后那档不能空。 */
  const linesHere = () => {
    const withFace = (lines, face) => lines.map(l => (Array.isArray(l) ? l : [l, face]))

    const fest = festivalToday()
    if (fest) return withFace(fest.lines, fest.face)

    const part = dayPartNow()
    if (part.name === '深夜') return withFace(part.lines, part.face)

    const title = postTitle()
    if (title) return CONFIG.postLines.map(([t, mood]) => [t.replace('{题}', title), mood])

    const here = whereAmI()
    const own = here && CONFIG.pageLines[here.url]
    if (own && own.length) return own

    if (part.lines && part.lines.length) return withFace(part.lines, part.face)
    return CONFIG.idleLines
  }

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

      /* 每帧的额外参数挂在这里。时机是关键：动作和表情都在 afterMotionUpdate
       * 之前算完，所以这里写的值盖在最上面；挂 beforeMotionUpdate 或者在外面
       * 定时写都会被下一帧的动作冲掉（动作每帧重刷 128 个参数）。 */
      try { model.internalModel.on('afterMotionUpdate', driveFrame) } catch (_) {}

      /* 戳一下说句话，戳两下把娜娜莉叫出来 —— 两件事共用这一个处理器。
       *
       * 这里**不能**用 canvas 的 dblclick：触屏上它基本等于不存在（iOS Safari
       * 对 touch 根本不派发 dblclick，安卓那边双击多半先被浏览器当成缩放手势吃掉），
       * 所以手机上双击她一直打不开对话窗。改成自己数 pointertap 的间隔 ——
       * PixiJS 的 pointertap 鼠标和手指都会发，一套代码两边都算数。
       * 配合 CSS 里画布那条 touch-action: manipulation，把浏览器的双击缩放让开。 */
      let lastTap = 0
      model.on('pointertap', e => {
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
          face('星星眼')     // 被叫出来干活了，精神一点
          openChat()
          return
        }

        if (!CONFIG.tapToTalk) return

        // 连着戳：超过 sulkWindowMs 没动静就重新数
        tapStreak = now - lastTapAt <= CONFIG.sulkWindowMs ? tapStreak + 1 : 1
        lastTapAt = now
        if (tapStreak >= CONFIG.sulkAfter) {
          tapStreak = 0
          sulkUntil = now + CONFIG.sulkMs
          say([pick(CONFIG.sulkLines), '生气'], { aloud: true })
          return                       // 闹别扭的时候不播动作，不然刚扭开又被动作掰回来
        }

        try { model.motion(CONFIG.tapGroup) } catch (_) {}
        say(pick(zoneAt(e).lines), { aloud: true })
      })

      /* 视线跟随全页面，而不只是她那块画布 —— 鼠标在文章里划过时她也会转头看，
       * 「养在博客里」的感觉全靠这一条。 */
      if (CONFIG.followCursor) {
        onMove = e => { if (model) model.focus(e.clientX - stage.getBoundingClientRect().left, e.clientY - stage.getBoundingClientRect().top) }
        document.addEventListener('pointermove', onMove, { passive: true })
      }
      onResize = () => layout(true)
      window.addEventListener('resize', onResize)

      greet()
      // 每次到点才算这一页说什么 —— pjax 翻页不会重建她，算早了会一直念旧页面
      idleTimer = setInterval(() => say(pick(linesHere())), CONFIG.idleEveryMs)
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
    clearTimeout(greetTimer); greetTimer = null
    // 订阅挂在娜娜莉那个控制器上，她被收起来之后不退订就是一直挂着的回调
    if (unsubVoice) { try { unsubVoice() } catch (_) {} unsubVoice = null }
    clearInterval(idleTimer); idleTimer = null
    if (onMove) { document.removeEventListener('pointermove', onMove); onMove = null }
    if (onResize) { window.removeEventListener('resize', onResize); onResize = null }
    try { model?.destroy() } catch (_) {}
    try { app?.destroy(false, { children: true }) } catch (_) {}
    try { stage?.remove() } catch (_) {}
    app = model = stage = bubble = null
    // 别留着「正在闹别扭」跨过这一次关闭 —— 下次打开她该是好好的
    resetMood()
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
    bindHold(button)          // 长按切出声。必须在 click 之前挂，它要能拦下那一次 click
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
    config: () => CONFIG,
    // 这会儿她该说哪一组话。测试和调试都用它，省得等 70 秒
    lines: () => linesHere(),
    // 出声开关。不给参数就是问现在开没开
    voice: on => (on === undefined ? voiceOn : setVoice(on))
  })

  /* 长按帽子按钮 = 切换出声。没有给它单独一个按钮 —— 左下角那一摞已经三个了，
   * 手机上再加一格就该挤到正文里去。长按开始的那一下会吞掉随后的 click，
   * 否则松手时会顺带把她关掉。 */
  const bindHold = target => {
    let timer = null, fired = false
    const start = () => {
      fired = false
      clearTimeout(timer)
      timer = setTimeout(() => { fired = true; timer = null; setVoice(!voiceOn) }, CONFIG.voiceHoldMs)
    }
    const cancel = () => { clearTimeout(timer); timer = null }
    target.addEventListener('pointerdown', start)
    target.addEventListener('pointerup', cancel)
    target.addEventListener('pointerleave', cancel)
    target.addEventListener('pointercancel', cancel)
    target.addEventListener('click', e => {
      if (!fired) return
      fired = false
      e.preventDefault(); e.stopImmediatePropagation()   // 长按过了就不再当成开关
    }, true)
  }

  rememberVisit()
  document.addEventListener('pjax:complete', recover)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
