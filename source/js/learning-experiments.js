/* Local, deterministic teaching models. No network calls and no automatic code execution. */
(() => {
  'use strict'

  const arrayFrames = ({ values, capacity = 8, operation, index, value = 0 }) => {
    if (!Array.isArray(values) || values.some(x => !Number.isInteger(x) || Math.abs(x) > 999)) throw new Error('数组元素应为 -999 到 999 的整数。')
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 12 || values.length > capacity) throw new Error('元素个数不能超过容量。')
    if (!['insert', 'delete'].includes(operation)) throw new Error('请选择插入或删除。')
    const n = values.length
    if (!Number.isInteger(index) || index < 0 || index > (operation === 'insert' ? n : n - 1)) throw new Error(operation === 'insert' ? `插入下标应在 0 到 ${n} 之间。` : n ? `删除下标应在 0 到 ${n - 1} 之间。` : '空数组没有可删除的元素。')
    if (operation === 'insert' && n === capacity) throw new Error('容量已满：必须先扩容或删除元素，不能写到 A[size]。')
    if (!Number.isInteger(value) || Math.abs(value) > 999) throw new Error('插入值应为 -999 到 999 的整数。')
    const slots = values.concat(Array(capacity - n).fill(null)), frames = []
    let length = n, moves = 0
    const push = (text, code, from = null, to = null) => frames.push({ slots: slots.slice(), length, moves, text, code, from, to })
    push('先看初始状态。下标从 0 开始；虚线槽位位于逻辑长度之外。', `length = ${n}, size = ${capacity}`)
    if (operation === 'insert') {
      for (let i = n; i > index; i--) {
        slots[i] = slots[i - 1]; moves++
        push(`把下标 ${i - 1} 的 ${slots[i]} 复制到下标 ${i}。从右向左挪，才能保住还没复制的值。`, `A[${i}] = A[${i - 1}]`, i - 1, i)
      }
      slots[index] = value
      push(`空出了插入位置，写入 ${value}。这次写入不计入「原元素移动」。`, `A[${index}] = ${value}`, null, index)
      length++
      push(`length 加 1。共移动 ${moves} 个原元素，即 n - index；尾部插入移动 0 次。`, 'length += 1')
    } else {
      push(`记住待删除的值 ${slots[index]}，随后用右边的元素覆盖这个位置。`, `removed = A[${index}]`, index)
      for (let i = index; i < n - 1; i++) {
        slots[i] = slots[i + 1]; moves++
        push(`把下标 ${i + 1} 的 ${slots[i]} 复制到下标 ${i}。删除从左向右挪。`, `A[${i}] = A[${i + 1}]`, i + 1, i)
      }
      length--
      push(`length 减 1。共移动 ${moves} 个元素，即 n - index - 1。尾槽的旧值还在，但已不属于数组。`, 'length -= 1')
    }
    return frames
  }

  const arrayCode = config => {
    arrayFrames(config)
    const { values, capacity = 8, operation, index, value = 0 } = config
    return `# 数组 ADT：用固定槽位模拟 C 数组，不使用 list.insert/pop\nA = ${JSON.stringify(values)} + [None] * ${capacity - values.length}\nlength, size, index = ${values.length}, ${capacity}, ${index}\nmoves = 0\nprint("初始槽位", A, "length =", length)\n` +
      (operation === 'insert'
        ? `assert 0 <= index <= length < size\nfor i in range(length, index, -1):\n    A[i] = A[i - 1]\n    moves += 1\n    print(f"A[{i}] = A[{i - 1}]", A)\nA[index] = ${value}\nlength += 1\n`
        : 'assert 0 <= index < length\nremoved = A[index]\nfor i in range(index, length - 1):\n    A[i] = A[i + 1]\n    moves += 1\n    print(f"A[{i}] = A[{i + 1}]", A)\nlength -= 1\nprint("删除值", removed)\n') +
      'print("物理槽位", A)\nprint("逻辑数组", A[:length])\nprint("移动次数", moves)\n'
  }

  const gitInitial = () => ({ commits: [{ id: 'C0', parent: null, lane: 0 }], branches: { main: 'C0' }, lanes: { main: 0 }, head: 'main', detached: null, nextLane: 1, commands: [] })
  const gitHead = state => state.head === null ? state.detached : state.branches[state.head]
  const gitStep = (before, action) => {
    const state = JSON.parse(JSON.stringify(before))
    const name = String(action.name || '')
    if (action.type === 'branch') {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,19}$/.test(name) || name === 'HEAD') throw new Error('分支名用字母开头的 1–20 个字母、数字、- 或 _，不能叫 HEAD。')
      if (Object.hasOwn(state.branches, name)) throw new Error(`分支 ${name} 已经存在。`)
      if (Object.keys(state.branches).length >= 5) throw new Error('这个小实验最多同时展示 5 个分支；可以重置后再试。')
      state.branches[name] = gitHead(state); state.lanes[name] = state.nextLane++
      state.message = `创建 ${name}，它也指向 ${gitHead(state)}。HEAD 没动，没有复制提交。`
      state.command = `git branch ${name}`
    } else if (action.type === 'switch') {
      if (!Object.hasOwn(state.branches, name)) throw new Error('请选择已有分支。')
      state.head = name; state.detached = null
      state.message = `HEAD 现在指向分支 ${name}，沿这个引用读到 ${gitHead(state)}。`
      state.command = `git switch ${name}`
    } else if (action.type === 'detach') {
      if (!state.commits.some(commit => commit.id === name)) throw new Error('请选择已有提交。')
      state.head = null; state.detached = name; state.detachedLane = state.nextLane++
      state.message = `HEAD 直接指向 ${name}，处于分离状态；后续提交不会推动任何分支。`
      state.command = `git switch --detach ${name}`
    } else if (action.type === 'commit') {
      if (state.commits.length >= 14) throw new Error('已达到 14 个提交的展示上限，请重置后再试。')
      const commit = { id: `C${state.commits.length}`, parent: gitHead(state), lane: state.head === null ? state.detachedLane : state.lanes[state.head] }
      state.commits.push(commit)
      if (state.head === null) state.detached = commit.id
      else state.branches[state.head] = commit.id
      state.message = state.head === null ? `新增 ${commit.id}，只有 HEAD 移动；切回分支后，仍可用提交号找到它（回收前）。` : `新增 ${commit.id}，只有当前分支 ${state.head} 向前移动；其他分支留在原处。`
      state.command = `git commit --allow-empty -m "${commit.id}"`
      action = { type: 'commit', id: commit.id }
    } else throw new Error('未知的演示操作。')
    state.commands.push({ ...action })
    return state
  }

  const gitCode = state => {
    const lines = ['# 在独立临时仓库复现；不会修改现有项目。C0/C1 是提交消息，不是哈希。', 'set -eu', 'lab=$(mktemp -d)', 'cd "$lab"', 'git init -q --initial-branch=main', 'git config user.name "Learning Experiment"', 'git config user.email "experiment@example.invalid"', 'git -c commit.gpgsign=false commit -q --allow-empty -m C0', 'c0=$(git rev-parse HEAD)']
    for (const action of state.commands) {
      if (action.type === 'branch') lines.push(`git branch ${action.name}`)
      if (action.type === 'switch') lines.push(`git switch ${action.name}`)
      if (action.type === 'detach') lines.push(`git switch --detach "$${action.name.toLowerCase()}"`)
      if (action.type === 'commit') lines.push(`git -c commit.gpgsign=false commit -q --allow-empty -m ${action.id}`, `${action.id.toLowerCase()}=$(git rev-parse HEAD)`)
    }
    lines.push('git log --all --graph --decorate --oneline ' + state.commits.map(commit => `"$${commit.id.toLowerCase()}"`).join(' '), 'printf "\\nHEAD: "', 'git symbolic-ref --short -q HEAD || git rev-parse --short HEAD', 'git for-each-ref --format="%(refname:short) -> %(subject)" refs/heads', '# 分离 HEAD 的提交也保留了 c0/c1/... 变量，可用 git show "$c1" 查看。')
    return lines.join('\n') + '\n'
  }

  const TRIANGLE = [[0.1, 0.15], [0.9, 0.15], [0.5, 0.9]]
  const barycentric = (point, triangle = TRIANGLE) => {
    const [[ax, ay], [bx, by], [cx, cy]] = triangle, [x, y] = point
    const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(denominator) < 1e-12) throw new Error('三个顶点共线，无法定义重心坐标。')
    const a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denominator
    const b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denominator
    const weights = [a, b, 1 - a - b]
    return { weights, inside: weights.every(weight => weight >= -1e-9 && weight <= 1 + 1e-9), rgb: weights.map(weight => Math.round(Math.max(0, Math.min(1, weight)) * 255)) }
  }

  const barycentricCode = point => `# 屏幕空间的线性重心插值；这里没有透视校正\nA, B, C = (0.1, 0.15), (0.9, 0.15), (0.5, 0.9)\nP = (${point.join(', ')})\nax, ay = A\nbx, by = B\ncx, cy = C\nx, y = P\nd = (by-cy)*(ax-cx) + (cx-bx)*(ay-cy)\nassert abs(d) > 1e-12, "退化三角形"\na = ((by-cy)*(x-cx) + (cx-bx)*(y-cy)) / d\nb = ((cy-ay)*(x-cx) + (ax-cx)*(y-cy)) / d\nc = 1-a-b\ninside = all(-1e-9 <= w <= 1+1e-9 for w in (a,b,c))\nprint("重心坐标", a, b, c, "总和", a+b+c)\nprint("重建P", (a*ax+b*bx+c*cx, a*ay+b*by+c*cy))\nif inside:\n    print("覆盖：RGB", tuple(int(max(0, min(1, w))*255 + 0.5) for w in (a,b,c)))\nelse:\n    print("三角形外：不为这个采样点着色")\n`

  const models = { arrayFrames, arrayCode, gitInitial, gitHead, gitStep, gitCode, barycentric, barycentricCode, TRIANGLE }
  if (typeof module === 'object' && module.exports) { module.exports = models; return }
  if (window.NOIMPTY_EXPERIMENTS) return

  const el = (tag, cls, text) => { const item = document.createElement(tag); if (cls) item.className = cls; if (text != null) item.textContent = text; return item }
  const svgEl = (tag, attrs, text) => { const item = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs || {})) item.setAttribute(key, String(value)); if (text != null) item.textContent = text; return item }
  const button = (text, callback, cls = '') => { const item = el('button', cls, text); item.type = 'button'; item.addEventListener('click', callback); return item }
  const field = (text, input) => { const label = el('label', 'le-field'); label.append(el('span', '', text), input); return label }
  const input = (value, min, max) => { const item = el('input'); item.type = 'number'; item.value = value; item.min = min; item.max = max; item.step = '1'; return item }
  const select = options => { const item = el('select'); for (const [value, text] of options) { const option = el('option', '', text); option.value = value; item.append(option) } return item }
  const announce = () => { const item = el('p', 'le-status'); item.setAttribute('role', 'status'); item.setAttribute('aria-live', 'polite'); item.setAttribute('aria-atomic', 'true'); return item }
  let sequence = 0

  const codeBridge = (host, getSnippet) => {
    const wrap = el('div', 'le-export'), status = announce()
    const send = button('把当前实验代码放进练习台 ↗', async () => {
      send.disabled = true; status.textContent = ''
      try {
        if (typeof window.LEARNING_LAB?.openSnippet !== 'function') throw new Error('练习台尚未就绪，请展开下方代码并复制，或刷新页面后重试。')
        const result = await window.LEARNING_LAB.openSnippet({ ...getSnippet(), sourceUrl: window.location.href })
        status.textContent = result?.loaded === false ? '已取消，原草稿保留。' : '代码已送到练习台；核对后再点击运行。'
      } catch (error) { status.textContent = error.message || '载入失败；可以展开代码手动复制。' }
      finally { send.disabled = false }
    })
    const details = el('details', 'le-code'), summary = el('summary', '', '查看 / 复制完整代码（不会自动运行）'), pre = el('pre'), code = el('code')
    pre.append(code); details.append(summary, pre)
    const refresh = () => { try { code.textContent = getSnippet().code } catch (error) { code.textContent = error.message } }
    details.addEventListener('toggle', refresh)
    wrap.append(send, details, status); host.append(wrap)
    return refresh
  }

  const mountArray = host => {
    let config = { values: [10, 20, 30, 40, 50], capacity: 8, operation: 'insert', index: 2, value: 99 }
    let frames = arrayFrames(config), position = 0
    const controls = el('div', 'le-controls'), values = el('input'), operation = select([['insert', '插入'], ['delete', '删除']]), index = input(2, 0, 5), value = input(99, -999, 999)
    values.type = 'text'; values.value = config.values.join(', '); values.setAttribute('inputmode', 'text'); values.maxLength = 60
    const valueField = field('插入值', value)
    controls.append(field('初始数组（逗号分隔，最多 8 个）', values), field('操作', operation), field('下标 index', index), valueField)
    const cells = el('div', 'le-array'), metrics = el('p', 'le-metrics'), narration = announce(), instruction = el('code', 'le-instruction'), error = announce(), actions = el('div', 'le-actions')
    const updateMode = () => { value.disabled = operation.value === 'delete'; valueField.classList.toggle('is-muted', value.disabled); index.max = String(Math.max(0, values.value.trim() ? values.value.split(/[,，]/).length - (value.disabled ? 1 : 0) : 0)) }
    operation.addEventListener('change', updateMode); values.addEventListener('input', updateMode)
    const render = () => {
      const frame = frames[position]; cells.replaceChildren()
      frame.slots.forEach((item, i) => {
        const cell = el('div', 'le-cell' + (i >= frame.length ? ' is-unused' : '') + (i === frame.to ? ' is-target' : '') + (i === frame.from ? ' is-source' : ''))
        cell.setAttribute('role', 'group')
        cell.setAttribute('aria-label', `下标 ${i}，${item == null ? '未写入值' : `值 ${item}`}，${i >= frame.length ? '逻辑长度之外' : '有效元素'}${i === frame.to ? '，正在写入' : i === frame.from ? '，正在读取' : ''}`)
        cell.append(el('span', 'le-index', `[${i}]`), el('strong', '', item == null ? '·' : String(item)), el('small', '', i === frame.to ? '写入' : i === frame.from ? '读取' : i >= frame.length ? '未用' : '有效'))
        cells.append(cell)
      })
      metrics.textContent = `length = ${frame.length} / size = 8　原元素移动 ${frame.moves} 次　步骤 ${position + 1} / ${frames.length}`
      narration.textContent = frame.text; instruction.textContent = frame.code
      previous.disabled = position === 0; next.disabled = position === frames.length - 1
      refreshCode()
    }
    const start = button('应用参数，从头观察', () => {
      try {
        const raw = values.value.trim(), parts = raw ? raw.split(/[,，]/).map(part => part.trim()) : []
        if (parts.some(part => !/^-?\d+$/.test(part)) || index.value === '' || (operation.value === 'insert' && value.value === '')) throw new Error('请填写整数；空数组可以留空，元素之间用逗号分隔。')
        const proposed = { values: parts.map(Number), capacity: 8, operation: operation.value, index: Number(index.value), value: value.value === '' ? 0 : Number(value.value) }
        const nextFrames = arrayFrames(proposed)
        config = proposed; frames = nextFrames; position = 0; error.textContent = ''; render()
      } catch (problem) { error.textContent = problem.message }
    })
    const previous = button('← 上一步', () => { if (position > 0) { position--; render() } }), next = button('下一步 →', () => { if (position < frames.length - 1) { position++; render() } })
    const reset = button('重置', () => { config = { values: [10, 20, 30, 40, 50], capacity: 8, operation: 'insert', index: 2, value: 99 }; values.value = config.values.join(', '); operation.value = 'insert'; index.value = '2'; value.value = '99'; frames = arrayFrames(config); position = 0; error.textContent = ''; updateMode(); render() })
    actions.append(start, previous, next, reset)
    host.append(controls, error, cells, metrics, instruction, narration, actions, el('p', 'le-note', '先猜：在头部和尾部各插入一次，移动次数差多少？数组的逻辑长度由 length 决定，槽位里有旧值不代表它仍是有效元素。'))
    const refreshCode = codeBridge(host, () => ({ language: 'python', title: '数组 ADT：逐格移动', code: arrayCode(config) }))
    render()
  }

  const mountGit = host => {
    let history = [gitInitial()], position = 0, demoPosition = 0
    const uid = `le-git-arrow-${++sequence}`
    const branch = el('input'); branch.type = 'text'; branch.value = 'feature'; branch.maxLength = 20; branch.autocomplete = 'off'; branch.spellcheck = false
    const branches = select([]), commits = select([]), controls = el('div', 'le-controls'), actions = el('div', 'le-actions'), replay = el('div', 'le-actions')
    const status = announce(), error = announce(), refs = el('div', 'le-refs'), graphWrap = el('div', 'le-graph-wrap'), graph = svgEl('svg', { role: 'img', 'aria-label': '提交图：圆圈是提交，箭头指向父提交；HEAD 和分支引用见下方文字。' })
    graphWrap.append(graph)
    const command = el('code', 'le-instruction'), log = el('ol', 'le-git-log')
    const apply = action => {
      try { const state = gitStep(history[position], action); history = history.slice(0, position + 1); history.push(state); position++; error.textContent = ''; render(); return true }
      catch (problem) { error.textContent = problem.message; return false }
    }
    controls.append(field('新分支名', branch), field('切换到分支', branches), field('直接指向提交', commits))
    actions.append(button('创建分支', () => apply({ type: 'branch', name: branch.value.trim() })), button('切换分支', () => apply({ type: 'switch', name: branches.value })), button('新建空提交', () => apply({ type: 'commit' })), button('分离 HEAD', () => apply({ type: 'detach', name: commits.value })))
    const previous = button('← 回看上一步', () => { if (position > 0) { position--; render() } }), next = button('回看下一步 →', () => { if (position < history.length - 1) { position++; render() } })
    const demo = [{ type: 'branch', name: 'feature' }, { type: 'switch', name: 'feature' }, { type: 'commit' }, { type: 'switch', name: 'main' }, { type: 'commit' }, { type: 'detach', name: 'C1' }, { type: 'commit' }, { type: 'switch', name: 'main' }]
    const demoButton = button('示范下一条', () => {
      if (demoPosition === 0) { history = [gitInitial()]; position = 0 }
      if (apply(demo[demoPosition])) { demoPosition++; demoButton.disabled = demoPosition === demo.length }
    })
    const reset = button('重置', () => { history = [gitInitial()]; position = 0; demoPosition = 0; demoButton.disabled = false; branch.value = 'feature'; error.textContent = ''; render() })
    replay.append(previous, next, demoButton, reset)
    const refill = (menu, options) => { const chosen = menu.value; menu.replaceChildren(); options.forEach(value => { const option = el('option', '', value); option.value = value; menu.append(option) }); if (options.includes(chosen)) menu.value = chosen }
    const render = () => {
      const state = history[position], head = gitHead(state)
      refill(branches, Object.keys(state.branches)); refill(commits, state.commits.map(commit => commit.id))
      refs.replaceChildren(el('strong', 'le-head', state.head === null ? `HEAD → ${head}（分离）` : `HEAD → ${state.head} → ${head}`))
      for (const [name, id] of Object.entries(state.branches)) refs.append(el('span', name === state.head ? 'is-current' : '', `${name} → ${id}`))
      const lanes = [...new Set(state.commits.map(commit => commit.lane))], width = Math.max(540, state.commits.length * 78 + 60), height = Math.max(130, lanes.length * 78 + 45)
      graph.setAttribute('viewBox', `0 0 ${width} ${height}`); graph.style.minWidth = `${width}px`; graph.style.height = `${height}px`; graph.replaceChildren()
      const defs = svgEl('defs'), marker = svgEl('marker', { id: uid, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' })
      marker.append(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'le-edge-arrow' })); defs.append(marker); graph.append(defs)
      const location = new Map(state.commits.map((commit, i) => [commit.id, [40 + i * 78, 45 + lanes.indexOf(commit.lane) * 78]]))
      for (const commit of state.commits) {
        const [x, y] = location.get(commit.id)
        if (commit.parent) { const [px, py] = location.get(commit.parent); graph.append(svgEl('path', { d: `M ${x - 19} ${y} C ${(x + px) / 2} ${y}, ${(x + px) / 2} ${py}, ${px + 21} ${py}`, class: 'le-edge', 'marker-end': `url(#${uid})` })) }
      }
      for (const commit of state.commits) {
        const [x, y] = location.get(commit.id), group = svgEl('g', { class: commit.id === head ? 'le-commit is-head' : 'le-commit' })
        if (commit.id === head) group.append(svgEl('circle', { cx: x, cy: y, r: 25, class: 'le-head-ring' }))
        group.append(svgEl('circle', { cx: x, cy: y, r: 18 }), svgEl('text', { x, y: y + 5, 'text-anchor': 'middle' }, commit.id)); graph.append(group)
      }
      status.textContent = state.message || '起点：main 指向 C0，HEAD 指向 main。创建分支以后，先观察 HEAD 是否变化。'
      command.textContent = state.command || 'git init -b main; git commit --allow-empty -m C0'
      log.replaceChildren(); state.commits.forEach(commit => log.append(el('li', '', `${commit.id} 的父提交：${commit.parent || '无（根提交）'}`)))
      previous.disabled = position === 0; next.disabled = position === history.length - 1
      refreshCode()
    }
    host.append(el('p', 'le-note', '这里模拟干净工作区中的引用移动：用空提交省去文件编辑，不模拟暂存区、合并或冲突。C0、C1 是教学编号。箭头由子提交指向父提交。'), controls, actions, error, graphWrap, refs, command, status, replay)
    const details = el('details'); details.append(el('summary', '', '用文字读提交关系'), log); host.append(details)
    host.append(el('p', 'le-note', '「示范下一条」第一次会从起点演示分叉与分离 HEAD。手动探索后可重置再演示；回看后执行新命令，会从该历史状态继续。'))
    const refreshCode = codeBridge(host, () => ({ language: 'git', title: 'Git 引用与 HEAD 实验', code: gitCode(history[position]) }))
    render()
  }

  const mountBarycentric = host => {
    let point = [0.5, 0.4], step = 0
    const toScreen = ([x, y]) => [20 + x * 480, 320 - y * 300]
    const stage = el('div', 'le-triangle-stage'), canvas = el('canvas'), graphic = svgEl('svg', { viewBox: '0 0 520 340', tabindex: '0', role: 'group', 'aria-label': '移动采样点 P：使用方向键，按住 Shift 加速；也可拖动或使用下方坐标滑块。' })
    canvas.width = 520; canvas.height = 340; canvas.setAttribute('aria-hidden', 'true')
    const context = canvas.getContext('2d')
    if (context) {
      const image = context.createImageData(520, 340)
      for (let y = 0; y < 340; y++) for (let x = 0; x < 520; x++) {
        const result = barycentric([(x - 20) / 480, (320 - y) / 300])
        if (result.inside) { const offset = (y * 520 + x) * 4; image.data.set([...result.rgb, 255], offset) }
      }
      context.putImageData(image, 0, 0)
    }
    stage.append(canvas, graphic)
    const controls = el('div', 'le-controls'), x = input(50, 0, 100), y = input(40, 0, 100)
    x.type = 'range'; y.type = 'range'
    controls.append(field('P 的 x 坐标（0%–100%）', x), field('P 的 y 坐标（0%–100%）', y))
    const steps = el('div', 'le-actions'), presets = el('div', 'le-actions'), metrics = el('div', 'le-weights'), explanation = announce(), coordinate = el('p', 'le-metrics'), swatch = el('span', 'le-swatch'), resultText = el('span'), result = el('div', 'le-color')
    result.append(swatch, resultText)
    const labels = ['1. 判断覆盖', '2. 计算权重', '3. 插值颜色']
    const stepButtons = labels.map((text, i) => button(text, () => { step = i; render() }))
    steps.append(...stepButtons)
    const setPoint = (value, nextStep = step) => { point = value.map(v => Math.max(0, Math.min(1, v))); step = nextStep; render() }
    for (const [label, location] of [['顶点 A', TRIANGLE[0]], ['顶点 B', TRIANGLE[1]], ['顶点 C', TRIANGLE[2]], ['重心', [0.5, 0.4]], ['三角形外', [0.08, 0.85]]]) presets.append(button(label, () => setPoint(location.slice())))
    presets.append(button('重置', () => setPoint([0.5, 0.4], 0)))
    const fromPointer = event => { const box = graphic.getBoundingClientRect(); setPoint([((event.clientX - box.left) / box.width * 520 - 20) / 480, (320 - (event.clientY - box.top) / box.height * 340) / 300]) }
    graphic.addEventListener('pointerdown', event => { if (event.button !== 0) return; graphic.setPointerCapture(event.pointerId); fromPointer(event); graphic.focus({ preventScroll: true }) })
    graphic.addEventListener('pointermove', event => { if (graphic.hasPointerCapture(event.pointerId)) fromPointer(event) })
    const release = event => { if (graphic.hasPointerCapture(event.pointerId)) graphic.releasePointerCapture(event.pointerId) }
    graphic.addEventListener('pointerup', release); graphic.addEventListener('pointercancel', release)
    graphic.addEventListener('keydown', event => {
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key]
      if (!direction) return
      event.preventDefault(); const distance = event.shiftKey ? 0.05 : 0.01
      setPoint(point.map((value, i) => value + direction[i] * distance))
    })
    x.addEventListener('input', () => setPoint([Number(x.value) / 100, point[1]])); y.addEventListener('input', () => setPoint([point[0], Number(y.value) / 100]))
    const render = () => {
      const calculated = barycentric(point), { weights, inside, rgb } = calculated, [px, py] = toScreen(point)
      x.value = String(point[0] * 100); y.value = String(point[1] * 100)
      x.setAttribute('aria-valuetext', point[0].toFixed(2)); y.setAttribute('aria-valuetext', point[1].toFixed(2))
      coordinate.textContent = `P = (${point[0].toFixed(3)}, ${point[1].toFixed(3)})；坐标原点在左下角。`
      graphic.replaceChildren()
      graphic.append(svgEl('path', { d: 'M 20 20 V 320 H 500', class: 'le-axis' }), svgEl('text', { x: 497, y: 336 }, 'x'), svgEl('text', { x: 5, y: 18 }, 'y'))
      const vertices = TRIANGLE.map(toScreen)
      graphic.append(svgEl('polygon', { points: vertices.map(p => p.join(',')).join(' '), class: 'le-triangle-outline' }))
      vertices.forEach(([vx, vy], i) => {
        if (step >= 1) graphic.append(svgEl('line', { x1: px, y1: py, x2: vx, y2: vy, class: 'le-area-line' }))
        graphic.append(svgEl('circle', { cx: vx, cy: vy, r: 5, class: 'le-vertex' }), svgEl('text', { x: vx + (i === 1 ? -12 : 12), y: vy + (i === 2 ? -12 : 24), 'text-anchor': i === 1 ? 'end' : 'start' }, `${'ABC'[i]} ${['红', '绿', '蓝'][i]}`))
      })
      graphic.append(svgEl('circle', { cx: px, cy: py, r: 9, class: 'le-sample-halo' }), svgEl('circle', { cx: px, cy: py, r: 5, class: 'le-sample' }), svgEl('text', { x: Math.min(px + 14, 495), y: Math.max(py - 12, 16), class: 'le-sample-label' }, 'P'))
      stepButtons.forEach((item, i) => item.setAttribute('aria-pressed', String(step === i)))
      metrics.hidden = step < 1; result.hidden = step < 2; canvas.style.opacity = step < 2 ? '.12' : '1'
      metrics.replaceChildren(...weights.map((weight, i) => el('span', weight < -1e-9 ? 'is-negative' : '', `${['α（A）', 'β（B）', 'γ（C）'][i]} = ${weight.toFixed(3)}`)), el('span', '', `总和 = ${weights.reduce((a, b) => a + b, 0).toFixed(3)}`))
      swatch.style.backgroundColor = inside ? `rgb(${rgb.join(',')})` : 'transparent'; resultText.textContent = inside ? `RGB = (${rgb.join(', ')})` : '在三角形外：这个采样点不着色。'
      explanation.textContent = step === 0
        ? (inside ? 'P 在三角形内或边界上，覆盖测试通过。试着移到三角形外，再看下一步。' : 'P 在三角形外，覆盖测试不通过。下一步看看哪个权重变成了负数。')
        : step === 1 ? 'P = αA + βB + γC，且 α + β + γ = 1。权重来自有向子三角形面积的比值；全部非负时，P 位于三角形内（含边界）。'
          : '颜色 = α(255,0,0) + β(0,255,0) + γ(0,0,255)。靠近一个顶点，它的颜色占比就更大。此处演示屏幕空间线性插值，不包含透视校正。'
      refreshCode()
    }
    host.append(el('p', 'le-note', '先移动 P 再揭开下一步。拖动、触屏、方向键和坐标滑块都可用；Shift + 方向键每次移动 5%。'), stage, controls, coordinate, presets, steps, metrics, result, explanation)
    const refreshCode = codeBridge(host, () => ({ language: 'python', title: '重心坐标与颜色插值', code: barycentricCode(point) }))
    render()
  }

  const mounts = { array: mountArray, git: mountGit, barycentric: mountBarycentric }
  const mount = () => {
    for (const root of document.querySelectorAll('.learning-experiment[data-experiment]')) {
      if (root.dataset.experimentMounted) continue
      const create = mounts[root.dataset.experiment], host = root.querySelector('[data-experiment-mount]')
      if (!create || !host) continue
      try { host.replaceChildren(); create(host); root.dataset.experimentMounted = 'yes' }
      catch (_) { host.replaceChildren(el('p', 'le-status', '实验暂时无法初始化，请刷新后重试。文章正文仍可阅读。')) }
    }
  }
  // There are no timers or document-bound drag handlers. Old DOM can be collected
  // after PJAX; canceled navigation retains the existing experiment and progress.
  for (const type of ['pjax:complete', 'pjax:error', 'pjax:abort', 'pjax:cancel']) window.addEventListener(type, mount)
  window.addEventListener('pageshow', mount)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
  else mount()
  window.NOIMPTY_EXPERIMENTS = Object.freeze({ mount, ...models })
})()
