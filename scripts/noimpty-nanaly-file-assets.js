'use strict'

// File parsers are same-origin and lazy-loaded only after a document is selected.
// Shipping the PDF worker/fonts avoids disclosing document contents to a CDN.
const fs = require('node:fs')
const path = require('node:path')
hexo.extend.generator.register('noimpty-nanaly-file-assets', () => {
  const routes = []
  const add = (pkg, file) => routes.push({ path: path.posix.join('pluginsSrc', pkg, file), data: fs.readFileSync(path.join(hexo.base_dir, 'node_modules', pkg, file)) })
  const directory = (pkg, dir) => {
    for (const entry of fs.readdirSync(path.join(hexo.base_dir, 'node_modules', pkg, dir), { withFileTypes: true })) {
      if (entry.isFile()) add(pkg, path.posix.join(dir, entry.name))
    }
  }
  add('mammoth', 'LICENSE')
  add('pdfjs-dist', 'LICENSE')
  add('mammoth', 'mammoth.browser.min.js')
  add('pdfjs-dist', 'build/pdf.min.mjs')
  add('pdfjs-dist', 'build/pdf.worker.min.mjs')
  for (const dir of ['cmaps', 'standard_fonts', 'wasm']) directory('pdfjs-dist', dir)
  return routes
})
