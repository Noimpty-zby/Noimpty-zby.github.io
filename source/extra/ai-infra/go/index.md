---
title: Go
date: 2026-08-26 10:13:00
type: noimpty-track
aside: false
comments: false
top_img: false
privacy: protected
private_section: 课外
sitemap: false
description: "Stephen Grider《Go: The Complete Developer's Guide (Golang)》的学习记录。"
---

<header class="noimpty-page-intro">
  <p class="noimpty-page-intro__eyebrow">AI Infra · 03</p>
  <h2>Go: The Complete Developer's Guide (Golang)</h2>
  <p>Stephen Grider。这门课的讲法是「每讲一个概念就写一个能跑的小程序」，而不是先铺完语法再说。对已经写过 C++ 的人来说，真正要花时间的不是语法，是 Go 那套<b>刻意做减法</b>的设计：没有类和继承、没有异常、没有泛型时代之前的模板 —— 它用接口和 goroutine 换掉了这些。</p>
</header>

<div class="noimpty-course-meta">
  <div><b>讲师</b><span>Stephen Grider</span></div>
  <div><b>平台</b><span>Udemy · 英文授课</span></div>
  <div><b>形式</b><span>边讲边写 · 每章一个可运行的小程序</span></div>
  <div><b>进度</b><span>还没开始</span></div>
</div>

<div class="noimpty-plan">
  <h3>课程覆盖</h3>
  <ul>
    <li><b>基础</b> —— 包与 import、变量与类型、函数与多返回值</li>
    <li><b>数组与切片</b> —— 两者的差别、底层数组、<code>append</code> 与扩容</li>
    <li><b>自定义类型与接收者函数</b> —— Go 没有类，方法是挂在类型上的</li>
    <li><b>结构体</b> —— 组合与嵌入，用来替代继承</li>
    <li><b>Map</b> —— 和结构体的取舍：键是否已知、值是否同构</li>
    <li><b>接口</b> —— 隐式实现，不写 <code>implements</code>；这是全课最需要转过弯的一章</li>
    <li><b>并发</b> —— goroutine 与 channel、阻塞与调度、<code>select</code></li>
    <li><b>测试</b> —— <code>go test</code>，标准库自带，不用挑框架</li>
  </ul>

  <h3>这里会写什么</h3>
  <p>写过 C++ 再学 Go，最容易出错的地方恰恰是「看着眼熟」的那些：切片传参到底传了什么、接口的 nil 为什么不等于 nil、goroutine 泄漏在什么情况下发生。这里主要写<b>这些和 C++ 直觉冲突的地方</b>，以及<b>并发那一章每一个卡住的点</b> —— 那是这门课真正的分水岭，前面都是语法。</p>
</div>

{% section_posts Go %}
