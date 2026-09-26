---
title: Linux 深入
date: 2026-08-28 10:03:00
type: noimpty-track
aside: false
comments: false
top_img: false
privacy: protected
private_section: 课外
sitemap: false
description: 系统调用、进程与内存、性能排查这一层。等入门学完再展开。
---

<header class="noimpty-hero noimpty-hero--linux-advanced">
  <div class="noimpty-hero__text">
    <nav class="noimpty-hero__crumbs" aria-label="所在位置"><a href="/extra/">extra</a><a href="/extra/ai-infra/">AI Infra</a><a href="/extra/ai-infra/linux/">Linux</a></nav>
    <h1 class="noimpty-hero__title"><span class="noimpty-hero__name">Linux 深入</span></h1>
    <div class="noimpty-course-meta">
      <div><b>资料</b><span>还没定</span></div>
      <div><b>进度</b><span>{% section_progress Linux深入 %}</span></div>
    </div>
  </div>
  <span class="noimpty-hero__mark" aria-hidden="true"><i class="fas fa-layer-group"></i></span>
</header>

{% section_posts Linux深入 %}

<details class="noimpty-fold">
  <summary>关于这门课</summary>
  <p>入门解决的是「命令怎么用」，这一部分要解决「为什么这么设计」：进程和内存是怎么被内核管理的，一条命令背后触发了哪些系统调用，服务跑得慢的时候该从哪查起。入门学完再展开，具体资料还没定。</p>
  <h3>预计会覆盖</h3>
  <ul>
    <li><b>进程与内存</b> —— 进程的生命周期、虚拟内存、内存怎么被占用和释放</li>
    <li><b>系统调用</b> —— 常用命令背后实际调用了什么</li>
    <li><b>性能排查</b> —— <code>top</code> / <code>strace</code> / <code>lsof</code> 这类工具，服务变慢时怎么定位</li>
  </ul>
  <h3>这里会写什么</h3>
  <p>大概率是<b>某次排查慢请求或者内存异常的过程</b>，以及看懂某条命令背后到底发生了什么之后的记录。</p>
</details>
