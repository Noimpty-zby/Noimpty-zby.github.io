/* 页面角落里的 Live2D 看板娘 Mao。
 *
 * 她叫 Mao，不是娜娜莉 —— 娜娜莉是左下角猫爪那个对话窗里的助手，
 * Mao 只是站在角落的人偶，双击她可以把娜娜莉叫出来。两者别混。
 *
 * 模型是 Live2D 官方免费样例 Niziiro Mao（mao_pro），按《Free Material License Agreement》
 * 使用，授权原文在 source/live2d/mao/ReadMe.txt。贴图由 tools/assets/build-live2d-model.mjs
 * 从官方包的 4096² 缩到 2048² 并转 webp —— 原图 7.9 MB，她在页面上只有三百来像素。
 * 三份运行时（Cubism Core / PixiJS / pixi-live2d-display）都自己存在 source/lib/l2d/，
 * 由 tools/assets/vendor-live2d.mjs 搬运，那个脚本会拦下任何会被 fetch 的外部地址。
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
        ['课程笔记会跟着实际更新慢慢积累。', '为难']
      ],
      '/extra/': [
        ['课外这条线是他自己挑的，没人逼。', '笑'],
        ['一门一门来，别跳着看。', '闭眼']
      ],
      '/extra/ai-infra/': ['AI Infra 从语言到系统，可以沿着课程卡片继续看。'],
      '/extra/ai-infra/git/': [
        ['分支就是个 41 字节的文件，知道这个之后好懂多了。', '星星眼'],
        ['冲突不可怕，看清楚共同祖先就行。', '平静']
      ],
      '/extra/ai-infra/linux/': ['命令行这东西，敲熟了比什么都快。'],
      '/life/': [['这一栏轻松点，歇会儿再学。', '笑']],
      '/news/': [['这里按日期整理资讯，挑感兴趣的看。', '星星眼']],
      '/schedule/': [['打开日程，可以看看今天的安排喵。', '为难']]
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
     * 1 月 1 日那条是元旦 + 他的生日，同一天。 */
    festivals: {
      '01-01': { face: '星星眼', lines: ['生日快乐喵！！(=^w^=)', '新年好，顺便 —— 生日快乐。', '一年一度，今天你最大。'] },
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
      ['正在看《{题}》喵。', '闭眼'],
      ['又在翻《{题}》喵？', '笑'],
      ['《{题}》有不明白的地方，可以选中文字问我。', '为难']
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
      return saved === null ? CONFIG.defaultVisible : JSON.parse(saved) === true
    } catch (_) { return CONFIG.defaultVisible }
  }
  const save = on => { try { localStorage.setItem(PREF, JSON.stringify(on)) } catch (_) {} }

  const SETTINGS_PREF = 'mao-settings-v1'
  const defaults = { side: CONFIG.side, size: 'medium', bottomRatio: 0, compact: false,
    autoCompact: true, voice: CONFIG.voiceDefault, chatSync: true, idleSeconds: CONFIG.idleEveryMs / 1000,
    quiet: false, power: 'auto' }
  const normalize = (patch, base = defaults) => {
    const next = { ...base }
    if (!patch || typeof patch !== 'object') return next
    for (const key of ['compact', 'autoCompact', 'voice', 'chatSync', 'quiet']) {
      if (typeof patch[key] === 'boolean') next[key] = patch[key]
    }
    for (const [key, choices] of Object.entries({ side: ['left', 'right'],
      size: ['small', 'medium', 'large'], power: ['auto', 'saving'], idleSeconds: [0, 70, 150, 300] })) {
      if (choices.includes(patch[key])) next[key] = patch[key]
    }
    if (Number.isFinite(patch.bottomRatio)) next.bottomRatio = Math.max(0, Math.min(1, patch.bottomRatio))
    return next
  }
  let settings = (() => {
    try {
      const data = JSON.parse(localStorage.getItem(SETTINGS_PREF) || 'null')
      const migrated = { ...defaults, voice: JSON.parse(localStorage.getItem('mao-voice') || 'false') === true }
      return normalize(data, migrated)
    } catch (_) { return { ...defaults } }
  })()
  let controls = null, status = { phase: 'idle', message: 'Mao 已收起' }
  let compactOverride = false, cancelModelLoad = null, dragCleanup = null
  let speech = null, mouthLevel = 0, lastFace = '', suppressTapUntil = 0
  let chat = { phase: 'idle', turnId: '', text: '' }, chatTurn = '', celebratedAt = 0
  let motionQuery = null, onPowerChange = null, sharedFPS = null
  let pendingModels = 0
  const modelTextures = new Set()
  const compactNow = () => settings.compact || (settings.autoCompact && !compactOverride && (window.innerWidth || 1440) <= 560)
  const reducedMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch (_) { return false } }
  const savingPower = () => settings.power === 'saving' || reducedMotion() || compactNow()
    || !!window.navigator?.connection?.saveData
  const chatBusy = () => settings.chatSync && ['thinking', 'streaming'].includes(chat.phase)
  const speechBusy = () => !!speech && ['planning', 'loading', 'playing', 'paused'].includes(speech.phase)
  const occupied = () => chatBusy() || speechBusy()
  const setStatus = (phase, message) => { status = { phase, message }; sync() }

  // 窄屏可以收成头像，展开后仍按视口等比缩放。
  const stageSize = () => {
    const cap = Math.round((window.innerWidth || CONFIG.width) * CONFIG.widthCapRatio)
    if (compactNow()) return { w: 88, h: 88 }
    const target = CONFIG.width * ({ small: 0.75, medium: 1, large: 1.18 }[settings.size])
    const heightCap = Math.max(120, (window.innerHeight || 900) - 32) * CONFIG.width / CONFIG.height
    const w = Math.min(Math.max(150, Math.min(target, cap)), heightCap)
    return { w: Math.round(w), h: Math.round(w * CONFIG.height / CONFIG.width) }
  }

  let app = null, model = null, stage = null, bubble = null, button = null
  let lifecycle = 0, enableTask = null
  let sulkUntil = 0, tapStreak = 0, lastTapAt = 0, greetTimer = null, voiceTimer = null
  let loading = null, idleTimer = null, hideTimer = null, typeTimer = null, onMove = null, onResize = null, onVisibility = null

  const loadScript = src => new Promise((resolve, reject) => {
    const tag = document.createElement('script')
    tag.src = src
    let settled = false
    const finish = error => {
      if (settled) return
      settled = true; clearTimeout(timer); tag.onload = tag.onerror = null
      if (error) { tag.remove(); reject(error) } else resolve()
    }
    const timer = setTimeout(() => finish(new Error('运行时加载超时，请重试')), 20000)
    tag.onload = () => finish()
    tag.onerror = () => finish(new Error('取不到 ' + src))
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
    const on = !!model
    button.setAttribute('aria-pressed', String(on))
    button.dataset.voice = voiceOn ? 'on' : 'off'
    button.dataset.status = status.phase
    button.setAttribute('aria-busy', String(status.phase === 'loading'))
    controls?.refresh()
    button.title = (status.phase === 'error' ? status.message + '（点旁边齿轮可重试）'
      : status.phase === 'loading' ? '正在加载 Mao，再点一次可取消'
        : on ? '把 Mao 收起来' : '把 Mao 放出来')
      + '（长按' + (voiceOn ? '让她闭嘴' : '让她出声') + '）'
  }

  // ── 说话 ──

  /* 换一张脸。名字认不出来就什么都不做 —— 与其挂着上一张脸不如别动，
   * 至少不会出现「说着难过的话顶着星星眼」。 */
  const face = name => {
    if (!model) return
    const id = CONFIG.faces[name]
    if (!id || lastFace === id) return
    lastFace = id
    try { Promise.resolve(model.expression(id)).catch(() => {}) } catch (_) {}
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

    updateSpeechMouth()
    if (!occupied() && sulkUntil > Date.now()) {
      // 越靠近结束扭得越轻，别在别扭结束那一刻「啪」地弹回来
      const left = Math.min(1, (sulkUntil - Date.now()) / 600)
      set('ParamAngleY', -28 * left)
      set('ParamAngleX', -22 * left)
      set('ParamBodyAngleX', -8 * left)
      set('ParamEyeBallX', -1 * left)
    }

    const energy = occupied() || savingPower() ? 0 : musicEnergy()
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
  let voiceOn = settings.voice
  let voiceSeq = 0, voiceId = null, unsubVoice = null, voiceHandler = null

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

  const emotionFace = state => {
    const emotion = String(state.emotion || '').toLowerCase()
    const intensity = Number(state.intensity)
    if (Number.isFinite(intensity) && intensity < 0.25) return '平静'
    return ({ joy: '笑', sadness: '难过', comfort: '闭眼', surprise: '星星眼', serious: '平静',
      embarrassed: '脸红', teasing: '笑', annoyed: '生气', happy: '笑', cheerful: '笑', excited: '星星眼', sad: '难过',
      angry: '生气', shy: '脸红', concerned: '为难', worried: '为难',
      soothing: '闭眼', calm: '平静', neutral: '平静', curious: '星星眼' })[emotion] || '平静'
  }
  const updateSpeechMouth = () => {
    if (!speech || speech.phase !== 'playing' || document.hidden) {
      if (!typeTimer) mouth(0)
      return
    }
    let level = null
    try { level = voiceCtl()?.energy?.(speech.id) ?? null } catch (_) {}
    // 不支持波形分析时只在真实 playing 阶段使用轻微周期动画。
    const target = level === null ? 0.18 + 0.18 * (1 + Math.sin(Date.now() / 85))
      : Math.max(0, Math.min(1, Number(level) * 3.2 || 0))
    mouthLevel += (target - mouthLevel) * (target > mouthLevel ? 0.65 : 0.45)
    mouth(mouthLevel < 0.015 ? 0 : mouthLevel)
  }
  const showBubble = text => {
    if (!bubble) return
    clearTimeout(hideTimer); clearInterval(typeTimer); hideTimer = typeTimer = null
    bubble.textContent = Array.from(String(text || '')).slice(0, 180).join('')
    bubble.dataset.on = '1'
  }
  const settleBubble = () => {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      hideTimer = null
      if (occupied()) return
      if (bubble) delete bubble.dataset.on
      face(moodFace())
    }, CONFIG.speakMs)
  }
  const watchVoice = () => {
    const ctl = voiceCtl()
    if (!ctl) return
    if (!voiceHandler) voiceHandler = state => {
      if (!model || document.hidden) return
      if (!stateAllowed()) {
        speech = null; stopVoiceMouth()
        if (bubble) delete bubble.dataset.on
        return
      }
      const follows = state && (state.id === voiceId || (settings.chatSync && state.priority !== 'pet'))
      if (!follows) {
        const previous = speech
        speech = null; stopVoiceMouth()
        if (previous && !chatBusy()) { face(moodFace()); settleBubble() }
        return
      }
      speech = { ...state }
      if (state.phase !== 'playing') {
        stopVoiceMouth()
        if (['ended', 'idle', 'error'].includes(state.phase)) {
          speech = null
          if (!chatBusy()) { face(moodFace()); settleBubble() }
        }
        return
      }
      face(emotionFace(state))
      if (settings.chatSync && state.id !== voiceId && state.text) showBubble(state.text)
      if (!voiceTimer) voiceTimer = setInterval(updateSpeechMouth, CONFIG.typeMs)
      updateSpeechMouth()
    }
    if (!unsubVoice) unsubVoice = ctl.subscribe(voiceHandler)
    // 出场、前台恢复和重开聊天联动时，控制器可能已在播放，不会再发 playing。
    voiceHandler(ctl.state?.() || null)
  }
  const stopVoiceMouth = () => {
    clearInterval(voiceTimer); voiceTimer = null; mouthLevel = 0
    mouth(0)
  }

  const setVoice = on => {
    voiceOn = !!on
    if (!voiceOn) stopTalking()
    settings.voice = voiceOn
    persistSettings()
    try { localStorage.setItem(VOICE_PREF, JSON.stringify(voiceOn)) } catch (_) {}
    sync()
    if (model) say(pick(CONFIG.voiceLines[voiceOn ? 'on' : 'off']), { aloud: voiceOn })
    return voiceOn
  }

  const stopTalking = () => {
    clearTimeout(hideTimer); clearInterval(typeTimer)
    hideTimer = typeTimer = null
    if (!speech || speech.id === voiceId) { speech = null; stopVoiceMouth() }
    // 上一句还在放就掐掉，不然新台词的字和旧句子的声音对不上
    if (voiceId) {
      try { const ctl = voiceCtl(); if (ctl?.state()?.id === voiceId) ctl.stop() } catch (_) {}
      voiceId = null
    }
  }

  /* 逐字上屏，嘴跟着开合。嘴型值取随机而不是定值 —— 匀速开合看着像机器人，
   * 随机幅度才有说话的样子。 */
  const say = (line, { aloud = false } = {}) => {
    if (!bubble || occupied()) return
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
      try { Promise.resolve(ctl.speak(text, { id: voiceId, priority: 'pet' })).catch(() => {}) } catch (_) {}
    }

    bubble.textContent = ''
    bubble.dataset.on = '1'
    let i = 0
    typeTimer = setInterval(() => {
      bubble.textContent = text.slice(0, ++i)
      // 有声音在响的时候，嘴归声音那条线管 —— 两边一起写会打架
      if (model && !voiceId && !voiceTimer) mouth(i < text.length ? 0.4 + Math.random() * 0.6 : 0)
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
  const greet = async (version) => {
    const st = await Promise.race([
      loadState(),
      new Promise(resolve => {
        greetTimer = setTimeout(() => { greetTimer = null; resolve(null) }, 1500)
      })
    ]).catch(() => null)
    // 日程先回来的话那个闹钟还挂着，收掉 —— 不收就是一个没人管的定时器
    if (version !== lifecycle) return
    if (greetTimer) { clearTimeout(greetTimer); greetTimer = null }
    if (!model || document.hidden || settings.quiet || occupied()) return // 等的这一会儿她可能已经被关掉了

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
  let siteState = null, statePending = null, stateRaw = null, stateDay = '', stateVersion = 0
  const stateAllowed = () => {
    try { return !window.NOIMPTY_GATE || window.NOIMPTY_GATE.unlocked() } catch (_) { return false }
  }
  const clearState = () => { stateVersion++; siteState = stateRaw = statePending = null; stateDay = '' }

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

  /* 摘要是按「今天」算的。标签页开着跨过午夜，昨天那份就不作数了 ——
   * 原始数据还在手里，重算一遍即可，不用再取一次。
   * 读状态的地方都得先过这里，只在 loadState 里查是不够的：
   * moodFace() 是直接读 siteState 的，它才是跨夜之后最容易挂着旧脸的地方。 */
  const freshState = () => {
    if (!stateAllowed()) { clearState(); return null }
    if (siteState && stateDay !== ymd(rightNow())) {
      stateDay = ymd(rightNow())
      siteState = summarize(stateRaw)
    }
    return siteState
  }

  const loadState = () => {
    if (!stateAllowed()) { clearState(); return Promise.resolve(null) }
    const snapshot = window.NOIMPTY_SCHEDULE?.snapshot?.()
    if (snapshot) { stateRaw = snapshot; stateDay = ymd(rightNow()); siteState = summarize(snapshot) }
    if (freshState()) return Promise.resolve(siteState)
    if (statePending) return statePending
    try {
      if (window.NOIMPTY_GATE && !window.NOIMPTY_GATE.unlocked()) return Promise.resolve(null)
    } catch (_) { return Promise.resolve(null) }
    const version = stateVersion
    const job = Promise.resolve().then(async () => {
      try {
        const res = await fetch('/schedule/data.json?t=' + Date.now(), { cache: 'no-store' })
        if (!res.ok) return null
        const payload = await res.json()
        const raw = payload && payload.alg === 'AES-GCM'
          ? JSON.parse(await window.NOIMPTY_SEARCH.decryptPayload(payload))
          : payload
        if (version !== stateVersion || !stateAllowed()) { if (!stateAllowed()) clearState(); return null }
        stateRaw = raw
        stateDay = ymd(rightNow())
        siteState = summarize(raw)
        return siteState
      } catch (_) { return null } finally { if (statePending === job) statePending = null }
    })
    statePending = job
    return job
  }

  /* 默认那张脸跟着站点的真实状况走：今天发了东西就精神，日程堆着就发愁。
   * 拿不到状况（没解锁）就用 CONFIG.restFace，和以前一样。 */
  const moodFace = () => {
    const st = freshState()
    if (!st) return CONFIG.restFace
    if (st.published) return '星星眼'
    if (st.total && st.left === 0) return '笑'
    if (st.left >= CONFIG.busyLeft) return '为难'
    return CONFIG.restFace
  }

  const scheduleLine = () => {
    const st = freshState()
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

    const title = stateAllowed() ? postTitle() : null
    if (title) return CONFIG.postLines.map(([t, mood]) => [t.replace('{题}', title), mood])

    const here = whereAmI()
    if (here?.url === '/schedule/' && stateAllowed()) {
      const line = scheduleLine()
      if (line) return [line]
      if (freshState()) return [['今天还没有安排任务，可以打开日程添加。', '平静']]
    }
    const progress = progressLines()
    if (progress.length) return progress
    const own = here && CONFIG.pageLines[here.url]
    if (own && own.length) return own

    if (part.lines && part.lines.length) return withFace(part.lines, part.face)
    return CONFIG.idleLines
  }

  // 读取构建时生成的真实课程卡片与文章列表，不把篇数当作已学章节数。
  const progressLines = () => {
    if (!stateAllowed()) return []
    try {
      const cards = Array.from(document.querySelectorAll('.noimpty-track-card'))
      const lines = cards.map(card => {
        const title = card.querySelector('h3')?.textContent?.trim()
        const stat = card.querySelector('.noimpty-track-card__stat')?.textContent || ''
        const count = stat.match(/已写\s*(\d+)\s*篇/)
        return title && count ? [`${title.slice(0, 40)}已经记录 ${count[1]} 篇笔记喵。`, '笑'] : null
      }).filter(Boolean)
      if (lines.length) return lines
      const grid = document.querySelector('.noimpty-post-grid[data-section]')
      if (grid) return [[`这一栏目前有 ${grid.querySelectorAll('.noimpty-post-card').length} 篇笔记，可以挑一篇继续看。`, '平静']]
    } catch (_) {}
    return []
  }
  const persistSettings = () => {
    try { localStorage.setItem(SETTINGS_PREF, JSON.stringify(settings)) } catch (_) {}
  }
  const restartIdle = () => {
    clearInterval(idleTimer); idleTimer = null
    if (!model || document.hidden || settings.quiet || !settings.idleSeconds) return
    idleTimer = setInterval(() => {
      watchVoice()
      if (!occupied()) say(pick(linesHere()))
    }, settings.idleSeconds * 1000)
  }
  const applyPower = () => {
    const fps = savingPower() ? 24 : 60
    if (app?.ticker) app.ticker.maxFPS = fps
    const shared = window.PIXI?.Ticker?.shared
    if (shared) { if (sharedFPS === null) sharedFPS = shared.maxFPS; shared.maxFPS = fps }
    if (stage) stage.dataset.power = fps === 24 ? 'saving' : 'auto'
  }
  const configure = patch => {
    const before = settings
    settings = normalize(patch, settings); voiceOn = settings.voice
    if (patch && Object.hasOwn(patch, 'autoCompact')) compactOverride = false
    persistSettings()
    try { localStorage.setItem(VOICE_PREF, JSON.stringify(voiceOn)) } catch (_) {}
    if (!settings.chatSync && before.chatSync) {
      chat = { phase: 'idle', turnId: '', text: '' }
      if (speech?.id !== voiceId) { speech = null; stopVoiceMouth() }
      if (bubble) delete bubble.dataset.on
    }
    if (!voiceOn && before.voice) stopTalking()
    if (settings.quiet && !before.quiet && !occupied()) {
      stopTalking(); if (bubble) delete bubble.dataset.on
    }
    layout(true); applyPower(); restartIdle(); watchVoice(); sync()
    return { ...settings }
  }
  const onChatState = event => {
    if (!settings.chatSync || !model) return
    const next = event?.detail || {}
    if (document.hidden) {
      if (next.phase === 'thinking') chatTurn = String(next.turnId || '')
      chat = { phase: next.phase, turnId: String(next.turnId || ''), text: '' }
      return
    }
    if (!stateAllowed()) {
      chat = { phase: 'idle', turnId: '', text: '' }; stopTalking()
      if (bubble) delete bubble.dataset.on
      return
    }
    if (!['thinking', 'streaming', 'complete', 'cancelled', 'error', 'idle'].includes(next.phase)) return
    const id = String(next.turnId || '')
    if (next.phase === 'thinking') {
      stopTalking(); resetMood(); chatTurn = id
    } else if (id && chatTurn && id !== chatTurn) return
    chat = { phase: next.phase, turnId: id, text: String(next.text || '').slice(-180) }
    watchVoice()
    if (speech?.phase === 'playing') return
    const phases = { thinking: ['在想了喵…', '为难'], streaming: [chat.text || '正在整理回答…', '平静'],
      complete: [chat.text || '回答好了喵。', '笑'], cancelled: ['好，先停在这里。', '平静'],
      error: ['这次没有顺利完成，可以回到对话里重试。', '难过'] }
    if (next.phase === 'idle') {
      chatTurn = ''; if (bubble) delete bubble.dataset.on
      stopVoiceMouth(); face(moodFace()); return
    }
    const [text, mood] = phases[next.phase]
    showBubble(text); face(mood)
    if (!chatBusy()) settleBubble()
  }
  const onScheduleUpdated = event => {
    if (!stateAllowed()) { clearState(); return }
    const before = freshState()
    const data = event?.detail
    if (!data?.days || typeof data.days !== 'object') return
    stateVersion++
    // 保存快照，防止事件发送者之后原地改动数据。
    try { stateRaw = JSON.parse(JSON.stringify({ days: data.days })) } catch (_) { return }
    stateDay = ymd(rightNow()); siteState = summarize(stateRaw); statePending = null
    if (!model || occupied() || document.hidden) return
    face(moodFace())
    const completed = before?.left > 0 && siteState?.total > 0 && siteState.left === 0
    const published = before && !before.published && siteState?.published
    if ((completed && data.source === 'edit' || published && data.source !== 'load')
      && !settings.quiet && Date.now() - celebratedAt > 60000) {
      celebratedAt = Date.now()
      say([published ? '今天又留下了一篇记录喵。' : '今天的任务都完成了喵，歇一会儿吧。', '星星眼'])
    }
  }
  const action = (name, options) => {
    if (name === 'schedule') {
      if (window.pjax?.loadUrl) window.pjax.loadUrl('/schedule/')
      else window.location.assign('/schedule/')
      return true
    }
    const run = window.NANALY?.contextAction
    if (!run) { say(['助手还没有加载好，请稍后再试。', '为难']); return false }
    return Promise.resolve(run(name, options))
  }
  const bindDrag = canvas => {
    let drag = null
    const down = event => {
      if (event.button != null && event.button !== 0) return
      const box = stage.getBoundingClientRect()
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
        left: box.left, top: box.top, moved: false }
      canvas.setPointerCapture?.(event.pointerId)
    }
    const move = event => {
      if (!drag || event.pointerId !== drag.id) return
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y
      if (!drag.moved && Math.hypot(dx, dy) < 7) return
      drag.moved = true; event.preventDefault()
      const { w, h } = stageSize()
      stage.dataset.dragging = '1'
      stage.style.right = 'auto'; stage.style.bottom = 'auto'
      stage.style.left = Math.max(0, Math.min((window.innerWidth || w) - w, drag.left + dx)) + 'px'
      stage.style.top = Math.max(0, Math.min((window.innerHeight || 900) - h, drag.top + dy)) + 'px'
    }
    const up = event => {
      if (!drag || event.pointerId !== drag.id) return
      const was = drag; drag = null
      canvas.releasePointerCapture?.(event.pointerId)
      if (!was.moved) return
      suppressTapUntil = Date.now() + 400; delete stage.dataset.dragging
      const { w, h } = stageSize(), vh = window.innerHeight || 900
      const left = Math.max(0, Math.min((window.innerWidth || w) - w, was.left + event.clientX - was.x))
      const top = Math.max(0, Math.min(vh - h, was.top + event.clientY - was.y))
      configure({ side: left + w / 2 < (window.innerWidth || w) / 2 ? 'left' : 'right',
        bottomRatio: Math.max(0, vh - h - top) / Math.max(1, vh - h - 16) })
    }
    const cancel = event => {
      if (!drag || event.pointerId !== drag.id) return
      drag = null; suppressTapUntil = Date.now() + 400
      delete stage.dataset.dragging; layout(true)
    }
    const keys = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); controls?.showActions()
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault()
        configure(event.key === 'ArrowLeft' || event.key === 'ArrowRight'
          ? { side: event.key === 'ArrowLeft' ? 'left' : 'right' }
          : { bottomRatio: settings.bottomRatio + (event.key === 'ArrowUp' ? 0.05 : -0.05) })
      }
    }
    const menu = event => { event.preventDefault(); controls?.showActions() }
    const lost = event => {
      event.preventDefault(); teardown().then(() => setStatus('error', '画面连接中断，请重试加载'))
    }
    const bindings = { pointerdown: down, pointermove: move, pointerup: up,
      pointercancel: cancel, lostpointercapture: cancel, keydown: keys, contextmenu: menu, webglcontextlost: lost }
    for (const [type, fn] of Object.entries(bindings)) canvas.addEventListener(type, fn)
    dragCleanup = () => { for (const [type, fn] of Object.entries(bindings)) canvas.removeEventListener(type, fn); drag = null }
  }
  // Pixi 按 URL 共享贴图；取消后的旧加载不能销毁新实例仍在使用的贴图。
  const rememberTextures = loaded => { for (const texture of loaded?.textures || []) modelTextures.add(texture) }
  const releaseTextures = () => {
    if (model || pendingModels) return
    for (const texture of modelTextures) { try { texture.destroy(true) } catch (_) {} }
    modelTextures.clear()
  }
  const retireModel = loaded => {
    rememberTextures(loaded)
    try { loaded?.destroy({ children: true, texture: false, baseTexture: false }) } catch (_) {}
  }
  const loadModel = () => new Promise((resolve, reject) => {
    pendingModels++
    let settled = false
    const finish = (error, loaded) => {
      if (settled) { if (loaded) retireModel(loaded); releaseTextures(); return }
      settled = true; clearTimeout(timer); cancelModelLoad = null
      if (error) reject(error); else resolve(loaded)
    }
    const timer = setTimeout(() => finish(new Error('模型加载超时，请重试')), 30000)
    cancelModelLoad = () => finish(new Error('已取消加载'))
    Promise.resolve().then(() => window.PIXI.live2d.Live2DModel.from(CONFIG.model, {
      autoHitTest: false, autoFocus: false, idleMotionGroup: CONFIG.idleGroup
    })).then(loaded => {
      pendingModels--; rememberTextures(loaded); finish(null, loaded)
    }, error => { pendingModels--; finish(error); releaseTextures() })
  })

  // ── 出场 ──

  const enable = () => {
    if (enableTask) return enableTask.then(() => read() ? enable() : undefined)
    if (app) return Promise.resolve()
    const version = ++lifecycle
    if (button) button.dataset.busy = '1'
    setStatus('loading', '正在加载 Mao…')
    const job = (async () => {
    try {
      await loadLibs()
      if (version !== lifecycle) return
      const { w, h } = stageSize()

      stage = document.createElement('div')
      stage.id = 'mao-stage'
      stage.dataset.side = settings.side
      stage.style.cssText = `width:${w}px;height:${h}px;bottom:${CONFIG.bottom}px;`
        + `${CONFIG.side}:${CONFIG.edge}px;z-index:${CONFIG.zIndex}`

      bubble = document.createElement('div')
      bubble.id = 'mao-bubble'
      bubble.setAttribute('role', 'status')
      bubble.setAttribute('aria-live', 'polite')
      stage.appendChild(bubble)

      const canvas = document.createElement('canvas')
      canvas.tabIndex = 0
      canvas.setAttribute('role', 'button')
      canvas.setAttribute('aria-label', 'Mao：双击打开聊天，右键或按回车打开快捷操作，方向键移动位置')
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

      const loaded = await loadModel()
      if (version !== lifecycle) { retireModel(loaded); releaseTextures(); return }
      model = loaded
      app.stage.addChild(model)
      layout()
      bindDrag(canvas); watchVoice(); applyPower()
      setStatus('ready', 'Mao 已就绪')

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
       * 画布使用 touch-action: none 支持触摸拖动；正文区域仍按原方式滚动。 */
      let lastTap = 0
      model.on('pointertap', e => {
        const now = Date.now()
        if (now < suppressTapUntil || stage?.dataset.dragging === '1') return
        if (compactNow()) {
          compactOverride = true; configure({ compact: false }); return
        }
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

        if (occupied()) { controls?.showActions(); return }
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

        try { Promise.resolve(model.motion(CONFIG.tapGroup)).catch(() => {}) } catch (_) {}
        say(pick(zoneAt(e).lines), { aloud: true })
      })

      /* 视线跟随全页面，而不只是她那块画布 —— 鼠标在文章里划过时她也会转头看，
       * 「养在博客里」的感觉全靠这一条。 */
      if (CONFIG.followCursor) {
        onMove = e => { if (model && !savingPower() && !document.hidden && !stage.dataset.dragging) model.focus(e.clientX - stage.getBoundingClientRect().left, e.clientY - stage.getBoundingClientRect().top) }
        document.addEventListener('pointermove', onMove, { passive: true })
      }
      onResize = () => { layout(true); applyPower() }
      window.addEventListener('resize', onResize)

      motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null
      onPowerChange = applyPower
      motionQuery?.addEventListener?.('change', onPowerChange)
      window.navigator?.connection?.addEventListener?.('change', onPowerChange)
      greet(version)
      // 每次到点才算这一页说什么 —— pjax 翻页不会重建她，算早了会一直念旧页面
      onVisibility = event => {
        if (!app || !model) return
        const paused = document.hidden || event?.type === 'pagehide'
        model.autoUpdate = !paused
        if (paused) {
          app.stop?.(); stopTalking(); speech = null; stopVoiceMouth()
          if (bubble) delete bubble.dataset.on
          clearInterval(idleTimer); idleTimer = null
        } else {
          app.start?.()
          applyPower(); restartIdle(); watchVoice()
          const current = window.NANALY?.chatState?.()
          if (current && ['thinking', 'streaming'].includes(current.phase)) {
            chatTurn = current.turnId; onChatState({ detail: current })
          } else { chat = { phase: 'idle', turnId: '', text: '' }; chatTurn = ''; face(moodFace()) }
        }
      }
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('pagehide', onVisibility)
      window.addEventListener('pageshow', onVisibility)
      onVisibility()
      requestAnimationFrame(() => stage && (stage.dataset.ready = '1'))
    } catch (error) {
      console.warn('[看板娘]', error && error.message)
      if (version === lifecycle) { await teardown(); setStatus('error', 'Mao 加载失败，请检查网络后重试') }
    } finally {
      if (enableTask === job) enableTask = null
      if (button) delete button.dataset.busy
      sync()
    }
    })()
    enableTask = job
    return job
  }

  // 按画布高度等比放，脚底贴着下边缘站住
  const layout = (resize = false) => {
    if (!app || !model || !stage) return
    const { w, h } = stageSize()
    // 加载过程中也可能旋转屏幕；首次放置须使用此刻的真实尺寸。
    stage.style.width = w + 'px'
    stage.style.height = h + 'px'
    app.renderer.resize(w, h)
    stage.dataset.side = settings.side
    stage.dataset.compact = compactNow() ? '1' : '0'
    stage.style.top = 'auto'
    stage.style.left = settings.side === 'left' ? CONFIG.edge + 'px' : 'auto'
    stage.style.right = settings.side === 'right' ? CONFIG.edge + 'px' : 'auto'
    const bottom = Math.max(0, (window.innerHeight || 900) - h - 16) * settings.bottomRatio
    stage.style.bottom = bottom + 'px'
    stage.dataset.bubbleBelow = ((window.innerHeight || 900) - h - bottom < 170) ? '1' : '0'
    const scale = (h * (compactNow() ? 3 : CONFIG.fill)) / (model.internalModel.originalHeight || model.height || 1)
    model.scale.set(scale)
    model.anchor.set(0.5, 1)
    model.position.set(w * CONFIG.anchorX, compactNow() ? h * 2.8 : h)
    clipToBody(w, h)
  }

  /* 画布比她大一圈，四周那圈透明的地方也会拦下点击 ——
   * 她站在右下角，那一块正好压着卡片的边。clip-path 把命中判定一并裁掉：
   * 裁外的点击直接穿过去，裁内还是她接着。比监听 pointermove 再改
   * pointer-events 靠谱：触屏上没有“先移过去”这一步。 */
  const clipToBody = (w, h) => {
    const canvas = stage && stage.querySelector('canvas')
    if (!canvas || !model) return
    if (compactNow()) { canvas.style.clipPath = 'circle(49% at 50% 50%)'; return }
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
    lifecycle++
    if (cancelModelLoad) cancelModelLoad()
    if (dragCleanup) { dragCleanup(); dragCleanup = null }
    motionQuery?.removeEventListener?.('change', onPowerChange)
    window.navigator?.connection?.removeEventListener?.('change', onPowerChange)
    motionQuery = onPowerChange = null
    if (sharedFPS !== null && window.PIXI?.Ticker?.shared) window.PIXI.Ticker.shared.maxFPS = sharedFPS
    sharedFPS = null
    stopTalking(); speech = null; stopVoiceMouth()
    chat = { phase: 'idle', turnId: '', text: '' }; chatTurn = ''; lastFace = ''
    clearTimeout(greetTimer); greetTimer = null
    // 订阅挂在娜娜莉那个控制器上，她被收起来之后不退订就是一直挂着的回调
    if (unsubVoice) { try { unsubVoice() } catch (_) {} unsubVoice = null }
    voiceHandler = null
    clearInterval(idleTimer); idleTimer = null
    if (onMove) { document.removeEventListener('pointermove', onMove); onMove = null }
    if (onResize) { window.removeEventListener('resize', onResize); onResize = null }
    if (onVisibility) {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onVisibility); window.removeEventListener('pageshow', onVisibility)
      onVisibility = null
    }
    retireModel(model)
    try { app?.destroy(false, { children: true }) } catch (_) {}
    try { stage?.remove() } catch (_) {}
    app = model = stage = bubble = null
    releaseTextures()
    // 别留着「正在闹别扭」跨过这一次关闭 —— 下次打开她该是好好的
    resetMood()
  }

  const disable = async () => {
    await teardown()
    setStatus('idle', 'Mao 已收起')
  }

  const toggle = async () => {
    const next = !(app || enableTask && read())
    save(next)
    if (next) await enable()
    else await disable()
  }

  /* 长按帽子按钮 = 切换出声。没有给它单独一个按钮 —— 左下角那一摞已经三个了，
   * 手机上再加一格就该挤到正文里去。长按开始的那一下会吞掉随后的 click，
   * 否则松手时会顺带把她关掉。 */
  const bindHold = target => {
    let timer = null, fired = false
    // 转圈的时长和判定的时长必须是同一个数，交给 CSS 而不是两边各写一遍
    target.style.setProperty('--mao-hold-ms', CONFIG.voiceHoldMs + 'ms')
    const start = () => {
      fired = false
      clearTimeout(timer)
      target.dataset.holding = '1'         // 转圈开始，让人看得见「按住了」
      timer = setTimeout(() => {
        fired = true; timer = null
        delete target.dataset.holding
        setVoice(!voiceOn)
      }, CONFIG.voiceHoldMs)
    }
    const cancel = () => { clearTimeout(timer); timer = null; delete target.dataset.holding }
    target.addEventListener('pointerdown', start)
    target.addEventListener('pointerup', cancel)
    target.addEventListener('pointerleave', cancel)
    target.addEventListener('pointercancel', cancel)
    /* 长按时把浏览器自己那套收掉。CSS 里的 touch-action / user-select /
     * touch-callout 挡住大部分，contextmenu 这一下还得在这儿按掉 ——
     * 安卓上它会在判定时长到达之前弹出来，把整个长按吃掉。 */
    target.addEventListener('contextmenu', e => e.preventDefault())
    target.addEventListener('click', e => {
      if (!fired) return
      fired = false
      e.preventDefault(); e.stopImmediatePropagation()   // 长按过了就不再当成开关
    }, true)
  }

  const mountToggle = () => {
    const existing = document.getElementById('mao-toggle')
    if (existing) { button = existing; mountControls(); return }
    if (controls) { controls.destroy(); controls = null }
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
    mountControls(); sync()
  }

  const retry = async () => {
    save(true)
    if (app) await teardown()
    return enable()
  }
  const mountControls = () => {
    if (!controls && window.MAO_CONTROLS) controls = window.MAO_CONTROLS.create({
      button, getSettings: () => ({ ...settings }), onSettingsChange: configure,
      onAction: action, getStatus: () => ({ ...status }), onRetry: retry
    })
  }

  /* pjax 换的是 #body-wrap 里面那一块，挂在 body 下的按钮和她本人都在外面，
   * 照理翻页动不到。照理归照理 —— 主题哪天多换一个选择器，她就会悄无声息地消失，
   * 而开关还亮着。所以每次翻完页对一下：谁掉了就把谁补回来。 */
  const recover = () => {
    mountToggle()
    if (!occupied()) { stopTalking(); if (bubble) delete bubble.dataset.on }
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
    settings: () => ({ ...settings }), configure,
    status: () => ({ ...status }), retry,
    config: () => CONFIG,
    // 这会儿她该说哪一组话。测试和调试都用它，省得等 70 秒
    lines: () => linesHere(),
    // 出声开关。不给参数就是问现在开没开
    voice: on => (on === undefined ? voiceOn : setVoice(on))
  })

  window.addEventListener('nanaly:chat-state', onChatState)
  window.addEventListener('noimpty:schedule-updated', onScheduleUpdated)
  rememberVisit()
  document.addEventListener('pjax:complete', recover)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
