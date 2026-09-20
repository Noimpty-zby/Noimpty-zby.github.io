/* Append silence to WAV samples without resampling, fading or discarding original audio. */
(() => {
  'use strict'
  if (window.NANALY_AUDIO) return
  const fail = reason => { throw new Error('WAV 音频格式无效：' + reason) }
  // Non-seekable writers use UINT32_MAX or a value near INT32_MAX (sometimes
  // minus the header) until the final byte count is known. These are not allocations.
  const streamingLength = value => value === 0xffffffff || value >= 0x7fff0000 && value <= 0x7fffffff
  const padWav = async (blob, seconds = 0.35) => {
    if (!blob || typeof blob.arrayBuffer !== 'function' || typeof blob.size !== 'number') throw new TypeError('需要 Blob 音频')
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('静音时长必须是非负有限数字')
    const mime = String(blob.type || '').split(';')[0].trim().toLowerCase()
    if (mime && !['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/vnd.wave', 'application/octet-stream'].includes(mime)) return blob
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.length < 12) fail('文件头不完整')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const tag = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4))
    // RF64 and big-endian WAVE need different size/sample handling. Leave them intact.
    if (['RF64', 'RIFX'].includes(tag(0))) return blob
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') fail('不是 RIFF/WAVE 文件')
    const declared = view.getUint32(4, true)
    const openRiff = declared === 0 || streamingLength(declared) && declared + 8 > bytes.length
    // The outer size may not have been backpatched by the service. A complete,
    // independently bounded fmt/data layout can recover it; a truncated ordinary
    // data chunk still fails below. Keep real bytes beyond a finite RIFF untouched.
    const end = openRiff || declared + 8 > bytes.length ? bytes.length : declared + 8
    if (end < 12) fail('RIFF 长度与文件不符')
    let fmt = null, data = null, offset = 12
    const facts = []
    while (offset < end) {
      if (end - offset < 8) fail('区块头不完整')
      const name = tag(offset), length = view.getUint32(offset + 4, true), start = offset + 8
      const unbounded = streamingLength(length) && length > end - start || length === 0 && name === 'data' && openRiff
      if (unbounded && name !== 'data') fail('只有 data 区块可以使用流式长度')
      // An explicitly unbounded data chunk extends to EOF. Never guess that sample
      // bytes spelling LIST/JUNK are metadata and silently remove part of a voice.
      const size = unbounded ? end - start : length
      const pad = unbounded ? 0 : size & 1
      const next = start + size + pad
      if (next > end) fail('区块超出 RIFF 边界或缺少对齐字节')
      if (name === 'fact' && size >= 4) facts.push(start)
      if (name === 'fmt ') {
        if (fmt || size < 16) fail('fmt 区块缺失字段或重复')
        fmt = { format: view.getUint16(start, true), channels: view.getUint16(start + 2, true),
          rate: view.getUint32(start + 4, true), byteRate: view.getUint32(start + 8, true),
          align: view.getUint16(start + 12, true), bits: view.getUint16(start + 14, true) }
      } else if (name === 'data') {
        if (data) fail('存在多个 data 区块，无法安全补齐')
        data = { start, size, pad, next }
      }
      offset = next
    }
    if (!fmt || !data) fail('缺少 fmt 或 data 区块')
    const pcm = fmt.format === 1 && [8, 16, 24, 32].includes(fmt.bits)
    const floating = fmt.format === 3 && fmt.bits === 32
    if (!pcm && !floating) return blob
    if (!fmt.channels || !fmt.rate || !fmt.align || fmt.align !== fmt.channels * fmt.bits / 8
      || fmt.byteRate !== fmt.rate * fmt.align) fail('采样格式或字节速率不一致')
    if (data.size % fmt.align) fail('data 数据未按采样帧对齐')
    const frames = Math.ceil(fmt.rate * seconds), added = frames * fmt.align
    if (!Number.isSafeInteger(added) || added > 12 * 1024 * 1024) throw new RangeError('静音补齐长度超出安全范围')
    if (!added) return blob
    const newSize = data.size + added, newPad = newSize & 1
    const riffSize = end - 8 + added + newPad - data.pad
    if (newSize >= 0xffffffff || riffSize >= 0xffffffff) throw new RangeError('补齐后超出 RIFF 长度范围')
    const prefix = bytes.slice(0, data.start), tail = bytes.slice(data.next)
    const header = new DataView(prefix.buffer)
    header.setUint32(4, riffSize, true)
    header.setUint32(data.start - 4, newSize, true)
    // Non-PCM decoders may use fact's per-channel frame count as the duration.
    for (const start of facts) {
      if (start < data.start) header.setUint32(start, newSize / fmt.align, true)
      else new DataView(tail.buffer).setUint32(start - data.next, newSize / fmt.align, true)
    }
    const silence = new Uint8Array(added)
    if (pcm && fmt.bits === 8) silence.fill(128)
    const padding = newPad ? data.pad ? bytes.subarray(data.start + data.size, data.next) : new Uint8Array(1) : new Uint8Array()
    return new Blob([prefix, bytes.subarray(data.start, data.start + data.size), silence, padding,
      tail], { type: 'audio/wav' })
  }
  window.NANALY_AUDIO = Object.freeze({ padWav })
})()
