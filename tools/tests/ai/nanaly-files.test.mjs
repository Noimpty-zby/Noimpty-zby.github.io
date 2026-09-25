// Real parser and storage regressions; fixtures contain only generated test data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
const require = createRequire(import.meta.url)
const JSZip = require('jszip'), mammoth = require('mammoth')
const canvas = require('@napi-rs/canvas')
globalThis.DOMMatrix = canvas.DOMMatrix
globalThis.ImageData = canvas.ImageData
globalThis.Path2D = canvas.Path2D
const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs')
const source = readFileSync(new URL('../../../source/js/nanaly-files.js', import.meta.url), 'utf8')
const clone = value => value === undefined ? undefined : structuredClone(value)
const workspace = (messages = []) => ({ v: 1, activeId: 'main', sessions: [{ id: 'main', messages }], undo: null })
class Element {
  constructor(tag) { this.tagName = tag; this.className = ''; this.children = []; this.parentNode = null; this.listeners = {}; this.isConnected = true }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node }
  append(...nodes) { nodes.forEach(n => this.appendChild(n)) }
  prepend(...nodes) { nodes.forEach(n => { n.parentNode = this }); this.children.unshift(...nodes) }
  before(node) { node.parentNode = this.parentNode; this.parentNode.children.splice(this.parentNode.children.indexOf(this), 0, node) }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes) }
  setAttribute() {}
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  matches(selector) { return selector.startsWith('.') ? this.className.split(/\s+/).includes(selector.slice(1)) : this.tagName === selector }
  querySelectorAll(selector) { return this.children.flatMap(n => [...(n.matches(selector) ? [n] : []), ...n.querySelectorAll(selector)]) }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
}
const boot = (entries = [], saved = workspace(), denied = false) => {
  const data = new Map(entries.map(item => [item.id, clone(item)])), deleted = [], notices = []
  let stored = saved
  const database = { transaction() {
    const tx = { objectStore: () => ({
      get: id => request(data.get(id)), getAll: () => request([...data.values()]),
      put: item => { data.set(item.id, clone(item)); return request(item.id) },
      delete: id => { deleted.push(id); data.delete(id); return request(undefined) }
    }) }
    const request = value => { const req = { result: clone(value) }; queueMicrotask(() => tx.oncomplete()); return req }
    return tx
  } }
  const indexedDB = { open() { const req = { result: database }; queueMicrotask(() => denied ? req.onerror() : req.onsuccess()); return req } }
  const document = { createElement: tag => tag === 'canvas' ? canvas.createCanvas(10, 10) : new Element(tag) }
  const window = { indexedDB, mammoth: { extractRawText: ({ arrayBuffer }, options) => mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer) }, options) }, localStorage: { getItem: () => typeof stored === 'string' ? stored : JSON.stringify(stored) } }
  vm.runInNewContext(source, { window, indexedDB, document, URL, TextDecoder, DataView, Uint8Array, Blob, DecompressionStream, crypto: { randomUUID }, DOMException, AbortController, setTimeout, clearTimeout })
  const api = window.NANALY_FILES
  return { api, data, deleted, save: value => { stored = value }, mount(extra = {}) {
    let chat = true, busy = false
    const panel = new Element('div'), foot = new Element('div'), input = new Element('textarea')
    foot.className = 'nanaly-foot'; foot.append(input); panel.append(foot)
    const ui = api.mount({ panel, input, isBusy: () => busy, isChat: () => chat, notify: m => notices.push(m), ...extra })
    return { ui, panel, notices, setChat: value => { chat = value; ui.refresh() }, setBusy: value => { busy = value; ui.refresh() } }
  } }
}
const file = (name, body) => new File([body], name)
const docx = async text => {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + text + '</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table cell 42</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>')
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}
const pdfFixture = (count, text = '') => {
  const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [' + Array.from({ length: count }, (_, i) => (4 + i * 2) + ' 0 R').join(' ') + '] /Count ' + count + ' >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  for (let i = 0; i < count; i++) {
    const stream = text ? 'BT /F1 12 Tf 30 100 Td (' + text + ') Tj ET' : ''
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (5 + i * 2) + ' 0 R >>')
    objects.push('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream')
  }
  let result = '%PDF-1.4\n', offsets = [0]
  for (let i = 1; i < objects.length; i++) { offsets.push(result.length); result += i + ' 0 obj\n' + objects[i] + '\nendobj\n' }
  const start = result.length
  result += 'xref\n0 ' + objects.length + '\n0000000000 65535 f \n' + offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')
  result += 'trailer\n<< /Size ' + objects.length + ' /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF'
  return new TextEncoder().encode(result).buffer
}
const realPDF = { getDocument(options) { return pdf.getDocument({ ...options, standardFontDataUrl: new URL('../../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname, cMapUrl: new URL('../../../node_modules/pdfjs-dist/cmaps/', import.meta.url).pathname, wasmUrl: new URL('../../../node_modules/pdfjs-dist/wasm/', import.meta.url).pathname }) } }
let passed = 0
const check = async (name, fn) => { try { await fn(); passed++; console.log('  ✓ ' + name) } catch (error) { process.exitCode = 1; console.error('  ✗ ' + name, error) } }

await check('file type and size allowlists reject binary executables, empty files and oversize uploads', () => {
  const { api } = boot()
  for (const name of ['report.pdf', 'report.docx', 'a.py', 'a.tsx', 'a.md', 'a.json', 'a.csv']) assert.doesNotThrow(() => api.validateFile({ name, size: 2 }))
  for (const name of ['a.exe', 'a.doc', 'a.zip', 'a.pptx']) assert.throws(() => api.validateFile({ name, size: 2 }), /支持/)
  for (const size of [0, api.LIMITS.bytes + 1]) assert.throws(() => api.validateFile({ name: 'a.txt', size }), /10 MB/)
})
await check('UTF-8 and UTF-16 text decode locally; binary and invalid encoding are rejected', async () => {
  const { api } = boot()
  assert.equal(api.parseText(new TextEncoder().encode('你好\r\n世界').buffer).text, '你好\n世界')
  const utf16 = Buffer.from('\ufeff你好', 'utf16le')
  assert.equal(api.parseText(utf16.buffer.slice(utf16.byteOffset, utf16.byteOffset + utf16.length)).text, '你好')
  assert.throws(() => api.parseText(Uint8Array.from([0xff, 0xff]).buffer), /编码/)
  assert.throws(() => api.parseText(Uint8Array.from([65, 0, 66]).buffer), /二进制/)
  const large = api.parseText(new TextEncoder().encode('x'.repeat(60001)).buffer)
  assert.equal(large.text.length, 60000); assert.equal(large.truncated, true); assert.match(large.summary, /后续内容未读取/)
})
await check('real DOCX paragraphs and table cells extract as text with no invented page count', async () => {
  const { api, data } = boot(), doc = await api.prepare(file('hello.docx', await docx('Hello cat')))
  assert.match(doc.text, /Hello cat/); assert.match(doc.text, /Table cell 42/)
  assert.equal(doc.pageCount, null); assert.match(doc.summary, /无固定页数/)
  // 不留原件：解析出的正文和扫描图才是后面会用到的，原件占一条记录九成九的体积。
  assert.equal(data.size, 1); assert.equal(data.get(doc.id).source, undefined)
  const reference = api.refs([doc])[0]
  assert.equal(reference.text, undefined); assert.equal(reference.source, undefined)
})
await check('DOCX zip bombs and forged expanded sizes fail before the parser', async () => {
  const { api } = boot(), ordinary = await docx('Small content')
  assert.ok((await api.validateArchive(ordinary)).bytes > 100)
  const bomb = await docx('x'.repeat(2 * 1024 * 1024))
  await assert.rejects(api.validateArchive(bomb), /安全大小/)
  const forged = ordinary.slice(0), bytes = new Uint8Array(forged), view = new DataView(forged)
  for (let i = 0; i < bytes.length - 46; i++) if (view.getUint32(i, true) === 0x02014b50 && view.getUint16(i + 10, true) === 8) { view.setUint32(i + 24, 1, true); break }
  await assert.rejects(api.validateArchive(forged), /安全大小/)
  await assert.rejects(api.validateArchive(new Uint8Array([1, 2, 3]).buffer), /结构异常/)
})
await check('real PDF text extraction reports exact pages, preserves text, and caps at 30 pages', async () => {
  const { api } = boot()
  const text = 'Actual PDF text '.repeat(8), result = await api.parsePDF(pdfFixture(31, text), realPDF)
  assert.equal(result.pageCount, 31); assert.equal(result.readPages.length, 30)
  assert.equal(result.readPages[29], 30); assert.equal(result.truncated, true)
  assert.match(result.text, /Actual PDF text/); assert.match(result.summary, /第 31 页起未读取/)
  assert.equal(result.images.length, 0)
  assert.match(result.summary, /扫描图 0 页。/); assert.doesNotMatch(result.summary, /第 无 页/)
})
await check('scanned PDF pages are bounded and unread pages explicitly disclosed', async () => {
  const { api } = boot(), result = await api.parsePDF(pdfFixture(3), realPDF)
  assert.equal(result.images.length, 2); assert.equal(result.imagePages.join(','), '1,2')
  assert.equal(result.readPages.length, 0); assert.equal(result.truncated, true)
  assert.match(result.summary, /文字层提取 0 页；扫描图 2 页（第 1、2 页）/); assert.doesNotMatch(result.summary, /第 无 页/)
  assert.match(result.summary, /未能完整读取第 3 页/)
  assert.match(result.images[0].dataURL, /^data:image\/jpeg;base64,/)
})
await check('ordinary images and scanned pages share one two-image budget; skipped scans are never claimed as read', async () => {
  const doc = { id: 'file-scans-001', name: 'scan.pdf', type: 'pdf', text: '', summary: '共 2 页；扫描图 2 页', images: [{ page: 1, dataURL: 'data:image/jpeg;base64,AA==' }, { page: 2, dataURL: 'data:image/jpeg;base64,AA==' }] }
  const { api } = boot([doc])
  const content = await api.content('看一下', [doc], { imageBudget: 1 })
  assert.equal(content.filter(x => x.type === 'image_url').length, 1)
  assert.match(content[0].text, /第 2 页扫描图未发送、未读取/)
  const none = await api.content('看一下', [doc], { imageBudget: 0 })
  assert.equal(typeof none, 'string'); assert.match(none, /第 1、2 页扫描图未发送、未读取/)
})
await check('missing current files fail; missing historical files give honest markers', async () => {
  const { api } = boot(), ref = { id: 'file-missing-01', name: 'missing.txt', type: 'text' }
  await assert.rejects(api.content('读取', [ref]), /重新附加/)
  assert.match(await api.content('继续', [ref], { strict: false }), /本轮未读取，不能假装看过/)
})
await check('restoring, removing, switching, locking, taking and cancelling keep bytes for retry and undo', async () => {
  const h = boot(), m = h.mount()
  await m.ui.add([file('draft.md', '# hello')])
  const refs = m.ui.refs(); assert.equal(refs.length, 1)
  assert.match(await h.api.content('read', refs), /# hello/)
  m.setChat(false); assert.equal(m.panel.querySelector('.nanaly-file-tray').hidden, true)
  m.setChat(true); assert.equal(m.panel.querySelector('.nanaly-file-tray').hidden, false)
  const sent = m.ui.take(); assert.equal(m.ui.refs().length, 0)
  await m.ui.restore(sent); m.panel.querySelector('.nanaly-file-chip').querySelector('button').onclick()
  assert.equal(m.ui.refs().length, 0); assert.equal(h.data.size, 1)
  await m.ui.restore(sent); m.ui.clear(); assert.equal(h.data.size, 1)
  const pending = m.ui.restore(sent); m.ui.clear(); await pending
  assert.equal(m.ui.refs().length, 0); assert.equal(m.ui.loading(), false)
  assert.match(await h.api.content('retry', sent), /# hello/)
})
await check('clear cancels an in-flight file parse without resurrecting its draft', async () => {
  const h = boot(), m = h.mount()
  let resolve
  const delayed = { name: 'delayed.txt', size: 3, arrayBuffer: () => new Promise(r => { resolve = r }) }
  const pending = m.ui.add([delayed]); assert.equal(m.ui.loading(), true)
  m.ui.clear(); resolve(new TextEncoder().encode('abc').buffer); await pending
  assert.equal(m.ui.refs().length, 0); assert.equal(m.ui.loading(), false); assert.equal(h.data.size, 0)
})
await check('pruning retains files referenced by another tab, pending turns, retry, undo and drafts', async () => {
  const docs = ['other', 'pending', 'retry', 'undo', 'draft', 'stale'].map(n => ({ id: 'document-' + n, type: 'text', name: n, text: n, at: Date.now() - 7200000 }))
  const persisted = workspace([{ role: 'user', content: 'old', files: [docs[0]] }]), current = workspace()
  current.sessions[0].pending = { files: [docs[1]], baseMessages: [{ files: [docs[2]] }] }; current.undo = { files: [docs[3]] }
  const h = boot(docs, persisted)
  await h.api.prune(current, [docs[4]])
  assert.equal(h.data.size, 5); assert.equal(h.deleted.join(','), 'document-stale')
  h.save('{broken'); await h.api.prune(workspace(), [])
  assert.equal(h.data.size, 5)
})
await check('storage failures visibly mark files as temporary but keep the current turn readable', async () => {
  const h = boot([], workspace(), true), m = h.mount()
  await m.ui.add([file('temporary.txt', 'still available')])
  assert.match(m.notices.join(' '), /未能持久保存文件/)
  assert.match(await h.api.content('read', m.ui.refs()), /still available/)
})
await check('asset generator ships same-origin parser, worker, font, CMap and decoder files', () => {
  let generator
  const ctx = { require, hexo: { base_dir: new URL('../../../', import.meta.url).pathname, extend: { generator: { register: (_, fn) => { generator = fn } } } } }
  vm.runInNewContext(readFileSync(new URL('../../../scripts/noimpty-nanaly-file-assets.js', import.meta.url), 'utf8'), ctx)
  const assets = generator().map(x => x.path)
  for (const name of ['pluginsSrc/mammoth/LICENSE', 'pluginsSrc/pdfjs-dist/LICENSE', 'pluginsSrc/mammoth/mammoth.browser.min.js', 'pluginsSrc/pdfjs-dist/build/pdf.min.mjs', 'pluginsSrc/pdfjs-dist/build/pdf.worker.min.mjs']) assert.ok(assets.includes(name))
  for (const dir of ['cmaps', 'standard_fonts', 'wasm']) assert.ok(assets.some(x => x.startsWith('pluginsSrc/pdfjs-dist/' + dir + '/')))
})

await check('draft changes are reported once and silent topic restores preserve saved refs without recursion', async () => {
  const h = boot(), changes = [], m = h.mount({ onChange: refs => changes.push(clone(refs)) })
  await m.ui.add([file('first.txt', 'one')])
  const first = m.ui.refs()
  assert.equal(changes.length, 1); assert.equal(changes[0][0].id, first[0].id)
  m.ui.clear({ silent: true }); assert.equal(changes.length, 1)
  await m.ui.restore(first, { silent: true }); assert.equal(changes.length, 1)
  m.ui.take(); assert.equal(changes.length, 2); assert.equal(changes[1].length, 0)
  await m.ui.restore(first); assert.equal(changes.length, 3)
  m.ui.clear(); assert.equal(changes.length, 4); assert.equal(changes[3].length, 0)
  assert.equal(h.data.size, 1)
})
await check('an old async restore cannot block or overwrite the next topic restore', async () => {
  const docs = ['first', 'second'].map(name => ({ id: 'draft-file-' + name, name, type: 'text', text: name, summary: name }))
  const h = boot(docs), m = h.mount()
  const old = m.ui.restore([docs[0]], { silent: true })
  m.ui.clear({ silent: true })
  const current = m.ui.restore([docs[1]], { silent: true })
  await Promise.all([old, current])
  assert.equal(m.ui.refs()[0].id, docs[1].id)
  assert.equal(m.ui.loading(), false)
})
await check('persisted attachment drafts and clear undo drafts are included in document pruning', async () => {
  const docs = ['saved', 'undo', 'stale'].map(name => ({ id: 'draft-document-' + name, type: 'text', text: name, name, at: Date.now() - 7200000 }))
  const saved = workspace(); saved.sessions[0].draftFiles = [docs[0]]; saved.undo = { draftFiles: [docs[1]] }
  const h = boot(docs, saved)
  await h.api.prune(workspace(), [])
  assert.equal(h.data.size, 2); assert.equal(h.deleted.join(','), docs[2].id)
})


await check('already-cancelled PDFs never start a worker', async () => {
  const { api } = boot(), controller = new AbortController()
  controller.abort()
  let started = 0
  await assert.rejects(api.parsePDF(pdfFixture(1, 'text'), { getDocument() { started++; throw new Error('worker started') } }, controller.signal), { name: 'AbortError' })
  assert.equal(started, 0)
})
await check('PDF extraction stops consuming page text when the character budget is exhausted', async () => {
  const { api } = boot()
  let consumed = 0, destroyed = 0
  const content = { items: { *[Symbol.iterator]() {
    for (let i = 0; i < 100; i++) { consumed++; yield { str: 'x'.repeat(10000), transform: [1, 0, 0, 1, 0, 1] } }
  } } }
  const lib = { getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => content, cleanup() {} }) }), destroy: async () => { destroyed++ } }) }
  const result = await api.parsePDF(pdfFixture(1), lib)
  assert.equal(result.truncated, true)
  assert.match(result.summary, /本页剩余文字未读取/)
  assert.ok(consumed <= 7, 'must not concatenate the entire expanded PDF page')
  assert.equal(destroyed, 1)
})

console.log(`\n${passed} document attachment regression cases passed`)
