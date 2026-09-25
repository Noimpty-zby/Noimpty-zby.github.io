/* Mao 的本地互动：不请求模型/语音服务；模型由 mao-pet 管理。 */
;(() => {
  'use strict'
  if (window.NANALY_BACKUP_PENDING) return
  if (window.MAO_PLAY) return
  const PREF = 'mao-play-v1'
  const NOTES = [
    [' /\_/\\\n( o.o )\n > ^ <', '今天的好运分你一半。'],
    ['  ♡  ♡\n   🐾', '慢慢来，也算在前进。'],
    [' /\_/\\\n( -.- ) zZ', '认真休息，也是今天的任务。'],
    ['✿  🐾  ✿', '这朵小花，送给正在努力的你。'],
    ['☆  /\_/\\  ☆', '今天也有好好陪着你喵。']
  ]
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
  const dateText = () => {
    const date = new Date()
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
  }
  function create (options) {
    const { stage, canvas, getSettings, isOccupied, face, say, focus, getBody, capture, reset } = options
    if (!stage || !canvas) throw new TypeError('Mao 互动需要已加载的人物')
    let destroyed = false, paused = false, opened = false, previousFocus = null
    let state = null, generation = 0, activityAt = Date.now(), lastAmbient = Date.now(), lastPetal = 0
    let head = null, snackDrag = null, snackMoved = false, photoURL = '', poll = null
    const listeners = [], timers = new Set()
    const motionMedia = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let saved = { notes: [], feeds: 0, feedAt: 0 }
    try {
      const value = JSON.parse(localStorage.getItem(PREF) || 'null')
      if (value && typeof value === 'object') {
        saved.notes = Array.isArray(value.notes) ? value.notes.filter(note => note && Number.isInteger(note.kind)
          && note.kind >= 0 && note.kind < NOTES.length && /^\d{4}-\d{2}-\d{2}$/.test(note.date)).slice(-24).map(note => ({ kind: note.kind, date: note.date })) : []
        saved.feeds = Number.isInteger(value.feeds) ? clamp(value.feeds, 0, 99) : 0
        saved.feedAt = Number.isFinite(value.feedAt) && value.feedAt <= Date.now() ? Math.max(0, value.feedAt) : 0
      }
    } catch (_) {}
    function el (tag, className, text) {
      const node = document.createElement(tag)
      if (className) node.className = className
      if (text !== undefined) node.textContent = text
      return node
    }
    function listen (target, type, fn, opts) {
      target.addEventListener(type, fn, opts)
      listeners.push(() => target.removeEventListener(type, fn, opts))
    }
    function button (label, fn, name = '', transient = false) {
      const node = el('button', 'mao-play-button', label)
      node.type = 'button'; node.dataset.play = name
      if (transient) node.addEventListener('click', fn)
      else listen(node, 'click', fn)
      return node
    }
    function later (fn, ms) {
      const version = generation
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (!destroyed && version === generation && !blocked()) fn()
      }, ms)
      timers.add(timer)
      return timer
    }
    function blocked () { return destroyed || paused || document.hidden || !!isOccupied() }
    function lowMotion () {
      return !!motionMedia?.matches
        || getSettings().power === 'saving' || !!window.navigator?.connection?.saveData
    }
    function notify (message) { if (!destroyed) notice.textContent = message }
    function persist () {
      try { localStorage.setItem(PREF, JSON.stringify(saved)); return true }
      catch (_) { notify('浏览器未能保存；这次收集会保留到页面关闭。'); return false }
    }
    const layer = el('div', 'mao-play-layer')
    const effect = el('div', 'mao-play-effect')
    effect.setAttribute('aria-hidden', 'true')
    const prop = button('', () => {
      if (state?.kind === 'petal') removePetal()
      else if (state?.kind === 'note') revealNote()
    }, 'prop')
    prop.className = 'mao-play-prop'; prop.hidden = true
    layer.appendChild(effect); layer.appendChild(prop); stage.appendChild(layer)
    const panel = el('section', 'mao-play-panel')
    panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '陪 Mao 玩一会儿')
    const heading = el('div', 'mao-play-heading')
    heading.appendChild(el('strong', '', 'Mao 的小小休息时间'))
    const closeButton = button('×', () => close(), 'close')
    closeButton.setAttribute('aria-label', '关闭互动面板')
    heading.appendChild(closeButton); panel.appendChild(heading)
    const notice = el('p', 'mao-play-notice', '拖零食给她，或选一个小游戏。也可以在她头顶轻轻来回移动鼠标。')
    notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite')
    panel.appendChild(notice)
    const choices = el('div', 'mao-play-choices')
    const snackButton = button('🍪 小饼干 · 拖动或点按投喂', () => {
      if (snackMoved) { snackMoved = false; return }
      feed('cookie')
    }, 'feed')
    snackButton.className += ' mao-play-snack'
    choices.appendChild(snackButton)
    choices.appendChild(button('🐟 投喂小鱼干', () => feed('fish'), 'fish'))
    choices.appendChild(button('✿ 轻轻摸头', () => rub(), 'rub'))
    choices.appendChild(button('🌸 接一片樱花', () => petal(false), 'petal'))
    choices.appendChild(button('☁ 陪她打个盹', () => sleep(), 'sleep'))
    choices.appendChild(button('🪶 逗猫棒 · 玩 15 秒', () => tease(), 'tease'))
    choices.appendChild(button('✉ 看看小纸条', () => note(), 'note'))
    choices.appendChild(button('📷 合影小相机', () => camera(), 'camera'))
    choices.appendChild(button('🐾 小纸条相册', () => album(), 'album'))
    panel.appendChild(choices)
    const game = el('div', 'mao-play-game'); game.hidden = true
    const feather = button('🪶', () => pounce(true), 'feather')
    feather.className = 'mao-play-feather'; feather.setAttribute('aria-label', '逗猫棒：方向键移动，回车让 Mao 扑一下')
    game.appendChild(feather)
    game.appendChild(el('p', '', '移动羽毛靠近 Mao，或用方向键移动、回车逗她。'))
    panel.appendChild(game)
    const paper = el('article', 'mao-play-paper'); paper.hidden = true
    panel.appendChild(paper)
    const photo = el('div', 'mao-play-photo'); photo.hidden = true
    panel.appendChild(photo)
    document.body.appendChild(panel)
    function place () {
      if (!opened) return
      const view = window.visualViewport
      const width = view?.width || window.innerWidth || 1024
      const height = view?.height || window.innerHeight || 768
      panel.style.width = Math.min(352, Math.max(160, width - 24)) + 'px'
      panel.style.maxHeight = Math.max(120, height - 24) + 'px'
      panel.style.left = ((view?.offsetLeft || 0) + Math.max(12, width - Math.min(352, width - 24) - 12)) + 'px'
      panel.style.top = ((view?.offsetTop || 0) + 12) + 'px'
    }
    function open () {
      if (destroyed) return false
      if (!opened) previousFocus = document.activeElement
      opened = true; panel.hidden = false; place(); closeButton.focus({ preventScroll: true })
      activityAt = Date.now()
      return true
    }
    function close (restore = true) {
      if (!opened) return
      const restoreFocus = panel.contains(document.activeElement)
      opened = false; panel.hidden = true
      cancel()
      if (restore && restoreFocus) (previousFocus && document.contains(previousFocus) && !previousFocus.closest?.('[hidden]')
        ? previousFocus : canvas)?.focus?.({ preventScroll: true })
    }
    function clearContent (node) { while (node.firstChild) node.removeChild(node.firstChild) }
    function cancel (restore = true) {
      generation++
      timers.forEach(clearTimeout); timers.clear()
      state = null; head = null; snackDrag = null
      delete stage.dataset.play; effect.textContent = ''; effect.className = 'mao-play-effect'
      prop.hidden = true; game.hidden = true
      if (restore && !blocked()) reset?.()
    }
    function begin (kind, mood) {
      if (blocked()) { notify('Mao 正陪 Nana 聊天或朗读，等她忙完再来玩吧。'); return false }
      cancel(); activityAt = Date.now()
      state = { kind, started: Date.now(), step: 0 }
      stage.dataset.play = kind; stage.dataset.playMotion = lowMotion() ? 'still' : 'full'
      if (mood) face(mood)
      return true
    }
    function speak (text, mood) { if (!blocked()) say([text, mood || '笑']) }
    function finish (ms = 2100) { later(() => cancel(), ms) }
    function body () {
      const box = getBody?.()
      return box && box.width > 0 && box.height > 0 ? box : canvas.getBoundingClientRect()
    }
    function near (x, y, top = 0, bottom = 1) {
      const box = body()
      return x >= box.left && x <= box.left + box.width && y >= box.top + box.height * top && y <= box.top + box.height * bottom
    }
    function decorate (text, kind = '') { effect.textContent = text; effect.className = 'mao-play-effect ' + kind }
    function feed (kind) {
      if (!begin('feed', '星星眼')) return false
      if (Date.now() - saved.feedAt > 120000) saved.feeds = 0
      saved.feeds++; saved.feedAt = Date.now(); persist()
      const icon = kind === 'fish' ? '🐟' : '🍪'
      decorate(icon, 'mao-play-food')
      notify('Mao 看到了' + (kind === 'fish' ? '小鱼干' : '小饼干') + '，正在凑过来。')
      focus?.(body().left + body().width / 2, body().top + body().height * 0.32)
      later(() => {
        state.step = 1
        if (saved.feeds >= 3) {
          decorate(icon + ' ♡', 'mao-play-food mao-play-kept')
          speak('这个留到下午吃。', '脸红'); notify('她把剩下的零食抱好了。')
        } else {
          decorate('· ˚ ♡ ˚ ·', 'mao-play-hearts'); speak('咔嚓……好吃喵。', '笑')
          notify('零食吃掉了，留下小碎屑和爱心。')
        }
        finish(2600)
      }, 900)
      return true
    }
    function rub (fromPointer = false) {
      if (!begin('rub', '平静')) return false
      notify('轻轻摸摸……她慢慢眯起眼睛。')
      state.pointer = fromPointer
      if (!fromPointer) {
        later(() => { state.step = 1; face('脸红'); decorate('✿  ♡  ✿', 'mao-play-flowers') }, 850)
        later(endRub, 2600)
      }
      return true
    }
    function endRub () {
      if (state?.kind !== 'rub') return
      state.kind = 'hat'; stage.dataset.play = 'hat'; state.started = Date.now()
      speak('……摸完啦？', '脸红'); decorate('✿', 'mao-play-flowers')
      notify('她抬头看了你一眼，又悄悄扶正帽子。'); finish(2200)
    }
    function petal (ambient = false) {
      if (ambient && (getSettings().quiet || lowMotion() || opened || Date.now() - lastPetal < 90000 || state)) return false
      if (!begin('petal', '星星眼')) return false
      lastPetal = Date.now(); state.miss = Math.random() < 0.18
      decorate('🌸', 'mao-play-falling'); notify('一片樱花飘过来了。')
      later(() => {
        effect.textContent = ''
        if (state.miss) {
          state.kind = 'miss'; state.started = Date.now(); stage.dataset.play = 'miss'
          decorate('🌸', 'mao-play-petal-miss'); speak('差一点就接住了……', '为难'); finish(2600)
        } else {
          state.step = 1; prop.textContent = '🌸'; prop.hidden = false
          prop.setAttribute('aria-label', '拿掉 Mao 帽子上的花瓣')
          speak('帽子上是不是落了什么？', '为难'); notify('点帽子上的花瓣，替她拿下来。')
          later(() => { if (state?.kind === 'petal') removePetal() }, 22000)
        }
      }, lowMotion() ? 200 : 1300)
      return true
    }
    function removePetal () {
      if (blocked() || state?.kind !== 'petal') return
      prop.hidden = true; state.step = 2; decorate('✿ ♡', 'mao-play-hearts')
      speak('谢谢，帽子又干净啦。', '笑'); notify('她笑着晃了晃脑袋。'); finish()
    }
    function sleep () {
      if (!begin('sleep', '平静')) return false
      notify('Mao 慢慢打起了瞌睡。轻点人物或按“叫醒她”就能叫醒。')
      prop.textContent = '☁ Zzz'; prop.hidden = false; prop.setAttribute('aria-label', '叫醒 Mao')
      later(() => { if (state?.kind === 'sleep') { state.step = 1; face('闭眼'); decorate('z Z', 'mao-play-dream') } }, 2300)
      return true
    }
    function wake () {
      if (state?.kind !== 'sleep' || blocked()) return false
      if (!begin('wake', '星星眼')) return false
      speak('我有在看……！', '星星眼'); decorate('☁', 'mao-play-dream')
      later(() => { face('闭眼'); notify('刚醒来的 Mao 还带着一点迷糊。') }, 900)
      finish(3500)
      return true
    }
    function tease () {
      if (!begin('tease', '星星眼')) return false
      if (!opened) open()
      game.hidden = false; state.x = 50; state.y = 45; state.catches = 0; state.pounceAt = 0; state.pounceUntil = 0
      feather.style.left = '50%'; feather.style.top = '45%'
      notify('逗猫棒拿出来了，试着让羽毛靠近她。15 秒后休息。')
      feather.focus({ preventScroll: true })
      later(() => {
        const catches = state.catches
        game.hidden = true; state.kind = 'tease-end'; stage.dataset.play = 'tease-end'
        speak(catches ? '抓到 ' + catches + ' 次！我厉害吧。' : '下次一定抓到。', catches ? '星星眼' : '生气')
        notify('小游戏结束，随时可以再玩一局。'); finish(2600)
      }, 15000)
      return true
    }
    function moveFeather (x, y) {
      if (state?.kind !== 'tease' || blocked()) return
      state.x = clamp(x, 8, 92); state.y = clamp(y, 12, 72)
      feather.style.left = state.x + '%'; feather.style.top = state.y + '%'
      const box = game.getBoundingClientRect()
      focus?.(box.left + box.width * state.x / 100, box.top + box.height * state.y / 100)
      if (state.y > 58) pounce(false)
    }
    function pounce (explicit) {
      if (state?.kind !== 'tease' || blocked() || Date.now() - state.pounceAt < 650) return
      state.pounceAt = Date.now(); state.pounceUntil = Date.now() + 480
      const caught = explicit || state.x > 28 && state.x < 72
      if (caught) { state.catches++; face('星星眼'); decorate('✦  ✦', 'mao-play-hearts'); notify('抓到了！再试一次？') }
      else { face('生气'); decorate('…', 'mao-play-hearts'); notify('扑空了，她有点不服气。') }
    }
    function note (ambient = false) {
      if (ambient && (opened || getSettings().quiet || lowMotion() || state)) return false
      if (!begin('note', '脸红')) return false
      state.note = { kind: Math.floor(Math.random() * NOTES.length), date: dateText() }
      prop.hidden = false; prop.textContent = '✉'; prop.setAttribute('aria-label', '打开 Mao 递来的小纸条')
      notify('她递来一张折好的纸条。点纸条展开。')
      if (!ambient) revealNote()
      else later(() => cancel(), 30000)
      lastAmbient = Date.now()
      return true
    }
    function renderNote (target, item) {
      const [drawing, message] = NOTES[item.kind]
      const card = el('div', 'mao-play-note-card')
      card.appendChild(el('pre', '', drawing)); card.appendChild(el('p', '', message)); card.appendChild(el('small', '', item.date + ' · Mao'))
      target.appendChild(card)
    }
    function revealNote () {
      if (blocked() || state?.kind !== 'note' || !state.note) return
      const item = { ...state.note }; prop.hidden = true
      open(); clearContent(paper); paper.hidden = false; photo.hidden = true
      renderNote(paper, item)
      const saveButton = button('收进小相册', () => {
        if (saveButton.disabled) return
        saved.notes.push(item); saved.notes = saved.notes.slice(-24)
        const persisted = persist(); saveButton.disabled = true; saveButton.textContent = '已收好'
        if (persisted) notify('小纸条已保存在这个浏览器的小相册里。最多保留最近 24 张。')
      }, 'save-note', true)
      paper.appendChild(saveButton); saveButton.focus({ preventScroll: true })
      face('笑'); finish(5000)
    }
    function album () {
      if (destroyed) return
      cancel(); open(); photo.hidden = true; paper.hidden = false; clearContent(paper)
      paper.appendChild(el('h3', '', '小纸条相册 · ' + saved.notes.length + '/24'))
      if (!saved.notes.length) paper.appendChild(el('p', '', '还没有纸条。让 Mao 递一张给你吧。'))
      saved.notes.slice().reverse().forEach(item => renderNote(paper, item))
      notify('纸条只保存在本机；不会上传，也不会读取博客内容。')
    }
    function releasePhoto () { if (photoURL) URL.revokeObjectURL(photoURL); photoURL = '' }
    function camera () {
      if (!begin('camera', '笑')) return false
      if (!opened) open()
      photo.hidden = true; paper.hidden = true
      decorate('3', 'mao-play-countdown'); notify('摆好表情，3……')
      later(() => { decorate('2', 'mao-play-countdown'); notify('2……') }, 1000)
      later(() => { decorate('1', 'mao-play-countdown'); if (Math.random() < 0.3) face('为难'); notify('1……') }, 2000)
      later(async () => {
        const version = generation
        try {
          const snapshot = await capture()
          if (destroyed || version !== generation || blocked()) return
          const output = document.createElement('canvas'); output.width = 720; output.height = 900
          const ctx = output.getContext('2d')
          if (!ctx || !snapshot?.width || !snapshot?.height) throw new Error('画面暂时无法读取')
          ctx.fillStyle = '#fffaf4'; ctx.fillRect(0, 0, 720, 900)
          ctx.fillStyle = '#f7dae5'; ctx.fillRect(28, 28, 664, 710)
          const ratio = Math.min(640 / snapshot.width, 690 / snapshot.height)
          const width = snapshot.width * ratio, height = snapshot.height * ratio
          ctx.drawImage(snapshot, (720 - width) / 2, 38 + (690 - height) / 2, width, height)
          ctx.fillStyle = '#794858'; ctx.textAlign = 'center'
          ctx.font = '30px cursive'; ctx.fillText('今天也有 Mao 陪着你。', 360, 790)
          ctx.font = '22px sans-serif'; ctx.fillText(dateText() + '  ·  Mao & you', 360, 834)
          // 简单爪印用路径画，避免系统 emoji 字体导致导出缺字。
          ctx.beginPath(); ctx.ellipse(638, 841, 15, 11, 0, 0, Math.PI * 2); ctx.fill()
          ;[[619, 824], [632, 816], [647, 818], [658, 830]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill() })
          const blob = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('照片生成超时，请重试')), 10000)
            output.toBlob(value => { clearTimeout(timeout); value ? resolve(value) : reject(new Error('无法生成照片')) }, 'image/png')
          })
          if (destroyed || version !== generation || blocked()) return
          releasePhoto(); photoURL = URL.createObjectURL(blob)
          clearContent(photo)
          const preview = el('img'); preview.src = photoURL; preview.alt = 'Mao 合影：带日期、爪印和短句的拍立得照片'
          const download = el('a', 'mao-play-button', '保存这张照片'); download.href = photoURL; download.download = 'mao-' + dateText() + '.png'
          photo.appendChild(preview); photo.appendChild(download); photo.hidden = false
          decorate('♡', 'mao-play-hearts'); notify('拍好了。点击“保存这张照片”下载 PNG；照片不会上传。')
          download.focus({ preventScroll: true }); finish()
        } catch (_) {
          if (!destroyed && version === generation) { cancel(); notify('这次照片没有拍成。可以重试；若浏览器禁用了画布导出，请换浏览器再试。') }
        }
      }, 3000)
      return true
    }
    function drag (phase) {
      if (phase === 'start') {
        if (begin('lift', '为难')) { decorate('！', 'mao-play-lift'); notify('轻轻拎起了帽子。') }
      } else if (state?.kind === 'lift') {
        if (phase === 'cancel') cancel()
        else {
          state.kind = 'hat'; state.started = Date.now(); stage.dataset.play = 'hat'
          decorate('✧', 'mao-play-flowers'); speak('搬家之前先说一声嘛。', '脸红'); finish(2300)
        }
      }
    }
    function tap () {
      if (state?.kind === 'sleep') return wake()
      return !!state
    }
    function frame (set) {
      if (!state || blocked()) return
      const elapsed = Date.now() - state.started, wave = lowMotion() ? 0 : Math.sin(elapsed / 320)
      if (state.kind === 'rub') {
        const amount = clamp(elapsed / 2000, 0, 1)
        set('ParamEyeLOpen', 1 - amount * .85); set('ParamEyeROpen', 1 - amount * .85)
        set('ParamCheek', amount); set('ParamEyeLSmile', amount); set('ParamEyeRSmile', amount)
      } else if (state.kind === 'sleep') {
        const amount = clamp(elapsed / 2300, 0, 1)
        set('ParamEyeLOpen', 1 - amount); set('ParamEyeROpen', 1 - amount); set('ParamAngleY', -7 * amount)
      } else if (state.kind === 'lift') {
        set('ParamBodyAngleZ', wave * 4); set('ParamAngleZ', -wave * 5); set('ParamHatTop', wave * .4)
        set('ParamEyeLOpen', 1.15); set('ParamEyeROpen', 1.15)
      } else if (state.kind === 'hat') {
        const settle = lowMotion() ? 0 : Math.sin(clamp(elapsed / 2200, 0, 1) * Math.PI)
        set('ParamAngleY', 8); set('ParamHatBrim', wave * .25); set('ParamRightShoulderUp', 4 * settle)
        set('ParamArmRA01', 12 * settle); set('ParamArmRA02', -16 * settle)
      } else if (state.kind === 'petal') {
        set('ParamEyeBallY', -0.7); set('ParamAngleZ', wave * 4)
      } else if (state.kind === 'miss' || state.kind === 'tease' && state.pounceUntil > Date.now()) {
        const reach = lowMotion() ? 0 : state.kind === 'miss' ? Math.sin(clamp(elapsed / 2400, 0, 1) * Math.PI) : .8
        set('ParamBodyAngleY', 5 * reach); set('ParamLeftShoulderUp', 4 * reach); set('ParamRightShoulderUp', 4 * reach)
        set('ParamArmLA01', 20 * reach); set('ParamArmLA02', -12 * reach)
      } else if (state.kind === 'feed' && state.step === 0) {
        set('ParamAngleY', lowMotion() ? 0 : 5); set('ParamBodyAngleY', lowMotion() ? 0 : 3)
      } else if (state.kind === 'feed' && state.step === 1) {
        set('ParamA', saved.feeds < 3 ? .2 + Math.abs(wave) * .25 : 0)
        set('ParamLeftShoulderUp', 3); set('ParamRightShoulderUp', 3)
        if (saved.feeds >= 3) { set('ParamArmLA01', 8); set('ParamArmRA01', 8) }
      }
    }
    function ambient () {
      if (blocked() || state || opened || getSettings().quiet || lowMotion() || stage.dataset.compact === '1') return
      const now = Date.now()
      if (now - lastAmbient > 480000) note(true)
      else if (now - activityAt > 120000) sleep()
    }
    function suspend (value) {
      paused = value
      clearInterval(poll); poll = null
      if (paused || document.hidden || isOccupied()) {
        cancel(false); if (opened) notify('互动已暂停。回来后可以重新开始。')
      } else {
        activityAt = Date.now(); lastAmbient = Date.now()
        poll = setInterval(ambient, 15000)
      }
    }
    function refresh () {
      stage.dataset.playMotion = lowMotion() ? 'still' : 'full'
      if (isOccupied() || document.hidden || stage.dataset.compact === '1') cancel(false)
      else if (getSettings().quiet && state && ['sleep', 'petal', 'note'].includes(state.kind) && !opened) cancel()
    }
    listen(prop, 'click', () => { if (state?.kind === 'sleep') wake() })
    listen(document, 'keydown', event => {
      if (opened && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    })
    listen(document, 'pointerdown', event => {
      activityAt = Date.now()
      if (state?.kind === 'sleep' && event.target === canvas) wake()
    }, { passive: true })
    listen(canvas, 'pointermove', event => {
      if (blocked() || event.buttons || state && !['rub'].includes(state.kind) || !near(event.clientX, event.clientY, 0, .34)) return
      const now = Date.now()
      if (!head || now - head.at > 1000) head = { x: event.clientX, at: now, direction: 0, turns: 0 }
      const dx = event.clientX - head.x
      if (Math.abs(dx) < 4) return
      const direction = Math.sign(dx)
      if (head.direction && direction !== head.direction) head.turns++
      head.x = event.clientX; head.at = now; head.direction = direction
      if (!state && head.turns >= 2) { const trace = head; rub(true); head = trace }
      if (state?.kind === 'rub') {
        if (head.turns >= 4) { state.step = 1; decorate('✿  ♡  ✿', 'mao-play-flowers') }
        if (state.endTimer) { clearTimeout(state.endTimer); timers.delete(state.endTimer) }
        state.endTimer = later(endRub, 1000)
      }
    }, { passive: true })
    listen(canvas, 'pointerleave', () => { if (state?.kind === 'rub') endRub(); head = null })
    listen(snackButton, 'pointerdown', event => {
      if (event.button != null && event.button !== 0 || blocked()) return
      snackDrag = { id: event.pointerId, x: event.clientX, y: event.clientY }; snackMoved = false
      snackButton.setPointerCapture?.(event.pointerId)
    })
    listen(snackButton, 'pointermove', event => {
      if (!snackDrag || event.pointerId !== snackDrag.id) return
      if (Math.hypot(event.clientX - snackDrag.x, event.clientY - snackDrag.y) < 7 && !snackMoved) return
      snackMoved = true; event.preventDefault()
      decorate('🍪', 'mao-play-drag-food')
      effect.style.setProperty('--food-x', (event.clientX - stage.getBoundingClientRect().left) + 'px')
      effect.style.setProperty('--food-y', (event.clientY - stage.getBoundingClientRect().top) + 'px')
      focus?.(event.clientX, event.clientY)
    })
    listen(snackButton, 'pointerup', event => {
      if (!snackDrag || event.pointerId !== snackDrag.id) return
      snackDrag = null; snackButton.releasePointerCapture?.(event.pointerId)
      if (!snackMoved) return
      effect.textContent = ''
      if (near(event.clientX, event.clientY, 0, .65)) feed('cookie')
      else notify('把饼干拖到 Mao 面前，或直接点“投喂”。')
    })
    listen(snackButton, 'pointercancel', () => { snackDrag = null; snackMoved = false; effect.textContent = '' })
    listen(snackButton, 'lostpointercapture', () => {
      if (snackDrag) { snackDrag = null; snackMoved = true; effect.textContent = '' }
    })
    listen(game, 'pointermove', event => {
      const box = game.getBoundingClientRect()
      if (box.width && box.height) moveFeather((event.clientX - box.left) / box.width * 100, (event.clientY - box.top) / box.height * 100)
    }, { passive: true })
    listen(feather, 'keydown', event => {
      if (state?.kind !== 'tease' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      moveFeather(state.x + (event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : 0), state.y + (event.key === 'ArrowUp' ? -10 : event.key === 'ArrowDown' ? 10 : 0))
    })
    listen(document, 'animationiteration', event => {
      if (event.target?.classList?.contains('sakura-petal') && Math.random() < .2) petal(true)
    })
    listen(document, 'pjax:send', () => { close(false); cancel(); activityAt = Date.now() })
    listen(document, 'pjax:complete', () => { activityAt = Date.now(); refresh() })
    listen(window, 'resize', place)
    if (window.visualViewport) { listen(window.visualViewport, 'resize', place); listen(window.visualViewport, 'scroll', place) }
    suspend(false)
    return Object.freeze({ open, close, frame, drag, tap, refresh, suspend, stop: () => cancel(),
      busy: () => !!state,
      state: () => state ? { kind: state.kind, step: state.step } : null,
      destroy: () => {
        if (destroyed) return
        close(); cancel(false); clearInterval(poll); poll = null; destroyed = true
        listeners.splice(0).forEach(remove => remove()); releasePhoto(); layer.remove(); panel.remove()
      }
    })
  }
  window.MAO_PLAY = Object.freeze({ create })
})()
