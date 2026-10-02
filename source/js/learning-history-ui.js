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
    node.append(el('h4', '', `第 ${index + 1} 次 · ${labels[value.result.status]}`), el('p', '', time(value.at)), el('p', '', value.explanation || '这次尚未留下复盘说明。'), el('pre', '', value.code))
    if (value.stdin) node.append(el('h5', '', '本次输入'), el('pre', '', value.stdin))
    if (value.tests.length) node.append(el('h5', '', '测试用例'), el('pre', '', JSON.stringify(value.tests, null, 2)))
    node.append(el('h5', '', value.result.evidence === 'terminal' ? '真实终端输出（含终端控制符）' : '真实运行输出'), el('pre', '', [value.result.stdout, value.result.stderr].filter(Boolean).join('\n') || '无文本输出'))
    if (value.result.tests.length) node.append(el('pre', '', JSON.stringify(value.result.tests, null, 2)))
    if (value.result.truncated) node.append(el('p', '', '输出超过保存上限，仅保留前 64 KB。'))
    return node
  }
  const caseView = record => {
    const item = el('article', 'growth-case')
    item.id = record.id
    const first = record.attempts[0]
    item.append(el('h3', '', record.title), el('p', 'growth-meta', `${first.language} · ${record.attempts.length} 次尝试 · ${record.solved ? '已有修正' : '待修正'} · 下次重做 ${time(record.due)}`))
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
  // 复习页（/review/）复习卡下面的「错题重做」：到期的错题、全部错题（收起，可以对照每次尝试）、导出导入。
  // 原来还有一个单独的成长回放页（/growth/），和复习页重复，2026-10-03 合并到这里。
  const render = async (root, token) => {
    const records = await store().list()
    if (token !== version || !store().unlocked()) return
    root.replaceChildren(el('h2', '', '错题重做'))
    const due = records.filter(item => Date.parse(item.due) <= Date.now())
    if (!records.length) root.append(el('p', '', '还没有保存过错题。在练习台运行失败以后点「保存失败现场」，它就会出现在这里，到时间了提醒你重做。'))
    else if (!due.length) root.append(el('p', '', '今天没有要重做的错题。'))
    else {
      root.append(el('p', '', '这些题到了该重做的时间。打开练习台，从最初失败的代码重做，运行以后保存这次尝试；只看一眼不算完成。'))
      for (const item of due) root.append(link(`${item.title} · ${item.attempts[0].language} · 开始重做`, '/learn/?case=' + encodeURIComponent(item.id)))
    }
    if (records.length) {
      const focus = new URL(window.location.href).searchParams.get('case')
      const all = el('details', 'learning-history-all'); all.open = !!focus
      all.append(el('summary', '', `全部错题（${records.length}）`))
      const ordered = [...records].sort((a, b) => (b.id === focus) - (a.id === focus) || b.updatedAt.localeCompare(a.updatedAt))
      for (const value of ordered) all.append(caseView(value))
      root.append(all)
    }
    const status = el('p', 'growth-status', flash); status.setAttribute('role', 'status')
    const controls = el('div', 'growth-actions'), file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true
    controls.append(action('导出错题', async () => {
      try {
        const value = await store().exportData(); if (token !== version) return
        const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
        const a = link('', url); a.download = 'noimpty-learning-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      } catch (error) { status.textContent = error.message }
    }), action('导入错题备份', () => file.click()))
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
    root.append(el('p', 'growth-note', '错题只存在这台浏览器里，换设备之前先导出一份。'), controls, file, status)
  }
  const mount = async () => {
    const review = document.getElementById('review-app')
    let root = document.getElementById('learning-history-review')
    if (review && !root) { root = el('section', 'learning-history-review'); root.id = 'learning-history-review'; review.after(root) }
    if (active && active !== root) { active.replaceChildren(); flash = '' }
    active = root; const token = ++version
    if (!root) return
    if (!store()?.unlocked()) { root.replaceChildren(el('p', '', '解锁以后在这里看错题。')); return }
    try { await render(root, token) }
    catch (error) { if (token === version) root.replaceChildren(el('p', 'review-warn', error.message), action('重试读取', () => mount())) }
  }
  window.addEventListener('learning-history:changed', () => { if (active) void mount() })
  document.addEventListener('pjax:complete', () => { void mount() })
  window.addEventListener('pageshow', () => { void mount() })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void mount() }, { once: true })
  else void mount()
  window.NOIMPTY_LEARNING_HISTORY_UI = Object.freeze({ mount })
})()
