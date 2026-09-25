import assert from 'node:assert/strict'
import fs, { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync, readdirSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { prepareModel, buildModel } from '../../assets/build-live2d-model.mjs'

const root = mkdtempSync(join(tmpdir(), 'blog-live2d-import-'))
const runtime = join(root, 'runtime'), output = join(root, 'output')
mkdirSync(runtime)
const modelPath = join(runtime, 'sample.model3.json')
const writeModel = overrides => writeFileSync(modelPath, JSON.stringify({
  Version: 3, FileReferences: { Moc: 'sample.moc3', Textures: ['texture.png'], ...overrides }
}))
writeFileSync(join(runtime, 'sample.moc3'), 'test moc')
writeFileSync(join(runtime, 'texture.png'), 'placeholder')
writeFileSync(join(root, 'outside.txt'), 'outside')
try {
  writeModel()
  for (const name of ['../escape', '/tmp/escape', 'a; touch bad', 'a$(echo bad)', 'a/b', 'a\\b', 'a?x', 'a#x']) {
    assert.throws(() => prepareModel(runtime, name, output), /输出名/)
  }
  assert.equal(existsSync(output), false, '非法输出名不能先创建目录')
  for (const path of ['../outside.txt', '/etc/passwd', 'C:\\secret', 'https://example.test/file', 'a\\b', '\0']) {
    writeModel({ Moc: path })
    assert.throws(() => prepareModel(runtime, 'sample', output))
  }
  symlinkSync(join(root, 'outside.txt'), join(runtime, 'linked.moc3'))
  writeModel({ Moc: 'linked.moc3' })
  assert.throws(() => prepareModel(runtime, 'sample', output), /包内文件/)
  writeModel({ Physics: 'missing.json' })
  assert.throws(() => prepareModel(runtime, 'sample', output), /ENOENT/)
  assert.equal(existsSync(output), false, '缺文件时不能留下部分产物')

  writeModel()
  mkdirSync(output)
  symlinkSync(runtime, join(output, 'sample'), 'dir')
  assert.throws(() => prepareModel(runtime, 'sample', output), /符号链接/)
  rmSync(join(output, 'sample'))

  mkdirSync(join(output, 'sample'))
  const danglingTarget = join(root, 'must-not-be-created.moc3')
  symlinkSync(danglingTarget, join(output, 'sample', 'sample.moc3'))
  await assert.rejects(buildModel(runtime, 'sample', output), /符号链接/)
  assert.equal(existsSync(danglingTarget), false, '悬空输出链接不能创建树外文件')
  rmSync(join(output, 'sample', 'sample.moc3'))

  const readme = join(root, 'ReadMe.txt')
  symlinkSync(join(root, 'outside.txt'), readme)
  await assert.rejects(buildModel(runtime, 'sample', output), /ReadMe.*普通文件/)
  rmSync(readme)
  symlinkSync(join(root, 'missing-license.txt'), readme)
  assert.throws(() => prepareModel(runtime, 'sample', output), /ReadMe.*普通文件/)
  rmSync(readme)
  writeFileSync(readme, 'fixture license')

  const require = createRequire(import.meta.url)
  const { createCanvas, loadImage } = require('@napi-rs/canvas')
  const canvas = createCanvas(12, 8)
  canvas.getContext('2d').fillRect(0, 0, 12, 8)
  writeFileSync(join(runtime, 'texture.png'), canvas.toBuffer('image/png'))
  writeFileSync(join(runtime, 'voice.wav'), 'audio')
  writeModel({ Motions: { Idle: [{ File: 'idle.json', Sound: 'voice.wav' }] } })
  writeFileSync(join(runtime, 'idle.json'), '{}')
  const result = await buildModel(runtime, 'sample', output)
  const model = JSON.parse(readFileSync(join(result.output, 'sample.model3.json'), 'utf8'))
  const texture = await loadImage(join(result.output, model.FileReferences.Textures[0]))
  assert.deepEqual([texture.width, texture.height], [12, 8], '保持比例，不放大小贴图')
  assert.equal(readFileSync(join(result.output, 'voice.wav'), 'utf8'), 'audio', '动作声音引用一并搬运')
  assert.ok(result.files >= 5)
  assert.equal(readFileSync(join(result.output, 'ReadMe.txt'), 'utf8'), 'fixture license')
  const snapshot = dir => Object.fromEntries(readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(item => item.isFile()).map(item => {
      const path = join(item.parentPath, item.name)
      return [path.slice(dir.length + 1), readFileSync(path).toString('base64')]
    }).sort(([a], [b]) => a.localeCompare(b)))
  const stages = () => readdirSync(output).filter(name => name.startsWith('.sample-build-'))
  writeFileSync(join(result.output, 'keep-until-success.txt'), 'old model sentinel')
  const previous = snapshot(result.output)

  // A pre-existing file/directory conflict must not overwrite the earlier moc file.
  renameSync(join(result.output, 'textures'), join(result.output, 'textures.saved'))
  writeFileSync(join(result.output, 'textures'), 'blocking file')
  const conflict = snapshot(result.output)
  await assert.rejects(buildModel(runtime, 'sample', output), /冲突|ENOTDIR/)
  assert.deepEqual(snapshot(result.output), conflict)
  rmSync(join(result.output, 'textures'))
  renameSync(join(result.output, 'textures.saved'), join(result.output, 'textures'))

  const failFilesystem = async (method, replacement, check) => {
    const original = fs[method]
    fs[method] = (...args) => replacement(original, ...args)
    syncBuiltinESMExports()
    try { await check() }
    finally { fs[method] = original; syncBuiltinESMExports() }
  }
  await failFilesystem('writeFileSync', (original, path, ...args) => {
    if (basename(path) === 'sample.model3.json' && String(path).includes('.sample-build-'))
      throw new Error('fixture stage write failure')
    return original(path, ...args)
  }, async () => assert.rejects(buildModel(runtime, 'sample', output), /fixture stage write failure/))
  assert.deepEqual(snapshot(result.output), previous, '临时产物写入失败保留旧模型所有文件')
  assert.deepEqual(stages(), [])

  await failFilesystem('renameSync', (original, from, to) => {
    if (basename(from) === 'generated' && to === result.output) throw new Error('fixture publish failure')
    return original(from, to)
  }, async () => assert.rejects(buildModel(runtime, 'sample', output), /fixture publish failure/))
  assert.deepEqual(snapshot(result.output), previous, '切换失败必须恢复旧目录')
  assert.deepEqual(stages(), [])

  await failFilesystem('renameSync', (original, from, to) => {
    if (['generated', 'previous'].includes(basename(from)) && to === result.output)
      throw new Error('fixture publish and rollback failure')
    return original(from, to)
  }, async () => assert.rejects(buildModel(runtime, 'sample', output), /旧模型完整保留/))
  assert.equal(stages().length, 1, '回滚也失败时不能删除唯一备份')
  const retained = join(output, stages()[0])
  assert.deepEqual(snapshot(join(retained, 'previous')), previous)
  renameSync(join(retained, 'previous'), result.output)
  rmSync(retained, { recursive: true, force: true })

  writeFileSync(join(runtime, 'sample.moc3'), 'replacement moc')
  await buildModel(runtime, 'sample', output)
  assert.equal(readFileSync(join(result.output, 'sample.moc3'), 'utf8'), 'replacement moc')
  assert.equal(existsSync(join(result.output, 'keep-until-success.txt')), false, '完整成功后才能替换旧产物')
  assert.deepEqual(stages(), [])
  console.log('Live2D importer: path and license boundaries, complete output, failure preservation and rollback passed')
} finally {
  rmSync(root, { recursive: true, force: true })
}
