import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { PRIVATE_CONTENT_NAMES, validatePrivateContent } from '../server/lib/private-content.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fail = message => new Error(message)
const check = (name, value) => {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 1) throw fail('私密资料尚未迁移或版本无效，请先完成后端迁移。')
  validatePrivateContent(name, value.data)
  return structuredClone(value)
}
const conflict = current => {
  const error = Object.assign(fail('私密资料版本冲突，服务器修改已保留，请重新读取后重试。'), { status: 409 })
  // Never include private data when an Error is printed to public Actions logs.
  Object.defineProperty(error, 'current', { value: current })
  return error
}

async function configuredTransport() {
  if (process.env.NANALY_PRIVATE_TEST_DIR || process.env.NANALY_PRIVATE_TEST_MODE) {
    if (process.env.NANALY_PRIVATE_TEST_MODE !== '1' || !process.env.NANALY_PRIVATE_TEST_DIR || !path.isAbsolute(process.env.NANALY_PRIVATE_TEST_DIR)) throw fail('离线私密存储必须显式启用并指定绝对目录。')
    const directory = await fs.realpath(process.env.NANALY_PRIVATE_TEST_DIR)
    const root = await fs.realpath(repoRoot)
    if (directory === root || directory.startsWith(root + path.sep)) throw fail('离线私密测试资料必须位于仓库之外。')
    const read = async name => JSON.parse(await fs.readFile(path.join(directory, name + '.json'), 'utf8'))
    return {
      get: read,
      async put(name, revision, data) {
        const current = await read(name)
        if (current.revision !== revision) throw conflict(current)
        const next = { revision: revision + 1, data }
        const file = path.join(directory, name + '.json'), temporary = file + '.' + randomUUID() + '.tmp'
        await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' })
        await fs.rename(temporary, file)
        return next
      }
    }
  }
  if (!process.env.NANALY_AGENT_URL || !process.env.NANALY_AGENT_TOKEN) throw fail('缺少私密后端配置，自动任务已停止；不会使用公开仓库资料。')
  let origin
  try {
    const url = new URL(process.env.NANALY_AGENT_URL)
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw fail('invalid')
    origin = url.origin
  } catch { throw fail('私密后端地址必须是 HTTPS Origin。') }
  const token = process.env.NANALY_AGENT_TOKEN
  const request = async (name, body) => {
    let response
    try {
      response = await fetch(origin + '/api/automation/private-content/' + name, {
        method: body ? 'PUT' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000), redirect: 'error', credentials: 'omit', cache: 'no-store'
      })
    } catch { throw fail('私密后端连接失败，资料未保存。') }
    const reader = response.body?.getReader(), chunks = []
    let size = 0, result
    try {
      if (!reader) throw fail('私密后端响应为空。')
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 1200000) throw fail('私密后端响应过大。')
        chunks.push(value)
      }
      result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch { throw fail('私密后端响应无效，资料未保存。') }
    finally { await reader?.cancel().catch(() => {}) }
    if (response.status === 409) throw conflict(result)
    if (!response.ok) throw Object.assign(fail('私密后端请求失败（HTTP ' + response.status + '）。'), { status: response.status })
    return result
  }
  return { get: name => request(name), put: (name, revision, data) => request(name, { revision, data }) }
}

// Independent clients let offline tests model two concurrent automation jobs.
export function createPrivateContentClient({ transport } = {}) {
  let backend = transport, loaded = null, tail = Promise.resolve()
  const pending = new Map(), dirty = new Map()
  const ensure = name => {
    if (!PRIVATE_CONTENT_NAMES.includes(name)) throw fail('未知私密资料类型。')
    if (!loaded) throw fail('私密资料尚未加载，自动任务不能继续。')
  }
  const rows = (name, data) => Array.isArray(data) ? data : data[name === 'journal' ? 'entries' : 'runs']
  const merge = (name, data, additions, prune) => {
    const seen = new Set(), combined = [...rows(name, data), ...additions].filter(entry => {
      const key = entry.id || JSON.stringify(entry)
      if (seen.has(key)) return false
      seen.add(key); return true
    })
    const key = name === 'journal' ? 'entries' : 'runs'
    return { ...(Array.isArray(data) ? { v: 1 } : data), [key]: prune(combined) }
  }
  const api = {
    async initialize() {
      loaded = null; pending.clear(); dirty.clear()
      backend ||= await configuredTransport()
      const values = await Promise.all(PRIVATE_CONTENT_NAMES.map(async name => [name, check(name, await backend.get(name))]))
      loaded = Object.fromEntries(values)
    },
    read(name) {
      ensure(name)
      const change = pending.get(name)
      return structuredClone(change ? merge(name, loaded[name].data, change.entries, change.prune) : loaded[name].data)
    },
    replace(name, data) {
      ensure(name)
      if (name !== 'schedule') throw fail('此资料只能通过追加或主人接口修改。')
      validatePrivateContent(name, data)
      loaded[name] = { ...loaded[name], data: structuredClone(data) }; dirty.set(name, Symbol(name))
    },
    append(name, entry, prune = values => values) {
      ensure(name)
      if (!['journal', 'usage'].includes(name)) throw fail('此资料不支持追加。')
      const change = pending.get(name) || { entries: [], prune }
      const next = [...change.entries, structuredClone(entry)]
      validatePrivateContent(name, merge(name, loaded[name].data, next, prune))
      pending.set(name, { entries: next, prune })
    },
    flush(name) {
      ensure(name)
      const operation = tail.then(async () => {
        if (dirty.has(name)) {
          const version = dirty.get(name)
          try {
            const saved = check(name, await backend.put(name, loaded[name].revision, loaded[name].data))
            if (dirty.get(name) === version) { loaded[name] = saved; dirty.delete(name) }
            else {
              // A replacement arrived while PUT was pending. Keep its data and
              // carry the acknowledged revision into the next explicit save.
              loaded[name] = { revision: saved.revision, data: loaded[name].data }
            }
          }
          catch (error) {
            if (error.status === 409) { loaded[name] = check(name, error.current || await backend.get(name)); dirty.delete(name) }
            throw error
          }
          return true
        }
        const change = pending.get(name)
        if (!change?.entries.length) return false
        const batch = [...change.entries]
        for (let attempt = 0; attempt < 4; attempt++) {
          const current = check(name, await backend.get(name))
          const data = merge(name, current.data, batch, change.prune)
          validatePrivateContent(name, data)
          try {
            loaded[name] = check(name, await backend.put(name, current.revision, data))
            const ids = new Set(batch.map(entry => entry.id || JSON.stringify(entry)))
            const queued = pending.get(name)
            queued.entries = queued.entries.filter(entry => !ids.has(entry.id || JSON.stringify(entry)))
            return true
          } catch (error) { if (error.status !== 409 || attempt === 3) throw error }
        }
      })
      tail = operation.catch(() => {})
      return operation
    }
  }
  return api
}

let shared, initializing
export async function initializePrivateContent({ force = false } = {}) {
  if (force) { shared = null; initializing = null }
  if (!initializing) {
    const candidate = createPrivateContentClient()
    initializing = candidate.initialize().then(() => { shared = candidate }, error => {
      shared = null; initializing = null
      throw error
    })
  }
  await initializing
}
const client = () => { if (!shared) throw fail('私密资料尚未加载，自动任务不能继续。'); return shared }
export const readPrivateContent = name => client().read(name)
export const replacePrivateContent = (name, data) => client().replace(name, data)
export const appendPrivateContent = (name, entry, prune) => client().append(name, entry, prune)
export const flushPrivateContent = name => client().flush(name)
