/* Mao 的轻量设置与快捷卡。只收集用户操作；保存、模型和聊天由 mao-pet 接管。 */
;(function () {
  'use strict'
  if (window.MAO_CONTROLS) return
  let nextId = 0

  function create (options) {
    const { button, getSettings, onSettingsChange, onAction, getStatus, onRetry } = options || {}
    if (!button || typeof getSettings !== 'function') throw new TypeError('Mao 控件需要按钮和设置读取方法')
    const id = 'mao-controls-' + (++nextId)
    const listeners = []
    const fields = new Map()
    let opened = false
    let destroyed = false
    let selectionText = ''
    let selectionTruncated = false
    let selectionLocked = false
    let previousFocus = null
    let actionPending = false
    let retryPending = false
    let settingsVersion = 0

    function el (tag, className, text) {
      const node = document.createElement(tag)
      if (className) node.className = className
      if (text !== undefined) node.textContent = text
      return node
    }
    function listen (target, type, handler, options) {
      target.addEventListener(type, handler, options)
      listeners.push(() => target.removeEventListener(type, handler, options))
    }
    function attr (node, name, value) { node.setAttribute(name, String(value)) }
    function add (parent, ...nodes) { nodes.forEach(node => parent.appendChild(node)); return parent }
    function makeButton (text, className) {
      const node = el('button', className, text)
      node.type = 'button'
      return node
    }

    const trigger = makeButton('⚙', 'mao-controls-trigger')
    attr(trigger, 'aria-label', 'Mao 设置与快捷操作')
    attr(trigger, 'title', 'Mao 设置与快捷操作')
    attr(trigger, 'aria-expanded', false)
    attr(trigger, 'aria-controls', id)
    attr(trigger, 'aria-haspopup', 'dialog')

    const panel = el('section', 'mao-controls-panel')
    panel.id = id
    panel.hidden = true
    attr(panel, 'role', 'dialog')
    attr(panel, 'aria-label', 'Mao 设置与快捷操作')
    const heading = el('strong', 'mao-controls-title', 'Mao · 陪你读一会儿')
    const closeButton = makeButton('×', 'mao-controls-close')
    attr(closeButton, 'aria-label', '关闭 Mao 面板')
    add(panel, add(el('div', 'mao-controls-heading'), heading, closeButton))

    const statusBox = el('div', 'mao-controls-status')
    const statusText = el('span')
    attr(statusText, 'role', 'status')
    attr(statusText, 'aria-live', 'polite')
    const retryButton = makeButton('重新加载', 'mao-controls-retry')
    retryButton.hidden = true
    add(panel, add(statusBox, statusText, retryButton))

    const actions = el('div', 'mao-controls-actions')
    const actionButtons = []
    const selectionHint = el('p', 'mao-controls-hint')
    const notice = el('p', 'mao-controls-notice')
    attr(notice, 'role', 'status')
    attr(notice, 'aria-live', 'polite')
    notice.hidden = true
    function inform (message) {
      if (destroyed) return
      notice.textContent = message
      notice.hidden = !message
    }
    function updateSelectionHint () {
      const count = Array.from(selectionText).length
      selectionHint.textContent = selectionText
        ? selectionTruncated
          ? '选区已截断，保留前 ' + count + ' 字用于解释（上限 6000 字符）。'
          : '已选中 ' + count + ' 字（最多 6000 字符）'
        : '选中页面文字后，可以请 Nana 帮你解释。'
    }
    const actionLabels = [
      ['explain-selection', '解释选中内容', '帮我读懂这一段'],
      ['summarize', '总结当前文章', '整理这一页的要点'],
      ['schedule', '打开学习日程', '看看接下来学什么']
    ]
    for (const [action, label, detail] of actionLabels) {
      const node = makeButton('', 'mao-controls-action')
      node.dataset.action = action
      add(node, el('span', '', label), el('small', '', detail))
      actionButtons.push(node)
      actions.appendChild(node)
      listen(node, 'click', async () => {
        if (destroyed || actionPending) return
        if (action === 'explain-selection' && !selectionText) {
          inform('先在页面选中一段文字，再打开 Mao 的快捷操作。')
          return
        }
        if (typeof onAction !== 'function') {
          inform('这个功能暂时还没准备好，请稍后再试。')
          return
        }
        actionPending = true
        actionButtons.forEach(item => { item.disabled = true })
        inform('')
        try {
          const result = await onAction(action, action === 'explain-selection' ? { text: selectionText } : undefined)
          if (!destroyed) {
            if (result === false) inform('暂时无法打开这个功能，请稍后再试。')
            else close()
          }
        } catch (_) {
          inform('这次操作没有完成，请稍后再试。')
        } finally {
          actionPending = false
          if (!destroyed) actionButtons.forEach(item => { item.disabled = false })
        }
      })
    }
    add(panel, actions, selectionHint, notice)

    const settingsToggle = makeButton('调整陪伴方式', 'mao-controls-settings-toggle')
    attr(settingsToggle, 'aria-controls', id + '-settings')
    attr(settingsToggle, 'aria-expanded', false)
    const settings = el('div', 'mao-controls-settings')
    settings.id = id + '-settings'
    settings.hidden = true
    add(panel, settingsToggle, settings)

    function setExpanded (expanded) {
      settings.hidden = !expanded
      attr(settingsToggle, 'aria-expanded', expanded)
      settingsToggle.textContent = expanded ? '收起设置' : '调整陪伴方式'
      position()
    }
    function field (name, label, kind, choices, help) {
      const row = el('label', 'mao-controls-field' + (kind === 'checkbox' ? ' mao-controls-switch' : ''))
      const control = el(kind === 'select' ? 'select' : 'input')
      control.name = name
      control.id = id + '-' + name
      if (kind !== 'select') control.type = kind
      if (kind === 'range') {
        control.min = '0'; control.max = '100'; control.step = '1'
        attr(control, 'aria-label', label)
      }
      if (choices) for (const [value, text] of choices) {
        const option = el('option', '', text)
        option.value = String(value)
        control.appendChild(option)
      }
      const caption = el('span', 'mao-controls-label', label)
      const output = kind === 'range' ? el('output', 'mao-controls-value') : null
      add(row, caption, control)
      if (output) row.appendChild(output)
      settings.appendChild(row)
      if (help) settings.appendChild(el('p', 'mao-controls-help', help))
      fields.set(name, { control, output, kind })
      listen(control, 'change', async () => {
        if (destroyed) return
        let value = kind === 'checkbox' ? control.checked : control.value
        if (name === 'bottomRatio') value = Math.max(0, Math.min(100, Number(value) || 0)) / 100
        if (name === 'idleSeconds') value = Number(value)
        const version = ++settingsVersion
        try {
          if (typeof onSettingsChange !== 'function') throw new Error('Settings unavailable')
          await onSettingsChange({ [name]: value })
          if (!destroyed && version === settingsVersion) { inform(''); refresh() }
        } catch (_) {
          if (!destroyed && version === settingsVersion) {
            refresh()
            inform('设置没有保存成功，请再试一次。')
          }
        }
      })
      if (kind === 'range') listen(control, 'input', () => { output.textContent = control.value + '%' })
    }

    field('side', '站在哪边', 'select', [['left', '左侧'], ['right', '右侧']])
    field('size', '人物大小', 'select', [['small', '小'], ['medium', '中'], ['large', '大']])
    field('bottomRatio', '离底部高度', 'range', null, '0% 靠近底部，100% 靠近顶部；也可以直接拖动人物。')
    field('compact', '收成小挂件', 'checkbox')
    field('autoCompact', '窄屏自动收起', 'checkbox')
    field('voice', '互动时播放语音', 'checkbox', null, '只控制 Mao 的互动语音；打开此项不会立即播放。')
    field('chatSync', '跟随 Nana 聊天状态', 'checkbox', null, '用表情回应聊天进展；此项不会发起请求或开启朗读。')
    field('idleSeconds', '主动说一句的间隔', 'select', [[0, '不主动说话'], [70, '约 70 秒'], [150, '约 2 分半'], [300, '约 5 分钟']])
    field('quiet', '安静陪伴', 'checkbox', null, '暂停闲聊与自动招呼，保留你主动互动和聊天时的回应。')
    field('power', '性能模式', 'select', [['auto', '自动'], ['saving', '省电']], '省电模式减少动画负担；后台页面会暂停渲染。')

    function readSelection () {
      try {
        const selection = window.getSelection()
        if (!selection) return { text: '', truncated: false }
        const node = selection.anchorNode
        if (node && panel.contains(node)) return { text: '', truncated: false }
        const raw = String(selection.toString()).trim()
        // Match contextAction's UTF-16 budget without splitting an emoji.
        const text = raw.slice(0, 6000).replace(/[\uD800-\uDBFF]$/, '')
        return { text, truncated: text.length < raw.length }
      } catch (_) { return { text: '', truncated: false } }
    }
    function captureSelection (selection) {
      selectionText = selection.text
      selectionTruncated = selection.truncated
    }
    function viewport () {
      const visual = window.visualViewport
      return {
        left: visual ? visual.offsetLeft || 0 : 0,
        top: visual ? visual.offsetTop || 0 : 0,
        width: Math.max(1, visual ? visual.width : window.innerWidth),
        height: Math.max(1, visual ? visual.height : window.innerHeight)
      }
    }
    function position () {
      if (!opened || destroyed) return
      const view = viewport()
      const margin = Math.min(12, view.width / 4, view.height / 4)
      const width = Math.max(1, Math.min(350, view.width - margin * 2))
      const maxHeight = Math.max(1, view.height - margin * 2)
      panel.style.width = width + 'px'
      panel.style.maxHeight = maxHeight + 'px'
      const anchor = button.getBoundingClientRect()
      const rect = panel.getBoundingClientRect()
      const height = Math.min(rect.height || maxHeight, maxHeight)
      const left = Math.min(Math.max(anchor.right + 12, view.left + margin), view.left + view.width - width - margin)
      const top = Math.min(Math.max(anchor.bottom - height, view.top + margin), view.top + view.height - height - margin)
      panel.style.left = left + 'px'
      panel.style.top = top + 'px'
    }
    function refresh () {
      if (destroyed) return
      let current = {}
      try { current = getSettings() || {} } catch (_) {}
      for (const [name, { control, output, kind }] of fields) {
        if (kind === 'checkbox') control.checked = current[name] === true
        else if (name === 'bottomRatio') {
          const value = Math.round(Math.max(0, Math.min(1, Number(current[name]) || 0)) * 100)
          control.value = String(value)
          output.textContent = value + '%'
        } else if (current[name] !== undefined) control.value = String(current[name])
      }
      let status = {}
      try { status = typeof getStatus === 'function' ? getStatus() || {} : {} } catch (_) {}
      const phase = ['idle', 'loading', 'ready', 'error'].includes(status.phase) ? status.phase : 'idle'
      statusBox.dataset.phase = phase
      statusText.textContent = typeof status.message === 'string' && status.message.trim()
        ? status.message : ({ idle: 'Mao 正在休息', loading: '正在请 Mao 过来…', ready: 'Mao 在这里', error: 'Mao 没有加载成功，可以重新试一次。' })[phase]
      retryButton.hidden = !['loading', 'error'].includes(phase) || typeof onRetry !== 'function'
      retryButton.disabled = retryPending
      updateSelectionHint()
      position()
    }
    function show (expanded) {
      if (destroyed) return
      if (!opened) {
        const selected = readSelection()
        if (selected.text) captureSelection(selected)
        previousFocus = document.activeElement
        opened = true
        panel.hidden = false
        attr(trigger, 'aria-expanded', true)
        inform('')
      }
      setExpanded(expanded)
      refresh()
      closeButton.focus({ preventScroll: true })
    }
    function close (restoreFocus = true) {
      if (destroyed || !opened) return
      const focusInPanel = panel.contains(document.activeElement)
      opened = false
      panel.hidden = true
      attr(trigger, 'aria-expanded', false)
      selectionLocked = false
      selectionText = ''; selectionTruncated = false
      if (restoreFocus && focusInPanel) {
        const target = previousFocus && previousFocus !== document.body && document.contains(previousFocus) ? previousFocus : trigger
        if (target && typeof target.focus === 'function') target.focus({ preventScroll: true })
      }
    }

    listen(trigger, 'click', () => { if (opened) close(); else show(true) })
    listen(closeButton, 'click', () => close())
    listen(settingsToggle, 'click', () => setExpanded(settings.hidden))
    listen(retryButton, 'click', async () => {
      if (destroyed || retryPending || typeof onRetry !== 'function') return
      retryPending = true
      refresh()
      try { await onRetry() } catch (_) { inform('重新加载没有完成，请稍后再试。') }
      finally { retryPending = false; refresh() }
    })
    // 先于按钮/画布默认聚焦捕获选区；打开后不让面板内的选择覆盖它。
    listen(document, 'pointerdown', event => {
      if (destroyed || panel.contains(event.target) || trigger.contains(event.target)) {
        if (!opened && !destroyed) { captureSelection(readSelection()); selectionLocked = true }
        return
      }
      const captured = readSelection()
      if (opened) close(false)
      captureSelection(captured)
      const stage = document.getElementById('mao-stage')
      selectionLocked = button.contains(event.target) || !!(stage && stage.contains(event.target))
    }, true)
    listen(document, 'selectionchange', () => {
      if (!opened && !selectionLocked) captureSelection(readSelection())
    })
    listen(document, 'keydown', event => {
      if (opened && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
      }
    })
    listen(window, 'resize', position)
    if (window.visualViewport) {
      listen(window.visualViewport, 'resize', position)
      listen(window.visualViewport, 'scroll', position)
    }
    add(document.body, trigger, panel)
    refresh()

    return Object.freeze({
      open: () => show(true),
      close: () => close(),
      showActions: () => show(false),
      refresh,
      destroy: () => {
        if (destroyed) return
        close()
        // 如果之前的焦点就是将移除的小齿轮，交还给仍在页面上的帽子。
        if (document.activeElement === trigger && typeof button.focus === 'function') button.focus({ preventScroll: true })
        destroyed = true
        listeners.splice(0).forEach(remove => remove())
        trigger.remove()
        panel.remove()
      }
    })
  }
  window.MAO_CONTROLS = Object.freeze({ create })
})()
