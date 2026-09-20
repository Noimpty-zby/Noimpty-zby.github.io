/* SiliconFlow speech. Credentials stay in the existing unlocked vault. */
(() => {
  'use strict'
  if (window.NANALY_VOICE) return
  const MODEL = 'FunAudioLLM/CosyVoice2-0.5B'
  const KEY = 'nanaly-voice-v1'
  const END_DRAIN_MS = 500
  const ENDING = '每个字完整发音，尤其不要省略最后一个字的尾音，句尾自然收住。'
  const NEUTRAL = '请用平静自然、清楚克制的语气朗读，不刻意表现开心或悲伤。'
  const STYLES = Object.freeze({
    cat: { name: '清甜猫娘', voice: 'diana', instruction: '请保持清甜、稍高的女性动漫角色声线，音色轻盈可爱。普通话清晰自然，不要尖叫。' },
    soft: { name: '温柔陪伴', voice: 'claire', instruction: '请保持温柔清甜的女声音色，吐字清楚自然。' },
    bright: { name: '元气满满', voice: 'diana', instruction: '请保持明亮、有活力的女性动漫角色声线，声音通透，不要夸张尖叫。' }
  })
  const normalize = value => ({
    style: STYLES[value?.style] ? value.style : 'cat',
    speed: Number.isFinite(Number(value?.speed)) ? Math.min(1.3, Math.max(0.8, Number(value.speed))) : 1.04,
    autoplay: value?.autoplay === true,
    emotion: value?.emotion !== false,
    effects: value?.effects !== false
  })
  const cleanText = text => window.NANALY_PROSODY?.cleanText ? window.NANALY_PROSODY.cleanText(text) : String(text || '')
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
  const create = ({ getConnection, notify = () => {}, onNeedKey = () => {}, onUsage = () => {}, fetcher = (...args) => window.fetch(...args), makeAudio = () => new Audio() } = {}) => {
    let prefs
    try { prefs = normalize(JSON.parse(window.localStorage.getItem(KEY) || '{}')) } catch (_) { prefs = normalize() }
    let revision = 0, active = null, soundContext = null, audioBytes = 0, cacheAccount = null
    const cache = new Map(), plans = new Map(), listeners = new Set()
    const emit = () => listeners.forEach(listener => listener(active ? { id: active.id, phase: active.phase } : null))
    const stop = ({ clearCache = false } = {}) => {
      revision++
      const prior = active
      active = null
      // The playback abort listener owns cleanup, including the natural-end grace period.
      if (prior) prior.controller.abort()
      if (clearCache) { cache.clear(); plans.clear(); audioBytes = 0; cacheAccount = null }
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
    const forget = key => {
      if (cache.has(key)) audioBytes -= cache.get(key).size
      cache.delete(key)
    }
    const planSpeech = async (text, context, connection, turn) => {
      const planner = window.NANALY_PROSODY
      const fallback = () => splitText(text).map(text => ({ text, instruction: NEUTRAL }))
      const model = connection.model || 'Pro/moonshotai/Kimi-K2.6'
      const cacheKey = JSON.stringify([model, text, context])
      if (plans.has(cacheKey)) return plans.get(cacheKey)
      turn.phase = 'planning'; emit()
      const controller = new AbortController()
      const abort = () => controller.abort(turn.controller.signal.reason)
      turn.controller.signal.addEventListener('abort', abort, { once: true })
      const timeout = setTimeout(() => controller.abort(new DOMException('语气理解超时', 'TimeoutError')), 30000)
      try {
        turn.controller.signal.throwIfAborted()
        if (!planner || !window.NANALY_PROVIDER) throw new Error('语气模块尚未加载')
        const prepared = planner.prepare(text, { context })
        const request = window.NANALY_PROVIDER.request({
          cfg: { visionBaseURL: connection.baseURL || 'https://api.siliconflow.cn/v1', visionModel: model },
          secrets: { visionKey: connection.key }, messages: prepared.messages,
          vision: true, deep: false, stream: false
        })
        // Kimi is a vision model: strict JSON is requested in the prompt and
        // validated locally, without assuming support for forced JSON mode.
        const response = await fetcher(request.url, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + request.key },
          body: JSON.stringify({ ...request.payload, temperature: 0, max_tokens: 8192 }), signal: controller.signal
        })
        if (!response.ok) throw await speechError(response)
        const result = await response.json()
        controller.signal.throwIfAborted(); turn.controller.signal.throwIfAborted()
        if (result.usage) { try { onUsage(result.usage) } catch (_) {} }
        const choice = result.choices?.[0]
        if (choice?.finish_reason === 'length') throw new Error('语气结果未完整生成')
        const plan = planner.parse(choice?.message?.content, prepared)
        // Merge adjacent phrases with identical delivery, preserving all text.
        const chunks = []
        for (const segment of plan.segments) {
          const previous = chunks[chunks.length - 1]
          if (previous && previous.instruction === segment.instruction && previous.text.length + segment.text.length <= 450) previous.text += segment.text
          else chunks.push({ text: segment.text, instruction: segment.instruction })
        }
        plans.set(cacheKey, chunks)
        while (plans.size > 16) plans.delete(plans.keys().next().value)
        return chunks
      } catch (error) {
        turn.controller.signal.throwIfAborted()
        notify('这次语气识别未完成，先用平静语气朗读。')
        return fallback()
      } finally {
        clearTimeout(timeout)
        turn.controller.signal.removeEventListener('abort', abort)
      }
    }
    const play = (blob, turn) => new Promise((resolve, reject) => {
      if (turn.controller.signal.aborted) return reject(turn.controller.signal.reason)
      const audio = makeAudio(), url = URL.createObjectURL(blob)
      turn.audio = audio; turn.url = url
      const signal = turn.controller.signal
      let settled = false, drainTimer = null
      const finish = error => {
        if (settled) return
        settled = true
        if (drainTimer !== null) clearTimeout(drainTimer)
        signal.removeEventListener('abort', abort)
        audio.onended = audio.onerror = null
        // Reset only interrupted/failed playback. A natural end should be allowed to
        // drain to the output device without resetting the decoder at its final frame.
        if (error) { audio.pause(); audio.removeAttribute?.('src'); audio.load?.() }
        URL.revokeObjectURL(url)
        if (turn.audio === audio) turn.audio = null
        if (turn.url === url) turn.url = null
        error ? reject(error) : resolve()
      }
      const abort = () => finish(signal.reason || new DOMException('停止朗读', 'AbortError'))
      signal.addEventListener('abort', abort, { once: true })
      audio.onended = () => {
        if (!settled && drainTimer === null) drainTimer = setTimeout(() => finish(), END_DRAIN_MS)
      }
      audio.onerror = () => {
        const error = new Error('浏览器无法播放这段音频，请重试。')
        error.code = 'NANALY_AUDIO_DECODE'
        finish(error)
      }
      audio.src = url
      turn.phase = 'playing'; emit()
      Promise.resolve().then(() => { signal.throwIfAborted(); return audio.play() }).catch(error => finish(error?.name === 'NotAllowedError'
        ? new Error('声音已生成，请再点一次朗读来允许播放。') : error))
    })
    const speak = async (text, { id = 'preview', automatic = false, context = '' } = {}) => {
      if (automatic && (!prefs.autoplay || document.hidden)) return false
      if (automatic && active) return false
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
        if (cacheAccount?.url !== url || cacheAccount?.key !== connection.key || cacheAccount?.model !== connection.model) {
          cache.clear(); plans.clear(); audioBytes = 0
          cacheAccount = { url, key: connection.key, model: connection.model }
        }
        const parts = settings.emotion
          ? await planSpeech(String(text), String(context || '').slice(0, 1200), connection, turn)
          : splitText(text).map(text => ({ text, instruction: NEUTRAL }))
        for (const part of parts) {
          turn.controller.signal.throwIfAborted()
          // A complete sentence also gives synthesis an explicit ending for bare headings.
          const phrase = part.text.trim()
          const utterance = /[。！？!?….，,；;：:、][”’"'）)」』]*$/.test(phrase) ? phrase : phrase + '。'
          const instruction = style.instruction + part.instruction + '情绪只通过语调、节奏和重音表达，不添加原文没有的笑声、哭声、喵或其他字词，不念语气说明。' + ENDING
          const cacheKey = JSON.stringify([url, settings.style, settings.speed, 'wav-emotion-v1', instruction, utterance])
          let blob = cache.get(cacheKey)
          if (!blob) {
            turn.phase = 'loading'; emit()
            const timeout = setTimeout(() => turn.controller.abort(new DOMException('声音生成超时，请重试。', 'TimeoutError')), 60000)
            try {
              const response = await fetcher(url, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + connection.key },
                body: JSON.stringify({ model: MODEL, voice: MODEL + ':' + style.voice,
                  input: instruction + '<|endofprompt|>' + utterance,
                  response_format: 'wav', sample_rate: 24000, stream: false, speed: settings.speed }),
                signal: turn.controller.signal
              })
              if (!response.ok) throw await speechError(response)
              if (/json|text\//i.test(response.headers?.get('content-type') || '')) throw new Error('语音服务返回了异常内容，请稍后重试。')
              blob = await response.blob()
              if (!blob.size || blob.size > 12 * 1024 * 1024) throw new Error('语音服务没有返回可播放的音频。')
              // Tail padding is optional. Browser decoders can accept WAV headers
              // this conservative editor cannot safely rewrite. Keep those bytes
              // intact and let the player decide; never guess where speech ends.
              if (window.NANALY_AUDIO) {
                try { blob = await window.NANALY_AUDIO.padWav(blob, .35) }
                catch (error) {
                  if (error?.code !== 'NANALY_INVALID_WAV') throw error
                  turn.controller.signal.throwIfAborted()
                }
              }
              turn.controller.signal.throwIfAborted()
              remember(cacheKey, blob)
            } finally { clearTimeout(timeout) }
          }
          if (version !== revision || active !== turn) return false
          try { await play(blob, turn) }
          catch (error) {
            // Failed media must not poison retries. Keep useful cached audio when
            // the user stops or the browser merely requires another click to play.
            if (error?.code === 'NANALY_AUDIO_DECODE' || error?.name === 'NotSupportedError') forget(cacheKey)
            throw error
          }
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
      clearCache: () => { cache.clear(); plans.clear(); audioBytes = 0; cacheAccount = null } }
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
    const emotion = document.createElement('input'); emotion.type = 'checkbox'; emotion.setAttribute('aria-label', '随文字表达情绪')
    const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'nanaly-voice-preview'; preview.textContent = '试听一下'
    const hint = document.createElement('p'); hint.className = 'nanaly-voice-hint'; hint.textContent = '共用硅基流动密钥。理解语气会额外使用少量模型额度，不确定时平静朗读；语音另行计费。自动朗读默认关闭。'
    drawer.append(close, title, intro, label('声线', style), label('语速', speed), speedValue, label('随文字表达情绪', emotion), label('自动朗读新回复', auto), label('轻柔提示音', effects), preview, hint)
    const host = panel.querySelector('.nanaly-shell-actions') || panel.querySelector('.nanaly-shell-bar') || panel.querySelector('.nanaly-workspace-bar')
    host?.append(button); panel.append(drawer)
    const sync = () => { const prefs = controller.preferences(); style.value = prefs.style; speed.value = prefs.speed; speedValue.textContent = prefs.speed.toFixed(2) + '×'; auto.checked = prefs.autoplay; effects.checked = prefs.effects; emotion.checked = prefs.emotion }
    const hide = () => { drawer.hidden = true; button.setAttribute('aria-expanded', 'false') }
    button.onclick = () => { if (!isChat()) return; if (drawer.hidden) { onOpen(); sync(); drawer.hidden = false; button.setAttribute('aria-expanded', 'true'); style.focus() } else hide() }
    close.onclick = () => { hide(); button.focus() }
    drawer.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); hide(); button.focus() } })
    const update = () => { controller.configure({ style: style.value, speed: Number(speed.value), autoplay: auto.checked, effects: effects.checked, emotion: emotion.checked }); sync() }
    ;[style, speed, auto, effects, emotion].forEach(control => control.addEventListener('change', update))
    speed.addEventListener('input', () => { speedValue.textContent = Number(speed.value).toFixed(2) + '×' })
    preview.onclick = () => controller.speak('哼，终于想起我啦？把难题交给我吧。才、才不是特地在等你呢，喵。', { id: 'voice-preview' })
    controller.subscribe(state => { preview.textContent = state?.id === 'voice-preview' ? (state.phase === 'planning' ? '理解语气… · 点击停止' : state.phase === 'loading' ? '生成中 · 点击停止' : '停止试听') : '试听一下' })
    sync()
    return { close: hide, refresh: () => { button.disabled = !isChat(); if (!isChat() || !panel.classList.contains('is-open')) hide() } }
  }
  window.NANALY_VOICE = Object.freeze({ MODEL, STYLES, cleanText, splitText, endpoint, normalize, create, mount })
})()
