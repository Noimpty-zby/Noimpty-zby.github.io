import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const script = readFileSync(new URL('../../../source/js/learning-lab.js', import.meta.url), 'utf8')
const boot = () => {
  const listeners = []
  const document = { readyState: 'loading', addEventListener: (name, fn) => listeners.push({ name, fn }) }
  const window = { addEventListener: (name, fn) => listeners.push({ name, fn }) }
  vm.runInNewContext(script, { window, document, AbortController, DOMException, URL, console, setTimeout, clearTimeout })
  return window.NOIMPTY_LEARNING
}
const api = boot()
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const result = (revision, overrides = {}) => ({ runId: `run-${revision}`, revision, status: 'accepted', stdout: '5\n', stderr: '', diagnostics: [], tests: [], ...overrides })
const storage = () => { const data = new Map(); return { data, getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) } }
const setup = options => {
  const calls = []
  const disk = options?.storage || storage()
  const request = async (path, args) => { calls.push({ path, ...args }); if (path === '/api/workspaces') return options?.workspaces ? options.workspaces(args) : { workspaces: [] }; return options?.request ? options.request(path, args) : result(args.body.revision) }
  return { session: api.createSession({ storage: disk, request, ...options, ...(options?.request ? { request } : {}) }), calls, storage: disk }
}
// Execution fixtures are explicit; a real new IDE session always starts blank.
const setupWithCode = options => { const app = setup(options); app.session.edit(api.lessons[0]); return app }
let count = 0
const check = async (name, fn) => { await fn(); count++; console.log(`  ✓ ${name}`) }

await check('split view starts in the language the article teaches: category first, then code blocks', () => {
  const page = (categories, blocks) => {
    const document = { readyState: 'loading', addEventListener() {}, querySelectorAll: selector => selector === '#post-info .post-meta-categories' ? categories.map(href => ({ getAttribute: () => href })) : [] }
    const window = { addEventListener() {} }
    vm.runInNewContext(script, { window, document, AbortController, DOMException, URL, console })
    const article = { querySelectorAll: () => blocks.map(name => ({ classList: ['highlight', name] })) }
    return window.NOIMPTY_LEARNING.articleLanguage(article)
  }
  assert.equal(page(['/categories/extra/ai-infra/git/'], Array(23).fill('bash')), 'git')
  assert.equal(page(['/categories/extra/ai-infra/linux-intro/'], ['bash', 'plaintext']), 'linux')
  assert.equal(page(['/categories/in-class/dsa/'], ['c', 'c', 'c', 'cpp', 'plaintext']), 'c')
  assert.equal(page(['/categories/extra/gamedev/ue5-looman/'], ['cpp', 'text', 'cpp', 'csharp']), 'cpp')
  assert.equal(page([], ['python', 'py', 'bash']), 'python')
  assert.equal(page(['/categories/life/'], []), null)
})

await check('seven real-language lessons contain executable source and explicit algorithm test cases', () => {
  assert.deepEqual(Array.from(api.lessons, lesson => lesson.language), ['c', 'cpp', 'go', 'python', 'git', 'linux', 'mysql'])
  for (const lesson of api.lessons) {
    assert.ok(lesson.code.trim())
    if (['c', 'cpp', 'go', 'python'].includes(lesson.language)) assert.ok(lesson.tests.length > 1)
    else assert.equal(lesson.tests.length, 0)
  }
})
await check('new sessions and every untouched language start blank without exercises or test cases', async () => {
  const { session, calls } = setup()
  assert.equal(session.state.lessonId, 'c')
  for (const lesson of api.lessons) {
    assert.equal(session.select(lesson.id), true)
    assert.equal(session.state.code, ''); assert.equal(session.state.stdin, '')
    assert.equal(session.state.tests.length, 0); assert.equal(session.state.exercise, null)
    assert.equal(await session.run(), null)
    assert.equal(session.state.result, null); assert.equal(session.state.history.length, 0)
  }
  assert.equal(calls.length, 0, 'empty files must never reach the execution service')
})
await check('language drafts remain independent and reload restores the last selected language', () => {
  const disk = storage(); const first = setup({ storage: disk })
  first.session.edit({ code: 'C draft', stdin: 'C input' })
  first.session.select('go'); first.session.edit({ code: 'Go draft', stdin: 'Go input' })
  first.session.select('c')
  assert.equal(first.session.state.code, 'C draft'); assert.equal(first.session.state.stdin, 'C input')
  first.session.select('go')
  const reloaded = setup({ storage: disk })
  assert.equal(reloaded.session.state.lessonId, 'go')
  assert.equal(reloaded.session.state.code, 'Go draft'); assert.equal(reloaded.session.state.stdin, 'Go input')
  reloaded.session.select('c'); assert.equal(reloaded.session.state.code, 'C draft')
  reloaded.session.select('cpp')
  const untouched = setup({ storage: disk })
  assert.equal(untouched.session.state.lessonId, 'cpp'); assert.equal(untouched.session.state.code, '')
  untouched.session.select('go'); untouched.session.edit({ code: '', stdin: '', tests: [] })
  untouched.session.select('c'); untouched.session.select('go')
  assert.equal(untouched.session.state.code, '', 'a deliberately empty draft must not bring back an example')
  const cleared = setup({ storage: disk })
  assert.equal(cleared.session.state.lessonId, 'go'); assert.equal(cleared.session.state.code, '')
})
await check('automatic checks are on by default so mistakes are marked while typing, and a saved opt-out stops them', async () => {
  const { session, calls } = setupWithCode({ request: async (_, args) => result(args.body.revision, { status: 'checked' }) })
  assert.equal(session.state.autoCheck, true); assert.equal(session.canAutoCheck(), true)
  await session.autoCheckCurrent(); assert.equal(calls.length, 1); assert.equal(calls[0].body.mode, 'check')
  session.setAutoCheck(false)
  assert.equal(await session.autoCheckCurrent(), null); assert.equal(calls.length, 1)
})
await check('automatic checks stay quiet: marks only, no notices, and a failed background check shows no error', async () => {
  const good = setupWithCode({ request: async (_, args) => result(args.body.revision, { status: 'checked' }) })
  await good.session.autoCheckCurrent()
  assert.equal(good.session.state.checked.status, 'checked'); assert.equal(good.session.state.notice, ''); assert.equal(good.session.state.error, '')
  await good.session.run('check'); assert.match(good.session.state.notice, /工具检查/, 'an explicit check still reports')
  const failing = setupWithCode({ request: async () => { throw new Error('执行队列已满，请稍后重试。') } })
  await failing.session.autoCheckCurrent()
  assert.equal(failing.session.state.error, ''); assert.equal(failing.session.state.checking, false)
})
await check('resetting a compiled-language file clears code and input while retaining run history', async () => {
  const { session, calls } = setupWithCode()
  await session.run()
  assert.equal(session.state.history.length, 1)
  assert.equal(await session.reset(), true)
  assert.equal(session.state.code, ''); assert.equal(session.state.stdin, '')
  assert.equal(session.state.tests.length, 0); assert.equal(session.state.exercise, null)
  assert.equal(session.state.result, null); assert.equal(session.state.history.length, 1)
  assert.equal(calls.length, 1, 'clearing a local source file must not reset a server workspace')
})
await check('locked pages cannot read persisted code, execute, edit or write history', async () => {
  let reads = 0, writes = 0
  const { session, calls } = setup({ permitted: () => false, storage: { getItem: () => { reads++; return '{}' }, setItem: () => writes++, removeItem: () => writes++ } })
  const code = session.state.code
  session.edit({ code: 'private' }); session.persistence(false); session.clearHistory(); session.dispose()
  assert.equal(await session.run(), null)
  assert.equal(session.state.code, code); assert.equal(reads, 0); assert.equal(writes, 0); assert.equal(calls.length, 0)
})
await check('a missing backend never produces simulated output or a submission', async () => {
  const { session, calls } = setup({ available: () => false })
  assert.equal(await session.run(), null)
  assert.equal(calls.length, 0); assert.equal(session.state.result, null); assert.equal(session.state.history.length, 0)
  assert.match(session.state.error, /尚未连接/)
})
await check('automatic tool checking defaults on and preserves explicit on and off preferences', () => {
  const disk = storage(); const first = setup({ storage: disk })
  assert.equal(first.session.state.autoCheck, true)
  first.session.setAutoCheck(false)
  assert.equal(setup({ storage: disk }).session.state.autoCheck, false)
  first.session.setAutoCheck(true)
  assert.equal(setup({ storage: disk }).session.state.autoCheck, true)
  first.session.setAutoCheck(false)
  const next = setup({ storage: disk }); assert.equal(next.session.state.autoCheck, false)
  next.session.persistence(false); next.session.edit({ code: 'must not persist code' })
  const privateMode = setup({ storage: disk }); assert.equal(privateMode.session.state.autoCheck, false)
  assert.equal(privateMode.session.state.persist, false); assert.notEqual(privateMode.session.state.code, 'must not persist code')
  privateMode.session.setAutoCheck(true)
  assert.equal(setup({ storage: disk }).session.state.autoCheck, true)
})
await check('automatic checking only sends supported connected language checks and never executes SQL or runs code', async () => {
  const { session, calls } = setup({ request: async (_, args) => result(args.body.revision, { status: 'checked' }) })
  session.setAutoCheck(true)
  for (const language of ['c', 'cpp', 'go', 'python', 'git', 'linux']) { session.select(language); session.edit(api.lessons.find(lesson => lesson.language === language)); await session.autoCheckCurrent() }
  assert.equal(calls.length, 6); assert.ok(calls.every(call => call.path === '/api/run' && call.body.mode === 'check' && call.body.tests.length === 0))
  assert.equal(session.state.history.length, 0)
  session.select('mysql'); session.edit({ code: 'SELECT 1;' }); assert.equal(await session.autoCheckCurrent(), null); assert.equal(calls.length, 6)
  session.select('c'); session.setAutoCheck(false); assert.equal(await session.autoCheckCurrent(), null); assert.equal(calls.length, 6)
  const offline = setupWithCode({ available: () => false }); offline.session.setAutoCheck(true); await offline.session.autoCheckCurrent(); assert.equal(offline.calls.length, 0)
  const locked = setup({ permitted: () => false }); locked.session.setAutoCheck(true); await locked.session.autoCheckCurrent(); assert.equal(locked.calls.length, 0)
})
await check('submitting test cases sends the exact snapshot and restores failed code as unverified', async () => {
  const { session, calls } = setup({ request: async (_, args) => result(args.body.revision, { status: 'wrong_answer', stdout: '4\n', tests: [{ status: 'wrong_answer', stdout: '4\n', expectedOutput: '5\n' }] }) })
  session.edit({ code: 'bad source', stdin: '2 3', tests: [{ input: '2 3', expectedOutput: '5\n' }] })
  await session.run('run', true)
  assert.equal(calls[0].body.code, 'bad source'); assert.equal(calls[0].body.tests[0].input, '2 3')
  assert.equal(session.state.history[0].result.status, 'wrong_answer')
  const id = session.state.history[0].id
  session.edit({ code: 'fixed source' }); assert.equal(session.state.result, null)
  assert.equal(session.restore(id), true); assert.equal(session.state.code, 'bad source'); assert.equal(session.state.result, null)
  assert.match(session.state.notice, /重新执行/)
})
await check('an old run enters history but cannot overwrite a newer editor revision', async () => {
  const pending = deferred()
  const { session } = setupWithCode({ request: () => pending.promise })
  const runRevision = session.state.revision
  const run = session.run()
  session.edit({ code: 'new code' })
  pending.resolve(result(runRevision, { status: 'compile_error', diagnostics: [{ message: 'old syntax error', line: 2 }] }))
  await run
  assert.equal(session.state.result, null); assert.equal(session.state.checked, null)
  assert.equal(session.state.lastOutput.status, 'compile_error')
  assert.equal(session.state.history.length, 1); assert.equal(session.state.history[0].code.includes('#include'), true)
  assert.match(session.state.notice, new RegExp(`当前版本 ${session.state.revision} 尚未运行`))
})
await check('editing aborts old checks and ignores stale responses even if transport ignores abort', async () => {
  const pending = deferred()
  const { session, calls } = setupWithCode({ request: () => pending.promise })
  const runRevision = session.state.revision
  const checkRun = session.run('check')
  session.edit({ code: 'fixed' })
  assert.equal(calls[0].signal.aborted, true)
  pending.resolve(result(runRevision, { status: 'compile_error', diagnostics: [{ message: 'stale' }] }))
  await checkRun
  assert.equal(session.state.checked, null); assert.equal(session.state.history.length, 0)
})
await check('current diagnostics are tool output and are invalidated by input changes', async () => {
  const { session } = setupWithCode({ request: async (_, args) => result(args.body.revision, { status: 'compile_error', diagnostics: [{ message: '<img onerror=alert(1)>', line: 4, column: 3 }] }) })
  await session.run('check')
  assert.equal(session.state.checked.diagnostics[0].line, 4); assert.equal(session.state.history.length, 0)
  session.edit({ stdin: 'new input' }); assert.equal(session.state.checked, null)
})
await check('unsupported MySQL checks are not represented as executed or accepted', async () => {
  const { session } = setup({ request: async (_, args) => result(args.body.revision, { status: 'unsupported_check', warnings: ['仅实际执行才能验证'] }) })
  session.select('mysql'); session.edit({ code: 'SELECT 1;' }); await session.run('check')
  assert.equal(session.state.result, null); assert.equal(session.state.history.length, 0)
  assert.equal(session.state.checked.status, 'unsupported_check'); assert.match(session.state.notice, /暂不支持/)
})
await check('concurrent runs and language switches cannot race a live workspace operation', async () => {
  const pending = deferred()
  const { session, calls } = setupWithCode({ request: () => pending.promise })
  const runRevision = session.state.revision
  const first = session.run()
  assert.equal(await session.run(), null); assert.equal(session.select('git'), false); assert.equal(calls.length, 1)
  pending.resolve(result(runRevision)); await first; assert.equal(session.state.busy, false)
})
await check('cancellation keeps files and verifies the workspace before retrying', async () => {
  const pending = deferred(); let executions = 0
  const known = { workspaceId: 'git-space', language: 'git', revision: 3, busy: false }
  const { session, calls } = setup({ workspaces: async () => ({ workspaces: [known] }), request: (path, args) => path.startsWith('/api/workspaces/') ? { ...known, revision: 4 } : ++executions === 1 ? pending.promise : result(args.body.revision, { workspaceId: known.workspaceId, workspaceRevision: 5 }) })
  session.select('git'); session.edit({ code: 'git status' }); const revision = session.state.revision
  await session.restoreWorkspaces()
  const run = session.run(); await Promise.resolve(); session.cancel()
  assert.equal(calls.find(call => call.path === '/api/run').signal.aborted, true)
  assert.match(session.state.notice, /服务端可能已执行/)
  const retry = await session.run()
  assert.equal(retry.status, 'accepted')
  const retryBody = calls.filter(call => call.path === '/api/run')[1].body
  assert.equal(retryBody.workspaceId, 'git-space'); assert.equal(retryBody.workspaceRevision, 4)
  pending.resolve(result(revision, { workspaceId: 'old', workspaceRevision: 1 })); await run
  assert.equal(session.state.history.length, 1); assert.equal(session.state.workspaces.git.id, 'git-space')
})
await check('workspace revision is carried across successful runs and reset preserves code/history', async () => {
  let revision = 0
  const { session, calls } = setup({ request: async (path, args) => path === '/api/workspaces/reset' ? { workspaceId: 'fresh', revision: 0 } : result(args.body.revision, { workspaceId: 'git-space', workspaceRevision: ++revision, workspaceSummary: '## main' }) })
  session.select('git'); session.edit({ code: 'git init' }); await session.run(); session.edit({ code: 'git status' }); await session.run()
  const runs = calls.filter(call => call.path === '/api/run')
  assert.equal(runs[1].body.workspaceId, 'git-space'); assert.equal(runs[1].body.workspaceRevision, 1)
  const code = session.state.code; await session.reset()
  assert.equal(session.state.code, code); assert.equal(session.state.history.length, 2); assert.equal(session.state.result, null)
  assert.equal(session.state.workspaces.git.id, 'fresh'); assert.equal(session.state.workspaces.git.revision, 0)
})
await check('an interrupted workspace reset cannot lock the UI or overwrite a later reset', async () => {
  const pending = deferred(); let resets = 0
  const { session, calls } = setup({ request: async () => ++resets === 1 ? pending.promise : { workspaceId: 'newer-reset', revision: 0 } })
  session.select('linux'); await session.restoreWorkspaces(); const first = session.reset(); await Promise.resolve(); session.cancel()
  assert.equal(calls.find(call => call.path === '/api/workspaces/reset').signal.aborted, true); assert.equal(session.state.busy, false)
  assert.equal(session.state.workspaces.linux.uncertain, true)
  assert.equal(await session.reset(), true)
  pending.resolve({ workspaceId: 'late-old-reset', revision: 0 }); assert.equal(await first, false)
  assert.equal(session.state.workspaces.linux.id, 'newer-reset'); assert.equal(session.state.busy, false)
})
await check('malformed/mismatched backend results never create a verified submission', async () => {
  for (const response of [{ status: 'fantasy', revision: 0 }, result(99)]) {
    const { session } = setupWithCode({ request: async () => response }); await session.run()
    assert.equal(session.state.result, null); assert.equal(session.state.history.length, 0); assert.ok(session.state.error)
  }
})
await check('quota errors preserve in-memory submissions; reload and persistence opt-out behave safely', async () => {
  const broken = setupWithCode({ storage: { getItem: () => 'not json', setItem: () => { throw new Error('quota') } } })
  await broken.session.run(); assert.equal(broken.session.state.history.length, 1); assert.match(broken.session.state.storageError, /存储不可用/)
  const disk = storage(); const first = setup({ storage: disk }); first.session.edit({ code: 'my draft' }); await first.session.run()
  const reloaded = setup({ storage: disk }); assert.equal(reloaded.session.state.code, 'my draft'); assert.equal(reloaded.session.state.history.length, 1)
  reloaded.session.persistence(false)
  const optedOut = setup({ storage: disk }); assert.equal(optedOut.session.state.persist, false); assert.equal(optedOut.session.state.history.length, 0)
  assert.notEqual(optedOut.session.state.code, 'my draft')
})
await check('private cloud history restores exact test inputs and latest workspace revision across devices', async () => {
  const remote = { ...result(7, { runId: 'cloud-run', workspaceId: 'remote-git', workspaceRevision: 1 }), language: 'git', code: 'git status', stdin: '', testCases: [{ input: 'cloud input', expectedOutput: 'cloud output' }], createdAt: '2026-09-25T03:00:00Z' }
  const { session, calls } = setup({ workspaces: async () => ({ workspaces: [{ workspaceId: 'remote-git', language: 'git', revision: 9, busy: false }] }), request: async () => ({ runs: [remote] }) })
  await session.restoreWorkspaces(); await session.syncHistory(); await session.syncHistory()
  assert.equal(session.state.history.length, 1); assert.equal(session.state.history[0].tests[0].input, 'cloud input')
  assert.equal(session.state.workspaces.git.revision, 9); assert.equal(session.restore('cloud-run'), true)
  assert.equal(session.state.code, 'git status'); assert.equal(session.state.result, null)
  assert.ok(calls.some(call => call.path === '/api/workspaces'))
})
await check('disposing cancels work and late results cannot mutate history or publish an outcome', async () => {
  const pending = deferred(); let changes = 0
  const { session, calls } = setupWithCode({ changed: () => changes++, request: () => pending.promise })
  const runRevision = session.state.revision
  const run = session.run(); session.dispose(); const afterDispose = changes
  pending.resolve(result(runRevision)); await run
  assert.equal(calls[0].signal.aborted, true); assert.equal(session.state.history.length, 0); assert.equal(changes, afterDispose)
})
const practice = () => ({ id: 'exercise-1', language: 'c', title: '生成的求和题', statement: '输入两个整数，输出和。', starterCode: 'int main(void) {\n\n}', referenceCode: api.lessons[0].code, tests: [{ input: '2 3\n', expectedOutput: '5\n' }], verification: { runId: 'verified-reference-run', status: 'accepted' } })
await check('generated practices require a real verification reference and fully specified tests before loading', () => {
  const { session } = setup(); const before = session.state.code
  for (const invalid of [{ ...practice(), verification: { status: 'accepted' } }, { ...practice(), verification: { status: 'wrong_answer', runId: 'failed' } }, { ...practice(), tests: [{ input: '2 3' }] }, { ...practice(), language: 'mysql' }]) assert.throws(() => session.loadPractice(invalid), /未载入/)
  assert.equal(session.state.code, before); assert.equal(session.state.backups.length, 0)
})
await check('loading a verified reference preserves the prior draft and never marks starter code as verified', async () => {
  const { session, calls } = setup()
  session.edit({ code: 'old private draft', stdin: 'old input' })
  const loaded = session.loadPractice(practice())
  assert.equal(loaded.loaded, true); assert.equal(session.state.code, practice().starterCode)
  assert.equal(session.state.exercise.verification.runId, 'verified-reference-run'); assert.equal(session.state.result, null); assert.equal(session.state.history.length, 0)
  assert.equal(session.state.backups[0].code, 'old private draft')
  await session.run('run', true)
  assert.equal(calls[0].body.practice.id, 'exercise-1'); assert.equal(calls[0].body.tests[0].expectedOutput, '5\n')
  assert.equal(session.restoreBackup(session.state.backups[0].id), true)
  assert.equal(session.state.code, 'old private draft'); assert.equal(session.state.exercise, null); assert.equal(session.state.result, null)
})
await check('exercise reference tests remain immutable when the learner edits submitted cases', () => {
  const { session } = setup(); session.loadPractice(practice())
  session.edit({ tests: [{ input: '1 2', expectedOutput: '3' }] })
  assert.equal(session.state.tests[0].input, '1 2'); assert.equal(session.state.exercise.tests[0].input, '2 3\n')
  session.select('go'); assert.equal(session.state.exercise, null)
  session.select('c'); assert.equal(session.state.exercise.id, 'exercise-1')
})
await check('generated practice and pre-load draft backups survive local reload', () => {
  const disk = storage(); const first = setup({ storage: disk }); first.session.edit({ code: 'draft before generation' }); first.session.loadPractice(practice())
  const reloaded = setup({ storage: disk }); assert.equal(reloaded.session.state.exercise.id, 'exercise-1')
  assert.equal(reloaded.session.state.backups[0].code, 'draft before generation')
})
await check('cloud reference validation restores a new exercise only from matching successful source and test evidence', async () => {
  const prepared = practice(); delete prepared.verification
  const reference = { ...result(0, { runId: 'actual-reference', tests: [{ status: 'accepted', stdout: '5\n' }] }), language: 'c', mode: 'run', code: prepared.referenceCode, stdin: '', testCases: prepared.tests, practice: prepared, createdAt: '2026-09-25T08:00:00Z' }
  const { session } = setup({ request: async () => ({ runs: [reference] }) })
  await session.syncHistory(); assert.equal(session.state.history[0].referenceValidation, true)
  assert.equal(session.restore('actual-reference'), true)
  assert.equal(session.state.code, prepared.starterCode); assert.equal(session.state.result, null)
  assert.equal(session.state.exercise.verification.runId, 'actual-reference'); assert.equal(session.state.backups.length, 1)
  for (const invalid of [{ ...reference, code: 'different source' }, { ...reference, status: 'wrong_answer' }, { ...reference, testCases: [{ input: 'different', expectedOutput: '5\n' }] }, { ...reference, tests: [{ status: 'wrong_answer' }] }]) {
    const app = setup({ request: async () => ({ runs: [invalid] }) }); await app.session.syncHistory()
    assert.equal(app.session.state.history[0].referenceValidation, false); assert.equal(app.session.state.history[0].exercise, null)
  }
})

await check('a first run waits for authoritative workspace recovery even when history is empty', async () => {
  const recovery = deferred()
  const { session, calls } = setup({ workspaces: () => recovery.promise, request: async (path, args) => path.startsWith('/api/runs?') ? { runs: [] } : result(args.body.revision, { workspaceId: 'latest-linux', workspaceRevision: 8, cwd: '/work/docs', exitCode: 0 }) })
  session.select('linux'); session.edit({ code: 'pwd' })
  const restoring = session.restoreWorkspaces(); const running = session.run()
  await session.syncHistory()
  assert.equal(calls.filter(call => call.path === '/api/workspaces').length, 1)
  assert.equal(calls.some(call => call.path === '/api/run'), false); assert.equal(session.state.busy, true)
  recovery.resolve({ workspaces: [{ workspaceId: 'older-linux', language: 'linux', revision: 2, updatedAt: '2026-09-24T00:00:00Z' }, { workspaceId: 'latest-linux', language: 'linux', revision: 7, updatedAt: '2026-09-25T00:00:00Z' }] })
  await restoring; await running
  const submitted = calls.find(call => call.path === '/api/run').body
  assert.equal(submitted.workspaceId, 'latest-linux'); assert.equal(submitted.workspaceRevision, 7)
  assert.equal(session.state.result.cwd, '/work/docs'); assert.equal(session.state.result.exitCode, 0)
  session.edit({ code: 'ls' })
  assert.equal(session.state.result, null); assert.equal(session.state.lastOutput.cwd, '/work/docs')
})
await check('workspace listing failures never silently create an empty environment and can be retried', async () => {
  let attempts = 0
  const { session, calls } = setup({ workspaces: async () => { if (++attempts === 1) throw new Error('offline'); return { workspaces: [{ workspaceId: 'kept', language: 'linux', revision: 4 }] } }, request: async (_, args) => result(args.body.revision, { workspaceId: 'kept', workspaceRevision: 5 }) })
  session.select('linux'); session.edit({ code: 'cat saved.txt' })
  assert.equal(await session.run(), null); assert.match(session.state.error, /尚未恢复/)
  assert.equal(calls.some(call => call.path === '/api/run'), false)
  assert.equal((await session.run()).status, 'accepted')
  assert.equal(calls.find(call => call.path === '/api/run').body.workspaceId, 'kept')
})
await check('temporary execution errors refresh known workspace revisions without forcing a destructive reset', async () => {
  let executions = 0
  const { session, calls } = setup({ workspaces: async () => ({ workspaces: [{ workspaceId: 'kept-git', language: 'git', revision: 2 }] }), request: async (path, args) => {
    if (path.startsWith('/api/workspaces/')) return { workspaceId: 'kept-git', language: 'git', revision: 3, busy: false }
    if (++executions === 1) throw new Error('RUNNER_BUSY')
    return result(args.body.revision, { workspaceId: 'kept-git', workspaceRevision: 4 })
  } })
  session.select('git'); session.edit({ code: 'git status' })
  assert.equal(await session.run(), null)
  assert.equal(session.state.workspaces.git.uncertain, false); assert.match(session.state.notice, /可重新运行/)
  assert.equal((await session.run()).status, 'accepted')
  assert.equal(calls.filter(call => call.path === '/api/run')[1].body.workspaceRevision, 3)
  assert.equal(calls.some(call => call.path.endsWith('/reset')), false)
})
await check('an in-flight server workspace blocks execution only until it is idle', async () => {
  let busy = true
  const { session, calls } = setup({ workspaces: async () => ({ workspaces: [{ workspaceId: 'busy-linux', language: 'linux', revision: 2, busy: true }] }), request: async (path, args) => path.startsWith('/api/workspaces/') ? { workspaceId: 'busy-linux', language: 'linux', revision: 3, busy } : result(args.body.revision) })
  session.select('linux'); session.edit({ code: 'pwd' })
  assert.equal(await session.run(), null); assert.match(session.state.error, /稍后重试/)
  assert.equal(calls.some(call => call.path === '/api/run'), false)
  busy = false; assert.equal((await session.run()).status, 'accepted')
})
await check('cancelling recovery never dispatches a late command or marks an idle workspace uncertain', async () => {
  const recovery = deferred()
  const { session, calls } = setup({ workspaces: () => recovery.promise })
  session.select('linux'); session.edit({ code: 'touch unwanted' })
  const running = session.run(); session.cancel()
  recovery.resolve({ workspaces: [{ workspaceId: 'kept', language: 'linux', revision: 4 }] })
  await running
  assert.equal(calls.some(call => call.path === '/api/run'), false)
  assert.equal(session.state.workspaces.linux.uncertain, false); assert.equal(session.state.busy, false)
})
await check('reset waits for recovery and deletes the intended current workspace only', async () => {
  const recovery = deferred()
  const { session, calls } = setup({ workspaces: () => recovery.promise, request: async () => ({ workspaceId: 'new-empty', revision: 0 }) })
  session.select('git'); const resetting = session.reset()
  assert.equal(calls.some(call => call.path.endsWith('/reset')), false)
  recovery.resolve({ workspaces: [{ workspaceId: 'current-git', language: 'git', revision: 6 }] })
  assert.equal(await resetting, true)
  assert.equal(calls.find(call => call.path.endsWith('/reset')).body.workspaceId, 'current-git')
  assert.equal(session.state.workspaces.git.id, 'new-empty')
})


await check('a lost first-run response rediscovers the server workspace instead of creating another', async () => {
  let listings = 0; let executions = 0
  const { session, calls } = setup({ workspaces: async () => ({ workspaces: ++listings === 1 ? [] : [{ workspaceId: 'created-before-disconnect', language: 'linux', revision: 1 }] }), request: async (_, args) => {
    if (++executions === 1) throw new Error('connection closed')
    return result(args.body.revision, { workspaceId: 'created-before-disconnect', workspaceRevision: 2 })
  } })
  session.select('linux'); session.edit({ code: 'pwd' })
  assert.equal(await session.run(), null)
  assert.equal((await session.run()).status, 'accepted')
  assert.equal(listings, 2)
  assert.equal(calls.filter(call => call.path === '/api/run')[1].body.workspaceId, 'created-before-disconnect')
})
await check('a lost reset response refreshes the workspace list before the next execution', async () => {
  let listings = 0
  const { session, calls } = setup({ workspaces: async () => ({ workspaces: [{ workspaceId: ++listings === 1 ? 'old-workspace' : 'reset-created-workspace', language: 'git', revision: 0 }] }), request: async (path, args) => {
    if (path.endsWith('/reset')) throw new Error('connection closed after reset')
    return result(args.body.revision, { workspaceId: 'reset-created-workspace', workspaceRevision: 1 })
  } })
  session.select('git'); session.edit({ code: 'git status' })
  assert.equal(await session.reset(), false)
  assert.equal((await session.run()).status, 'accepted')
  assert.equal(calls.find(call => call.path === '/api/run').body.workspaceId, 'reset-created-workspace')
})

// Terminal link: a scripted stand-in for the browser WebSocket and the ticket endpoint.
class FakeSocket {
  constructor (url) { this.url = url; this.sent = []; this.readyState = 0; FakeSocket.all.push(this) }
  send (data) { if (this.readyState !== 1) throw new Error('socket not open'); this.sent.push(JSON.parse(data)) }
  close () { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code: 1000 }) }
  open () { this.readyState = 1; this.onopen?.() }
  message (value) { this.onmessage?.({ data: JSON.stringify(value) }) }
  output (text) { this.onmessage?.({ data: new TextEncoder().encode(text).buffer }) }
}
FakeSocket.all = []
const terminalSetup = ({ ticket = async () => ({ ticket: 'a'.repeat(48), expiresIn: 30 }), workspace = null } = {}) => {
  const requests = [], events = [], output = []
  const link = api.createTerminalLink({
    language: 'linux', WebSocketImpl: FakeSocket, size: () => ({ cols: 90, rows: 25 }), workspace: () => workspace,
    request: async (path, options) => { requests.push({ path, ...options }); return ticket(options) },
    socketURL: path => 'wss://api.example' + path,
    onOutput: bytes => output.push(new TextDecoder().decode(bytes)),
    onEvent: event => events.push(event)
  })
  return { link, requests, events, output, socket: () => FakeSocket.all.at(-1) }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
// Values built inside the script's own context have other prototypes; compare their data.
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message)

await check('terminal opens with a one-time ticket, holds early keys until ready and relays output', async () => {
  const app = terminalSetup({ workspace: { id: 'ws-linux', revision: 3 } })
  const before = FakeSocket.all.length
  const connecting = app.link.connect()
  app.link.write('l')
  await connecting
  same(app.requests, [{ path: '/api/terminal/ticket', method: 'POST', body: { language: 'linux', workspaceId: 'ws-linux', cols: 90, rows: 25 } }])
  assert.equal(FakeSocket.all.length, before + 1)
  assert.equal(app.socket().url, 'wss://api.example/api/terminal?ticket=' + 'a'.repeat(48))
  app.link.write('s\r')
  app.socket().open()
  same(app.socket().sent, [], 'nothing is sent before the server says ready')
  app.socket().message({ type: 'ready', workspaceId: 'ws-linux', workspaceRevision: 3 })
  assert.equal(app.link.state(), 'open')
  same(app.socket().sent, [{ type: 'input', data: 'ls\r' }])
  app.socket().output('file.txt\r\n')
  same(app.output, ['file.txt\r\n'])
  app.link.resize(120, 40)
  same(app.socket().sent.at(-1), { type: 'resize', cols: 120, rows: 40 })
})

await check('ending the terminal waits for the server to confirm the save', async () => {
  const app = terminalSetup()
  await app.link.connect(); app.socket().open(); app.socket().message({ type: 'ready', workspaceId: 'w', workspaceRevision: 0 })
  let finished = null
  const ending = app.link.end().then(value => { finished = value })
  same(app.socket().sent.at(-1), { type: 'close' })
  assert.equal(app.link.state(), 'closing')
  await tick(); assert.equal(finished, null)
  app.socket().message({ type: 'saved', committed: true, workspaceId: 'w', workspaceRevision: 1, reason: 'closed' })
  app.socket().close()
  await ending
  assert.equal(finished.workspaceRevision, 1)
  assert.equal(app.link.state(), 'closed')
  assert.ok(!app.events.some(event => event.type === 'lost'))
})

await check('a dropped connection is reported, and the next key reconnects with a new ticket', async () => {
  const app = terminalSetup()
  await app.link.connect(); app.socket().open(); app.socket().message({ type: 'ready', workspaceId: 'w', workspaceRevision: 0 })
  const first = app.socket()
  first.close()
  assert.ok(app.events.some(event => event.type === 'lost'))
  app.link.write('x')
  await tick()
  assert.equal(app.requests.length, 2)
  assert.notEqual(app.socket(), first)
  same(app.socket().sent, [], 'the key that reopens the terminal is not typed into it')
})

await check('an older backend without terminals asks for an update instead of failing silently', async () => {
  const app = terminalSetup({ ticket: async () => { throw Object.assign(new Error('接口不存在。'), { status: 404 }) } })
  await app.link.connect()
  assert.equal(app.link.state(), 'closed')
  assert.match(app.events.find(event => event.type === 'error').message, /更新后端/)
})

await check('ending while the terminal is still opening never leaves a server session unconfirmed', async () => {
  const pending = deferred()
  const app = terminalSetup({ ticket: () => pending.promise })
  const before = FakeSocket.all.length
  const connecting = app.link.connect()
  assert.equal(await app.link.end(), null, 'no socket yet: nothing to save')
  pending.resolve({ ticket: 'b'.repeat(48) }); await connecting
  assert.equal(FakeSocket.all.length, before, 'a late ticket opens nothing')

  const later = terminalSetup()
  await later.link.connect()
  const ending = later.link.end()
  later.socket().open()
  same(later.socket().sent, [{ type: 'close' }], 'close is sent as soon as the socket opens')
  later.socket().message({ type: 'saved', committed: true, workspaceId: 'w', workspaceRevision: 2 })
  later.socket().close()
  assert.equal((await ending).workspaceRevision, 2)
})

await check('the terminal hands its saved workspace revision to the next script run', async () => {
  const { session, calls } = setup({ workspaces: () => ({ workspaces: [{ workspaceId: 'terminal-ws', language: 'linux', revision: 2, updatedAt: '2026-09-26T00:00:00Z', busy: false }] }) })
  session.select('linux')
  assert.equal(await session.restoreWorkspaces(), true)
  assert.equal(session.adoptWorkspace('linux', { workspaceId: 'terminal-ws', workspaceRevision: 4 }), true)
  assert.equal(session.adoptWorkspace('c', { workspaceId: 'x', workspaceRevision: 1 }), false)
  session.edit({ code: 'pwd' })
  await session.run()
  const run = calls.find(call => call.path === '/api/run')
  assert.equal(run.body.workspaceId, 'terminal-ws'); assert.equal(run.body.workspaceRevision, 4)
})

console.log(`\n${count} learning controller behavior checks passed`)
