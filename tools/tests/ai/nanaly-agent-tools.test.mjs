import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../../../source/js/noimpty-ai.js', import.meta.url), 'utf8')
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from)
  return source.slice(from, to)
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const boot = ({ fetcher, saveNote } = {}) => {
  const context = {
    window: {
      NANALY_PROVIDER: { request: () => ({ url: 'https://model.invalid/chat/completions', key: 'fixture', payload: {} }), responseError: async () => new Error('provider failed') },
      NANALY_AGENT: { context: () => null, saveNote: saveNote || (async value => value) }
    },
    cfg: {}, secrets: { apiKey: 'fixture', tavilyKey: 'fixture-search' }, PERSONA: 'fixture', busy: false,
    canReadPageContext: () => true, addUsage() {}, isRecord: value => value && typeof value === 'object',
    fetch: fetcher || (async () => Response.json({ choices: [{ message: { content: 'review result' } }] })),
    AbortSignal, AbortController, DOMException
  }
  const code = section('  const abortable =', '  const chatBridge =')
  // Include just the shared await helper, not the UI bridge following it.
  const helper = code.slice(0, code.indexOf('\n  const ', 1) < 0 ? code.length : code.indexOf('\n  const ', 1))
  return vm.runInNewContext(helper + '\n' + section('  const searchWeb =', '  // ---------------- 长期记忆') + '\n' +
    section('  const agentTool =', '  const taskSummary =') + '\nagentTool', context)
}

test('stopping a goal search aborts its real network request', async () => {
  const controller = new AbortController(), started = deferred()
  let requestSignal
  const tool = boot({ fetcher: async (_url, init) => {
    requestSignal = init.signal; started.resolve()
    return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
  } })
  const pending = tool({ tool: 'search_web', input: 'query', signal: controller.signal })
  await started.promise
  controller.abort(new DOMException('goal stopped', 'AbortError'))
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(requestSignal?.aborted, true, 'the request itself must stop, not only the UI wait')
})

test('stopping while review note is queued prevents the later write', async () => {
  const controller = new AbortController(), started = deferred(), release = deferred(), writes = []
  const tool = boot({ saveNote: async (value, signal) => {
    started.resolve(); await release.promise
    signal?.throwIfAborted(); writes.push(value); return value
  } })
  const pending = tool({ tool: 'review', input: 'summarize', stepId: 'fixture-step', signal: controller.signal })
  await started.promise
  controller.abort(new DOMException('goal stopped', 'AbortError')); release.resolve()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(writes.length, 0)
})

test('a completed review preserves the saved note identifier and text', async () => {
  const tool = boot()
  const result = await tool({ tool: 'review', input: 'summarize', stepId: 'fixture-step' })
  assert.equal(result.noteId, 'review-fixture-step'); assert.equal(result.text, 'review result')
})
