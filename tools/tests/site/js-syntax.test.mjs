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

console.log('\n浏览器脚本 · 解析得过、跑起来会炸的那几种写法')

check('★★ 关键字后面不许直接粘中文（const活 会被当成一个标识符）', () => {
  /* 2026-09-17 日程页整个白屏过一次，就死在一行 `const活 = …`：
   * CJK 是合法的标识符字符，所以 `const` 和后面那个字连成了**一个** token，
   * 整句成了「给未声明变量赋值」—— 解析期完全合法，
   * 只有在 'use strict' 下运行时才抛 ReferenceError。
   * 上面那圈 new vm.Script 全部照过，构建过，部署过，
   * 只有打开页面才看得见。所以这里按字面量扫一遍。 */
  const KW = 'const|let|var|return|typeof|new|delete|void|await|yield|case|instanceof'
  const re = new RegExp(`\\b(?:${KW})[\\u3400-\\u9fff\\u3040-\\u30ff]`, 'g')
  /* 注释里不算 —— 讲这个坑的注释本身就会写出 `const活` 当例子。
   * 粗略地砍掉 // 之后的部分、跳过块注释的行就够了：
   * 这几个文件里没有「字符串里含 //」又同时关键字粘中文的写法。 */
  const codeOf = line => {
    const t = line.trim()
    if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return ''
    const i = line.indexOf('//')
    return i === -1 ? line : line.slice(0, i)
  }
  const bad = []
  for (const f of files) {
    readFileSync(join(DIR, f), 'utf8').split('\n').forEach((line, i) => {
      const code = codeOf(line)
      if (code && re.test(code)) bad.push(`${f}:${i + 1}  ${line.trim().slice(0, 60)}`)
      re.lastIndex = 0
    })
  }
  assert.deepEqual(bad, [],
    '关键字和中文标识符黏在一起了（中间漏了空格）：\n      ' + bad.join('\n      '))
})

console.log('\n娜娜莉的人设 · 共享模块和运行时拼接')
const src = readFileSync(join(DIR, 'noimpty-ai.js'), 'utf8')
const identitySource = readFileSync(join(DIR, 'nanaly-identity.js'), 'utf8')
const from = src.indexOf('  const PERSONA =')
const to = src.indexOf('  // ---------------- 工具', from)
const runtime = { window: {} }
check('共享人格能在浏览器环境运行，提示拼接无未定义插值或截断', () => {
  assert.ok(from >= 0 && to > from, '找不到实际提示构造边界')
  vm.runInNewContext(identitySource, runtime)
  vm.runInNewContext(src.slice(from, to) + ';this.persona = PERSONA', runtime)
  assert.equal(typeof runtime.persona, 'string')
  assert.ok(runtime.persona.startsWith(runtime.window.NANALY_IDENTITY.prompt))
  assert.match(runtime.persona, /工具未配置/)
  assert.match(runtime.persona, /没有日志不能编造/)
})
check('人格来源为共享公开规则，不把旧长模板、硬编码私人资料重新塞进来', () => {
  assert.match(src.slice(from, to), /NANALY_IDENTITY/)
  assert.ok(runtime.persona.length > 500 && runtime.persona.length < 5000)
  assert.doesNotMatch(runtime.persona, /生日是|他的生日|全世界只有.*主人/)
})
console.log('\n' + pass + ' 项通过')
