---
title: CSAPP
date: 2026-08-18 10:12:00
type: noimpty-track
aside: false
comments: false
top_img: false
privacy: protected
private_section: 课内
sitemap: false
description: CMU 15-213 Introduction to Computer Systems 的学习记录与 Lab 复盘。
---

<header class="noimpty-page-intro">
  <p class="noimpty-page-intro__eyebrow">课内 · 02</p>
  <h2>CMU 15-213：Introduction to Computer Systems</h2>
  <p>Randal Bryant &amp; David O'Hallaron。教材就是那本《深入理解计算机系统》。它回答的是一件事：<b>你写的那行 C，到底在机器上发生了什么。</b></p>
</header>

<div class="noimpty-course-meta">
  <div><b>学校</b><span>Carnegie Mellon University</span></div>
  <div><b>教材</b><span>Computer Systems: A Programmer's Perspective, 3rd Edition</span></div>
  <div><b>课程主页</b><span><a href="http://csapp.cs.cmu.edu/" target="_blank" rel="noopener">csapp.cs.cmu.edu</a></span></div>
  <div><b>投入</b><span>约 150 小时 · 难度 5/5</span></div>
  <div><b>进度</b><span>还没开始</span></div>
</div>

<div class="noimpty-plan">
  <h3>Lab 清单（这门课的真正内容）</h3>
  <ul>
    <li><b>Data Lab</b> —— 只用位运算实现一堆函数，逼你彻底搞懂补码和浮点表示</li>
    <li><b>Bomb Lab</b> —— 逆向一个二进制炸弹，读汇编读到能预测每一条跳转</li>
    <li><b>Attack Lab</b> —— 缓冲区溢出与 ROP，理解栈帧布局</li>
    <li><b>Cache Lab</b> —— 写缓存模拟器 + 优化矩阵转置，第一次真切感受局部性</li>
    <li><b>Shell Lab</b> —— 手写一个支持作业控制的 shell，信号与进程组</li>
    <li><b>Malloc Lab</b> —— 自己实现 malloc/free，隐式空闲链表到分离适配</li>
    <li><b>Proxy Lab</b> —— 带缓存的并发 Web 代理，套接字 + 多线程</li>
  </ul>

  <h3>这里会写什么</h3>
  <p>每个 Lab 一篇复盘。重点不是「我做完了」，是<b>卡住的那几个小时里到底在想什么错的东西</b> —— 这类记录半年后回看最值钱。</p>
  <p>Lab 的答案代码不公开（学术诚信），只写思路、踩的坑和调试方法。</p>
</div>

{% section_posts CSAPP %}
