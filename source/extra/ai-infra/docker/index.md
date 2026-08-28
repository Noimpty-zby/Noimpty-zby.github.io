---
title: Docker
date: 2026-08-28 10:00:00
type: noimpty-track
aside: false
comments: false
top_img: false
privacy: protected
private_section: 课外
sitemap: false
description: 容器化：镜像、容器、Dockerfile、网络与卷。学习资料还没定。
---

<header class="noimpty-page-intro">
  <p class="noimpty-page-intro__eyebrow">AI Infra · 05</p>
  <h2>Docker</h2>
  <p>前面四门课把服务写出来、能跑通，但「在我机器上能跑」和「能部署」之间还差一层——把服务连同它的运行环境一起打包成镜像，到哪台机器上都是同一个结果。这门排在后面，是因为它依赖的东西（Linux、一个能跑的 Go 服务）前面都已经打过底。</p>
</header>

<div class="noimpty-course-meta">
  <div><b>资料</b><span>还没定</span></div>
  <div><b>环境</b><span>Linux · Docker Engine</span></div>
  <div><b>进度</b><span>还没开始</span></div>
</div>

<div class="noimpty-plan">
  <h3>预计会覆盖</h3>
  <ul>
    <li><b>镜像与容器</b> —— 两者的关系、<code>docker run</code> / <code>docker ps</code> / <code>docker exec</code> 这类基本操作</li>
    <li><b>Dockerfile</b> —— 怎么把一个服务写成可复现的镜像，层是怎么缓存的</li>
    <li><b>网络与卷</b> —— 容器之间怎么互通、数据怎么持久化</li>
    <li><b>Compose</b> —— 多容器服务怎么编排在一起</li>
  </ul>

  <h3>这里会写什么</h3>
  <p>大概率是<b>第一次镜像构建失败的原因</b>、<b>容器起来了但连不上的排查过程</b>，以及把之前 Go / MySQL 那两门课的产物真正装进容器跑起来的记录。</p>
</div>

{% section_posts Docker %}
