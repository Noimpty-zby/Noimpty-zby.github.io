/* 娜娜莉的知识库（nanaly-knowledge.js）和命令行能力自检（tools/nanaly/quality-eval.mjs）。
 * 原来和「讲给我听」的测试放在一起，那个功能 2026-10-02 删了，这几条单独留下来。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { evaluate } from '../../nanaly/quality-eval.mjs'
const require = createRequire(import.meta.url)
const knowledge = require('../../../source/js/nanaly-knowledge.js')
const identity = require('../../../source/js/nanaly-identity.js')

await test('knowledge is public, traceable and the six rubrics cover actual reported weaknesses', async () => {
  assert.equal(identity.version, 3)
  assert.deepEqual(knowledge.cases.map(c => c.id), ['natural', 'reference', 'counterexample', 'source', 'execution', 'attachment'])
  assert.equal(knowledge.intent('矩阵转置为什么成立').reasoning, true)
  assert.equal(knowledge.intent('你好').inventory, false)
  const report = await evaluate()
  assert.equal(report.kind, 'offline-contract')
  assert.equal(report.modelRequests, 0)
  assert.ok(report.checks.every(item => item.ok))
  // 猫娘口吻本身不扣分，只有「喵」塞得太满才提醒人工看一眼
  assert.equal(knowledge.assess(knowledge.cases[0], '[伸了个懒腰] 那就先歇一会儿喵 (ovo)').warnings.length, 0)
  assert.equal(knowledge.assess(knowledge.cases[0], '喵～歇会儿喵，喝口水喵').warnings.length > 0, true)
})

await test('live evaluator requires dedicated key and bounds calls without logging credentials', async () => {
  let calls = 0
  const absent = await evaluate({ live: true, env: {}, request: () => { calls++; throw new Error('should not run') } })
  assert.equal(absent.status, 'not-run'); assert.equal(calls, 0)
  const report = await evaluate({ live: true, limit: 1, env: { DEEPSEEK_API_KEY: 'offline-placeholder' }, request: async (url, options) => {
    calls++; assert.equal(url, 'https://api.deepseek.com/chat/completions')
    const payload = JSON.parse(options.body)
    assert.equal(payload.max_tokens, 1536)
    assert.ok(!options.body.includes('offline-placeholder'))
    return new Response(JSON.stringify({ choices: [{ message: { content: '先休息一下。' }, finish_reason: 'stop' }], usage: { completion_tokens: 8 } }))
  } })
  assert.equal(calls, 1)
  assert.equal(report.kind, 'live-model')
  assert.equal(report.results[0].needsHumanReview, true)
  assert.ok(!JSON.stringify(report).includes('offline-placeholder'))
})

await test('live quality prompts do not contain the worked answers from teaching examples', async () => {
  const payloads = []
  await evaluate({ live: true, limit: 3, env: { DEEPSEEK_API_KEY: 'offline-only' }, request: async (url, options) => {
    payloads.push(JSON.parse(options.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: '评测输出占位' } }] }))
  } })
  const system = payloads[2].messages.filter(m => m.role === 'system').map(m => m.content).join('\n')
  assert.doesNotMatch(system, /表达示例|i = 0 且 n > 0/)
  assert.match(payloads[2].messages.at(-1).content, /i \*= 2/)
})
