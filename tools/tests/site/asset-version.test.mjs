/* 我们自己的 js / css 必须带内容指纹。
 *
 * 2026-09-17 踩到：日程页改坏了又修好、部署也成功了，主人刷新看到的还是坏的 ——
 * 浏览器手上那份 /js/schedule.js 是缓存里的旧文件。主题自己的资源本来就带
 * ?v=5.7.0，而 _config.butterfly.yml 里我们手写的那十六行一个都没有。
 *
 * GitHub Pages 给的是 max-age=600，而 PJAX 换页压根不会重新取脚本 ——
 * 一个开着的标签页可以抱着旧代码很久。这种事没法靠盯着解决，只能让 URL 变。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import vm from 'node:vm'

let pass = 0
const check = async (name, fn) => {
  try { await fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const CFG = readFileSync('_config.butterfly.yml', 'utf8')
const SRC = readFileSync('scripts/noimpty-asset-version.js', 'utf8')
// The migration page deliberately excludes normal writers and loads its own assets.
const ASSET_PAGES = CFG + '\n' + readFileSync('source/backup/index.html', 'utf8')

console.log('\n静态资源 · 缓存失效')

await check('★★ 加版本号的过滤器还在，而且挂在 after_render:html 上', () => {
  assert.match(SRC, /filter\.register\('after_render:html'/,
    '过滤器没了 —— 以后每次改 js/css，浏览器都可能继续用旧的')
  assert.match(SRC, /createHash/, '版本号不是按内容算的话，改了也不会变')
})

await check('★★ 用内容哈希，不是时间戳/随机数', () => {
  /* 时间戳会让每次构建的 URL 都变，等于把缓存整个关掉 ——
   * 站上有 428 个文件，每次部署全部重新下载。内容没变就不该变。 */
  assert.ok(!/Date\.now\(\)|Math\.random/.test(SRC), '用了时间戳或随机数，缓存等于白做')
})

await check('★ 只管我们自己的，主题的和生成的原样放过', () => {
  assert.match(SRC, /hexo\.source_dir/, '应该从 source/ 里找文件')
  // 找不到源文件时必须返回原字符串，不能拼一个空的 ?v=
  assert.match(SRC, /return h \? .+ : whole/, '找不到文件时没有原样放过')
})

console.log('\n静态资源 · inject 与独立页面里的清单')

await check('★★ inject 里我们自己的 js/css，在 source 下都真实存在', () => {
  /* 写错一个路径的话，那个文件就静默地不加载 —— 页面少一块功能，不报错。
   * 顺带这条也保证上面那个哈希一定算得出来。 */
  const refs = [...ASSET_PAGES.matchAll(/(?:src|href)="\/((?:js|css)\/[^"?]+\.(?:js|css))"/g)].map(m => m[1])
  assert.ok(refs.length >= 10, `只从 inject 里找到 ${refs.length} 条引用，是不是格式变了`)
  const missing = refs.filter(r => {
    try { readFileSync('source/' + r); return false } catch (_) { return true }
  })
  // protected-manifest 是构建时生成的，source 里本来就没有
  assert.deepEqual(missing.filter(m => !m.includes('protected-manifest')), [],
    '这几个 inject 引用在 source/ 下找不到文件：\n      ' + missing.join('\n      '))
})

await check('★ source/js 和 source/css 下的文件都被 inject 或独立页面引用了（别写了没挂上）', () => {
  const refs = new Set([...ASSET_PAGES.matchAll(/(?:src|href)="\/((?:js|css)\/[^"?]+)"/g)].map(m => m[1]))
  const have = [
    ...readdirSync('source/js').filter(f => f.endsWith('.js')).map(f => 'js/' + f),
    ...readdirSync('source/css').filter(f => f.endsWith('.css')).map(f => 'css/' + f)
  ]
  const orphan = have.filter(f => !refs.has(f))
  assert.deepEqual(orphan, [], '这几个文件写了但没挂进页面：\n      ' + orphan.join('\n      '))
})

await check('独立备份route与真实资源内容一起更新指纹，保留独立结构和watch缓存失效', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nanaly-asset-route-'))
  try {
    mkdirSync(join(dir, 'js')); mkdirSync(join(dir, 'css'))
    writeFileSync(join(dir, 'js/nanaly-backup.js'), 'const fixture = 1')
    writeFileSync(join(dir, 'css/nanaly-backup.css'), 'body{color:red}')
    const filters = new Map(), writes = [], routes = new Map()
    const page = '<!doctype html><title>Backup</title><script src="/js/protected-manifest.js"></script>'
      + '<script src="/js/nanaly-backup.js"></script><link href="/css/nanaly-backup.css">'
      + '<script src="/js/theme.js?v=5.7.0"></script>'
    routes.set('backup/index.html', page); routes.set('index.html', '<main>Untouched</main>')
    const hexo = { source_dir: dir, __noimptyPrivacyVersion: '111111111111',
      extend: { filter: { register(name, fn) { filters.set(name, fn) } } },
      route: { get(name) { return routes.has(name) ? Readable.from([routes.get(name)]) : null },
        set(name, value) { writes.push(name); routes.set(name, value) } } }
    vm.runInNewContext(SRC, { hexo, require: createRequire(import.meta.url) })
    const hash = body => createHash('sha1').update(body).digest('hex').slice(0, 8)
    filters.get('before_generate')(); await filters.get('after_generate')()
    const first = routes.get('backup/index.html')
    assert.ok(first.includes('/js/nanaly-backup.js?v=' + hash('const fixture = 1')))
    assert.ok(first.includes('/css/nanaly-backup.css?v=' + hash('body{color:red}')))
    assert.ok(first.includes('/js/protected-manifest.js?v=111111111111'))
    assert.ok(first.includes('/js/theme.js?v=5.7.0'))
    assert.equal(routes.get('index.html'), '<main>Untouched</main>')
    assert.equal((first.match(/<script /g) || []).length, 3)
    assert.ok(first.startsWith('<!doctype html><title>Backup</title>'))
    assert.deepEqual(writes, ['backup/index.html'])
    await filters.get('after_generate')(); assert.equal(writes.length, 1)
    // Watch builds may retain the rewritten route; before_generate must still
    // invalidate source hashes and update both existing URLs and manifest hash.
    writeFileSync(join(dir, 'js/nanaly-backup.js'), 'const fixture = 2')
    hexo.__noimptyPrivacyVersion = '222222222222'
    filters.get('before_generate')(); await filters.get('after_generate')()
    const second = routes.get('backup/index.html')
    assert.ok(second.includes('/js/nanaly-backup.js?v=' + hash('const fixture = 2')))
    assert.ok(second.includes('/js/protected-manifest.js?v=222222222222'))
    assert.ok(second.includes('/css/nanaly-backup.css?v=' + hash('body{color:red}')))
    assert.equal((second.match(/\?v=/g) || []).length, 4)
    assert.equal(filters.get('after_render:html')(page), second)
    routes.delete('backup/index.html'); await filters.get('after_generate')()
    assert.deepEqual(writes, ['backup/index.html', 'backup/index.html'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

console.log(`\n${pass} 项通过`)
