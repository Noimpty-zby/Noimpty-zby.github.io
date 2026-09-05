/* source/js 下每个脚本都必须能被解析。
 *
 * 为什么需要它：2026-09-05 娜娜莉在站上整个消失了，查下来是
 * `noimpty-ai.js` 里的 PERSONA —— 那是一段**反引号模板字符串**，
 * 而给她补文章要点时，正文里顺手写了 `man -k`、`$HOME` 这种
 * 用反引号括起来的命令名。反引号在模板字符串里是结束符，
 * 于是整个文件成了语法错误，浏览器直接不执行它，助手连带音乐、
 * 导航一起没了。
 *
 * 这个坏法的要命之处在于**一路全绿**：
 *   - hexo generate 只是把 js 当静态文件拷过去，不解析
 *   - npm test 当时不看 js
 *   - linkcheck / leakcheck 查的是链接和公开页，不查脚本能不能跑
 * 唯一的症状是打开网站发现她不见了，而这中间隔了 5 天、跨了两次提交
 * （f775cf9 引入，bb35553 加重）。
 *
 * 所以这里只做一件很笨但很有效的事：把每个脚本丢给解析器过一遍。
 * 顺带钉死 PERSONA 里的反引号必须是转义过的 —— 那是最容易再犯的一处。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

const DIR = 'source/js'
let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const files = readdirSync(DIR).filter(f => f.endsWith('.js')).sort()

console.log('\n浏览器脚本 · 语法')
assert.ok(files.length, `${DIR} 下一个脚本都没有，测试本身失效了`)

for (const f of files) {
  check(`★★ ${f} 能被解析`, () => {
    const src = readFileSync(join(DIR, f), 'utf8')
    // 和浏览器一样按脚本解析：只编译不执行，不碰 window / document
    new vm.Script(src, { filename: f })
  })
}

/* Hexo 的构建脚本也一起看一眼。
 * 它们坏了会让 hexo generate 直接炸，不像浏览器脚本那样闷声不响，
 * 但顺手的事 —— 而且 scripts/ 下面同样有大段中文注释和模板字符串。
 * 娜娜莉那几个 tools/*.mjs 不在这里：它们是 ESM，坏了工作流当场就红。 */
console.log('\nHexo 构建脚本 · 语法')
for (const f of readdirSync('scripts').filter(f => f.endsWith('.js')).sort()) {
  check(`${f} 能被解析`, () => {
    new vm.Script(`(function(exports,require,module,__filename,__dirname){${readFileSync(join('scripts', f), 'utf8')}\n})`, { filename: f })
  })
}

console.log('\n娜娜莉的人设 · 模板字符串里的反引号')

const AI = join(DIR, 'noimpty-ai.js')
const src = readFileSync(AI, 'utf8')
const MARK = 'const PERSONA = `'

check('★★ PERSONA 还在，而且是模板字符串', () => {
  assert.ok(src.includes(MARK), '找不到 PERSONA 的开头，这个测试要跟着改')
})

check('★★ PERSONA 里的反引号全部转义过', () => {
  const from = src.indexOf(MARK) + MARK.length
  // 从开头往后扫到第一个未转义的反引号 = 这段模板字符串真正的结尾
  let i = from
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue }
    if (src[i] === '`') break
    i++
  }
  assert.ok(i < src.length, 'PERSONA 没有结尾，模板字符串没闭合')
  const body = src.slice(from, i)
  // 正文里如果还想写命令名，必须写成 \` —— 裸反引号会在这之前就把字符串截断
  assert.ok(body.length > 1000, `PERSONA 只解析出 ${body.length} 个字符，八成是被一个裸反引号截断了`)
  assert.ok(body.includes('\\`'), 'PERSONA 里没有任何转义反引号，检查一下是不是被谁改回裸写法了')
})

check('PERSONA 里没有会被当成插值的 ${', () => {
  const from = src.indexOf(MARK) + MARK.length
  const body = src.slice(from, src.indexOf('\n\n', src.indexOf('演戏归演戏', from)))
  assert.ok(!/(^|[^\\])\$\{/.test(body), '正文里出现了未转义的 ${，它会被当成插值求值')
})

console.log(`\n${pass} 项通过`)
