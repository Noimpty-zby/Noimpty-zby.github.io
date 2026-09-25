/* 配图自查工具本身的测试。
 *
 * 这台机器上没有任何 SVG 渲染器，画完的图看不见 —— svg-check 是唯一的兜底，
 * 所以它自己不能瞎报也不能漏报。
 *
 * 2026-09-20 全站扫描报出 7 处「出框 / 压字」，逐个查下来一处真问题都没有：
 * 字号写在 <style> 的类上而工具只读 font-size 属性，读不到就按 16 估，
 * 一张 12px 的图被整体高估三成。一个在干净仓库上报七次假警报的检查器，
 * 只会训练人忽略它 —— 比没有更糟。这里把那两类误差钉住。
 */
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check } from '../../checks/svg-check.mjs'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name) }

const dir = mkdtempSync(join(tmpdir(), 'svg-check-'))
const svg = (body, { w = 400, h = 200, x = 0, y = 0, style = '' } = {}) => {
  const file = join(dir, 'case-' + Math.random().toString(36).slice(2) + '.svg')
  writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">`
    + (style ? `<style>${style}</style>` : '') + body + '</svg>')
  return file
}

console.log('\n配图自查 · 字号从哪来')

test('★★ 字号写在 <style> 的类上也要认 —— 这是那七处误报的全部原因', () => {
  const body = '<text class="s" x="200" y="100" text-anchor="middle">绿色 = C++    紫色 = 蓝图</text>'
  assert.deepEqual(check(svg(body, { style: '.s{font-size:12px}' })), [], '12px 放得下，不该报')
  const big = check(svg(body, { style: '.s{font-size:60px}' }))
  assert.equal(big.length, 1, '60px 真放不下，必须报')
  assert.match(big[0], /出框/)
})

test('★★ 元素自己写的 font-size 优先于类', () => {
  const body = '<text class="s" font-size="10" x="200" y="100" text-anchor="middle">一段中等长度的中文标签文字</text>'
  assert.deepEqual(check(svg(body, { style: '.s{font-size:40px}' })), [], '应当按 10px 算，而不是类上的 40px')
})

test('★ 多个类里最后一个定了字号的说了算，都没定就退回 16', () => {
  const styled = '<text class="a b" x="10" y="100">字</text>'
  assert.deepEqual(check(svg(styled, { style: '.a{font-size:99px}.b{font-size:12px}' })), [])
  // 谁都没写字号时按 16 估：这一行 30 个字，16px 下必然出框
  const bare = '<text class="c" x="10" y="100">' + '字'.repeat(30) + '</text>'
  assert.equal(check(svg(bare, { style: '.c{fill:#333}' })).length, 1)
})

console.log('\n配图自查 · 压字判定')

test('★★ 相邻两行正常排版不报 —— em 框比墨迹高，不留容差就每张图都报', () => {
  const body = '<text class="s" x="20" y="60">正常的一行</text><text class="s" x="20" y="90">隔开的另一行</text>'
  assert.deepEqual(check(svg(body, { style: '.s{font-size:12px}' })), [])
})

test('★★ 真压上去了要报，容差不能大到把真问题吃掉', () => {
  const body = '<text class="s" x="60" y="100">分支指向提交</text><text class="s" x="90" y="103">HEAD 指向分支</text>'
  const found = check(svg(body, { style: '.s{font-size:18px}' }))
  assert.equal(found.length, 1)
  assert.match(found[0], /压字/)
})

test('★ 横向错开的两段，纵向再近也不算压字', () => {
  const body = '<text class="s" x="10" y="100">左边</text><text class="s" x="300" y="100">右边</text>'
  assert.deepEqual(check(svg(body, { style: '.s{font-size:14px}' })), [])
})

console.log('\n配图自查 · 边界情况')

test('★ 等宽字体按更窄的系数算，不会把代码标签误判成出框', () => {
  const mono = '<text font-family="ui-monospace, monospace" font-size="14" x="10" y="100">refs/heads/feature</text>'
  assert.deepEqual(check(svg(mono)), [])
})

test('★ 没有 viewBox 直接说清楚，空文本和纯标记不参与判定', () => {
  const file = join(dir, 'noviewbox.svg')
  writeFileSync(file, '<svg xmlns="http://www.w3.org/2000/svg"><text x="1" y="1">x</text></svg>')
  assert.match(check(file)[0], /没有可用的 viewBox/)
  assert.deepEqual(check(svg('<text x="10" y="100">   </text><text x="10" y="150"><tspan></tspan></text>')), [])
})

test('非零和负 viewBox 原点参与四边判断', () => {
  assert.deepEqual(check(svg('<text x="120" y="70">字</text>', { x: 100, y: 50, w: 100, h: 100 })), [])
  assert.match(check(svg('<text x="90" y="70">字</text>', { x: 100, y: 50 }))[0], /出框/)
  assert.deepEqual(check(svg('<text x="-80" y="-60">字</text>', { x: -100, y: -100, w: 100, h: 100 })), [])
  assert.match(check(svg('<text x="90" y="100">字</text>', { x: -100, w: 100 }))[0], /出框/)
})
test('viewBox 必须有限且宽高为正，溢出的边界也不能通过', () => {
  for (const options of [{ x: 'NaN' }, { y: 'Infinity' }, { w: 0 }, { h: -1 }, { w: '10px' }, { x: '1e308', w: '1e308' }]) {
    assert.match(check(svg('', options))[0], /没有可用的 viewBox/)
  }
})
test('非有限或无效文字坐标与字号要报错，零字号不产生可见文字', () => {
  for (const attributes of ['x="NaN"', 'y="Infinity"', 'x="1e999"', 'font-size="Infinity"', 'font-size="-1"', 'x=""']) {
    assert.match(check(svg(`<text ${attributes}>字</text>`))[0], /坐标或字号无效/)
  }
  assert.match(check(svg('<text class="s">字</text>', { style: '.s{font-size:NaN}' }))[0], /坐标或字号无效/)
  assert.match(check(svg('<text font-size="1e308">字字</text>'))[0], /可计算范围/)
  assert.deepEqual(check(svg('<text x="-999" y="-999" font-size="0">字</text>')), [])
})
test('单引号、逗号 viewBox 及 px 属性保持正常解析', () => {
  const file = join(dir, 'quoted.svg')
  writeFileSync(file, "<svg viewBox = '100,50,100,100'><text x = '120px' y='70' font-size='12px'>字</text></svg>")
  assert.deepEqual(check(file), [])
})
test('CLI 支持带空格与 # 的路径，缺参数和读取失败都有非零退出', () => {
  const tool = join(dir, 'svg check # cli.mjs')
  copyFileSync(new URL('../../checks/svg-check.mjs', import.meta.url), tool)
  const good = svg('<text x="10" y="100">字</text>')
  const result = spawnSync(process.execPath, [tool, good], { encoding: 'utf8' })
  assert.equal(result.status, 0); assert.match(result.stdout, /1 张图/)
  const usage = spawnSync(process.execPath, [tool], { encoding: 'utf8' })
  assert.equal(usage.status, 2); assert.match(usage.stderr, /用法/)
  const missing = spawnSync(process.execPath, [tool, join(dir, 'absent.svg')], { encoding: 'utf8' })
  assert.equal(missing.status, 1); assert.match(missing.stdout, /读取失败/)
})

rmSync(dir, { recursive: true, force: true })
console.log(`\n${passed} 项通过`)
