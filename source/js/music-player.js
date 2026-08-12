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
    try { return JSON.parse(window.localStorage.getItem(storageKey) || '{}') } catch (_) { return {} }
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
        <div class="noimpty-music-disc" aria-hidden="true"><i class="fas fa-music"></i></div>
        <div class="noimpty-music-meta">
          <span class="noimpty-music-kicker">我喜欢的音乐</span>
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
        currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        volume: audio.volume,
        shuffle: shuffleEnabled,
        collapsed,
        playing: !audio.paused && !audio.ended
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
  }

  const updateTrackMeta = () => {
    const track = tracks[currentIndex]
    titleElement.textContent = track.title
    artistElement.textContent = track.artist
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
    try {
      await audio.play()
      setStatus(`${shuffleEnabled ? '随机播放' : '顺序播放'} · ${currentIndex + 1}/${tracks.length}`)
    } catch (_) {
      resumeRequested = false
      setStatus('点击播放键开始播放')
    }
    updatePlayState()
    persist()
  }

  const loadTrack = (index, options = {}) => {
    const { autoplay = false, recordHistory = true, restoreTime = 0 } = options
    currentIndex = (index + tracks.length) % tracks.length
    pendingTime = Math.max(0, Number(restoreTime) || 0)
    resumeRequested = autoplay

    if (recordHistory) {
      history = history.slice(0, historyCursor + 1)
      if (history[history.length - 1] !== currentIndex) history.push(currentIndex)
      historyCursor = history.length - 1
    }

    audio.src = tracks[currentIndex].src
    audio.load()
    progressElement.value = '0'
    currentElement.textContent = '0:00'
    durationElement.textContent = '0:00'
    updateTrackMeta()
    updatePlayState()
    persist()
  }

  const nextTrack = () => {
    const autoplay = !audio.paused
    if (historyCursor < history.length - 1) {
      historyCursor += 1
      loadTrack(history[historyCursor], { autoplay, recordHistory: false })
      return
    }

    const nextIndex = shuffleEnabled ? takeRandomIndex() : (currentIndex + 1) % tracks.length
    loadTrack(nextIndex, { autoplay })
  }

  const previousTrack = () => {
    const autoplay = !audio.paused
    if (historyCursor > 0) {
      historyCursor -= 1
      loadTrack(history[historyCursor], { autoplay, recordHistory: false })
      return
    }

    const previousIndex = shuffleEnabled ? takeRandomIndex() : (currentIndex - 1 + tracks.length) % tracks.length
    loadTrack(previousIndex, { autoplay })
  }

  player.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]')
    if (!button) return

    switch (button.dataset.action) {
      case 'expand':
        collapsed = false
        player.classList.remove('is-collapsed')
        persist()
        break
      case 'collapse':
        collapsed = true
        player.classList.add('is-collapsed')
        persist()
        break
      case 'play':
        if (audio.paused) tryPlay()
        else audio.pause()
        break
      case 'previous':
        previousTrack()
        break
      case 'next':
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
  audio.addEventListener('pause', () => { updatePlayState(); persist() })
  audio.addEventListener('ended', nextTrack)
  audio.addEventListener('error', () => {
    resumeRequested = false
    setStatus('当前音频加载失败，请切换下一首')
    updatePlayState()
  })

  window.addEventListener('pagehide', persist)

  if ('mediaSession' in navigator) {
    const handlers = {
      play: tryPlay,
      pause: () => audio.pause(),
      previoustrack: previousTrack,
      nexttrack: nextTrack
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
    play: tryPlay,
    pause: () => audio.pause(),
    previous: previousTrack,
    next: nextTrack
  })
})()
