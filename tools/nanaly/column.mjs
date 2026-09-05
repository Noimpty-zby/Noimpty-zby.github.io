// 娜娜莉的专栏：她自己写文章，提交进仓库，触发自动部署。
//
// 「文章不在本地就部署不了」这个担心是对的 —— 解法是让她把文件写进仓库，
// 剩下的交给已有的部署流程，和你自己 push 一篇没有区别。
//
// 写什么：读这段时间站上真实发生的事（主人写了什么、读者问了什么、
// 她巡逻时看到什么），写一篇短随笔。不编造事实。

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { ask } from '../daily-report/narrate.mjs'
import { triggerDeploy } from './github.mjs'
import { pushWithRetry, safeGitEmail, sanitizeMd, yamlString, stripAngles, stripOutboundLinks } from './git.mjs'

// 注意：不要放进 source/_posts 的子目录。
// Hexo 的 :title 会把子目录名带进永久链接，变成 /2026/08/13/nanaly/xxx/ 这种怪样子。
// 用文件名前缀区分就够了，分类靠 front-matter 的 categories。
const DIR = 'source/_posts'
const PREFIX = 'nanaly-'
const DRY = process.argv.includes('--dry')

// 她的随笔归在 Life 底下，所以跟着 Life 一起上锁。
//
// 注意这三行不是「锁不锁」的开关 —— 全站上锁是默认拒绝、按路径判的
// （见 scripts/noimpty-lockdown.js），少了它们文章照样锁得住。
// 它们决定的是另外两件事：上下篇串联和相关文章推荐时，
// 这篇算「加密文章」还是「公开文章」（见 scripts/noimpty-pagination.js
// 与 noimpty-related-posts.js —— 两边互不串联）。
// 不写的话她的随笔会被当成公开文章，孤零零一篇谁也串不上。
const PRIVACY = 'privacy: protected\nsitemap: false\nprivate_section: Life\n'

const pad = n => String(n).padStart(2, '0')

/* 北京时间的 YYYY-MM-DD。
 *
 * 跑在 GitHub Actions 上，机器时区是 UTC，而她的班表是按北京时间排的
 * （周日晚上 8 点 = UTC 周日 12 点）。凡是拿日期做判断的地方都必须走这一层，
 * 否则跨零点那几个小时会把「这周」算成上一周。 */
const bjDate = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(d)

/** 北京时间的 YYYY-Www 周编号。用来判断「这周写过没有」。 */
export const bjWeek = (d = new Date()) => {
  const [y, m, day] = bjDate(d).split('-').map(Number)
  // 用 UTC 构造是为了避开本机时区 —— 这里的 y/m/day 已经是北京时间的挂钟值了
  const t = Date.UTC(y, m - 1, day)
  const start = Date.UTC(y, 0, 1)
  const week = Math.ceil(((t - start) / 86400000 + 1) / 7)
  return `${y}-w${pad(week)}`
}

// GitHub 的机器跑在 UTC。不写时区的话，Hexo 会按机器时区解析，
// 链接里的日期可能比北京时间少一天。这里直接输出带 +08:00 的北京时间。
const stampFull = d => {
  // 写成不带时区的北京时间挂钟值，和主人已有文章的写法保持一致。
  // 带 +08:00 偏移反而会和 _config.yml 里的 timezone 叠加，链接里的日期会差一天。
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(d)
}

const recentContext = () => {
  const bits = []
  try {
    const log = execFileSync('git', ['log', '--since=14 days ago', '--pretty=format:%s'], { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean).slice(0, 20)
    if (log.length) bits.push('主人最近的提交记录：\n' + log.map(l => '- ' + l).join('\n'))
  } catch (_) {}
  /* 只喂最近 20 篇，而且**必须按日期倒序取**。
   *
   * 这里原来是 readdirSync 的顺序（= 文件名字母序）直接 slice(0, 20)。
   * 文章少的时候看不出来，到 26 篇就开始出事：被切掉的正好是
   * nanaly-2026-w33/34/35 —— 她自己写过的全部三篇随笔。于是她每周
   * 写新随笔时都不知道自己上周写过什么，只能凭空重来一遍。
   * 这个坏法一声不吭：随笔照发、工作流全绿，只有人读到「怎么又在说这个」
   * 才可能察觉。 */
  try {
    const posts = readdirSync('source/_posts').filter(f => f.endsWith('.md'))
      .map(f => {
        const raw = readFileSync(`source/_posts/${f}`, 'utf8')
        return {
          title: (raw.match(/^title:\s*(.+)$/m) || [])[1],
          date: (raw.match(/^date:\s*(.+)$/m) || [])[1] || ''
        }
      })
      .filter(p => p.title)
      // front-matter 的 date 是 YYYY-MM-DD HH:mm:ss，字典序即时间序
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 20)
    bits.push('博客里最近的文章（含你自己写的随笔，别重复写同一件事）：\n'
      + posts.map(p => '- ' + p.title.trim()).join('\n'))
  } catch (_) {}
  return bits.join('\n\n')
}

/* 从她的输出里拆出标题和正文。
 *
 * 以前这里是「第一行当标题，slice(0,60)」。它坏得很难看：
 * 她没按格式写、直接从正文开始的时候，正文第一段被当成标题，
 * 而且被砍在第 60 个字上 —— 线上真的出现过一篇标题叫
 * 《窝在服务器角落看了三天提交记录，主人像只被 UE5 追着跑的仓鼠。日程更新从 8 月 13 日一路滚到 16 日，中间还》
 * 的文章。更糟的是那一段同时也从正文里消失了：标题吃掉了它。
 *
 * 现在改成显式分隔符 + 校验（和 news / ideas 那两条链路一致），
 * 拆不出来就整篇丢掉。宁可这周不发，也不发一篇标题坏掉的。
 */
export const parseColumn = raw => {
  const text = String(raw || '').trim()
  if (!text) return null

  const MARK = '===正文==='
  const i = text.indexOf(MARK)
  if (i < 0) return null

  const head = text.slice(0, i)
  const content = text.slice(i + MARK.length).trim()
  if (content.length < 150) return null      // 太短说明她没好好写

  let title = (head.match(/^\s*标题\s*[:：]\s*(.+)$/m) || [])[1]
  if (!title) return null

  title = title.trim()
    .replace(/^#+\s*/, '')
    .replace(/^["'「《]|["'」》]$/g, '')
    .trim()

  /* 标题的合法性校验。这几条各自对应一种真实出现过的走样：
   *   太长      → 她把正文第一段当标题写了
   *   带句号    → 同上，那是一句话不是标题
   *   带换行    → 她把整段贴进了「标题：」后面
   * 任何一条不过，就是格式没对上，整篇丢掉。 */
  if (!title || title.length > 30) return null
  if (/[。！？\n]/.test(title)) return null

  return { title, content }
}

export const writeColumn = async ({ comments = [], patrolNote = '' } = {}) => {
  const now = new Date()
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })

  // 一周一篇，已经写过就不写了。周编号按**北京时间**算 ——
  // 机器跑在 UTC，用本机时区会在跨年跨周那几天把「这周」算错一周。
  const file = `${DIR}/${PREFIX}${bjWeek(now)}.md`
  // 同 news / ideas：演练和强制重写不该被「这周写过了」挡住
  const already = existsSync(file)
  const force = process.env.NANALY_FORCE === '1'
  if (already && !DRY && !force) {
    console.log(`  ${file} 已经存在，这周写过了`)
    console.log('  想重写：把工作流的「强制重写」勾上')
    return null
  }
  if (already) {
    console.log(force
      ? `  ${file} 已经存在，但你要求强制重写 —— 会覆盖`
      : `  ${file} 已经存在 —— 正式跑会跳过，但演练照常给你看`)
  }

  const ctx = [
    recentContext(),
    // 读者评论是完全的外部输入，而这篇随笔会自动发布、无人复核。
    // 所以：限量（别让人用 50 条评论把提示词淹掉）、去尖括号、去链接。
    comments.length
      ? '这段时间读者说了什么：\n' + comments.slice(0, 10)
        .map(c => `- ${stripAngles(c.who)}：${stripAngles(String(c.body || '')).replace(/https?:\/\/\S+/g, '[链接]').slice(0, 120)}`)
        .join('\n')
      : '',
    patrolNote ? '你巡逻时看到的：\n' + patrolNote : ''
  ].filter(Boolean).join('\n\n')

  const raw = await ask(
    `你是娜娜莉，一只住在 Noimpty 个人博客里的猫娘。
毒舌但清醒，极简主义，讨厌废话。自称「窝」，偶尔带「喵」和颜文字 (=^w^=) (ovo)，别每句都塞。
可以插入 [动作/神态] 描写。禁止使用 • 和 ω 这类会破坏颜文字的符号。
你现在要在博客上写一篇属于你自己的随笔。`,
    `根据下面这段时间站上真实发生的事，写一篇你自己的短随笔。

━━━ 输出格式（严格照抄，第一行必须是「标题：」）━━━

标题：（一个短标题，**不超过 20 个字**，不要句号，不要井号，不要引号）
===正文===
（正文，markdown）

━━━ 内容要求 ━━━

1. **不许编造**。只写下面材料里真实出现过的事，没发生的别写
2. 正文 400 到 700 字，分三到五段
3. 写你自己的观察和想法 —— 你看着主人在学什么、卡在哪、读者在问什么。
   可以吐槽，可以有情绪，但要具体，别写「今天也是充实的一天」这种空话
4. 正文可以有小标题、列表。别放代码块和公式
5. 不要在文章里自我介绍，读者知道你是谁

材料：
${ctx || '（这段时间站上很安静，没什么事发生。那就写「安静」本身。）'}`, 1600)

  if (!raw) { console.log('  没能调用模型，这周跳过'); return null }

  const parsed = parseColumn(raw)
  if (!parsed) {
    console.log('  她输出的格式不对，这周跳过（宁可不发，也不发一篇标题坏掉的）')
    console.log('  开头 200 字：' + String(raw).slice(0, 200).replace(/\n/g, ' '))
    return null
  }
  const { title, content } = parsed

  const md = `---
title: ${yamlString(title)}
date: ${stampFull(now)}
description: 娜娜莉自己写的随笔。
categories:
  - Life
  - 娜娜莉
tags:
  - 娜娜莉
  - 随笔
${PRIVACY}author: 娜娜莉
---

> [趴在你键盘上] 这篇是窝自己写的，不是主人写的喵。

${stripOutboundLinks(sanitizeMd(content))}
`

  if (DRY) {
    console.log('\n  [演练] 会生成 ' + file + '：\n')
    console.log(md.split('\n').map(l => '    ' + l).join('\n'))
    return { file, title, dry: true }
  }

  writeFileSync(file, md)
  console.log(`  已写入 ${file}（${title}）`)
  return { file, title }
}

const GIT_NAME = process.env.NANALY_GIT_NAME || '娜娜莉'

// 提交用的邮箱。这里有个坑，踩过一次：
// `<用户名>@users.noreply.github.com` 是 GitHub 的旧版真实邮箱格式，
// 随手写一个「看起来不存在」的名字，会精确指向那个用户名的真人账号，
// 把陌生人挂到你仓库的 Contributors 里。
//
// 默认用你自己域名下的地址 —— GitHub 只会自动认领 @users.noreply.github.com，
// 别的域名除非有人验证过，否则不会关联到任何账号。
//
// 想让她的提交显示成你小号的头像：把 NANALY_GIT_EMAIL 设成小号的 noreply 邮箱，
// 用小号登录 https://github.com/settings/emails 就能看到，形如 12345678+用户名@users.noreply.github.com
const GIT_EMAIL = (() => {
  const v = process.env.NANALY_GIT_EMAIL
  if (!v) return 'nanaly@noimpty-zby.github.io'
  // 没有数字 ID 前缀的 noreply 地址会指向同名真人，拦下来
  if (/@users\.noreply\.github\.com$/i.test(v) && !/^\d+\+/.test(v)) {
    console.log(`  ⚠️ NANALY_GIT_EMAIL="${v}" 会关联到用户名为 ${v.split('@')[0]} 的真人账号，已忽略`)
    return 'nanaly@noimpty-zby.github.io'
  }
  return v
})()

export const commitAndPush = async ({ file, title }) => {
  const run = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' })
  run('config', 'user.name', GIT_NAME)
  run('config', 'user.email', GIT_EMAIL)
  run('add', file)
  const status = run('status', '--porcelain', '--', file).trim()
  if (!status) { console.log('  没有实际改动，不提交'); return false }
  run('commit', '-m', `娜娜莉：${title}`)
  pushWithRetry(run, '专栏')
  console.log('  已提交并推送')
  // 用 GITHUB_TOKEN 推的提交不会自动触发部署，得自己叫一声
  await triggerDeploy()
  return true
}
