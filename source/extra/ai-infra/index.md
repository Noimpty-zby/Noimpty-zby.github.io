---
title: AI Infra 后端开发
date: 2026-08-26 10:10:00
type: noimpty-hub
aside: false
comments: false
top_img: false
privacy: protected
private_section: 课外
sitemap: false
description: 现在在走的方向：Linux、Git、Go、MySQL 打底，外加 Docker、Python、Transformer 推理机制。
---

<header class="noimpty-page-intro">
  <p class="noimpty-page-intro__eyebrow">课外 · AI Infra</p>
  <h2>把模型跑起来的那一层</h2>
  <p>AI Infra 说到底是后端工程 —— 训练和推理跑在 Linux 机器上，代码靠 Git 协作，服务多半用 Go 写，状态存在数据库里。模型本身不在这四门课里，这四门课是<b>让你有资格去碰它的前提</b>。</p>
</header>

<div class="noimpty-plan">
  <h3>为什么按这个顺序</h3>
  <p>前两门是<b>每天都要用的工具</b>，不熟练的话后面每门课都会被它们拖住 —— 连不上机器、看不懂报错在哪一行、改崩了回不去。所以先拿下，而且它们最短。</p>
  <p>第三门是<b>语言</b>。Go 排在工具之后、数据库之前，因为学它的时候要写小程序、要跑 <code>go test</code>、要在多个分支上试错，前两门刚好是这些事的前提。</p>
  <p>第四门是<b>数据层</b>。放最后不是因为它不重要，而是因为脱离了具体的服务去背 SQL 语法，学完就忘 —— 有了 Go 之后才有地方把查询真正用起来。</p>
  <p>后面新加的三块 —— Docker、Transformer 推理机制、Python —— 目前还没排进这套依赖链，先开着占位，等真正开始学再定顺序。</p>
</div>

<div class="noimpty-track-grid noimpty-track-grid--seven">
  <a class="noimpty-track-card noimpty-track-card--linux" href="/extra/ai-infra/linux/">
    <span class="noimpty-track-card__index">01</span>
    <span class="noimpty-track-card__icon" aria-hidden="true"><i class="fab fa-linux"></i></span>
    <h3>Linux</h3>
    <span class="noimpty-track-card__by">Colt Steele · Beginner To Power User</span>
    <p>文件系统、权限、管道与重定向、grep/find、vim、shell 脚本。服务器上没有图形界面，这就是唯一的界面。拆成入门和深入两部分。</p>
    <span class="noimpty-track-card__stat">入门已写 3 篇 · 深入还没开始</span>
  </a>
  <a class="noimpty-track-card noimpty-track-card--git" href="/extra/ai-infra/git/">
    <span class="noimpty-track-card__index">02</span>
    <span class="noimpty-track-card__icon" aria-hidden="true"><i class="fab fa-git-alt"></i></span>
    <h3>Git &amp; GitHub</h3>
    <span class="noimpty-track-card__by">Colt Steele · The Git &amp; Github Bootcamp</span>
    <p>提交、分支、合并、撤销、变基，以及 Git 底层到底存了什么。重点是「改崩了怎么回去」。</p>
    <span class="noimpty-track-card__stat">已写 2 篇</span>
  </a>
  <a class="noimpty-track-card noimpty-track-card--go" href="/extra/ai-infra/go/">
    <span class="noimpty-track-card__index">03</span>
    <span class="noimpty-track-card__icon" aria-hidden="true"><i class="fab fa-golang"></i></span>
    <h3>Go</h3>
    <span class="noimpty-track-card__by">Stephen Grider · The Complete Developer's Guide</span>
    <p>类型、切片、结构体、接口，以及 goroutine 与 channel。后端和基础设施那一层的主力语言。</p>
    <span class="noimpty-track-card__stat">还没开始</span>
  </a>
  <a class="noimpty-track-card noimpty-track-card--mysql" href="/extra/ai-infra/mysql/">
    <span class="noimpty-track-card__index">04</span>
    <span class="noimpty-track-card__icon" aria-hidden="true"><i class="fas fa-database"></i></span>
    <h3>MySQL</h3>
    <span class="noimpty-track-card__by">Colt Steele · SQL Beginner to Expert</span>
    <p>建表与数据类型、CRUD、聚合、多表连接、索引。从「查得出来」到「查得快」。</p>
    <span class="noimpty-track-card__stat">还没开始</span>
  </a>
  <a class="noimpty-track-card noimpty-track-card--docker" href="/extra/ai-infra/docker/">
    <span class="noimpty-track-card__index">05</span>
    <span class="noimpty-track-card__icon" aria-hidden="true"><i class="fab fa-docker"></i></span>
    <h3>Docker</h3>
    <span class="noimpty-track-card__by">具体教材还没定</span>
    <p>把服务从「装在我的机器上」变成「装在镜像里」。镜像、容器、Dockerfile、网络与卷，AI Infra 部署绕不开它。</p>
    <span class="noimpty-track-card__stat">还没开始</span>
  </a>
  <a class="noimpty-track-card noimpty-track-card--transformer" href="/extra/ai-infra/transformer/">
    <span class="noimpty-track-card__index">06</span>
    <span class="noimpty-track-card__icon" aria-hidden="true"><i class="fas fa-brain"></i></span>
    <h3>Transformer 推理机制</h3>
    <span class="noimpty-track-card__by">具体资料还没定</span>
    <p>推理时到底在算什么：attention 的计算量、KV cache、批处理与量化怎么影响速度，不停在调 API 的层面。</p>
    <span class="noimpty-track-card__stat">还没开始</span>
  </a>
  <a class="noimpty-track-card noimpty-track-card--python" href="/extra/ai-infra/python/">
    <span class="noimpty-track-card__index">07</span>
    <span class="noimpty-track-card__icon" aria-hidden="true"><i class="fab fa-python"></i></span>
    <h3>Python</h3>
    <span class="noimpty-track-card__by">具体教材还没定</span>
    <p>前面几门课的脚本、AI Infra 相关的小工具大多会用它写，重点预计落在标准库和常用第三方库的使用习惯上。</p>
    <span class="noimpty-track-card__stat">还没开始</span>
  </a>
</div>
