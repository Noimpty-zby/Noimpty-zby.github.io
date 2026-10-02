import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const { arrayFrames, arrayCode, gitInitial, gitHead, gitStep, gitCode, barycentric, barycentricCode, TRIANGLE } = require('../../../source/js/learning-experiments.js')
const python = code => execFileSync('python3', ['-c', code], { encoding: 'utf8', timeout: 5000 })
const lastJSON = text => JSON.parse(text.trim().split('\n').at(-1))

await test('array movement is lossless at every insertion/deletion index and matches executable Python', () => {
  for (const values of [[], [7], [10, 20, 30, 40, 50], [1, 2, 3, 4, 5, 6, 7]]) {
    for (const operation of ['insert', 'delete']) for (let index = 0; index < values.length + (operation === 'insert' ? 1 : 0); index++) {
      const config = { values, operation, index, value: 99 }, before = values.slice()
      const frames = arrayFrames(config), last = frames.at(-1), expected = values.slice()
      expected.splice(index, operation === 'delete' ? 1 : 0, ...(operation === 'insert' ? [99] : []))
      assert.deepEqual(last.slots.slice(0, last.length), expected)
      assert.deepEqual(values, before, 'the input array remains unchanged')
      assert.equal(last.moves, values.length - index - (operation === 'delete' ? 1 : 0))
      const moves = frames.filter(frame => frame.to !== null && frame.from !== null)
      assert.ok(moves.every(frame => frame.to - frame.from === (operation === 'insert' ? 1 : -1)))
      const executed = lastJSON(python(arrayCode(config) + 'import json\nprint(json.dumps({"values": A[:length], "moves": moves}))\n'))
      assert.deepEqual(executed, { values: expected, moves: last.moves })
    }
  }
})

await test('array bounds reject invalid operations and deletion preserves the old physical tail', () => {
  assert.throws(() => arrayFrames({ values: Array(8).fill(1), operation: 'insert', index: 8, value: 2 }), /容量已满/)
  assert.throws(() => arrayFrames({ values: [], operation: 'delete', index: 0 }), /空数组/)
  for (const index of [-1, 2, 0.5, NaN]) assert.throws(() => arrayFrames({ values: [1], operation: 'insert', index, value: 2 }))
  const final = arrayFrames({ values: [1, 2, 3], operation: 'delete', index: 0 }).at(-1)
  assert.deepEqual(final.slots.slice(0, 3), [2, 3, 3]); assert.equal(final.length, 2)
})

await test('Git branches share commits, only the current reference advances, and detached commits survive switching away', () => {
  const initial = gitInitial()
  let state = gitStep(initial, { type: 'branch', name: 'feature' })
  assert.equal(state.commits.length, 1); assert.equal(state.head, 'main'); assert.deepEqual(initial.branches, { main: 'C0' })
  state = gitStep(state, { type: 'switch', name: 'feature' })
  state = gitStep(state, { type: 'commit' })
  assert.deepEqual(state.branches, { main: 'C0', feature: 'C1' })
  state = gitStep(state, { type: 'switch', name: 'main' })
  state = gitStep(state, { type: 'commit' })
  state = gitStep(state, { type: 'detach', name: 'C1' })
  state = gitStep(state, { type: 'commit' })
  assert.equal(gitHead(state), 'C3'); assert.deepEqual(state.branches, { main: 'C2', feature: 'C1' })
  state = gitStep(state, { type: 'switch', name: 'main' })
  assert.equal(gitHead(state), 'C2'); assert.equal(state.commits[3].parent, 'C1')
  const dir = mkdtempSync(join(tmpdir(), 'blog-experiment-git-'))
  try {
    const output = execFileSync('bash', ['-c', gitCode(state)], { encoding: 'utf8', timeout: 10000, env: { ...process.env, TMPDIR: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: ['ignore', 'pipe', 'pipe'] })
    assert.match(output, /HEAD: main/); assert.match(output, /feature -> C1/); assert.match(output, /main -> C2/); assert.match(output, /C3/)
    const repo = join(dir, readdirSync(dir)[0])
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
    assert.equal(git('log', '-1', '--format=%s', 'feature'), 'C1')
    assert.equal(git('log', '-1', '--format=%s', 'main^'), 'C0')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

await test('Git model blocks ambiguous, duplicate, unsafe or nonexistent references', () => {
  for (const name of ['HEAD', '-bad', 'x;rm', 'x/y', 'main', 'a'.repeat(21), '__proto__']) assert.throws(() => gitStep(gitInitial(), { type: 'branch', name }))
  assert.throws(() => gitStep(gitInitial(), { type: 'switch', name: 'constructor' }))
  assert.throws(() => gitStep(gitInitial(), { type: 'detach', name: 'C9' }))
  // Object prototype names are valid Git names and must be tracked as own keys.
  const named = gitStep(gitInitial(), { type: 'branch', name: 'constructor' })
  assert.equal(gitHead(gitStep(named, { type: 'switch', name: 'constructor' })), 'C0')
})

await test('barycentric weights reconstruct points, classify boundaries and match executable Python', () => {
  for (const point of [...TRIANGLE, [0.5, 0.4], [0.5, 0.15], [0.08, 0.85], [0.333333, 0.234567]]) {
    const actual = barycentric(point)
    assert.ok(Math.abs(actual.weights.reduce((a, b) => a + b, 0) - 1) < 1e-12)
    for (const axis of [0, 1]) assert.ok(Math.abs(actual.weights.reduce((sum, w, i) => sum + w * TRIANGLE[i][axis], 0) - point[axis]) < 1e-12)
    const executed = lastJSON(python(barycentricCode(point) + 'import json\nprint(json.dumps({"inside": inside, "weights": [a,b,c]}))\n'))
    assert.equal(executed.inside, actual.inside)
    executed.weights.forEach((value, i) => assert.ok(Math.abs(value - actual.weights[i]) < 1e-12))
  }
  assert.deepEqual(barycentric(TRIANGLE[0]).rgb, [255, 0, 0])
  assert.deepEqual(barycentric([0.5, 0.4]).rgb, [85, 85, 85])
  assert.equal(barycentric([0.08, 0.85]).inside, false)
  assert.throws(() => barycentric([0, 0], [[0, 0], [1, 1], [2, 2]]), /共线/)
})

await test('Hexo tags are validated and three real articles embed the correct experiment', () => {
  let tag
  new Function('hexo', readFileSync('scripts/noimpty-experiments.js', 'utf8'))({ extend: { tag: { register: (name, fn) => { assert.equal(name, 'learning_experiment'); tag = fn } } } })
  for (const [kind, article] of [['array', 'DSA-Chapter4-Array-ADT'], ['git', 'Git-Chapter2-Branching'], ['barycentric', 'rasterization-antialiasing-z-buffer']]) {
    assert.match(tag([kind]), new RegExp(`data-experiment="${kind}"`))
    assert.ok(readFileSync(`source/_posts/${article}.md`, 'utf8').includes(`{% learning_experiment ${kind} %}`))
    assert.ok(readFileSync('source/experiments/index.md', 'utf8').includes(`{% learning_experiment ${kind} %}`))
  }
  assert.throws(() => tag(['<script>']))
  assert.throws(() => tag(['constructor']))
})
