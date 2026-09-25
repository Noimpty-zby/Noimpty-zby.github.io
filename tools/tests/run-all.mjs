/* 把 tools/tests 下所有 *.test.mjs 跑一遍。
 *
 * 存在的理由：这些测试写好了却从来没被执行过 —— 没有 npm script，
 * 也没有任何工作流调用它们。守着一个从不运行的测试，比没有测试更糟，
 * 因为它给人一种「这块有人看着」的错觉。
 *
 * 现在 `npm test` 会跑，部署工作流构建之前也会跑，红了就不部署。
 */
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const project = resolve(here, '../..')
const discover = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const relative = prefix + entry.name
  if (entry.isDirectory()) return discover(join(dir, entry.name), relative + '/')
  return entry.isFile() && entry.name.endsWith('.test.mjs') ? [relative] : []
})
const files = discover(here).sort()

if (!files.length) {
  console.log('没有找到任何测试文件')
  process.exit(1)
}

let failed = 0
for (const f of files) {
  console.log(`\n──────── ${f} ────────`)
  try {
    execFileSync(process.execPath, [join(here, f)], { stdio: 'inherit', cwd: project, timeout: 120_000 })
  } catch (error) {
    console.error(`测试失败：${f}${error.code === 'ETIMEDOUT' ? '（超过 120 秒）' : ''}`)
    failed++
  }
}

console.log('\n════════════════════════')
if (failed) {
  console.log(`${failed} / ${files.length} 个测试文件失败`)
  process.exit(1)
}
console.log(`${files.length} 个测试文件全部通过`)
