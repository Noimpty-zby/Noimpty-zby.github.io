'use strict'

/**
 * 内页的小角色：每一页一个「长了脸的小物件」，全是手写的 SVG。
 *
 * 画法照日系文具角色（San-X 那一路）：身体是圆滚滚的简单形状、粉彩色、深梅色描边；
 * 脸很小，眼睛放在身体中线以下、两眼分得开，中间一张小嘴，眼睛外下方两团腮红。
 * 外面一圈白边由 SVG 滤镜描出来，像剪下来的贴纸。
 *
 * 会动的部分只挂 class，动画和鼠标跟随写在 interior.css / interior-deco.js：
 *   .kw-eyes 眨眼   .kw-look 眼珠跟着鼠标   .kw-joy 开心时的 ^ ^ 眼
 *   .kw-bob 呼吸一样上下弹   .kw-led 指示灯   .kw-twinkle 闪光   .kw-steam 热气
 *
 * 用法见 scripts/noimpty-kawaii.js：{% kawaii core %}（页头场景）、{% kawaii tree %}（单个角色）、
 * {% kawaii tree stage %}（单个角色带小彩虹，课程页页头用）。
 */

const INK = '#5b3a48'
const CHEEK = '#ff8fab'
const S = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`
const S2 = `stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"`
const n = value => +value.toFixed(2)
// 不靠样式表也画得对（生成的 .svg 文件单独用）；页面里由 interior.css 按深浅色覆盖
const SHADOW = 'fill="#5b3a48" fill-opacity=".13"'

/* 脸：(x, y) 是两眼连线的中点 */
function face (x, y, { gap = 20, k = 1, mouth = 'w', ink = INK, cheek = CHEEK, blush = true } = {}) {
  const h = gap / 2
  const eye = dx => `<g transform="translate(${n(dx)} 0)"><ellipse rx="${n(3.1 * k)}" ry="${n(4 * k)}" fill="${ink}"/><circle cx="${n(1.1 * k)}" cy="${n(-1.5 * k)}" r="${n(1.25 * k)}" fill="#fff"/></g>`
  const arc = dx => `M${n(dx - 3.6 * k)} ${n(1.2 * k)}q${n(3.6 * k)} ${n(-4.8 * k)} ${n(7.2 * k)} 0`
  const line = `fill="none" stroke="${ink}" stroke-width="${n(2 * k)}" stroke-linecap="round" stroke-linejoin="round"`
  const mouths = {
    w: `<path d="M${n(-3 * k)} ${n(4.6 * k)}q${n(1.5 * k)} ${n(2.2 * k)} ${n(3 * k)} 0q${n(1.5 * k)} ${n(2.2 * k)} ${n(3 * k)} 0" ${line}/>`,
    u: `<path d="M${n(-2.8 * k)} ${n(4.6 * k)}q${n(2.8 * k)} ${n(3 * k)} ${n(5.6 * k)} 0" ${line}/>`,
    o: `<ellipse cy="${n(6 * k)}" rx="${n(1.8 * k)}" ry="${n(2.2 * k)}" fill="${ink}"/>`,
    v: `<path d="M${n(-3.4 * k)} ${n(4.2 * k)}q${n(3.4 * k)} ${n(5.6 * k)} ${n(6.8 * k)} 0z" fill="#ff7593" stroke="${ink}" stroke-width="${n(1.8 * k)}" stroke-linejoin="round"/>`,
    none: ''
  }
  const cheeks = blush
    ? `<ellipse cx="${n(-h - 3.4 * k)}" cy="${n(6.4 * k)}" rx="${n(4.4 * k)}" ry="${n(2.5 * k)}" fill="${cheek}" opacity=".6"/><ellipse cx="${n(h + 3.4 * k)}" cy="${n(6.4 * k)}" rx="${n(4.4 * k)}" ry="${n(2.5 * k)}" fill="${cheek}" opacity=".6"/>`
    : ''
  return `<g class="kw-face" transform="translate(${n(x)} ${n(y)})">${cheeks}<g class="kw-eyes"><g class="kw-look">${eye(-h)}${eye(h)}</g></g><path class="kw-joy" opacity="0" d="${arc(-h)}${arc(h)}" ${line}/>${mouths[mouth]}</g>`
}

const sparkle = (x, y, r, fill, d = 0) =>
  `<path class="kw-twinkle" style="--d:${d}s" d="M${x} ${y - r}c${n(r * 0.12)} ${n(r * 0.62)} ${n(r * 0.38)} ${n(r * 0.88)} ${r} ${r}c${n(-r * 0.62)} ${n(r * 0.12)} ${n(-r * 0.88)} ${n(r * 0.38)} ${-r} ${r}c${n(-r * 0.12)} ${n(-r * 0.62)} ${n(-r * 0.38)} ${n(-r * 0.88)} ${-r} ${-r}c${n(r * 0.62)} ${n(-r * 0.12)} ${n(r * 0.88)} ${n(-r * 0.38)} ${r} ${-r}z" fill="${fill}"/>`
const heart = (x, y, s, fill, extra = '') =>
  `<path ${extra} d="M${x} ${n(y + 9 * s)}c${n(-10 * s)} ${n(-6 * s)} ${n(-13 * s)} ${n(-11 * s)} ${n(-11 * s)} ${n(-15 * s)}c${n(2 * s)} ${n(-4.5 * s)} ${n(8 * s)} ${n(-5.5 * s)} ${n(11 * s)} ${n(-1 * s)}c${n(3 * s)} ${n(-4.5 * s)} ${n(9 * s)} ${n(-3.5 * s)} ${n(11 * s)} ${n(1 * s)}c${n(2 * s)} ${n(4 * s)} ${n(-1 * s)} ${n(9 * s)} ${n(-11 * s)} ${n(15 * s)}z" fill="${fill}"/>`
const note = (x, y, fill, d = 0) =>
  `<g class="kw-twinkle" style="--d:${d}s" fill="${fill}"><ellipse cx="${x}" cy="${y + 14}" rx="4.6" ry="3.6" transform="rotate(-20 ${x} ${y + 14})"/><path d="M${x + 3.6} ${y + 13}V${y}l9 3v5l-7-2" stroke="${fill}" stroke-width="2.4" stroke-linejoin="round" fill="none"/></g>`

/* ---------- 角色：都画在 120×120 的格子里，脚踩在 y≈110 ---------- */

const book = (x, y, w, h, color, band) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${color}"/>` +
  `<rect x="${x + 9}" y="${y}" width="9" height="${h}" fill="${band}"/>` +
  `<rect x="${x + w - 17}" y="${y + 4}" width="12" height="${h - 8}" rx="3" fill="#fffaf2" ${S2}/>` +
  `<path d="M${x + w - 13} ${y + 8}v${h - 16}M${x + w - 9} ${y + 8}v${h - 16}" stroke="#e8d9cf" stroke-width="1.6"/>` +
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="none" ${S}/>`

const ART = {
  books: () =>
    book(12, 85, 96, 24, '#d9c8ff', '#c4aefa') +
    book(20, 63, 86, 23, '#b7ecd6', '#9ddcc3') +
    book(8, 35, 100, 29, '#ffc2d1', '#ffabc0') +
    face(55, 48, { gap: 24, mouth: 'w' }) +
    '<g transform="rotate(-8 58 26)">' +
    `<rect x="43" y="20" width="30" height="15" rx="3" fill="#6f5a86" ${S}/>` +
    `<path d="M58 6L94 17L58 28L22 17Z" fill="#8a74ad" ${S}/>` +
    `<path d="M58 17L86 22V38" fill="none" stroke="#ffd35c" stroke-width="3" stroke-linecap="round"/>` +
    `<rect x="82" y="36" width="8" height="10" rx="2.5" fill="#ffd35c" ${S2}/><circle cx="58" cy="17" r="3.2" fill="#ffd35c"/></g>`,

  pencil: () =>
    `<rect x="45" y="6" width="30" height="18" rx="7" fill="#ffb3c6" ${S}/>` +
    `<rect x="43" y="20" width="34" height="11" rx="2" fill="#e6e0f2" ${S}/>` +
    '<path d="M50 23v5M56 23v5M64 23v5M70 23v5" stroke="#b9afcf" stroke-width="1.6"/>' +
    '<rect x="43" y="31" width="34" height="59" fill="#ffe08a"/><rect x="54" y="31" width="12" height="59" fill="#ffd262"/>' +
    `<rect x="43" y="31" width="34" height="59" fill="none" ${S}/>` +
    `<path d="M43 90L60 116L77 90Z" fill="#fbd7ae" ${S}/><path d="M54.5 107.5L60 116L65.5 107.5Z" fill="${INK}"/>` +
    face(60, 60, { gap: 15, k: 0.8, mouth: 'o' }),

  server: () =>
    `<path d="M60 14c-3-9 3-15 11-12" fill="none" ${S}/>` +
    `<rect x="31" y="100" width="13" height="10" rx="3" fill="#7fcfb8" ${S2}/><rect x="76" y="100" width="13" height="10" rx="3" fill="#7fcfb8" ${S2}/>` +
    `<rect x="19" y="14" width="82" height="90" rx="20" fill="#a8e8d4" ${S}/>` +
    `<rect x="30" y="26" width="60" height="13" rx="6.5" fill="#eafcf6" ${S2}/><rect x="30" y="45" width="60" height="13" rx="6.5" fill="#eafcf6" ${S2}/>` +
    '<path d="M38 32.5h22M38 51.5h16" stroke="#bfe6da" stroke-width="3" stroke-linecap="round"/>' +
    '<circle class="kw-led" cx="81" cy="32.5" r="3.2" fill="#ff7aa2"/><circle class="kw-led" style="--d:.5s" cx="72" cy="32.5" r="3.2" fill="#ffd35c"/><circle class="kw-led" style="--d:.9s" cx="81" cy="51.5" r="3.2" fill="#52c7a5"/>' +
    face(60, 78, { gap: 24, mouth: 'w' }),

  gamepad: ({ color = '#ffb3c6' } = {}) =>
    `<path d="M60 43c-3-14 5-22 15-24 9-2 13-8 11-15" fill="none" ${S2}/>` +
    `<path d="M32 43h56c13 0 19 8 21 19l5 27c2 13-4 21-13 21-7 0-11-5-14-11l-4-7H37l-4 7c-3 6-7 11-14 11-9 0-15-8-13-21l5-27c2-11 8-19 21-19z" fill="${color}" ${S}/>` +
    '<path d="M28 57h8v6h6v8h-6v6h-8v-6h-6v-8h6z" fill="#7a5566"/>' +
    `<circle cx="88" cy="59" r="5" fill="#8fd3ff" ${S2}/><circle cx="98" cy="69" r="5" fill="#ffe08a" ${S2}/><circle cx="80" cy="71" r="4" fill="#fff" ${S2}/>` +
    face(59, 70, { gap: 13, k: 0.82, mouth: 'v' }),

  onigiri: () =>
    `<path d="M60 12c9 0 15 6 20 15l24 44c9 17 1 35-20 35H36c-21 0-29-18-20-35l24-44c5-9 11-15 20-15z" fill="#fffdf9" ${S}/>` +
    '<ellipse cx="46" cy="38" rx="2.2" ry="1.3" fill="#e5d6c2" transform="rotate(-30 46 38)"/><ellipse cx="72" cy="46" rx="2.2" ry="1.3" fill="#e5d6c2" transform="rotate(25 72 46)"/><ellipse cx="60" cy="30" rx="2.2" ry="1.3" fill="#e5d6c2"/>' +
    `<path d="M40 106V86c0-4 3-7 7-7h26c4 0 7 3 7 7v20z" fill="#44544b" ${S}/>` +
    face(60, 62, { gap: 24, mouth: 'w' }),

  mug: () =>
    `<path d="M86 58c15 0 21 8 21 17s-6 17-21 17" fill="none" stroke="${INK}" stroke-width="13" stroke-linecap="round"/>` +
    '<path d="M86 58c15 0 21 8 21 17s-6 17-21 17" fill="none" stroke="#ffcfb0" stroke-width="7" stroke-linecap="round"/>' +
    `<rect x="18" y="44" width="70" height="64" rx="15" fill="#ffd4b8" ${S}/>` +
    `<ellipse cx="53" cy="50" rx="28" ry="5.5" fill="#c98f66" ${S2}/>` +
    '<path class="kw-steam" d="M42 36c-6-7 3-11-1-19" fill="none" stroke="#f3b3c6" stroke-width="3.2" stroke-linecap="round"/>' +
    '<path class="kw-steam" style="--d:.8s" d="M62 34c-6-8 4-12 0-21" fill="none" stroke="#f3b3c6" stroke-width="3.2" stroke-linecap="round"/>' +
    heart(80, 22, 0.55, '#ff9fb8', 'class="kw-steam" style="--d:1.4s"') +
    face(53, 78, { gap: 22, mouth: 'u' }),

  sprout: ({ git = false } = {}) =>
    `<path d="M34 76h52l-6 29c-1 4-4 6-8 6H48c-4 0-7-2-8-6z" fill="${git ? '#ffcab8' : '#ffd0bd'}" ${S}/>` +
    (git
      ? `<path d="M60 66V30M60 58c13-1 18-8 18-22" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>` +
        '<path d="M60 66V30M60 58c13-1 18-8 18-22" fill="none" stroke="#86d494" stroke-width="3.4" stroke-linecap="round"/>' +
        `<path d="M60 32c-6-12-20-14-25-7 5 10 17 11 25 7z" fill="#a6e3a1" ${S2}/><path d="M78 37c3-13 19-17 25-10-4 11-16 14-25 10z" fill="#a6e3a1" ${S2}/>` +
        `<circle cx="60" cy="60" r="4.6" fill="#fff" ${S2}/><circle cx="60" cy="45" r="4.6" fill="#ffd35c" ${S2}/><circle cx="76.5" cy="45" r="4.6" fill="#ff9fb8" ${S2}/>`
      : `<path d="M60 66V38" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M60 66V38" fill="none" stroke="#86d494" stroke-width="3.4" stroke-linecap="round"/>` +
        `<path d="M60 44c-6-12-22-15-27-7 6 11 19 11 27 7z" fill="#a6e3a1" ${S2}/><path d="M60 39c4-14 21-18 27-10-4 12-18 14-27 10z" fill="#a6e3a1" ${S2}/>`) +
    `<rect x="28" y="64" width="64" height="15" rx="7" fill="${git ? '#ffb49a' : '#ffbfa6'}" ${S}/>` +
    face(60, 91, { gap: 20, k: 0.9, mouth: 'u' }),

  newspaper: () =>
    `<rect x="26" y="20" width="82" height="86" rx="9" fill="#dfe6fb" ${S}/>` +
    `<rect x="12" y="12" width="82" height="88" rx="9" fill="#fffaf2" ${S}/>` +
    `<rect x="21" y="21" width="64" height="13" rx="4" fill="#b9c9ff"/>` +
    '<path d="M21 43h28M21 51h28M21 59h20" stroke="#e2d6df" stroke-width="3.2" stroke-linecap="round"/>' +
    `<rect x="56" y="40" width="29" height="21" rx="5" fill="#ffd1dc" ${S2}/><circle cx="64" cy="48" r="3" fill="#fff"/><path d="M58 59l8-7 5 4 5-5 7 8" fill="none" stroke="#ff9fb8" stroke-width="2" stroke-linejoin="round"/>` +
    face(53, 79, { gap: 24, mouth: 'v' }),

  envelope: () =>
    `<rect x="14" y="34" width="92" height="62" rx="11" fill="#ffe3ec" ${S}/>` +
    `<path d="M20 42L60 70L100 42" fill="none" ${S}/>` +
    heart(60, 64, 0.72, '#ff7aa2', S2),

  calendar: () =>
    `<rect x="14" y="18" width="92" height="92" rx="15" fill="#fffaf5" ${S}/>` +
    `<path d="M14 33c0-8 7-15 15-15h62c8 0 15 7 15 15v9H14z" fill="#a5e3c8" ${S}/>` +
    `<rect x="33" y="7" width="10" height="21" rx="5" fill="#ece7f5" ${S2}/><rect x="77" y="7" width="10" height="21" rx="5" fill="#ece7f5" ${S2}/>` +
    ['#f1e8ee', '#ffd1dc', '#ff8fab', '#f1e8ee', '#ffd1dc'].map((c, i) => `<rect x="${24 + i * 15}" y="51" width="11" height="11" rx="3.5" fill="${c}"/>`).join('') +
    face(58, 82, { gap: 26, mouth: 'w' }) +
    `<circle cx="95" cy="99" r="12" fill="#ff8fab" ${S2}/><path d="M89.5 99l4 4 7-8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,

  clock: () =>
    `<path d="M34 100l-9 11M86 100l9 11" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>` +
    `<circle cx="31" cy="30" r="13" fill="#ffb3c6" ${S}/><circle cx="89" cy="30" r="13" fill="#ffb3c6" ${S}/>` +
    `<path d="M60 22v-8" ${S}/><circle cx="60" cy="12" r="4.5" fill="#ffd35c" ${S2}/>` +
    `<circle cx="60" cy="64" r="41" fill="#ffe39a" ${S}/><circle cx="60" cy="64" r="32" fill="#fffaf2"/>` +
    `<path d="M60 52V38M60 52l11 5" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><circle cx="60" cy="52" r="3" fill="${INK}"/>` +
    '<circle cx="36" cy="64" r="2" fill="#e8c9a0"/><circle cx="84" cy="64" r="2" fill="#e8c9a0"/><circle cx="60" cy="90" r="2" fill="#e8c9a0"/>' +
    face(60, 72, { gap: 24, k: 0.9, mouth: 'o' }),

  cloud: () =>
    `<path d="M33 98c-14 0-23-9-23-21 0-12 10-21 23-20 2-17 15-28 31-28 14 0 24 8 29 19 3-1 5-1 7-1 13 0 22 10 22 24 0 15-10 27-24 27z" fill="#fff" ${S}/>` +
    face(64, 72, { gap: 26, mouth: 'v' }),

  balloon: () =>
    `<path d="M60 70c-4 10 6 16 0 26s4 14 2 18" fill="none" ${S2}/>` +
    heart(60, 44, 2.1, '#ff9fb8', S) +
    '<ellipse cx="44" cy="30" rx="4" ry="7" fill="#fff" opacity=".75" transform="rotate(30 44 30)"/>' +
    `<path d="M56 71h8l-4 5z" fill="#ff9fb8" ${S2}/>`,

  star: () =>
    `<path d="M60 12l14 30 32 4-24 22 7 32-29-16-29 16 7-32-24-22 32-4z" fill="#ffe08a" ${S}/>` +
    face(60, 64, { gap: 17, k: 0.85, mouth: 'u' }),

  chip: () =>
    [38, 51, 64, 77].map(p => `<rect x="${p - 4}" y="12" width="8" height="14" rx="2.5" fill="#ece5f6" ${S2}/><rect x="${p - 4}" y="94" width="8" height="14" rx="2.5" fill="#ece5f6" ${S2}/><rect x="12" y="${p - 4}" width="14" height="8" rx="2.5" fill="#ece5f6" ${S2}/><rect x="94" y="${p - 4}" width="14" height="8" rx="2.5" fill="#ece5f6" ${S2}/>`).join('') +
    `<rect x="22" y="22" width="76" height="76" rx="16" fill="#ffd0a8" ${S}/>` +
    '<circle cx="34" cy="34" r="3.4" fill="#e9a878"/>' +
    `<rect x="44" y="30" width="32" height="12" rx="4" fill="#ffe3cc"/>` +
    face(60, 64, { gap: 26, mouth: 'w' }),

  penguin: ({ glasses = false } = {}) =>
    `<ellipse cx="46" cy="108" rx="11" ry="5.5" fill="#ffb347" ${S2}/><ellipse cx="74" cy="108" rx="11" ry="5.5" fill="#ffb347" ${S2}/>` +
    `<ellipse cx="22" cy="72" rx="9" ry="19" fill="#5a5878" ${S} transform="rotate(22 22 72)"/><ellipse cx="98" cy="72" rx="9" ry="19" fill="#5a5878" ${S} transform="rotate(-22 98 72)"/>` +
    `<path d="M60 12c-2-6 4-11 10-8" fill="none" ${S}/>` +
    `<path d="M60 12c30 0 41 24 41 51 0 30-17 46-41 46S19 93 19 63c0-27 11-51 41-51z" fill="#5a5878" ${S}/>` +
    '<path d="M60 34c-20 0-29 13-29 31 0 23 12 38 29 38s29-15 29-38c0-18-9-31-29-31z" fill="#fffaf5"/>' +
    face(60, 58, { gap: 20, mouth: 'none' }) +
    `<path d="M53 65q7-4 14 0q-7 7-14 0z" fill="#ffb347" ${S2}/>` +
    (glasses ? `<g fill="rgba(255,255,255,.25)" ${S2}><circle cx="50" cy="58" r="9"/><circle cx="70" cy="58" r="9"/></g><path d="M59 57h2" ${S2}/>` : ''),

  terminal: () =>
    `<rect x="10" y="18" width="100" height="84" rx="14" fill="#3d3452" ${S}/>` +
    '<path d="M11.5 32c0-7 6-12.5 12.5-12.5h72c7 0 12.5 5.5 12.5 12.5v4h-97z" fill="#574a73"/>' +
    '<circle cx="24" cy="28" r="3.4" fill="#ff8fab"/><circle cx="35" cy="28" r="3.4" fill="#ffd35c"/><circle cx="46" cy="28" r="3.4" fill="#8fe0c0"/>' +
    '<text x="20" y="54" fill="#9ff0d0" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="12" font-weight="700">$ ls</text>' +
    '<rect class="kw-led" x="52" y="45" width="7" height="11" rx="1" fill="#9ff0d0"/>' +
    face(60, 76, { gap: 26, mouth: 'w', ink: '#c9f7e6', cheek: '#ff8fab' }),

  pixelheart: () =>
    ['.XX.XX.', 'XXXXXXX', 'XWXXXXX', '.XXXXX.', '..XXX..', '...X...'].flatMap((row, y) =>
      [...row].map((c, x) => c === '.' ? '' : `<rect x="${18 + x * 12}" y="${26 + y * 12}" width="12" height="12" fill="${c === 'W' ? '#fff' : '#ff8fab'}" ${S2}/>`)).join(''),

  teapot: () =>
    `<path d="M86 72c10-2 14-10 18-22 2-5 8-5 9 0 1 10-6 30-24 36z" fill="#b8dcff" ${S}/>` +
    `<path d="M30 58c-18 0-22 22-6 30" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/><path d="M30 58c-18 0-22 22-6 30" fill="none" stroke="#b8dcff" stroke-width="6" stroke-linecap="round"/>` +
    `<rect x="38" y="100" width="40" height="9" rx="4" fill="#9ccaf5" ${S2}/>` +
    `<path d="M58 44c26 0 36 16 36 33s-12 29-36 29-36-12-36-29 10-33 36-33z" fill="#b8dcff" ${S}/>` +
    `<path d="M37 47c0-8 9-12 21-12s21 4 21 12z" fill="#dcedff" ${S}/><circle cx="58" cy="30" r="5.5" fill="#ff9fb8" ${S2}/>` +
    face(58, 76, { gap: 24, mouth: 'v' }),

  tree: () =>
    `<path d="M52 111l3-30h10l3 30z" fill="#e0b089" ${S}/>` +
    `<path d="M60 10c16 0 26 10 28 22 12 2 21 12 21 25 0 16-12 27-29 27H40c-17 0-29-11-29-27 0-13 9-23 21-25 2-12 12-22 28-22z" fill="#b0ebbf" ${S}/>` +
    '<path d="M60 25L37 44M60 25L83 44" stroke="#7fcf95" stroke-width="2.6" stroke-linecap="round"/>' +
    `<circle cx="60" cy="25" r="6.5" fill="#ff9fb8" ${S2}/><circle cx="37" cy="44" r="6" fill="#ffd35c" ${S2}/><circle cx="83" cy="44" r="6" fill="#ffd35c" ${S2}/>` +
    face(60, 64, { gap: 24, mouth: 'w' }),

  gopher: () =>
    '<path d="M2 62h12M-2 74h14M4 86h10" stroke="#9fd8dc" stroke-width="3" stroke-linecap="round"/>' +
    `<path d="M100 76l6-66" ${S}/><path d="M105 12l22 8-24 9z" fill="#ffe08a" ${S2}/>` +
    `<path d="M60 30c-4-10 3-18 11-15" fill="none" ${S}/>` +
    `<path d="M60 30c28 0 44 20 44 45 0 22-18 34-44 34S16 97 16 75c0-25 16-45 44-45z" fill="#a3e4ea" ${S}/>` +
    `<path d="M20 58c27-9 53-9 80 0" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/><path d="M20 58c27-9 53-9 80 0" fill="none" stroke="#ff8fab" stroke-width="5" stroke-linecap="round"/>` +
    `<ellipse cx="100" cy="76" rx="7" ry="6" fill="#a3e4ea" ${S2}/>` +
    face(58, 78, { gap: 24, mouth: 'v' }),

  database: () =>
    `<path d="M26 30v62c0 8 15 14 34 14s34-6 34-14V30" fill="#b3d8f3" ${S}/>` +
    `<path d="M26 54c0 8 15 14 34 14s34-6 34-14" fill="none" ${S2}/>` +
    `<ellipse cx="60" cy="30" rx="34" ry="12" fill="#d8ecfb" ${S}/>` +
    '<circle class="kw-led" cx="84" cy="60" r="3" fill="#ff7aa2"/>' +
    face(60, 84, { gap: 24, mouth: 'w' }),

  whale: () =>
    `<path d="M22 76c-9-6-14-17-9-26 6 2 10 6 12 11 2-7 9-11 15-11 0 11-7 21-18 26z" fill="#a6cff5" ${S}/>` +
    [[42, 31], [58, 31], [74, 31], [58, 19]].map(([x, y], i) => `<rect x="${x}" y="${y}" width="15" height="13" rx="2.5" fill="${['#fff', '#ffe3ec', '#fff5cf', '#e0f5ec'][i]}" ${S2}/><path d="M${x + 5} ${y + 3}v7M${x + 10} ${y + 3}v7" stroke="#b9d6f2" stroke-width="1.6"/>`).join('') +
    `<path d="M16 78c0-22 20-34 46-34h12c25 0 40 12 40 31 0 21-18 33-50 33-30 0-48-12-48-30z" fill="#a6cff5" ${S}/>` +
    '<path d="M34 96c10 6 22 9 34 9 18 0 33-5 41-15" fill="none" stroke="#e3f1fd" stroke-width="5" stroke-linecap="round"/>' +
    face(84, 72, { gap: 18, k: 0.9, mouth: 'u' }),

  snake: () =>
    `<path d="M98 101c12 2 18-5 15-13" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/><path d="M98 101c12 2 18-5 15-13" fill="none" stroke="#ffe08a" stroke-width="4.5" stroke-linecap="round"/>` +
    `<rect x="14" y="84" width="92" height="25" rx="12.5" fill="#ffe08a" ${S}/>` +
    `<rect x="24" y="63" width="72" height="24" rx="12" fill="#ffe08a" ${S}/>` +
    `<path d="M46 68c-3-12 3-21 14-26" fill="none" stroke="${INK}" stroke-width="21" stroke-linecap="round"/><path d="M46 68c-3-12 3-21 14-26" fill="none" stroke="#ffe08a" stroke-width="15" stroke-linecap="round"/>` +
    [[32, 97], [58, 98], [86, 97], [52, 76], [76, 75]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.2" fill="#8ec5f2"/>`).join('') +
    '<path d="M86 45l9 2 4-4M95 47l3 5" fill="none" stroke="#ff6f8e" stroke-width="2.2" stroke-linecap="round"/>' +
    `<ellipse cx="66" cy="37" rx="22" ry="18" fill="#ffe08a" ${S}/>` +
    face(66, 37, { gap: 17, k: 0.85, mouth: 'u' }),

  robot: () =>
    `<path d="M60 31V15" ${S}/><circle class="kw-led" cx="60" cy="11" r="6" fill="#ff8fab" ${S2}/>` +
    `<rect x="12" y="52" width="12" height="24" rx="5" fill="#c4b0f5" ${S}/><rect x="96" y="52" width="12" height="24" rx="5" fill="#c4b0f5" ${S}/>` +
    `<rect x="40" y="90" width="40" height="20" rx="7" fill="#c4b0f5" ${S}/>` +
    heart(60, 98, 0.35, '#ff8fab') +
    `<rect x="20" y="30" width="80" height="62" rx="21" fill="#dccdff" ${S}/>` +
    `<rect x="30" y="42" width="60" height="38" rx="13" fill="#3d3452" ${S2}/>` +
    face(60, 58, { gap: 24, mouth: 'w', ink: '#c9f7e6', cheek: '#ff8fab' })
}

/* 单个角色的描述：画哪个、参数、给读屏的名字 */
const SINGLE = {
  books: ['books', {}, '戴学士帽的一摞书'],
  pencil: ['pencil', {}, '铅笔'],
  server: ['server', {}, '服务器'],
  gamepad: ['gamepad', {}, '游戏手柄'],
  'gamepad-blue': ['gamepad', { color: '#b8dcff' }, '游戏手柄'],
  onigiri: ['onigiri', {}, '饭团'],
  mug: ['mug', {}, '冒热气的杯子'],
  sprout: ['sprout', {}, '小盆栽'],
  git: ['sprout', { git: true }, '长出分支的小盆栽'],
  newspaper: ['newspaper', {}, '报纸'],
  envelope: ['envelope', {}, '信封'],
  calendar: ['calendar', {}, '日历'],
  clock: ['clock', {}, '闹钟'],
  cloud: ['cloud', {}, '云朵'],
  balloon: ['balloon', {}, '爱心气球'],
  star: ['star', {}, '星星'],
  chip: ['chip', {}, '芯片'],
  penguin: ['penguin', {}, '企鹅'],
  'penguin-glasses': ['penguin', { glasses: true }, '戴眼镜的企鹅'],
  terminal: ['terminal', {}, '终端窗口'],
  pixelheart: ['pixelheart', {}, '像素爱心'],
  teapot: ['teapot', {}, '犹他茶壶'],
  tree: ['tree', {}, '结了果子的树'],
  gopher: ['gopher', {}, '举着小旗的团子'],
  database: ['database', {}, '数据库'],
  whale: ['whale', {}, '驮着集装箱的鲸鱼'],
  snake: ['snake', {}, '小蛇'],
  robot: ['robot', {}, '机器人']
}

/* 页头场景：[角色, 中心 x, 脚底 y, 缩放, 旋转, 弹跳延迟]，外加一些点缀 */
const SCENES = {
  core: {
    label: '一摞戴学士帽的书和一支铅笔',
    cast: [['pencil', 72, 196, 0.72, -9, 0.6], ['books', 178, 198, 1.08, 0, 0]],
    deco: sparkle(250, 56, 9, '#ffd35c', 0.3) + sparkle(44, 70, 6, '#ff9fb8', 1.1) + heart(116, 60, 0.6, '#ff9fb8', 'class="kw-twinkle" style="--d:.7s"')
  },
  extra: {
    label: '一台服务器和一个游戏手柄',
    cast: [['server', 124, 198, 1.08, 0, 0], ['gamepad', 238, 198, 0.74, 8, 0.7]],
    deco: sparkle(226, 66, 8, '#8fe0c0', 0.2) + sparkle(46, 80, 6, '#ffd35c', 1) + note(250, 92, '#ff9fb8', 0.5)
  },
  life: {
    label: '一杯热茶和一个饭团',
    cast: [['mug', 116, 198, 1.02, 0, 0], ['onigiri', 232, 198, 0.78, 6, 0.6]],
    deco: sparkle(258, 70, 8, '#ffd35c', 0.4) + note(40, 84, '#ff9fb8', 0.9) + sparkle(190, 60, 5, '#b89cff', 1.4)
  },
  news: {
    label: '一张报纸和一封飞来的信',
    cast: [['newspaper', 136, 198, 1.08, -3, 0], ['envelope', 248, 112, 0.56, 12, 0.5]],
    deco: '<path d="M196 92h-18M200 104h-24M196 116h-16" stroke="#b9c9ff" stroke-width="3.2" stroke-linecap="round"/>' + sparkle(52, 76, 7, '#ffd35c', 0.8) + sparkle(270, 56, 5, '#ff9fb8', 0.2)
  },
  schedule: {
    label: '一本日历和一个闹钟',
    cast: [['calendar', 128, 198, 1.08, -2, 0], ['clock', 242, 198, 0.72, 9, 0.5]],
    deco: '<path d="M214 104l-8-6M270 104l8-6M242 88v-8" stroke="#ffb3c6" stroke-width="3" stroke-linecap="round" class="kw-twinkle" style="--d:.4s"/>' + sparkle(46, 76, 7, '#ffd35c', 1) + sparkle(196, 60, 5, '#8fe0c0', 0.2)
  },
  about: {
    label: '一朵云、一颗星星和一只爱心气球',
    cast: [['star', 62, 150, 0.52, -12, 0.9], ['cloud', 160, 198, 1.1, 0, 0], ['balloon', 252, 150, 0.7, 8, 0.4]],
    deco: sparkle(110, 50, 7, '#ffd35c', 0.6) + sparkle(214, 44, 5, '#b89cff', 1.3)
  },
  aiinfra: {
    label: '一台服务器和一个小机器人',
    cast: [['server', 124, 198, 1.08, 0, 0], ['robot', 238, 198, 0.74, 7, 0.6]],
    deco: sparkle(230, 60, 8, '#b89cff', 0.3) + sparkle(46, 80, 6, '#8fe0c0', 1.1) + heart(196, 84, 0.5, '#ff9fb8', 'class="kw-twinkle" style="--d:.8s"')
  },
  gamedev: {
    label: '一个游戏手柄、一只茶壶和一颗像素爱心',
    cast: [['pixelheart', 58, 120, 0.4, -10, 0.8], ['gamepad', 150, 198, 1.1, 0, 0], ['teapot', 254, 198, 0.66, 8, 0.5]],
    deco: sparkle(214, 70, 7, '#ffd35c', 0.3) + sparkle(84, 170, 5, '#8fd3ff', 1)
  },
  linux: {
    label: '一只企鹅和一个终端窗口',
    cast: [['penguin', 124, 198, 1.08, 0, 0], ['terminal', 240, 198, 0.7, 7, 0.5]],
    deco: sparkle(222, 70, 8, '#ffd35c', 0.2) + sparkle(46, 84, 6, '#8fe0c0', 1) + note(62, 50, '#b89cff', 0.6)
  }
}

/* 描一圈白边 + 一点投影，像剪下来的贴纸。每次渲染一个新 id，同一页放几个也不会串 */
let uid = 0
const sticker = id =>
  `<filter id="${id}" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">` +
  // 先膨胀再模糊再卡阈值：白边的拐角是圆的，不会在尖角处鼓成方块
  '<feMorphology in="SourceAlpha" operator="dilate" radius="1.6" result="grow"/><feGaussianBlur in="grow" stdDeviation="2.2" result="blur"/>' +
  '<feComponentTransfer in="blur" result="edge"><feFuncA type="linear" slope="7" intercept="-.4"/></feComponentTransfer>' +
  '<feGaussianBlur in="edge" stdDeviation="3" result="soft"/><feOffset in="soft" dy="3.5" result="drop"/>' +
  '<feFlood flood-color="#8a3d5c" flood-opacity=".22"/><feComposite in2="drop" operator="in" result="shadow"/>' +
  '<feFlood flood-color="#fff"/><feComposite in2="edge" operator="in" result="rim"/>' +
  '<feMerge><feMergeNode in="shadow"/><feMergeNode in="rim"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'

const draw = (key, filter) => {
  const [art, options] = SINGLE[key]
  return `<g filter="url(#${filter})">${ART[art](options)}</g>`
}

const place = ([key, cx, foot, scale, rotate, delay], filter) =>
  `<g transform="translate(${n(cx - 60 * scale)} ${n(foot - 111 * scale)}) scale(${scale}) rotate(${rotate} 60 60)">` +
  `<ellipse class="kw-shadow" cx="60" cy="112" rx="38" ry="5" ${SHADOW}/>` +
  `<g class="kw-bob" style="--d:${delay}s">${draw(key, filter)}</g></g>`

/* 梦幻系的背景：一道粉彩彩虹，两脚踩在云上 */
const puff = (x, y, s) =>
  `<path class="kw-puff" fill="#fff" opacity=".9" d="M${x - 30 * s} ${y}c${-9 * s} 0 ${-13 * s} ${-12 * s} ${-3 * s} ${-16 * s}c${2 * s} ${-12 * s} ${18 * s} ${-14 * s} ${22 * s} ${-5 * s}c${6 * s} ${-12 * s} ${26 * s} ${-10 * s} ${26 * s} ${3 * s}c${12 * s} ${-2 * s} ${19 * s} ${12 * s} ${9 * s} ${18 * s}z"/>`
const rainbow = () =>
  '<g class="kw-rainbow" opacity=".55">' +
  ['#ffb3c6', '#ffd59e', '#fff0a0', '#b8ecd9', '#b5dcff', '#d8c6ff'].map((c, i) => {
    const r = 128 - i * 9
    return `<path d="M${150 - r} 196A${r} ${r} 0 0 1 ${150 + r} 196" fill="none" stroke="${c}" stroke-width="9.5"/>`
  }).join('') + '</g>' + puff(38, 200, 1.1) + puff(262, 200, 1.1)

/* 课程页页头用的单个角色：身后一道小彩虹、脚下两团云、旁边几颗闪光，和场景同一套 */
const stage = () =>
  '<g class="kw-rainbow" opacity=".55">' +
  ['#ffb3c6', '#ffd59e', '#fff0a0', '#b8ecd9', '#b5dcff', '#d8c6ff'].map((c, i) => {
    const r = 74 - i * 6.5
    return `<path d="M${60 - r} 112A${r} ${r} 0 0 1 ${60 + r} 112" fill="none" stroke="${c}" stroke-width="7"/>`
  }).join('') + '</g>' + puff(-4, 116, 0.8) + puff(124, 116, 0.8) +
  `<g class="kw-deco">${sparkle(-12, 30, 7, '#ffd35c', 0.2)}${sparkle(130, 20, 5, '#ff9fb8', 1)}${sparkle(122, 66, 4, '#b89cff', 0.6)}</g>`

function render (name) {
  const id = `kw-sticker-${++uid}`
  if (SCENES[name]) {
    const scene = SCENES[name]
    return `<svg xmlns="http://www.w3.org/2000/svg" class="kw kw--scene kw--${name}" viewBox="0 0 300 214" role="img" aria-label="${scene.label}" focusable="false">` +
      `<defs>${sticker(id)}</defs>${rainbow()}<g class="kw-deco">${scene.deco}</g>${scene.cast.map(c => place(c, id)).join('')}</svg>`
  }
  const [key, mode] = name.split(/\s+/)
  if (!SINGLE[key] || (mode && mode !== 'stage')) throw new Error(`kawaii: 没有「${name}」，可选：${[...Object.keys(SCENES), ...Object.keys(SINGLE)].join(' ')}；单个角色后面可以加 stage`)
  const box = mode ? '-34 -14 188 138' : '-12 -10 144 132'
  return `<svg xmlns="http://www.w3.org/2000/svg" class="kw kw--one kw--${key}" viewBox="${box}" role="img" aria-label="${SINGLE[key][2]}" focusable="false">` +
    `<defs>${sticker(id)}</defs>${mode ? stage() : ''}<ellipse class="kw-shadow" cx="60" cy="113" rx="36" ry="5" ${SHADOW}/><g class="kw-bob">${draw(key, id)}</g></svg>`
}

module.exports = { render, names: () => [...Object.keys(SCENES), ...Object.keys(SINGLE)] }
