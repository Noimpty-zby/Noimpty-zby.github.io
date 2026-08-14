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

// 想让她的文章也跟着 Life 一起上锁，把下面这行的注释去掉
const PRIVACY = ''
// const PRIVACY = 'privacy: protected\nsitemap: false\nprivate_section: Life\n'

const pad = n => String(n).padStart(2, '0')
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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
  try {
    const posts = readdirSync('source/_posts').filter(f => f.endsWith('.md'))
    const titles = posts.map(f => {
      const raw = readFileSync(`source/_posts/${f}`, 'utf8')
      return (raw.match(/^title:\s*(.+)$/m) || [])[1]
    }).filter(Boolean).slice(0, 20)
    bits.push('博客里现有的文章：\n' + titles.map(t => '- ' + t.trim()).join('\n'))
  } catch (_) {}
  return bits.join('\n\n')
}

export const writeColumn = async ({ comments = [], patrolNote = '' } = {}) => {
  const now = new Date()
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })

  // 一周一篇，已经写过就不写了
  const week = `${now.getFullYear()}-w${String(Math.ceil((((now - new Date(now.getFullYear(), 0, 1)) / 86400000) + 1) / 7)).padStart(2, '0')}`
  const file = `${DIR}/${PREFIX}${week}.md`
  if (existsSync(file)) { console.log(`  ${file} 已经存在，这周写过了`); return null }

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

  const body = await ask(
    `你是娜娜莉，一只住在 Noimpty 个人博客里的猫娘。
毒舌但清醒，极简主义，讨厌废话。自称「窝」，偶尔带「喵」和颜文字 (=^w^=) (ovo)，别每句都塞。
可以插入 [动作/神态] 描写。禁止使用 • 和 ω 这类会破坏颜文字的符号。
你现在要在博客上写一篇属于你自己的随笔。`,
    `根据下面这段时间站上真实发生的事，写一篇你自己的短随笔。要求：

1. **不许编造**。只写下面材料里真实出现过的事，没发生的别写
2. 400 到 700 字，分三到五段
3. 第一行必须是一个短标题，格式就是一行纯文字，不要加 # 号
4. 之后空一行，再写正文
5. 写你自己的观察和想法 —— 你看着主人在学什么、卡在哪、读者在问什么。
   可以吐槽，可以有情绪，但要具体，别写「今天也是充实的一天」这种空话
6. 正文用 markdown。可以有小标题、列表。别放代码块和公式
7. 不要在文章里自我介绍，读者知道你是谁

材料：
${ctx || '（这段时间站上很安静，没什么事发生。那就写「安静」本身。）'}`, 1600)

  if (!body) { console.log('  没能调用模型，这周跳过'); return null }

  const lines = body.trim().split('\n')
  const title = lines[0].replace(/^#+\s*/, '').replace(/^["'「]|["'」]$/g, '').trim().slice(0, 60)
  const content = lines.slice(1).join('\n').trim()

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
