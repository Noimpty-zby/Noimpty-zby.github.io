/* Run the production functions with isolated model/runner doubles; no paid API calls. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'

const source = readFileSync(new URL('../../../source/js/noimpty-ai.js', import.meta.url), 'utf8')
const section = source.slice(source.indexOf('  const preparePractice ='), source.indexOf('  const agentTool ='))
assert.ok(section.includes('const preparePractice =') && section.includes('const askPractice ='), 'production assistant entry points must remain discoverable')
const exercise = () => ({ title: '求和', statement: '输入两个整数，输出其和，范围在 int64 内。', starterCode: '#include <stdio.h>\nint main(void) {\n    return 0;\n}\n', referenceCode: '#include <stdio.h>\nint main(void) {\n    long long a, b;\n    if (scanf("%lld %lld", &a, &b) != 2) return 1;\n    printf("%lld\\n", a + b);\n    return 0;\n}\n', tests: [{ input: '2 3\n', expectedOutput: '5\n' }, { input: '-4 7\n', expectedOutput: '3\n' }] })
const modelResponse = value => ({ choices: [{ message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 15, completion_tokens: 25 } })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const boot = (options = {}) => {
  const calls = { provider: [], fetch: [], runs: [], notes: [], noteCalls: [], sends: [], messages: [], keyUI: [], opened: 0, usage: [] }
  const context = options.context || { language: 'c', revision: 3, code: 'current code', result: null }
  let turnId = 'prior-turn'
  const window = {
    NANALY_IDENTITY: { prompt: 'Fixture identity' },
    NANALY_PROVIDER: {
      request: args => { calls.provider.push(args); return { url: 'https://model.example.invalid/v1/chat/completions', key: 'fixture-private-key', payload: { messages: args.messages } } },
      responseError: async response => new Error(`provider HTTP ${response.status}`)
    },
    NANALY_AGENT: {
      configured: () => options.connected !== false, context: () => context,
      request: async (path, args) => {
        calls.runs.push({ path, ...args })
        return options.run ? options.run(path, args) : { runId: 'real-fixture-run-id', status: 'accepted', revision: 0, tests: args.body.tests.map(() => ({ status: 'accepted' })) }
      },
      saveNote: async (value, signal) => {
        calls.noteCalls.push({ value, signal })
        if (options.note) return options.note(value, signal, calls)
        signal?.throwIfAborted(); calls.notes.push(value); return value
      }
    }
  }
  const ctx = vm.createContext({
    window, crypto: webcrypto, AbortSignal, AbortController, DOMException, Response,
    canReadPageContext: () => options.unlocked !== false, busy: !!options.busy, view: options.view || 'chat',
    cfg: {}, secrets: options.keys === false ? {} : { apiKey: 'fixture-key' }, PERSONA: 'Fixture fallback persona',
    currentArticle: () => ({ title: '当前文章', text: 'current article body', url: 'https://blog.example.invalid/article/' }),
    addUsage: value => calls.usage.push(value),
    fetch: async (url, args) => { calls.fetch.push({ url, ...args }); if (options.fetch) return options.fetch(url, args); return Response.json(modelResponse(options.exercise || exercise())) },
    openPanel: () => calls.opened++, addMsg: (...args) => calls.messages.push(args), showKeyUI: value => calls.keyUI.push(value),
    chatBridge: { snapshot: () => ({ turnId }) },
    send: async (question, mode, args) => { calls.sends.push({ question, mode, ...args }); if (options.send) await options.send(question, args); turnId = 'next-turn' }
  })
  const api = vm.runInContext(`(() => { ${section}\n return { preparePractice, askPractice }; })()`, ctx)
  return { api, calls, context }
}
let count = 0
const check = async (name, fn) => { await fn(); count++; console.log(`  ✓ ${name}`) }

await check('unsupported language, locked site, offline runner and unavailable model keys reject before paid provider calls', async () => {
  for (const [options, language] of [[{}, 'mysql'], [{ unlocked: false }, 'c'], [{ connected: false }, 'cpp'], [{ keys: false }, 'go'], [{ busy: true }, 'c']]) {
    const app = boot(options); await assert.rejects(app.api.preparePractice({ request: '出题', language }))
    assert.equal(app.calls.provider.length, 0); assert.equal(app.calls.fetch.length, 0); assert.equal(app.calls.runs.length, 0); assert.equal(app.calls.notes.length, 0)
  }
})
await check('already-aborted generation does not contact the provider or save notes', async () => {
  const controller = new AbortController(); controller.abort(new DOMException('Cancelled', 'AbortError'))
  const app = boot(); await assert.rejects(app.api.preparePractice({ language: 'c', signal: controller.signal }), error => error.name === 'AbortError')
  assert.equal(app.calls.provider.length, 0); assert.equal(app.calls.fetch.length, 0); assert.equal(app.calls.notes.length, 0)
})
await check('invalid model JSON and malformed, empty or oversized exercises never reach the runner', async () => {
  const invalid = [null, { ...exercise(), tests: [] }, { ...exercise(), referenceCode: '' }, { ...exercise(), statement: 'x'.repeat(6001) }, { ...exercise(), starterCode: 'x'.repeat(20001) }, { ...exercise(), tests: [{ input: '', expectedOutput: '' }] }, { ...exercise(), tests: [{ input: 'x'.repeat(8193), expectedOutput: '' }, { input: '', expectedOutput: '' }] }]
  for (const value of invalid) {
    const app = boot({ fetch: async () => Response.json(modelResponse(value)) })
    await assert.rejects(app.api.preparePractice({ language: 'c' }))
    assert.equal(app.calls.runs.length, 0); assert.equal(app.calls.notes.length, 0)
  }
  for (const content of ['```json\n{}\n```', '{broken json']) {
    const app = boot({ fetch: async () => Response.json({ choices: [{ message: { content } }] }) })
    await assert.rejects(app.api.preparePractice({ language: 'go' })); assert.equal(app.calls.runs.length, 0)
  }
  const oversized = boot({ fetch: async () => new Response('x'.repeat(200001)) })
  await assert.rejects(oversized.api.preparePractice({ language: 'cpp' }), /过大/); assert.equal(oversized.calls.runs.length, 0)
})
await check('failed, timed-out, incomplete or mismatched reference checks are never saved as verified', async () => {
  const results = [
    { runId: 'failed', status: 'wrong_answer', tests: [{ status: 'accepted' }, { status: 'wrong_answer' }] },
    { runId: 'timed-out', status: 'timeout', tests: [] },
    { runId: 'partial', status: 'accepted', tests: [{ status: 'accepted' }] },
    { status: 'accepted', tests: [{ status: 'accepted' }, { status: 'accepted' }] },
    { runId: 'inconsistent', status: 'accepted', tests: [{ status: 'accepted' }, { status: 'runtime_error' }] }
  ]
  for (const outcome of results) {
    const app = boot({ run: async () => outcome }); await assert.rejects(app.api.preparePractice({ language: 'c' }), /未通过/)
    assert.equal(app.calls.runs.length, 1); assert.equal(app.calls.notes.length, 0)
  }
  const timeout = boot({ run: async () => { throw new DOMException('runner timed out', 'TimeoutError') } })
  await assert.rejects(timeout.api.preparePractice({ language: 'c' }), error => error.name === 'TimeoutError'); assert.equal(timeout.calls.notes.length, 0)
})
await check('only a fully accepted reference returns a verified exercise and keeps native multiline source intact', async () => {
  const app = boot(); const result = await app.api.preparePractice({ request: '练习输入输出', language: 'c' })
  assert.equal(result.verification.status, 'accepted'); assert.equal(result.verification.runId, 'real-fixture-run-id')
  assert.equal(result.referenceCode, exercise().referenceCode); assert.equal(result.starterCode, exercise().starterCode)
  assert.equal(app.calls.runs[0].body.code, exercise().referenceCode); assert.equal(app.calls.runs[0].body.tests[0].input, '2 3\n')
  assert.equal(app.calls.runs[0].path, '/api/run'); assert.equal(app.calls.runs[0].method, 'POST')
  assert.equal(app.calls.notes.length, 1); assert.match(app.calls.notes[0].source, /real-fixture-run-id/)
  assert.equal(app.calls.fetch[0].redirect, 'error'); assert.equal(app.calls.fetch[0].credentials, 'omit')
  assert.equal(app.calls.usage.length, 1)
})
await check('cancellation during a reference run cannot save or return a verified exercise even if the transport returns success', async () => {
  const pending = deferred(); const controller = new AbortController()
  const app = boot({ run: async () => pending.promise })
  const task = app.api.preparePractice({ language: 'c', signal: controller.signal })
  await flush(); assert.equal(app.calls.runs.length, 1)
  controller.abort(new DOMException('Cancelled', 'AbortError'))
  pending.resolve({ runId: 'late-run', status: 'accepted', tests: [{ status: 'accepted' }, { status: 'accepted' }] })
  await assert.rejects(task, error => error.name === 'AbortError'); assert.equal(app.calls.notes.length, 0)
})
await check('note persistence receives the cancellation signal and an abort during saving cannot complete', async () => {
  const controller = new AbortController(); const begun = deferred()
  const app = boot({ note: async (note, signal) => {
    assert.equal(signal, controller.signal, 'note write must carry the original cancellation signal')
    begun.resolve()
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  } })
  const task = app.api.preparePractice({ language: 'c', signal: controller.signal })
  await begun.promise; controller.abort(new DOMException('Cancelled', 'AbortError'))
  await assert.rejects(task, error => error.name === 'AbortError'); assert.equal(app.calls.notes.length, 0)
})
await check('practice questions carry the exact current code version and real result into the chat send boundary', async () => {
  const app = boot(); const context = { language: 'cpp', revision: 17, code: 'line one\nline two', stdin: 'test input', article: { title: '正在阅读的文章', text: '真实正文' }, result: { status: 'wrong_answer', revision: 17, stdout: 'actual' } }
  assert.equal(await app.api.askPractice({ question: '为什么这个用例失败？', context }), true)
  assert.equal(app.calls.sends.length, 1); assert.equal(app.calls.sends[0].practiceContext, context)
  assert.equal(app.calls.sends[0].practiceContext.code, 'line one\nline two'); assert.equal(app.calls.sends[0].practiceContext.result.revision, 17)
  assert.equal(app.calls.sends[0].attachments.length, 0); assert.equal(app.calls.sends[0].files.length, 0)
})
await check('practice questions use active practice fallback and reject locked/busy/missing-key sessions without sending', async () => {
  const app = boot(); assert.equal(await app.api.askPractice({ question: '解释当前练习' }), true); assert.equal(app.calls.sends[0].practiceContext, app.context)
  for (const options of [{ unlocked: false }, { busy: true }, { keys: false }, { view: 'key' }]) {
    const blocked = boot(options); assert.equal(await blocked.api.askPractice({ question: '解释' }), false); assert.equal(blocked.calls.sends.length, 0)
  }
})
console.log(`\n${count} practice assistant behavior checks passed`)
