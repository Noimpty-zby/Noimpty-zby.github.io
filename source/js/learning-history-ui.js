/* The public page contains no personal code. All content below is loaded only after the gate. */
(() => {
  'use strict'
  if (window.NOIMPTY_LEARNING_HISTORY_UI) return
  const store = () => window.NOIMPTY_LEARNING_HISTORY
  const el = (tag, cls, value) => { const node = document.createElement(tag); if (cls) node.className = cls; if (value != null) node.textContent = value; return node }
  const link = (label, href) => { const node = el('a', 'learning-history-link', label); node.href = href; return node }
  const time = value => new Date(value).toLocaleString()
  const labels = { accepted: '运行通过', wrong_answer: '测试未通过', compile_error: '编译错误', runtime_error: '运行错误', timeout: '超时', output_limit: '输出超限' }
  let active = null, version = 0, flash = ''
  const action = (label, run) => { const node = el('button', '', label); node.type = 'button'; node.addEventListener('click', run); return node }
  const attemptView = (value, index) => {
    const node = el('section', 'growth-attempt')
    node.append(el('h3', '', `第 ${index + 1} 次 · ${labels[value.result.status]}`), el('p', '', time(value.at)), el('p', '', value.explanation || '这次尚未留下复盘说明。'), el('pre', '', value.code))
    if (value.stdin) node.append(el('h4', '', '本次输入'), el('pre', '', value.stdin))
    if (value.tests.length) node.append(el('h4', '', '测试用例'), el('pre', '', JSON.stringify(value.tests, null, 2)))
    node.append(el('h4', '', value.result.evidence === 'terminal' ? '真实终端输出（含终端控制符）' : '真实运行输出'), el('pre', '', [value.result.stdout, value.result.stderr].filter(Boolean).join('\n') || '无文本输出'))
    if (value.result.tests.length) node.append(el('pre', '', JSON.stringify(value.result.tests, null, 2)))
    if (value.result.truncated) node.append(el('p', '', '输出超过保存上限，仅保留前 64 KB。'))
    return node
  }
  const caseView = record => {
    const item = el('article', 'growth-case')
    item.id = record.id
    const first = record.attempts[0]
    item.append(el('h2', '', record.title), el('p', 'growth-meta', `${first.language} · ${record.attempts.length} 次尝试 · ${record.solved ? '已有修正' : '待修正'} · 下次重做 ${time(record.due)}`))
    if (first.problem) item.append(el('p', 'growth-problem', first.problem))
    if (first.source) item.append(link(`回到《${first.source.title || '来源文章'}》`, first.source.url))
    item.append(el('p', '', '旧解法先收起来。回到练习台，从最初失败现场重做，运行完成后保存这次尝试。'))
    const actions = el('div', 'growth-actions')
    actions.append(link('先重做这道题 ↗', '/learn/?case=' + encodeURIComponent(record.id)))
    const compare = el('div', 'growth-comparison'); compare.hidden = true
    const picks = el('div', 'growth-picks'), panes = el('div', 'growth-panes')
    const selects = ['早先的尝试', '后来的尝试'].map(label => {
      const field = el('label', '', label), select = el('select')
      record.attempts.forEach((attempt, index) => { const option = el('option', '', `第 ${index + 1} 次 · ${labels[attempt.result.status]} · ${time(attempt.at)}`); option.value = String(index); select.append(option) })
      field.append(select); picks.append(field); return select
    })
    selects[1].value = String(record.attempts.length - 1)
    const refresh = () => { panes.replaceChildren(...selects.map(select => attemptView(record.attempts[Number(select.value)], Number(select.value)))) }
    selects.forEach(select => select.addEventListener('change', refresh))
    compare.append(picks, panes)
    actions.append(action('重做后对照不同尝试', () => { compare.hidden = !compare.hidden; if (!compare.hidden) refresh() }))
    item.append(actions, compare)
    return item
  }
  const renderQueue = async (root, token) => {
    const records = await store().list()
    if (token !== version || !store().unlocked()) return
    root.replaceChildren(el('h2', '', '回到真实现场重做'))
    root.append(el('p', '', '这里的题来自你保存的实际失败。打开练习台运行新尝试、保存结果后，再按 FSRS 安排下一次；翻卡不会算作完成。'))
    const due = records.filter(item => Date.parse(item.due) <= Date.now())
    if (!due.length) root.append(el('p', '', '暂时没有到期的操作题。可在练习台保存失败现场，之后回到这里重做。'))
    for (const item of due) root.append(link(`${item.title} · ${item.attempts[0].language} · 开始重做`, '/learn/?case=' + encodeURIComponent(item.id)))
    root.append(link('查看成长回放与备份 ↗', '/growth/'))
  }
  const renderGrowth = async (root, token) => {
    const records = await store().list()
    if (token !== version || !store().unlocked()) return
    root.replaceChildren()
    const title = el('p', 'growth-intro', '不只记下做对了什么，也留下从哪里卡住、怎样想通。私人代码只存在这台浏览器；换设备前请导出备份。')
    const status = el('p', 'growth-status', flash); status.setAttribute('role', 'status')
    const controls = el('div', 'growth-actions'), file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true
    controls.append(action('导出全部学习现场', async () => {
      try {
        const value = await store().exportData(); if (token !== version) return
        const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
        const a = link('', url); a.download = 'noimpty-learning-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      } catch (error) { status.textContent = error.message }
    }), action('合并导入备份', () => file.click()))
    file.addEventListener('change', async () => {
      const chosen = file.files?.[0]; file.value = ''; if (!chosen) return
      try {
        if (chosen.size > 25000000) throw new Error('备份超过 25 MB，请先在原设备分批整理。')
        const value = JSON.parse(await chosen.text()); if (token !== version || !store().unlocked()) return
        const result = await store().importData(value)
        if (active !== root || !store().unlocked()) return
        flash = `已合并 ${result.cases} 个错题现场；旧记录仍保留。`
        await mount()
      } catch (error) { if (token === version) status.textContent = `未导入：${error.message}` }
    })
    const stats = el('div', 'growth-stats')
    for (const [value, label] of [[records.length, '真实错题'], [records.filter(x => x.solved).length, '已经修正'], [records.reduce((n, x) => n + x.attempts.length, 0), '留下的尝试'], [records.filter(x => Date.parse(x.due) <= Date.now()).length, '到期重做']]) stats.append(el('p', '', `${value} · ${label}`))
    root.append(title, controls, file, status, stats)
    if (!records.length) root.append(el('p', 'growth-empty', '你的成长记录还留着空位。在代码小屋真实运行一次，把失败现场保存下来；修正后保存新尝试，这里就能并排回看。'), link('去代码小屋试一试 ↗', '/learn/'))
    const focus = new URL(window.location.href).searchParams.get('case')
    const ordered = [...records].sort((a, b) => (b.id === focus) - (a.id === focus) || b.updatedAt.localeCompare(a.updatedAt))
    for (const value of ordered) root.append(caseView(value))
  }
  const mount = async () => {
    const growth = document.getElementById('learning-growth'), review = document.getElementById('review-app')
    let root = growth || document.getElementById('learning-history-review')
    if (!growth && review && !root) { root = el('section', 'learning-history-review'); root.id = 'learning-history-review'; review.before(root) }
    if (active && active !== root) { active.replaceChildren(); flash = '' }
    active = root; const token = ++version
    if (!root) return
    if (!store()?.unlocked()) { root.replaceChildren(el('p', '', '解锁私人学习空间后查看成长记录。')); return }
    try { await (growth ? renderGrowth(root, token) : renderQueue(root, token)) }
    catch (error) { if (token === version) root.replaceChildren(el('p', 'review-warn', error.message), action('重试读取', () => mount())) }
  }
  window.addEventListener('learning-history:changed', () => { if (active) void mount() })
  document.addEventListener('pjax:complete', () => { void mount() })
  window.addEventListener('pageshow', () => { void mount() })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void mount() }, { once: true })
  else void mount()
  window.NOIMPTY_LEARNING_HISTORY_UI = Object.freeze({ mount })
})()
