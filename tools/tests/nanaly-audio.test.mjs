import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync('source/js/nanaly-audio.js', 'utf8')
const window = {}
vm.runInNewContext(source, { window, Blob })
const { padWav } = window.NANALY_AUDIO
const chunk = (name, payload, { unknown = false, pad = 0, missingPad = false } = {}) => {
  const body = Buffer.from(payload), header = Buffer.alloc(8)
  header.write(name, 0, 4, 'ascii'); header.writeUInt32LE(unknown ? 0xffffffff : body.length, 4)
  return Buffer.concat([header, body, !unknown && !missingPad && body.length % 2 ? Buffer.from([pad]) : Buffer.alloc(0)])
}
const format = ({ code = 1, bits = 16, channels = 1, rate = 24000, align = channels * bits / 8 } = {}) => {
  const bytes = Buffer.alloc(16)
  bytes.writeUInt16LE(code, 0); bytes.writeUInt16LE(channels, 2); bytes.writeUInt32LE(rate, 4)
  bytes.writeUInt32LE(rate * align, 8); bytes.writeUInt16LE(align, 12); bytes.writeUInt16LE(bits, 14)
  return bytes
}
const container = (chunks, { unknown = false, tail = Buffer.alloc(0) } = {}) => {
  const body = Buffer.concat(chunks), header = Buffer.alloc(12)
  header.write('RIFF', 0, 4, 'ascii'); header.writeUInt32LE(unknown ? 0xffffffff : body.length + 4, 4); header.write('WAVE', 8, 4, 'ascii')
  return Buffer.concat([header, body, tail])
}
const make = ({ fmt = format(), data = Buffer.from([1, 2, 254, 127]), before = [], after = [], dataOptions = {}, ...options } = {}) =>
  container([...before, chunk('fmt ', fmt), chunk('data', data, dataOptions), ...after], options)
const blob = (bytes, type = 'audio/wav') => new Blob([bytes], { type })
const inspect = async value => {
  const bytes = Buffer.from(await value.arrayBuffer()), end = bytes.readUInt32LE(4) + 8, chunks = []
  for (let offset = 12; offset < end;) {
    const size = bytes.readUInt32LE(offset + 4), next = offset + 8 + size + (size & 1)
    assert.ok(next <= end)
    chunks.push({ name: bytes.toString('ascii', offset, offset + 4), size, raw: bytes.subarray(offset, next),
      data: bytes.subarray(offset + 8, offset + 8 + size), pad: size & 1 ? bytes[offset + 8 + size] : null })
    offset = next
  }
  return { bytes, end, chunks, audio: chunks.find(c => c.name === 'data'), fmt: chunks.find(c => c.name === 'fmt '), tail: bytes.subarray(end) }
}
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

await test('PCM 8/16/24/32-bit mono and stereo retain every original sample byte and append exactly 0.35 seconds', async () => {
  for (const bits of [8, 16, 24, 32]) for (const channels of [1, 2]) {
    const align = channels * bits / 8
    const samples = Buffer.from(Array.from({ length: 7 * align }, (_, i) => (i * 37 + 91) & 255))
    const input = blob(make({ fmt: format({ bits, channels }), data: samples }))
    const output = await padWav(input), wave = await inspect(output), before = await inspect(input)
    assert.notEqual(output, input)
    assert.equal(output.type, 'audio/wav')
    assert.equal(wave.audio.size, samples.length + 8400 * align)
    assert.deepEqual(wave.audio.data.subarray(0, samples.length), samples, bits + '-bit original samples')
    assert.ok(wave.audio.data.subarray(samples.length).every(x => x === (bits === 8 ? 128 : 0)), bits + '-bit silence')
    assert.deepEqual(wave.fmt.raw, before.fmt.raw)
    assert.equal(wave.end, wave.bytes.length)
    assert.equal(wave.bytes.readUInt32LE(4), wave.bytes.length - 8)
  }
})

await test('IEEE float32 samples remain bit-for-bit identical and the added samples are positive zero', async () => {
  const samples = Buffer.alloc(24)
  ;[1, -0.125, 0.75, -1, -0, 0.33333334].forEach((value, i) => samples.writeFloatLE(value, i * 4))
  const wave = await inspect(await padWav(blob(make({ fmt: format({ code: 3, bits: 32, channels: 2 }), data: samples }))))
  assert.deepEqual(wave.audio.data.subarray(0, samples.length), samples)
  assert.equal(wave.audio.size, samples.length + 8400 * 8)
  assert.ok(wave.audio.data.subarray(samples.length).every(x => x === 0))
})

await test('odd data padding, preceding unknown chunks and trailing metadata are preserved around the added samples', async () => {
  const metadata = chunk('LIST', Buffer.from('INFOcat'), { pad: 0x73 })
  const junk = chunk('JUNK', [9, 8, 7], { pad: 0x55 }), outside = Buffer.from('external-tag')
  const samples = Buffer.from([0, 91, 255])
  const input = blob(make({ fmt: format({ bits: 8, rate: 10 }), data: samples, dataOptions: { pad: 0x6e },
    before: [junk], after: [metadata], tail: outside }))
  const wave = await inspect(await padWav(input))
  assert.deepEqual(wave.chunks.map(c => c.name), ['JUNK', 'fmt ', 'data', 'LIST'])
  assert.deepEqual(wave.chunks[0].raw, junk)
  assert.deepEqual(wave.chunks.at(-1).raw, metadata)
  assert.deepEqual(wave.audio.data, Buffer.from([0, 91, 255, 128, 128, 128, 128]))
  assert.equal(wave.audio.pad, 0x6e)
  assert.deepEqual(wave.tail, outside)
  assert.equal(wave.end, wave.bytes.length - outside.length)
})

await test('changing data parity updates only padding, never promotes a padding byte into audio or drops a sample', async () => {
  for (const count of [3, 4]) {
    const samples = Buffer.from(Array.from({ length: count }, (_, i) => i + 20)), metadata = chunk('bext', [11, 12])
    const input = blob(make({ fmt: format({ bits: 8, rate: 5 }), data: samples, dataOptions: { pad: 0x44 }, after: [metadata] }))
    const wave = await inspect(await padWav(input, 0.2))
    assert.deepEqual(wave.audio.data, Buffer.concat([samples, Buffer.from([128])]))
    assert.equal(wave.audio.pad, count === 3 ? null : 0)
    assert.deepEqual(wave.chunks.at(-1).raw, metadata)
    assert.equal(wave.end, wave.bytes.length)
  }
})

await test('complete odd final PCM payloads missing only the RIFF word pad retain every sample', async () => {
  // Python 3.12 wave.writeframes writes these complete payloads without a final pad.
  for (const bits of [8, 24]) for (const seconds of [.2, .4]) {
    const samples = Buffer.from(Array.from({ length: 3 * bits / 8 }, (_, i) => i + 1))
    const bytes = make({ fmt: format({ bits, rate: 5 }), data: samples, dataOptions: { missingPad: true } })
    const wave = await inspect(await padWav(blob(bytes), seconds))
    assert.deepEqual(wave.audio.data.subarray(0, samples.length), samples)
    assert.equal(wave.audio.size, samples.length + Math.ceil(5 * seconds) * bits / 8)
    assert.ok(wave.audio.data.subarray(samples.length).every(x => x === (bits === 8 ? 128 : 0)))
    assert.equal(wave.end, wave.bytes.length)
  }
})

await test('missing alignment is repaired only for complete final data at physical EOF', async () => {
  for (const bytes of [
    make({ data: [1, 2, 3], dataOptions: { missingPad: true } }),
    make({ before: [chunk('JUNK', [1, 2, 3], { missingPad: true })] }),
    make({ after: [chunk('LIST', [1, 2, 3], { missingPad: true })] }),
    make({ fmt: format({ bits: 8 }), data: [1, 2, 3], dataOptions: { missingPad: true }, after: [chunk('LIST', [4, 5])] }),
    make({ fmt: format({ bits: 8 }), data: [1, 2, 3], dataOptions: { missingPad: true }, tail: Buffer.from('external') })
  ]) await assert.rejects(padWav(blob(bytes)), error => error.code === 'NANALY_INVALID_WAV')
})

await test('ffmpeg non-seekable RIFF/data sentinel sizes become exact lengths without losing EOF sample bytes', async () => {
  const samples = Buffer.from('LISTJUNKdataRIFF')
  for (const unknown of [false, true]) for (const dataUnknown of [false, true]) {
    const input = blob(make({ data: samples, unknown, dataOptions: { unknown: dataUnknown }, before: [chunk('LIST', Buffer.from('INFO'))] }))
    const wave = await inspect(await padWav(input))
    assert.deepEqual(wave.audio.data.subarray(0, samples.length), samples)
    assert.equal(wave.audio.size, samples.length + 8400 * 2)
    assert.equal(wave.bytes.readUInt32LE(4), wave.bytes.length - 8)
    assert.equal(wave.end, wave.bytes.length)
    assert.deepEqual(wave.chunks[0].data, Buffer.from('INFO'))
  }
})

await test('unknown RIFF size still retains metadata after a data chunk with a known size', async () => {
  const metadata = chunk('LIST', Buffer.from('INFONAMEnanaly'))
  const wave = await inspect(await padWav(blob(make({ unknown: true, after: [metadata] }))))
  assert.deepEqual(wave.chunks.at(-1).raw, metadata)
})

await test('streaming 2 GiB and zero headers are normalized while preserving the final voiced frame', async () => {
  const samples = Buffer.from('LISTJUNKdataRIFF'), outerSizes = [0, 0x7fffffff, 0x7fffffdb, 0xffffffff]
  for (const outer of outerSizes) for (const dataSize of [0, 0x7fffffff, 0x7fffffdb, 0xffffffff, samples.length]) {
    const bytes = make({ data: samples })
    bytes.writeUInt32LE(outer, 4); bytes.writeUInt32LE(dataSize, 40)
    const wave = await inspect(await padWav(blob(bytes)))
    assert.equal(wave.end, wave.bytes.length)
    assert.equal(wave.audio.size, samples.length + 8400 * 2)
    assert.deepEqual(wave.audio.data.subarray(0, samples.length), samples)
    assert.ok(wave.audio.data.subarray(samples.length).every(value => value === 0))
  }
})

await test('a stale oversized outer length is repaired only when the individual chunks are complete', async () => {
  const metadata = chunk('LIST', Buffer.from('INFOfinal'))
  const samples = Buffer.from([1, 2, 254, 127])
  const bytes = make({ data: samples, after: [metadata] })
  bytes.writeUInt32LE(bytes.length + 100, 4)
  const wave = await inspect(await padWav(blob(bytes)))
  assert.equal(wave.end, wave.bytes.length)
  assert.deepEqual(wave.audio.data.subarray(0, samples.length), samples)
  assert.deepEqual(wave.chunks.at(-1).raw, metadata)
  const truncated = bytes.subarray(0, bytes.length - 2)
  await assert.rejects(padWav(blob(truncated)), /WAV 音频格式无效/)
})

await test('unknown outer lengths preserve known data boundaries, metadata and zero-length finite data', async () => {
  const metadata = chunk('LIST', Buffer.from('INFOsafe'))
  for (const outer of [0, 0x7fffffdb]) {
    const bytes = make({ after: [metadata] }); bytes.writeUInt32LE(outer, 4)
    const wave = await inspect(await padWav(blob(bytes)))
    assert.equal(wave.audio.size, 4 + 8400 * 2)
    assert.deepEqual(wave.chunks.at(-1).raw, metadata)
  }
  const wave = await inspect(await padWav(blob(make({ data: [], after: [metadata] }))))
  assert.equal(wave.audio.size, 8400 * 2)
  assert.deepEqual(wave.chunks.at(-1).raw, metadata, 'finite empty data must not swallow a following metadata chunk')
})

await test('streaming compatibility never accepts ordinary truncated data or partial sample frames', async () => {
  for (const outer of [0, 0x7fffffff, 0x7fffffdb, 0xffffffff]) {
    const truncated = make(); truncated.writeUInt32LE(outer, 4); truncated.writeUInt32LE(100, 40)
    await assert.rejects(padWav(blob(truncated)), /区块超出/)
    const partial = make({ data: [1, 2, 3], dataOptions: { unknown: true } })
    partial.writeUInt32LE(outer, 4)
    await assert.rejects(padWav(blob(partial)), /采样帧对齐/)
  }
})

await test('zero duration is a no-op and fractional frame duration rounds upward to a complete frame', async () => {
  const input = blob(make({ fmt: format({ rate: 3 }) }))
  assert.equal(await padWav(input, 0), input)
  const output = await inspect(await padWav(input, 0.35))
  assert.equal(output.audio.size, 4 + 2 * 2)
})

await test('compressed, extensible and unsupported sample formats return the exact original Blob', async () => {
  for (const [code, bits, align] of [[2, 4, 1], [6, 8, 1], [7, 8, 1], [65534, 16, 2], [3, 64, 8], [1, 12, 2]]) {
    const input = blob(make({ fmt: format({ code, bits, align }), data: [1, 2, 3] }))
    assert.equal(await padWav(input), input)
  }
  for (const tag of ['RIFX', 'RF64']) {
    const bytes = make(); bytes.write(tag, 0, 4, 'ascii')
    const input = blob(bytes)
    assert.equal(await padWav(input), input)
  }
})

await test('explicit non-WAV MIME is untouched while blank/octet-stream WAV is recognized', async () => {
  for (const type of ['audio/mpeg', 'audio/ogg', 'audio/mp4', 'text/plain']) {
    const input = blob(Buffer.from('unrelated bytes'), type)
    assert.equal(await padWav(input), input)
  }
  for (const type of ['', 'application/octet-stream', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']) {
    const input = blob(make(), type), output = await padWav(input)
    assert.notEqual(output, input)
    assert.equal(output.type, 'audio/wav')
    assert.equal((await inspect(output)).audio.size, 4 + 8400 * 2)
  }
})

await test('malformed headers, chunks and non-frame-aligned audio fail explicitly instead of truncating', async () => {
  const edit = (fn, bytes = make()) => { fn(bytes); return bytes }
  const malformed = [
    Buffer.from('RIFF'),
    edit(b => b.write('NOPE', 0, 4, 'ascii')),
    edit(b => b.write('AVI ', 8, 4, 'ascii')),
    edit(b => b.writeUInt32LE(1, 4)),
    container([chunk('data', [1, 2])]),
    container([chunk('fmt ', format())]),
    container([chunk('fmt ', Buffer.alloc(10)), chunk('data', [1, 2])]),
    container([chunk('fmt ', format()), chunk('fmt ', format()), chunk('data', [1, 2])]),
    container([chunk('fmt ', format()), chunk('data', [1, 2]), chunk('data', [3, 4])]),
    container([chunk('fmt ', format()), Buffer.from('data')]),
    edit(b => b.writeUInt32LE(100, 40)),
    make({ data: [1, 2, 3] }),
    make({ data: [1, 2, 3], unknown: true, dataOptions: { unknown: true } }),
    edit(b => b.writeUInt32LE(0xffffffff, 16)),
    edit(b => b.writeUInt16LE(0, 22)),
    edit(b => b.writeUInt32LE(0, 24)),
    edit(b => b.writeUInt32LE(1, 28)),
    edit(b => b.writeUInt16LE(1, 32))
  ]
  for (const [index, bytes] of malformed.entries()) {
    await assert.rejects(padWav(blob(bytes)), /WAV 音频格式无效/, 'malformed case ' + index)
  }
})

await test('invalid input and unsafe duration are rejected before allocating excessive silence', async () => {
  for (const input of [null, {}, 'audio']) await assert.rejects(padWav(input), /需要 Blob 音频/)
  const input = blob(make())
  for (const seconds of [-1, NaN, Infinity, '0.35']) await assert.rejects(padWav(input, seconds), /静音时长/)
  await assert.rejects(padWav(input, 1000000), /安全范围/)
})

await test('reinjection preserves the original module identity', () => {
  const api = window.NANALY_AUDIO
  vm.runInNewContext(source, { window, Blob })
  assert.equal(window.NANALY_AUDIO, api)
})

await test('fact frame counts are updated before or after data while every other fact and sample byte stays intact', async () => {
  for (const code of [1, 3]) for (const position of ['before', 'after']) {
    const fmt = format({ code, bits: 32, channels: 2 })
    const samples = Buffer.from(Array.from({ length: 24 }, (_, i) => i * 7 & 255))
    const factPayload = Buffer.alloc(9, 0x79)
    factPayload.writeUInt32LE(3, 0)
    const fact = chunk('fact', factPayload, { pad: 0x61 })
    const input = blob(make({ fmt, data: samples, before: position === 'before' ? [fact] : [], after: position === 'after' ? [fact] : [] }))
    const wave = await inspect(await padWav(input)), updated = wave.chunks.find(c => c.name === 'fact')
    assert.equal(updated.data.readUInt32LE(0), 3 + 8400)
    assert.deepEqual(updated.data.subarray(4), factPayload.subarray(4))
    assert.equal(updated.pad, 0x61)
    assert.deepEqual(wave.audio.data.subarray(0, samples.length), samples)
    assert.equal(wave.end, wave.bytes.length)
  }
  const factPayload = Buffer.alloc(4); factPayload.writeUInt32LE(0xffffffff)
  const streamed = blob(make({ fmt: format({ code: 3, bits: 32 }), data: Buffer.alloc(8), unknown: true,
    dataOptions: { unknown: true }, before: [chunk('fact', factPayload)] }))
  const wave = await inspect(await padWav(streamed))
  assert.equal(wave.chunks.find(c => c.name === 'fact').data.readUInt32LE(0), 2 + 8400)
})

console.log(`\n${passed} WAV tail-padding regression groups passed`)
