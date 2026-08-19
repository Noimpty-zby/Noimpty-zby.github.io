/* 策划室的仓库层。
 *
 * 所有内容都在**私有仓库**里，博客仓库一个字节都不碰。
 * 三方各自凭 token 访问同一个私有仓库：
 *
 *   策划 AI（GitHub Actions） IDEAS_TOKEN，读写
 *   主人（浏览器）            保险箱里那把 token，读 + 写反馈
 *   博客里的娜娜莉            读页面上已经渲染出来的内容
 *
 * 目录约定（改这里的话，source/js/studio.js 里也要跟着改）：
 *
 *   charter.md              总纲。**人写的**，AI 每次必读，只读不改。
 *   state.json              全局状态机。AI 每次跑完更新。
 *   explore/YYYY-MM-DD.md   探索记录：这一轮扫了哪些方向、结论是什么
 *   projects/<id>/          每个立项一个文件夹
 *     meta.json             状态、版本、已处理到第几条反馈
 *     00-pitch.md ...       策划文档，编号即阅读顺序
 *     CHANGELOG.md          每次修订记录了什么、为什么
 *     POSTMORTEM.md         停更说明（只有停掉的项目才有）
 *   feedback/inbox.json     反馈收件箱。浏览器往里追加，AI 读完标记已处理。
 */

const API = 'https://api.github.com'

export const REPO = process.env.IDEAS_REPO || ''
const TOKEN = process.env.IDEAS_TOKEN || ''

export const hasStore = () => !!(REPO && TOKEN)

export const CHARTER = 'charter.md'
export const STATE = 'state.json'
export const EXPLORE_DIR = 'explore'
export const PROJECTS_DIR = 'projects'
export const INBOX = 'feedback/inbox.json'

const call = async (path, init = {}) => {
  if (!hasStore()) throw new Error('NO_PRIVATE_STORE')
  const res = await fetch(`${API}/repos/${REPO}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'noimpty-studio',
      ...(init.headers || {})
    },
    signal: AbortSignal.timeout(30000)
  })
  const body = await res.json().catch(() => ({}))
  if (res.status === 404) return { notFound: true }
  if (!res.ok) throw new Error(`${res.status} ${body.message || ''}`.trim())
  return body
}

const b64decode = b64 => Buffer.from(String(b64 || '').replace(/\s+/g, ''), 'base64').toString('utf8')
const b64encode = str => Buffer.from(str, 'utf8').toString('base64')

/** 读文本文件。不存在返回 null。 */
export const read = async path => {
  const r = await call(`contents/${encodeURI(path)}`)
  if (r.notFound) return null
  if (r.encoding !== 'base64' || !r.content) return null
  return { text: b64decode(r.content), sha: r.sha }
}

export const readText = async path => (await read(path).catch(() => null))?.text ?? null

/** 写文本文件。已存在就覆盖。 */
export const write = async (path, text, message) => {
  const cur = await call(`contents/${encodeURI(path)}`)
  const body = {
    message: message || `更新 ${path}`,
    content: b64encode(text),
    committer: {
      name: process.env.NANALY_GIT_NAME || '娜娜莉',
      email: process.env.NANALY_GIT_EMAIL || 'nanaly@noimpty-zby.github.io'
    }
  }
  if (!cur.notFound && cur.sha) body.sha = cur.sha
  await call(`contents/${encodeURI(path)}`, { method: 'PUT', body: JSON.stringify(body) })
  return true
}

/** 列目录。返回 [{name, type}]，目录不存在返回 []。 */
export const list = async dir => {
  const r = await call(`contents/${encodeURI(dir)}`)
  if (r.notFound || !Array.isArray(r)) return []
  return r.map(x => ({ name: x.name, type: x.type }))
}

export const listFiles = async dir => (await list(dir)).filter(x => x.type === 'file').map(x => x.name)
export const listDirs = async dir => (await list(dir)).filter(x => x.type === 'dir').map(x => x.name)

// ---------------- JSON 便捷层 ----------------

export const readJson = async (path, fallback) => {
  const raw = await readText(path)
  if (raw == null) return fallback
  try { return JSON.parse(raw) } catch (_) { return fallback }
}

export const writeJson = (path, value, message) =>
  write(path, JSON.stringify(value, null, 2) + '\n', message)

// ---------------- 状态机 ----------------

/* state.json 是这套东西的大脑。它回答一个问题：**下一次该做什么。**
 *
 * 不把这个判断交给模型每次现场想 —— 模型没有记忆，
 * 每次都会倾向于「再探索一个新方向」（那是最省力也最没用的选择）。
 * 状态写在文件里，规则写在代码里，模型只负责在选定的动作里发挥。
 */
export const emptyState = () => ({
  version: 1,
  updatedAt: '',
  cycle: 0,
  // 探索期累积的方向候选，等着被立项或淘汰
  candidates: [],
  // 立项过的项目（含已停更的）
  projects: [],
  // 最近做过什么，避免连续三次都干同一件事
  recentActions: []
})

export const loadState = () => readJson(STATE, emptyState())

export const saveState = (state, message) =>
  writeJson(STATE, { ...state, updatedAt: new Date().toISOString() }, message || '策划室：更新状态')

// ---------------- 反馈收件箱 ----------------

export const loadInbox = () => readJson(INBOX, { version: 1, items: [] })

export const saveInbox = (inbox, message) =>
  writeJson(INBOX, inbox, message || '策划室：更新反馈收件箱')

/** 还没处理的反馈，按项目分组。 */
export const pendingFeedback = inbox =>
  (inbox.items || []).filter(x => x && !x.handled)

// ---------------- 项目 ----------------

export const projectDir = id => `${PROJECTS_DIR}/${id}`

export const loadProjectMeta = id => readJson(`${projectDir(id)}/meta.json`, null)

export const saveProjectMeta = (id, meta, message) =>
  writeJson(`${projectDir(id)}/meta.json`, meta, message || `策划室：更新 ${id} 的元数据`)

/** 一个项目现有的所有文档，按文件名排序 —— 编号前缀保证了这就是阅读顺序。 */
export const projectDocs = async id =>
  (await listFiles(projectDir(id)).catch(() => []))
    .filter(n => n.endsWith('.md'))
    .sort()

/** 读一个项目的全部正文，拼成一份给模型看的上下文。 */
export const projectFullText = async (id, { limit = 60000 } = {}) => {
  const docs = await projectDocs(id)
  const parts = []
  for (const name of docs) {
    const text = await readText(`${projectDir(id)}/${name}`)
    if (text) parts.push(`===== ${name} =====\n${text}`)
  }
  const joined = parts.join('\n\n')
  return joined.length > limit
    ? joined.slice(0, limit) + '\n\n（内容过长，以上为前半部分）'
    : joined
}
