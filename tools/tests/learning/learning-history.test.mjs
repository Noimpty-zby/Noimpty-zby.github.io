import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'

const script = readFileSync(new URL('../../../source/js/learning-history.js', import.meta.url), 'utf8')
const fsrs = readFileSync(new URL('../../../source/js/review-fsrs.js', import.meta.url), 'utf8')
function boot(database = new IDBFactory()) {
  let allowed = true
  const events = [], window = {
    indexedDB: database, crypto: webcrypto, location: { origin: 'https://blog.test' },
    NOIMPTY_GATE: { unlocked: () => allowed }, dispatchEvent: event => events.push(event.type)
  }
  const document = { documentElement: { classList: { contains: () => false } } }
  const ctx = vm.createContext({ window, document, URL, CustomEvent, setTimeout, clearTimeout })
  vm.runInContext(fsrs, ctx); vm.runInContext(script, ctx)
  return { api: window.NOIMPTY_LEARNING_HISTORY, events, lock: () => { allowed = false } }
}
const copy = value => JSON.parse(JSON.stringify(value))
const attempt = (id = 'attempt-1', status = 'runtime_error') => ({
  id, at: '2026-10-01T10:00:00.000Z', language: 'python', code: 'print(1/0)', stdin: '4\n',
  problem: '读入一个整数，计算其倒数', source: { title: '循环与条件', url: '/posts/loops/' },
  tests: [{ input: '4\n', expectedOutput: '0.25\n' }], explanation: '忘了处理零',
  result: { runId: 'server-' + id, status, stdout: '', stderr: status === 'accepted' ? '' : 'ZeroDivisionError', exitCode: status === 'accepted' ? 0 : 1, tests: status === 'accepted' ? [{ status: 'accepted', input: '4\n', expectedOutput: '0.25\n', stdout: '0.25\n', stderr: '' }] : [] }
})

await test('a real failed attempt preserves exact inputs, source, result and explanation across reload', async () => {
  const database = new IDBFactory(), a = boot(database)
  const item = await a.api.saveFailure(attempt())
  const b = boot(database), loaded = await b.api.get(item.id)
  assert.equal(loaded.attempts[0].code, 'print(1/0)')
  assert.equal(loaded.attempts[0].stdin, '4\n')
  assert.equal(loaded.attempts[0].result.stderr, 'ZeroDivisionError')
  assert.equal(loaded.attempts[0].source.url, '/posts/loops/')
  assert.equal(loaded.attempts[0].tests[0].expectedOutput, '0.25\n')
  assert.equal(loaded.attempts[0].explanation, '忘了处理零')
  const summary = await b.api.summary()
  assert.equal(summary.cases, 1); assert.equal(summary.due, 1)
  assert.doesNotMatch(JSON.stringify(summary), /print|ZeroDivisionError|loops|倒数/)
})

await test('only completed failed runs can start a case, never syntax-check success or missing evidence', async () => {
  const { api } = boot()
  await assert.rejects(api.saveFailure(attempt('ok', 'accepted')), /真实失败/)
  await assert.rejects(api.saveFailure(attempt('check', 'checked')), /真实运行/)
  await assert.rejects(api.saveFailure({ ...attempt(), result: { status: 'runtime_error' } }))
  assert.equal((await api.list()).length, 0)
})

await test('new attempts retain the failure and require new real execution before one FSRS review', async () => {
  const { api } = boot(), item = await api.saveFailure(attempt())
  await assert.rejects(api.rate(item.id, 'attempt-1', 4), /新的重做/)
  await api.addAttempt(item.id, { ...attempt('attempt-2', 'accepted'), code: 'print(0.25)', explanation: '先排除零输入' })
  await api.rate(item.id, 'attempt-2', 4)
  await assert.rejects(api.rate(item.id, 'attempt-2', 4), /已经评分/)
  const [value] = await api.list()
  assert.equal(value.attempts.length, 2); assert.equal(value.solved, true)
  assert.ok(Date.parse(value.due) > Date.now())
  assert.equal(value.attempts[0].code, 'print(1/0)')
})

await test('independent tabs append atomically and concurrent ratings of the same attempt commit once', async () => {
  const database = new IDBFactory(), a = boot(database), b = boot(database)
  const item = await a.api.saveFailure(attempt())
  await Promise.all([a.api.addAttempt(item.id, attempt('a')), b.api.addAttempt(item.id, attempt('b', 'accepted'))])
  assert.equal((await a.api.get(item.id)).attempts.length, 3)
  const results = await Promise.allSettled([a.api.rate(item.id, 'b', 3), b.api.rate(item.id, 'b', 4)])
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1)
  assert.equal((await a.api.get(item.id)).reviews.length, 1)
})

await test('backup import merges and is idempotent without clearing prior cases or teaching notes', async () => {
  const a = boot(), b = boot()
  const first = await a.api.saveFailure(attempt('original'))
  await a.api.addAttempt(first.id, attempt('fix', 'accepted')); await a.api.rate(first.id, 'fix', 3)
  await a.api.recordExplanation({ confirmed: true, topic: '循环', source: { title: '循环', url: '/loops/' }, explanation: '循环会反复执行', feedback: '还需说明终止条件', reviewQuestions: ['怎样终止？'] })
  const old = await b.api.saveFailure(attempt('existing'))
  const backup = copy(await a.api.exportData())
  await b.api.importData(backup); await b.api.importData(backup)
  assert.equal((await b.api.list()).length, 2); assert.ok(await b.api.get(old.id))
  assert.equal((await b.api.listExplanations()).length, 1)
  assert.equal((await b.api.get(first.id)).reviews.length, 1)
})

await test('conflicting or damaged import rolls back every store and does not replace saved evidence', async () => {
  const { api } = boot(), item = await api.saveFailure(attempt())
  const before = copy(await api.exportData()), incoming = copy(before)
  incoming.cases.unshift({ ...copy(item), id: 'case:new', attempts: [attempt('new')] })
  incoming.cases[1].attempts[0].code = 'overwritten'
  await assert.rejects(api.importData(incoming), /不一致/)
  const after = copy(await api.exportData())
  assert.deepEqual(after.cases, before.cases)
  const malformed = copy(before); malformed.cases[0].attempts[0].result = null
  await assert.rejects(api.importData(malformed))
  assert.equal((await api.list()).length, 1)
})

await test('quota failure is reported only after abort and leaves the original record intact', async () => {
  const { api } = boot(), item = await api.saveFailure(attempt())
  const put = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function () { throw new DOMException('quota', 'QuotaExceededError') }
  try { await assert.rejects(api.addAttempt(item.id, attempt('new')), /quota/) }
  finally { IDBObjectStore.prototype.put = put }
  assert.equal((await api.get(item.id)).attempts.length, 1)
})

await test('locked access never reads or writes private code and summaries stay empty', async () => {
  const h = boot(); await h.api.saveFailure(attempt()); h.lock()
  assert.equal(await h.api.summary(), null)
  await assert.rejects(h.api.get('case:attempt-1'), /解锁/)
  await assert.rejects(h.api.saveFailure(attempt('new')), /解锁/)
  await assert.rejects(h.api.exportData(), /解锁/)
})

await test('teaching notes need explicit confirmation and reject off-site source links', async () => {
  const { api } = boot()
  const value = { topic: '循环', explanation: '自己的理解', feedback: '反馈', reviewQuestions: ['终止条件是什么？'], source: { title: '文章', url: '/loops/' } }
  await assert.rejects(api.recordExplanation(value), /确认/)
  assert.throws(() => api.recordExplanation({ ...value, confirmed: true, source: { title: '外部', url: 'https://evil.test/' } }), /本站/)
  const note = await api.recordExplanation({ ...value, confirmed: true })
  assert.equal((await api.getExplanation(note.id)).explanation, value.explanation)
})

await test('a confirmed new explanation resolves the earlier queue item without deleting its history', async () => {
  const { api } = boot()
  const first = await api.recordExplanation({ confirmed: true, topic: '循环', explanation: '还不完整', feedback: '再想终止条件', reviewQuestions: ['怎样终止？'] })
  assert.equal((await api.summary()).dueExplanations, 1)
  const next = await api.recordExplanation({ confirmed: true, revises: first.id, topic: '循环', explanation: '有界计数或条件变化令循环终止', feedback: '讲清楚了', reviewQuestions: [] })
  assert.equal((await api.summary()).dueExplanations, 0)
  assert.equal((await api.listExplanations()).length, 2)
  assert.equal((await api.getExplanation(next.id)).revises, first.id)
})

await test('an unsuccessful redo cannot be scheduled as mastered', async () => {
  const { api } = boot(), item = await api.saveFailure(attempt())
  await api.addAttempt(item.id, attempt('again'))
  await assert.rejects(api.rate(item.id, 'again', 4), /尚未通过/)
  await api.rate(item.id, 'again', 1)
  assert.equal((await api.get(item.id)).reviews[0].rating, 1)
})

await test('exit zero or a different test set cannot mark a saved wrong-answer case solved', async () => {
  const { api } = boot(), item = await api.saveFailure(attempt('wrong', 'wrong_answer'))
  const terminal = { ...attempt('terminal', 'accepted'), tests: [], result: { ...attempt('terminal', 'accepted').result, evidence: 'terminal', tests: [] } }
  await api.addAttempt(item.id, terminal)
  await assert.rejects(api.rate(item.id, 'terminal', 4), /原题全部测试/)
  assert.equal((await api.list())[0].solved, false)
  const unchecked = attempt('unchecked', 'accepted'); unchecked.result.tests = []
  await api.addAttempt(item.id, unchecked)
  await assert.rejects(api.rate(item.id, 'unchecked', 3), /原题全部测试/)
  const changed = attempt('changed', 'accepted'); changed.result.tests[0].expectedOutput = 'different'
  await api.addAttempt(item.id, changed)
  await assert.rejects(api.rate(item.id, 'changed', 3), /原题全部测试/)
  await api.addAttempt(item.id, attempt('verified', 'accepted'))
  await api.rate(item.id, 'verified', 3)
  assert.equal((await api.list())[0].solved, true)
})
