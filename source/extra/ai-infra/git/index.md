---
title: Git & GitHub
date: 2026-08-26 10:12:00
type: noimpty-track
aside: false
comments: false
top_img: false
privacy: protected
private_section: 课外
sitemap: false
description: Colt Steele《The Git & Github Bootcamp》的学习记录。
---

<header class="noimpty-page-intro">
  <p class="noimpty-page-intro__eyebrow">AI Infra · 02</p>
  <h2>The Git &amp; Github Bootcamp</h2>
  <p>Colt Steele。<code>add</code> / <code>commit</code> / <code>push</code> 三条命令谁都会敲，这门课要解决的是另外那件事：<b>改崩了怎么回去。</b>它会把 Git 底层存了什么讲开，所以 <code>reset</code> 和 <code>revert</code> 的区别不再需要背。</p>
</header>

<div class="noimpty-course-meta">
  <div><b>讲师</b><span>Colt Steele</span></div>
  <div><b>平台</b><span>Udemy · 英文授课</span></div>
  <div><b>配套</b><span>GitHub 协作流程</span></div>
  <div><b>进度</b><span>命令行速成 + 基本循环，已写 2 篇</span></div>
</div>

<div class="noimpty-plan">
  <h3>课程覆盖</h3>
  <ul>
    <li><b>基本循环</b> —— 工作区、暂存区、仓库三者的关系，以及一次提交到底发生了什么</li>
    <li><b>分支与合并</b> —— 创建、切换、快进合并与三方合并、冲突怎么解</li>
    <li><b>比较与暂存</b> —— <code>diff</code> 的几种用法、<code>stash</code></li>
    <li><b>撤销</b> —— <code>checkout</code> / <code>restore</code> / <code>reset</code> / <code>revert</code> 各自撤销的是什么</li>
    <li><b>远程</b> —— remote、<code>fetch</code> 与 <code>pull</code> 的差别、追踪分支</li>
    <li><b>协作</b> —— 功能分支、Pull Request、Fork 与开源贡献流程</li>
    <li><b>变基</b> —— <code>rebase</code> 与交互式变基，以及那条「不要对已推送的提交变基」的规矩</li>
    <li><b>底层</b> —— refs、对象与 SHA、<code>reflog</code>（后悔药的后悔药）</li>
  </ul>

  <h3>这里会写什么</h3>
  <p>这个博客本身就是一个 Git 仓库，还有几个定时任务会自动往里提交 —— 所以「两边同时改同一个文件」这种事是每天都在发生的常态，不是教科书例题。这里会写<b>真撞上的冲突和它的解法</b>、<b>每一次「完了，写的东西没了」以及最后是怎么找回来的</b>，还有<b>为什么某条命令看起来对但用错了场合</b>。</p>
</div>

{% section_posts Git %}
