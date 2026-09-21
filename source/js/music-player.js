(() => {
  if (window.NOIMPTY_MUSIC_PLAYER) return

  const tracks = [
    { title: '泽尼希的残光', artist: '三Z-STUDIO, HOYO-MiX', src: '/music/zenith-afterglow.mp3' },
    { title: 'time to play', artist: '三Z-STUDIO, HOYO-MiX', src: '/music/time-to-play.mp3' },
    { title: '运斤成风', artist: '三Z-STUDIO, HOYO-MiX', src: '/music/masterful-strokes.mp3' },
    { title: '秩序', artist: '三Z-STUDIO, HOYO-MiX', src: '/music/order.mp3' },
    { title: '越界警示', artist: '三Z-STUDIO, HOYO-MiX', src: '/music/boundary-warning.mp3' },
    { title: '不堪停驻的飞鸟', artist: '三Z-STUDIO, HOYO-MiX', src: '/music/restless-bird.mp3' },
    { title: '芭莱迷宫·黑夜', artist: '三Z-STUDIO, HOYO-MiX', src: '/music/ballet-labyrinth-night.mp3' },
    { title: '混沌ε', artist: '三Z-STUDIO, HOYO-MiX', src: '/music/chaos-epsilon.mp3' },
    { title: '混沌ζ', artist: '三Z-STUDIO, HOYO-MiX', src: '/music/chaos-zeta.mp3' },
    { title: '骸', artist: '三Z-STUDIO, HOYO-MiX', src: '/music/remains.mp3' }
  ]

  const storageKey = 'noimpty-music-player-v1'
  const readState = () => {
    try {
      const value = JSON.parse(window.localStorage.getItem(storageKey) || '{}')
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    } catch (_) { return {} }
  }

  const saved = readState()
  const randomStart = Math.floor(Math.random() * tracks.length)
  let currentIndex = Number.isInteger(saved.index) && saved.index >= 0 && saved.index < tracks.length
    ? saved.index
    : randomStart
  let shuffleEnabled = saved.shuffle !== false
  // 默认收起：新访客首次进入只看到一个小图标，不遮挡正文；
  // 一旦手动展开过，localStorage 里会存下 collapsed:false，之后保持展开。
  let collapsed = saved.collapsed !== false
  let pendingTime = Number.isFinite(saved.currentTime) ? Math.max(0, saved.currentTime) : 0
  let resumeRequested = saved.playing === true
  let shuffleBag = []
  let history = [currentIndex]
  let historyCursor = 0
  let lastPersistAt = 0
  let playbackRequest = 0

  const player = document.createElement('aside')
  player.id = 'noimpty-music-player'
  player.className = collapsed ? 'is-collapsed' : ''
  player.setAttribute('aria-label', '我喜欢的音乐播放器')
  player.innerHTML = `
    <button class="noimpty-music-launcher" type="button" data-action="expand" aria-label="展开音乐播放器" title="展开音乐播放器">
      <i class="fas fa-music" aria-hidden="true"></i>
    </button>
    <div class="noimpty-music-panel">
      <div class="noimpty-music-topline">
        <div class="noimpty-music-disc noimpty-music-stage" aria-hidden="true" data-stage="idle">
          <span class="noimpty-music-stage__note noimpty-music-stage__note--one">♪</span>
          <span class="noimpty-music-stage__bars">${Array.from({ length: 14 }, () => '<i class="noimpty-music-stage__bar"></i>').join('')}</span>
          <span class="noimpty-music-stage__note noimpty-music-stage__note--two">♫</span>
        </div>
        <div class="noimpty-music-meta">
          <span class="noimpty-music-kicker">给今天一点旋律 ♡</span>
          <strong class="noimpty-music-title"></strong>
          <span class="noimpty-music-artist"></span>
        </div>
        <button class="noimpty-music-collapse" type="button" data-action="collapse" aria-label="收起音乐播放器" title="收起">
          <i class="fas fa-chevron-left" aria-hidden="true"></i>
        </button>
      </div>

      <div class="noimpty-music-progress-row">
        <span class="noimpty-music-current">0:00</span>
        <input class="noimpty-music-progress" type="range" min="0" max="1000" value="0" step="1" aria-label="播放进度">
        <span class="noimpty-music-duration">0:00</span>
      </div>

      <div class="noimpty-music-controls">
        <button type="button" data-action="shuffle" aria-label="切换随机播放" title="随机播放" aria-pressed="true">
          <i class="fas fa-shuffle" aria-hidden="true"></i>
        </button>
        <button type="button" data-action="previous" aria-label="上一首" title="上一首">
          <i class="fas fa-backward-step" aria-hidden="true"></i>
        </button>
        <button class="noimpty-music-play" type="button" data-action="play" aria-label="播放" title="播放">
          <i class="fas fa-play" aria-hidden="true"></i>
        </button>
        <button type="button" data-action="next" aria-label="下一首" title="下一首">
          <i class="fas fa-forward-step" aria-hidden="true"></i>
        </button>
        <label class="noimpty-music-volume" title="音量">
          <i class="fas fa-volume-high" aria-hidden="true"></i>
          <input type="range" min="0" max="1" value="0.45" step="0.01" aria-label="音量">
        </label>
      </div>

      <p class="noimpty-music-status" role="status" aria-live="polite"></p>
      <audio preload="metadata"></audio>
    </div>`

  document.body.appendChild(player)

  const audio = player.querySelector('audio')
  const titleElement = player.querySelector('.noimpty-music-title')
  const artistElement = player.querySelector('.noimpty-music-artist')
  const statusElement = player.querySelector('.noimpty-music-status')
  const currentElement = player.querySelector('.noimpty-music-current')
  const durationElement = player.querySelector('.noimpty-music-duration')
  const progressElement = player.querySelector('.noimpty-music-progress')
  const volumeElement = player.querySelector('.noimpty-music-volume input')
  const volumeIcon = player.querySelector('.noimpty-music-volume i')
  const playButton = player.querySelector('[data-action="play"]')
  const playIcon = playButton.querySelector('i')
  const shuffleButton = player.querySelector('[data-action="shuffle"]')

  const stage = (() => {
    const element = player.querySelector('.noimpty-music-stage')
    if (!element) return { activate() {}, refresh() {}, waiting() {}, playing() {}, changeTrack() {}, energy: () => 0 }
    const bars = Array.from(element.querySelectorAll('.noimpty-music-stage__bar'))
    const reduced = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    const connection = navigator.connection
    let context, analyser, capture, source, sourceTrack, samples, resuming
    /* 这一帧的整体能量（0~1）。可视化条自己用不着留，但 Mao 要拿它驱动头发和
       罩袍的摆动 —— 让她再建一套 AudioContext 是浪费，而且 captureStream 这条
       侧路本来就只该开一份。 */
    let lastEnergy = 0
    let frame = 0
    let lastPaint = -Infinity
    let disabled = false
    let buffering = true
    let pageVisible = true
    let previousTrack = ''
    let titleAnimations = []

    const allowed = () => !collapsed && !document.hidden && pageVisible && !reduced?.matches && !connection?.saveData
    const audible = () => !audio.paused && !audio.ended && !audio.error && !buffering
    const cancelTitles = () => {
      titleAnimations.forEach(animation => { try { animation.cancel() } catch (_) {} })
      titleAnimations = []
    }
    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = 0
      lastPaint = -Infinity
      player.removeAttribute('data-stage-running')
      lastEnergy = 0
      element.dataset.stage = disabled ? 'unavailable' : 'idle'
      element.style.setProperty('--stage-energy', '0')
      bars.forEach(bar => bar.style.setProperty('--level', '0.08'))
    }
    const fail = () => {
      disabled = true
      stop()
      try { source?.disconnect() } catch (_) {}
      source = null
      if (capture) {
        capture.removeEventListener('addtrack', bindSource)
        capture.removeEventListener('removetrack', bindSource)
      }
      try { if (context && context.state !== 'closed') Promise.resolve(context.close()).catch(() => {}) } catch (_) {}
    }
    const paint = time => {
      frame = 0
      if (!allowed() || !audible() || disabled || !source || context?.state !== 'running') { stop(); return }
      try {
        // Limit DOM writes to 30fps. Every value comes from the captured audio;
        // the quiet baseline is static, never a simulated/random equalizer.
        if (time - lastPaint >= 1000 / 30) {
          analyser.getByteFrequencyData(samples)
          const volume = audio.muted ? 0 : audio.volume
          let energy = 0
          bars.forEach((bar, index) => {
            const from = Math.floor(Math.pow(samples.length, index / bars.length)) - 1
            const to = Math.max(from + 1, Math.floor(Math.pow(samples.length, (index + 1) / bars.length)))
            let peak = 0
            for (let bin = from; bin < to; bin++) peak = Math.max(peak, samples[bin] || 0)
            // A gentle perceptual curve keeps the 52px stage legible at low volume.
            const level = Math.sqrt((peak / 255) * volume)
            energy += level
            bar.style.setProperty('--level', Math.max(0.08, level).toFixed(3))
          })
          lastEnergy = energy / bars.length
          element.style.setProperty('--stage-energy', lastEnergy.toFixed(3))
          element.dataset.stage = 'live'
          player.setAttribute('data-stage-running', 'true')
          lastPaint = time
        }
        frame = window.requestAnimationFrame(paint)
      } catch (_) { fail() }
    }
    const resume = () => {
      if (resuming || !context || context.state !== 'suspended') return
      // This side graph can be suspended/rejected without affecting audio.play().
      // Do not wait for it before playing or retry a refused context in a loop.
      try {
        resuming = Promise.resolve(context.resume()).then(() => {
          resuming = null
          if (context.state === 'running') refresh()
        }, () => { resuming = null; fail() })
      } catch (_) { fail() }
    }
    const refresh = () => {
      if (!allowed()) cancelTitles()
      if (disabled || !allowed() || !audible() || !source || context?.state !== 'running') {
        stop()
        if (!disabled && allowed() && audible()) resume()
        return
      }
      if (!frame) frame = window.requestAnimationFrame(paint)
    }
    const bindSource = () => {
      if (disabled || !capture || !context || context.state === 'closed') return
      try {
        const track = capture.getAudioTracks().find(track => track.readyState !== 'ended')
        if (track !== sourceTrack) {
          source?.disconnect()
          source = null
          sourceTrack = track
          if (track) {
            source = context.createMediaStreamSource(new window.MediaStream([track]))
            source.connect(analyser)
          }
        }
        refresh()
      } catch (_) { fail() }
    }
    const activate = () => {
      if (disabled || !allowed()) return
      if (context) { resume(); refresh(); return }
      const AudioContext = window.AudioContext || window.webkitAudioContext
      const captureStream = audio.captureStream || audio.mozCaptureStream
      if (!AudioContext || typeof captureStream !== 'function' || typeof window.MediaStream !== 'function') { fail(); return }
      try {
        context = new AudioContext()
        analyser = context.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.72
        samples = new Uint8Array(analyser.frequencyBinCount)
        // Capture is a side channel. Never create a MediaElementSource or connect
        // this graph to destination: either would reroute or duplicate playback.
        // See https://www.w3.org/TR/mediacapture-fromelement/#html-media-element-media-capture-extensions
        capture = captureStream.call(audio)
        capture.addEventListener('addtrack', bindSource)
        capture.addEventListener('removetrack', bindSource)
        context.addEventListener('statechange', () => {
          if (disabled) return
          if (context.state === 'closed') fail()
          else refresh()
        })
        bindSource()
        resume()
      } catch (_) { fail() }
    }
    const changeTrack = track => {
      const changed = previousTrack && previousTrack !== track.src
      previousTrack = track.src
      cancelTitles()
      if (!changed || !allowed()) return
      ;[titleElement, artistElement].forEach((node, index) => {
        if (typeof node.animate !== 'function') return
        try {
          titleAnimations.push(node.animate([
            { opacity: 0.25, transform: 'translateY(5px)' },
            { opacity: 1, transform: 'translateY(0)' }
          ], { duration: 260 + index * 40, easing: 'cubic-bezier(.2,.8,.2,1)' }))
        } catch (_) {}
      })
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('pagehide', () => { pageVisible = false; refresh() })
    window.addEventListener('pageshow', () => { pageVisible = true; refresh() })
    if (reduced?.addEventListener) reduced.addEventListener('change', refresh)
    else if (reduced?.addListener) reduced.addListener(refresh)
    connection?.addEventListener?.('change', refresh)
    stop()
    return {
      activate, refresh, changeTrack,
      energy: () => lastEnergy,
      waiting: () => { buffering = true; refresh() },
      playing: () => { buffering = false; bindSource(); refresh() }
    }
  })()

  const clampVolume = value => Math.max(0, Math.min(1, Number(value)))
  audio.volume = Number.isFinite(saved.volume) ? clampVolume(saved.volume) : 0.45
  volumeElement.value = String(audio.volume)

  const formatTime = value => {
    if (!Number.isFinite(value) || value < 0) return '0:00'
    const total = Math.floor(value)
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  }

  const setStatus = message => { statusElement.textContent = message }

  const persist = () => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({
        index: currentIndex,
        currentTime: pendingTime || (Number.isFinite(audio.currentTime) ? audio.currentTime : 0),
        volume: audio.volume,
        shuffle: shuffleEnabled,
        collapsed,
        playing: resumeRequested || (!audio.paused && !audio.ended)
      }))
    } catch (_) {}
  }

  const updateVolumeIcon = () => {
    volumeIcon.className = audio.volume === 0
      ? 'fas fa-volume-xmark'
      : audio.volume < 0.5 ? 'fas fa-volume-low' : 'fas fa-volume-high'
  }

  const updateShuffle = () => {
    shuffleButton.classList.toggle('is-active', shuffleEnabled)
    shuffleButton.setAttribute('aria-pressed', String(shuffleEnabled))
    setStatus(`${shuffleEnabled ? '随机播放' : '顺序播放'} · ${currentIndex + 1}/${tracks.length}`)
  }

  const updatePlayState = () => {
    const playing = !audio.paused && !audio.ended
    player.classList.toggle('is-playing', playing)
    playIcon.className = playing ? 'fas fa-pause' : 'fas fa-play'
    playButton.setAttribute('aria-label', playing ? '暂停' : '播放')
    playButton.title = playing ? '暂停' : '播放'
    stage.refresh()
  }

  const updateTrackMeta = () => {
    const track = tracks[currentIndex]
    titleElement.textContent = track.title
    artistElement.textContent = track.artist
    stage.changeTrack(track)
    player.style.setProperty('--music-track-number', `'${currentIndex + 1}'`)
    updateShuffle()

    if ('mediaSession' in navigator && typeof MediaMetadata === 'function') {
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist })
    }
  }

  const refillShuffleBag = () => {
    shuffleBag = tracks.map((_, index) => index).filter(index => index !== currentIndex)
    for (let i = shuffleBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffleBag[i], shuffleBag[j]] = [shuffleBag[j], shuffleBag[i]]
    }
  }

  const takeRandomIndex = () => {
    if (shuffleBag.length === 0) refillShuffleBag()
    return shuffleBag.pop()
  }

  const tryPlay = async () => {
    const request = ++playbackRequest
    resumeRequested = true
    let played = false
    try {
      await audio.play()
      if (request !== playbackRequest) return false
      resumeRequested = false
      played = true
      setStatus(`${shuffleEnabled ? '随机播放' : '顺序播放'} · ${currentIndex + 1}/${tracks.length}`)
    } catch (_) {
      if (request !== playbackRequest) return false
      resumeRequested = false
      setStatus('点击播放键开始播放')
    }
    updatePlayState()
    persist()
    return played
  }

  const loadTrack = (index, options = {}) => {
    const { autoplay = false, recordHistory = true, restoreTime = 0 } = options
    playbackRequest++
    currentIndex = (index + tracks.length) % tracks.length
    pendingTime = Math.max(0, Number(restoreTime) || 0)
    resumeRequested = autoplay

    if (recordHistory) {
      history = history.slice(0, historyCursor + 1)
      if (history[history.length - 1] !== currentIndex) history.push(currentIndex)
      historyCursor = history.length - 1
    }

    stage.waiting()
    audio.src = tracks[currentIndex].src
    audio.load()
    progressElement.value = '0'
    currentElement.textContent = '0:00'
    durationElement.textContent = '0:00'
    updateTrackMeta()
    updatePlayState()
    persist()
  }

  const nextTrack = (opts = {}) => {
    // 注意：一曲自然播完时，audio.paused 已经变成 true 了。
    // 所以不能只靠它判断「刚才是不是在放」—— 那样自动续播永远是 false，
    // 表现就是「切到了下一首但不响」。ended 触发时必须显式要求继续播。
    const autoplay = opts.forcePlay === true || resumeRequested || !audio.paused
    if (historyCursor < history.length - 1) {
      historyCursor += 1
      loadTrack(history[historyCursor], { autoplay, recordHistory: false })
      return
    }

    const nextIndex = shuffleEnabled ? takeRandomIndex() : (currentIndex + 1) % tracks.length
    loadTrack(nextIndex, { autoplay })
  }

  const previousTrack = (opts = {}) => {
    const autoplay = opts.forcePlay === true || resumeRequested || !audio.paused
    if (historyCursor > 0) {
      historyCursor -= 1
      loadTrack(history[historyCursor], { autoplay, recordHistory: false })
      return
    }

    const previousIndex = shuffleEnabled ? takeRandomIndex() : (currentIndex - 1 + tracks.length) % tracks.length
    loadTrack(previousIndex, { autoplay })
  }

  const pause = () => {
    playbackRequest++
    resumeRequested = false
    audio.pause()
    updatePlayState()
    persist()
  }

  player.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]')
    if (!button) return

    switch (button.dataset.action) {
      case 'expand':
        collapsed = false
        player.classList.remove('is-collapsed')
        if (event.isTrusted && !audio.paused) stage.activate()
        stage.refresh()
        persist()
        break
      case 'collapse':
        collapsed = true
        player.classList.add('is-collapsed')
        stage.refresh()
        persist()
        break
      case 'play':
        if (audio.paused && !resumeRequested) {
          if (event.isTrusted) stage.activate()
          tryPlay()
        }
        else pause()
        break
      case 'previous':
        if (event.isTrusted && !audio.paused) stage.activate()
        previousTrack()
        break
      case 'next':
        if (event.isTrusted && !audio.paused) stage.activate()
        nextTrack()
        break
      case 'shuffle':
        shuffleEnabled = !shuffleEnabled
        shuffleBag = []
        updateShuffle()
        persist()
        break
    }
  })

  progressElement.addEventListener('input', () => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return
    audio.currentTime = (Number(progressElement.value) / 1000) * audio.duration
    currentElement.textContent = formatTime(audio.currentTime)
    persist()
  })

  volumeElement.addEventListener('input', () => {
    audio.volume = clampVolume(volumeElement.value)
    updateVolumeIcon()
    persist()
  })

  audio.addEventListener('loadedmetadata', () => {
    durationElement.textContent = formatTime(audio.duration)
    if (pendingTime > 0 && pendingTime < audio.duration) audio.currentTime = pendingTime
    currentElement.textContent = formatTime(audio.currentTime)
    pendingTime = 0

    if (resumeRequested) {
      resumeRequested = false
      tryPlay()
    }
  })

  audio.addEventListener('timeupdate', () => {
    currentElement.textContent = formatTime(audio.currentTime)
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      progressElement.value = String(Math.round((audio.currentTime / audio.duration) * 1000))
    }

    const now = Date.now()
    if (now - lastPersistAt > 1500) {
      lastPersistAt = now
      persist()
    }
  })

  audio.addEventListener('play', updatePlayState)
  audio.addEventListener('playing', stage.playing)
  audio.addEventListener('waiting', stage.waiting)
  audio.addEventListener('emptied', stage.waiting)
  audio.addEventListener('pause', () => { updatePlayState(); persist() })
  // 包一层，别把 Event 对象当成 opts 传进去
  audio.addEventListener('ended', () => nextTrack({ forcePlay: true }))
  audio.addEventListener('error', () => {
    stage.waiting()
    resumeRequested = false
    setStatus('当前音频加载失败，请切换下一首')
    updatePlayState()
  })

  window.addEventListener('pagehide', persist)

  if ('mediaSession' in navigator) {
    const handlers = {
      play: () => { stage.activate(); return tryPlay() },
      pause,
      previoustrack: () => previousTrack(),
      nexttrack: () => nextTrack()
    }
    Object.entries(handlers).forEach(([action, handler]) => {
      try { navigator.mediaSession.setActionHandler(action, handler) } catch (_) {}
    })
  }

  updateVolumeIcon()
  updateShuffle()
  loadTrack(currentIndex, { autoplay: resumeRequested, recordHistory: false, restoreTime: pendingTime })

  window.NOIMPTY_MUSIC_PLAYER = Object.freeze({
    tracks,
    audio,
    /* 当前这一帧的整体能量 0~1，可视化条算好的那个值。没在放、可视化没起来
       或者用户要求减少动效时都是 0。Mao 拿它驱动头发和罩袍摆动 ——
       她**不该**自己再建一套 AudioContext：captureStream 这条侧路只该开一份。 */
    energy: () => stage.energy(),
    play: tryPlay,
    pause,
    previous: () => previousTrack(),
    next: () => nextTrack()
  })
})()
