'use strict'

// v2 is shared by the build, privacy-gate.js and noimpty-search.js.
const crypto = require('node:crypto')
const VERSION = 2
const ITER = 600000
const AAD = 'noimpty-site-envelope-v2'

const encryptEnvelope = (plaintext, passphrase) => {
  if (typeof passphrase !== 'string' || !passphrase) throw new Error('加密私密数据必须提供暗号')
  const salt = crypto.randomBytes(16)
  const key = crypto.pbkdf2Sync(passphrase, salt, ITER, 32, 'sha256')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(AAD))
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return JSON.stringify({ v: VERSION, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations: ITER,
    salt: salt.toString('base64'), data: Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64') })
}

module.exports = { VERSION, ITER, AAD, encryptEnvelope }
