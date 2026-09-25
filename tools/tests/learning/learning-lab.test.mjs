import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const script = readFileSync(new URL('../../../source/js/learning-lab.js', import.meta.url), 'utf8')
const boot = () => {
  const listeners = []
  const document = { readyState: 'loading', addEventListener: (name, fn) => listeners.push({ name, fn }) }
  const window = { addEventListener: (name, fn) => listeners.push({ name, fn }) }
  vm.runInNewContext(script, { window, document, AbortController, DOMException, URL, console })
  return window.NOIMPTY_LEARNING
}
const api = boot()
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const result = (revision, overrides = {}) => ({ runId: `run-${revision}`, revision, status: 'accepted', stdout: '5\n', stderr: '', diagnostics: [], tests: [], ...overrides })
const storage = () => { const data = new Map(); return { data, getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) } }
const setup = options => {
  const calls = []
  const disk = options?.storage || storage()
  const request = async (path, args) => { calls.push({ path, ...args }); return options?.request ? options.request(path, args) : result(args.body.revision) }
  return { session: api.createSession({ storage: disk, request, ...options, ...(options?.request ? { request } : {}) }), calls, storage: disk }
}
// Execution fixtures are explicit; a real new IDE session always starts blank.
const setupWithCode = options => { const app = setup(options); app.session.edit(api.lessons[0]); return app }
let count = 0
const check = async (name, fn) => { await fn(); count++; console.log(`  ✓ ${name}`) }

await check('six real-language lessons contain executable source and explicit algorithm test cases', () => {
  assert.deepEqual(Array.from(api.lessons, lesson => lesson.language), ['c', 'cpp', 'go', 'git', 'linux', 'mysql'])
  for (const lesson of api.lessons) {
    assert.ok(lesson.code.trim())
    if (['c', 'cpp', 'go'].includes(lesson.language)) assert.ok(lesson.tests.length > 1)
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
await check('editing does not enable automatic checks or send code without the saved opt-in', async () => {
  const { session, calls } = setupWithCode()
  assert.equal(session.state.autoCheck, false); assert.equal(session.canAutoCheck(), false)
  assert.equal(await session.autoCheckCurrent(), null); assert.equal(calls.length, 0)
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
await check('automatic tool checking defaults off and preserves explicit on and off preferences', () => {
  const disk = storage(); const first = setup({ storage: disk })
  assert.equal(first.session.state.autoCheck, false)
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
  for (const language of ['c', 'cpp', 'go', 'git', 'linux']) { session.select(language); session.edit(api.lessons.find(lesson => lesson.language === language)); await session.autoCheckCurrent() }
  assert.equal(calls.length, 5); assert.ok(calls.every(call => call.path === '/api/run' && call.body.mode === 'check' && call.body.tests.length === 0))
  assert.equal(session.state.history.length, 0)
  session.select('mysql'); session.edit({ code: 'SELECT 1;' }); assert.equal(await session.autoCheckCurrent(), null); assert.equal(calls.length, 5)
  session.select('c'); session.setAutoCheck(false); assert.equal(await session.autoCheckCurrent(), null); assert.equal(calls.length, 5)
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
await check('cancellation never claims execution was undone and requires workspace reset', async () => {
  const pending = deferred()
  const { session, calls } = setup({ request: () => pending.promise })
  session.select('git'); session.edit({ code: 'git status' }); const revision = session.state.revision
  const run = session.run(); session.cancel()
  assert.equal(calls[0].signal.aborted, true)
  assert.match(session.state.notice, /服务端可能已执行/)
  assert.equal(await session.run(), null); assert.match(session.state.error, /先重置/)
  pending.resolve(result(revision, { workspaceId: 'old', workspaceRevision: 1 })); await run
  assert.equal(session.state.history.length, 0); assert.equal(session.state.result, null)
})
await check('workspace revision is carried across successful runs and reset preserves code/history', async () => {
  let revision = 0
  const { session, calls } = setup({ request: async (path, args) => path === '/api/workspaces/reset' ? { workspaceId: 'fresh', revision: 0 } : result(args.body.revision, { workspaceId: 'git-space', workspaceRevision: ++revision, workspaceSummary: '## main' }) })
  session.select('git'); session.edit({ code: 'git init' }); await session.run(); session.edit({ code: 'git status' }); await session.run()
  assert.equal(calls[1].body.workspaceId, 'git-space'); assert.equal(calls[1].body.workspaceRevision, 1)
  const code = session.state.code; await session.reset()
  assert.equal(session.state.code, code); assert.equal(session.state.history.length, 2); assert.equal(session.state.result, null)
  assert.equal(session.state.workspaces.git.id, 'fresh'); assert.equal(session.state.workspaces.git.revision, 0)
})
await check('an interrupted workspace reset cannot lock the UI or overwrite a later reset', async () => {
  const pending = deferred(); let resets = 0
  const { session, calls } = setup({ request: async () => ++resets === 1 ? pending.promise : { workspaceId: 'newer-reset', revision: 0 } })
  session.select('linux'); const first = session.reset(); session.cancel()
  assert.equal(calls[0].signal.aborted, true); assert.equal(session.state.busy, false)
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
  const { session, calls } = setup({ request: async path => path.startsWith('/api/runs?') ? { runs: [remote] } : { workspaceId: 'remote-git', language: 'git', revision: 9, busy: false } })
  await session.syncHistory(); await session.syncHistory()
  assert.equal(session.state.history.length, 1); assert.equal(session.state.history[0].tests[0].input, 'cloud input')
  assert.equal(session.state.workspaces.git.revision, 9); assert.equal(session.restore('cloud-run'), true)
  assert.equal(session.state.code, 'git status'); assert.equal(session.state.result, null)
  assert.ok(calls.some(call => call.path === '/api/workspaces/remote-git'))
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
console.log(`\n${count} learning controller behavior checks passed`)
