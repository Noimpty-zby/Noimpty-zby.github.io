/* Private learning evidence. IndexedDB commits complete before any success is reported. */
(() => {
  'use strict'
  if (window.NOIMPTY_LEARNING_HISTORY) return
  const DB = 'noimpty-learning-evidence-v1', VERSION = 1
  const LANGUAGES = ['c', 'cpp', 'go', 'python', 'git', 'linux', 'mysql']
  const FAILURES = ['wrong_answer', 'compile_error', 'runtime_error', 'timeout', 'output_limit']
  const unlocked = () => { try { return window.NOIMPTY_GATE?.unlocked() === true && !document.documentElement.classList.contains('noimpty-private-locked') } catch (_) { return false } }
  const guard = () => { if (!unlocked()) throw new Error('请先解锁私人学习空间。') }
  const object = value => value && typeof value === 'object' && !Array.isArray(value)
  const text = (value, max, name = '内容') => { if (typeof value !== 'string' || value.length > max) throw new Error(`${name}格式不正确或过长。`); return value }
  const date = value => { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('记录时间无效。'); return new Date(value).toISOString() }
  const id = value => { if (typeof value !== 'string' || !/^[\w:.-]{1,180}$/.test(value)) throw new Error('记录编号无效。'); return value }
  const uuid = () => window.crypto.randomUUID()
  const source = value => {
    if (!value) return null
    const title = text(value.title || '', 500)
    const url = new URL(text(value.url || '/learn/', 3000), window.location.origin)
    if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('来源必须是本站文章。')
    return { title, url: url.pathname + url.search + url.hash }
  }
  const attempt = value => {
    if (!object(value) || !LANGUAGES.includes(value.language) || !object(value.result) || ![...FAILURES, 'accepted'].includes(value.result.status)) throw new Error('需要一次已经完成的真实运行结果。')
    const result = value.result
    const tests = value.tests || []
    if (!Array.isArray(tests) || tests.length > 10) throw new Error('测试数据无效。')
    return {
      id: id(value.id), at: date(value.at), language: value.language,
      code: text(value.code, 65536, '代码'), stdin: text(value.stdin || '', 65536, '输入'),
      tests: tests.map(item => ({ input: text(item.input || '', 8192), ...(typeof item.expectedOutput === 'string' ? { expectedOutput: text(item.expectedOutput, 8192) } : {}) })),
      problem: text(value.problem || '', 20000, '题目'), source: source(value.source),
      explanation: text(value.explanation || '', 12000, '复盘说明'),
      result: { runId: text(result.runId, 180, '运行编号'), status: result.status,
        stdout: text(result.stdout || '', 65536, '输出'), stderr: text(result.stderr || '', 65536, '错误输出'),
        exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
        evidence: result.evidence === 'terminal' ? 'terminal' : 'runner', truncated: result.truncated === true,
        tests: Array.isArray(result.tests) ? result.tests.slice(0, 10).map(item => ({ status: text(item.status || '', 64), input: text(item.input || '', 8192), stdout: text(item.stdout || '', 32768), stderr: text(item.stderr || '', 32768), ...(typeof item.expectedOutput === 'string' ? { expectedOutput: text(item.expectedOutput, 8192) } : {}) })) : [] }
    }
  }
  const passesOriginal = (attempts, value) => {
    if (!value || value.result.status !== 'accepted') return false
    const required = attempts[0].tests
    if (!required.length) return true
    return value.result.evidence === 'runner' && JSON.stringify(value.tests) === JSON.stringify(required) &&
      value.result.tests.length === required.length && required.every((test, index) => {
        const result = value.result.tests[index]
        return result.status === 'accepted' && result.input === test.input && result.expectedOutput === test.expectedOutput
      })
  }
  const reviews = (values, attempts) => {
    if (!Array.isArray(values) || values.length > 10000) throw new Error('复习记录无效。')
    const used = new Set()
    return values.map(value => {
      if (!object(value) || ![1, 2, 3, 4].includes(value.rating) || attempts[0].id === value.attemptId || !attempts.some(item => item.id === value.attemptId) || used.has(value.attemptId)) throw new Error('复习必须对应一次独立重做。')
      if (value.rating > 1 && !passesOriginal(attempts, attempts.find(item => item.id === value.attemptId))) throw new Error('未通过的尝试只能安排重新练习。')
      used.add(value.attemptId)
      return { id: id(value.id), at: date(value.at), attemptId: id(value.attemptId), rating: value.rating }
    }).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
  }
  const cleanCase = value => {
    if (!object(value) || !Array.isArray(value.attempts) || !value.attempts.length || value.attempts.length > 1000) throw new Error('错题记录无效。')
    const attempts = value.attempts.map(attempt)
    if (new Set(attempts.map(item => item.id)).size !== attempts.length || !FAILURES.includes(attempts[0].result.status) || attempts.some(item => item.language !== attempts[0].language)) throw new Error('错题必须保留最初失败现场与同语言尝试。')
    const record = { id: id(value.id), title: text(value.title, 300), createdAt: date(value.createdAt), updatedAt: date(value.updatedAt), attempts, reviews: reviews(value.reviews || [], attempts), imported: value.imported === true }
    // Scheduling is derived from review evidence; never trust an imported due date.
    return record
  }
  const cleanExplanation = value => {
    if (!object(value) || !Array.isArray(value.reviewQuestions) || value.reviewQuestions.length > 30) throw new Error('讲解记录无效。')
    return { id: id(value.id), revises: value.revises ? id(value.revises) : null, topic: text(value.topic, 300), source: source(value.source), explanation: text(value.explanation, 20000), feedback: text(value.feedback || '', 20000), reviewQuestions: value.reviewQuestions.map(q => text(q, 2000)), createdAt: date(value.createdAt), imported: value.imported === true }
  }
  let database = null, opening = null, fsrsLoading = null
  const open = () => {
    guard()
    if (database) return Promise.resolve(database)
    if (opening) return opening
    opening = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('浏览器不支持 IndexedDB，不能可靠保存学习记录。')); return }
      const request = window.indexedDB.open(DB, VERSION)
      request.onupgradeneeded = () => { for (const name of ['cases', 'explanations']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' }) }
      request.onerror = () => reject(new Error('学习记录数据库打不开；已有数据未被清空。'))
      request.onblocked = () => reject(new Error('请关闭旧版学习页面后重试；数据库正在等待升级。'))
      request.onsuccess = () => { database = request.result; database.onversionchange = () => { database?.close(); database = null }; resolve(database) }
    }).finally(() => { opening = null })
    return opening
  }
  let channel = null
  try { if (window.BroadcastChannel) channel = new window.BroadcastChannel(DB) } catch (_) {}
  const announce = () => { window.dispatchEvent(new CustomEvent('learning-history:changed')); window.dispatchEvent(new CustomEvent('noimpty:learning-history')) }
  const notify = () => { announce(); channel?.postMessage('changed') }
  if (channel) channel.onmessage = () => { if (unlocked()) announce() }
  const transaction = async (stores, mode, work) => {
    const db = await open(); guard()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode)
      let output, failure
      const fail = error => { failure = error; try { tx.abort() } catch (_) {} }
      tx.oncomplete = () => { if (mode === 'readwrite') notify(); try { guard(); resolve(output) } catch (error) { reject(error) } }
      tx.onabort = tx.onerror = () => reject(failure || new Error('保存失败（空间不足或浏览器禁止存储）。原有记录未被覆盖，请导出备份后重试。'))
      try { work(tx, value => { output = value }, fail) } catch (error) { fail(error) }
    })
  }
  const all = name => transaction([name], 'readonly', (tx, done, fail) => {
    const request = tx.objectStore(name).getAll()
    request.onsuccess = () => { try { guard(); done(request.result.map(name === 'cases' ? cleanCase : cleanExplanation)) } catch (error) { fail(error) } }
  })
  const get = key => transaction(['cases'], 'readonly', (tx, done, fail) => {
    const request = tx.objectStore('cases').get(id(key))
    request.onsuccess = () => { try { guard(); done(request.result ? cleanCase(request.result) : null) } catch (error) { fail(error) } }
  })
  const change = (key, update) => transaction(['cases'], 'readwrite', (tx, done, fail) => {
    const store = tx.objectStore('cases'), request = store.get(id(key))
    request.onsuccess = () => { try { guard(); const value = cleanCase(update(request.result ? cleanCase(request.result) : null)); store.put(value); done(value) } catch (error) { fail(error) } }
  })
  const fsrs = () => {
    guard()
    if (window.NOIMPTY_FSRS) return Promise.resolve(window.NOIMPTY_FSRS)
    if (fsrsLoading) return fsrsLoading
    fsrsLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      let timer
      const finish = error => { clearTimeout(timer); script.remove(); if (error) { fsrsLoading = null; reject(error) } else resolve(window.NOIMPTY_FSRS) }
      script.src = document.getElementById('review-fsrs-src')?.getAttribute('src') || '/js/review-fsrs.js'
      script.onload = () => finish(window.NOIMPTY_FSRS ? null : new Error('复习算法加载失败。'))
      script.onerror = () => finish(new Error('复习算法加载失败，请重试。'))
      timer = setTimeout(() => finish(new Error('复习算法加载超时，请重试。')), 20000)
      document.head.append(script)
    })
    return fsrsLoading
  }
  const schedule = (value, F) => {
    const scheduler = F.fsrs(F.generatorParameters({ enable_fuzz: false }))
    let card = F.createEmptyCard(new Date(value.createdAt))
    for (const review of value.reviews) {
      const at = new Date(Math.max(Date.parse(review.at), card.last_review?.getTime() || 0))
      card = scheduler.next(card, at, review.rating).card
    }
    return card
  }
  const list = async () => {
    const [records, F] = await Promise.all([all('cases'), fsrs()]); guard()
    return records.map(value => ({ ...value, due: schedule(value, F).due.toISOString(), solved: value.attempts.some(item => passesOriginal(value.attempts, item)) })).sort((a, b) => a.due.localeCompare(b.due))
  }
  const saveFailure = async input => {
    guard()
    const value = attempt({ ...input, id: input.id || uuid(), at: input.at || new Date().toISOString() })
    if (!value.result.runId || !FAILURES.includes(value.result.status)) throw new Error('先运行代码，只有真实失败结果才能存为错题现场。')
    const key = 'case:' + value.id
    return change(key, previous => previous || { id: key, title: input.title || value.problem.slice(0, 100) || `${value.language} · ${value.result.status}`, createdAt: value.at, updatedAt: value.at, attempts: [value], reviews: [] })
  }
  const addAttempt = async (key, input) => {
    guard()
    const value = attempt({ ...input, id: input.id || uuid(), at: input.at || new Date().toISOString() })
    if (!value.result.runId) throw new Error('本次没有已完成的运行结果。')
    return change(key, record => {
      if (!record) throw new Error('找不到这个错题现场。')
      if (record.attempts.some(item => item.id === value.id || item.result.runId === value.result.runId)) throw new Error('这次运行已保存，请重做后再记录。')
      record.attempts.push(value); record.updatedAt = value.at; return record
    })
  }
  const rate = async (key, attemptId, rating) => {
    if (![1, 2, 3, 4].includes(rating)) throw new Error('评分无效。')
    const F = await fsrs(); guard()
    return change(key, record => {
      if (!record || record.attempts[0].id === attemptId || !record.attempts.some(item => item.id === attemptId)) throw new Error('先在练习台完成一次新的重做并保存结果，再安排复习。')
      if (rating > 1 && !passesOriginal(record.attempts, record.attempts.find(item => item.id === attemptId))) throw new Error('这次尚未通过原题全部测试，请选择重来；用原输入 / 测试重做并通过后再评估熟练度。')
      if (record.reviews.some(item => item.attemptId === attemptId)) throw new Error('这次重做已经评分，无需重复提交。')
      record.reviews.push({ id: uuid(), at: new Date().toISOString(), attemptId, rating })
      record.updatedAt = new Date().toISOString(); schedule(record, F); return record
    })
  }
  const recordExplanation = input => {
    guard()
    if (input?.confirmed !== true) return Promise.reject(new Error('请明确确认保存这段讲解。'))
    const value = cleanExplanation({ ...input, id: uuid(), createdAt: new Date().toISOString() })
    return transaction(['explanations'], 'readwrite', (tx, done, fail) => {
      const store = tx.objectStore('explanations')
      const add = () => { try { guard(); store.add(value); done(value) } catch (error) { fail(error) } }
      if (!value.revises) return add()
      const request = store.get(value.revises)
      request.onsuccess = () => { if (!request.result) return fail(new Error('原讲解记录不存在，请重新打开后再讲一次。')); add() }
    })
  }
  const exportData = () => transaction(['cases', 'explanations'], 'readonly', (tx, done, fail) => {
    const value = { kind: 'noimpty-learning-evidence', version: VERSION, exportedAt: new Date().toISOString() }
    let waiting = 2
    for (const name of ['cases', 'explanations']) {
      const request = tx.objectStore(name).getAll()
      request.onsuccess = () => { try { guard(); value[name] = request.result.map(name === 'cases' ? cleanCase : cleanExplanation); if (!--waiting) done(value) } catch (error) { fail(error) } }
    }
  })
  const merge = (old, incoming) => {
    if (!old) return incoming
    if (old.attempts[0].id !== incoming.attempts[0].id || old.createdAt !== incoming.createdAt) throw new Error('备份中存在冲突的错题编号，未导入任何记录。')
    const union = (a, b) => {
      const values = new Map(a.map(value => [value.id, value]))
      for (const value of b) { if (values.has(value.id) && JSON.stringify(values.get(value.id)) !== JSON.stringify(value)) throw new Error('同一记录编号的内容不一致，未覆盖旧数据。'); values.set(value.id, value) }
      return [...values.values()]
    }
    return cleanCase({ ...old, attempts: union(old.attempts, incoming.attempts), reviews: union(old.reviews, incoming.reviews), updatedAt: [old.updatedAt, incoming.updatedAt].sort().at(-1) })
  }
  const importData = async value => {
    guard()
    if (!object(value) || value.kind !== 'noimpty-learning-evidence' || value.version !== VERSION || !Array.isArray(value.cases) || !Array.isArray(value.explanations) || value.cases.length > 5000 || value.explanations.length > 5000) throw new Error('这不是有效的学习现场备份。')
    const cases = value.cases.map(cleanCase), explanations = value.explanations.map(cleanExplanation), F = await fsrs()
    if (new Set(cases.map(item => item.id)).size !== cases.length || new Set(explanations.map(item => item.id)).size !== explanations.length) throw new Error('备份包含重复编号。')
    for (const record of cases) schedule(record, F)
    return transaction(['cases', 'explanations'], 'readwrite', (tx, done, fail) => {
      for (const incoming of cases) {
        const store = tx.objectStore('cases'), request = store.get(incoming.id)
        request.onsuccess = () => { try { guard(); const value = merge(request.result ? cleanCase(request.result) : null, incoming); schedule(value, F); store.put(value) } catch (error) { fail(error) } }
      }
      for (const incoming of explanations) {
        const store = tx.objectStore('explanations'), request = store.get(incoming.id)
        request.onsuccess = () => { try { guard(); if (request.result && JSON.stringify(cleanExplanation(request.result)) !== JSON.stringify(incoming)) throw new Error('讲解编号冲突，未覆盖旧数据。'); if (!request.result) store.add(incoming) } catch (error) { fail(error) } }
      }
      done({ cases: cases.length, explanations: explanations.length })
    })
  }
  const summary = async () => {
    if (!unlocked()) return null
    const [records, explanations] = await Promise.all([list(), all('explanations')]); guard()
    return { cases: records.length, due: records.filter(item => Date.parse(item.due) <= Date.now()).length, solved: records.filter(item => item.solved).length,
      attempts: records.reduce((n, item) => n + item.attempts.length, 0), explanations: explanations.length, dueExplanations: explanations.filter(item => item.reviewQuestions.length && !explanations.some(next => next.revises === item.id)).length,
      latestAt: [...records.map(item => item.updatedAt), ...explanations.map(item => item.createdAt)].sort().at(-1) || null }
  }
  window.NOIMPTY_LEARNING_HISTORY = Object.freeze({ unlocked, canAdvance: (record, attemptId) => unlocked() && !!record && passesOriginal(record.attempts, record.attempts.find(item => item.id === attemptId)), get, list, summary, saveFailure, addAttempt, rate, recordExplanation, getExplanation: async key => { const values = await all('explanations'); return values.find(item => item.id === key) || null }, listExplanations: () => all('explanations'), exportData, importData })
})()
