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

<header class="noimpty-hero noimpty-hero--aiinfra">
  <div class="noimpty-hero__text">
    <nav class="noimpty-hero__crumbs" aria-label="所在位置"><a href="/extra/">extra</a></nav>
    <h1 class="noimpty-hero__title"><span class="noimpty-hero__name">AI Infra 后端开发</span></h1>
    <p class="noimpty-hero__lead">Linux · Git · Go · MySQL · Docker · Python · Transformer</p>
    <p class="noimpty-hero__sub"><span>7 门课</span><span>{% section_stat Linux入门|Linux深入|Git|Go|MySQL|Docker|Transformer 推理机制|Python %}</span></p>
  </div>
  <figure class="noimpty-scene" data-lines="机器人：Transformer 推理排在最后，等我哦 (・ω・)|服务器：灯一闪一闪的，是在认真干活！">
    <figcaption class="noimpty-scene__bubble">这条线的课都在这里，从 Linux 命令行开始，一门一门往下学～ <span class="noimpty-kaomoji">(｀・ω・´)ゞ</span></figcaption>
    {% kawaii aiinfra %}
  </figure>
</header>

<div class="noimpty-track-grid noimpty-track-grid--seven">
  <a class="noimpty-track-card noimpty-track-card--linux" href="/extra/ai-infra/linux/">
    <span class="noimpty-track-card__index">01</span>
    <span class="noimpty-track-card__icon" aria-hidden="true">{% kawaii penguin %}</span>
    <h3>Linux</h3>
    <span class="noimpty-track-card__by">Colt Steele · Beginner To Power User</span>
    <span class="noimpty-track-card__stat">{% section_stat 入门=Linux入门|深入=Linux深入 %}</span>
  </a>
  <a class="noimpty-track-card noimpty-track-card--git" href="/extra/ai-infra/git/">
    <span class="noimpty-track-card__index">02</span>
    <span class="noimpty-track-card__icon" aria-hidden="true">{% kawaii git %}</span>
    <h3>Git &amp; GitHub</h3>
    <span class="noimpty-track-card__by">Colt Steele · The Git &amp; Github Bootcamp</span>
    <span class="noimpty-track-card__stat">{% section_stat Git %}</span>
  </a>
  <a class="noimpty-track-card noimpty-track-card--go" href="/extra/ai-infra/go/">
    <span class="noimpty-track-card__index">03</span>
    <span class="noimpty-track-card__icon" aria-hidden="true">{% kawaii gopher %}</span>
    <h3>Go</h3>
    <span class="noimpty-track-card__by">Stephen Grider · The Complete Developer's Guide</span>
    <span class="noimpty-track-card__stat">{% section_stat Go %}</span>
  </a>
  <a class="noimpty-track-card noimpty-track-card--mysql" href="/extra/ai-infra/mysql/">
    <span class="noimpty-track-card__index">04</span>
    <span class="noimpty-track-card__icon" aria-hidden="true">{% kawaii database %}</span>
    <h3>MySQL</h3>
    <span class="noimpty-track-card__by">Colt Steele · SQL Beginner to Expert</span>
    <span class="noimpty-track-card__stat">{% section_stat MySQL %}</span>
  </a>
  <a class="noimpty-track-card noimpty-track-card--docker" href="/extra/ai-infra/docker/">
    <span class="noimpty-track-card__index">05</span>
    <span class="noimpty-track-card__icon" aria-hidden="true">{% kawaii whale %}</span>
    <h3>Docker</h3>
    <span class="noimpty-track-card__by">具体教材还没定</span>
    <span class="noimpty-track-card__stat">{% section_stat Docker %}</span>
  </a>
  <a class="noimpty-track-card noimpty-track-card--transformer" href="/extra/ai-infra/transformer/">
    <span class="noimpty-track-card__index">06</span>
    <span class="noimpty-track-card__icon" aria-hidden="true">{% kawaii robot %}</span>
    <h3>Transformer 推理机制</h3>
    <span class="noimpty-track-card__by">具体资料还没定</span>
    <span class="noimpty-track-card__stat">{% section_stat Transformer 推理机制 %}</span>
  </a>
  <a class="noimpty-track-card noimpty-track-card--python" href="/extra/ai-infra/python/">
    <span class="noimpty-track-card__index">07</span>
    <span class="noimpty-track-card__icon" aria-hidden="true">{% kawaii snake %}</span>
    <h3>Python</h3>
    <span class="noimpty-track-card__by">具体教材还没定</span>
    <span class="noimpty-track-card__stat">{% section_stat Python %}</span>
  </a>
</div>

<details class="noimpty-fold">
  <summary>为什么这么排</summary>
  <p>AI Infra 说到底是后端工程 —— 训练和推理跑在 Linux 机器上，代码靠 Git 协作，服务多半用 Go 写，状态存在数据库里。模型本身不在这四门课里，这四门课是<b>让你有资格去碰它的前提</b>。</p>
  <h3>为什么按这个顺序</h3>
  <p>前两门是<b>每天都要用的工具</b>，不熟练的话后面每门课都会被它们拖住 —— 连不上机器、看不懂报错在哪一行、改崩了回不去。所以先拿下，而且它们最短。</p>
  <p>第三门是<b>语言</b>。Go 排在工具之后、数据库之前，因为学它的时候要写小程序、要跑 <code>go test</code>、要在多个分支上试错，前两门刚好是这些事的前提。</p>
  <p>第四门是<b>数据层</b>。放最后不是因为它不重要，而是因为脱离了具体的服务去背 SQL 语法，学完就忘 —— 有了 Go 之后才有地方把查询真正用起来。</p>
  <p>后面新加的三块 —— Docker、Transformer 推理机制、Python —— 目前还没排进这套依赖链，先开着占位，等真正开始学再定顺序。</p>
</details>
