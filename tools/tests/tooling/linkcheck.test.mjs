import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const script = resolve('tools/checks/linkcheck.mjs')
const fixture = (t, files) => {
  const root = mkdtempSync(join(tmpdir(), 'linkcheck-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), body)
  }
  return spawnSync(process.execPath, [script], { encoding: 'utf8',
    env: { ...process.env, LINKCHECK_ROOT: root, LINKCHECK_SITE: 'https://example.invalid' } })
}

test('empty output and empty HTML cannot pass a build validation', t => {
  for (const files of [{}, { 'index.html': ' \n\t' }]) {
    const result = fixture(t, files)
    assert.equal(result.status, 1, result.stdout + result.stderr)
  }
})

test('links in all HTML attribute forms and same-origin protocol-relative URLs are checked', t => {
  const result = fixture(t, { 'index.html':
    '<a href="/double/">D</a><a HREF = \'/single/\'>S</a><img SRC=/bare.png><a href="//example.invalid/protocol/">P</a>' })
  assert.equal(result.status, 1)
  for (const target of ['/double/', '/single/', '/bare.png', '/protocol/']) assert.ok(result.stdout.includes(target), result.stdout)
})

test('browser URL resolution, encoded filenames and HTML entities resolve without false positives', t => {
  const result = fixture(t, {
    'index.html': '<a href="/sub/">sub</a><script src="/bundle.js">const x="<a href=\'/not-a-link/\'>";</script><!-- <img src="/not-a-link.png"> -->',
    'bundle.js': '// fixture',
    'sub/index.html': '<a href="../index.html?x=1&amp;y=2">home</a><img src=../a&#38;b.png><a href="../hash%23tag.html">hash</a><a href="tel:123">call</a><a href="https://external.invalid/missing">external</a><a href="//external.invalid/missing">external</a><a href="#section">anchor</a><a title="fake href=/missing" href="../index.html">home</a><img title="not > a tag" src="../a&amp;b.png">',
    'a&b.png': 'fixture',
    'hash#tag.html': '<p>ok</p>'
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /没有死链/)
})

test('lazy-loaded image targets are checked even when src is a data placeholder', t => {
  const result = fixture(t, { 'index.html': '<img src="data:image/png,placeholder" data-src="/lazy-missing.png">' })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /lazy-missing\.png/)
})

test('quoted greater-than signs stay inside URLs and quoted fake attributes are ignored', t => {
  const missing = fixture(t, { 'index.html': '<a href="/a>b/">missing</a>' })
  assert.equal(missing.status, 1)
  assert.match(missing.stdout, /\/a%3Eb\//)
  const valid = fixture(t, { 'index.html': '<a title=" src=\'ghost\' " href="/">home</a>' })
  assert.equal(valid.status, 0, valid.stdout + valid.stderr)
})
