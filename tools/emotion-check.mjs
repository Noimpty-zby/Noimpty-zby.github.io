/*
 * Default: node tools/emotion-check.mjs
 *   Validates fixtures and the real planner's input/output structure OFFLINE.
 *
 * Opt-in paid semantic evaluation (does not synthesize or play any audio):
 *   NANALY_EMOTION_EVAL_KEY=... NANALY_EMOTION_EVAL_BASE_URL=https://api.siliconflow.cn/v1 \
 *     node tools/emotion-check.mjs --live --limit=3
 * Optional: NANALY_EMOTION_EVAL_MODEL, --case=genuine-success-joy
 *
 * No .env files, browser profiles, vaults, or generic API_KEY variables are read.
 * This filename intentionally does NOT end in .test.mjs: npm test cannot invoke
 * live evaluation, even when an evaluation key exists in the environment.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const argv = process.argv.slice(2)
if (argv.includes('--help')) {
  console.log('Offline: node tools/emotion-check.mjs\nPaid opt-in: --live [--limit=N] [--case=ID]\nLive requires NANALY_EMOTION_EVAL_KEY and NANALY_EMOTION_EVAL_BASE_URL; optional NANALY_EMOTION_EVAL_MODEL.\nSemantic labels are checked; audio quality requires a separate listening review.')
  process.exit(0)
}
assert.ok(argv.every(arg => arg === '--live' || /^--(?:limit=[1-9]\d*|case=[a-z0-9-]+)$/.test(arg)), 'Unsupported evaluation argument; use --help')
for (const flag of ['--live', '--limit=', '--case=']) assert.ok(argv.filter(arg => arg.startsWith(flag)).length <= 1, 'Repeated evaluation argument: ' + flag)
const live = argv.includes('--live')
const dataset = JSON.parse(readFileSync(new URL('./fixtures/nanaly-emotion-cases.json', import.meta.url), 'utf8'))
assert.equal(dataset.version, 1)
assert.ok(typeof dataset.purpose === 'string' && dataset.purpose.length > 20)
assert.ok(Array.isArray(dataset.labels) && dataset.labels.length >= 8)
const labels = new Set(dataset.labels), ids = new Set(), categories = new Set()
assert.equal(labels.size, dataset.labels.length)
assert.ok(Array.isArray(dataset.cases) && dataset.cases.length >= 20)
for (const item of dataset.cases) {
  assert.match(item.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  assert.ok(!ids.has(item.id), 'Duplicate case: ' + item.id); ids.add(item.id)
  assert.ok(typeof item.text === 'string' && item.text.trim() && item.text.length <= 16000, item.id + ': invalid text')
  assert.ok(typeof item.note === 'string' && item.note.trim(), item.id + ': rationale required')
  assert.ok(Array.isArray(item.categories) && item.categories.length > 0)
  item.categories.forEach(category => { assert.equal(typeof category, 'string'); categories.add(category) })
  assert.ok(Array.isArray(item.expect) && item.expect.length > 0)
  for (const expected of item.expect) {
    assert.ok(typeof expected.anchor === 'string' && expected.anchor.length >= 2 && item.text.includes(expected.anchor), item.id + ': anchor absent from source')
    assert.ok(item.text.indexOf(expected.anchor) === item.text.lastIndexOf(expected.anchor), item.id + ': anchor must be unique')
    assert.ok(Array.isArray(expected.allow) && expected.allow.length > 0 && expected.allow.every(label => labels.has(label)), item.id + ': unknown expected label')
    const min = expected.minIntensity ?? 0, max = expected.maxIntensity ?? 1
    assert.ok(Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max <= 1 && min <= max, item.id + ': invalid intensity bounds')
  }
  for (const key of ['notSpoken', 'mustSpeak']) if (item[key]) {
    assert.ok(Array.isArray(item[key]) && item[key].every(text => typeof text === 'string' && text && item.text.includes(text)), item.id + ': invalid ' + key)
  }
}
for (const category of ['否定', '引用', '第三人称', '真实高兴', '忧伤安慰', '反讽', '严肃技术', '好奇', '惊讶', '害羞傲娇', '舞台动作', '句间转折']) assert.ok(categories.has(category), 'Missing required coverage: ' + category)

// Reuse the production preparation, prompt and parser instead of maintaining a
// second prompt that could pass while the real browser planner behaves differently.
const window = {}
vm.runInNewContext(readFileSync(new URL('../source/js/nanaly-prosody.js', import.meta.url), 'utf8'), { window, URL, AbortController, DOMException, setTimeout, clearTimeout })
const planner = window.NANALY_PROSODY
assert.ok(planner && typeof planner.prepare === 'function' && typeof planner.parse === 'function')
assert.deepEqual([...planner.EMOTIONS].sort(), [...labels].sort(), 'Fixture labels must match the production planner')
const preparedById = new Map()
for (const item of dataset.cases) {
  const prepared = planner.prepare(item.text, { context: item.context || '' })
  assert.ok(prepared.spokenText && Array.isArray(prepared.segments) && prepared.segments.length > 0, item.id + ': no speakable segments')
  assert.ok(Array.isArray(prepared.messages) && prepared.messages.some(message => message.role === 'system'), item.id + ': production prompt missing')
  for (const expected of item.expect) assert.ok(prepared.spokenText.includes(expected.anchor), item.id + ': speech preparation lost expected anchor ' + expected.anchor)
  for (const phrase of item.notSpoken || []) assert.ok(!prepared.spokenText.includes(phrase), item.id + ': stage direction would be spoken: ' + phrase)
  for (const phrase of item.mustSpeak || []) assert.ok(prepared.spokenText.includes(phrase), item.id + ': required expression was removed: ' + phrase)
  const structural = planner.parse(JSON.stringify({ ranges: [{ from: 0, to: prepared.segments.length, emotion: 'neutral', intensity: 0, confidence: 1 }] }), prepared)
  assert.equal(structural.segments.map(segment => segment.text).join(''), prepared.segments.map(segment => segment.text).join(''), item.id + ': parser changed original speech')
  preparedById.set(item.id, prepared)
}

let selected = dataset.cases
const caseId = argv.find(arg => arg.startsWith('--case='))?.slice('--case='.length)
if (caseId) { assert.ok(ids.has(caseId), 'Unknown evaluation case: ' + caseId); selected = selected.filter(item => item.id === caseId) }
const limit = Number(argv.find(arg => arg.startsWith('--limit='))?.slice('--limit='.length) || selected.length)
selected = selected.slice(0, limit)
if (!live) {
  console.log(`${dataset.cases.length} emotion fixtures and production planner contracts verified offline; 0 network requests. Semantic accuracy and audible emotion were NOT evaluated.`)
  process.exit(0)
}

// Credentials are read only after the explicit --live boundary.
const key = process.env.NANALY_EMOTION_EVAL_KEY
const base = process.env.NANALY_EMOTION_EVAL_BASE_URL
assert.ok(key && base, '--live requires explicit NANALY_EMOTION_EVAL_KEY and NANALY_EMOTION_EVAL_BASE_URL')
const endpoint = new URL(base)
assert.ok(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash, 'Evaluation base URL cannot contain credentials, query or fragment')
assert.ok(endpoint.protocol === 'https:' || endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname), 'Evaluation base URL must use HTTPS except localhost')
endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') + '/chat/completions'
const model = process.env.NANALY_EMOTION_EVAL_MODEL || 'Pro/moonshotai/Kimi-K2.6'
let passed = 0, promptTokens = 0, completionTokens = 0
console.log(`LIVE semantic evaluation: ${selected.length} requests maximum, model=${model}; no TTS calls. API usage may be billed.`)
for (const item of selected) {
  const prepared = preparedById.get(item.id)
  try {
    const payload = { model, messages: prepared.messages, stream: false, temperature: 0, max_tokens: 4096 }
    // Match production: prompt JSON + strict parser. SiliconFlow's JSON-mode
    // guide excludes VL models, so Kimi's response_format support is not assumed.
    if (['api.siliconflow.cn', 'api-st.siliconflow.cn'].includes(endpoint.hostname)) payload.enable_thinking = false
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error('API HTTP ' + response.status)
    const body = await response.json()
    promptTokens += Number(body.usage?.prompt_tokens) || 0; completionTokens += Number(body.usage?.completion_tokens) || 0
    const choice = body.choices?.[0]
    if (choice?.finish_reason === 'length') throw new Error('Planner JSON was truncated by the model')
    if (typeof choice?.message?.content !== 'string') throw new Error('Planner response had no text content')
    const plan = planner.parse(choice.message.content, prepared)
    const issues = []
    for (const expected of item.expect) {
      const start = prepared.spokenText.indexOf(expected.anchor), end = start + expected.anchor.length
      const matching = plan.segments.filter(segment => segment.start < end && segment.end > start)
      if (!matching.length) { issues.push({ anchor: expected.anchor, error: 'No segment covers the expected phrase' }); continue }
      for (const segment of matching) {
        if (!expected.allow.includes(segment.emotion)) issues.push({ anchor: expected.anchor, actual: segment.emotion, allowed: expected.allow, confidence: segment.confidence })
        const min = expected.minIntensity ?? 0, max = expected.maxIntensity ?? 1
        if (segment.intensity < min || segment.intensity > max) issues.push({ anchor: expected.anchor, intensity: segment.intensity, allowedIntensity: [min, max] })
      }
    }
    if (!issues.length) passed++
    console.log(JSON.stringify({ id: item.id, passed: !issues.length, issues,
      segments: plan.segments.map(({ index, emotion, intensity, confidence }) => ({ index, emotion, intensity, confidence })) }))
  } catch (error) {
    // Never dump request headers, the raw server error body, or key values.
    console.log(JSON.stringify({ id: item.id, passed: false, error: error?.name === 'TimeoutError' ? 'Planner request timed out' : String(error?.message || 'Planner evaluation failed').replaceAll(key, '[REDACTED]').slice(0, 240) }))
  }
}
console.log(JSON.stringify({ mode: 'live-semantic-only', passed, total: selected.length, promptTokens, completionTokens, listeningReviewRequired: true }))
if (passed !== selected.length) process.exitCode = 1
