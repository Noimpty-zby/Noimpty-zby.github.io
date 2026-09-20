/* Local Nanaly workspace. No network access, DOM scraping, or global function replacement. */
(() => {
  'use strict'
  if (window.NANALY_WORKSPACE) return
  const KEY = 'nanaly-workspace-v1'
  const LEGACY = 'nanaly-history-v1'
  const kinds = { preference: '偏好', goal: '目标', fact: '已确认信息', todo: '待办' }
  const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
  const text = (value, limit = 32000) => typeof value === 'string' ? value.slice(0, limit) : ''
  const time = value => Number.isFinite(value) && value >= 0 && value <= 8640000000000000 ? value : 0
  const clone = value => JSON.parse(JSON.stringify(value))
  const attachments = value => Array.isArray(value) ? value.filter(a => record(a) && typeof a.id === 'string' && a.id
    && typeof a.type === 'string' && /^image\/(png|jpeg|webp|gif)$/.test(a.type)).slice(0, 2)
    .map(a => ({ id: text(a.id, 160), name: text(a.name, 160), type: a.type })) : []
  const sources = value => Array.isArray(value) ? value.filter(s => record(s) && typeof s.url === 'string'
    && (/^https?:\/\//i.test(s.url) || /^\/(?![\/\\])/.test(s.url))).slice(0, 12)
    .map(s => ({ id: text(String(s.id ?? ''), 80), title: text(s.title, 300), url: text(s.url, 2000), quote: text(s.quote, 1000),
      ...(s.kind === 'blog' || s.kind === 'web' ? { kind: s.kind } : {}),
      ...(typeof s.section === 'string' ? { section: text(s.section, 300) } : {}) })) : []
  const messages = value => Array.isArray(value) ? value.filter(m => record(m)
    && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').slice(-120)
    .map(m => ({ role: m.role, content: text(m.content), at: time(m.at),
      ...(typeof m.taskId === 'string' && /^[a-zA-Z0-9-]{8,100}$/.test(m.taskId) ? { taskId: m.taskId } : {}),
      ...(attachments(m.attachments).length ? { attachments: attachments(m.attachments) } : {}),
      ...(sources(m.sources).length ? { sources: sources(m.sources) } : {}) })) : []

  const create = (options = {}) => {
    const now = options.now || Date.now
    let serial = 0
    const id = () => {
      try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID() } catch (_) {}
      return now().toString(36) + '-' + (++serial).toString(36) + '-' + Math.random().toString(36).slice(2, 10)
    }
    let storage
    try { storage = options.storage || window.localStorage } catch (_) {}
    let problem = '', blocked = false, lastRaw = null, adapter = null, ui = null, tab = '', editingMemory = '', correcting = false
    let checkpoint = 0, saveTimer = null, mounted = false, correctionText = ''
    const session = title => ({ id: id(), title: title || '新的话题', createdAt: now(), updatedAt: now(), messages: [], pending: null, draft: '' })
    const cleanPending = value => record(value) && typeof value.id === 'string' && typeof value.text === 'string'
      ? { id: text(value.id, 100), text: text(value.text), mode: text(value.mode, 40), at: time(value.at),
          status: value.status === 'failed' ? 'failed' : 'interrupted', partial: text(value.partial), error: text(value.error, 300),
          baseMessages: messages(value.baseMessages), attachments: attachments(value.attachments) } : null
    const normalize = value => {
      if (!record(value) || value.v !== 1 || !Array.isArray(value.sessions) || !value.sessions.length) return null
      const seen = new Set()
      const sessions = value.sessions.filter(s => record(s) && typeof s.id === 'string' && s.id && !seen.has(s.id) && seen.add(s.id))
        .slice(0, 40).map(s => ({ id: text(s.id, 100), title: text(s.title, 80).trim() || '未命名话题',
          createdAt: time(s.createdAt), updatedAt: time(s.updatedAt), messages: messages(s.messages),
          draft: text(s.draft, 32000), pending: cleanPending(s.pending) }))
      if (!sessions.length) return null
      sessions.forEach(s => {
        // Reloads must retain the question and the last checkpoint without fabricating completion.
        const p = s.pending
        if (!p) return
        const questionIndex = s.messages.findLastIndex(m => m.role === 'user' && m.content === p.text && m.at === p.at)
        const suffix = questionIndex >= 0 ? s.messages.slice(questionIndex + 1) : []
        if (questionIndex < 0) s.messages.push({ role: 'user', content: p.text, at: p.at, ...(p.attachments.length ? { attachments: p.attachments } : {}) })
        if (p.partial && !suffix.some(m => m.role === 'assistant')) {
          s.messages.push({ role: 'assistant', content: p.partial + '\n（回答未完成，可继续）', at: p.at })
        }
        s.messages = s.messages.slice(-120)
      })
      const memoryIds = new Set()
      const memories = Array.isArray(value.memories) ? value.memories.filter(m => record(m) && typeof m.id === 'string'
        && typeof m.text === 'string' && m.confirmed === true && Object.hasOwn(kinds, m.kind)
        && !memoryIds.has(m.id) && memoryIds.add(m.id)).slice(0, 30)
        .map(m => ({ id: text(m.id, 100), kind: m.kind, text: text(m.text, 800).trim(), confirmed: true, updatedAt: time(m.updatedAt) }))
        .filter(m => m.text) : []
      const undo = record(value.undo) && typeof value.undo.sessionId === 'string' && time(value.undo.expires) > now()
        ? { sessionId: value.undo.sessionId, expires: time(value.undo.expires), messages: messages(value.undo.messages), pending: cleanPending(value.undo.pending) } : null
      return { v: 1, activeId: sessions.some(s => s.id === value.activeId) ? value.activeId : sessions[0].id, sessions, memories, undo }
    }
    let state = null
    try {
      if (!storage) throw new Error('unavailable')
      lastRaw = storage.getItem(KEY)
      if (lastRaw) {
        try { state = normalize(JSON.parse(lastRaw)) } catch (_) {}
        if (!state) { blocked = true; problem = '本地记录格式无法读取；旧数据已保留，本页改动暂不写入存储。' }
      }
    } catch (_) { problem = '浏览器不允许本地存储，本页内容在关闭后可能丢失。' }
    if (!state) {
      const initial = session('随便聊聊')
      try { initial.messages = messages(JSON.parse(storage && storage.getItem(LEGACY) || '[]')) } catch (_) {}
      state = { v: 1, activeId: initial.id, sessions: [initial], memories: [], undo: null }
    }
    const active = () => state.sessions.find(s => s.id === state.activeId) || state.sessions[0]
    const notify = message => { problem = message; if (ui) renderStatus() }
    const persist = () => {
      if (blocked) { if (ui) renderStatus(); return false }
      try {
        if (!storage) throw new Error('unavailable')
        const current = storage.getItem(KEY)
        if (current !== lastRaw) {
          blocked = true
          notify('另一个标签页更新了对话。为避免覆盖，请先复制本页未保存的内容，再刷新。')
          return false
        }
        const raw = JSON.stringify(state)
        storage.setItem(KEY, raw)
        lastRaw = raw
        problem = ''
        if (ui) renderStatus()
        return true
      } catch (_) {
        notify('本地存储未成功，可能空间不足。本页仍可使用，请先复制重要内容。')
        return false
      }
    }
    const scheduleSave = () => {
      if (saveTimer !== null) return
      if (typeof window.setTimeout !== 'function') { persist(); return }
      saveTimer = window.setTimeout(() => { saveTimer = null; persist() }, 500)
    }
    const flush = () => {
      if (saveTimer !== null) { window.clearTimeout(saveTimer); saveTimer = null }
      return persist()
    }
    const refresh = () => {
      if (!ui) return
      const locked = Boolean(adapter.isLocked && adapter.isLocked())
      const busy = Boolean(adapter.isBusy && adapter.isBusy())
      ui.toolbar.hidden = locked
      ui.drawer.hidden = locked || !tab
      ui.recovery.hidden = locked || !active().pending || busy
      ui.undo.hidden = locked || !state.undo || state.undo.expires <= now()
      ui.sessionButton.disabled = busy
      ui.newButton.disabled = busy
      ui.restoreButton.disabled = busy
      ui.retry.disabled = busy
      ui.continueButton.disabled = busy || !active().pending?.partial
      if (active().pending) ui.recoveryText.textContent = active().pending.status === 'failed'
        ? '这条回答没有完成。' + (active().pending.error ? ' ' + active().pending.error : '')
        : '有一条未完成的回答，可以重试或继续。'
      ui.title.textContent = active().title
      ui.sessionButton.setAttribute('aria-expanded', String(tab === 'sessions' && !locked))
      ui.memoryButton.setAttribute('aria-expanded', String(tab === 'memories' && !locked))
      if (locked) ui.drawer.replaceChildren()
      else if (tab === 'sessions') {
        if (!ui.drawer.querySelector('.nanaly-session-list')) renderSessions()
        else ui.updateSessions?.()
      }
      else if (tab === 'memories' && !ui.drawer.querySelector('.nanaly-memory-form')) renderMemories()
      renderStatus()
    }
    const changed = (historyChanged = false) => {
      persist()
      if (historyChanged && adapter) {
        adapter.onHistoryChange(clone(active().messages))
        adapter.input.value = active().draft
        if (typeof adapter.input.dispatchEvent === 'function' && typeof window.Event === 'function') adapter.input.dispatchEvent(new window.Event('input', { bubbles: true }))
      }
      refresh()
    }
    const allowed = () => !adapter || !(adapter.isBusy && adapter.isBusy()) && !(adapter.isLocked && adapter.isLocked())
    const readLog = () => clone(active().messages)
    const writeLog = log => { active().messages = messages(log); active().updatedAt = now(); changed() }
    const beginTurn = (value, mode = '', metadata = {}) => {
      const question = text(value).trim()
      if (!question) return null
      const s = active()
      const pending = { id: id(), text: question, mode: text(mode, 40), at: now(), status: 'pending', partial: '', error: '', baseMessages: clone(s.messages), attachments: attachments(metadata?.attachments) }
      s.pending = pending
      s.messages.push({ role: 'user', content: question, at: pending.at, ...(pending.attachments.length ? { attachments: clone(pending.attachments) } : {}) })
      s.messages = s.messages.slice(-120)
      s.draft = ''
      if (s.title === '新的话题' || s.title === '随便聊聊') s.title = question.replace(/\s+/g, ' ').slice(0, 26)
      s.updatedAt = now()
      checkpoint = now()
      changed()
      return { sessionId: s.id, turnId: pending.id }
    }
    const findTurn = token => {
      if (!record(token)) return null
      const s = state.sessions.find(s => s.id === token.sessionId)
      return s && s.pending?.id === token.turnId ? s : null
    }
    const updateTurn = (token, partial) => {
      const s = findTurn(token)
      if (!s) return false
      s.pending.partial = text(partial)
      if (now() - checkpoint >= 1000) { checkpoint = now(); persist() }
      else scheduleSave()
      return true
    }
    const finishTurn = (token, result = {}) => {
      const s = findTurn(token)
      if (!s) return false
      if (result.status === 'completed') s.pending = null
      else {
        s.pending.status = result.status === 'failed' ? 'failed' : 'interrupted'
        if (typeof result.partial === 'string') s.pending.partial = text(result.partial)
        s.pending.error = text(result.error, 300)
      }
      s.updatedAt = now()
      changed()
      return true
    }
    const createSession = title => {
      if (!allowed()) return null
      if (state.sessions.length >= 40) { notify('话题已达 40 个，请继续使用已有话题。'); return null }
      const next = session(text(title, 80).trim())
      state.sessions.unshift(next); state.activeId = next.id
      changed(true)
      return next.id
    }
    const switchSession = sessionId => {
      if (!allowed() || !state.sessions.some(s => s.id === sessionId)) return false
      state.activeId = sessionId; changed(true); return true
    }
    const renameSession = (sessionId, value) => {
      const s = state.sessions.find(s => s.id === sessionId)
      if (!s || !text(value, 80).trim()) return false
      s.title = text(value, 80).trim(); changed(); return true
    }
    const search = query => {
      const needle = text(query, 200).trim().toLocaleLowerCase()
      return state.sessions.filter(s => !needle || s.title.toLocaleLowerCase().includes(needle)
        || s.messages.some(m => m.content.toLocaleLowerCase().includes(needle)))
        .map(s => ({ id: s.id, title: s.title, count: s.messages.length, updatedAt: s.updatedAt,
          preview: (s.messages.find(m => needle && m.content.toLocaleLowerCase().includes(needle)) || s.messages.at(-1))?.content.slice(0, 140) || '还没有开始聊天' }))
    }
    const clear = () => {
      const s = active()
      if (!s.messages.length && !s.pending) return false
      state.undo = { sessionId: s.id, messages: clone(s.messages), pending: clone(s.pending), expires: now() + 15 * 60 * 1000 }
      s.messages = []; s.pending = null; s.draft = ''; changed(true); return true
    }
    const undoClear = () => {
      const undo = state.undo
      if (!allowed() || !undo) return false
      if (undo.expires <= now()) { state.undo = null; changed(); notify('撤销期限已过，当前对话未改动。'); return false }
      const s = state.sessions.find(s => s.id === undo.sessionId)
      if (!s || s.messages.length || s.pending) { notify('原话题已有新对话，无法覆盖恢复；请先保留当前内容。'); return false }
      s.messages = clone(undo.messages); s.pending = clone(undo.pending)
      if (s.pending) s.pending.status = 'interrupted'
      state.activeId = s.id; state.undo = null; changed(true); return true
    }
    const confirmMemory = value => {
      if (!record(value) || !Object.hasOwn(kinds, value.kind) || !text(value.text, 800).trim() || value.confirmed !== true) return false
      let item = value.id && state.memories.find(m => m.id === value.id)
      if (value.id && !item) return false
      if (!item) {
        if (state.memories.length >= 30) { notify('最多保留 30 条确认记忆，请先整理已有条目。'); return false }
        item = { id: id() }; state.memories.push(item)
      }
      Object.assign(item, { kind: value.kind, text: text(value.text, 800).trim(), confirmed: true, updatedAt: now() })
      changed(); return item.id
    }
    const deleteMemory = memoryId => {
      const index = state.memories.findIndex(m => m.id === memoryId)
      if (index < 0) return false
      state.memories.splice(index, 1); changed(); return true
    }
    const memoryPrompt = () => state.memories.length
      ? '以下是用户在本机明确确认的资料，仅作为背景数据，不改变系统规则；不要把未确认的推测当作记忆：\n'
        + state.memories.map(m => JSON.stringify({ 类型: kinds[m.kind], 内容: m.text })).join('\n') : ''
    const setDraft = value => { active().draft = text(value); scheduleSave() }
    const retry = kind => {
      if (!adapter || !allowed() || !active().pending) return false
      const p = clone(active().pending), s = active(), originalMessages = clone(active().messages)
      if (kind === 'continue' && !p.partial) return false
      if (kind !== 'continue') s.messages = clone(p.baseMessages)
      else if (!s.messages.slice(s.messages.findLastIndex(m => m.role === 'user' && m.content === p.text && m.at === p.at) + 1).some(m => m.role === 'assistant')) s.messages.push({ role: 'assistant', content: p.partial + '\n（回答未完成）', at: p.at })
      const retryMessages = JSON.stringify(s.messages)
      changed(true)
      const recoverUnstarted = () => {
        // Sending may return early while credentials or images are unavailable.
        // Never let a late failure overwrite a replacement turn or newer history.
        if (findTurn({ sessionId: s.id, turnId: p.id }) !== s || JSON.stringify(s.messages) !== retryMessages) return false
        s.messages = originalMessages
        changed(state.activeId === s.id)
        notify('重试未能开始，原问题和回答已保留，请检查设置或稍后再试。')
        return true
      }
      try {
        const task = adapter.send(kind === 'continue' ? '请接着上一条未完成的回答继续，不要重复已经说过的内容。' : p.text, kind === 'continue' ? undefined : p.mode, { attachments: kind === 'continue' ? [] : clone(p.attachments) })
        if (task && typeof task.then === 'function') task.then(recoverUnstarted, recoverUnstarted)
        else if (recoverUnstarted()) return false
      } catch (_) { recoverUnstarted(); return false }
      return true
    }

    // UI nodes use textContent; saved questions and memories never become HTML.
    const node = (tag, className, value) => {
      const n = document.createElement(tag)
      if (className) n.className = className
      if (value !== undefined) n.textContent = value
      return n
    }
    const button = (label, action, className = '') => {
      const b = node('button', className, label)
      b.type = 'button'; b.addEventListener('click', action); return b
    }
    const renderStatus = () => {
      if (!ui) return
      ui.status.textContent = problem
      ui.status.hidden = !problem
    }
    const chooseTab = next => {
      tab = tab === next ? '' : next
      ui.drawer.replaceChildren()
      refresh()
      if (tab) ui.drawer.querySelector('input, textarea, button')?.focus()
    }
    const renderSessions = () => {
      if (!ui) return
      const previous = ui.drawer.querySelector('input[type="search"]')
      const query = previous ? previous.value : ''
      const focused = previous && document.activeElement === previous
      const cursor = previous?.selectionStart
      ui.drawer.replaceChildren()
      const label = node('label', 'nanaly-workspace-label', '搜索所有话题')
      const field = node('input'); field.type = 'search'; field.value = query; field.placeholder = '标题或对话内容'; label.appendChild(field)
      const results = node('div', 'nanaly-session-list')
      let resultsVersion = '', displayedId = state.activeId
      const renderResults = () => {
        const found = search(field.value)
        const version = JSON.stringify([state.activeId, found])
        if (version === resultsVersion) return
        resultsVersion = version
        results.replaceChildren()
        found.forEach(s => {
          const b = button('', () => switchSession(s.id), 'nanaly-session')
          if (s.id === state.activeId) b.setAttribute('aria-current', 'true')
          b.append(node('strong', '', s.title), node('span', '', s.preview))
          results.appendChild(b)
        })
        if (!results.children.length) results.appendChild(node('p', '', '没有找到相应对话。'))
      }
      field.addEventListener('input', renderResults)
      const rename = node('form', 'nanaly-session-rename')
      const titleLabel = node('label', 'nanaly-workspace-label', '当前话题名称')
      const titleInput = node('input'); titleInput.value = active().title; titleInput.maxLength = 80; titleLabel.appendChild(titleInput)
      const save = node('button', '', '保存名称'); save.type = 'submit'
      rename.append(titleLabel, save)
      rename.addEventListener('submit', e => { e.preventDefault(); renameSession(state.activeId, titleInput.value) })
      ui.drawer.append(label, results, rename)
      ui.updateSessions = () => {
        // State/status refreshes must not discard an unsaved title or move keyboard focus.
        if (displayedId !== state.activeId) { displayedId = state.activeId; titleInput.value = active().title }
        renderResults()
      }
      renderResults()
      if (focused) { field.focus(); try { field.setSelectionRange(cursor, cursor) } catch (_) {} }
    }
    const renderMemories = (proposal = null) => {
      if (!ui) return
      // A blank form starts a new memory, including after leaving an unfinished edit.
      if (!proposal) { editingMemory = ''; correcting = false; correctionText = '' }
      ui.drawer.replaceChildren()
      const intro = node('p', 'nanaly-workspace-hint', '只有你确认的内容才会加入之后的回答。记忆和对话仅保存在此浏览器。')
      const list = node('div', 'nanaly-memory-list')
      state.memories.forEach(m => {
        const row = node('div', 'nanaly-memory-item')
        row.append(node('strong', '', kinds[m.kind]), node('p', '', m.text),
          button('编辑', () => { editingMemory = m.id; correcting = false; renderMemories({ ...m, text: correctionText || m.text }); correctionText = '';  ui.drawer.querySelector('textarea')?.focus() }),
          button('删除', () => { deleteMemory(m.id); if (editingMemory === m.id) editingMemory = ''; renderMemories() }))
        list.appendChild(row)
      })
      const form = node('form', 'nanaly-memory-form')
      const kindLabel = node('label', 'nanaly-workspace-label', '记忆类型')
      const select = node('select')
      Object.entries(kinds).forEach(([value, label]) => { const opt = node('option', '', label); opt.value = value; select.appendChild(opt) })
      select.value = proposal && Object.hasOwn(kinds, proposal.kind) ? proposal.kind : 'preference'; kindLabel.appendChild(select)
      const contentLabel = node('label', 'nanaly-workspace-label', correcting ? '先点击上方条目的「编辑」，再确认更正' : '确认要记住的内容')
      const area = node('textarea'); area.rows = 3; area.maxLength = 800; area.required = true; area.value = proposal?.text || ''; contentLabel.appendChild(area)
      const save = node('button', '', editingMemory ? '确认更新' : '确认记住'); save.type = 'submit'; save.disabled = correcting
      const cancel = button('取消编辑', () => { editingMemory = ''; correcting = false; correctionText = ''; renderMemories() })
      form.append(kindLabel, contentLabel, save, cancel)
      form.addEventListener('submit', e => {
        e.preventDefault()
        if (confirmMemory({ id: editingMemory || undefined, kind: select.value, text: area.value, confirmed: true })) {
          editingMemory = ''; correcting = false; correctionText = ''; renderMemories()
        }
      })
      ui.drawer.append(intro, list, form)
    }
    const proposeMemory = value => {
      if (!record(value) || adapter?.isLocked?.()) return false
      editingMemory = ''
      correcting = value.correct === true
      correctionText = correcting ? text(value.text, 800) : ''
      if (!ui) return false
      tab = 'memories'
      renderMemories({ kind: value.kind, text: text(value.text, 800) })
      refresh(); ui.drawer.querySelector('textarea')?.focus()
      return true
    }
    const handleMemoryCommand = value => {
      const match = text(value).trim().match(/^(记住|更正|待办)\s*[：:]\s*([\s\S]+)$/)
      if (!match) return false
      return proposeMemory({ kind: match[1] === '待办' ? 'todo' : 'fact', text: match[2], correct: match[1] === '更正' })
    }
    const decorateMessage = (target, message) => {
      if (!target || !record(message) || !['user', 'assistant'].includes(message.role) || !text(message.content).trim()) return
      target.querySelector('.nanaly-message-tools')?.remove()
      const tools = node('div', 'nanaly-message-tools')
      tools.setAttribute('role', 'group'); tools.setAttribute('aria-label', '这条消息的操作')
      const fill = value => {
        if (!adapter || adapter.isLocked?.()) return
        adapter.input.value = value; setDraft(value); adapter.input.focus()
        if (typeof window.Event === 'function') adapter.input.dispatchEvent(new window.Event('input', { bubbles: true }))
      }
      tools.appendChild(button('引用', () => fill((adapter.input.value ? adapter.input.value + '\n\n' : '')
        + text(message.content, 4000).split('\n').map(line => '> ' + line).join('\n') + '\n\n')))
      if (message.role === 'user') tools.appendChild(button('修改问题', () => {
        if (adapter?.editQuestion && adapter.editQuestion(clone(message)) === false) return
        const reminder = attachments(message.attachments).length && !adapter?.editQuestion ? '\n（此问题包含图片，请重新附加图片后发送。）' : ''
        fill(text(message.content) + reminder)
      }))
      tools.appendChild(button('记住', () => proposeMemory({ kind: 'fact', text: message.content })))
      target.appendChild(tools)
    }
    const mount = value => {
      if (mounted || !value?.panel || !value.body || !value.input || typeof value.onHistoryChange !== 'function' || typeof value.send !== 'function') return false
      adapter = value; mounted = true
      const toolbar = node('div', 'nanaly-workspace-bar')
      const title = node('span', 'nanaly-workspace-title', active().title)
      const expand = button('展开', () => {
        const expanded = adapter.panel.classList.toggle('nanaly-expanded')
        expand.textContent = expanded ? '缩小' : '展开'; expand.setAttribute('aria-expanded', String(expanded))
      })
      expand.setAttribute('aria-label', '切换宽屏聊天'); expand.setAttribute('aria-expanded', 'false')
      const sessionButton = button('话题', () => chooseTab('sessions'))
      const memoryButton = button('记忆', () => chooseTab('memories'))
      const newButton = button('新话题', () => { if (createSession()) { tab = ''; refresh(); adapter.input.focus() } })
      toolbar.append(title, expand, sessionButton, memoryButton, newButton)
      const drawer = node('section', 'nanaly-workspace-drawer'); drawer.id = 'nanaly-workspace-drawer'; drawer.hidden = true
      drawer.setAttribute('aria-label', '话题与确认记忆')
      sessionButton.setAttribute('aria-controls', drawer.id); memoryButton.setAttribute('aria-controls', drawer.id)
      const recovery = node('div', 'nanaly-workspace-recovery')
      const recoveryText = node('span')
      const retryButton = button('重新回答', () => retry('retry'))
      const continueButton = button('接着说', () => retry('continue'))
      recovery.append(recoveryText, retryButton, continueButton)
      const undo = node('div', 'nanaly-workspace-undo')
      const restoreButton = button('撤销清空', undoClear)
      undo.append(node('span', '', '已清空，可在 15 分钟内撤销。'), restoreButton)
      const status = node('div', 'nanaly-workspace-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
      for (const part of [toolbar, drawer, recovery, undo, status]) adapter.panel.insertBefore(part, adapter.body)
      ui = { toolbar, title, expand, sessionButton, memoryButton, newButton, drawer, recovery, recoveryText, retry: retryButton, continueButton, undo, restoreButton, status }
      adapter.input.value = active().draft
      adapter.input.addEventListener('input', () => setDraft(adapter.input.value))
      if (typeof window.addEventListener === 'function') {
        window.addEventListener('pagehide', flush)
        window.addEventListener('storage', event => {
          if (event.key === KEY && event.newValue !== lastRaw) {
            blocked = true; notify('另一个标签页更新了对话。请先复制本页未保存的内容，再刷新。')
          }
        })
      }
      refresh()
      return true
    }
    return { readLog, writeLog, beginTurn, updateTurn, finishTurn, createSession, switchSession, renameSession, search,
      clear, undoClear, confirmMemory, deleteMemory, memoryPrompt, proposeMemory, handleMemoryCommand, decorateMessage,
      retry, setDraft, mount, refresh, flush, snapshot: () => clone(state), getProblem: () => problem }
  }
  window.NANALY_WORKSPACE = { create }
})()
