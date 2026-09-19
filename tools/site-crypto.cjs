'use strict'

// 构建产物共用同一信封；浏览器 noimpty-search.js 使用相同派生参数。
const crypto = require('node:crypto')
const SALT = 'noimpty-search-v1'
const ITER = 120000

const encryptEnvelope = (plaintext, passphrase) => {
  if (!passphrase) throw new Error('加密私密数据必须提供暗号')
  const key = crypto.pbkdf2Sync(String(passphrase), SALT, ITER, 32, 'sha256')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return JSON.stringify({ v: 1, alg: 'AES-GCM', kdf: `PBKDF2-SHA256/${ITER}`,
    data: Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64') })
}

module.exports = { SALT, ITER, encryptEnvelope }
