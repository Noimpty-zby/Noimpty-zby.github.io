import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const repo = process.cwd()
const sandbox = async fn => {
  const dir = mkdtempSync(join(tmpdir(), 'backend-audit-'))
  try { return await fn(dir) } finally { process.chdir(repo); rmSync(dir, { recursive: true, force: true }) }
}
const gitAt = dir => (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
const identity = git => { git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'commit.gpgsign', 'false') }
process.env.GITHUB_TOKEN = 'offline-fixture'
process.env.SITE_URL = 'https://example.invalid'
globalThis.fetch = async () => { throw new Error('Unexpected network call') }
const { autoComplete } = await import('../../daily-report/schedule-auto.mjs')
const { commitJournal, FILE: JOURNAL } = await import('../../nanaly/journal.mjs')
const { pushWithRetry } = await import('../../nanaly/git.mjs')
const { getComments } = await import('../../daily-report/sources.mjs')
const { crawlSite } = await import('../../daily-report/health.mjs')

await test('automation commits only its own files, including usage before the first journal exists', async () => sandbox(async dir => {
  mkdirSync(join(dir, 'source/_data'), { recursive: true })
  const git = gitAt(dir)
  git('init', '-q'); identity(git)
  writeFileSync(join(dir, 'owner.txt'), 'original')
  git('add', '.'); git('commit', '-qm', 'baseline')
  writeFileSync(join(dir, 'owner.txt'), 'private staged work')
  git('add', 'owner.txt')
  const usage = 'source/_data/nanaly-usage.json'
  writeFileSync(join(dir, usage), '{"runs":[]}\n')
  process.chdir(dir)
  const run = (...args) => args[0] === 'push' ? '' : git(...args)
  assert.equal(existsSync(JOURNAL), false)
  assert.equal(await commitJournal({ run, extra: [usage] }), false)
  assert.deepEqual(git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').trim().split('\n'), [usage])
  assert.equal(git('diff', '--cached', '--name-only').trim(), 'owner.txt')
  assert.equal(git('show', 'HEAD:owner.txt'), 'original')
  writeFileSync(JOURNAL, '{"entries":[]}\n')
  assert.equal(await commitJournal({ run }), true)
  assert.deepEqual(git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').trim().split('\n'), [JOURNAL])
  assert.equal(git('diff', '--cached', '--name-only').trim(), 'owner.txt')
}))

await test('a concurrent conflicting push retains the local commit and staged owner work, and aborts the rebase', async () => sandbox(async dir => {
  const origin = join(dir, 'origin.git'), local = join(dir, 'local'), other = join(dir, 'other')
  execFileSync('git', ['init', '--bare', '--initial-branch=main', origin], { stdio: 'pipe' })
  execFileSync('git', ['clone', origin, local], { stdio: 'pipe' })
  const git = gitAt(local); identity(git)
  writeFileSync(join(local, 'data.json'), 'baseline\n'); writeFileSync(join(local, 'owner.txt'), 'baseline\n')
  git('add', '.'); git('commit', '-qm', 'baseline'); git('push', '-u', 'origin', 'main')
  execFileSync('git', ['clone', origin, other], { stdio: 'pipe' })
  const remote = gitAt(other); identity(remote)
  writeFileSync(join(other, 'data.json'), 'remote update\n'); remote('commit', '-qam', 'remote'); remote('push')
  writeFileSync(join(local, 'data.json'), 'local update\n'); git('commit', '-qam', 'local')
  const head = git('rev-parse', 'HEAD')
  writeFileSync(join(local, 'owner.txt'), 'staged owner work\n'); git('add', 'owner.txt')
  assert.throws(() => pushWithRetry(git, 'fixture'), /推送失败/)
  assert.equal(git('rev-parse', 'HEAD'), head)
  assert.equal(readFileSync(join(local, 'data.json'), 'utf8'), 'local update\n')
  assert.equal(readFileSync(join(local, 'owner.txt'), 'utf8'), 'staged owner work\n')
  assert.equal(existsSync(join(local, '.git/rebase-merge')), false)
  assert.equal(existsSync(join(local, '.git/rebase-apply')), false)
  // Git autostash restores the worktree, but does not promise to re-stage it.
  assert.match(git('status', '--porcelain'), /owner\.txt/)
}))

await test('invalid schedule JSON, impossible dates and duplicate ids fail without modifying data', async () => sandbox(async dir => {
  mkdirSync(join(dir, 'source/_data'), { recursive: true }); process.chdir(dir)
  const file = 'source/_data/schedule.json'
  const task = { id: 'a', text: 'task', done: false, when: { type: 'post', match: 'x' } }
  for (const raw of ['broken', 'null', JSON.stringify({ days: { '2026-02-30': [task] } }),
    JSON.stringify({ days: { '2026-01-01': [task, task] } }), JSON.stringify({ days: { '2026-01-01': [{ ...task, done: 'false' }] } })]) {
    writeFileSync(file, raw)
    await assert.rejects(autoComplete(), /日程数据无效/)
    assert.equal(readFileSync(file, 'utf8'), raw)
  }
}))

await test('reply completion can recover from a missed daily report without exposing old bodies in the report', async () => sandbox(async dir => {
  mkdirSync(join(dir, 'source/_data'), { recursive: true }); mkdirSync(join(dir, 'source/_posts'), { recursive: true })
  const at = new Date(Date.now() - 2 * 86400000).toISOString()
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(Date.now() - 3 * 86400000))
  const connection = nodes => ({ nodes, pageInfo: { hasPreviousPage: false, hasNextPage: false } })
  const before = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.redirect, 'error')
    return Response.json({ data: { repository: { discussions: connection([{
    id: 'd', title: 'post/', reactions: connection([]), comments: connection([{ id: 'c', body: 'old private body', createdAt: at,
      author: { login: 'owner' }, replies: connection([]) }])
  }]) } } })
  }
  let comments
  try { comments = await getComments() } finally { globalThis.fetch = before }
  assert.equal(comments.ok, true)
  assert.deepEqual(comments.items, [])
  assert.equal(comments.completionSignals.length, 1)
  assert.doesNotMatch(JSON.stringify(comments.completionSignals), /private body/)
  const git = gitAt(dir); git('init', '-q'); identity(git); git('commit', '--allow-empty', '-qm', 'baseline')
  process.chdir(dir)
  writeFileSync('source/_data/schedule.json', JSON.stringify({ days: { [day]: [{ id: 'reply', text: 'reply', done: false, when: { type: 'reply' } }] } }))
  assert.equal((await autoComplete({ ownerLogin: 'owner', comments })).changed, 1)
}))

await test('the health crawler rejects hostname-prefix impostors', async () => {
  const before = globalThis.fetch, fetched = []
  globalThis.fetch = async url => {
    fetched.push(url)
    if (url.includes('protected-manifest')) return new Response('window.NOIMPTY_PRIVACY = Object.freeze({"entries":[{"path":"/post/"}]});')
    return new Response('<a href="https://example.invalid.evil.test/private">evil</a><a href="https://example.invalid@evil.test/private">evil</a><a href="/real/">real</a>')
  }
  try {
    const result = await crawlSite()
    assert.ok(fetched.some(url => url === 'https://example.invalid/real/'))
    assert.ok(fetched.every(url => new URL(url).origin === 'https://example.invalid'))
    assert.ok([...result.targets].every(url => new URL(url).origin === 'https://example.invalid'))
  } finally { globalThis.fetch = before }
})

await test('workflow input is data, rejects injected actions, and repository writers share a concurrency group', async () => sandbox(async dir => {
  const workflow = yaml.load(readFileSync(join(repo, '.github/workflows/nanaly.yml'), 'utf8'))
  const daily = yaml.load(readFileSync(join(repo, '.github/workflows/daily-report.yml'), 'utf8'))
  assert.equal(workflow.concurrency.group, daily.concurrency.group)
  const pick = workflow.jobs.live.steps.find(step => step.id === 'pick')
  const output = join(dir, 'output'), marker = join(dir, 'injected')
  const execute = action => spawnSync('bash', ['-e', '-c', pick.run], { encoding: 'utf8', env: {
    ...process.env, EVENT_NAME: 'workflow_dispatch', INPUT_WHAT: action, INPUT_DRY: 'true', GITHUB_OUTPUT: output
  } })
  assert.equal(execute(`reply$(touch ${marker})`).status, 1)
  assert.equal(existsSync(marker), false)
  assert.equal(existsSync(output), false)
  assert.equal(execute('reply').status, 0)
  assert.equal(readFileSync(output, 'utf8'), 'what=reply\ndry=--dry\n')
  for (const step of workflow.jobs.live.steps) if (step.run) assert.doesNotMatch(step.run, /\$\{\{.*(?:inputs\.|steps\.pick\.outputs)/)
}))

await test('both model-generated page writers disable executable Hexo tags in their real output', async () => sandbox(async dir => {
  mkdirSync(join(dir, 'source/_posts'), { recursive: true })
  const entry = new URL('../../nanaly/column.mjs', import.meta.url).href
  const newsEntry = new URL('../../nanaly/news.mjs', import.meta.url).href
  const source = `
    process.argv.push('--dry');
    let logs=[]; console.log=(...args)=>logs.push(args.join(' '));
    globalThis.fetch=async(url,init)=> {
      if (init.redirect !== 'error') throw new Error('API redirects must be refused');
      if (String(url).includes('tavily')) return Response.json({results:[{title:'测试资讯',url:'https://example.invalid/source',content:'测试资讯内容'}]});
      const body=JSON.parse(init.body); const prompt=body.messages.map(m=>m.content).join(' ');
      const text=prompt.includes('短随笔') ? '标题：测试随笔\\n===正文===\\n{% fixture %}\\n'+ '有真实材料的正文。'.repeat(30)
        : prompt.includes('开场白') ? '{% fixture %}' : '- [0] 测试资讯 {% fixture %}';
      return Response.json({choices:[{message:{content:text},finish_reason:'stop'}]});
    };
    await (await import(${JSON.stringify(entry)})).writeColumn();
    await (await import(${JSON.stringify(newsEntry)})).buildNews();
    process.stdout.write(JSON.stringify(logs));
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: dir, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, DEEPSEEK_API_KEY: 'fixture', TAVILY_API_KEY: 'fixture', GITHUB_TOKEN: '' } })
  assert.equal(child.status, 0, child.stderr)
  const logs = JSON.parse(child.stdout)
  const pages = logs.filter(line => line.startsWith('    ---')).map(line => line.replace(/^    /gm, ''))
  assert.equal(pages.length, 2)
  const Hexo = require('hexo'), MarkdownIt = require('markdown-it'), fm = require('hexo-front-matter')
  const hexo = new Hexo(dir, { silent: true })
  hexo.extend.renderer.register('md', 'html', ({ text }) => new MarkdownIt({ html: true }).render(text), true)
  hexo.extend.tag.register('fixture', () => '<img src=x onerror=fixture()>')
  const vulnerable = await hexo.post.render(null, { engine: 'md', content: '{% fixture %}' })
  assert.match(vulnerable.content, /onerror=/)
  for (const page of pages) {
    const data = fm.parse(page)
    assert.equal(data.disableNunjucks, true)
    const result = await hexo.post.render(null, { ...data, engine: 'md', content: data._content })
    assert.doesNotMatch(result.content, /onerror=/)
    assert.match(result.content, /\{% fixture %\}/)
  }
}))
