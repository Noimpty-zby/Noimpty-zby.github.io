/* 公开页面的泄漏检查。
 *
 * 全站上锁之后，对外只剩下极少数几个页面（现在是首页一个）。
 * 那几页上的**每一个字都是对全世界公开的** —— 包括被 CSS 藏起来的部分，
 * 因为「藏起来」只是不显示，源码里照样有。
 *
 * 这个检查存在的理由很具体：这类泄漏我自己就漏过两次。
 *
 *   第一次：首页三张卡片下面写着「数据结构与算法、CSAPP、操作系统、计算机网络」——
 *           锁上门，却在门牌上写清楚屋里放着什么。
 *   第二次（更隐蔽）：侧边栏的「公告」里写着「GAMES101 的课程笔记…UE5 C++ 的实践记录」。
 *           首页的侧边栏是被 CSS `display:none` 掉的，页面上根本看不见，
 *           但它在 HTML 源码里，一次「查看源代码」就全拿到了。
 *
 * 两次都不是逻辑错误，是「顺手写了一句人话」。所以靠人盯没用，得让机器盯。
 *
 * 用法：node tools/leakcheck.mjs        （需要先 npm run build）
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, sep } from 'node:path'

const ROOT = process.env.LEAKCHECK_ROOT || join(process.cwd(), 'public')

/* 不该出现在公开页面上的词。
 *
 * 判据是「知道了这个词，就知道里面有什么」。所以收的是
 * 课程名、技术栈、板块的真实用途，以及娜娜莉这种一看就知道站上有什么功能的名字。
 *
 * 反过来，这些**不算**泄漏，不要往里加：
 *   - core / extra / life —— 有意选的含糊词，看不出指向
 *   - 归档 / 分类 / 标签 / 资讯 / 日程 —— 任何博客都有，不透露内容
 *   - 站点标题、作者名、GitHub 链接 —— 你本来就署名公开的
 */
// ⚠️ 匹配是朴素的 html.includes()，不看词边界。
//    所以短词和常见英文单词绝对不能往里加 —— 'Go' 会命中 Google、
//    'Git' 会命中页脚那个 GitHub 链接，一加进来这个检查就天天误报，
//    误报几次之后没人会再认真看它。要收就收 'Golang' 这种没有歧义的写法。
const FORBIDDEN = [
  // 课程与技术栈
  'GAMES101', 'CSAPP', '15-213', 'CS144', 'ActionRoguelike',
  'Unreal', 'UE5', '虚幻',
  '图形学', '光栅化', '着色', '数据结构', '算法',
  '操作系统', '计算机网络', '计算机系统',
  'AI Infra', 'Linux', 'MySQL', 'Golang', '命令行', '后端开发',
  // 人名（课程作者）
  '闫令琪', 'Looman', 'Abdul Bari', '蒋炎岩',
  'Colt Steele', 'Stephen Grider',
  // 站上的功能与角色
  '娜娜莉',
  // 板块的真实用途
  '自学课内', '自学课外', '课程笔记', '作业复盘'
]

if (!existsSync(ROOT)) {
  console.error(`没有找到构建产物：${ROOT}\n先跑 npm run build。`)
  process.exit(1)
}

// 公开路径以构建产物里的锁清单为准 —— 那是唯一的真相来源，
// 在这里再写一份的话，两边迟早会不一致。
const manifestPath = join(ROOT, 'js', 'protected-manifest.js')
if (!existsSync(manifestPath)) {
  console.error('没有找到 js/protected-manifest.js —— 锁清单没生成，先查 lockdown 脚本。')
  process.exit(1)
}
const m = readFileSync(manifestPath, 'utf8').match(/Object\.freeze\(([\s\S]*)\);?\s*$/)
const manifest = m ? JSON.parse(m[1].replace(/\)\s*$/, '')) : {}
const publicPaths = manifest.publicPaths || ['/']

console.log(`公开页面 ${publicPaths.length} 个：${publicPaths.join('、')}\n`)

let bad = 0

for (const p of publicPaths) {
  const rel = (p === '/' ? '/index.html' : p.replace(/\/$/, '') + '/index.html')
  const file = join(ROOT, rel.slice(1).split('/').join(sep))
  if (!existsSync(file)) {
    console.log(`  ? ${p} —— 产物里没有这个页面，跳过`)
    continue
  }

  const html = readFileSync(file, 'utf8')
  const hits = FORBIDDEN.filter(w => html.includes(w))

  if (!hits.length) {
    console.log(`  ✓ ${p}`)
    continue
  }

  bad++
  console.log(`  ✗ ${p} —— 出现了 ${hits.length} 个不该出现的词：`)
  for (const w of hits) {
    // 把上下文摘出来，方便直接定位是哪一段文字
    const i = html.indexOf(w)
    const ctx = html.slice(Math.max(0, i - 60), i + w.length + 60)
      .replace(/\s+/g, ' ')
      .replace(/<[^>]*>/g, '·')
    console.log(`      「${w}」  …${ctx}…`)
  }
}

console.log('')
if (bad) {
  console.log(`✗ ${bad} 个公开页面泄漏了内部信息。`)
  console.log('  提醒：被 CSS 藏起来的东西也算泄漏 —— 源码里有就是有。')
  console.log('  常见来源：主题配置里的公告 / 站点描述 / 副标题，以及 section-hub.js 里的卡片文案。')
  process.exit(1)
}
console.log('✓ 公开页面没有泄漏内部信息')
