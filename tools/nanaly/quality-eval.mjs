#!/usr/bin/env node
// Offline contract checks by default. --live makes at most six synthetic requests.
import { createRequire } from 'node:module'
import { writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const require = createRequire(import.meta.url)
const identity = require('../../source/js/nanaly-identity.js')
const knowledge = require('../../source/js/nanaly-knowledge.js')
const project = fileURLToPath(new URL('../../', import.meta.url))

export async function evaluate({ live = false, limit = 6, env = process.env, request = fetch } = {}) {
  const count = Math.max(1, Math.min(6, Math.floor(limit) || 6))
  if (!live) {
    const checks = [
      { name: 'shared identity', ok: identity.version >= 2 && identity.prompt.includes('以本轮实际结果为准') },
      ...knowledge.facts.map(fact => ({ name: 'source:' + fact.id, ok: existsSync(resolve(project, fact.source)) })),
      { name: 'case coverage', ok: new Set(knowledge.cases.map(c => c.id)).size === 6 },
      { name: 'human review required', ok: knowledge.cases.every(c => knowledge.assess(c, '').needsHumanReview) }
    ]
    return { kind: 'offline-contract', modelRequests: 0, note: '仅验证代码、来源与评测契约；未调用模型，不能据此判断真实推理质量。', checks }
  }
  const key = env.DEEPSEEK_API_KEY
  if (!key) return { kind: 'live-model', status: 'not-run', modelRequests: 0, reason: '没有配置专用 DEEPSEEK_API_KEY；没有读取其他凭据。' }
  const base = new URL(env.DEEPSEEK_API_BASE || 'https://api.deepseek.com')
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('评测接口必须是无凭据参数的 HTTPS 地址')
  const results = []
  for (const sample of knowledge.cases.slice(0, count)) {
    const model = sample.deep ? (env.DEEPSEEK_PRO_MODEL || 'deepseek-v4-pro') : (env.DEEPSEEK_MODEL || 'deepseek-v4-flash')
    const question = sample.messages.at(-1).content
    const messages = [{ role: 'system', content: identity.prompt + '\n' + knowledge.prompt(question, { examples: false }) },
      ...(sample.context ? [{ role: 'system', content: sample.context }] : []), ...sample.messages]
    const payload = { model, messages, stream: false, max_tokens: sample.deep ? 4096 : 1536 }
    if (base.hostname === 'api.deepseek.com') {
      payload.thinking = { type: sample.deep ? 'enabled' : 'disabled' }
      if (sample.deep) payload.reasoning_effort = 'high'
      else payload.temperature = 0.7
    }
    const started = Date.now()
    try {
      const response = await request(base.href.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(60000), redirect: 'error', credentials: 'omit'
      })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const data = await response.json(), choice = data.choices?.[0], answer = String(choice?.message?.content || '')
      results.push({ id: sample.id, title: sample.title, model, answer, elapsedMs: Date.now() - started,
        usage: data.usage || null, incomplete: choice?.finish_reason === 'length', ...knowledge.assess(sample, answer) })
    } catch (error) {
      // Never print provider bodies or request headers, which can contain secrets.
      results.push({ id: sample.id, title: sample.title, model, error: /^HTTP \d+$/.test(error.message) ? error.message : '请求失败或超过60秒', needsHumanReview: true })
      break
    }
  }
  return { kind: 'live-model', modelRequests: results.length, maximumOutputTokens: 14336,
    note: '真实配置模型的合成案例输出；规则只作筛查，逐题人工复核后才判断质量。不是微调或模型能力等同证明。', results }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const report = await evaluate({ live: args.includes('--live'), limit: Number(args[args.indexOf('--limit') + 1]) || 6 })
  const output = JSON.stringify(report, null, 2) + '\n'
  const destination = args.includes('--out') ? args[args.indexOf('--out') + 1] : ''
  if (destination) writeFileSync(destination, output, { mode: 0o600 })
  else process.stdout.write(output)
  if (report.checks?.some(check => !check.ok) || report.results?.some(result => result.error)) process.exitCode = 1
}
