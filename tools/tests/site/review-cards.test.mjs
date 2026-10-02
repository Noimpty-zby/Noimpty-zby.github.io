/* 复习卡（/review/、source/_data/review-cards.yml、scripts/noimpty-review.js、source/js/review.js）。
 *
 * 构建时 {% review_cards %} 遇到写错的文章名会直接报错，但那要到部署时才知道；这里提前拦住。
 * 另外盯几件只有复习时才会发现的事：
 *   - 同一篇文章里两张卡的正面一样，它们会算成同一个 id，进度互相覆盖；
 *   - 卡片文字里的 `代码` 没配对，页面上会露出半个反引号；
 *   - UE5 的卡从「术语表」「易错点速查表」两张表里抽，标题改名了就一张都抽不到；
 *   - 复习进度存在本地，导出的文件版本号要和读取时认的一致。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

let pass = 0
const check = (name, fn) => { fn(); pass++; console.log(`  ✓ ${name}`) }

const data = yaml.load(readFileSync('source/_data/review-cards.yml', 'utf8'))
const posts = new Set(readdirSync('source/_posts').filter(name => name.endsWith('.md')).map(name => name.slice(0, -3)))

check('每组卡都指向存在的文章，正反面都不空', () => {
  let total = 0
  for (const series of ['dsa', 'linux', 'git']) {
    assert.ok(Array.isArray(data[series]) && data[series].length, `${series} 没有卡`)
    for (const entry of data[series]) {
      assert.ok(posts.has(entry.post), `review-cards.yml 里写的文章 ${entry.post} 不存在`)
      assert.ok(Array.isArray(entry.cards) && entry.cards.length >= 5, `${entry.post} 的卡太少`)
      for (const card of entry.cards) {
        assert.equal(typeof card.front, 'string'); assert.equal(typeof card.back, 'string')
        assert.ok(card.front.trim() && card.back.trim(), `${entry.post} 有一张卡缺正面或背面`)
        total++
      }
    }
  }
  assert.ok(total >= 200, `只有 ${total} 张手写的卡，数据是不是丢了`)
})

check('同一篇文章里没有两张正面相同的卡', () => {
  for (const series of ['dsa', 'linux', 'git']) for (const entry of data[series]) {
    const fronts = entry.cards.map(card => card.front.trim())
    assert.equal(new Set(fronts).size, fronts.length, `${entry.post} 有重复的正面`)
  }
})

check('卡片里的反引号都成对', () => {
  for (const series of ['dsa', 'linux', 'git']) for (const entry of data[series]) for (const card of entry.cards) {
    for (const text of [card.front, card.back]) assert.equal((text.match(/`/g) || []).length % 2, 0, `${entry.post}: ${text.slice(0, 40)}`)
  }
})

check('UE5 文章里还有能抽卡的术语表和速查表', () => {
  const ue5 = [...posts].filter(name => name.startsWith('UE5-'))
  const withTables = ue5.filter(name => /^#{1,4}\s.*(术语表|易错点速查表)/m.test(readFileSync(join('source/_posts', name + '.md'), 'utf8')))
  assert.ok(withTables.length >= 5, `只有 ${withTables.length} 篇 UE5 文章还有术语表或速查表`)
})

check('复习页、排程算法和页面脚本都在', () => {
  assert.match(readFileSync('source/review/index.md', 'utf8'), /\{% review_cards %\}/)
  assert.ok(existsSync('tools/assets/review-fsrs-entry.mjs'))
  const app = readFileSync('source/js/review.js', 'utf8')
  assert.match(app, /const STORE = 'noimpty-review-v1'/)
  assert.match(app, /value\.v !== 1/)
})

console.log(`\n${pass} review card checks passed`)
