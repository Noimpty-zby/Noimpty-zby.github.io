import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const boot = kind => {
  const requests = [], databases = []
  const image = kind === 'images'
  const indexedDB = { open() {
    const request = {}
    requests.push(request)
    return request
  } }
  const window = { indexedDB }
  const source = readFileSync(new URL(`../../../source/js/nanaly-${image ? 'vision' : 'files'}.js`, import.meta.url), 'utf8')
  vm.runInNewContext(source, { window, indexedDB })
  const api = image ? window.NANALY_VISION : window.NANALY_FILES
  const read = id => (image ? api.imageContent : api.content)('read', [{ id, type: image ? 'image/jpeg' : 'text', name: id }])
  const succeed = index => {
    const db = { closed: 0, close() { this.closed++ }, transaction() {
      assert.equal(this.closed, 0, 'a closed connection must not be reused')
      const tx = { objectStore: () => ({ get: id => {
        const req = { result: { id, name: id, type: image ? 'image/jpeg' : 'text',
          dataURL: 'data:image/jpeg;base64,AA==', text: 'saved body', images: [], summary: 'saved summary' } }
        queueMicrotask(() => tx.oncomplete())
        return req
      } }) }
      return tx
    } }
    databases.push(db)
    requests[index].result = db
    requests[index].onsuccess()
    return db
  }
  return { read, requests, databases, succeed }
}

for (const kind of ['images', 'files']) {
  await test(`${kind}: external version change closes and invalidates only its own cached connection`, async () => {
    const h = boot(kind)
    const first = h.read('attachment-first'); const old = h.succeed(0); await first
    old.onversionchange()
    assert.equal(old.closed, 1)
    const second = h.read('attachment-second'); h.succeed(1); await second
    old.onclose()
    await h.read('attachment-third')
    assert.equal(h.requests.length, 2, 'a late close event must not clear a replacement connection')
  })

  await test(`${kind}: unexpected database closure permits the next attachment read to reopen`, async () => {
    const h = boot(kind)
    const first = h.read('attachment-first'); const old = h.succeed(0); await first
    old.close(); old.onclose()
    const second = h.read('attachment-second'); h.succeed(1); await second
    assert.equal(h.requests.length, 2)
  })

  await test(`${kind}: a blocked open that later succeeds is closed while retry remains usable`, async () => {
    const h = boot(kind)
    const first = h.read('attachment-first')
    h.requests[0].onblocked()
    await assert.rejects(first, /重新附加/)
    const second = h.read('attachment-second')
    const stale = h.succeed(0)
    assert.equal(stale.closed, 1, 'discarded open must not leak a database lock')
    h.succeed(1); await second
    await h.read('attachment-third')
    assert.equal(h.requests.length, 2)
  })
}
