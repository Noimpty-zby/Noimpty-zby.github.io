/* 赛道（亮点来源）枚举 + 四维打分。
 *
 * 为什么要有这个文件：**多样性不能靠提示词，得靠代码。**
 *
 * 上一版在探索提示词里写了整整一屏的「多样性硬要求」——「亮点来源必须不同」
 * 「品类必须不同」「拿掉总纲第四节还站得住」，甚至写了「违反了整轮作废」。
 * 实证结果：第一轮扫出来的三个方向是
 *   单键处决 / 读招训练 / 后处理过载战斗
 * ——**全部是近战动作 + 时机判定**，也就是总纲第四节那个「振刀」的三种说法。
 * 然后系统照着其中一个立了项，主人连点两次「停掉」。
 *
 * 提示词里的软约束，模型会点头答应然后照旧。要拦住它只有一个办法：
 * **让它在结构化的字段里做选择，然后由代码去查这个字段。**
 *
 * 所以现在每个方向必须声明一条赛道（从下面固定的枚举里选），代码会：
 *   - 一轮之内赛道撞车 → 撞车的那些直接降分，并在日志里点名
 *   - 历史上已经扫过很多次的赛道 → 下一轮的提示词里明确要求换
 *   - 主亮点落在「纯代码表现层」→ 直接压分（见下面 mainOk 的注释）
 */

/* 九条赛道。每条对应 UE5 能力账本第一栏里的一类 ——
 * 也就是「好不好看取决于代码」的那一类。
 *
 * 枚举是**封闭**的：模型只能选，不能自己发明一条。
 * 发明的余地留在「具体做什么」上，不留在「靠什么好看」上 ——
 * 后者的选项本来就是有限的，假装它无限只会让分类失效。 */
export const LANES = [
  {
    id: 'proc-gen', name: '程序化生成',
    hint: 'PCG 关卡拼装、程序化建模、波函数坍缩、规则驱动的地形与建筑',
    talk: '关卡连通性约束、可重复随机、生成结果的可玩性校验'
  },
  {
    id: 'physics', name: '物理与破坏',
    hint: 'Chaos 破坏与约束、结构受力、布料、软体、载具',
    talk: '约束求解的稳定性、破碎体的性能预算、确定性与可重现'
  },
  {
    id: 'geometry', name: '运行时几何',
    hint: 'Geometry Script 的布尔 / 切割 / 生长 / 形变 / 拼装',
    talk: '动态网格的重建时机、碰撞体同步、UV 与材质接缝'
  },
  {
    id: 'shader', name: '材质与后处理',
    hint: '屏幕空间效果、风格化渲染管线、体积、Compute Shader、SDF',
    talk: '渲染管线插点的选择、采样开销、深度与法线的复用'
  },
  {
    id: 'simulation', name: '大规模模拟',
    hint: 'Mass Entity 群体、生态、元胞自动机、格点流体、蚁群与扩散',
    talk: '数据布局与缓存、调度分帧、规模与帧率的取舍'
  },
  {
    id: 'time', name: '时间与因果',
    hint: '录制回放、时间倒流、确定性重演、并行时间线、状态快照',
    talk: '状态序列化的粒度、浮点确定性、回放与实时的一致性'
  },
  {
    id: 'space', name: '空间与视角',
    hint: '非欧空间、传送门、视角依赖的几何、尺度变换、投影玩法',
    talk: '相机与裁剪、递归渲染的层数控制、物理与渲染空间不一致'
  },
  {
    id: 'emergence', name: '规则涌现',
    hint: '极简规则涌现出复杂行为的系统（注意：不是行为树，他没学过）',
    talk: '规则集的最小化、可预测性与惊喜的平衡、参数空间的调试手段'
  },
  {
    id: 'code-feel', name: '纯代码表现层',
    hint: '顿帧、镜头位移、时间缩放、屏幕反馈、打击感',
    talk: '（几乎没有可讲的技术难点 —— 这一条基本都是调参）'
  }
]

export const LANE_IDS = LANES.map(l => l.id)
export const laneById = id => LANES.find(l => l.id === id) || null
export const laneName = id => (laneById(id) || {}).name || id || '未标注'

/* 「纯代码表现层」不能当主赛道。
 *
 * 它是调味料，不是主菜：顿帧、镜头、屏幕震动都是几十行的事，
 * 做得再好也没有技术追问的空间（面试官问三句就到底了），
 * 截图里也看不出来（评委翻页就过去了）—— 两条评分维度同时归零。
 *
 * 而「振刀」那一类恰恰全部落在这里。上一版之所以拦不住它，
 * 就是因为「亮点来源」这件事当时根本没有被表达成一个可检查的字段。 */
export const mainOk = laneId => laneId !== 'code-feel'

export const laneMenu = () => LANES.map(l =>
  `  - \`${l.id}\`（${l.name}）：${l.hint}${l.id === 'code-feel' ? ' ⛔ **不能作为主赛道**' : ''}`
).join('\n')

// ---------------- 四维打分 ----------------

export const DIMS = [
  { key: 'glance', name: '一眼可辨', what: '截图或前十秒里有没有一个没见过的画面' },
  { key: 'talk', name: '技术讲点', what: '能撑起多久的技术追问' },
  { key: 'ship', name: '可完成', what: '75 人日内能不能做到完整而不只是能跑' },
  { key: 'unique', name: '独特', what: '在评委那一堆作品里是不是又一个' }
]

const clamp = n => Math.max(1, Math.min(5, Math.round(Number(n) || 0) || 1))

/* 汇总规则：**短板决定上限。**
 *
 * 上一版的「参考指数」是模型自己给自己打的一个总分，那等于让它给自己的
 * 信心打分 —— 它当然有信心。改成四维之后还有第二个坑：模型会用
 * 「其它三项满分」去补一个致命短板，算出来平均分照样很高。
 *
 * 但这四维在现实里不是可加的，是**串联**的：
 * 截图里看不出差别（glance=1），后面三项再高，评委也翻页了。
 * 所以上限压在「最低那一维 + 1」。要拿 4 星，四维都得至少 3。
 */
export const rollup = dims => {
  const g = clamp(dims.glance), t = clamp(dims.talk)
  const s = clamp(dims.ship), u = clamp(dims.unique)
  const all = [g, t, s, u]
  const avg = all.reduce((a, b) => a + b, 0) / 4
  const stars = Math.max(1, Math.min(Math.round(avg), Math.min(...all) + 1))
  return { glance: g, talk: t, ship: s, unique: u, stars }
}

/* 从模型输出里抽一个方向的四维分。
 * 容错：写「一眼可辨：4/5」「**技术讲点** — 3」「可完成 3 分」都能吃下。
 * 抽不到的维度按 3 处理（不奖不罚），并标记 partial ——
 * 调用方会在日志里说明这个方向的分是残缺的。 */
export const parseDims = block => {
  const text = String(block || '')
  const pick = (name) => {
    const re = new RegExp(`${name}[^\\n\\d]{0,12}?(\\d)\\s*(?:/\\s*5)?`, '')
    const m = text.match(re)
    return m ? Number(m[1]) : null
  }
  const raw = {
    glance: pick('一眼可辨'), talk: pick('技术讲点'),
    ship: pick('可完成'), unique: pick('独特')
  }
  const missing = Object.entries(raw).filter(([, v]) => v == null).map(([k]) => k)
  const dims = rollup({
    glance: raw.glance ?? 3, talk: raw.talk ?? 3,
    ship: raw.ship ?? 3, unique: raw.unique ?? 3
  })
  return { ...dims, partial: missing.length ? missing : null }
}

/* 从一个方向的正文里抽赛道 id。
 * 认两种写法：`proc-gen` 这样的 id，或者「程序化生成」这样的中文名。 */
export const parseLane = block => {
  const text = String(block || '')
  const line = (text.match(/^\s*\**\s*赛道\s*\**\s*[:：]\s*(.+)$/m) || [])[1] || ''
  const hay = line || text.slice(0, 400)
  const byId = LANES.find(l => new RegExp(`\\b${l.id}\\b`).test(hay))
  if (byId) return byId.id
  const byName = LANES.find(l => hay.includes(l.name))
  return byName ? byName.id : null
}

/* 一轮之内的赛道撞车处理。
 *
 * 不把撞车的方向删掉 —— 删掉会让整轮探索看起来颗粒无收，
 * 而且第二个撞车的方向本身可能写得更好。做法是：**同一赛道只留分最高的一个
 * 保持原分，其余的降到 2 星**（2 星进不了立项，但仍然留在记录里可查）。
 *
 * 没标赛道的方向按撞车处理 —— 不标就是绕过检查，成本必须比标高。 */
export const dedupeLanes = candidates => {
  const best = new Map()
  candidates.forEach(c => {
    const key = c.lane || '__unlabeled__'
    const cur = best.get(key)
    if (!cur || (c.stars || 0) > (cur.stars || 0)) best.set(key, c)
  })
  const collisions = []
  const out = candidates.map(c => {
    const key = c.lane || '__unlabeled__'
    if (best.get(key) === c) return c
    collisions.push({ title: c.title, lane: key, was: c.stars })
    return { ...c, stars: Math.min(c.stars || 2, 2), laneCollision: true }
  })
  return { candidates: out, collisions }
}

/** 历史上每条赛道被扫过几次 —— 喂回探索提示词，要求换没扫过的。 */
export const laneHistogram = state => {
  const counts = Object.fromEntries(LANE_IDS.map(id => [id, 0]))
  const bump = lane => { if (lane && counts[lane] != null) counts[lane]++ }
  ;(state.candidates || []).forEach(c => bump(c.lane))
  ;(state.rejected || []).forEach(r => bump(r.lane))
  ;(state.projects || []).forEach(p => bump(p.lane))
  ;(state.laneHistory || []).forEach(bump)
  return counts
}

/** 从没扫过的赛道 —— 提示词里点名要求这一轮至少覆盖其中之一。 */
export const coldLanes = state => {
  const h = laneHistogram(state)
  return LANE_IDS.filter(id => id !== 'code-feel' && !h[id])
}
