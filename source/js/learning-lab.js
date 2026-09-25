/* 实际执行由独立、经鉴权的隔离服务提供；此文件不模拟编译器或终端。 */
(() => {
  'use strict'
  if (window.NANALY_BACKUP_PENDING) return
  if (window.NOIMPTY_LEARNING) return

  const STORE = 'noimpty-learning-v1'
  const MAX_CODE = 65536
  const MAX_OUTPUT = 32768
  const MAX_HISTORY = 40
  const STATEFUL = new Set(['git', 'linux', 'mysql'])
  const CHECKABLE = new Set(['c', 'cpp', 'go', 'git', 'linux'])
  const STATUS = { accepted: '通过', wrong_answer: '测试未通过', compile_error: '编译错误', runtime_error: '运行错误', timeout: '执行超时', output_limit: '输出超限', checked: '工具检查完成', unsupported_check: '此语言需要实际运行才能检查' }
  const LESSONS = [
    { id: 'c', name: 'C · 两数之和', title: '从标准输入读取两个整数', language: 'c',
      description: '读取两个绝对值不超过 10⁹ 的整数，输出它们的和。先运行示例，再试试负数与边界值。修改代码后可恢复历史中的失败版本，与修正后的版本比较。',
      code: '#include <stdio.h>\n\nint main(void) {\n    long long a, b;\n    if (scanf("%lld %lld", &a, &b) != 2) return 1;\n    printf("%lld\\n", a + b);\n    return 0;\n}\n', stdin: '2 3\n', tests: [{ input: '2 3\n', expectedOutput: '5\n' }, { input: '-4 7\n', expectedOutput: '3\n' }, { input: '1000000000 1000000000\n', expectedOutput: '2000000000\n' }] },
    { id: 'cpp', name: 'C++ · 排序', title: '把序列按升序输出', language: 'cpp',
      description: '第一行是元素数量 n（0 ≤ n ≤ 1000），随后是 n 个整数。输出升序序列，以空格分隔，最后换行。测试覆盖重复值、负数和空序列。',
      code: '#include <algorithm>\n#include <iostream>\n#include <vector>\n\nint main() {\n    int n;\n    if (!(std::cin >> n) || n < 0 || n > 1000) return 1;\n    std::vector<int> a(n);\n    for (auto &x : a) if (!(std::cin >> x)) return 1;\n    std::sort(a.begin(), a.end());\n    for (int i = 0; i < n; ++i) {\n        if (i) std::cout << " ";\n        std::cout << a[i];\n    }\n    std::cout << "\\n";\n}\n', stdin: '5\n3 -1 3 2 0\n', tests: [{ input: '5\n3 -1 3 2 0\n', expectedOutput: '-1 0 2 3 3\n' }, { input: '0\n', expectedOutput: '\n' }] },
    { id: 'go', name: 'Go · 输入与输出', title: '使用 fmt 读取并计算', language: 'go',
      description: '用 fmt.Fscan 从标准输入读取两个 int64 整数，输出它们的和。比较 C 与 Go 的错误处理方式。',
      code: 'package main\n\nimport (\n    "fmt"\n    "os"\n)\n\nfunc main() {\n    var a, b int64\n    if _, err := fmt.Fscan(os.Stdin, &a, &b); err != nil {\n        fmt.Fprintln(os.Stderr, err)\n        os.Exit(1)\n    }\n    fmt.Println(a + b)\n}\n', stdin: '2 3\n', tests: [{ input: '2 3\n', expectedOutput: '5\n' }, { input: '-4 7\n', expectedOutput: '3\n' }] },
    { id: 'git', name: 'Git · 分支与提交', title: '在独立练习仓库中观察 Git', language: 'git',
      description: '每次运行都会在自己的练习目录中执行命令，仓库文件会保留。先初始化仓库并查看状态，再把编辑器中的命令改为 git add notes.txt、git commit 或 git switch。每次执行是一个新 shell；cd 与环境变量只在本次脚本内有效。',
      code: 'git init\ngit config user.name "Learner"\ngit config user.email "learner@example.invalid"\nprintf "My first practice\\n" > notes.txt\ngit status --short --branch\n', stdin: '', tests: [] },
    { id: 'linux', name: 'Linux · 文件与管道', title: '操作练习文件系统', language: 'linux',
      description: '在隔离目录中练习文件、管道和文本处理。运行下面的脚本，然后尝试 cat、sort、grep 与 find。文件跨次执行保留；每次执行是新 shell，请在同一脚本内使用 cd。这里的文件与博客服务器、你的电脑文件相互隔离。',
      code: 'mkdir -p practice\nprintf "orange\\napple\\norange\\n" > practice/fruit.txt\nsort practice/fruit.txt | uniq -c\nprintf "\\nFiles:\\n"\nfind practice -maxdepth 2 -type f\n', stdin: '', tests: [] },
    { id: 'mysql', name: 'MySQL · 查询与表结构', title: '建立表并查询', language: 'mysql',
      description: 'SQL 在独立的 MySQL 练习数据库中实际执行，表和数据跨次运行保留。先运行示例，再修改 WHERE、ORDER BY 或 GROUP BY，并用 SHOW TABLES、DESCRIBE 检查真实结构。重置会清空这个练习数据库。',
      code: 'CREATE TABLE IF NOT EXISTS learners (id INT PRIMARY KEY, name VARCHAR(40), score INT);\nREPLACE INTO learners VALUES (1, \'小林\', 88), (2, \'小周\', 95), (3, \'小陈\', 72);\nSELECT name, score FROM learners WHERE score >= 80 ORDER BY score DESC;\nDESCRIBE learners;\n', stdin: '', tests: [] }
  ]
  const lessonFor = id => LESSONS.find(item => item.id === id) || LESSONS[0]
  const clip = (value, size = MAX_OUTPUT) => String(value == null ? '' : value).slice(0, size)
  const plain = value => !!value && typeof value === 'object' && !Array.isArray(value)
  const safeRead = storage => { try { const raw = storage?.getItem(STORE); return raw && raw.length <= 4000000 ? JSON.parse(raw) : null } catch (_) { return null } }
  const cleanTests = tests => Array.isArray(tests) ? tests.slice(0, 10).filter(plain).map(test => ({ input: clip(test.input, 8192), ...(typeof test.expectedOutput === 'string' ? { expectedOutput: clip(test.expectedOutput, 8192) } : {}) })) : []
  const cleanResult = value => {
    if (!plain(value) || !Object.hasOwn(STATUS, value.status)) throw new Error('执行服务返回了无法识别的结果，请检查服务版本。')
    return { runId: clip(value.runId, 128), revision: value.revision, status: value.status, stdout: clip(value.stdout), stderr: clip(value.stderr),
      diagnostics: Array.isArray(value.diagnostics) ? value.diagnostics.slice(0, 100).filter(plain).map(d => ({ severity: d.severity === 'warning' ? 'warning' : 'error', message: clip(d.message, 2000), line: Number.isInteger(d.line) && d.line > 0 ? d.line : null, column: Number.isInteger(d.column) && d.column > 0 ? d.column : null })) : [],
      tests: Array.isArray(value.tests) ? value.tests.slice(0, 10).filter(plain).map(test => ({ status: clip(test.status, 64), input: clip(test.input, 8192), stdout: clip(test.stdout), stderr: clip(test.stderr), ...(typeof test.expectedOutput === 'string' ? { expectedOutput: clip(test.expectedOutput, 8192) } : {}) })) : [],
      warnings: Array.isArray(value.warnings) ? value.warnings.slice(0, 10).map(item => clip(item, 2000)) : [],
      workspaceSummary: clip(value.workspaceSummary), workspaceCommitted: value.workspaceCommitted !== false, historyOutputTruncated: value.historyOutputTruncated === true,
      ...(typeof value.workspaceId === 'string' ? { workspaceId: clip(value.workspaceId, 128) } : {}),
      ...(Number.isInteger(value.workspaceRevision) ? { workspaceRevision: value.workspaceRevision } : {}) }
  }
  const cleanPractice = value => {
    if (!plain(value) || !['c', 'cpp', 'go'].includes(value.language) || typeof value.id !== 'string' || !value.id.trim() ||
        typeof value.title !== 'string' || !value.title.trim() || typeof value.statement !== 'string' || !value.statement.trim() ||
        typeof value.starterCode !== 'string' || typeof value.referenceCode !== 'string' || !value.referenceCode.trim() ||
        value.verification?.status !== 'accepted' || typeof value.verification?.runId !== 'string' || !value.verification.runId ||
        !Array.isArray(value.tests) || !value.tests.length || value.tests.length > 10 ||
        value.tests.some(test => !plain(test) || typeof test.input !== 'string' || typeof test.expectedOutput !== 'string' || test.input.length > 8192 || test.expectedOutput.length > 8192) ||
        value.starterCode.length > MAX_CODE || value.referenceCode.length > MAX_CODE) throw new Error('练习缺少有效题面、参考解、测试或真实通过的验证记录，未载入。')
    return { id: clip(value.id, 128), language: value.language, title: clip(value.title, 300), statement: clip(value.statement, 12000), starterCode: value.starterCode, referenceCode: value.referenceCode, tests: cleanTests(value.tests), verification: { runId: clip(value.verification.runId, 128), status: 'accepted' } }
  }
  const optionalPractice = value => { try { return value ? cleanPractice(value) : null } catch (_) { return null } }
  const recordPractice = record => {
    if (!plain(record.practice)) return null
    const exercise = record.practice
    if (exercise.verification) return optionalPractice(exercise)
    // A generated reference is saved before its verification result exists.
    // Reconstruct evidence only from that exact successful source/test run.
    if (record.status !== 'accepted' || record.mode === 'check' || record.code !== exercise.referenceCode || record.language !== exercise.language || !record.runId ||
        !Array.isArray(record.tests) || record.tests.length !== exercise.tests?.length || record.tests.some(test => test?.status !== 'accepted') ||
        !Array.isArray(record.testCases) || JSON.stringify(cleanTests(record.testCases)) !== JSON.stringify(cleanTests(exercise.tests))) return null
    return optionalPractice({ ...exercise, verification: { runId: record.runId, status: 'accepted' } })
  }

  // Controller deliberately separates current-code diagnostics from immutable submissions.
  // A late run may enter history, but can never overwrite a newer editor revision.
  const createSession = ({ request, available = () => true, permitted = () => true, storage, changed = () => {} }) => {
    const cached = permitted() ? safeRead(storage) : null
    const state = { lessonId: 'c', revision: 0, code: '', stdin: '', tests: [], exercise: null, result: null, checked: null, history: [], backups: [], drafts: {}, workspaces: {}, busy: false, checking: false, error: '', notice: '', storageError: '', persist: cached?.persist !== false, autoCheck: cached?.autoCheck !== false }
    let activeRun = null
    let activeCheck = null
    let activeReset = null
    let activeSync = null
    let closed = false
    let sequence = 0
    const emit = () => { if (!closed) changed(state) }
    if (plain(cached) && cached.version === 1) {
      if (plain(cached.drafts)) for (const lesson of LESSONS) {
        const draft = cached.drafts[lesson.id]
        if (plain(draft) && typeof draft.code === 'string') state.drafts[lesson.id] = { code: clip(draft.code, MAX_CODE), stdin: clip(draft.stdin, 8192), tests: cleanTests(draft.tests), exercise: optionalPractice(draft.exercise) }
      }
      if (Array.isArray(cached.history)) state.history = cached.history.slice(0, MAX_HISTORY).filter(record => plain(record) && LESSONS.some(l => l.id === record.lessonId) && typeof record.code === 'string').flatMap(record => {
        try { return [{ id: clip(record.id, 128), at: clip(record.at, 64), lessonId: record.lessonId, revision: Number(record.revision) || 0, code: clip(record.code, MAX_CODE), stdin: clip(record.stdin, 8192), tests: cleanTests(record.tests), exercise: optionalPractice(record.exercise), referenceValidation: record.referenceValidation === true && record.code === record.exercise?.referenceCode && record.result?.status === 'accepted' && record.exercise?.verification?.runId === record.result?.runId, result: cleanResult(record.result) }] } catch (_) { return [] }
      })
      if (Array.isArray(cached.backups)) state.backups = cached.backups.slice(0, 10).filter(record => plain(record) && LESSONS.some(l => l.id === record.lessonId) && typeof record.code === 'string').map(record => ({ id: clip(record.id, 128), at: clip(record.at, 64), lessonId: record.lessonId, code: clip(record.code, MAX_CODE), stdin: clip(record.stdin, 8192), tests: cleanTests(record.tests), exercise: optionalPractice(record.exercise) }))
    }
    const draft = () => ({ code: state.code, stdin: state.stdin, tests: cleanTests(state.tests), exercise: state.exercise })
    const save = () => {
      if (!permitted()) return
      state.drafts[state.lessonId] = draft()
      try { storage?.setItem(STORE, JSON.stringify(state.persist ? { version: 1, persist: true, autoCheck: state.autoCheck, drafts: state.drafts, history: state.history, backups: state.backups } : { version: 1, persist: false, autoCheck: state.autoCheck })); state.storageError = storage ? '' : '浏览器存储不可用，关闭页面后草稿和历史将丢失。' }
      catch (_) { state.storageError = '浏览器存储不可用或空间不足，当前记录仅保留到关闭页面。请下载记录备份。' }
    }
    const cancelCheck = () => { activeCheck?.controller.abort(); activeCheck = null; state.checking = false }
    const edit = patch => {
      if (closed || !permitted()) return
      if (Object.hasOwn(patch, 'code')) state.code = clip(patch.code, MAX_CODE)
      if (Object.hasOwn(patch, 'stdin')) state.stdin = clip(patch.stdin, 8192)
      if (Object.hasOwn(patch, 'tests')) state.tests = cleanTests(patch.tests)
      if (Object.hasOwn(patch, 'exercise')) state.exercise = optionalPractice(patch.exercise)
      state.revision++; state.result = null; state.checked = null; state.error = ''; state.notice = ''
      cancelCheck(); save(); emit()
    }
    const select = id => {
      if (closed || !permitted() || state.busy) return false
      save(); cancelCheck()
      const lesson = lessonFor(id)
      state.lessonId = lesson.id
      const source = state.drafts[lesson.id] || lesson
      state.code = source.code; state.stdin = source.stdin; state.tests = cleanTests(source.tests); state.exercise = optionalPractice(source.exercise)
      state.revision++; state.result = null; state.checked = null; state.error = ''; state.notice = ''; emit()
      return true
    }
    const preflight = () => {
      if (!permitted()) throw new Error('请先解锁私人页面。')
      if (!available()) throw new Error('尚未连接隔离执行服务。请在娜娜莉工作室中连接个人后端；当前代码尚未执行。')
      if (!state.code.trim()) throw new Error('请先输入代码、命令或 SQL。')
    }
    const run = async (mode = 'run', useTests = false) => {
      if (closed || state.busy) return null
      try { preflight() } catch (error) { state.error = error.message; emit(); return null }
      const lesson = lessonFor(state.lessonId)
      const workspace = state.workspaces[lesson.language]
      if (mode === 'run' && workspace?.uncertain) { state.error = '上次执行被中断，工作区状态尚不确定。请先重置练习环境，再继续运行。'; emit(); return null }
      cancelCheck()
      const operation = { controller: new AbortController(), seq: ++sequence, revision: state.revision, lessonId: state.lessonId, draft: draft() }
      if (mode === 'check') { activeCheck = operation; state.checking = true }
      else { activeRun = operation; state.busy = true }
      state.error = ''; state.notice = mode === 'check' ? '正在使用语言工具检查当前版本…' : `正在执行版本 ${operation.revision}…`; emit()
      const current = () => !closed && !operation.controller.signal.aborted && (mode === 'check' ? activeCheck === operation : activeRun === operation)
      try {
        const response = await request('/api/run', { method: 'POST', signal: operation.controller.signal, body: { language: lesson.language, code: operation.draft.code, stdin: operation.draft.stdin, ...(operation.draft.exercise ? { practice: operation.draft.exercise } : {}), tests: useTests ? operation.draft.tests : [], revision: operation.revision, mode, ...(workspace?.id ? { workspaceId: workspace.id, workspaceRevision: workspace.revision } : {}) } })
        if (!current() || !permitted()) return null
        const result = cleanResult(response)
        if (result.revision !== operation.revision) throw new Error('执行结果版本不匹配，已丢弃，未更新当前诊断。')
        if (mode === 'run' && result.workspaceId) state.workspaces[lesson.language] = { id: result.workspaceId, revision: result.workspaceRevision, uncertain: false }
        if (mode === 'run') {
          state.history.unshift({ id: result.runId || `${Date.now()}-${operation.seq}`, at: new Date().toISOString(), lessonId: operation.lessonId, revision: operation.revision, ...operation.draft, result })
          state.history = state.history.slice(0, MAX_HISTORY)
          if (state.revision === operation.revision && state.lessonId === operation.lessonId) state.result = result
          state.notice = state.revision === operation.revision ? `版本 ${operation.revision}：${STATUS[result.status]}` : `版本 ${operation.revision} 已完成并保存到历史；当前版本 ${state.revision} 尚未运行。`
          save()
        } else if (state.revision === operation.revision && state.lessonId === operation.lessonId) {
          state.checked = result; state.notice = result.status === 'unsupported_check' ? '此语言暂不支持独立语法检查，请明确点击运行后查看实际结果。' : '当前版本已完成工具检查；检查不代表运行或测试通过。'
        }
        return result
      } catch (error) {
        if (!current()) return null
        state.error = clip(error?.message || '执行服务暂时无法连接，代码未得到可验证结果。', 2000)
        state.notice = ''
        if (mode === 'run' && STATEFUL.has(lesson.language)) state.workspaces[lesson.language] = { ...workspace, uncertain: true }
        return null
      } finally {
        if (mode === 'run' && activeRun === operation) { activeRun = null; state.busy = false }
        if (mode === 'check' && activeCheck === operation) { activeCheck = null; state.checking = false }
        emit()
      }
    }
    const cancel = () => {
      cancelCheck()
      if (activeRun) {
        if (STATEFUL.has(lessonFor(activeRun.lessonId).language)) {
          const language = lessonFor(activeRun.lessonId).language
          state.workspaces[language] = { ...state.workspaces[language], uncertain: true }
        }
        activeRun.controller.abort(); activeRun = null; state.busy = false
        state.notice = '已停止等待结果。服务端可能已执行部分命令；有状态环境需要重置后继续。'
      }
      if (activeReset) {
        const language = activeReset.language
        state.workspaces[language] = { ...state.workspaces[language], uncertain: true }
        activeReset.controller.abort(); activeReset = null; state.busy = false
        state.notice = '已停止等待重置结果；工作区状态尚不确定，请重新重置后继续。'
      }
      emit()
    }
    const reset = async () => {
      if (closed || state.busy) return false
      let operation = null
      try {
        if (!permitted() || !available()) throw new Error('请先解锁页面并连接隔离执行服务。')
        cancelCheck()
        const lesson = lessonFor(state.lessonId)
        if (!STATEFUL.has(lesson.language)) { edit({ code: lesson.code, stdin: lesson.stdin, tests: lesson.tests, exercise: null }); return true }
        operation = { controller: new AbortController(), language: lesson.language }; activeReset = operation
        state.busy = true; state.error = ''; emit()
        const previous = state.workspaces[lesson.language]
        const result = await request('/api/workspaces/reset', { method: 'POST', signal: operation.controller.signal, body: { language: lesson.language, ...(previous?.id ? { workspaceId: previous.id } : {}) } })
        if (closed || !permitted() || operation.controller.signal.aborted || activeReset !== operation) return false
        if (!plain(result) || typeof result.workspaceId !== 'string') throw new Error('重置响应无效。')
        state.workspaces[lesson.language] = { id: result.workspaceId, revision: result.revision, uncertain: false }
        state.revision++; state.result = null; state.checked = null; state.notice = '隔离练习环境已重置。代码和提交历史仍保留。'
        return true
      } catch (error) { if (!closed && !operation?.controller.signal.aborted) state.error = clip(error.message, 2000); return false }
      finally { if (!operation || activeReset === operation) { activeReset = null; state.busy = false; emit() } }
    }
    const restore = id => {
      if (state.busy || !permitted()) return false
      const record = state.history.find(item => item.id === id)
      if (!record) return false
      if (record.referenceValidation && record.exercise) { loadPractice(record.exercise); return true }
      select(record.lessonId); edit(record)
      state.notice = `已恢复 ${record.at} 的代码和输入；历史输出仅供复盘，当前版本需要重新执行。`; emit(); return true
    }
    const loadPractice = exercise => {
      if (closed || !permitted()) throw new Error('请先解锁练习页面。')
      if (state.busy) throw new Error('当前练习仍在执行，请等待完成后再载入。')
      const prepared = cleanPractice(exercise)
      state.backups = [{ id: `draft-${Date.now()}-${++sequence}`, at: new Date().toISOString(), lessonId: state.lessonId, ...draft() }, ...state.backups].slice(0, 10)
      select(prepared.language)
      edit({ code: prepared.starterCode, stdin: prepared.tests[0].input, tests: prepared.tests, exercise: prepared })
      state.notice = '已载入 AI 生成练习；参考解已通过所列测试，当前起始代码尚未运行。原草稿保留在恢复点中。'; emit()
      return { loaded: true, id: prepared.id, revision: state.revision, verification: prepared.verification }
    }
    const restoreBackup = id => {
      if (closed || state.busy || !permitted()) return false
      const record = state.backups.find(item => item.id === id)
      if (!record) return false
      select(record.lessonId); edit(record); state.notice = '已恢复准备练习前的草稿；当前版本尚未执行。'; emit(); return true
    }
    const persistence = enabled => {
      if (!permitted()) return
      state.persist = !!enabled
      if (state.persist) save()
      else { try { storage?.removeItem(STORE); storage?.setItem(STORE, JSON.stringify({ version: 1, persist: false, autoCheck: state.autoCheck })) } catch (_) { state.storageError = '浏览器不允许更新存储；请使用浏览器站点设置清除已有记录。' } }
      emit()
    }
    const setAutoCheck = enabled => { if (closed || !permitted()) return; state.autoCheck = !!enabled; if (!state.autoCheck) cancelCheck(); save(); emit() }
    const canAutoCheck = () => !closed && state.autoCheck && !!state.code.trim() && permitted() && available() && CHECKABLE.has(lessonFor(state.lessonId).language)
    const autoCheckCurrent = () => canAutoCheck() ? run('check') : Promise.resolve(null)
    const clearHistory = () => { if (!permitted()) return; state.history = []; save(); emit() }
    const syncHistory = async () => {
      if (closed || activeSync || !permitted() || !available()) return false
      const controller = new AbortController(); activeSync = controller
      try {
        const response = await request('/api/runs?limit=40', { signal: controller.signal })
        if (closed || controller.signal.aborted || !permitted()) return false
        if (!Array.isArray(response?.runs)) throw new Error('云端提交记录格式无效。')
        const records = response.runs.filter(record => plain(record) && typeof record.code === 'string' && LESSONS.some(l => l.id === record.language) && record.mode !== 'check').flatMap(record => {
          try { const exercise = recordPractice(record); return [{ id: clip(record.runId, 128), at: clip(record.createdAt, 64), lessonId: record.language, revision: Number(record.revision) || 0, code: clip(record.code, MAX_CODE), stdin: clip(record.stdin, 8192), tests: cleanTests(record.testCases), exercise, referenceValidation: !!exercise && record.code === exercise.referenceCode && record.status === 'accepted' && exercise.verification.runId === record.runId, result: cleanResult(record) }] } catch (_) { return [] }
        })
        const merged = new Map(state.history.map(record => [record.id, record]))
        for (const record of records) if (record.id && !merged.has(record.id)) merged.set(record.id, record)
        state.history = [...merged.values()].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)).slice(0, MAX_HISTORY)
        for (const language of STATEFUL) {
          if (state.busy || state.workspaces[language]) continue
          const record = records.find(item => item.lessonId === language && item.result.workspaceId)
          if (!record) continue
          try {
            const workspace = await request(`/api/workspaces/${encodeURIComponent(record.result.workspaceId)}`, { signal: controller.signal })
            if (!closed && !controller.signal.aborted && permitted() && !state.busy && !state.workspaces[language] && workspace?.workspaceId === record.result.workspaceId) state.workspaces[language] = { id: workspace.workspaceId, revision: workspace.revision, uncertain: !!workspace.busy || !!workspace.broken }
          } catch (_) { /* An expired workspace never invalidates the saved submission. */ }
        }
        save(); emit(); return true
      } catch (error) {
        if (!closed && !controller.signal.aborted) { state.storageError = `云端历史尚未同步：${clip(error.message, 300)}。当前本机记录仍保留。`; emit() }
        return false
      } finally { if (activeSync === controller) activeSync = null }
    }
    const dispose = () => { save(); cancel(); activeSync?.abort(); closed = true }
    const initial = state.drafts.c || LESSONS[0]
    state.code = initial.code; state.stdin = initial.stdin; state.tests = cleanTests(initial.tests); state.exercise = optionalPractice(initial.exercise)
    return { state, edit, select, run, cancel, reset, restore, loadPractice, restoreBackup, persistence, setAutoCheck, canAutoCheck, autoCheckCurrent, clearHistory, syncHistory, dispose }
  }

  const unlocked = () => { try { return window.NOIMPTY_GATE?.unlocked() === true && !document.documentElement.classList.contains('noimpty-private-locked') } catch (_) { return false } }
  const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = String(text); return el }
  const button = (text, click, className = '') => { const el = node('button', `learning-button ${className}`, text); el.type = 'button'; el.addEventListener('click', click); return el }
  let mounted = null
  let launch = null

  const mountLab = (container, article = null, onClose = null) => {
    const lifetime = new AbortController()
    const root = node('section', `learning-lab${article ? ' learning-lab--article' : ''}`)
    root.setAttribute('aria-label', '交互式学习平台')
    if (onClose) {
      root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true')
      root.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
        if (event.key !== 'Tab') return
        const focusable = Array.from(root.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary')).filter(el => el.getClientRects().length > 0)
        if (!focusable.length) return
        if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus() }
        else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus() }
      })
    }
    const heading = node('div', 'learning-heading')
    heading.append(node('span', 'learning-kicker', 'LEARN · RUN · REFLECT'), node('h2', '', '边读边练'))
    const controls = node('div', 'learning-controls')
    const selectLabel = node('label', '', '练习语言 ')
    const select = node('select', 'learning-select')
    select.setAttribute('aria-label', '选择练习语言')
    LESSONS.forEach(lesson => { const option = node('option', '', lesson.name); option.value = lesson.id; select.append(option) })
    selectLabel.append(select); controls.append(selectLabel)
    if (onClose) controls.append(button('关闭练习', onClose))
    heading.append(controls); root.append(heading)
    const connectivity = node('p', 'learning-connectivity')
    const connectActions = node('div', 'learning-actions')
    connectActions.append(button('连接 / 管理个人后端', () => { if (window.NANALY_AGENT?.open) window.NANALY_AGENT.open(); else connectivity.textContent = '个人后端暂未就绪，请打开娜娜莉工作室。' }))
    root.append(connectivity, connectActions)
    const split = node('div', 'learning-split')
    const reading = node('section', 'learning-reading')
    const title = node('h3')
    const description = node('p')
    const rules = node('p', 'learning-muted', '只有隔离环境返回的结果才会显示为执行结果。工具诊断与娜娜莉的解释分开显示。')
    reading.append(title, description, rules)
    const reference = node('details', 'learning-reference')
    reference.append(node('summary', '', '参考解与验证记录（尝试后再看）'))
    const verification = node('p', 'learning-muted')
    const referenceCode = node('pre')
    const verifiedTests = node('pre')
    reference.append(verification, referenceCode, node('h4', '', '参考解已通过的原始测试'), verifiedTests)
    reading.append(reference)
    let articleMarker = null
    if (article) {
      const articleTitle = node('h3', '', article.title)
      reading.append(articleTitle)
      if (article.element?.parentNode) {
        articleMarker = document.createComment('learning-original-article')
        article.element.before(articleMarker)
        reading.append(article.element)
      } else reading.append(node('div', 'learning-article-excerpt', article.text))
    }
    const editorPane = node('section', 'learning-editor-pane')
    const editorLabel = node('label', 'learning-editor-label', '代码 / 命令')
    const revision = node('span', 'learning-revision')
    const editorWrap = node('div', 'learning-editor-wrap')
    const gutter = node('div', 'learning-gutter'); gutter.setAttribute('aria-hidden', 'true')
    const editor = node('textarea', 'learning-editor'); editor.spellcheck = false; editor.maxLength = MAX_CODE
    editor.setAttribute('aria-label', '代码或命令编辑器'); editor.setAttribute('aria-describedby', 'learning-editor-help'); editor.wrap = 'off'
    const help = node('p', 'learning-muted', 'Ctrl / ⌘ + Enter 运行。Tab 保持键盘导航；可直接输入或粘贴缩进。')
    help.id = 'learning-editor-help'
    editorLabel.append(revision); editorWrap.append(gutter, editor)
    editorPane.append(editorLabel, editorWrap, help)
    const inputLabel = node('label', 'learning-field', '标准输入')
    const stdin = node('textarea', 'learning-input'); stdin.rows = 3; stdin.maxLength = 8192; stdin.setAttribute('aria-label', '标准输入'); inputLabel.append(stdin)
    editorPane.append(inputLabel)
    const testDetails = node('details', 'learning-tests-editor')
    testDetails.append(node('summary', '', '测试用例（每次提交最多 10 个）'))
    const testsList = node('div', 'learning-test-list')
    testDetails.append(testsList)
    const addTest = button('添加测试', () => { session.edit({ tests: [...session.state.tests, { input: '', expectedOutput: '' }] }); renderTests() })
    testDetails.append(addTest, node('p', 'learning-muted', '期望输出按执行服务的比较规则判定；留空代表期望空输出。每个用例都会真正运行。Git、Linux 和 MySQL 使用当前工作区执行，不进行重复测试。'))
    editorPane.append(testDetails)
    const actions = node('div', 'learning-actions')
    const runButton = button('运行当前输入', () => session.run())
    const testButton = button('提交全部测试', () => session.run('run', true))
    const checkButton = button('工具检查', () => session.run('check'))
    const cancelButton = button('停止等待', () => session.cancel())
    actions.append(runButton, testButton, checkButton, cancelButton)
    const autoLabel = node('label', 'learning-checkbox')
    const autoCheck = node('input'); autoCheck.type = 'checkbox'
    autoLabel.append(autoCheck, document.createTextNode('编辑后自动工具检查（仅发送至个人后端，不调用付费 AI）'))
    const autoHint = node('p', 'learning-muted')
    editorPane.append(actions, autoLabel, autoHint)
    const status = node('p', 'learning-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
    const error = node('p', 'learning-error'); error.setAttribute('role', 'alert')
    const diagnostics = node('div', 'learning-diagnostics')
    const output = node('div', 'learning-output')
    editorPane.append(status, error, diagnostics, output)
    split.append(reading, editorPane); root.append(split)
    const footer = node('div', 'learning-footer')
    const assistant = node('section', 'learning-assistant')
    assistant.append(node('h3', '', '请教娜娜莉'))
    const question = node('textarea', 'learning-question'); question.rows = 2; question.maxLength = 4000; question.placeholder = '例如：为什么这个用例失败？解释一下这条命令，或者带我一步步写。'; question.setAttribute('aria-label', '向娜娜莉提问')
    const askStatus = node('p', 'learning-muted'); askStatus.setAttribute('role', 'status')
    let asking = false
    const ask = async text => {
      if (asking || !unlocked()) return
      if (!window.NANALY?.askPractice) { askStatus.textContent = '娜娜莉暂未就绪，请先打开聊天并完成设置。'; return }
      if (!text.trim()) { askStatus.textContent = '先写下你的问题吧。'; question.focus(); return }
      asking = true; askStatus.textContent = '正在把当前练习交给娜娜莉…'
      try { const opened = await window.NANALY.askPractice({ question: text.trim(), context: context() }); if (!lifetime.signal.aborted) askStatus.textContent = opened ? '已在娜娜莉聊天中继续。AI 的推断需要通过实际运行验证。' : '尚未发送，请检查娜娜莉的连接设置。' }
      catch (_) { if (!lifetime.signal.aborted) askStatus.textContent = '发送失败，问题与代码仍保留，请稍后重试。' }
      finally { asking = false }
    }
    const askActions = node('div', 'learning-actions')
    askActions.append(button('发送问题', () => ask(question.value)), button('讲解怎么写', () => ask('请结合当前题目与我的代码，解释实现思路和具体写法，给出可以操作的步骤与示例。')), button('解释当前错误', () => ask('请区分工具已确认的问题和你的逻辑推测，解释当前诊断或真实执行失败的原因，定位对应行并给出修改建议；如果尚未执行请明确说明。')))
    let preparation = null
    let pendingPractice = null
    const prepareStatus = node('p', 'learning-muted'); prepareStatus.setAttribute('role', 'status')
    const loadPending = button('载入已验证练习', () => {
      if (!pendingPractice) return
      try { loadPractice(pendingPractice); pendingPractice = null; loadPending.hidden = true; prepareStatus.textContent = '练习已载入，原草稿保留在恢复点中。' }
      catch (error) { prepareStatus.textContent = clip(error.message, 1000) }
    })
    loadPending.hidden = true
    const prepareButton = button('请娜娜莉出题并验证', async () => {
      if (preparation || !unlocked()) return
      if (!window.NANALY?.preparePractice) { prepareStatus.textContent = '娜娜莉的出题功能暂未就绪，请检查连接设置。'; return }
      const language = lessonFor(session.state.lessonId).language
      if (!['c', 'cpp', 'go'].includes(language)) { prepareStatus.textContent = '参考解自动验证目前支持 C、C++ 和 Go；Git、Linux 与 MySQL 可在聊天中请求练习指导。'; return }
      const controller = new AbortController(); preparation = controller
      const revision = session.state.revision
      prepareButton.disabled = true; prepareStatus.textContent = '正在生成题目，并在隔离环境中编译参考解、验证每个用例…'
      try {
        const exercise = await window.NANALY.preparePractice({ request: question.value.trim() || `请结合当前${session.state.exercise?.title || lessonFor(session.state.lessonId).title}，准备一道适合继续练习的题目。`, language, signal: controller.signal })
        if (controller.signal.aborted || lifetime.signal.aborted || !unlocked()) return
        const prepared = cleanPractice(exercise)
        if (session.state.revision === revision && !session.state.busy) {
          loadPractice(prepared); prepareStatus.textContent = '参考解已通过所列测试。题面、参考解和测试覆盖仍可纠正；你的起始代码尚未运行。'
        } else {
          pendingPractice = prepared; loadPending.hidden = false; prepareStatus.textContent = '参考解验证完成。你已修改当前草稿，点击“载入已验证练习”后再切换；会保留原草稿。'
        }
      } catch (error) { if (!controller.signal.aborted && !lifetime.signal.aborted) prepareStatus.textContent = `出题或验证未完成：${clip(error.message, 1200)}。当前草稿保留。` }
      finally { if (preparation === controller) preparation = null; if (!lifetime.signal.aborted) render() }
    })
    askActions.append(prepareButton, loadPending)
    assistant.append(node('p', 'learning-muted', '也可以在问题框描述练习要求，再点击出题。只有参考解实际通过测试后才会载入；AI 生成的题面与测试覆盖仍可纠正。'))
    assistant.append(question, askActions, askStatus)
    assistant.append(prepareStatus)
    const historyPane = node('section', 'learning-history')
    historyPane.append(node('h3', '', '练习记录'))
    const localLabel = node('label', 'learning-checkbox')
    const persist = node('input'); persist.type = 'checkbox'; localLabel.append(persist, document.createTextNode('在此浏览器保存代码与最近 40 次提交（共享设备可关闭）'))
    const storageStatus = node('p', 'learning-muted'); storageStatus.setAttribute('role', 'status')
    const historyList = node('div', 'learning-history-list')
    const backupsList = node('details', 'learning-backups'); backupsList.append(node('summary', '', '准备练习前的草稿恢复点'))
    const backupsItems = node('div'); backupsList.append(backupsItems)
    const historyActions = node('div', 'learning-actions')
    const restoreSample = button('恢复示例代码', () => { const lesson = lessonFor(session.state.lessonId); if (window.confirm('恢复当前语言的示例代码？已有提交历史会保留。')) { session.edit({ ...lesson, exercise: null }); syncEditor(); renderTests() } })
    const resetWorkspace = button('重置练习环境', async () => { if (window.confirm('重置会删除当前语言练习环境中的文件、仓库或表数据。代码和提交历史会保留。继续吗？')) await session.reset() })
    const exportButton = button('下载记录', () => {
      if (!unlocked()) return
      const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), drafts: session.state.drafts, history: session.state.history, backups: session.state.backups }, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob); const link = node('a'); link.href = url; link.download = 'learning-records.json'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    })
    historyActions.append(restoreSample, resetWorkspace, exportButton, button('同步云端记录', () => session.syncHistory()), button('清空本机提交历史', () => { if (window.confirm('清空本浏览器的所有提交历史？云端副本仍保留，可通过同步找回。')) session.clearHistory() }), button('删除云端提交历史', async () => {
      if (!unlocked() || !window.NANALY_AGENT?.configured() || !window.confirm('永久删除个人后端上的全部提交历史？本机副本仍保留，需要时可单独清空。')) return
      try { await request('/api/runs', { method: 'DELETE' }); storageStatus.textContent = '云端提交历史已删除。' } catch (error) { storageStatus.textContent = `删除失败：${clip(error.message, 400)}` }
    }))
    historyPane.append(localLabel, storageStatus, historyActions, backupsList, historyList)
    footer.append(assistant, historyPane); root.append(footer); container.append(root)

    let storage
    try { storage = window.localStorage } catch (_) {}
    let timer = null
    let renderedHistory = null
    let renderedResult = null
    let renderedChecks = null
    let renderedBackups = null
    let renderedExercise = undefined
    let lastAutoRevision = null
    const request = (path, options) => window.NANALY_AGENT.request(path, options)
    const session = createSession({ request, storage, available: () => !!window.NANALY_AGENT?.configured(), permitted: unlocked, changed: () => render() })
    const context = () => {
      if (!unlocked()) return null
      const state = session.state; const lesson = lessonFor(state.lessonId)
      return { kind: 'practice', lessonId: lesson.id, title: state.exercise?.title || lesson.title, problem: state.exercise?.statement || lesson.description, exercise: state.exercise, article: article ? { title: article.title, url: article.url, text: article.text.slice(0, 12000) } : null, language: lesson.language, code: state.code, revision: state.revision, stdin: state.stdin, tests: cleanTests(state.tests), result: state.result, diagnostics: state.checked, workspace: state.workspaces[lesson.language] || null, verified: !!state.result, pending: state.busy }
    }
    let publishedContext = ''
    const publish = () => { if (unlocked()) { try { const data = context(); const signature = JSON.stringify(data); if (signature !== publishedContext) { publishedContext = signature; window.NANALY_AGENT?.setContext?.(data) } } catch (_) {} } }
    const syncEditor = () => { editor.value = session.state.code; stdin.value = session.state.stdin; select.value = session.state.lessonId }
    const loadPractice = exercise => { const loaded = session.loadPractice(exercise); syncEditor(); renderTests(); render(); return loaded }
    const renderTests = () => {
      testsList.replaceChildren()
      session.state.tests.forEach((test, index) => {
        const row = node('fieldset', 'learning-test-row'); row.append(node('legend', '', `用例 ${index + 1}`))
        const input = node('textarea', 'learning-input'); input.rows = 2; input.maxLength = 8192; input.value = test.input; input.setAttribute('aria-label', `用例 ${index + 1} 输入`)
        const expected = node('textarea', 'learning-input'); expected.rows = 2; expected.maxLength = 8192; expected.value = test.expectedOutput || ''; expected.setAttribute('aria-label', `用例 ${index + 1} 期望输出`)
        const change = () => { const tests = cleanTests(session.state.tests); tests[index] = { input: input.value, expectedOutput: expected.value }; session.edit({ tests }) }
        input.addEventListener('input', change); expected.addEventListener('input', change)
        const inputField = node('label', 'learning-field', '输入'); inputField.append(input)
        const expectedField = node('label', 'learning-field', '期望输出'); expectedField.append(expected)
        row.append(inputField, expectedField, button('删除用例', () => { session.edit({ tests: session.state.tests.filter((_, i) => i !== index) }); renderTests() }))
        testsList.append(row)
      })
    }
    const pre = (label, text) => { const wrapper = node('div', 'learning-output-block'); wrapper.append(node('h4', '', label), node('pre', '', text || '（空）')); return wrapper }
    const jump = diagnostic => {
      if (!diagnostic.line) return
      const lines = editor.value.split('\n'); const row = Math.min(diagnostic.line, lines.length) - 1
      const start = lines.slice(0, row).reduce((sum, line) => sum + line.length + 1, 0)
      editor.focus(); editor.setSelectionRange(start, start + lines[row].length); editor.scrollTop = Math.max(0, row - 3) * 23; gutter.scrollTop = editor.scrollTop
    }
    const render = () => {
      if (lifetime.signal.aborted) return
      const state = session.state; const lesson = lessonFor(state.lessonId); const stateful = STATEFUL.has(lesson.language)
      let connected = false
      try { connected = window.NANALY_AGENT?.configured() === true } catch (_) {}
      connectivity.textContent = connected ? '个人执行服务已配置。点击运行或检查会发送当前代码和输入；首次执行将验证连接与环境。' : '执行服务未连接：可以编辑和阅读，尚不能编译或执行。请在娜娜莉工作室中连接个人后端。'
      title.textContent = state.exercise?.title || lesson.title; description.textContent = state.exercise?.statement || lesson.description
      if (renderedExercise !== state.exercise) {
        reference.hidden = !state.exercise; reference.open = false
        verification.textContent = state.exercise ? `AI 生成练习 · 参考解通过所列测试 · 验证记录 ${state.exercise.verification.runId}。这不能全面证明算法正确，题面与覆盖仍可纠正。` : ''
        referenceCode.textContent = state.exercise?.referenceCode || ''
        verifiedTests.textContent = state.exercise ? state.exercise.tests.map((test, index) => `用例 ${index + 1}\n输入：\n${test.input}\n期望：\n${test.expectedOutput}`).join('\n\n') : ''
        renderedExercise = state.exercise
      }
      revision.textContent = `版本 ${state.revision}${state.result ? ' · 已执行' : ' · 尚未执行'}`
      status.textContent = state.notice; error.textContent = state.error; storageStatus.textContent = state.storageError
      persist.checked = state.persist; select.disabled = state.busy; restoreSample.disabled = state.busy
      resetWorkspace.hidden = !stateful; resetWorkspace.disabled = state.busy || !connected
      runButton.disabled = state.busy || !connected; testButton.disabled = state.busy || !connected || !state.tests.length; testButton.hidden = stateful
      checkButton.disabled = state.busy || state.checking || !connected; cancelButton.disabled = !state.busy && !state.checking
      prepareButton.disabled = !!preparation || state.busy || !connected || !['c', 'cpp', 'go'].includes(lesson.language)
      autoCheck.checked = state.autoCheck; autoCheck.disabled = !connected || !CHECKABLE.has(lesson.language)
      autoHint.textContent = lesson.language === 'mysql' ? 'MySQL 不进行自动 SQL 执行；请明确点击运行，由真实数据库返回结果与错误。' : '默认在停止编辑 900 毫秒后进行编译或语法检查；Git / Linux 只检查脚本语法，不执行命令。'
      testDetails.hidden = stateful; inputLabel.hidden = lesson.language === 'mysql'; addTest.disabled = state.tests.length >= 10
      const diagnosticResult = state.checked || state.result
      if (renderedChecks !== diagnosticResult || renderedResult !== state.result) {
        diagnostics.replaceChildren()
        if (diagnosticResult?.diagnostics.length) {
          diagnostics.append(node('h4', '', '工具确认的诊断'))
          diagnosticResult.diagnostics.forEach(d => diagnostics.append(button(`${d.line ? `第 ${d.line} 行${d.column ? `:${d.column}` : ''} · ` : ''}${d.message}`, () => jump(d), `learning-diagnostic learning-diagnostic--${d.severity}`)))
        }
        output.replaceChildren()
        if (state.result) {
          const result = state.result; output.append(node('h3', '', `真实执行结果 · ${STATUS[result.status]}`), pre('标准输出', result.stdout), pre('错误输出', result.stderr))
          if (result.workspaceSummary) output.append(pre('执行后的真实工作区状态', result.workspaceSummary))
          if (!result.workspaceCommitted) output.append(node('p', 'learning-error', '本次工作区更改未保存，下次执行从上次成功保存的状态开始。'))
          result.warnings.forEach(warning => output.append(node('p', 'learning-muted', warning)))
          result.tests.forEach((test, index) => { const panel = node('details', 'learning-test-result'); panel.open = test.status !== 'accepted'; panel.append(node('summary', '', `用例 ${index + 1} · ${STATUS[test.status] || test.status}`), pre('输入', state.tests[index]?.input ?? state.stdin), pre('实际输出', test.stdout)); if (Object.hasOwn(test, 'expectedOutput')) panel.append(pre('期望输出', test.expectedOutput)); if (test.stderr) panel.append(pre('错误信息', test.stderr)); output.append(panel) })
        } else if (state.checked) output.append(node('h4', '', `工具检查 · ${STATUS[state.checked.status]}`), pre('检查输出', state.checked.stderr || state.checked.stdout || state.checked.warnings.join('\n')), node('p', 'learning-muted', '工具检查没有验证程序运行行为。'))
        renderedChecks = diagnosticResult; renderedResult = state.result
      }
      const marked = new Set((diagnosticResult?.diagnostics || []).map(item => item.line))
      gutter.replaceChildren(...state.code.split('\n').slice(0, 5000).map((_, index) => node('span', marked.has(index + 1) ? 'has-diagnostic' : '', index + 1)))
      gutter.scrollTop = editor.scrollTop
      if (renderedHistory !== state.history) {
        historyList.replaceChildren()
        if (!state.history.length) historyList.append(node('p', 'learning-muted', '还没有实际提交记录。运行后会保留当时的代码、输入、失败信息与输出。'))
        state.history.forEach(record => {
          const entry = node('details', 'learning-history-entry')
          const time = new Date(record.at); const dateText = Number.isNaN(time.getTime()) ? record.at : time.toLocaleString()
          entry.append(node('summary', '', `${record.exercise?.title || lessonFor(record.lessonId).name} · ${record.referenceValidation ? '参考解验证 · ' : ''}${STATUS[record.result.status]} · ${dateText}`), pre(`历史版本 ${record.revision} 的代码`, record.code), pre('历史输入', record.stdin), pre('历史输出', record.result.stdout), pre('历史错误', record.result.stderr), button(record.referenceValidation ? '从起始代码重做这道题' : '恢复这个版本', () => { if (session.restore(record.id)) { syncEditor(); renderTests(); editor.focus() } }))
          if (record.result.historyOutputTruncated) entry.append(node('p', 'learning-muted', '历史输出已截断；完整判定来自原运行。恢复代码不会恢复本次执行状态，需重新运行。'))
          record.result.tests.forEach((test, index) => { entry.append(pre(`用例 ${index + 1} 输入`, record.tests[index]?.input || ''), pre(`用例 ${index + 1} 实际输出`, test.stdout)); if (Object.hasOwn(test, 'expectedOutput')) entry.append(pre(`用例 ${index + 1} 期望输出`, test.expectedOutput)) })
          historyList.append(entry)
        })
        renderedHistory = state.history
      }
      if (renderedBackups !== state.backups) {
        backupsItems.replaceChildren(); backupsList.hidden = !state.backups.length
        state.backups.forEach(record => backupsItems.append(button(`恢复 ${record.exercise?.title || lessonFor(record.lessonId).title} · ${record.at}`, () => { if (session.restoreBackup(record.id)) { syncEditor(); renderTests() } })))
        renderedBackups = state.backups
      }
      publish()
      if (state.result || state.checked) lastAutoRevision = state.revision
      if (!state.busy && !state.checking && state.revision !== lastAutoRevision && session.canAutoCheck()) scheduleCheck()
    }
    const scheduleCheck = () => {
      window.clearTimeout(timer)
      if (!lifetime.signal.aborted && session.canAutoCheck()) timer = window.setTimeout(() => {
        if (lifetime.signal.aborted || session.state.busy || !session.canAutoCheck()) return
        lastAutoRevision = session.state.revision
        session.autoCheckCurrent()
      }, 900)
    }
    editor.addEventListener('input', () => { session.edit({ code: editor.value }); scheduleCheck() })
    stdin.addEventListener('input', () => session.edit({ stdin: stdin.value }))
    editor.addEventListener('scroll', () => { gutter.scrollTop = editor.scrollTop })
    editor.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); window.clearTimeout(timer); session.run() } })
    select.addEventListener('change', () => { window.clearTimeout(timer); session.select(select.value); syncEditor(); renderTests() })
    autoCheck.addEventListener('change', () => { window.clearTimeout(timer); lastAutoRevision = null; session.setAutoCheck(autoCheck.checked); if (autoCheck.checked) scheduleCheck() })
    persist.addEventListener('change', () => session.persistence(persist.checked))
    let wasConnected = false
    const connectionChanged = () => { const connected = window.NANALY_AGENT?.configured() === true; if (connected !== wasConnected) { wasConnected = connected; render(); if (connected) session.syncHistory() } }
    const unsubscribe = window.NANALY_AGENT?.subscribe?.(connectionChanged)
    window.addEventListener('nanaly:agent-configured', connectionChanged, { signal: lifetime.signal })
    window.addEventListener('focus', render, { signal: lifetime.signal })
    syncEditor(); renderTests(); render(); connectionChanged()
    return { session, context, loadPractice, dispose: () => { window.clearTimeout(timer); preparation?.abort(); lifetime.abort(); unsubscribe?.(); session.dispose(); if (articleMarker?.parentNode && article.element) articleMarker.replaceWith(article.element); root.remove(); try { window.NANALY_AGENT?.setContext?.(null) } catch (_) {} } }
  }

  const cleanup = () => { mounted?.dispose(); mounted = null; launch?.remove(); launch = null; document.documentElement.classList.remove('learning-is-open') }
  const mount = () => {
    cleanup()
    if (!unlocked()) return
    const host = document.getElementById('learning-lab')
    if (host) { mounted = mountLab(host); return }
    const article = document.querySelector('#post #article-container')
    if (!article) return
    launch = button('边读边练', () => {
      if (!unlocked()) return
      if (mounted) { mounted.dispose(); mounted = null; document.documentElement.classList.remove('learning-is-open'); launch.focus(); return }
      const data = { title: document.querySelector('h1.post-title')?.textContent || document.title, url: window.location.href, text: clip(article.textContent, 20000), element: article }
      const holder = node('div', 'learning-article-holder'); document.body.append(holder)
      const close = () => { mounted?.dispose(); mounted = null; holder.remove(); document.documentElement.classList.remove('learning-is-open'); launch?.focus() }
      mounted = mountLab(holder, data, close)
      const originalDispose = mounted.dispose; mounted.dispose = () => { originalDispose(); holder.remove() }
      document.documentElement.classList.add('learning-is-open'); holder.querySelector('select')?.focus()
    }, 'learning-launch')
    article.before(launch)
  }
  window.NOIMPTY_LEARNING = Object.freeze({ createSession, lessons: LESSONS, mount, context: () => unlocked() ? mounted?.context() || null : null })
  window.LEARNING_LAB = Object.freeze({
    context: () => unlocked() ? mounted?.context() || null : null,
    loadPractice: exercise => { if (!unlocked() || !mounted) throw new Error('请先解锁并打开练习页面，再载入练习。'); return mounted.loadPractice(exercise) },
    runCurrent: async ({ signal } = {}) => {
      if (!unlocked() || !mounted) throw new Error('请先解锁并打开当前练习。')
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
      const session = mounted.session
      if (session.state.busy) throw new Error('当前练习正在执行，请等待完成。')
      const cancel = () => session.cancel()
      signal?.addEventListener('abort', cancel, { once: true })
      try { const result = await session.run('run', session.state.tests.length > 0); signal?.throwIfAborted(); if (!result) throw new Error(session.state.error || '本次执行未返回可验证结果。'); return result }
      finally { signal?.removeEventListener('abort', cancel) }
    }
  })
  document.addEventListener('pjax:send', cleanup)
  window.addEventListener('pjax:complete', mount)
  window.addEventListener('pagehide', cleanup)
  window.addEventListener('pageshow', event => { if (event.persisted) mount() })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
  else mount()
})()
