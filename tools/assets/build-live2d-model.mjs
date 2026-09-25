/* Import a Live2D runtime pack. Validate every input and prepare all output before writing.
 * Model references are local files contained in the supplied runtime directory.
 * Usage: node tools/assets/build-live2d-model.mjs <runtime directory> <output name>
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync, statSync, lstatSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const project = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(new URL('../../package.json', import.meta.url))
const contained = (base, path) => {
  const rel = relative(base, path)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)
}


const entry = path => {
  try { return lstatSync(path) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
// lstat sees dangling links too. Every existing ancestor must be a real directory.
const writable = (path, kind = 'file') => {
  for (let current = path; ; current = dirname(current)) {
    const info = entry(current)
    if (info?.isSymbolicLink()) throw new Error('输出路径不能包含符号链接：' + current)
    if (info && ((current !== path || kind === 'directory') ? !info.isDirectory() : !info.isFile()))
      throw new Error('输出路径文件与目录冲突：' + current)
    if (dirname(current) === current) break
  }
}

export const prepareModel = (runtimeDir, name, destination = join(project, 'source/live2d')) => {
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64)
    throw new Error('输出名只能包含小写字母、数字和单个连字符（最多 64 字符）')
  const runtime = realpathSync(runtimeDir)
  if (!statSync(runtime).isDirectory()) throw new Error('runtime 必须是目录')
  const root = resolve(destination)
  const output = resolve(root, name)
  if (!contained(root, output)) throw new Error('输出路径越界')
  writable(output, 'directory')
  const source = rel => {
    if (typeof rel !== 'string' || !rel || rel.includes('\0') || rel.includes('\\') ||
        rel.startsWith('/') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rel))
      throw new Error('模型包含非法文件引用')
    const path = resolve(runtime, rel)
    if (!contained(runtime, path)) throw new Error('模型引用越过 runtime：' + rel)
    const real = realpathSync(path)
    if (!contained(runtime, real) || !statSync(real).isFile()) throw new Error('模型引用不是包内文件：' + rel)
    if (statSync(real).size > 50 * 1024 * 1024) throw new Error('模型单个文件超过 50 MiB：' + rel)
    return real
  }
  const models = readdirSync(runtime).filter(f => f.endsWith('.model3.json'))
  if (models.length !== 1) throw new Error('runtime 目录必须恰好有一个 .model3.json')
  const modelName = models[0]
  const model = JSON.parse(readFileSync(source(modelName), 'utf8'))
  const ref = model.FileReferences
  if (!ref || typeof ref !== 'object' || !ref.Moc || !Array.isArray(ref.Textures) || !ref.Textures.length)
    throw new Error('模型缺少 Moc 或 Textures')
  const files = new Map()
  const carry = rel => {
    if (rel == null || rel === '') return
    const data = readFileSync(source(rel))
    const target = resolve(output, rel)
    if (!contained(output, target)) throw new Error('输出引用越界')
    writable(target)
    files.set(relative(output, target), data)
  }
  carry(ref.Moc)
  for (const key of ['Physics', 'Pose', 'DisplayInfo']) carry(ref[key])
  for (const item of ref.Expressions || []) carry(item.File)
  for (const group of Object.values(ref.Motions || {})) {
    if (!Array.isArray(group)) throw new Error('模型动作列表无效')
    for (const item of group) { carry(item.File); carry(item.Sound) }
  }
  if (ref.Textures.length > 16) throw new Error('贴图数量超过 16')
  const textures = ref.Textures.map(source)
  const packageRoot = dirname(runtime)
  const readme = join(packageRoot, 'ReadMe.txt')
  const license = entry(readme)
  if (license) {
    if (!license.isFile() || license.isSymbolicLink() || !contained(packageRoot, realpathSync(readme)))
      throw new Error('ReadMe 必须是模型包内的普通文件')
    if (license.size > 50 * 1024 * 1024) throw new Error('ReadMe 超过 50 MiB')
    files.set('ReadMe.txt', readFileSync(readme))
  }
  writable(join(output, 'textures'), 'directory')
  writable(join(output, modelName))
  writable(join(output, 'ReadMe.txt'))
  for (let i = 0; i < textures.length; i++) writable(join(output, 'textures', 'texture_' + String(i).padStart(2, '0') + '.webp'))
  return { output, modelName, model, files, textures }
}

export const buildModel = async (runtimeDir, name, destination) => {
  const plan = prepareModel(runtimeDir, name, destination)
  // Load native rendering only after paths and model references have passed validation.
  const { loadImage, createCanvas } = require('@napi-rs/canvas')
  const textures = []
  for (const [i, path] of plan.textures.entries()) {
    const img = await loadImage(path)
    if (!(img.width > 0 && img.height > 0) || img.width > 16384 || img.height > 16384)
      throw new Error('贴图尺寸无效或过大')
    // Preserve aspect ratio, never enlarge a small input.
    const scale = Math.min(1, 2048 / img.width, 2048 / img.height)
    const canvas = createCanvas(Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)))
    const context = canvas.getContext('2d')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(img, 0, 0, canvas.width, canvas.height)
    const rel = 'textures/texture_' + String(i).padStart(2, '0') + '.webp'
    plan.files.set(rel, canvas.toBuffer('image/webp', 92))
    textures.push(rel)
  }
  plan.model.FileReferences.Textures = textures
  plan.files.set(plan.modelName, Buffer.from(JSON.stringify(plan.model, null, 2) + '\n'))
  // Revalidate after asynchronous image decoding, before touching an existing model.
  writable(plan.output, 'directory')
  for (const rel of plan.files.keys()) writable(join(plan.output, rel))
  const parent = dirname(plan.output)
  mkdirSync(parent, { recursive: true })
  const staging = mkdtempSync(join(parent, '.' + name + '-build-'))
  const generated = join(staging, 'generated'), backup = join(staging, 'previous')
  let bytes = 0, movedPrevious = false, preserveBackup = false
  try {
    mkdirSync(generated)
    for (const [rel, data] of plan.files) {
      const target = join(generated, rel)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, data, { flag: 'wx' })
      bytes += data.length
    }
    // Only a complete tree can become public; keep the old tree until that switch succeeds.
    writable(plan.output, 'directory')
    if (entry(plan.output)) {
      renameSync(plan.output, backup)
      movedPrevious = true
    }
    try { renameSync(generated, plan.output) }
    catch (error) {
      if (movedPrevious) {
        try { renameSync(backup, plan.output); movedPrevious = false }
        catch (rollbackError) {
          preserveBackup = true
          throw new AggregateError([error, rollbackError], '模型替换失败；旧模型完整保留在：' + backup)
        }
      }
      throw error
    }
  } finally {
    // Never remove the only surviving old model if rollback itself was blocked.
    if (!preserveBackup) rmSync(staging, { recursive: true, force: true })
  }

  return { files: plan.files.size, bytes, output: plan.output }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2)
    if (args.length !== 2) throw new Error('用法: node tools/assets/build-live2d-model.mjs <runtime 目录> <输出名>')
    const result = await buildModel(...args)
    console.log('已生成 ' + result.files + ' 个文件，共 ' + (result.bytes / 1024 / 1024).toFixed(2) + ' MiB：' + result.output)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
