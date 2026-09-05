---
title: Linux 入门
date: 2026-08-26 10:11:00
type: noimpty-track
aside: false
comments: false
top_img: false
privacy: protected
private_section: 课外
sitemap: false
description: "Colt Steele《The Linux Command Line Bootcamp: Beginner To Power User》的学习记录。"
---

<header class="noimpty-page-intro">
  <p class="noimpty-page-intro__eyebrow">AI Infra · Linux · 入门</p>
  <h2>The Linux Command Line Bootcamp: Beginner To Power User</h2>
  <p>Colt Steele。从 <code>ls</code> 和 <code>cd</code> 一路讲到 shell 脚本。放在第一门是因为后面几门课全都在命令行里发生 —— 训练任务跑在没有图形界面的机器上，那时候命令行不是「一种方式」，是唯一的方式。</p>
</header>

<div class="noimpty-course-meta">
  <div><b>讲师</b><span>Colt Steele</span></div>
  <div><b>平台</b><span>Udemy · 英文授课</span></div>
  <div><b>环境</b><span>Bash · 任意发行版</span></div>
  <div><b>进度</b><span>第三章已完成</span></div>
</div>

<div class="noimpty-plan">
  <h3>课程覆盖</h3>
  <ul>
    <li><b>文件系统</b> —— 目录树的结构、绝对路径与相对路径、<code>ls</code> / <code>cd</code> / <code>pwd</code></li>
    <li><b>增删改查</b> —— <code>touch</code> / <code>mkdir</code> / <code>cp</code> / <code>mv</code> / <code>rm</code>，以及通配符</li>
    <li><b>看文档</b> —— <code>man</code>、<code>--help</code>、<code>which</code>，自己查而不是搜答案</li>
    <li><b>权限</b> —— 用户、组、<code>chmod</code> 的数字与符号两种写法、<code>sudo</code></li>
    <li><b>重定向与管道</b> —— stdin/stdout/stderr、<code>&gt;</code> 与 <code>&gt;&gt;</code>、<code>|</code> 串联命令</li>
    <li><b>搜索</b> —— <code>grep</code> 与正则、<code>find</code> 按条件筛文件</li>
    <li><b>编辑器</b> —— vim 的模式、移动、增删改查、退出</li>
    <li><b>Shell 脚本</b> —— 变量、条件、循环、参数，把重复操作固化下来</li>
  </ul>

  <h3>这里会写什么</h3>
  <p>命令的用法查手册就有，抄一遍没有意义。这里只写三类：<b>删错过的东西</b>（<code>rm</code> 的通配符、路径写错一个字符的后果），<b>看不懂的报错</b>（权限、路径、退出码到底在说什么），<b>把一串手工操作变成脚本的过程</b> —— 以及那个脚本第一次跑崩的原因。</p>
</div>

{% section_posts Linux入门 %}
