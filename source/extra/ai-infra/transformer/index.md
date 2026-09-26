---
title: Transformer 推理机制
date: 2026-08-28 10:01:00
type: noimpty-track
aside: false
comments: false
top_img: false
privacy: protected
private_section: 课外
sitemap: false
description: 推理时到底在算什么——attention、KV cache、批处理与量化。学习资料还没定。
---

<header class="noimpty-hero noimpty-hero--transformer">
  <div class="noimpty-hero__text">
    <nav class="noimpty-hero__crumbs" aria-label="所在位置"><a href="/extra/">extra</a><a href="/extra/ai-infra/">AI Infra</a></nav>
    <h1 class="noimpty-hero__title"><span class="noimpty-hero__name">Transformer 推理机制</span></h1>
    <div class="noimpty-course-meta">
      <div><b>资料</b><span>还没定</span></div>
      <div><b>进度</b><span>{% section_progress Transformer 推理机制 %}</span></div>
    </div>
  </div>
  <figure class="noimpty-scene noimpty-scene--one" data-lines="Attention！……是「注意力」的意思啦|一个字一个字地往外蹦～">{% kawaii robot stage %}</figure>
</header>

{% section_posts Transformer 推理机制 %}

<details class="noimpty-fold">
  <summary>关于这门课</summary>
  <p>AI Infra 这条线的目标是「把模型跑起来的那一层」，前面几门课解决的是怎么把服务立起来、部署上去；这一块要解决的是<b>被部署的那个东西自己在干什么</b>——推理请求进来之后，attention 在算什么、显存花在哪、为什么批量请求能更快。目标是看懂而不是停在调 API 的层面。</p>
  <h3>预计会覆盖</h3>
  <ul>
    <li><b>attention 的计算量</b> —— 为什么序列长度是推理成本的主要变量</li>
    <li><b>KV cache</b> —— 为什么有它、它占多少显存、怎么随上下文增长</li>
    <li><b>批处理</b> —— 多个请求怎么拼在一起算，吞吐是怎么上去的</li>
    <li><b>量化</b> —— 精度换速度换显存，代价具体是什么</li>
  </ul>
  <h3>这里会写什么</h3>
  <p>大概率是<b>手写一遍简化版推理循环</b>的记录，以及某个参数改了之后显存或者速度为什么会变——照着现成框架跑通不算数，能解释「为什么」才算。</p>
</details>
