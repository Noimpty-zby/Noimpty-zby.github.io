import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const entries = [
  [new URL('../../nanaly/run.mjs', import.meta.url).href, [['--dryy'], ['reply', '--dr'], ['notes', 'news']]],
  [new URL('../../daily-report/run.mjs', import.meta.url).href, [['--dryy'], ['--dry', '--unknown'], ['send']]]
]
const dir = mkdtempSync(join(tmpdir(), 'nanaly-cli-'))
try {
  for (const [entry, cases] of entries) for (const args of cases) {
    const source = `
      globalThis.fetch = async () => { process.stderr.write('UNEXPECTED_FETCH'); throw new Error('network blocked'); };
      process.argv = ['node', 'run.mjs', ...${JSON.stringify(args)}];
      await import(${JSON.stringify(entry)});
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: dir, encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /不支持的参数|一次只能指定一个动作/)
    assert.doesNotMatch(result.stderr, /UNEXPECTED_FETCH/)
    assert.deepEqual(readdirSync(dir), [])
  }
  console.log('  ✓ invalid flags and multiple actions fail before network or filesystem effects')
} finally { rmSync(dir, { recursive: true, force: true }) }
