/* SiliconFlow speech. Credentials stay in the existing unlocked vault. */
(() => {
  'use strict'
  if (window.NANALY_VOICE) return
  const MODEL = 'FunAudioLLM/CosyVoice2-0.5B'
  const KEY = 'nanaly-voice-v1'
  const STYLES = Object.freeze({
    cat: { name: '清甜猫娘', voice: 'diana', instruction: '请用清甜、明亮、稍高的女性动漫角色声线，语气可爱俏皮，带一点嘴硬心软的傲娇感。普通话清晰自然，轻盈有亲近感，不要尖叫，不要念出语气说明。' },
    soft: { name: '温柔陪伴', voice: 'claire', instruction: '请用温柔清甜的女声自然朗读，像耐心陪伴朋友学习，语气柔和、吐字清楚，不要念出语气说明。' },
    bright: { name: '元气满满', voice: 'diana', instruction: '请用明亮活泼的女声自然朗读，像开心的动漫女主角，轻快可爱但不要夸张尖叫，不要念出语气说明。' }
  })
  const normalize = value => ({
    style: STYLES[value?.style] ? value.style : 'cat',
    speed: Number.isFinite(Number(value?.speed)) ? Math.min(1.3, Math.max(0.8, Number(value.speed))) : 1.04,
    autoplay: value?.autoplay === true,
    effects: value?.effects !== false
  })
  const cleanText = text => String(text || '')
    .replace(/```[\s\S]*?```/g, '（这里有一段代码。）')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[S\d+\]/g, '')
    .replace(/\[[^\]\n]{1,40}\]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<\|[^>]*\|>/g, '')
    .replace(/(?:^|\n)\s*#{1,6}\s+/g, '\n')
    .replace(/[*_`~]+/g, '')
    .replace(/\(=\^[^)]{0,12}\)|\([oO0][vVwW][oO0]\)|\(>[wW]<\)/g, '')
    .replace(/\s+/g, ' ').trim()
  const splitText = (text, limit = 450) => {
    const parts = []
    let remaining = cleanText(text)
    while (remaining) {
      if (remaining.length <= limit) { parts.push(remaining); break }
      const head = remaining.slice(0, limit)
      let end = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('；'), head.lastIndexOf('. ')) + 1
      if (end < limit / 3) end = limit
      // Do not split a UTF-16 surrogate pair.
      if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--
      parts.push(remaining.slice(0, end).trim()); remaining = remaining.slice(end).trim()
    }
    return parts.filter(Boolean)
  }
  const endpoint = base => {
    const url = new URL(base || 'https://api.siliconflow.cn/v1')
    if (url.username || url.password || url.search || url.hash ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('请检查硅基流动接口地址')
    return url.href.replace(/\/+$/, '') + '/audio/speech'
  }
  const create = ({ getConnection, notify = () => {}, onNeedKey = () => {}, fetcher = (...args) => window.fetch(...args), makeAudio = () => new Audio() } = {}) => {
    let prefs
    try { prefs = normalize(JSON.parse(window.localStorage.getItem(KEY) || '{}')) } catch (_) { prefs = normalize() }
    let revision = 0, active = null, soundContext = null, audioBytes = 0, cacheAccount = null
    const cache = new Map(), listeners = new Set()
    const emit = () => listeners.forEach(listener => listener(active ? { id: active.id, phase: active.phase } : null))
    const stop = ({ clearCache = false } = {}) => {
      revision++
      const prior = active
      active = null
      if (prior) {
        prior.controller.abort()
        if (prior.audio) { prior.audio.pause(); prior.audio.removeAttribute?.('src'); prior.audio.load?.() }
        if (prior.url) URL.revokeObjectURL(prior.url)
      }
      if (clearCache) { cache.clear(); audioBytes = 0; cacheAccount = null }
      emit()
    }
    const configure = change => {
      stop()
      prefs = normalize({ ...prefs, ...change })
      try { window.localStorage.setItem(KEY, JSON.stringify(prefs)) } catch (_) { notify('声音偏好暂时无法保存，当前页面仍可使用。') }
      return { ...prefs }
    }
    const speechError = async response => {
      if (window.NANALY_PROVIDER?.responseError) return window.NANALY_PROVIDER.responseError(response)
      return new Error('声音生成失败（' + response.status + '），请检查密钥、额度或稍后重试。')
    }
    const remember = (key, blob) => {
      if (blob.size > 8 * 1024 * 1024) return
      if (cache.has(key)) audioBytes -= cache.get(key).size
      cache.delete(key); cache.set(key, blob); audioBytes += blob.size
      while (cache.size > 12 || audioBytes > 12 * 1024 * 1024) {
        const oldest = cache.keys().next().value
        audioBytes -= cache.get(oldest).size; cache.delete(oldest)
      }
    }
    const play = (blob, turn) => new Promise((resolve, reject) => {
      if (turn.controller.signal.aborted) return reject(turn.controller.signal.reason)
      const audio = makeAudio(), url = URL.createObjectURL(blob)
      turn.audio = audio; turn.url = url
      const signal = turn.controller.signal
      let settled = false
      const finish = error => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        audio.onended = audio.onerror = null
        audio.pause(); audio.removeAttribute?.('src'); audio.load?.()
        URL.revokeObjectURL(url)
        if (turn.url === url) turn.url = null
        error ? reject(error) : resolve()
      }
      const abort = () => finish(signal.reason || new DOMException('停止朗读', 'AbortError'))
      signal.addEventListener('abort', abort, { once: true })
      audio.onended = () => finish()
      audio.onerror = () => finish(new Error('音频播放失败，请重试。'))
      audio.src = url
      turn.phase = 'playing'; emit()
      Promise.resolve().then(() => audio.play()).catch(error => finish(error?.name === 'NotAllowedError'
        ? new Error('声音已生成，请再点一次朗读来允许播放。') : error))
    })
    const speak = async (text, { id = 'preview', automatic = false } = {}) => {
      if (automatic && (!prefs.autoplay || document.hidden)) return false
      if (active?.id === id && !automatic) { stop(); return false }
      stop()
      const plain = cleanText(text)
      if (!plain) return false
      if (plain.length > 16000) { notify('这条回复很长，请引用需要朗读的部分（一次最多 16,000 字符）。'); return false }
      const connection = getConnection?.() || {}
      if (!connection.key) { notify('声音共用硅基流动密钥，请先解锁或填写。'); if (!automatic) onNeedKey(); return false }
      const version = revision
      const turn = { id, controller: new AbortController(), phase: 'loading', audio: null, url: null }
      active = turn; emit()
      const settings = { ...prefs }, style = STYLES[settings.style]
      try {
        const url = endpoint(connection.baseURL)
        // Cache belongs to one unlocked account; never reuse another account's audio.
        if (cacheAccount?.url !== url || cacheAccount?.key !== connection.key) {
          cache.clear(); audioBytes = 0
          cacheAccount = { url, key: connection.key }
        }
        for (const part of splitText(plain)) {
          turn.controller.signal.throwIfAborted()
          const cacheKey = JSON.stringify([url, settings.style, settings.speed, part])
          let blob = cache.get(cacheKey)
          if (!blob) {
            turn.phase = 'loading'; emit()
            const timeout = setTimeout(() => turn.controller.abort(new DOMException('声音生成超时，请重试。', 'TimeoutError')), 60000)
            try {
              const response = await fetcher(url, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + connection.key },
                body: JSON.stringify({ model: MODEL, voice: MODEL + ':' + style.voice,
                  input: style.instruction + '<|endofprompt|>' + part, response_format: 'mp3', stream: false, speed: settings.speed }),
                signal: turn.controller.signal
              })
              if (!response.ok) throw await speechError(response)
              if (/json|text\//i.test(response.headers?.get('content-type') || '')) throw new Error('语音服务返回了异常内容，请稍后重试。')
              blob = await response.blob()
              if (!blob.size || blob.size > 12 * 1024 * 1024) throw new Error('语音服务没有返回可播放的音频。')
              turn.controller.signal.throwIfAborted()
              remember(cacheKey, blob)
            } finally { clearTimeout(timeout) }
          }
          if (version !== revision || active !== turn) return false
          await play(blob, turn)
        }
        return true
      } catch (error) {
        const reason = turn.controller.signal.aborted ? turn.controller.signal.reason : error
        if (version === revision && reason?.name !== 'AbortError') notify('朗读未完成：' + (reason?.message || '请重试'))
        return false
      } finally {
        if (active === turn) { active = null; emit() }
      }
    }
    const chime = kind => {
      if (!prefs.effects || document.hidden) return
      try {
        const Context = window.AudioContext || window.webkitAudioContext
        if (!Context) return
        if (!soundContext) soundContext = new Context()
        // This can only unlock after a real pointer/keyboard gesture.
        if (soundContext.state === 'suspended') soundContext.resume().catch(() => {})
        if (soundContext.state !== 'running') return
        const now = soundContext.currentTime
        const notes = kind === 'done' ? [784, 1047] : [659, 880]
        notes.forEach((frequency, i) => {
          const osc = soundContext.createOscillator(), gain = soundContext.createGain()
          osc.type = 'sine'; osc.frequency.value = frequency
          gain.gain.setValueAtTime(0, now + i * .065)
          gain.gain.linearRampToValueAtTime(.023, now + i * .065 + .015)
          gain.gain.exponentialRampToValueAtTime(.0001, now + i * .065 + .18)
          osc.connect(gain); gain.connect(soundContext.destination)
          osc.start(now + i * .065); osc.stop(now + i * .065 + .2)
          osc.onended = () => { osc.disconnect(); gain.disconnect() }
        })
      } catch (_) {}
    }
    window.addEventListener?.('pagehide', () => stop({ clearCache: true }))
    return { speak, stop, chime, configure, preferences: () => ({ ...prefs }),
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
      state: () => active ? { id: active.id, phase: active.phase } : null,
      clearCache: () => { cache.clear(); audioBytes = 0; cacheAccount = null } }
  }
  const mount = ({ panel, controller, isChat = () => true, onOpen = () => {} }) => {
    const button = document.createElement('button')
    button.type = 'button'; button.className = 'nanaly-voice-menu'; button.textContent = '声音'
    button.setAttribute('aria-label', '声音与朗读设置'); button.setAttribute('aria-expanded', 'false')
    const drawer = document.createElement('section')
    drawer.className = 'nanaly-voice-settings'; drawer.hidden = true
    drawer.setAttribute('aria-label', '声音与朗读设置')
    const title = document.createElement('h3'); title.textContent = '听听娜娜莉的声音'
    const close = document.createElement('button'); close.type = 'button'; close.className = 'nanaly-voice-close'; close.textContent = '×'; close.setAttribute('aria-label', '关闭声音设置')
    const intro = document.createElement('p'); intro.textContent = 'AI 合成女声 · 清甜一点，嘴硬心软一点。'
    const label = (text, control) => { const wrap = document.createElement('label'); const span = document.createElement('span'); span.textContent = text; wrap.append(span, control); return wrap }
    const style = document.createElement('select'); style.setAttribute('aria-label', '娜娜莉的声线')
    Object.entries(STYLES).forEach(([value, item]) => { const option = document.createElement('option'); option.value = value; option.textContent = item.name; style.append(option) })
    const speed = document.createElement('input'); speed.type = 'range'; speed.min = '.8'; speed.max = '1.3'; speed.step = '.02'; speed.setAttribute('aria-label', '朗读语速')
    const speedValue = document.createElement('output')
    const auto = document.createElement('input'); auto.type = 'checkbox'; auto.setAttribute('aria-label', '自动朗读新回复')
    const effects = document.createElement('input'); effects.type = 'checkbox'; effects.setAttribute('aria-label', '轻柔提示音')
    const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'nanaly-voice-preview'; preview.textContent = '试听一下'
    const hint = document.createElement('p'); hint.className = 'nanaly-voice-hint'; hint.textContent = '共用已保存的硅基流动密钥。朗读按服务商计费，自动朗读默认关闭。'
    drawer.append(close, title, intro, label('声线', style), label('语速', speed), speedValue, label('自动朗读新回复', auto), label('轻柔提示音', effects), preview, hint)
    const host = panel.querySelector('.nanaly-shell-actions') || panel.querySelector('.nanaly-shell-bar') || panel.querySelector('.nanaly-workspace-bar')
    host?.append(button); panel.append(drawer)
    const sync = () => { const prefs = controller.preferences(); style.value = prefs.style; speed.value = prefs.speed; speedValue.textContent = prefs.speed.toFixed(2) + '×'; auto.checked = prefs.autoplay; effects.checked = prefs.effects }
    const hide = () => { drawer.hidden = true; button.setAttribute('aria-expanded', 'false') }
    button.onclick = () => { if (!isChat()) return; if (drawer.hidden) { onOpen(); sync(); drawer.hidden = false; button.setAttribute('aria-expanded', 'true'); style.focus() } else hide() }
    close.onclick = () => { hide(); button.focus() }
    drawer.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); hide(); button.focus() } })
    const update = () => { controller.configure({ style: style.value, speed: Number(speed.value), autoplay: auto.checked, effects: effects.checked }); sync() }
    ;[style, speed, auto, effects].forEach(control => control.addEventListener('change', update))
    speed.addEventListener('input', () => { speedValue.textContent = Number(speed.value).toFixed(2) + '×' })
    preview.onclick = () => controller.speak('哼，终于想起我啦？把难题交给我吧。才、才不是特地在等你呢，喵。', { id: 'voice-preview' })
    controller.subscribe(state => { preview.textContent = state?.id === 'voice-preview' ? (state.phase === 'loading' ? '生成中 · 点击停止' : '停止试听') : '试听一下' })
    sync()
    return { close: hide, refresh: () => { button.disabled = !isChat(); if (!isChat() || !panel.classList.contains('is-open')) hide() } }
  }
  window.NANALY_VOICE = Object.freeze({ MODEL, STYLES, cleanText, splitText, endpoint, normalize, create, mount })
})()
