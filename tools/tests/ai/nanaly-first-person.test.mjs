/* 娜娜莉一律自称「我」。人设改过一轮之后，已发布的内容里还留着 203 处「窝」，
   而当时没有任何测试守着，所以站上看到的仍旧是旧自称。这里把两头都钉住。 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

// 「窝」是正经字。只有当它不属于这些词时才算自称写错了。
const REAL_WORDS = ['被窝', '窝囊', '心窝', '窝火', '蜂窝', '酒窝', '燕窝', '窝棚', '安乐窝', '窝藏']
const strip = text => REAL_WORDS.reduce((rest, word) => rest.split(word).join(''), text)

const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  if (name === 'node_modules' || name.startsWith('.')) return []
  return statSync(path).isDirectory() ? walk(path) : [path]
})

let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

console.log('\n娜娜莉的自称')

await test('★★ 每个生成娜娜莉文字的提示词都写明自称「我」', () => {
  // 少一个，那条产线就会飘回旧自称，而且只有发布之后才看得见。
  const personas = ['source/js/noimpty-ai.js', 'tools/nanaly/reply.mjs', 'tools/nanaly/column.mjs',
    'tools/nanaly/notes.mjs', 'tools/nanaly/news.mjs', 'tools/nanaly/patrol.mjs']
  for (const file of personas)
    assert.match(readFileSync(file, 'utf8'), /自称「我」/, `${file} 没有写明自称，生成的文字会飘`)
})

await test('★★ 人设和生成器里不许出现「窝」', () => {
  const offenders = []
  const self = import.meta.url.replace(/^file:\/\//, '')
  for (const file of [...walk('source/js'), ...walk('tools')]) {
    if (!['.js', '.mjs', '.json'].includes(extname(file)) || self.endsWith(file)) continue
    if (strip(readFileSync(file, 'utf8')).includes('窝')) offenders.push(file)
  }
  assert.deepEqual(offenders, [], '这些文件把「窝」写回去了')
})

await test('★★ 娜娜莉已发布的文字里不许出现「窝」', () => {
  // 专栏、资讯和文章批注都是她自己的口吻，站上直接看得到。
  const written = [...walk('source/news'), ...walk('source/_data'),
    ...walk('source/_posts').filter(file => file.includes('nanaly-'))]
  const offenders = []
  for (const file of written) {
    if (!['.md', '.json'].includes(extname(file))) continue
    const text = strip(readFileSync(file, 'utf8'))
    if (text.includes('窝')) offenders.push(`${file}（${text.split('窝').length - 1} 处）`)
  }
  assert.deepEqual(offenders, [], '如果确实是「被窝」这类正经词，把它加进 REAL_WORDS，别改测试的判定')
})

await test('★ 批注锚点和正文用同一个自称', () => {
  // 锚点是正文的逐字切片。只改一头，批注就会在页面上消失。
  const notes = JSON.parse(readFileSync('source/_data/nanaly-notes.json', 'utf8'))
  const anchors = Object.values(notes).flatMap(entry => entry.notes || []).map(note => note.anchor)
  assert.ok(anchors.length > 0, '批注读不出来，这条测试就失去意义了')
  for (const anchor of anchors) assert.doesNotMatch(anchor, /窝/, `锚点「${anchor}」还是旧自称`)
})

console.log(`\n${passed} 项通过`)
