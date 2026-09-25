import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { parseOptions, resultsPass } from '../../checks/voice-check.mjs'

for (const args of [['--dryy'], ['--help', '-n', '1'], ['-n'], ['-n', 'Infinity'], ['-n', '0'], ['-n', '1.5'], ['-n', '101'], ['-n', '2', '-n', '3'], ['--samples'], ['--samples', '--live']]) {
  assert.throws(() => parseOptions(args), undefined, args.join(' '))
}
assert.deepEqual(parseOptions(['-n', '2', '--samples', 'with spaces']), { rounds: 2, sampleDir: 'with spaces', help: false })
const help = spawnSync(process.execPath, ['tools/checks/voice-check.mjs', '--help'], { encoding: 'utf8', env: { PATH: process.env.PATH } })
assert.equal(help.status, 0)
assert.match(help.stdout, /不读取密钥/)
const typo = spawnSync(process.execPath, ['tools/checks/voice-check.mjs', '--dryy'], { encoding: 'utf8', env: { PATH: process.env.PATH } })
assert.equal(typo.status, 1)
assert.match(typo.stderr, /不支持/)
assert.doesNotMatch(typo.stderr, /没有密钥/, '先校验参数，不能先读取凭据')
assert.equal(resultsPass(12, 0, [], 0, 6), false, '没有声音不能通过')
assert.equal(resultsPass(2, 1, [2], 1, 6), false, '部分失败不能通过')
assert.equal(resultsPass(2, 2, [2, NaN], 2, 6), false)
assert.equal(resultsPass(2, 2, [2, 7], 2, 6), false)
assert.equal(resultsPass(2, 2, [2, 3], 2, 6), true)
console.log('Manual checks: strict arguments, safe help, missing/invalid audio cannot pass')
