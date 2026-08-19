---
title: 自学课内
date: 2026-08-18 10:10:00
type: noimpty-hub
aside: false
comments: false
top_img: false
privacy: protected
private_section: 课内
sitemap: false
description: 计算机专业课的自学线：数据结构与算法、计算机系统、操作系统、计算机网络。
---

<header class="noimpty-page-intro">
  <p class="noimpty-page-intro__eyebrow">Core curriculum</p>
  <h2>专业课，用自己的进度学一遍</h2>
  <p>课表上会有这几门，但课堂进度和真正学会之间隔着很远。这四门按依赖关系排：先有算法和系统的底子，再啃操作系统和网络。每门都以能跑通的 Lab 为准，笔记只写「为什么这么做」。</p>
</header>

<div class="noimpty-track-grid noimpty-track-grid--four">
  <a class="noimpty-track-card noimpty-track-card--dsa" href="/in-class/dsa/">
    <span class="noimpty-track-card__index">01</span>
    <span class="noimpty-track-card__icon" aria-hidden="true"><i class="fas fa-sitemap"></i></span>
    <h3>数据结构与算法</h3>
    <span class="noimpty-track-card__by">Abdul Bari · C / C++</span>
    <p>递归、数组、链表、栈与队列、树与 BST/AVL、图、哈希、各类排序，以及时间空间复杂度分析。</p>
    <span class="noimpty-track-card__stat">约 53 小时 · 还没开始</span>
  </a>
  <a class="noimpty-track-card noimpty-track-card--csapp" href="/in-class/csapp/">
    <span class="noimpty-track-card__index">02</span>
    <span class="noimpty-track-card__icon" aria-hidden="true"><i class="fas fa-microchip"></i></span>
    <h3>CS15-213 CSAPP</h3>
    <span class="noimpty-track-card__by">Carnegie Mellon University</span>
    <p>从位运算一路到并发与网络编程。汇编、链接、异常控制流、虚拟内存、缓存 —— 程序员视角的计算机系统。</p>
    <span class="noimpty-track-card__stat">约 150 小时 · 还没开始</span>
  </a>
  <a class="noimpty-track-card noimpty-track-card--njuos" href="/in-class/nju-os/">
    <span class="noimpty-track-card__index">03</span>
    <span class="noimpty-track-card__icon" aria-hidden="true"><i class="fas fa-layer-group"></i></span>
    <h3>操作系统：设计与实现</h3>
    <span class="noimpty-track-card__by">南京大学 · 蒋炎岩</span>
    <p>不是背概念，是真的动手写。并发、虚拟化、持久化三条线，配 5 个 MiniLab 和 4 个 OSLab。</p>
    <span class="noimpty-track-card__stat">约 150 小时 · 还没开始</span>
  </a>
  <a class="noimpty-track-card noimpty-track-card--cs144" href="/in-class/cs144/">
    <span class="noimpty-track-card__index">04</span>
    <span class="noimpty-track-card__icon" aria-hidden="true"><i class="fas fa-network-wired"></i></span>
    <h3>CS144 计算机网络</h3>
    <span class="noimpty-track-card__by">Stanford · Nick McKeown</span>
    <p>8 个 checkpoint，用 C++ 从字节流一路实现到 TCP、ARP 和 IP 路由器。学完手上会有一份能跑的协议栈。</p>
    <span class="noimpty-track-card__stat">约 100 小时 · 还没开始</span>
  </a>
</div>

<div class="noimpty-plan">
  <h3>这个顺序是怎么排的</h3>
  <p><strong>算法排第一</strong>，因为后面三门的 Lab 全是 C/C++ 写的，链表和树写不利索会寸步难行。它也是唯一一门可以碎片时间推进的。</p>
  <p><strong>CSAPP 排第二</strong>，它是操作系统和网络的共同前置 —— 不理解虚拟内存和异常控制流，OS 的 Lab 只能照抄；不理解字节序和缓冲，CS144 的字节流会写得很难受。</p>
  <p><strong>OS 和网络排最后</strong>，这两门互不依赖，先做哪个都行，按当时手上的时间块决定：OS 的 Lab 需要整段时间，网络的 checkpoint 可以拆得更碎。</p>
</div>
