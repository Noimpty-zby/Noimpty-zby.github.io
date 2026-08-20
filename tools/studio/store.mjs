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
 *   lessons.md              教训清单。**AI 写的**，每次停更 / 否决往里追加一条。
 *                           探索时必读 —— 它是这套系统唯一的长期记忆。
 *   state.json              全局状态机。AI 每次跑完更新。
 *   explore/YYYY-MM-DD-N.md 探索记录：这一轮扫了哪些方向、结论是什么
 *   projects/<id>/          每个立项一个文件夹
 *     meta.json             状态、版本、已处理到第几条反馈
 *     00-pitch.md ...       策划文档，编号即阅读顺序
 *     CHANGELOG.md          每次修订记录了什么、为什么
 *     POSTMORTEM.md         停更说明（只有停掉的项目才有）
 *   experiments/<id>.json   实验台：从文档里抽出来的可证伪主张 + 主人回填的真实结果
 *   feedback/inbox.json     反馈收件箱。浏览器往里追加，AI 读完标记已处理。
 *                           条目分三种 kind：doc（对文档）/ candidate（对候选方向）
 *                           / experiment（实验结果回填）。
 */

const API = 'https://api.github.com'

export const REPO = process.env.IDEAS_REPO || ''
const TOKEN = process.env.IDEAS_TOKEN || ''

export const hasStore = () => !!(REPO && TOKEN)

export const CHARTER = 'charter.md'
export const LESSONS = 'lessons.md'
export const STATE = 'state.json'
export const EXPLORE_DIR = 'explore'
export const PROJECTS_DIR = 'projects'
export const EXPERIMENTS_DIR = 'experiments'
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
  version: 2,
  updatedAt: '',
  cycle: 0,
  // 探索期累积的方向候选，等着被立项或淘汰
  candidates: [],
  // 被否掉的方向（校验否决 / 评比淘汰 / 主人手动否掉）。
  // 每次探索都会带上 —— 换个名字再端上来一样会被否
  rejected: [],
  // 立项过的项目（含已停更、已标记待定的）
  projects: [],
  // 最近做过什么，避免连续三次都干同一件事
  recentActions: [],
  /* 历史上出现过的赛道。候选池会滚动淘汰旧条目，但「这条赛道扫过了」
   * 这件事不该跟着一起被忘掉 —— 忘掉的代价是半年后又扫一遍同样的角度。 */
  laneHistory: [],
  /* 扫过几轮方向了。单调计数器，只增不减。
   * 不能从候选池里派生 —— 评比和手动否决都会裁剪候选池，
   * 派生值会跟着倒退，把「已经扫够了」这件事凭空抹掉。 */
  exploreDone: 0,
  /* 上一次横向评比针对的候选指纹。同一批候选不重复评比 ——
   * 否则「没有 4 星 → 评比 → 还是没有 4 星 → 评比」会变成新的死循环。 */
  lastShortlist: '',
  /* 跑完之后重算一次，告诉页面「下一轮会做什么」。
   * 纯展示用，决策时不读它 —— 读它就等于把状态机的判断缓存了一份，早晚不一致。 */
  nextPlan: null
})

/* 读状态并补齐新字段。
 * 老仓库里的 state.json 是 version 1，没有 laneHistory / lastShortlist，
 * 不补的话第一次跑就会在 `state.laneHistory.forEach` 上炸。
 * 补齐而不是重建 —— 已有的候选和项目一个都不能丢。 */
export const loadState = async () => {
  const raw = await readJson(STATE, null)
  const base = emptyState()
  if (!raw || typeof raw !== 'object') return base
  return {
    ...base, ...raw,
    candidates: Array.isArray(raw.candidates) ? raw.candidates : [],
    rejected: Array.isArray(raw.rejected) ? raw.rejected : [],
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    recentActions: Array.isArray(raw.recentActions) ? raw.recentActions : [],
    laneHistory: Array.isArray(raw.laneHistory) ? raw.laneHistory : [],
    /* 老 state.json 没有这个字段。用当时候选池的派生值当种子 ——
     * 那是能拿到的最好估计，而且不会比真实轮数大。 */
    exploreDone: Number(raw.exploreDone) ||
      new Set((raw.candidates || []).map(c => c && c.from).filter(Boolean)).size,
    version: 2
  }
}

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

// ---------------- 教训清单 ----------------

/* 为什么单独开一个 lessons.md，而不是往 charter.md 里写：
 *
 * charter.md 是**人写的**，AI 只读不改 —— 这条边界不能破，
 * 破了之后主人就没法信任自己写下的约束了（他会开始怀疑哪一行是它加的）。
 *
 * 但「一个项目死了，死因是什么」这件事必须留下来，而且必须进下一轮探索的上下文，
 * 否则同一个坑会被反复挖。所以另开一个文件，归属清楚：
 * charter 是他的意志，lessons 是它自己的战损记录。 */
export const loadLessons = () => readText(LESSONS)

export const appendLesson = async (entry, message) => {
  const cur = await readText(LESSONS) ||
    '# 教训清单\n\n> 这份文件由策划室自己维护，每次停更或否决往里追加一条。\n' +
    '> 每一轮探索都会带着它跑 —— 所以这里写的必须是**可以拿去检查别的方向**的规则，\n' +
    '> 不是某个项目的流水账。\n'
  const [title, ...rest] = cur.split('\n')
  // 新的写在最前面：最近的教训最可能相关
  await write(LESSONS, `${title}\n\n${entry.trim()}\n\n${rest.join('\n').trim()}\n`,
    message || '策划室：记一条教训')
}

// ---------------- 实验台 ----------------

/* 一个项目一份 JSON，条目形如：
 *   { id, from, claim, prototype, observe, falsify, cost,
 *     status: 'pending' | 'done', result, note, at, doneAt }
 *
 * status 只有两档是故意的。中间态（进行中 / 部分完成）听起来更精确，
 * 实际会变成一个永远停在「进行中」的清单 —— 那比没有清单还糟，
 * 因为它看起来像在推进。要么没做，要么有结果。 */
export const experimentsPath = id => `${EXPERIMENTS_DIR}/${id}.json`

export const loadExperiments = id =>
  readJson(experimentsPath(id), { version: 1, project: id, items: [] })

export const saveExperiments = (id, data, message) =>
  writeJson(experimentsPath(id), data, message || `策划室：${id} 实验台`)

/** 已经有真实结果的实验，拼成给模型看的一手证据。没有就返回空串。 */
export const evidenceText = async id => {
  const data = await loadExperiments(id)
  const done = (data.items || []).filter(x => x.status === 'done')
  if (!done.length) return ''
  return done.map(x =>
    `- 主张：${x.claim}\n  原型：${x.prototype}\n  **他实际做出来的结果：${x.result || '未写'}**${x.note ? `\n  他的说明：${x.note}` : ''}`
  ).join('\n')
}

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
