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
  const SHELLS = new Set(['git', 'linux'])
  const CHECKABLE = new Set(['c', 'cpp', 'go', 'python', 'git', 'linux'])
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
    { id: 'python', name: 'Python · 读取与计算', title: '读取两个整数并求和', language: 'python',
      description: '用 input() 读取一行里的两个整数，输出它们的和。环境里已装好 NumPy 和 CPU 版 PyTorch，可以直接 import torch 做张量和自动求导练习。运行环境不联网，不能 pip install；第一次 import torch 要等几秒。',
      code: 'a, b = map(int, input().split())\nprint(a + b)\n', stdin: '2 3\n', tests: [{ input: '2 3\n', expectedOutput: '5\n' }, { input: '-4 7\n', expectedOutput: '3\n' }] },
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
      diagnostics: Array.isArray(value.diagnostics) ? value.diagnostics.slice(0, 100).filter(plain).map(d => ({ severity: ['warning', 'info'].includes(d.severity) ? d.severity : 'error', message: clip(d.message, 2000), line: Number.isInteger(d.line) && d.line > 0 ? d.line : null, column: Number.isInteger(d.column) && d.column > 0 ? d.column : null })) : [],
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
    const state = { lessonId: lessonFor(cached?.lessonId).id, revision: 0, code: '', stdin: '', tests: [], exercise: null, result: null, lastOutput: null, checked: null, history: [], backups: [], drafts: {}, workspaces: {}, restoring: false, busy: false, checking: false, error: '', notice: '', storageError: '', persist: cached?.persist !== false, autoCheck: cached?.autoCheck !== false }
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
    // quiet: the automatic check while typing. Its only feedback is the editor marks, so it
    // neither posts notices nor surfaces transient failures; an explicit run or check still does.
    const run = async (mode = 'run', useTests = false, { quiet = false } = {}) => {
      if (closed || state.busy) return null
      try { preflight() } catch (error) { state.error = error.message; emit(); return null }
      const lesson = lessonFor(state.lessonId)
      let workspace = state.workspaces[lesson.language]
      cancelCheck()
      const operation = { controller: new AbortController(), seq: ++sequence, revision: state.revision, lessonId: state.lessonId, draft: draft(), started: false }
      if (mode === 'check') { activeCheck = operation; state.checking = true }
      else { activeRun = operation; state.busy = true }
      if (!quiet) { state.error = ''; state.notice = mode === 'check' ? '正在使用语言工具检查当前版本…' : `正在执行版本 ${operation.revision}…` }
      emit()
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
          state.checked = result
          if (!quiet) state.notice = result.status === 'unsupported_check' ? '此语言暂不支持独立语法检查，请明确点击运行后查看实际结果。' : '当前版本已完成工具检查；检查不代表运行或测试通过。'
        }
        return result
      } catch (error) {
        if (!current() || quiet) return null
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
    const autoCheckCurrent = () => canAutoCheck() ? run('check', false, { quiet: true }) : Promise.resolve(null)
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
    // The terminal reports the workspace it opened and each revision it saved, so a later
    // script run continues from there instead of tripping the CAS check.
    const adoptWorkspace = (language, value) => {
      if (closed || !permitted() || !SHELLS.has(language) || !plain(value) || typeof value.workspaceId !== 'string' || !value.workspaceId || !Number.isInteger(value.workspaceRevision) || value.workspaceRevision < 0) return false
      workspaceEpoch++; state.workspaces[language] = { id: value.workspaceId, revision: value.workspaceRevision, busy: false, broken: false, uncertain: false }
      emit(); return true
    }
    const note = text => { if (!closed) { state.notice = clip(text, 300); state.error = ''; emit() } }
    const dispose = () => { save(); cancel(); activeSync?.abort(); invalidateWorkspaces(); closed = true }
    const initial = state.drafts[state.lessonId] || { code: '', stdin: '', tests: [], exercise: null }
    state.code = initial.code; state.stdin = initial.stdin; state.tests = cleanTests(initial.tests); state.exercise = optionalPractice(initial.exercise)
    return { state, edit, select, run, cancel, reset, restore, loadPractice, restoreBackup, persistence, setAutoCheck, canAutoCheck, autoCheckCurrent, clearHistory, syncHistory, restoreWorkspaces, invalidateWorkspaces, adoptWorkspace, note, dispose }
  }

  // A terminal's connection: a one-time ticket from the authenticated API, then a socket that
  // carries keystrokes one way and raw terminal output the other. A shell lives on the server
  // between connections, so a dropped socket reconnects by itself and asks only for the output
  // it missed; a program run (`task`) ends with its socket.
  const createTerminalLink = ({ kind = 'shell', language, code = '', request, socketURL, WebSocketImpl, size, workspace = () => null, onOutput, onEvent, retry = kind === 'shell', delays = [1000, 2000, 4000, 8000, 15000] }) => {
    let state = 'idle', socket = null, generation = 0, pending = '', sessionId = null, offset = 0, exited = null, attempts = 0, retryTimer = null, disposed = false, replayLeft = 0
    const waiters = new Set()
    const setState = next => {
      if (state === next) return
      state = next; onEvent({ type: 'state', state })
      for (const waiter of [...waiters]) waiter()
    }
    const send = value => { try { if (socket?.readyState === 1) { socket.send(JSON.stringify(value)); return true } } catch (_) {} return false }
    const schedule = () => {
      if (disposed) return
      const delay = delays[Math.min(attempts++, delays.length - 1)]
      setState('reconnecting')
      retryTimer = setTimeout(() => { retryTimer = null; void open() }, delay)
    }
    const open = async () => {
      const current = ++generation
      exited = null
      if (state !== 'reconnecting') setState('connecting')
      let ws
      try {
        const target = workspace()
        const body = kind === 'task' ? { kind, language, code, ...size() }
          : { kind, language, ...(target?.id ? { workspaceId: target.id } : {}), ...(sessionId ? { sessionId, since: offset } : {}), ...size() }
        const issued = await request('/api/terminal/ticket', { method: 'POST', body })
        if (current !== generation) return
        if (typeof issued?.ticket !== 'string' || !/^[a-f0-9]{48}$/.test(issued.ticket)) throw new Error('终端响应无效，请检查后端版本。')
        ws = new WebSocketImpl(socketURL('/api/terminal?ticket=' + issued.ticket))
      } catch (error) {
        if (current !== generation) return
        // A network failure is worth retrying for a shell; a refusal from the server is not.
        if (retry && !error?.status && attempts < 30) { schedule(); return }
        setState('closed')
        onEvent({ type: 'error', message: error?.status === 404 ? '后端还没有终端功能，需要先更新后端。' : clip(error?.message || '终端连接失败。', 300) })
        return
      }
      socket = ws; ws.binaryType = 'arraybuffer'
      let ready = false, refused = false
      ws.onmessage = event => {
        if (current !== generation) return
        if (typeof event.data !== 'string') {
          const bytes = new Uint8Array(event.data), replay = replayLeft > 0
          offset += bytes.length; replayLeft = Math.max(0, replayLeft - bytes.length)
          onOutput(bytes, replay); return
        }
        let message
        try { message = JSON.parse(event.data) } catch (_) { return }
        if (!plain(message)) return
        if (message.type === 'ready') {
          ready = true; attempts = 0
          const previous = sessionId
          sessionId = typeof message.sessionId === 'string' ? message.sessionId : null
          offset = Number.isSafeInteger(message.offset) ? message.offset : 0
          replayLeft = Number.isSafeInteger(message.replay) ? message.replay : 0
          setState('open')
          onEvent({ ...message, resumed: !!previous && previous === sessionId, replaced: !!previous && previous !== sessionId })
          if (pending) { send({ type: 'input', data: pending }); pending = '' }
          return
        }
        if (message.type === 'exit') exited = message
        if (message.type === 'error') refused = true
        onEvent(message)
      }
      ws.onclose = event => {
        if (current !== generation) return
        socket = null; pending = ''
        if (exited) { sessionId = null; offset = 0; setState('exited'); return }
        if (refused || (!ready && event?.code === 1000)) { setState('closed'); return }
        onEvent({ type: 'lost', code: event?.code })
        if (retry && !disposed) schedule(); else setState('closed')
      }
      ws.onerror = () => {}
    }
    const connect = () => { if (disposed || ['connecting', 'open', 'reconnecting'].includes(state)) return; clearTimeout(retryTimer); attempts = 0; void open() }
    // Keys typed while a shell is closed reopen it instead of being sent anywhere.
    const write = data => {
      if (state === 'open') send({ type: 'input', data })
      else if (state === 'connecting' || state === 'reconnecting') pending = (pending + data).slice(-4096)
      else if (kind === 'shell') connect()
    }
    const resize = (cols, rows) => { if (state === 'open') send({ type: 'resize', cols, rows }) }
    const terminate = () => send({ type: 'terminate' })
    const message = value => state === 'open' && send(value)
    // Resolves once the connection is open (connecting first if needed); rejects if it closes.
    const opened = (timeout = 30000) => {
      if (state === 'open') return Promise.resolve()
      connect()
      return new Promise((resolve, reject) => {
        const finish = error => { clearTimeout(timer); waiters.delete(check); error ? reject(error) : resolve() }
        const check = () => { if (state === 'open') finish(); else if (state === 'closed' || state === 'exited') finish(new Error('终端没有连上。')) }
        const timer = setTimeout(() => finish(new Error('终端连接超时。')), timeout)
        waiters.add(check)
      })
    }
    // Detaches this page: a shell keeps running on the server for a while, a program run stops.
    const close = () => { disposed = true; generation++; clearTimeout(retryTimer); try { socket?.close() } catch (_) {} socket = null; state = 'closed'; for (const waiter of [...waiters]) waiter() }
    return { connect, write, resize, terminate, message, opened, close, state: () => state, active: () => ['connecting', 'open', 'reconnecting'].includes(state) }
  }

  const unlocked = () => { try { return window.NOIMPTY_GATE?.unlocked() === true && !document.documentElement.classList.contains('noimpty-private-locked') } catch (_) { return false } }
  const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = String(text); return el }
  const button = (text, click, className = '') => { const el = node('button', `learning-button ${className}`, text); el.type = 'button'; el.addEventListener('click', click); return el }
  let mounted = null
  let launch = null

  const LANGUAGE_NAMES = { c: 'C', cpp: 'C++', go: 'Go', python: 'Python', git: 'Git', linux: 'Linux', mysql: 'MySQL' }
  const FILE_NAMES = { c: 'main.c', cpp: 'main.cpp', go: 'main.go', python: 'main.py', git: 'commands.sh', linux: 'script.sh', mysql: 'query.sql' }
  // Run for these compiles and runs the program on a terminal, so it reads what is typed.
  const TASK_LANGUAGES = new Set(['c', 'cpp', 'go', 'python'])
  const EXTENSION_LANGUAGES = { c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', go: 'go', py: 'python', sql: 'mysql', sh: 'linux', bash: 'linux' }
  const MODE_KEY = 'noimpty-code-shell-mode'
  const FONT_KEY = 'noimpty-code-terminal-font'
  const readStore = key => { try { return window.localStorage.getItem(key) } catch (_) { return null } }
  const writeStore = (key, value) => { try { window.localStorage.setItem(key, value) } catch (_) {} }
  // xterm.js is only fetched the first time a terminal is shown.
  let terminalBundle = null
  const loadTerminalBundle = () => terminalBundle ||= new Promise((resolve, reject) => {
    if (window.NOIMPTY_TERMINAL) { resolve(window.NOIMPTY_TERMINAL); return }
    const script = document.createElement('script')
    // The inert tag in the page carries the fingerprinted URL, so a new build is never cached stale.
    script.src = document.getElementById('learning-terminal-src')?.getAttribute('src') || '/js/learning-terminal.js'; script.async = true
    script.onload = () => window.NOIMPTY_TERMINAL ? resolve(window.NOIMPTY_TERMINAL) : reject(new Error('终端组件加载失败。'))
    script.onerror = () => { terminalBundle = null; script.remove(); reject(new Error('终端组件加载失败，请检查网络后刷新。')) }
    document.head.append(script)
  })
  const resultLabel = result => result?.status === 'accepted' ? '运行完成' : STATUS[result?.status] || ''
  const homePath = path => String(path).replace(/^\/work(?=\/|$)/, '~')
  const mountLab = (container, article = null, onClose = null) => {
    const lifetime = new AbortController()
    const root = node('section', 'learning-lab')
    root.setAttribute('aria-label', '代码小屋')
    root.dataset.editorTheme = readStore('noimpty-code-theme') === 'dark' ? 'dark' : 'light'
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

    // Toolbar: Git/Linux choose between the full terminal and a script over the terminal;
    // the title shows where the shell is, as a terminal window's title bar does.
    const toolbar = node('div', 'learning-toolbar')
    const modeSwitch = node('div', 'learning-mode-switch'); modeSwitch.setAttribute('role', 'group'); modeSwitch.setAttribute('aria-label', '使用方式')
    const modeButtons = {}
    for (const [id, label, hint] of [['terminal', '终端', '只看终端，逐条输入命令'], ['script', '脚本', '上面写整段命令，下面的终端里执行']]) {
      const item = button(label, () => setMode(id), 'learning-mode'); item.title = hint; item.setAttribute('aria-pressed', 'false')
      modeButtons[id] = item; modeSwitch.append(item)
    }
    const filename = node('span', 'learning-file-name')
    const terminalTitle = node('span', 'learning-terminal-title')
    const terminalState = node('span', 'learning-terminal-state')
    const actions = node('div', 'learning-actions')
    const saveButton = button('保存', () => saveFile(), 'learning-save'); saveButton.title = 'Ctrl / ⌘ + S'
    const closeFileButton = button('关闭文件', () => closeFile(), 'learning-close-file')
    const testButton = button('运行测试', () => { setPanel('output'); session.run('run', true) }, 'learning-test')
    const stopButton = button('■ 停止', () => stop(), 'learning-stop')
    const runButton = button('▶ 运行', () => run(), 'learning-run')
    runButton.title = 'Ctrl / ⌘ + Enter'
    const more = node('details', 'learning-more'); more.append(node('summary', '', '更多 ···'))
    const menu = node('div', 'learning-menu')
    const autoLabel = node('label', 'learning-checkbox'); const autoCheck = node('input'); autoCheck.type = 'checkbox'
    autoLabel.append(autoCheck, document.createTextNode('自动语法检查'))
    const persistLabel = node('label', 'learning-checkbox'); const persist = node('input'); persist.type = 'checkbox'
    persistLabel.append(persist, document.createTextNode('保留本机草稿与记录'))
    const themeLabel = node('label', 'learning-theme-label', '配色')
    const themeSelect = node('select', 'learning-select learning-theme-select'); themeSelect.setAttribute('aria-label', '配色')
    for (const [value, label] of [['light', '奶油樱粉'], ['dark', '夜樱紫']]) { const option = node('option', '', label); option.value = value; themeSelect.append(option) }
    themeSelect.value = root.dataset.editorTheme; themeLabel.append(themeSelect)
    themeSelect.addEventListener('change', () => {
      root.dataset.editorTheme = themeSelect.value
      for (const entry of Object.values(views)) entry.view?.setTheme(themeSelect.value)
      writeStore('noimpty-code-theme', themeSelect.value)
    })
    const fontLabel = node('label', 'learning-theme-label', '终端字号')
    const fontSelect = node('select', 'learning-select learning-theme-select'); fontSelect.setAttribute('aria-label', '终端字号')
    for (const size of [12, 13, 14, 15, 16, 18, 20]) { const option = node('option', '', size + ' px'); option.value = String(size); fontSelect.append(option) }
    // Unless chosen, 12 px on a phone so about 40 columns fit, 14 px elsewhere.
    const fontSize = () => { const value = Number(readStore(FONT_KEY)); return [12, 13, 14, 15, 16, 18, 20].includes(value) ? value : window.matchMedia?.('(max-width: 520px)').matches ? 12 : 14 }
    fontSelect.value = String(fontSize()); fontLabel.append(fontSelect)
    fontSelect.addEventListener('change', () => { writeStore(FONT_KEY, fontSelect.value); for (const entry of Object.values(views)) entry.view?.setFontSize(Number(fontSelect.value)) })
    const assistantButton = button('请教娜娜莉', () => { more.open = false; window.NANALY?.open?.() })
    const checkButton = button('检查语法', () => { window.clearTimeout(timer); setPanel('output'); session.run('check'); more.open = false })
    const restartButton = button('重启终端', () => { more.open = false; restartShell() })
    const resetButton = button('重置运行环境', async () => {
      more.open = false
      if (!window.confirm('重置将删除当前语言运行环境里的文件、仓库、命令历史或表数据。编辑器代码仍保留。继续吗？')) return
      const language = session.state.lessonId
      const entry = views['shell:' + language]
      if (entry) entry.holding = true
      const done = await session.reset()
      if (entry) { entry.holding = false; if (done) entry.link.connect() }
    })
    const downloadButton = button('下载代码', () => {
      if (!unlocked()) return
      const url = URL.createObjectURL(new Blob([session.state.code], { type: 'text/plain;charset=utf-8' }))
      const link = node('a'); link.href = url; link.download = FILE_NAMES[session.state.lessonId]; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); more.open = false
    })
    const clearButton = button('清空编辑器', () => {
      more.open = false
      if (session.state.code && !window.confirm('清空当前语言的代码？运行记录仍保留。')) return
      session.edit({ code: '', stdin: '', tests: [], exercise: null }); syncEditor(); focusEditor()
    })
    menu.append(themeLabel, fontLabel, autoLabel, persistLabel, assistantButton, checkButton, restartButton, downloadButton, clearButton, resetButton)
    more.append(menu); actions.append(saveButton, closeFileButton, testButton, stopButton, runButton, more)
    toolbar.append(modeSwitch, filename, terminalTitle, terminalState, actions)

    const editorPane = node('main', 'learning-editor-pane')
    const editorWrap = node('div', 'learning-editor-wrap')
    const editorHost = node('div', 'learning-code-editor')
    const fallback = node('textarea', 'learning-editor'); fallback.setAttribute('aria-label', '代码编辑器'); fallback.spellcheck = false; fallback.maxLength = MAX_CODE; fallback.wrap = 'off'
    editorWrap.append(editorHost, fallback); editorPane.append(editorWrap)

    // Bottom panel: the terminal, results of checks and tests, and the run history.
    const consolePane = node('section', 'learning-console')
    // Drag bar above the panel. The chosen height is a per-browser convenience; double-click resets it.
    const CONSOLE_KEY = 'noimpty-code-console-height'
    const resizer = button('', () => {}, 'learning-console-resizer')
    resizer.setAttribute('role', 'separator'); resizer.setAttribute('aria-orientation', 'horizontal'); resizer.setAttribute('aria-label', '拖动调整下方面板高度，双击恢复默认')
    const setConsoleHeight = px => {
      const others = [...root.children].reduce((sum, el) => el === editorPane || el === consolePane ? sum : sum + el.offsetHeight, 0)
      const room = root.clientHeight - others - (parseFloat(window.getComputedStyle(editorPane).minHeight) || 180)
      const height = Math.round(Math.max(140, Math.min(Math.max(room, 140), px)))
      consolePane.style.flexBasis = height + 'px'
      writeStore(CONSOLE_KEY, String(height))
    }
    let drag = null
    resizer.addEventListener('pointerdown', event => { resizer.setPointerCapture(event.pointerId); drag = { y: event.clientY, height: consolePane.offsetHeight }; event.preventDefault() })
    resizer.addEventListener('pointermove', event => { if (drag && resizer.hasPointerCapture(event.pointerId)) setConsoleHeight(drag.height + drag.y - event.clientY) })
    resizer.addEventListener('pointerup', event => { if (resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId); drag = null })
    resizer.addEventListener('keydown', event => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); setConsoleHeight(consolePane.offsetHeight + (event.key === 'ArrowUp' ? 24 : -24)) } })
    resizer.addEventListener('dblclick', () => { consolePane.style.flexBasis = ''; try { window.localStorage.removeItem(CONSOLE_KEY) } catch (_) {} })
    { const saved = Number(readStore(CONSOLE_KEY)); if (saved >= 140) consolePane.style.flexBasis = Math.min(saved, 900) + 'px' }
    const tabs = node('div', 'learning-console-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '终端与运行结果')
    const panels = {}; const tabButtons = {}; let currentPanel = 'terminal'
    const PANELS = [['terminal', '终端'], ['output', '输出'], ['history', '记录']]
    for (const [id, label] of PANELS) {
      const tab = button(label, () => setPanel(id), 'learning-console-tab'); tab.setAttribute('role', 'tab'); tab.id = `learning-tab-${id}`; tab.setAttribute('aria-controls', `learning-panel-${id}`)
      const panel = node('div', 'learning-console-panel'); panel.dataset.panel = id; panel.id = `learning-panel-${id}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id)
      panels[id] = panel; tabButtons[id] = tab; tabs.append(tab)
      tab.addEventListener('keydown', event => {
        const ids = PANELS.map(([key]) => key).filter(key => !tabButtons[key].hidden); const index = ids.indexOf(id)
        const next = event.key === 'ArrowRight' ? ids[(index + 1) % ids.length] : event.key === 'ArrowLeft' ? ids[(index + ids.length - 1) % ids.length] : event.key === 'Home' ? ids[0] : event.key === 'End' ? ids.at(-1) : null
        if (next) { event.preventDefault(); setPanel(next); tabButtons[next].focus() }
      })
    }
    const resultState = node('span', 'learning-result-state'); tabs.append(resultState)
    const terminalHosts = node('div', 'learning-terminal-hosts')
    const terminalOverlay = node('div', 'learning-terminal-overlay')
    const overlayText = node('p', '', '连接后端后就能使用终端。')
    terminalOverlay.append(overlayText, button('连接后端', () => window.NANALY_AGENT?.open?.(), 'learning-run'))
    // Touch keyboards have no Tab, Ctrl or arrow keys. pointerdown keeps focus in the terminal.
    const terminalKeys = node('div', 'learning-terminal-keys'); terminalKeys.setAttribute('role', 'toolbar'); terminalKeys.setAttribute('aria-label', '终端按键')
    for (const [label, sequence, cursorKey] of [['Tab', '\t'], ['Esc', '\x1b'], ['Ctrl+C', '\x03'], ['Ctrl+D', '\x04'], ['Ctrl+L', '\x0c'], ['↑', 'A', true], ['↓', 'B', true], ['←', 'D', true], ['→', 'C', true]]) {
      const key = button(label, () => {
        const entry = views[viewKey()]
        if (entry) inputTo(entry, cursorKey ? (entry.view?.applicationCursor() ? '\x1bO' : '\x1b[') + sequence : sequence)
      }, 'learning-terminal-key')
      key.addEventListener('pointerdown', event => event.preventDefault())
      terminalKeys.append(key)
    }
    panels.terminal.append(terminalHosts, terminalOverlay, terminalKeys)
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
    const shortcut = node('span', 'learning-shortcut')
    statusbar.append(connectivity, shortcut, cursor, saved)
    const status = node('p', 'learning-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
    const error = node('p', 'learning-error'); error.setAttribute('role', 'alert')
    const storageStatus = node('p', 'learning-storage-status'); storageStatus.setAttribute('role', 'status')
    root.append(heading, toolbar, editorPane, resizer, consolePane, statusbar, status, error, storageStatus); container.append(root)

    let storage; try { storage = window.localStorage } catch (_) {}
    let timer = null; let adapter = null; let lastAutoRevision = null; let lastResult; let lastChecked; let lastOutputRevision; let lastHistory; let lastBackups; let lastMarked
    let connectionState = window.NANALY_AGENT?.snapshot?.().connection || (window.NANALY_AGENT?.configured() ? 'connected' : 'disconnected')
    const request = (path, options) => window.NANALY_AGENT.request(path, options)
    const connected = () => window.NANALY_AGENT?.configured() === true
    const session = createSession({ request, storage, available: () => !!window.NANALY_AGENT?.configured(), permitted: unlocked, changed: () => render() })
    const shellModes = { git: 'terminal', linux: 'terminal' }
    try { const saved = JSON.parse(readStore(MODE_KEY) || '{}'); for (const id of SHELLS) if (['terminal', 'script'].includes(saved?.[id])) shellModes[id] = saved[id] } catch (_) {}
    // terminal / script for Git and Linux, code for C/C++/Go/Python, sql for MySQL; file while a
    // file opened from the terminal with `code` is in the editor.
    const layout = () => {
      const language = session.state.lessonId
      if (fileEdit && SHELLS.has(language)) return 'file'
      return SHELLS.has(language) ? shellModes[language] : TASK_LANGUAGES.has(language) ? 'code' : 'sql'
    }
    const viewKey = () => SHELLS.has(session.state.lessonId) ? 'shell:' + session.state.lessonId : TASK_LANGUAGES.has(session.state.lessonId) ? 'task' : null
    const views = {}
    let terminalProblem = ''
    let fileEdit = null
    let fileRequest = 0

    const context = () => {
      if (!unlocked()) return null
      const state = session.state; const language = state.lessonId
      const entry = views[viewKey()]
      const terminal = entry?.view ? { terminal: { mode: layout(), state: (entry.link || entry.task)?.state() || 'idle', screen: clip(entry.view.transcript(60), 6000) } } : {}
      return { kind: 'practice', lessonId: language, title: FILE_NAMES[language], problem: state.exercise?.statement || '', exercise: state.exercise, article: article ? { title: article.title, url: article.url, text: article.text.slice(0, 12000) } : null, language, code: state.code, revision: state.revision, stdin: state.stdin, tests: cleanTests(state.tests), result: state.result, diagnostics: state.checked, workspace: state.workspaces[language] || null, verified: !!state.result, pending: state.busy, ...terminal }
    }
    let published = ''
    const publish = () => { if (unlocked()) { try { const data = context(); const signature = JSON.stringify(data); if (signature !== published) { published = signature; window.NANALY_AGENT?.setContext?.(data) } } catch (_) {} } }
    // Terminal output refreshes what 请教娜娜莉 sees, at most every two seconds.
    let publishTimer = null
    const publishSoon = () => { if (!publishTimer) publishTimer = window.setTimeout(() => { publishTimer = null; if (!lifetime.signal.aborted) publish() }, 2000) }

    // One terminal view per shell (Git, Linux) and one for program runs, created when first shown.
    const viewFor = key => {
      if (views[key]) return views[key]
      const host = node('div', 'learning-terminal-host'); host.hidden = true; terminalHosts.append(host)
      const entry = { key, host, view: null, loading: null, title: '', shell: key.startsWith('shell:'), language: key.startsWith('shell:') ? key.slice(6) : null, task: null, taskState: null }
      if (entry.shell) entry.link = createTerminalLink({
        kind: 'shell', language: entry.language, request, WebSocketImpl: window.WebSocket, socketURL: path => window.NANALY_AGENT.socketURL(path),
        size: () => entry.view?.size() || { cols: 80, rows: 24 }, workspace: () => session.state.workspaces[entry.language],
        onOutput: (bytes, replay) => { entry.view?.write(bytes, replay); publishSoon() }, onEvent: event => shellEvent(entry, event)
      })
      views[key] = entry
      return entry
    }
    const inputTo = (entry, data) => entry.shell ? entry.link.write(data) : entry.task?.write(data)
    const loadView = entry => entry.loading ||= loadTerminalBundle().then(bundle => {
      if (lifetime.signal.aborted) return null
      terminalProblem = ''
      entry.view = bundle.create(entry.host, {
        theme: root.dataset.editorTheme, fontSize: fontSize(),
        onData: data => inputTo(entry, data),
        onResize: (cols, rows) => (entry.shell ? entry.link : entry.task)?.resize(cols, rows),
        onTitle: title => { entry.title = title; render() },
        onOpen: path => { if (entry.shell && viewKey() === entry.key) openFile(entry, path) }
      })
      if (!entry.shell) entry.view.notice('按「运行」后，程序在这里编译和运行；要输入时直接在这里打字。')
      return entry.view
    }).catch(problem => { entry.loading = null; terminalProblem = problem.message; render(); return null })
    // Shows the current language's terminal; a shell connects the first time it is seen.
    const showTerminal = async ({ focus = true } = {}) => {
      const key = viewKey()
      if (!key || lifetime.signal.aborted) return null
      const entry = viewFor(key)
      for (const other of Object.values(views)) other.host.hidden = other !== entry
      const view = await loadView(entry)
      if (!view || viewKey() !== key || lifetime.signal.aborted) return null
      view.fit()
      if (entry.shell && connected() && entry.link.state() === 'idle') entry.link.connect()
      if (focus && currentPanel === 'terminal') view.focus()
      render()
      return entry
    }
    const shellEvent = (entry, event) => {
      if (lifetime.signal.aborted) return
      const view = entry.view
      if (event.type === 'ready') {
        session.adoptWorkspace(entry.language, event)
        // Still the same shell, but this page missed more than the server kept: redraw it all.
        if (event.resumed && event.reset) view?.reset()
        if (event.replaced) view?.notice('[后端重启过，这是重新打开的终端：文件、目录、变量和命令历史都恢复到了上次保存时]')
        if (session.state.lessonId === entry.language && currentPanel === 'terminal' && !fileEdit) view?.focus()
      } else if (event.type === 'exit') {
        session.adoptWorkspace(entry.language, event)
        view?.notice(`[进程已退出，退出码 ${event.code}]${event.message ? ' ' + event.message : ''}`)
        for (const warning of Array.isArray(event.warnings) ? event.warnings : []) view?.notice(String(warning), 'warn')
        if (['lifetime', 'shutdown'].includes(event.reason)) entry.reopen = true
        else if (!entry.reopen && !entry.holding) view?.notice('按任意键重新打开终端。')
      } else if (event.type === 'error') { view?.notice(event.message, 'error'); view?.notice('按任意键重试。') }
      else if (event.type === 'file') fileLoaded(event)
      else if (event.type === 'written') fileSaved(event)
      else if (event.type === 'state' && event.state === 'exited' && entry.reopen) { entry.reopen = false; entry.link.connect() }
      render()
    }
    const restartShell = () => {
      const entry = views[viewKey()]
      if (!entry?.shell) return
      if (entry.link.state() === 'open') { entry.reopen = true; entry.link.terminate() } else entry.link.connect()
    }

    // Run: a program in its own terminal, a script typed into the shell, or SQL through the API.
    const runCode = async () => {
      const language = session.state.lessonId, code = session.state.code
      if (!code.trim() || !connected()) return
      setPanel('terminal')
      const entry = await showTerminal()
      if (!entry || session.state.lessonId !== language) return
      if (entry.task) { entry.task.terminate(); entry.task.close() }
      const link = createTerminalLink({
        kind: 'task', language, code, request, WebSocketImpl: window.WebSocket, socketURL: path => window.NANALY_AGENT.socketURL(path),
        size: () => entry.view.size(), onOutput: bytes => { entry.view.write(bytes); publishSoon() }, onEvent: event => taskEvent(entry, link, event)
      })
      entry.task = link; entry.taskState = { running: true }
      link.connect(); entry.view.focus(); render()
    }
    const taskEvent = (entry, link, event) => {
      if (lifetime.signal.aborted || entry.task !== link) return
      if (event.type === 'exit') {
        entry.taskState = { running: false, exit: event }
        entry.view?.notice(event.reason === 'stopped' || event.reason === 'replaced' ? '[已停止]' : `[程序已结束 · 退出码 ${event.code} · 用时 ${event.seconds} 秒]`)
      } else if (event.type === 'error') { entry.taskState = { running: false, error: event.message }; entry.view?.notice(event.message, 'error') }
      else if (event.type === 'lost') { entry.taskState = { running: false, error: '连接断开' }; entry.view?.notice('[连接断开，程序已停止]', 'warn') }
      render()
    }
    const runInShell = async () => {
      const text = session.state.code.replace(/\s+$/, '')
      if (!text || !connected()) return
      setPanel('terminal')
      const entry = await showTerminal({ focus: false })
      if (!entry) return
      try { await entry.link.opened() } catch (problem) { session.note(problem.message); return }
      entry.view.paste(text); entry.link.write('\r'); entry.view.focus()
    }
    const run = () => {
      window.clearTimeout(timer)
      const current = layout()
      if (current === 'file') return
      if (current === 'code') return runCode()
      if (current === 'script' || current === 'terminal') return runInShell()
      setPanel('output'); return session.run()
    }
    const stop = () => {
      const entry = views[viewKey()]
      if (layout() === 'code' && entry?.taskState?.running) entry.task.terminate()
      else session.cancel()
    }

    // `code FILE` in a shell: the file opens in the editor above that shell, saved back with Ctrl+S.
    const openFile = (entry, path) => {
      if (fileEdit && fileEdit.content !== fileEdit.saved && !window.confirm(`${homePath(fileEdit.path)} 还没保存。放弃修改，打开 ${homePath(path)}？`)) return
      const id = ++fileRequest
      fileEdit = { entry, path, id, loading: true, content: '', saved: '', language: EXTENSION_LANGUAGES[(path.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()] || 'text' }
      if (!entry.link.message({ type: 'read', id, path })) fileEdit = null
      render()
    }
    const fileLoaded = event => {
      if (!fileEdit || event.id !== fileEdit.id) return
      if (event.error || typeof event.content !== 'string') { session.note(`打不开 ${homePath(event.path)}：${event.error || '读取失败。'}`); fileEdit = null; render(); return }
      if (event.content.length > MAX_CODE) { session.note(`${homePath(event.path)} 超过 64 KB，编辑器放不下，请用 nano 或 vim 编辑。`); fileEdit = null; render(); return }
      fileEdit.loading = false; fileEdit.content = fileEdit.saved = event.content
      syncEditor(); render(); focusEditor()
    }
    const saveFile = () => {
      if (!fileEdit || fileEdit.loading) return false
      const id = ++fileRequest
      fileEdit.saving = { id, content: fileEdit.content }
      // Text files end with a newline, as nano and vim write them; otherwise `cat` runs into the prompt.
      const content = fileEdit.content && !fileEdit.content.endsWith('\n') ? fileEdit.content + '\n' : fileEdit.content
      if (!fileEdit.entry.link.message({ type: 'write', id, path: fileEdit.path, content })) { fileEdit.saving = null; session.note('终端没连上，文件还没保存。') }
      render()
      return true
    }
    const fileSaved = event => {
      if (!fileEdit?.saving || event.id !== fileEdit.saving.id) return
      if (event.error) session.note(`保存 ${homePath(event.path)} 失败：${event.error}`)
      else { fileEdit.saved = fileEdit.saving.content; session.note(`已保存 ${homePath(event.path)}`) }
      fileEdit.saving = null
      render()
    }
    const closeFile = () => {
      if (fileEdit && fileEdit.content !== fileEdit.saved && !window.confirm(`${homePath(fileEdit.path)} 还没保存，确定关闭？`)) return false
      fileEdit = null; syncEditor(); render()
      views[viewKey()]?.view?.focus()
      return true
    }

    const applyLayout = () => {
      const current = layout()
      root.dataset.mode = current
      for (const [id, item] of Object.entries(modeButtons)) item.setAttribute('aria-pressed', String(id === shellModes[session.state.lessonId]))
      tabButtons.terminal.hidden = !viewKey()
      if (!viewKey() && currentPanel === 'terminal') setPanel('output')
      else if (viewKey() && current !== 'sql' && currentPanel === 'output' && !session.state.result && !session.state.checked) setPanel('terminal')
      if (current === 'terminal') setPanel('terminal')
      if (viewKey()) void showTerminal({ focus: current === 'terminal' })
      render()
    }
    const setMode = next => {
      const language = session.state.lessonId
      if (!SHELLS.has(language) || shellModes[language] === next) return
      shellModes[language] = next
      writeStore(MODE_KEY, JSON.stringify(shellModes))
      applyLayout()
      if (next === 'script') focusEditor()
    }
    const setPanel = id => {
      currentPanel = id
      for (const key of Object.keys(panels)) { panels[key].hidden = key !== id; tabButtons[key].setAttribute('aria-selected', String(key === id)); tabButtons[key].tabIndex = key === id ? 0 : -1 }
      if (id === 'terminal') views[viewKey()]?.view?.fit()
    }
    const focusEditor = () => adapter ? adapter.focus() : fallback.focus()
    const syncEditor = () => {
      const state = session.state; lastMarked = null
      const editing = fileEdit && !fileEdit.loading
      const value = editing ? fileEdit.content : state.code
      if (adapter) { adapter.setLanguage(editing ? fileEdit.language : state.lessonId); adapter.setValue(value); if (editing) adapter.setDiagnostics([]) }
      fallback.value = value; select.value = state.lessonId
    }
    const loadPractice = exercise => { const result = session.loadPractice(exercise); syncEditor(); applyLayout(); return result }
    const jump = diagnostic => {
      if (!diagnostic.line) return
      if (adapter) return adapter.jump(diagnostic)
      const lines = fallback.value.split('\n'); const row = Math.min(diagnostic.line, lines.length) - 1; const start = lines.slice(0, row).reduce((sum, line) => sum + line.length + 1, 0)
      fallback.focus(); fallback.setSelectionRange(start, start + lines[row].length)
    }
    const pre = (text, className = '') => node('pre', className, text)
    const scheduleCheck = () => {
      window.clearTimeout(timer)
      if (!lifetime.signal.aborted && !fileEdit && session.canAutoCheck()) timer = window.setTimeout(() => {
        if (lifetime.signal.aborted || fileEdit || session.state.busy || !session.canAutoCheck()) return
        lastAutoRevision = session.state.revision; session.autoCheckCurrent()
      }, 900)
    }
    const render = () => {
      if (lifetime.signal.aborted) return
      const state = session.state; const isConnected = connected()
      const current = layout(), entry = views[viewKey()]
      const linkState = entry ? (entry.shell ? entry.link.state() : entry.taskState?.running ? 'open' : 'idle') : 'idle'
      root.dataset.mode = current
      const connectionText = { disconnected: '未连接 · 点此连接', connecting: '正在连接…', connected: '后端已连接', error: '连接异常 · 重试' }[connectionState] || '未连接 · 点此连接'
      connectivity.textContent = connectionState === 'disconnected' ? '未连接后端 · 仅可编辑' : connectionText
      connectivity.dataset.connected = String(connectionState === 'connected'); connectivity.dataset.state = connectionState
      connectionLabel.textContent = connectionText; connectButton.dataset.state = connectionState
      connectButton.title = connectionState === 'connected' ? '已通过后端验证，点击管理连接' : connectionState === 'connecting' ? '正在验证后端连接，请稍候' : '点击填写访问令牌并连接后端'
      if (connectionAnnouncement.textContent !== connectionText) connectionAnnouncement.textContent = connectionText
      saved.textContent = current === 'file' ? (fileEdit.loading ? '正在读取…' : fileEdit.saving ? '正在保存…' : fileEdit.content === fileEdit.saved ? '文件已保存' : '文件未保存') : state.persist ? (state.storageError ? '保存异常' : '草稿已保存') : '临时草稿'
      select.disabled = state.busy; select.value = state.lessonId

      // Toolbar
      modeSwitch.hidden = !SHELLS.has(state.lessonId) || current === 'file'
      filename.hidden = current === 'terminal'
      filename.textContent = current === 'file' ? homePath(fileEdit.path) + (fileEdit.content !== fileEdit.saved ? ' ●' : '') : FILE_NAMES[state.lessonId]
      filename.title = current === 'file' ? fileEdit.path : ''
      terminalTitle.hidden = current !== 'terminal' || !entry?.title
      terminalTitle.textContent = entry?.title || ''
      terminalState.hidden = !entry?.shell || current === 'file'
      terminalState.dataset.state = isConnected ? linkState : 'offline'
      terminalState.textContent = !isConnected ? '未连接后端' : terminalProblem ? '终端组件没加载成功' : { idle: '准备中…', connecting: '正在打开…', open: '已连接', reconnecting: '重新连接中…', exited: '已退出 · 按任意键重开', closed: '已断开 · 按任意键重连' }[linkState]
      saveButton.hidden = current !== 'file'; saveButton.disabled = !fileEdit || fileEdit.loading || !!fileEdit.saving || fileEdit.content === fileEdit.saved
      closeFileButton.hidden = current !== 'file'
      testButton.hidden = !TASK_LANGUAGES.has(state.lessonId) || !state.tests.length; testButton.disabled = state.busy || !isConnected
      const taskRunning = current === 'code' && !!entry?.taskState?.running
      runButton.hidden = current === 'file' || current === 'terminal'
      runButton.disabled = state.busy || !isConnected || !state.code.trim()
      runButton.textContent = current === 'script' ? '▶ 在终端执行' : taskRunning ? '↻ 重新运行' : state.restoring && state.busy ? '恢复环境…' : state.busy ? '运行中…' : '▶ 运行'
      stopButton.hidden = !(taskRunning || state.busy || state.checking)
      for (const item of [checkButton, downloadButton, clearButton, autoLabel]) item.hidden = current === 'terminal' || current === 'file'
      restartButton.hidden = !SHELLS.has(state.lessonId)
      clearButton.disabled = state.busy; checkButton.disabled = state.busy || state.checking || !isConnected || !state.code.trim() || !CHECKABLE.has(state.lessonId)
      resetButton.hidden = !STATEFUL.has(state.lessonId); resetButton.disabled = state.busy || !isConnected
      autoCheck.checked = state.autoCheck; autoCheck.disabled = !CHECKABLE.has(state.lessonId); persist.checked = state.persist
      terminalOverlay.hidden = !viewKey() || (isConnected && !terminalProblem)
      overlayText.textContent = terminalProblem || '连接后端后就能使用终端。'
      shortcut.textContent = { terminal: '关掉网页后终端还会保留 30 分钟', script: 'Ctrl / ⌘ ↵ 在终端执行', file: 'Ctrl / ⌘ S 保存', code: 'Ctrl / ⌘ ↵ 运行', sql: 'Ctrl / ⌘ ↵ 运行' }[current]
      cursor.hidden = current === 'terminal'

      status.textContent = state.notice; status.hidden = !state.notice || (state.notice.startsWith('版本 ') && !state.notice.includes('尚未运行')) || state.notice.startsWith('正在执行版本 ')
      error.textContent = state.error; error.hidden = !state.error; storageStatus.textContent = state.storageError; storageStatus.hidden = !state.storageError
      const diagnosticResult = state.checked || state.result
      const visibleResult = state.result || state.lastOutput
      const staleOutput = !!visibleResult && visibleResult.revision !== state.revision
      resultState.textContent = current === 'code' && entry?.taskState
        ? (entry.taskState.running ? '运行中…' : entry.taskState.exit ? `退出码 ${entry.taskState.exit.code}` : '')
        : state.restoring ? '恢复环境…' : state.busy ? '运行中…' : state.checking ? '检查中…' : resultLabel(diagnosticResult || visibleResult) + (staleOutput ? ' · 上次运行' : '')
      resultState.dataset.status = current === 'code' && entry?.taskState?.exit ? (entry.taskState.exit.code === 0 ? 'accepted' : 'runtime_error') : (diagnosticResult || visibleResult)?.status || ''
      if (lastResult !== visibleResult || lastChecked !== state.checked || lastOutputRevision !== state.revision) {
        diagnostics.replaceChildren(); output.replaceChildren()
        for (const d of diagnosticResult?.diagnostics || []) diagnostics.append(button(`${d.line ? `L${d.line}${d.column ? ':' + d.column : ''}  ` : ''}${d.message}`, () => jump(d), `learning-diagnostic learning-diagnostic--${d.severity}`))
        if (visibleResult) {
          if (staleOutput) output.append(node('p', 'learning-muted', '上次运行的输出 · 当前修改尚未运行'))
          if (SHELLS.has(state.lessonId)) output.append(node('p', 'learning-muted', `${visibleResult.cwd ? `目录 ${visibleResult.cwd} · ` : ''}退出码 ${visibleResult.exitCode == null ? '未返回' : visibleResult.exitCode}`))
          if (visibleResult.tests?.length > 1 || (visibleResult.tests?.length && state.tests.length)) {
            visibleResult.tests.forEach((test, index) => output.append(node('p', test.status === 'accepted' ? 'learning-muted' : 'learning-error', `测试 ${index + 1}：${STATUS[test.status] || test.status}`)))
          }
          if (visibleResult.stdout) output.append(pre(visibleResult.stdout, 'learning-stdout'))
          if (visibleResult.stderr) output.append(pre(visibleResult.stderr, 'learning-stderr'))
          if (!visibleResult.stdout && !visibleResult.stderr) output.append(node('p', 'learning-muted', visibleResult.status === 'accepted' ? '命令已完成，没有标准输出。' : '本次运行没有标准输出。'))
          if (visibleResult.workspaceSummary) {
            const summary = node('details', 'learning-workspace-summary')
            summary.append(node('summary', '', state.lessonId === 'git' ? '仓库状态' : '工作区文件'), pre(visibleResult.workspaceSummary))
            output.append(summary)
          }
          if (!visibleResult.workspaceCommitted && !visibleResult.warnings.length) output.append(node('p', 'learning-error', '本次运行环境的更改未保存。'))
          for (const warning of visibleResult.warnings) output.append(node('p', 'learning-muted', warning))
        } else if (state.checked) output.append(pre(state.checked.stderr || state.checked.stdout || state.checked.warnings.join('\n') || '语法检查完成。'))
        else output.append(node('p', 'learning-empty', current === 'sql' ? 'SQL 运行结果会出现在这里 ✧' : '语法检查和测试的结果会出现在这里 ✧'))
        lastResult = visibleResult; lastChecked = state.checked; lastOutputRevision = state.revision
      }
      if (lastHistory !== state.history) {
        historyList.replaceChildren()
        if (!state.history.length) historyList.append(node('p', 'learning-muted', '还没有运行记录。'))
        for (const record of state.history) {
          const item = node('details', 'learning-history-entry'); const time = new Date(record.at)
          item.append(node('summary', '', `${FILE_NAMES[record.lessonId]} · ${resultLabel(record.result)} · ${Number.isNaN(time.getTime()) ? record.at : time.toLocaleString()}`), pre(record.code), button('恢复代码', () => { if (!fileEdit && session.restore(record.id)) { syncEditor(); applyLayout(); focusEditor() } }))
          if (record.result.stdout) item.append(pre(record.result.stdout))
          if (record.result.stderr) item.append(pre(record.result.stderr, 'learning-stderr'))
          historyList.append(item)
        }
        lastHistory = state.history
      }
      if (lastBackups !== state.backups) {
        backupItems.replaceChildren(); backupsList.hidden = !state.backups.length
        for (const record of state.backups) backupItems.append(button(`${FILE_NAMES[record.lessonId]} · ${record.at}`, () => { if (!fileEdit && session.restoreBackup(record.id)) { syncEditor(); applyLayout(); focusEditor() } }))
        lastBackups = state.backups
      }
      // Red marks in the editor come only from a check or run of the code on screen. Older marks
      // stay attached to their text through edits until the next check replaces them.
      const marked = [state.checked, state.result].find(item => item && item.revision === state.revision)
      if (!fileEdit && adapter?.setDiagnostics && marked && marked !== lastMarked) { adapter.setDiagnostics(marked.diagnostics); lastMarked = marked }
      publish()
      if (state.result || state.checked) lastAutoRevision = state.revision
      if (!fileEdit && !state.busy && !state.checking && state.revision !== lastAutoRevision && session.canAutoCheck()) scheduleCheck()
    }
    try {
      if (window.NOIMPTY_CODE_EDITOR) adapter = window.NOIMPTY_CODE_EDITOR.create(editorHost, {
        value: session.state.code, language: session.state.lessonId,
        onChange: value => { if (fileEdit && !fileEdit.loading) { fileEdit.content = value; render() } else { session.edit({ code: value }); scheduleCheck() } },
        onRun: run, onSave: () => fileEdit ? saveFile() : false,
        onCursor: position => { cursor.textContent = `Ln ${position.line}, Col ${position.column}` }
      })
    } catch (_) { editorHost.replaceChildren() }
    fallback.hidden = !!adapter; editorHost.hidden = !adapter
    fallback.addEventListener('input', () => { if (fileEdit && !fileEdit.loading) { fileEdit.content = fallback.value; render() } else { session.edit({ code: fallback.value }); scheduleCheck() } })
    fallback.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); run() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && fileEdit) { event.preventDefault(); saveFile() }
    })
    select.addEventListener('change', () => {
      window.clearTimeout(timer)
      if (fileEdit && !closeFile()) { select.value = session.state.lessonId; return }
      session.select(select.value); syncEditor(); applyLayout()
      if (layout() !== 'terminal') focusEditor()
    })
    autoCheck.addEventListener('change', () => { window.clearTimeout(timer); lastAutoRevision = null; session.setAutoCheck(autoCheck.checked); if (autoCheck.checked) scheduleCheck() })
    persist.addEventListener('change', () => session.persistence(persist.checked))
    root.addEventListener('keydown', event => { if (event.key === 'Escape' && more.open) { more.open = false; more.querySelector('summary').focus() } })
    document.addEventListener('pointerdown', event => { if (!more.contains(event.target)) more.open = false }, { signal: lifetime.signal })
    let wasConnected = false
    const connectionChanged = snapshot => {
      const isConnected = connected()
      const next = snapshot?.connection || window.NANALY_AGENT?.snapshot?.().connection || (isConnected ? 'connected' : 'disconnected')
      const changed = next !== connectionState || isConnected !== wasConnected
      const sync = isConnected && !wasConnected
      connectionState = next; wasConnected = isConnected
      if (changed) render()
      if (!isConnected && changed) {
        session.invalidateWorkspaces()
        // Disconnecting the backend detaches the pages; the shells stay on the server a while.
        for (const [key, entry] of Object.entries(views)) {
          entry.task?.close(); entry.task = null; entry.taskState = null
          if (entry.shell) { entry.link.close(); entry.view?.dispose(); entry.host.remove(); delete views[key] }
        }
        if (fileEdit) { fileEdit = null; syncEditor() }
      }
      if (sync) { session.restoreWorkspaces(); session.syncHistory(); if (viewKey()) void showTerminal({ focus: layout() === 'terminal' }) }
    }
    const unsubscribe = window.NANALY_AGENT?.subscribe?.(connectionChanged)
    window.addEventListener('nanaly:agent-configured', connectionChanged, { signal: lifetime.signal })
    // Opened next to an article: start in the language the article teaches.
    if (article?.language && LANGUAGE_NAMES[article.language] && session.state.lessonId !== article.language) session.select(article.language)
    syncEditor(); setPanel(viewKey() ? 'terminal' : 'output'); applyLayout(); connectionChanged()
    return { session, context, loadPractice, dispose: () => {
      window.clearTimeout(timer); window.clearTimeout(publishTimer); lifetime.abort(); unsubscribe?.()
      // Closing the sockets detaches this page: shells keep running on the server for a while.
      for (const entry of Object.values(views)) { entry.link?.close(); entry.task?.close(); entry.view?.dispose() }
      session.dispose(); adapter?.destroy(); root.remove(); try { window.NANALY_AGENT?.setContext?.(null) } catch (_) {}
    } }
  }

  // The practice language an article teaches: its category first (Git posts are full of bash
  // blocks but want the Git workspace), then its most common code-block language.
  const BLOCK_LANGUAGES = { c: 'c', cpp: 'cpp', 'c++': 'cpp', go: 'go', golang: 'go', python: 'python', py: 'python', bash: 'linux', sh: 'linux', shell: 'linux', console: 'linux', zsh: 'linux', sql: 'mysql', mysql: 'mysql' }
  const articleLanguage = article => {
    // Butterfly renders the category links in the page header (#post-info), outside #post.
    const categories = [...document.querySelectorAll('#post-info .post-meta-categories')].map(link => link.getAttribute('href') || '').join(' ')
    if (/\/git\//i.test(categories)) return 'git'
    if (/\/(linux|shell)[^/]*\//i.test(categories)) return 'linux'
    const counts = {}
    for (const figure of article.querySelectorAll('figure.highlight')) {
      const id = BLOCK_LANGUAGES[[...figure.classList].find(name => BLOCK_LANGUAGES[name])]
      if (id) counts[id] = (counts[id] || 0) + 1
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null
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
      const data = { title: document.querySelector('h1.post-title')?.textContent || document.title, url: window.location.href, text: clip(article.textContent, 20000), language: articleLanguage(article) }
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

  window.NOIMPTY_LEARNING = Object.freeze({ createSession, createTerminalLink, lessons: LESSONS, mount, articleLanguage, context: () => unlocked() ? mounted?.context() || null : null })
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
