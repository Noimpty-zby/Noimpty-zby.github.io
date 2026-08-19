---
title: 计算机网络
date: 2026-08-18 10:14:00
type: noimpty-track
aside: false
comments: false
top_img: false
privacy: protected
private_section: 课内
sitemap: false
description: Stanford CS144 Introduction to Computer Networking 的学习记录与 checkpoint 复盘。
---

<header class="noimpty-page-intro">
  <p class="noimpty-page-intro__eyebrow">课内 · 04</p>
  <h2>CS144：Introduction to Computer Networking</h2>
  <p>Stanford，Nick McKeown。这门课的作业不是做题，是<b>用 C++ 从零实现一份能跑的 TCP/IP 协议栈</b>，最后接到助教的中转服务器上和真实网络对话。</p>
</header>

<div class="noimpty-course-meta">
  <div><b>学校</b><span>Stanford University</span></div>
  <div><b>讲师</b><span>Nick McKeown</span></div>
  <div><b>课程主页</b><span><a href="https://cs144.github.io/" target="_blank" rel="noopener">cs144.github.io</a></span></div>
  <div><b>Lab</b><span>8 个 checkpoint · 现代 C++</span></div>
  <div><b>投入</b><span>约 100 小时 · 难度 5/5</span></div>
  <div><b>进度</b><span>还没开始</span></div>
</div>

<div class="noimpty-plan">
  <h3>Checkpoint 清单</h3>
  <ul>
    <li><b>CP 0</b> —— 环境搭建、手动敲 HTTP 请求、写一个 webget、实现可靠字节流</li>
    <li><b>CP 1</b> —— 重组器：把乱序到达的分片拼回有序字节流</li>
    <li><b>CP 2</b> —— TCP 接收方：序列号、窗口、确认</li>
    <li><b>CP 3</b> —— TCP 发送方：重传超时、拥塞窗口</li>
    <li><b>CP 4</b> —— 把收发两端接成完整的 TCP 连接，抓包对照分析</li>
    <li><b>CP 5</b> —— 网络接口层：ARP 与以太网帧</li>
    <li><b>CP 6</b> —— IP 路由器：最长前缀匹配与转发</li>
    <li><b>CP 7</b> —— 端到端联调，和别人的实现互通</li>
  </ul>

  <h3>这里会写什么</h3>
  <p>每个 checkpoint 一篇。这门课特别之处是<b>它同时也是一门现代 C++ 课</b> —— 移动语义、RAII、`std::optional`、无锁思维都会自然用上。所以复盘会分两条线记：协议层面的理解，和 C++ 层面的写法取舍。</p>
  <p>同样不公开 Lab 代码，只写设计与调试过程。</p>
</div>

{% section_posts CS144 %}
