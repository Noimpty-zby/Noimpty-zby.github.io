/*
 * Compatible Hexo adapter for the maintained markdown-it parser.
 * Adapted from hexo-renderer-markdown-it (renderer, anchors and images).
 * Copyright (c) 2015 Celso Miranda
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
'use strict'

const MarkdownIt = require('markdown-it')
const path = require('node:path')
const { slugize, url_for: urlFor } = require('hexo-util')

const renderDefaults = {
  html: true, xhtmlOut: false, breaks: true, linkify: true,
  typographer: true, quotes: '“”‘’'
}
const anchorDefaults = {
  level: 2, collisionSuffix: '', permalink: false,
  permalinkClass: 'header-anchor', permalinkSide: 'left',
  permalinkSymbol: '¶', case: 0, separator: '-'
}

const normalizeConfig = value => {
  const config = typeof value === 'string' ? { preset: value } : (value || {})
  return {
    ...config,
    preset: config.preset || 'default',
    render: { ...renderDefaults, ...config.render },
    anchors: config.anchors === false ? false : { ...anchorDefaults, ...config.anchors }
  }
}

function anchors(md, options) {
  const original = md.renderer.rules.heading_open
  const storeKey = Symbol('heading slugs for this document')
  const slugOptions = { transform: options.case, ...options }
  md.renderer.rules.heading_open = function(tokens, index, renderOptions, env, renderer) {
    const heading = tokens[index]
    if (Number(heading.tag.slice(1)) >= options.level) {
      const store = env[storeKey] || (env[storeKey] = { counts: new Map(), used: new Set() })
      const title = tokens[index + 1].children.reduce((text, token) => text + token.content, '')
      const base = slugize(title, slugOptions)
      let count = (store.counts.get(base) || 0) + 1
      let slug = count === 1 ? base : `${base}-${options.collisionSuffix}${count}`
      // A literal heading such as "title-2" can already own the duplicate's
      // next candidate. Keep every generated id unique within this document.
      while (store.used.has(slug)) slug = `${base}-${options.collisionSuffix}${++count}`
      store.counts.set(base, count)
      store.used.add(slug)
      heading.attrPush(['id', slug])
      if (options.permalink) {
        // The token constructor belongs to this parser. Do not import a private
        // markdown-it/lib/token path: that path disappeared in modern releases.
        const Token = heading.constructor
        const link = new Token('link_open', 'a', 1)
        link.attrs = [['class', options.permalinkClass], ['href', '#' + slug]]
        const label = new Token('text', '', 0)
        label.content = options.permalinkSymbol
        const permalink = [link, label, new Token('link_close', 'a', -1), new Token('text', '', 0)]
        const children = tokens[index + 1].children
        if (options.permalinkSide === 'right') children.push(...permalink)
        else children.unshift(...permalink)
      }
    }
    return original
      ? original.call(this, tokens, index, renderOptions, env, renderer)
      : renderer.renderToken(tokens, index, renderOptions)
  }
}

function images(md, options, hexo) {
  const { lazyload, prepend_root: prependRoot, post_asset: postAsset } = options
  md.renderer.rules.image = function(tokens, index, renderOptions, env, renderer) {
    const token = tokens[index]
    token.attrSet('alt', token.content)
    if (lazyload) token.attrSet('loading', 'lazy')
    let src = token.attrGet('src') || ''
    const relativeLinks = hexo.config.relative_link ?? hexo.relative_link
    if ((prependRoot || postAsset) && !relativeLinks && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)) {
      if (!/^[\/\\]/.test(src) && postAsset && env.postPath) {
        const postPath = env.postPath.replace(/\\/g, '/')
        const sourceDir = hexo.source_dir.replace(/\\/g, '/')
        const basename = path.posix.basename(postPath, path.posix.extname(postPath))
        let assetDir = path.posix.join(path.posix.basename(sourceDir), path.posix.dirname(path.posix.relative(sourceDir, postPath)), basename)
        if (path.isAbsolute(assetDir)) assetDir = path.relative(hexo.base_dir, assetDir).replace(/\\/g, '/')
        const stripped = src.startsWith(basename + '/') ? src.slice(basename.length + 1) : src
        const assets = hexo.model('PostAsset')
        const asset = [path.posix.join(assetDir, src), path.posix.join(assetDir, stripped)]
          .map(id => assets.findById(id)).find(Boolean)
        if (asset) src = asset.path.replace(/\\/g, '/')
      }
      token.attrSet('src', urlFor.call(hexo, src))
    }
    return renderer.renderToken(tokens, index, renderOptions)
  }
}

class MarkdownRenderer {
  constructor(hexo) {
    this.hexo = hexo
    const config = normalizeConfig(hexo.config.markdown)
    hexo.config.markdown = config
    this.disableNunjucks = Boolean(config.disableNunjucks)
    this.parser = new MarkdownIt(config.preset, config.render)
    if (config.enable_rules) this.parser.enable(config.enable_rules)
    if (config.disable_rules) this.parser.disable(config.disable_rules)
    for (const plugin of config.plugins || []) {
      const name = typeof plugin === 'string' ? plugin : plugin.name
      const resolved = require.resolve(name, { paths: [hexo.base_dir, path.join(__dirname, '..')] })
      const module = require(resolved)
      this.parser.use(module.default || module, typeof plugin === 'string' ? undefined : plugin.options)
    }
    if (config.anchors) this.parser.use(anchors, config.anchors)
    if (config.images) this.parser.use(images, config.images, hexo)
  }

  render(data, options) {
    this.hexo.execFilterSync('markdown-it:renderer', this.parser, { context: this })
    const env = { postPath: data.path }
    return options?.inline === true
      ? this.parser.renderInline(data.text, env)
      : this.parser.render(data.text, env)
  }
}

module.exports = MarkdownRenderer
module.exports.normalizeConfig = normalizeConfig
