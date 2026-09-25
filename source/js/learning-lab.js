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
      description: '每次运行都会在自己的练习目录中执行命令，仓库文件会保留。先初始化仓库并查看状态，再把编辑器中的命令改为 git add notes.txt、git commit 或 git switch。文件、当前目录和 export 变量跨次保留；每次点击会执行编辑器中的完整脚本。',
      code: 'git init\ngit config user.name "Learner"\ngit config user.email "learner@example.invalid"\nprintf "My first practice\\n" > notes.txt\ngit status --short --branch\n', stdin: '', tests: [] },
    { id: 'linux', name: 'Linux · 文件与管道', title: '操作练习文件系统', language: 'linux',
      description: '在隔离目录中练习文件、管道和文本处理。运行下面的脚本，然后尝试 cat、sort、grep 与 find。文件、当前目录和 export 变量跨次保留；每次点击会执行编辑器中的完整脚本。这里的文件与博客服务器、你的电脑文件相互隔离。',
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
      cwd: typeof value.cwd === 'string' ? clip(value.cwd, 4096) : '', exitCode: Number.isInteger(value.exitCode) ? value.exitCode : null,
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
    const state = { lessonId: lessonFor(cached?.lessonId).id, revision: 0, code: '', stdin: '', tests: [], exercise: null, result: null, lastOutput: null, checked: null, history: [], backups: [], drafts: {}, workspaces: {}, restoring: false, busy: false, checking: false, error: '', notice: '', storageError: '', persist: cached?.persist !== false, autoCheck: cached?.autoCheck === true }
    let activeRun = null
    let activeCheck = null
    let activeReset = null
    let activeSync = null
    let activeRecovery = null
    let workspacesReady = false
    let workspaceEpoch = 0
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
      try { storage?.setItem(STORE, JSON.stringify(state.persist ? { version: 1, persist: true, lessonId: state.lessonId, autoCheck: state.autoCheck, drafts: state.drafts, history: state.history, backups: state.backups } : { version: 1, persist: false, autoCheck: state.autoCheck })); state.storageError = storage ? '' : '浏览器存储不可用，关闭页面后草稿和历史将丢失。' }
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
      const source = state.drafts[lesson.id] || { code: '', stdin: '', tests: [], exercise: null }
      state.code = source.code; state.stdin = source.stdin; state.tests = cleanTests(source.tests); state.exercise = optionalPractice(source.exercise)
      state.revision++; state.result = null; state.lastOutput = null; state.checked = null; state.error = ''; state.notice = ''; save(); emit()
      return true
    }
    const preflight = () => {
      if (!permitted()) throw new Error('请先解锁私人页面。')
      if (!available()) throw new Error('尚未连接隔离执行服务。请在娜娜莉工作室中连接个人后端；当前代码尚未执行。')
      if (!state.code.trim()) throw new Error('请先输入代码、命令或 SQL。')
    }
    const workspaceState = value => {
      if (!plain(value) || typeof (value.workspaceId || value.id) !== 'string' || !(value.workspaceId || value.id) || !Number.isInteger(value.revision) || value.revision < 0) throw new Error('工作区响应无效，请重试。')
      return { id: value.workspaceId || value.id, revision: value.revision, busy: value.busy === true, broken: value.broken === true, uncertain: value.busy === true || value.broken === true }
    }
    const restoreWorkspaces = async (force = false) => {
      if (closed || !permitted() || !available()) return false
      if (activeRecovery) return activeRecovery.promise
      if (workspacesReady && !force) return true
      const recovery = { controller: new AbortController(), epoch: workspaceEpoch }
      activeRecovery = recovery; state.restoring = true
      recovery.promise = (async () => {
        try {
          const response = await request('/api/workspaces', { signal: recovery.controller.signal })
          if (closed || recovery.controller.signal.aborted || !permitted()) return false
          if (!Array.isArray(response?.workspaces)) throw new Error('工作区列表响应无效，请检查后端版本。')
          const restored = {}
          const ordered = [...response.workspaces].sort((a, b) => (Date.parse(b?.updatedAt) || 0) - (Date.parse(a?.updatedAt) || 0))
          for (const value of ordered) {
            if (!plain(value) || !STATEFUL.has(value.language)) continue
            const workspace = workspaceState(value)
            if (!restored[value.language]) restored[value.language] = workspace
          }
          if (recovery.epoch === workspaceEpoch) { state.workspaces = restored; workspacesReady = true }
          return true
        } catch (error) {
          if (!closed && !recovery.controller.signal.aborted) state.error = `工作区尚未恢复：${clip(error.message, 300)}。请重试，现有文件不会被清空。`
          return false
        } finally {
          if (activeRecovery === recovery) { activeRecovery = null; state.restoring = false; emit() }
        }
      })()
      emit()
      return recovery.promise
    }
    const refreshWorkspace = async (language, workspace, signal) => {
      const response = await request(`/api/workspaces/${encodeURIComponent(workspace.id)}`, { signal })
      if (closed || signal?.aborted || !permitted()) return null
      const refreshed = workspaceState(response)
      if (refreshed.id !== workspace.id || (response.language && response.language !== language)) throw new Error('工作区响应不匹配，请重试。')
      state.workspaces[language] = refreshed
      return refreshed
    }
    const invalidateWorkspaces = () => { workspacesReady = false; workspaceEpoch++; activeRecovery?.controller.abort(); activeRecovery = null; state.restoring = false }
    const run = async (mode = 'run', useTests = false) => {
      if (closed || state.busy) return null
      try { preflight() } catch (error) { state.error = error.message; emit(); return null }
      const lesson = lessonFor(state.lessonId)
      let workspace = state.workspaces[lesson.language]
      cancelCheck()
      const operation = { controller: new AbortController(), seq: ++sequence, revision: state.revision, lessonId: state.lessonId, draft: draft(), started: false }
      if (mode === 'check') { activeCheck = operation; state.checking = true }
      else { activeRun = operation; state.busy = true }
      state.error = ''; state.notice = mode === 'check' ? '正在使用语言工具检查当前版本…' : `正在执行版本 ${operation.revision}…`; emit()
      const current = () => !closed && !operation.controller.signal.aborted && (mode === 'check' ? activeCheck === operation : activeRun === operation)
      try {
        if (mode === 'run' && STATEFUL.has(lesson.language)) {
          if (!await restoreWorkspaces()) return null
          if (!current() || !permitted()) return null
          workspace = state.workspaces[lesson.language]
          if (workspace?.uncertain) workspace = await refreshWorkspace(lesson.language, workspace, operation.controller.signal)
          if (!current() || !permitted()) return null
          if (workspace?.broken) throw new Error('工作区快照损坏，请重置运行环境后重试。')
          if (workspace?.busy) throw new Error('工作区仍在执行上一条命令，请稍后重试。')
        }
        operation.started = true
        const response = await request('/api/run', { method: 'POST', signal: operation.controller.signal, body: { language: lesson.language, code: operation.draft.code, stdin: operation.draft.stdin, ...(operation.draft.exercise ? { practice: operation.draft.exercise } : {}), tests: useTests ? operation.draft.tests : [], revision: operation.revision, mode, ...(workspace?.id ? { workspaceId: workspace.id, workspaceRevision: workspace.revision } : {}) } })
        if (!current() || !permitted()) return null
        const result = cleanResult(response)
        if (result.revision !== operation.revision) throw new Error('执行结果版本不匹配，已丢弃，未更新当前诊断。')
        if (mode === 'run' && result.workspaceId) { workspaceEpoch++; state.workspaces[lesson.language] = { id: result.workspaceId, revision: result.workspaceRevision, uncertain: false } }
        if (mode === 'run') {
          state.history.unshift({ id: result.runId || `${Date.now()}-${operation.seq}`, at: new Date().toISOString(), lessonId: operation.lessonId, revision: operation.revision, ...operation.draft, result })
          state.history = state.history.slice(0, MAX_HISTORY)
          if (state.lessonId === operation.lessonId) state.lastOutput = result
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
        if (mode === 'run' && operation.started && STATEFUL.has(lesson.language)) {
          if (workspace?.id) {
            state.workspaces[lesson.language] = { ...workspace, uncertain: true }
            try {
              const refreshed = await refreshWorkspace(lesson.language, workspace, operation.controller.signal)
              if (current() && refreshed && !refreshed.uncertain) state.notice = '工作区已核对，可重新运行；文件和仓库仍保留。'
            } catch (_) { /* Retry verifies the workspace again instead of deleting it. */ }
          } else workspacesReady = false
        }
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
        if (activeRun.started && STATEFUL.has(lessonFor(activeRun.lessonId).language)) {
          const language = lessonFor(activeRun.lessonId).language
          if (state.workspaces[language]?.id) state.workspaces[language] = { ...state.workspaces[language], uncertain: true }
          else workspacesReady = false
        }
        const started = activeRun.started
        activeRun.controller.abort(); activeRun = null; state.busy = false
        state.notice = started ? '已停止等待结果。服务端可能已执行部分命令；下次运行前会核对工作区。' : '已取消，尚未发送执行命令。'
      }
      if (activeReset) {
        const language = activeReset.language
        state.workspaces[language] = { ...state.workspaces[language], uncertain: true }
        activeReset.controller.abort(); activeReset = null; state.busy = false
        workspacesReady = false
        state.notice = '已停止等待重置结果；下次运行前会重新读取工作区。'
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
        if (!STATEFUL.has(lesson.language)) { edit({ code: '', stdin: '', tests: [], exercise: null }); return true }
        operation = { controller: new AbortController(), language: lesson.language }; activeReset = operation
        state.busy = true; state.error = ''; emit()
        if (!await restoreWorkspaces()) return false
        if (closed || operation.controller.signal.aborted || activeReset !== operation || !permitted()) return false
        const previous = state.workspaces[lesson.language]
        const result = await request('/api/workspaces/reset', { method: 'POST', signal: operation.controller.signal, body: { language: lesson.language, ...(previous?.id ? { workspaceId: previous.id } : {}) } })
        if (closed || !permitted() || operation.controller.signal.aborted || activeReset !== operation) return false
        if (!plain(result) || typeof result.workspaceId !== 'string') throw new Error('重置响应无效。')
        workspaceEpoch++; state.workspaces[lesson.language] = workspaceState(result)
        state.revision++; state.result = null; state.lastOutput = null; state.checked = null; state.notice = '隔离练习环境已重置。代码和提交历史仍保留。'
        return true
      } catch (error) {
        if (!closed && !operation?.controller.signal.aborted) { workspacesReady = false; state.error = clip(error.message, 2000) }
        return false
      }
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
        save(); emit(); return true
      } catch (error) {
        if (!closed && !controller.signal.aborted) { state.storageError = `云端历史尚未同步：${clip(error.message, 300)}。当前本机记录仍保留。`; emit() }
        return false
      } finally { if (activeSync === controller) activeSync = null }
    }
    const dispose = () => { save(); cancel(); activeSync?.abort(); invalidateWorkspaces(); closed = true }
    const initial = state.drafts[state.lessonId] || { code: '', stdin: '', tests: [], exercise: null }
    state.code = initial.code; state.stdin = initial.stdin; state.tests = cleanTests(initial.tests); state.exercise = optionalPractice(initial.exercise)
    return { state, edit, select, run, cancel, reset, restore, loadPractice, restoreBackup, persistence, setAutoCheck, canAutoCheck, autoCheckCurrent, clearHistory, syncHistory, restoreWorkspaces, invalidateWorkspaces, dispose }
  }

  const unlocked = () => { try { return window.NOIMPTY_GATE?.unlocked() === true && !document.documentElement.classList.contains('noimpty-private-locked') } catch (_) { return false } }
  const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = String(text); return el }
  const button = (text, click, className = '') => { const el = node('button', `learning-button ${className}`, text); el.type = 'button'; el.addEventListener('click', click); return el }
  let mounted = null
  let launch = null

  const LANGUAGE_NAMES = { c: 'C', cpp: 'C++', go: 'Go', git: 'Git', linux: 'Bash', mysql: 'MySQL' }
  const FILE_NAMES = { c: 'main.c', cpp: 'main.cpp', go: 'main.go', git: 'commands.sh', linux: 'script.sh', mysql: 'query.sql' }
  const resultLabel = result => result?.status === 'accepted' ? '运行完成' : STATUS[result?.status] || ''
  const mountLab = (container, article = null, onClose = null) => {
    const lifetime = new AbortController()
    const root = node('section', 'learning-lab')
    root.setAttribute('aria-label', '代码小屋')
    root.dataset.editorTheme = 'light'
    try { if (window.localStorage.getItem('noimpty-code-theme') === 'dark') root.dataset.editorTheme = 'dark' } catch (_) {}
    const heading = node('header', 'learning-heading')
    const brand = node('div', 'learning-brand')
    const flower = node('span', 'learning-flower', '✿'); flower.setAttribute('aria-hidden', 'true')
    brand.append(flower, node('span', '', '代码小屋'), node('small', '', 'CODE STUDIO'))
    const controls = node('div', 'learning-controls')
    const select = node('select', 'learning-select'); select.setAttribute('aria-label', '编程语言')
    Object.entries(LANGUAGE_NAMES).forEach(([id, name]) => { const option = node('option', '', name); option.value = id; select.append(option) })
    const connectButton = button('连接后端', () => {
      if (window.NANALY_AGENT?.open) window.NANALY_AGENT.open()
      else { error.textContent = '后端设置尚未加载，请稍后重试。'; error.hidden = false }
    }, 'learning-connect-button')
    const connectionDot = node('span', 'learning-connection-dot'); connectionDot.setAttribute('aria-hidden', 'true')
    const connectionLabel = node('span', 'learning-connection-label', '连接后端')
    connectButton.replaceChildren(connectionDot, connectionLabel)
    const connectionAnnouncement = node('span', 'learning-sr-only'); connectionAnnouncement.setAttribute('role', 'status'); connectionAnnouncement.setAttribute('aria-live', 'polite')
    controls.append(select, connectButton, connectionAnnouncement)
    if (onClose) controls.append(button('收起分屏', onClose, 'learning-close'))
    heading.append(brand, controls)
    const toolbar = node('div', 'learning-toolbar')
    const filename = node('span', 'learning-file-name')
    const actions = node('div', 'learning-actions')
    const runButton = button('▶ 运行', () => run(), 'learning-run')
    runButton.title = 'Ctrl / ⌘ + Enter'
    const stopButton = button('■ 停止', () => session.cancel(), 'learning-stop')
    const more = node('details', 'learning-more'); more.append(node('summary', '', '更多 ···'))
    const menu = node('div', 'learning-menu')
    const autoLabel = node('label', 'learning-checkbox'); const autoCheck = node('input'); autoCheck.type = 'checkbox'
    autoLabel.append(autoCheck, document.createTextNode('自动语法检查'))
    const persistLabel = node('label', 'learning-checkbox'); const persist = node('input'); persist.type = 'checkbox'
    persistLabel.append(persist, document.createTextNode('保留本机草稿与记录'))
    const themeLabel = node('label', 'learning-theme-label', '编辑器配色')
    const themeSelect = node('select', 'learning-select learning-theme-select'); themeSelect.setAttribute('aria-label', '编辑器配色')
    for (const [value, label] of [['light', '奶油樱粉'], ['dark', '夜樱紫']]) { const option = node('option', '', label); option.value = value; themeSelect.append(option) }
    themeSelect.value = root.dataset.editorTheme; themeLabel.append(themeSelect)
    themeSelect.addEventListener('change', () => { root.dataset.editorTheme = themeSelect.value; try { window.localStorage.setItem('noimpty-code-theme', themeSelect.value) } catch (_) {} })
    const assistantButton = button('请教娜娜莉', () => { more.open = false; window.NANALY?.open?.() })
    const checkButton = button('检查语法', () => { window.clearTimeout(timer); setPanel('output'); session.run('check'); more.open = false })
    const resetButton = button('重置运行环境', async () => {
      more.open = false
      if (window.confirm('重置将删除当前语言运行环境里的文件、仓库或表数据。编辑器代码仍保留。继续吗？')) await session.reset()
    })
    const downloadButton = button('下载代码', () => {
      if (!unlocked()) return
      const url = URL.createObjectURL(new Blob([session.state.code], { type: 'text/plain;charset=utf-8' }))
      const link = node('a'); link.href = url; link.download = FILE_NAMES[session.state.lessonId]; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); more.open = false
    })
    const clearButton = button('清空编辑器', () => {
      more.open = false
      if (session.state.code && !window.confirm('清空当前语言的代码和输入？运行记录仍保留。')) return
      session.edit({ code: '', stdin: '', tests: [], exercise: null }); syncEditor(); focusEditor()
    })
    menu.append(themeLabel, autoLabel, persistLabel, assistantButton, checkButton, downloadButton, clearButton, resetButton)
    more.append(menu); actions.append(stopButton, runButton, more); toolbar.append(filename, actions)
    const editorPane = node('main', 'learning-editor-pane')
    const editorWrap = node('div', 'learning-editor-wrap')
    const editorHost = node('div', 'learning-code-editor')
    const fallback = node('textarea', 'learning-editor'); fallback.setAttribute('aria-label', '代码编辑器'); fallback.spellcheck = false; fallback.maxLength = MAX_CODE; fallback.wrap = 'off'
    editorWrap.append(editorHost, fallback); editorPane.append(editorWrap)
    const consolePane = node('section', 'learning-console')
    const tabs = node('div', 'learning-console-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '输入与运行结果')
    const panels = {}; const tabButtons = {}; let currentPanel = 'input'
    for (const [id, label] of [['input', '输入'], ['output', '终端'], ['history', '记录']]) {
      const tab = button(label, () => setPanel(id), 'learning-console-tab'); tab.setAttribute('role', 'tab'); tab.id = `learning-tab-${id}`; tab.setAttribute('aria-controls', `learning-panel-${id}`)
      const panel = node('div', 'learning-console-panel'); panel.dataset.panel = id; panel.id = `learning-panel-${id}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id)
      panels[id] = panel; tabButtons[id] = tab; tabs.append(tab)
      tab.addEventListener('keydown', event => {
        const ids = Object.keys(tabButtons); const index = ids.indexOf(id)
        const next = event.key === 'ArrowRight' ? ids[(index + 1) % 3] : event.key === 'ArrowLeft' ? ids[(index + 2) % 3] : event.key === 'Home' ? ids[0] : event.key === 'End' ? ids[2] : null
        if (next) { event.preventDefault(); setPanel(next); tabButtons[next].focus() }
      })
    }
    const resultState = node('span', 'learning-result-state'); tabs.append(resultState)
    const stdin = node('textarea', 'learning-input'); stdin.maxLength = 8192; stdin.spellcheck = false; stdin.setAttribute('aria-label', '标准输入'); stdin.placeholder = '需要输入时，写在这里…'
    const inputHint = node('p', 'learning-muted', 'MySQL 直接执行编辑器中的 SQL。'); inputHint.hidden = true
    panels.input.append(stdin, inputHint)
    const diagnostics = node('div', 'learning-diagnostics')
    const output = node('div', 'learning-output')
    panels.output.append(diagnostics, output)
    const historyActions = node('div', 'learning-actions')
    historyActions.append(button('同步记录', () => session.syncHistory()), button('清空本机记录', () => { if (window.confirm('清空本机运行记录？代码草稿和云端记录会保留。')) session.clearHistory() }))
    const historyList = node('div', 'learning-history-list'); const backupsList = node('details', 'learning-backups'); backupsList.append(node('summary', '', '草稿恢复点'))
    const backupItems = node('div'); backupsList.append(backupItems)
    panels.history.append(historyActions, historyList, backupsList)
    consolePane.append(tabs, ...Object.values(panels))
    const statusbar = node('div', 'learning-statusbar')
    const connectivity = node('span', 'learning-connectivity'); const cursor = node('span', 'learning-cursor', 'Ln 1, Col 1'); const saved = node('span', 'learning-save-state')
    statusbar.append(connectivity, node('span', 'learning-shortcut', 'Ctrl / ⌘ ↵ 运行'), cursor, saved)
    const status = node('p', 'learning-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
    const error = node('p', 'learning-error'); error.setAttribute('role', 'alert')
    const storageStatus = node('p', 'learning-storage-status'); storageStatus.setAttribute('role', 'status')
    root.append(heading, toolbar, editorPane, consolePane, statusbar, status, error, storageStatus); container.append(root)
    let storage; try { storage = window.localStorage } catch (_) {}
    let timer = null; let adapter = null; let lastAutoRevision = null; let lastResult; let lastChecked; let lastOutputRevision; let lastHistory; let lastBackups
    let connectionState = window.NANALY_AGENT?.snapshot?.().connection || (window.NANALY_AGENT?.configured() ? 'connected' : 'disconnected')
    const request = (path, options) => window.NANALY_AGENT.request(path, options)
    const session = createSession({ request, storage, available: () => !!window.NANALY_AGENT?.configured(), permitted: unlocked, changed: () => render() })
    const context = () => {
      if (!unlocked()) return null
      const state = session.state; const language = state.lessonId
      return { kind: 'practice', lessonId: language, title: FILE_NAMES[language], problem: state.exercise?.statement || '', exercise: state.exercise, article: article ? { title: article.title, url: article.url, text: article.text.slice(0, 12000) } : null, language, code: state.code, revision: state.revision, stdin: state.stdin, tests: cleanTests(state.tests), result: state.result, diagnostics: state.checked, workspace: state.workspaces[language] || null, verified: !!state.result, pending: state.busy }
    }
    let published = ''
    const publish = () => { if (unlocked()) { try { const data = context(); const signature = JSON.stringify(data); if (signature !== published) { published = signature; window.NANALY_AGENT?.setContext?.(data) } } catch (_) {} } }
    const setPanel = id => { currentPanel = id; for (const key of Object.keys(panels)) { panels[key].hidden = key !== id; tabButtons[key].setAttribute('aria-selected', String(key === id)); tabButtons[key].tabIndex = key === id ? 0 : -1 } }
    const focusEditor = () => adapter ? adapter.focus() : fallback.focus()
    const syncEditor = () => { const state = session.state; if (adapter) { adapter.setLanguage(state.lessonId); adapter.setValue(state.code) } fallback.value = state.code; stdin.value = state.stdin; select.value = state.lessonId }
    const loadPractice = exercise => { const result = session.loadPractice(exercise); syncEditor(); render(); return result }
    const run = () => { window.clearTimeout(timer); setPanel('output'); session.run() }
    const jump = diagnostic => {
      if (!diagnostic.line) return
      if (adapter) return adapter.jump(diagnostic)
      const lines = fallback.value.split('\n'); const row = Math.min(diagnostic.line, lines.length) - 1; const start = lines.slice(0, row).reduce((sum, line) => sum + line.length + 1, 0)
      fallback.focus(); fallback.setSelectionRange(start, start + lines[row].length)
    }
    const pre = (text, className = '') => node('pre', className, text)
    const scheduleCheck = () => {
      window.clearTimeout(timer)
      if (!lifetime.signal.aborted && session.canAutoCheck()) timer = window.setTimeout(() => {
        if (lifetime.signal.aborted || session.state.busy || !session.canAutoCheck()) return
        lastAutoRevision = session.state.revision; session.autoCheckCurrent()
      }, 900)
    }
    const render = () => {
      if (lifetime.signal.aborted) return
      const state = session.state; const connected = window.NANALY_AGENT?.configured() === true
      filename.textContent = FILE_NAMES[state.lessonId]
      const connectionText = { disconnected: '未连接 · 点此连接', connecting: '正在连接…', connected: '后端已连接', error: '连接异常 · 重试' }[connectionState] || '未连接 · 点此连接'
      connectivity.textContent = connectionState === 'disconnected' ? '未连接后端 · 仅可编辑' : connectionText
      connectivity.dataset.connected = String(connectionState === 'connected'); connectivity.dataset.state = connectionState
      connectionLabel.textContent = connectionText; connectButton.dataset.state = connectionState
      connectButton.title = connectionState === 'connected' ? '已通过后端验证，点击管理连接' : connectionState === 'connecting' ? '正在验证后端连接，请稍候' : '点击填写访问令牌并连接后端'
      if (connectionAnnouncement.textContent !== connectionText) connectionAnnouncement.textContent = connectionText
      saved.textContent = state.persist ? (state.storageError ? '保存异常' : '草稿已保存') : '临时草稿'
      select.disabled = state.busy; select.value = state.lessonId
      runButton.disabled = state.busy || !connected || !state.code.trim(); runButton.textContent = state.restoring && state.busy ? '恢复环境…' : state.busy ? '运行中…' : ['git', 'linux'].includes(state.lessonId) ? '▶ 执行脚本' : '▶ 运行'
      stopButton.hidden = !state.busy && !state.checking
      clearButton.disabled = state.busy; checkButton.disabled = state.busy || state.checking || !connected || !state.code.trim() || !CHECKABLE.has(state.lessonId)
      resetButton.hidden = !STATEFUL.has(state.lessonId); resetButton.disabled = state.busy || !connected
      autoCheck.checked = state.autoCheck; autoCheck.disabled = !CHECKABLE.has(state.lessonId); persist.checked = state.persist
      stdin.hidden = state.lessonId === 'mysql'; inputHint.hidden = state.lessonId !== 'mysql'
      status.textContent = state.notice; status.hidden = !state.notice || (state.notice.startsWith('版本 ') && !state.notice.includes('尚未运行')) || state.notice.startsWith('正在执行版本 ')
      error.textContent = state.error; error.hidden = !state.error; storageStatus.textContent = state.storageError; storageStatus.hidden = !state.storageError
      const diagnosticResult = state.checked || state.result
      const visibleResult = state.result || state.lastOutput
      const staleOutput = !!visibleResult && visibleResult.revision !== state.revision
      resultState.textContent = state.restoring ? '恢复环境…' : state.busy ? '运行中…' : state.checking ? '检查中…' : resultLabel(diagnosticResult || visibleResult) + (staleOutput ? ' · 上次运行' : '')
      resultState.dataset.status = (diagnosticResult || visibleResult)?.status || ''
      if (lastResult !== visibleResult || lastChecked !== state.checked || lastOutputRevision !== state.revision) {
        diagnostics.replaceChildren(); output.replaceChildren()
        for (const d of diagnosticResult?.diagnostics || []) diagnostics.append(button(`${d.line ? `L${d.line}${d.column ? ':' + d.column : ''}  ` : ''}${d.message}`, () => jump(d), 'learning-diagnostic'))
        if (visibleResult) {
          if (staleOutput) output.append(node('p', 'learning-muted', '上次运行的输出 · 当前修改尚未运行'))
          if (['git', 'linux'].includes(state.lessonId)) output.append(node('p', 'learning-muted', `${visibleResult.cwd ? `目录 ${visibleResult.cwd} · ` : ''}退出码 ${visibleResult.exitCode == null ? '未返回' : visibleResult.exitCode}`))
          if (visibleResult.stdout) output.append(pre(visibleResult.stdout, 'learning-stdout'))
          if (visibleResult.stderr) output.append(pre(visibleResult.stderr, 'learning-stderr'))
          if (!visibleResult.stdout && !visibleResult.stderr) output.append(node('p', 'learning-muted', visibleResult.status === 'accepted' ? '命令已完成，没有标准输出。' : '本次运行没有标准输出。'))
          if (visibleResult.workspaceSummary) {
            const summary = node('details', 'learning-workspace-summary')
            summary.append(node('summary', '', state.lessonId === 'git' ? '仓库状态' : '工作区文件'), pre(visibleResult.workspaceSummary))
            output.append(summary)
          }
          if (!visibleResult.workspaceCommitted) output.append(node('p', 'learning-error', '本次运行环境的更改未保存。'))
          for (const warning of visibleResult.warnings) output.append(node('p', 'learning-muted', warning))
        } else if (state.checked) output.append(pre(state.checked.stderr || state.checked.stdout || state.checked.warnings.join('\n') || '语法检查完成。'))
        else output.append(node('p', 'learning-empty', '运行结果会出现在这里 ✧'))
        lastResult = visibleResult; lastChecked = state.checked; lastOutputRevision = state.revision
      }
      if (lastHistory !== state.history) {
        historyList.replaceChildren()
        if (!state.history.length) historyList.append(node('p', 'learning-muted', '还没有运行记录。'))
        for (const record of state.history) {
          const entry = node('details', 'learning-history-entry'); const time = new Date(record.at)
          entry.append(node('summary', '', `${FILE_NAMES[record.lessonId]} · ${resultLabel(record.result)} · ${Number.isNaN(time.getTime()) ? record.at : time.toLocaleString()}`), pre(record.code), button('恢复代码', () => { if (session.restore(record.id)) { syncEditor(); focusEditor() } }))
          if (record.result.stdout) entry.append(pre(record.result.stdout))
          if (record.result.stderr) entry.append(pre(record.result.stderr, 'learning-stderr'))
          historyList.append(entry)
        }
        lastHistory = state.history
      }
      if (lastBackups !== state.backups) {
        backupItems.replaceChildren(); backupsList.hidden = !state.backups.length
        for (const record of state.backups) backupItems.append(button(`${FILE_NAMES[record.lessonId]} · ${record.at}`, () => { if (session.restoreBackup(record.id)) { syncEditor(); focusEditor() } }))
        lastBackups = state.backups
      }
      publish()
      if (state.result || state.checked) lastAutoRevision = state.revision
      if (!state.busy && !state.checking && state.revision !== lastAutoRevision && session.canAutoCheck()) scheduleCheck()
    }
    try {
      if (window.NOIMPTY_CODE_EDITOR) adapter = window.NOIMPTY_CODE_EDITOR.create(editorHost, { value: session.state.code, language: session.state.lessonId, onChange: value => { session.edit({ code: value }); scheduleCheck() }, onRun: run, onCursor: position => { cursor.textContent = `Ln ${position.line}, Col ${position.column}` } })
    } catch (_) { editorHost.replaceChildren() }
    fallback.hidden = !!adapter; editorHost.hidden = !adapter
    fallback.addEventListener('input', () => { session.edit({ code: fallback.value }); scheduleCheck() })
    fallback.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); run() } })
    stdin.addEventListener('input', () => session.edit({ stdin: stdin.value }))
    select.addEventListener('change', () => { window.clearTimeout(timer); session.select(select.value); syncEditor(); focusEditor() })
    autoCheck.addEventListener('change', () => { window.clearTimeout(timer); lastAutoRevision = null; session.setAutoCheck(autoCheck.checked); if (autoCheck.checked) scheduleCheck() })
    persist.addEventListener('change', () => session.persistence(persist.checked))
    root.addEventListener('keydown', event => { if (event.key === 'Escape' && more.open) { more.open = false; more.querySelector('summary').focus() } })
    document.addEventListener('pointerdown', event => { if (!more.contains(event.target)) more.open = false }, { signal: lifetime.signal })
    let wasConnected = false
    const connectionChanged = snapshot => {
      const connected = window.NANALY_AGENT?.configured() === true
      const next = snapshot?.connection || window.NANALY_AGENT?.snapshot?.().connection || (connected ? 'connected' : 'disconnected')
      const changed = next !== connectionState || connected !== wasConnected
      const sync = connected && !wasConnected
      connectionState = next; wasConnected = connected
      if (changed) render()
      if (!connected && changed) session.invalidateWorkspaces()
      if (sync) { session.restoreWorkspaces(); session.syncHistory() }
    }
    const unsubscribe = window.NANALY_AGENT?.subscribe?.(connectionChanged)
    window.addEventListener('nanaly:agent-configured', connectionChanged, { signal: lifetime.signal })
    syncEditor(); setPanel('input'); render(); connectionChanged()
    return { session, context, loadPractice, dispose: () => { window.clearTimeout(timer); lifetime.abort(); unsubscribe?.(); session.dispose(); adapter?.destroy(); root.remove(); try { window.NANALY_AGENT?.setContext?.(null) } catch (_) {} } }
  }

  const cleanup = () => { mounted?.dispose(); mounted = null; launch?.remove(); launch = null; document.documentElement.classList.remove('learning-is-open', 'learning-page'); delete document.documentElement.dataset.learningPane }
  const mount = () => {
    cleanup()
    if (!unlocked()) return
    const host = document.getElementById('learning-lab')
    if (host) { document.documentElement.classList.add('learning-page'); mounted = mountLab(host); return }
    const article = document.querySelector('#post #article-container')
    const post = document.getElementById('post'); const layout = post?.parentElement
    if (!article || !layout) return
    launch = button('边学边练 ↗', () => {
      if (!unlocked()) return
      if (mounted) { mounted.dispose(); mounted = null; launch.focus(); return }
      const scrollY = window.scrollY
      const data = { title: document.querySelector('h1.post-title')?.textContent || document.title, url: window.location.href, text: clip(article.textContent, 20000) }
      const holder = node('aside', 'learning-article-holder')
      const articleTitle = node('h1', 'learning-article-title', data.title); post.prepend(articleTitle)
      const divider = button('⋮', () => {}, 'learning-divider'); divider.setAttribute('role', 'separator'); divider.setAttribute('aria-label', '调整文章与编辑器宽度'); divider.setAttribute('aria-orientation', 'vertical'); divider.setAttribute('aria-valuemin', '30'); divider.setAttribute('aria-valuemax', '70'); divider.setAttribute('aria-valuenow', '50'); divider.type = 'button'
      const mobileSwitch = node('div', 'learning-mobile-switch')
      const readTab = button('阅读文章', () => setPane('article')); const codeTab = button('编写代码', () => setPane('code'))
      const setPane = pane => { document.documentElement.dataset.learningPane = pane; readTab.setAttribute('aria-pressed', String(pane === 'article')); codeTab.setAttribute('aria-pressed', String(pane === 'code')) }
      mobileSwitch.append(readTab, codeTab); post.after(divider, holder); layout.prepend(mobileSwitch)
      let percentage = 50
      const resize = value => { percentage = Math.max(30, Math.min(70, value)); layout.style.setProperty('--learning-reading-width', `${percentage}%`); divider.setAttribute('aria-valuenow', String(Math.round(percentage))) }
      divider.addEventListener('pointerdown', event => { divider.setPointerCapture(event.pointerId); event.preventDefault() })
      divider.addEventListener('pointermove', event => { if (divider.hasPointerCapture(event.pointerId)) { const box = layout.getBoundingClientRect(); resize((event.clientX - box.left) / box.width * 100) } })
      divider.addEventListener('pointerup', event => { if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId) })
      divider.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) { event.preventDefault(); resize(event.key === 'Home' ? 50 : percentage + (event.key === 'ArrowLeft' ? -3 : 3)) } })
      const close = () => { mounted?.dispose(); mounted = null; launch?.focus(); window.scrollTo({ top: scrollY, behavior: 'instant' }) }
      document.documentElement.classList.add('learning-is-open'); setPane('code')
      mounted = mountLab(holder, data, close)
      const originalDispose = mounted.dispose
      mounted.dispose = () => { originalDispose(); holder.remove(); divider.remove(); mobileSwitch.remove(); articleTitle.remove(); layout.style.removeProperty('--learning-reading-width'); document.documentElement.classList.remove('learning-is-open'); delete document.documentElement.dataset.learningPane; post.scrollTop = 0 }
      layout.scrollIntoView({ block: 'start', behavior: 'instant' }); holder.querySelector('select')?.focus({ preventScroll: true })
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
