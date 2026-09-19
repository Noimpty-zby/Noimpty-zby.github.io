// Exercise homepage mounting against DOM replacement; no CSS-text or snapshot assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../source/js/section-hub.js', import.meta.url), 'utf8')
class Events {
  constructor() { this.listeners = new Map() }
  addEventListener(type, fn, options = {}) {
    const listeners = this.listeners.get(type) || []
    listeners.push({ fn, once: options.once }); this.listeners.set(type, listeners)
  }
  dispatchEvent(event) {
    for (const item of [...(this.listeners.get(event.type) || [])]) {
      item.fn(event)
      if (item.once) this.listeners.set(event.type, this.listeners.get(event.type).filter(value => value !== item))
    }
    return true
  }
}
class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase(); this.attributes = new Map(); this.children = []; this.dataset = {}; this.style = {}
    this.parentElement = null; this._text = ''
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: name => { if (!this.classList.contains(name)) this.className = (this.className + ' ' + name).trim() },
      remove: name => { this.className = this.className.split(/\s+/).filter(value => value !== name).join(' ') },
      toggle: (name, on) => { const enabled = on ?? !this.classList.contains(name); enabled ? this.classList.add(name) : this.classList.remove(name); return enabled }
    }
  }
  get id() { return this.getAttribute('id') || '' }
  set id(value) { this.setAttribute('id', value) }
  get className() { return this.getAttribute('class') || '' }
  set className(value) { this.setAttribute('class', value) }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  hasAttribute(name) { return this.attributes.has(name) }
  appendChild(node) {
    if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(child => child !== node)
    node.parentElement = this; this.children.push(node); return node
  }
  prepend(node) { node.parentElement = this; this.children.unshift(node) }
  append(...nodes) { nodes.forEach(node => this.appendChild(typeof node === 'string' ? textNode(node) : node)) }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes) }
  get textContent() { return this._text + this.children.map(child => child.textContent).join('') }
  set textContent(value) { this.children = []; this._text = String(value) }
  set innerHTML(value) {
    this.children = []; this._text = ''
    const stack = [this]
    for (const token of String(value).matchAll(/<\/?([a-z][\w:-]*)([^>]*?)>|([^<]+)/gi)) {
      if (token[3] != null) { stack.at(-1).appendChild(textNode(token[3])); continue }
      if (token[0].startsWith('</')) { if (stack.length > 1) stack.pop(); continue }
      const node = new Element(token[1])
      for (const attr of token[2].matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) node.setAttribute(attr[1], attr[2] ?? attr[3] ?? attr[4] ?? '')
      stack.at(-1).appendChild(node)
      if (!token[0].endsWith('/>') && !['br', 'img', 'input', 'hr', 'meta', 'link'].includes(token[1])) stack.push(node)
    }
  }
  matches(selector) {
    if (this.tagName === '#TEXT') return false
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1))
    if (selector.startsWith('#')) return this.id === selector.slice(1)
    return this.tagName.toLowerCase() === selector.toLowerCase()
  }
  querySelectorAll(selector) {
    return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)])
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
}
const textNode = value => { const node = new Element('#text'); node.textContent = value; return node }
const boot = ({ path = '/', readyState = 'loading', theme = 'light', social = false } = {}) => {
  const timers = [], document = new Events(), window = new Events()
  const html = new Element('html'), body = new Element('body')
  html.setAttribute('data-theme', theme); html.appendChild(body)
  Object.assign(document, { readyState, documentElement: html, body,
    createElement: tag => new Element(tag), createTextNode: textNode,
    getElementById: id => html.querySelector('#' + id), querySelector: selector => html.querySelector(selector) })
  Object.assign(window, { location: { pathname: path }, setTimeout: fn => { timers.push(fn); return timers.length } })
  let hubReady = 0
  window.addEventListener('noimpty:hub-ready', () => { hubReady++ })
  const mountPage = home => {
    body.replaceChildren()
    const header = new Element('header'); header.id = 'page-header'; header.className = home ? 'full_page' : 'post-bg'
    body.appendChild(header)
    if (home) {
      const info = new Element('div'); info.id = 'site-info'; header.appendChild(info)
      const title = new Element('h1'); title.id = 'site-title'; title.textContent = 'Noimpty 的个人空间'; info.appendChild(title)
      const subtitle = new Element('div'); subtitle.id = 'site-subtitle'; info.appendChild(subtitle)
      if (social) {
        const icons = new Element('div'); icons.id = 'site_social_icons'
        const link = new Element('a'); link.setAttribute('href', 'https://example.com/profile'); link.setAttribute('aria-label', 'Profile')
        icons.appendChild(link); info.appendChild(icons)
      }
    }
    const content = new Element('main'); content.id = 'content-inner'; body.appendChild(content)
    if (home) { const posts = new Element('div'); posts.id = 'recent-posts'; content.appendChild(posts) }
  }
  const flush = () => { while (timers.length) timers.shift()() }
  const navigate = (next, home) => { window.location.pathname = next; mountPage(home); window.dispatchEvent(new Event('pjax:complete')); flush() }
  mountPage(path === '/' || path === '/index.html')
  vm.runInNewContext(source, { document, window, Event, console })
  return { document, window, html, flush, navigate, hubReady: () => hubReady }
}
const accessibleText = node => node.getAttribute('aria-hidden') === 'true' ? '' : node._text + node.children.map(accessibleText).join('')
const verifyHome = h => {
  assert.equal(h.html.classList.contains('noimpty-home-hub'), true)
  const hub = h.document.getElementById('private-sections')
  assert.ok(hub)
  assert.equal(h.html.querySelectorAll('.noimpty-home-sections').length, 1)
  for (const selector of ['.sakura-greeting', '.sakura-hero-actions', '.sakura-scene']) assert.equal(h.html.querySelectorAll(selector).length, 1)
  assert.equal(h.html.querySelectorAll('.sakura-petal').length, 10)
  assert.equal(h.html.querySelectorAll('svg').length, 0)
  assert.equal(h.html.querySelector('.sakura-scene').getAttribute('aria-hidden'), 'true')
  const links = hub.querySelectorAll('a')
  assert.deepEqual(links.map(link => link.getAttribute('href')), ['/in-class/', '/extra/', '/life/'])
  assert.ok(links.every(link => link.getAttribute('aria-label')))
  assert.equal(h.html.querySelector('.sakura-enter').getAttribute('href'), '#private-sections')
  const title = h.document.getElementById('site-title')
  assert.equal(title.tagName, 'H1')
  assert.equal(accessibleText(title).replace(/\s/g, ''), 'Noimpty的个人空间')
}

await test('initial DOM-ready mount preserves three gateways and the selected light theme', () => {
  const h = boot()
  h.document.dispatchEvent(new Event('DOMContentLoaded'))
  verifyHome(h)
  assert.equal(h.html.getAttribute('data-theme'), 'light')
  assert.equal(h.hubReady(), 1)
})

await test('repeated PJAX completion does not duplicate hero, decoration or gateways', () => {
  const h = boot({ readyState: 'complete' })
  for (let i = 0; i < 3; i++) { h.window.dispatchEvent(new Event('pjax:complete')); h.flush() }
  verifyHome(h)
  assert.equal(h.hubReady(), 1)
  assert.equal(h.html.getAttribute('data-theme'), 'light')
})

await test('PJAX departure removes home state and return mounts one fresh homepage', () => {
  const h = boot({ readyState: 'complete', theme: 'dark' })
  h.navigate('/extra/', false)
  assert.equal(h.html.classList.contains('noimpty-home-hub'), false)
  assert.equal(h.html.querySelectorAll('.noimpty-home-sections').length, 0)
  assert.equal(h.html.querySelectorAll('.sakura-scene').length, 0)
  h.navigate('/index.html', true)
  verifyHome(h)
  assert.equal(h.hubReady(), 2)
  assert.equal(h.html.getAttribute('data-theme'), 'dark')
})

await test('existing social links retain their node, destination and accessible label after repeated initialization', () => {
  const h = boot({ social: true })
  const original = h.document.getElementById('site_social_icons')
  const originalLink = original.querySelector('a')
  h.document.dispatchEvent(new Event('DOMContentLoaded'))
  h.window.dispatchEvent(new Event('pjax:complete')); h.flush()
  assert.equal(h.document.getElementById('site_social_icons'), original)
  assert.equal(h.html.querySelectorAll('#site_social_icons').length, 1)
  assert.equal(original.querySelector('a'), originalLink)
  assert.equal(originalLink.getAttribute('href'), 'https://example.com/profile')
  assert.equal(originalLink.getAttribute('aria-label'), 'Profile')
  verifyHome(h)
})
