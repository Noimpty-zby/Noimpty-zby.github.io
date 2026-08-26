---
title: MySQL
date: 2026-08-26 10:14:00
type: noimpty-track
aside: false
comments: false
top_img: false
privacy: protected
private_section: 课外
sitemap: false
description: "Colt Steele《The Ultimate MySQL Bootcamp: Go from SQL Beginner to Expert》的学习记录。"
---

<header class="noimpty-page-intro">
  <p class="noimpty-page-intro__eyebrow">AI Infra · 04</p>
  <h2>The Ultimate MySQL Bootcamp: Go from SQL Beginner to Expert</h2>
  <p>Colt Steele。从建第一张表讲到多表连接和索引。放在最后一门不是因为它简单 —— 而是因为脱开具体的服务去背 SQL 语法，学完就忘。有了 Go 之后才有地方把查询真正用起来。</p>
</header>

<div class="noimpty-course-meta">
  <div><b>讲师</b><span>Colt Steele</span></div>
  <div><b>平台</b><span>Udemy · 英文授课</span></div>
  <div><b>形式</b><span>大量练习 · 一个完整的数据库案例贯穿全课</span></div>
  <div><b>进度</b><span>还没开始</span></div>
</div>

<div class="noimpty-plan">
  <h3>课程覆盖</h3>
  <ul>
    <li><b>建库建表</b> —— 表结构、主键、<code>NOT NULL</code> 与默认值</li>
    <li><b>CRUD</b> —— 增删改查，以及 <code>UPDATE</code>／<code>DELETE</code> 忘写 <code>WHERE</code> 的后果</li>
    <li><b>字符串函数</b> —— 拼接、截取、替换、大小写</li>
    <li><b>细化查询</b> —— <code>DISTINCT</code>、<code>ORDER BY</code>、<code>LIMIT</code>、<code>LIKE</code></li>
    <li><b>聚合</b> —— <code>COUNT</code> / <code>GROUP BY</code> / <code>MIN</code> / <code>MAX</code> / <code>SUM</code> / <code>HAVING</code></li>
    <li><b>数据类型</b> —— <code>CHAR</code> 与 <code>VARCHAR</code>、<code>DECIMAL</code> 为什么不能用浮点、日期与时间</li>
    <li><b>逻辑运算符</b> —— <code>AND</code> / <code>OR</code> / <code>BETWEEN</code> / <code>IN</code> / <code>CASE</code></li>
    <li><b>多表关系</b> —— 一对多与多对多、外键、各种 <code>JOIN</code> 的差别</li>
    <li><b>大数据量</b> —— 索引在做什么，为什么加了索引写入会变慢</li>
  </ul>

  <h3>这里会写什么</h3>
  <p>「查得出来」和「查得对、查得快」是三件事。这里写<b>结果不对的那些查询</b>（连接类型选错、<code>GROUP BY</code> 之后 <code>WHERE</code> 和 <code>HAVING</code> 用混），<b>表结构当初设计错、后来不得不改的地方</b>，以及<b>加索引前后的实测差别</b> —— 不是背「索引能加速查询」，是自己造够数据跑一遍看看差多少。</p>
</div>

{% section_posts MySQL %}
