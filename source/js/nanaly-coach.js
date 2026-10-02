/* Teach-back sessions. Private drafts remain in memory until an explicit save. */
(() => {
  'use strict'
  if (window.NANALY_COACH) return
  let ui = null
  const clean = (text, limit = 12000) => String(text || '').trim().slice(0, limit)
  const prompt = (context, sources = []) => [
    '【讲给我听：本轮是用户解释、我检验理解】主题：' + clean(context.topic, 180),
    '把用户的话视为待验证解释，不预设全部正确。先准确复述一处关键意思，再指出最影响理解的一处遗漏或错误；正确就简短确认并推进，不强行挑错。',
    '结合这次真实检索到的原文给出可定位依据 [S编号]。区分原文说法、一般知识和你的推断；没有原文就明确目前依据一般知识，不捏造引文。',
    '对关键结论检查前提、边界、反例。必要时给一个最小反例，让用户解释它为何成立；一轮最多追问一个问题，避免一次列出整套考试或替用户把所有答案讲完。',
    '无法核实的地方指出具体不确定项。不要凭这次回答或阅读次数宣布已经掌握。',
    '末尾可用“待复习问题：”提出一到三条具体、可自测的问题；这是候选，不代表已经存入记忆。只有页面返回保存成功才算保存。',
    context.article ? '本轮选择的文章：' + clean(context.article.title, 200) + '；' + clean(context.article.url, 1000) : '用户没有选择站内文章。',
    sources.length ? '本轮存在真实材料，引用只从提供的编号里选。' : '本轮未取得可引用原文，不得声称已经读到材料。'
  ].join('\n')
  const questionsFrom = text => {
    const ending = String(text).split(/待复习问题\s*[:：]/).slice(1).join('：')
    return ending.split('\n').map(line => line.replace(/^\s*(?:[-*]|\d+[.、)])\s*/, '').trim()).filter(Boolean).slice(0, 3).map(line => line.slice(0, 500))
  }
  const create = opts => {
    if (ui) return ui
    const node = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el }
    const button = (text, fn) => { const el = node('button', text); el.type = 'button'; el.addEventListener('click', fn); return el }
    const safeSource = article => {
      if (!article || !clean(article.title)) return null
      try {
        const url = new URL(article.url, window.location.origin)
        if (url.origin !== window.location.origin || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
        return { ...article, title: clean(article.title, 200), url: url.href }
      } catch (_) { return null }
    }
    let session = null, serial = 0, saving = false, recognition = null, loading = 0, quality = null
    const box = node('section', null, 'nanaly-coach')
    box.hidden = true
    const heading = node('strong', '讲给我听')
    const sourceLabel = node('label', '依据的文章'), select = node('select')
    select.setAttribute('aria-label', '讲解依据的文章')
    const topicLabel = node('label', '想讲的主题'), topic = node('input')
    topic.type = 'text'; topic.maxLength = 180; topic.placeholder = '例如：二分查找为什么不会漏掉目标'
    topic.setAttribute('aria-label', '想讲的主题')
    const status = node('p', '', 'nanaly-coach__status'); status.setAttribute('role', 'status')
    const questionsLabel = node('label', '待复习问题（每行一条，可修改）'), questions = node('textarea')
    questions.rows = 3; questions.maxLength = 3000; questions.setAttribute('aria-label', '确认保存的待复习问题')
    const actions = node('div', null, 'nanaly-coach__actions')
    const start = button('开始讲解', () => activate())
    const save = button('确认保存这次解释', async () => {
      if (saving || !session?.candidate) return
      if (!opts.canRead()) { status.textContent = '请先解锁站点；本次没有保存。'; return }
      const history = window.NOIMPTY_LEARNING_HISTORY
      if (!history?.recordExplanation) { status.textContent = '学习记录模块没有加载，本次没有保存。'; return }
      const candidate = session.candidate, current = session.id
      saving = true; save.disabled = true
      try {
        const reviewQuestions = questions.value.split('\n').map(line => clean(line, 500)).filter(Boolean).slice(0, 6)
        const result = await history.recordExplanation({ topic: session.topic,
          source: session.article ? { title: session.article.title, url: session.article.url } : { title: session.topic, url: '/teach/' },
          explanation: candidate.explanation, feedback: candidate.feedback, reviewQuestions, confirmed: true, revises: session.revises || null })
        if (session?.id === current && opts.canRead()) {
          if (session.candidate === candidate) {
            session.candidate = null; save.hidden = true
            status.textContent = '已保存这次解释和待复习问题，可在成长记录中查看。'
          } else status.textContent = '上一份解释已保存；新收到的反馈尚未保存，请检查后再次确认。'
          session.revises = result.id
          status.dataset.savedId = result.id
        }
      } catch (_) { if (session?.id === current) status.textContent = '保存没有成功，解释仍保留在当前对话。请重试或复制备份。' }
      finally { saving = false; save.disabled = false }
    })
    const stop = () => {
      serial++; loading++; session = null; box.hidden = true; save.hidden = true
      questions.value = ''; questionsLabel.hidden = true; questions.hidden = true
      if (recognition) { recognition.abort(); recognition = null }
    }
    const leave = button('结束练习', stop)
    actions.append(start, save, leave)
    sourceLabel.append(select); topicLabel.append(topic); questionsLabel.append(questions)
    box.append(heading, sourceLabel, topicLabel, actions, status, questionsLabel)
    const foot = opts.panel.querySelector('.nanaly-foot')
    if (foot) foot.before(box); else opts.panel.append(box)
    save.hidden = true; questionsLabel.hidden = true
    let articles = []
    const loadChoices = async () => {
      const revision = ++loading
      articles = []
      select.replaceChildren()
      const none = node('option', '不指定文章，按一般知识讨论'); none.value = ''; select.append(none)
      const current = window.location.pathname.startsWith('/teach') ? null : safeSource(opts.currentArticle())
      if (current) articles.push(current)
      try {
        if (opts.canRead()) {
          const corpus = await opts.loadCorpus()
          if (revision !== loading || !opts.canRead()) return
          for (const item of corpus || []) {
            const value = safeSource(item)
            if (value && !articles.some(a => a.url === value.url)) articles.push(value)
          }
        }
      } catch (_) { status.textContent = '文章索引暂不可用，可以先选自定义主题；不会假装已读原文。' }
      if (revision !== loading || !opts.canRead()) return
      for (const article of articles.slice(0, 400)) {
        const option = node('option', article.title); option.value = article.url; select.append(option)
      }
      select.value = current?.url || ''
      if (!topic.value && current) topic.value = current.title
    }
    const activate = () => {
      if (!opts.canRead()) { status.textContent = '先解锁站点，再开始讲解练习。'; return false }
      if (opts.isBusy()) { status.textContent = '请先结束当前回答或解锁聊天配置。'; return false }
      const connection = opts.connectionStatus()
      if (!connection.configured) { status.textContent = '尚未连接文字模型，请先在聊天设置里填写或解锁 API Key。'; return false }
      const article = articles.find(a => a.url === select.value) || null
      const title = clean(topic.value || article?.title, 180)
      if (!title) { status.textContent = '先写一个想讲的主题。'; topic.focus(); return false }
      serial++
      session = { id: serial, topic: title, article, turns: [], candidate: null }
      save.hidden = true; questionsLabel.hidden = true
      status.textContent = '练习中：' + title + '。在下面原来的聊天输入框里解释你的理解，我会据材料追问。'
      opts.input.focus()
      return true
    }
    select.addEventListener('change', () => { const article = articles.find(a => a.url === select.value); if (article) topic.value = article.title })
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (Recognition) {
      const dictate = button('浏览器语音转写', () => {
        if (!session || !opts.canRead() || opts.isBusy()) { status.textContent = '先开始一轮练习，再使用语音转写。'; return }
        if (recognition) { recognition.stop(); return }
        recognition = new Recognition(); recognition.lang = 'zh-CN'; recognition.interimResults = false
        const id = session.id
        recognition.onresult = event => {
          if (session?.id !== id || !opts.canRead()) return
          const text = [...event.results].filter(result => result.isFinal).map(result => result[0].transcript).join('')
          opts.input.value = clean(opts.input.value + (opts.input.value ? '\n' : '') + text, 12000)
          opts.input.dispatchEvent(new Event('input', { bubbles: true }))
          status.textContent = '转写已填入输入框。请核对，再手动发送。'
        }
        recognition.onerror = () => { if (session?.id !== id) return; status.textContent = '浏览器转写没有成功，可以继续打字。' }
        recognition.onend = () => { recognition = null; dictate.textContent = '浏览器语音转写' }
        status.textContent = '浏览器正在转写；音频可能由浏览器服务处理。不会自动发送聊天消息。'
        dictate.textContent = '停止转写'
        try { recognition.start() } catch (_) { recognition = null; dictate.textContent = '浏览器语音转写'; status.textContent = '浏览器无法启动转写，请继续打字。' }
      })
      actions.append(dictate)
    }
    const open = async () => {
      opts.openPanel(); box.hidden = false
      if (session) { topic.focus(); return }
      const revision = ++serial
      status.textContent = opts.canRead() ? '选一篇文章或写下主题，开始后在原来的聊天输入框解释。' : '请先解锁站点。'
      await loadChoices()
      if (revision !== serial || box.hidden || !opts.canRead()) return
      topic.focus()
    }
    const context = () => session && opts.canRead() ? { id: session.id, topic: session.topic, article: session.article } : null
    const complete = result => {
      if (!session || result.context.id !== session.id || !opts.canRead()) return
      session.turns.push({ explanation: clean(result.explanation), feedback: clean(result.feedback, 16000) })
      session.turns = session.turns.slice(-6)
      session.candidate = { explanation: session.turns.map(t => t.explanation).join('\n\n补充：').slice(0, 12000), feedback: clean(result.feedback, 16000) }
      questions.value = questionsFrom(result.feedback).join('\n')
      questionsLabel.hidden = false; questions.hidden = false; save.hidden = false
      status.textContent = '反馈已收到。你可以继续解释，或检查待复习问题后点击确认保存。'
    }
    const openExplanation = async id => {
      if (!opts.canRead()) throw new Error('请先解锁站点，再读取自己的解释记录。')
      const record = await window.NOIMPTY_LEARNING_HISTORY?.getExplanation(id)
      if (!record || !opts.canRead()) throw new Error('没有读到这条解释记录。')
      stop()
      await open()
      if (!opts.canRead() || box.hidden) return
      topic.value = clean(record.topic, 180)
      const source = safeSource(record.source)
      select.value = articles.some(a => a.url === source?.url) ? source.url : ''
      if (activate()) { session.revises = record.id; opts.input.value = clean(record.explanation); opts.input.dispatchEvent(new Event('input', { bubbles: true })); status.textContent = '已放回你上次的解释。修改后手动发送，就能再讲一次。' }
    }
    const pageMount = async () => {
      const page = document.getElementById('nanaly-coach-page')
      if (!page || page.dataset.mounted) return
      page.dataset.mounted = 'yes'
      const state = node('p', '', 'nanaly-coach-page__connection'), result = node('div', null, 'nanaly-quality-results')
      const refresh = () => {
        const connection = opts.connectionStatus()
        state.textContent = !opts.canRead() ? '站点尚未解锁。解锁后可选择文章和读取自己的学习记录。'
          : connection.configured ? '模型已连接：' + connection.model + '；推理档：' + connection.reasonModel
          : connection.locked ? '聊天保险箱已锁定。请在娜娜莉设置中解锁后开始。' : '还没有连接聊天模型。先打开娜娜莉，在设置中填写已有 API Key。'
      }
      const openButton = button('选择文章或主题，开始讲解', open)
      const settings = button('打开娜娜莉设置', () => { opts.openPanel(); window.NANALY?.requestUnlock() })
      const check = button('运行 6 题能力自检', async () => {
        if (quality) return
        refresh(); result.replaceChildren()
        if (!opts.canRead()) { result.textContent = '请先解锁站点。'; return }
        quality = new AbortController(); check.disabled = true; cancel.hidden = false
        try {
          const report = await opts.evaluateQuality({ signal: quality.signal, onProgress: item => { if (!page.isConnected || !opts.canRead()) return; state.textContent = '正在自检 ' + (item.completed + 1) + '/6：' + item.title } })
          if (!page.isConnected || !opts.canRead()) return
          result.append(node('p', report.note))
          for (const item of report.results) {
            const details = node('details'), summary = node('summary', item.title + (item.error ? ' · 未完成' : item.warnings?.length || item.incomplete ? ' · 需检查' : ' · 已取得回答'))
            details.append(summary, node('p', item.error || item.answer), node('p', item.rubric || ''))
            if (item.warnings?.length) details.append(node('p', item.warnings.join('；')))
            result.append(details)
          }
        } catch (error) { if (page.isConnected) result.textContent = quality?.signal.aborted ? '自检已停止，未发出剩余请求。' : clean(error.message, 180) }
        finally { quality = null; check.disabled = false; cancel.hidden = true; refresh() }
      })
      const cancel = button('停止自检', () => quality?.abort(new Error('用户停止自检')))
      cancel.hidden = true
      const budget = node('p', '自检只发送 6 组合成案例，不发送你的会话、文件或学习记录。最多 6 次模型请求、总输出上限 14,336 tokens；会使用当前配置并产生模型费用。规则提示仅供筛查，回答质量需要逐题核对。')
      const pageActions = node('div', null, 'nanaly-coach-page__actions')
      pageActions.append(openButton, settings, button('刷新连接状态', refresh), check, cancel)
      page.append(state, pageActions, budget, result); refresh()
      const id = new URL(window.location.href).searchParams.get('explanation')
      if (id && opts.canRead()) try { await openExplanation(id) } catch (error) { result.textContent = clean(error.message, 180) }
    }
    document.addEventListener('pjax:complete', () => { recognition?.abort(); quality?.abort(new Error('已离开自检页面')); loading++; void pageMount() })
    window.addEventListener('noimpty:search-reset', () => { stop(); quality?.abort(new Error('站点状态已改变')); loading++ })
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void pageMount() }, { once: true })
    else void pageMount()
    ui = Object.freeze({ open, context, complete, stop, openExplanation, pageMount })
    return ui
  }
  window.NANALY_COACH = Object.freeze({ create, prompt, questionsFrom, open: () => ui?.open(), context: () => ui?.context(),
    complete: value => ui?.complete(value), stop: () => ui?.stop(), openExplanation: id => ui?.openExplanation(id) })
})()
