---
title: 操作系统
date: 2026-08-18 10:13:00
type: noimpty-track
aside: false
comments: false
top_img: false
privacy: protected
private_section: 课内
sitemap: false
description: 南京大学「操作系统：设计与实现」（蒋炎岩）的学习记录与 Lab 复盘。
---

<header class="noimpty-page-intro">
  <p class="noimpty-page-intro__eyebrow">课内 · 03</p>
  <h2>操作系统：设计与实现</h2>
  <p>南京大学，蒋炎岩。国内少见的「不让你背概念、直接让你写」的操作系统课。课程的口号是把操作系统当成一个<b>普通的 C 程序</b>来读 —— 它就是一堆状态机。</p>
</header>

<div class="noimpty-course-meta">
  <div><b>学校</b><span>南京大学</span></div>
  <div><b>讲师</b><span>蒋炎岩（jyy）</span></div>
  <div><b>讲义</b><span><a href="https://jyywiki.cn/OS/2022/" target="_blank" rel="noopener">jyywiki.cn/OS/2022</a></span></div>
  <div><b>Lab</b><span>5 个 MiniLab + 4 个 OSLab</span></div>
  <div><b>投入</b><span>约 150 小时 · 难度 4/5</span></div>
  <div><b>前置</b><span>体系结构 + 扎实的 C</span></div>
  <div><b>进度</b><span>还没开始</span></div>
</div>

<div class="noimpty-plan">
  <h3>三条主线</h3>
  <ul>
    <li><b>并发</b> —— 线程、互斥、条件变量、死锁，以及为什么并发 bug 那么难复现</li>
    <li><b>虚拟化</b> —— 进程、地址空间、系统调用，以及「操作系统就是个 C 程序」到底什么意思</li>
    <li><b>持久化</b> —— 设备、文件系统、崩溃一致性</li>
  </ul>

  <h3>这里会写什么</h3>
  <p>Lab 复盘为主。这门课的 Lab 有个特点：<b>代码量不大，但每一行都要求你说得出为什么</b>。所以复盘的重点是设计决策，不是实现细节。</p>
  <p>另外单独记一类东西：<b>调试手段</b>。jyy 花了很多时间讲怎么用工具而不是靠眼睛找 bug（gdb、strace、模型检验），这部分对写任何 C 项目都有用，值得单独整理。</p>
</div>

{% section_posts NJU-OS %}
