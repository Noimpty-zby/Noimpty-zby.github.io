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
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check } from '../svg-check.mjs'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name) }

const dir = mkdtempSync(join(tmpdir(), 'svg-check-'))
const svg = (body, { w = 400, h = 200, style = '' } = {}) => {
  const file = join(dir, 'case-' + Math.random().toString(36).slice(2) + '.svg')
  writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`
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

rmSync(dir, { recursive: true, force: true })
console.log(`\n${passed} 项通过`)
