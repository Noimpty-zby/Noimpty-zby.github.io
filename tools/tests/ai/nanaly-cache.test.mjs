/* 图片和文件的内存缓存。以前 load() 从 IndexedDB 读到之后不回填内存，于是除了刚
 * 上传那一次，之后每次读同一份都要重新开一个事务 —— 而渲染历史会对每条消息的每个
 * 附件各读一次，话题越长读得越多。这里盯住三件事：命中回填、并发去重、以及淘汰
 * 必须按最近使用排序且永不碰 temporary 的条目（那些只存在于内存里，丢了就没了）。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const sources = {
  vision: readFileSync(new URL('../../../source/js/nanaly-vision.js', import.meta.url), 'utf8'),
  files: readFileSync(new URL('../../../source/js/nanaly-files.js', import.meta.url), 'utf8')
}
const clone = value => value === undefined ? undefined : structuredClone(value)
const tick = () => new Promise(resolve => setImmediate(resolve))

class Element {
  constructor(tag) { this.tagName = tag; this.className = ''; this.children = []; this.parentNode = null; this.isConnected = true }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node }
  append(...nodes) { nodes.forEach(n => this.appendChild(n)) }
  prepend(...nodes) { nodes.forEach(n => { n.parentNode = this }); this.children.unshift(...nodes) }
  setAttribute() {}
  addEventListener() {}
  matches(selector) { return selector.startsWith('.') ? this.className.split(/\s+/).includes(selector.slice(1)) : this.tagName === selector }
  querySelectorAll(selector) { return this.children.flatMap(n => [...(n.matches(selector) ? [n] : []), ...n.querySelectorAll(selector)]) }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
}

// 每个 id 被真正读了几次 —— 这就是命中率的度量。
const boot = (kind, entries = [], { writable = true, gate = false, sessions = false } = {}) => {
  const data = new Map(entries.map(item => [item.id, clone(item)])), reads = [], held = []
  const database = { transaction() {
    const tx = { objectStore: () => ({
      // gate 打开时读取会停在半路，用来构造「读到一半被删掉」这种时序。
      get(id) { reads.push(id); return gate ? hold(data.get(id)) : request(data.get(id)) },
      getAll: () => request([...data.values()]),
      put(item) { if (!writable) throw new Error('存储已满'); data.set(item.id, clone(item)); return request(item.id) },
      delete(id) { data.delete(id); return request(undefined) }
    }) }
    const request = value => { const req = { result: clone(value) }; queueMicrotask(() => tx.oncomplete()); return req }
    const hold = value => { const req = { result: clone(value) }; held.push(() => tx.oncomplete()); return req }
    return tx
  } }
  const indexedDB = { open() { const req = { result: database }; queueMicrotask(() => req.onsuccess()); return req } }
  // prune 读不到合法的会话数据就一律不删（怕删掉别的标签页还在用的附件）。
  // 想让它真的清理，这里就得给一份过得了校验的。
  const saved = JSON.stringify({ v: 1, activeId: 'main', sessions: [{ id: 'main', messages: [] }] })
  const window = { indexedDB, localStorage: { getItem: () => sessions ? saved : null } }
  vm.runInNewContext(sources[kind], { window, indexedDB, document: { createElement: tag => new Element(tag) },
    URL, TextDecoder, TextEncoder, DataView, Uint8Array, Blob, File, crypto, DOMException, AbortController, setTimeout, clearTimeout })
  return { api: kind === 'vision' ? window.NANALY_VISION : window.NANALY_FILES, data, reads,
    countOf: id => reads.filter(x => x === id).length,
    release: () => { const waiting = held.splice(0); waiting.forEach(fn => fn()) } }
}

const image = id => ({ id, name: id + '.jpg', type: 'image/jpeg', at: Date.now(), dataURL: 'data:image/jpeg;base64,' + 'A'.repeat(64) + '==' })
const doc = id => ({ id, name: id + '.txt', type: 'text', size: 1024, at: Date.now(), text: '内容 ' + id,
  pageCount: null, readPages: [], imagePages: [], truncated: false, summary: '' })
const ref = item => ({ id: item.id, name: item.name, type: item.type, size: item.size })

let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

console.log('\n附件缓存 · 读一次就够')

await test('★★ 图片读过一次之后不再回 IndexedDB，渲染历史不会每条消息都重读', async () => {
  const items = [image('img-aaaaaaaa'), image('img-bbbbbbbb')]
  const h = boot('vision', items)
  const list = items.map(ref)
  // 一条历史消息 = 渲染一次 + 构造一次模型输入；再切回这个话题又是一轮。
  for (let round = 0; round < 3; round++) {
    await h.api.decorate(new Element('div'), list)
    await h.api.imageContent('看看这个', list)
  }
  assert.equal(h.countOf('img-aaaaaaaa'), 1, '六次取用只应落到一次真正的读取')
  assert.equal(h.countOf('img-bbbbbbbb'), 1)
})

await test('★★ 文件同样只读一次，decorate 和 content 共用同一份', async () => {
  const items = [doc('file-aaaaaaaa'), doc('file-bbbbbbbb')]
  const h = boot('files', items)
  const list = items.map(ref)
  for (let round = 0; round < 3; round++) {
    await h.api.decorate(new Element('div'), list)
    await h.api.content('看看这个', list)
  }
  assert.deepEqual([h.countOf('file-aaaaaaaa'), h.countOf('file-bbbbbbbb')], [1, 1])
})

await test('★★ 同时发起的取用合并成一次事务，不会各开各的', async () => {
  for (const kind of ['vision', 'files']) {
    const item = kind === 'vision' ? image('cc-aaaaaaaa') : doc('cc-aaaaaaaa')
    const h = boot(kind, [item])
    const list = [ref(item)]
    // 不 await，让它们真的并发
    await Promise.all([
      h.api.decorate(new Element('div'), list),
      kind === 'vision' ? h.api.imageContent('a', list) : h.api.content('a', list),
      h.api.decorate(new Element('div'), list)
    ])
    assert.equal(h.countOf('cc-aaaaaaaa'), 1, kind + '：三个并发取用只该读一次')
  }
})

await test('★★ 读不到的条目不会被记成命中，下次还会再去读', async () => {
  const h = boot('vision', [])
  const list = [{ id: 'missing-aaaa', name: 'x.jpg', type: 'image/jpeg' }]
  await h.api.decorate(new Element('div'), list)
  await h.api.decorate(new Element('div'), list)
  assert.equal(h.countOf('missing-aaaa'), 2, '没读到就不该缓存 null，否则文件恢复了也看不见')
})

await test('★★ 淘汰按最近使用排序：一直在用的那份不会被新来的挤掉', async () => {
  // 字节预算 24 MB 才是真正起作用的那道闸；记录按正文长度算账，拿 6 份 4 M 字的正好填满。
  const big = id => ({ ...doc(id), text: '文'.repeat(4 * 1024 * 1024) })
  const many = Array.from({ length: 6 }, (_, i) => big('keep-' + String(i).padStart(4, '0')))
  const hot = many[0]
  const h = boot('files', many)
  const take = async item => h.api.content('x', [{ id: item.id, name: item.name, type: 'text', size: 1024 }])
  for (const item of many) await take(item)
  assert.equal(h.reads.length, 6, '六份各读一次，预算正好装满')
  await take(hot)
  assert.equal(h.countOf(hot.id), 1, '还在缓存里')
  // 再塞两份新的，把总字节顶过预算
  for (const id of ['new-00000001', 'new-00000002']) { h.data.set(id, big(id)); await take(big(id)) }
  await take(hot)
  assert.equal(h.countOf(hot.id), 1, '刚用过的那份被挤掉了 —— 淘汰没有按最近使用排序')
  await take(many[1])
  assert.equal(h.countOf(many[1].id), 2, '最久没用的那份应该已经被淘汰')
})

await test('★★ 没能落盘的条目永远不淘汰 —— 它只存在于内存里，丢了就没了', async () => {
  // 存储写不进去时 prepare 会把条目标成 temporary，用户还能在刷新前发送它。
  const h = boot('files', [], { writable: false })
  const stuck = await h.api.prepare(new File(['只在内存里的内容'], 'stuck.txt'))
  assert.equal(stuck.temporary, true, '写入失败必须标记出来，否则用户不知道刷新会丢')
  // 之后再走 9 份别的文件，足够把上限顶穿好几轮
  for (let i = 0; i < 9; i++) {
    const id = 'push-' + String(i).padStart(4, '0')
    h.data.set(id, { ...doc(id), text: '文'.repeat(4 * 1024 * 1024) })
    await h.api.content('x', [{ id, name: id + '.txt', type: 'text', size: 1024 }])
  }
  const [entry] = await h.api.content('x', [ref(stuck)])
    .then(() => [true]).catch(() => [false])
  assert.ok(entry, '它被淘汰了，而 IndexedDB 里也没有 —— 用户的文件就此丢失')
  assert.equal(h.countOf(stuck.id), 0, '它始终该在内存里，一次都不用去读存储')
})

await test('★ 落盘成功的条目不带内存标记，重新读出来也不会被当成没保存', async () => {
  const h = boot('files', [])
  const saved = await h.api.prepare(new File(['正常保存'], 'ok.txt'))
  assert.equal(saved.temporary, undefined, '存成功了就不该再提示用户「刷新会丢」')
  assert.equal(h.data.get(saved.id).temporary, undefined, '这个标记只属于内存，不该写进存储')
})

await test('★★ 读到一半被删掉的条目不会又活过来', async () => {
  // load() 在途时 prune() 把它删了。如果在途的那次读取照样回填内存，
  // 已经被清理掉的图片就会从缓存里继续被端出来。
  const stale = { ...image('race-aaaaaaaa'), at: Date.now() - 7200000 }
  const h = boot('vision', [stale], { gate: true, sessions: true })
  const list = [ref(stale)]
  const reading = h.api.decorate(new Element('div'), list)
  await tick()
  // prune 扫到它没人引用且已过期，于是删掉 —— 这一步内部会 remove()。
  await h.api.prune({}, [])
  assert.equal(h.data.has(stale.id), false, '前提：prune 确实把它从存储里删了')
  h.release(); await reading
  const before = h.countOf(stale.id)
  const second = h.api.decorate(new Element('div'), list)
  await tick(); h.release(); await second
  assert.ok(h.countOf(stale.id) > before, '它还在内存里被端出来 —— 删过的条目又活了')
})

console.log(`\n${passed} 项通过`)
