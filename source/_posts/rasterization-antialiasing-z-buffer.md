---
title: 从标准立方体到屏幕：光栅化、抗锯齿与 Z-Buffer
date: 2026-07-16 18:08:16
description: 整理视口变换、三角形光栅化、采样与混叠、MSAA 抗锯齿以及 Z-Buffer 深度测试的基本原理。
categories:
  - [课外, 游戏开发, GAMES101]
tags:
  - 光栅化
cover: /img/covers/rasterization-antialiasing-z-buffer.svg
series: GAMES101
privacy: protected
sitemap: false
private_section: 课外
---

这篇文章继续整理 GAMES101 的光栅化部分，主要包括视口变换、像素采样、混叠与抗锯齿，以及处理遮挡关系的 Z-Buffer 算法。

书接上回。经过 MVP 变换和透视除法后，场景中的点已经进入标准立方体，也就是 NDC（Normalized Device Coordinates，标准设备坐标）空间。接下来要做的事情，是把连续的几何图形真正变成屏幕上的离散像素。

<!-- more -->

上一篇笔记：{% post_link Transformation-MVP-note %}

## 一、视口变换

在 NDC 空间中，点的 $x$ 和 $y$ 坐标位于 $[-1,\ 1]$。视口变换的作用，是把它们映射到屏幕的连续坐标范围：

$$
\begin{aligned}
&[-1,\ 1] \times [-1,\ 1] \\
\longrightarrow\; &[0,\ \text{width}] \times [0,\ \text{height}]
\end{aligned}
$$

这个过程可以拆成两步：

1. 将宽和高分别缩放为原来的 $\text{width}/2$ 和 $\text{height}/2$；
2. 再平移 $(\text{width}/2,\ \text{height}/2)$，使图像中心与屏幕中心重合。

$$
M_{\text{viewport}} =
\begin{bmatrix}
\frac{\text{width}}{2} & 0 & 0 & \frac{\text{width}}{2} \\
0 & \frac{\text{height}}{2} & 0 & \frac{\text{height}}{2} \\
0 & 0 & 1 & 0 \\
0 & 0 & 0 & 1
\end{bmatrix}
$$

这一阶段主要关心 $x$ 和 $y$。深度信息不会被丢弃，而是会在后续的深度测试中继续使用。不同图形 API 对深度范围的约定可能不同，使用公式前仍然要先确认坐标约定。

## 二、像素与屏幕空间

像素可以暂时理解为屏幕上的一个小方格，每个方格最终保存一种显示颜色。

按照课程中的约定，屏幕左下角是 $(0, 0)$。如果屏幕分辨率为 $\text{width} \times \text{height}$，那么：

- 像素索引范围是 $(0, 0)$ 到 $(\text{width}-1,\ \text{height}-1)$；
- 像素 $(x, y)$ 覆盖连续区域 $[x,\ x+1] \times [y,\ y+1]$；
- 该像素的中心位于 $(x+0.5,\ y+0.5)$；
- 整个屏幕覆盖 $[0,\ \text{width}] \times [0,\ \text{height}]$。

![像素索引、像素中心与屏幕坐标范围](/img/posts/rasterization-antialiasing-z-buffer/pixel-screen-space.png)

*图 1：屏幕空间和像素中心的定义。*

需要注意，有些窗口系统把左上角作为原点，$y$ 轴向下；这和课程里的约定不同，但只要整个渲染流程保持一致，就不会产生矛盾。

## 三、三角形光栅化

任意多边形都可以拆分成若干个三角形，因此图形学中通常以三角形作为最基本的光栅化图元。

光栅化要解决的问题是：屏幕上的哪些像素应该被这个三角形覆盖？

![连续三角形覆盖像素网格](/img/posts/rasterization-antialiasing-z-buffer/triangle-on-pixel-grid.png)

*图 2：连续的三角形覆盖在离散的像素网格上。*

### 1. 在像素中心采样

最简单的方法，是对每个像素取一个样本，也就是像素中心 $(x+0.5,\ y+0.5)$，再判断这个点是否位于三角形内部。

![使用像素中心判断三角形覆盖范围](/img/posts/rasterization-antialiasing-z-buffer/pixel-center-sampling.png)

*图 3：红色采样点位于三角形内部，因此对应像素被三角形覆盖。*

伪代码可以写成：

```cpp
for (int x = 0; x < xmax; ++x)
    for (int y = 0; y < ymax; ++y)
        image[x][y] = inside(tri,
                             x + 0.5,
                             y + 0.5);
```

### 2. 如何判断点是否在三角形内

假设三角形三个顶点按同一方向排列为 $P_0$、$P_1$、$P_2$，待判断点为 $P$。可以分别计算：

$$
\begin{aligned}
&(P_1 - P_0) \times (P - P_0) \\
&(P_2 - P_1) \times (P - P_1) \\
&(P_0 - P_2) \times (P - P_2)
\end{aligned}
$$

如果三个叉积的符号一致，说明 $P$ 位于三条有向边的同一侧，可以认为它在三角形内部；如果符号不一致，则位于三角形外部。

当点刚好落在边上，也就是某个叉积为 0 时，需要规定统一的边界规则，否则相邻三角形可能重复填充同一像素，或者在接缝处留下空隙。

### 3. 使用包围盒减少计算

如果遍历整个屏幕，每个三角形都要测试全部像素，效率会很低。更实用的做法是先计算三角形在屏幕空间中的轴对齐包围盒（Axis-Aligned Bounding Box，AABB），只测试包围盒内的像素。

![使用包围盒限制需要测试的像素范围](/img/posts/rasterization-antialiasing-z-buffer/triangle-bounding-box.png)

*图 4：只遍历三角形包围盒中的像素。*

包围盒范围可以由三个顶点坐标的最小值和最大值求出，并且要裁剪到屏幕边界以内。

### 4. 一个样本带来的锯齿

只在每个像素中心采样一次，最终会得到下面这种阶梯状边缘：

![每像素单次采样产生的锯齿](/img/posts/rasterization-antialiasing-z-buffer/rasterization-aliasing.png)

*图 5：单次采样后的三角形边缘出现明显锯齿。*

这些锯齿不是三角形本身真的变成了台阶，而是连续图形被离散采样后产生的混叠现象。

## 四、为什么会产生混叠

从信号处理的角度看，图像也是一种信号。三角形边缘处颜色变化非常突然，因此包含较高的空间频率。

当采样频率不足以表达信号的最高频率时，频谱副本会发生重叠，高频信号被错误地解释成低频信号，这就是混叠（Aliasing）。锯齿只是空间采样中最直观的一种混叠现象。

![采样过疏导致频谱重叠和混叠](/img/posts/rasterization-antialiasing-z-buffer/sampling-aliasing-spectrum.png)

*图 6：采样频率过低时，频谱副本发生重叠。*

根据采样定理，为了无失真地恢复带限信号，采样频率至少应大于最高信号频率的两倍。在实际光栅化中，几何边界并不是严格的带限信号，因此只能通过近似滤波和增加采样数量来减轻混叠。

### 先滤波，再采样

一种思路是在降低采样率之前，先使用低通滤波器削弱超出采样能力的高频部分，再进行采样。

![采样前使用低通滤波抑制混叠](/img/posts/rasterization-antialiasing-z-buffer/prefilter-before-sampling.png)

*图 7：先过滤高频部分，再降低采样率，可以减少频谱重叠。*

在三角形光栅化中，可以把这种“滤波”理解为计算像素被三角形覆盖的面积，而不是只用像素中心的一个布尔值决定整个像素的颜色。

## 五、MSAA：使用多个样本估计覆盖率

只使用一个像素中心时，一个像素只能得到“完全在三角形内”或“完全在三角形外”两种结果。

![每个像素只使用一个采样点](/img/posts/rasterization-antialiasing-z-buffer/one-sample-per-pixel.png)

*图 8：每个像素只测试一个中心样本。*

MSAA（Multisample Anti-Aliasing，多重采样抗锯齿）的基本思路，是在一个像素中放置多个采样点。例如 $2 \times 2$ 分布代表每个像素测试 4 个样本。

![每个像素使用四个采样点](/img/posts/rasterization-antialiasing-z-buffer/four-samples-per-pixel.png)

*图 9：增加采样点后，可以更细致地估计三角形对像素的覆盖程度。*

如果 4 个样本中有 3 个位于三角形内部，就可以近似认为该像素有 75% 被三角形覆盖。

![多重采样计算像素覆盖率](/img/posts/rasterization-antialiasing-z-buffer/multisample-coverage.png)

*图 10：采样数量增加后，可以得到介于完全覆盖和完全不覆盖之间的结果。*

最后按照覆盖率混合三角形颜色和背景颜色，边缘像素就会产生过渡，而不是直接从一种颜色跳到另一种颜色。

![不同像素的近似覆盖率](/img/posts/rasterization-antialiasing-z-buffer/pixel-coverage-result.png)

*图 11：边缘像素根据采样结果得到 25%、50% 或 75% 等覆盖率。*

更准确地说，如果每个子样本都独立执行完整着色，更接近超采样抗锯齿（SSAA）；MSAA 通常重点提高几何覆盖和深度测试的采样数量，并尽可能共享着色结果。因此它能以较低开销改善几何边缘，但不能消除纹理、着色或透明度中的所有混叠。

## 六、Z-Buffer：解决遮挡关系

到目前为止，我们只考虑了一个三角形。当场景中有多个三角形重叠时，还需要判断每个像素最终应该显示哪一个三角形。

Z-Buffer 为屏幕上的每个像素或样本保存当前最靠近摄像机的深度值。为了便于说明，本文规定：**深度值越小表示越靠近摄像机**。

开始绘制前：

```text
depth_buffer[x][y] = +∞
```

光栅化每个三角形时，需要先根据三角形三个顶点的深度插值得到当前样本的深度 $z$，再与缓冲区中的旧值比较：

- 如果 `z < depth_buffer[x][y]`，当前样本更近，更新颜色和深度；
- 否则当前样本被遮挡，保持原来的结果。

```text
Initialize depth buffer to ∞

During rasterization:
for (each triangle T)
    for (each sample (x, y, z) in T)
        if (z < zbuffer[x][y])        // closest sample so far
            framebuffer[x][y] = rgb;  // update color
            zbuffer[x][y] = z;        // update depth
        else
            ;                         // do nothing, this sample is occluded
```

![多个物体依靠深度测试确定遮挡关系](/img/posts/rasterization-antialiasing-z-buffer/z-buffer-example.png)

*图 12：新图元只有在深度更近时才会覆盖原有像素。*

对于不透明物体，Z-Buffer 使绘制结果基本不依赖三角形提交顺序。不过透明物体通常还需要额外排序和混合，不能只依靠普通的深度覆盖规则。

## 七、从几何到像素的完整流程

把前面的内容连接起来，可以得到一条更完整的渲染流程：

```text
局部坐标
→ Model / View / Projection
→ 透视除法
→ NDC 标准立方体
→ 视口变换
→ 三角形光栅化
→ 覆盖率与抗锯齿
→ 深度测试
→ 写入帧缓冲
→ 显示到屏幕
```

这次学习中最重要的理解是：光栅化并不是简单地“把三角形涂上颜色”，而是在连续几何和离散像素之间进行采样。锯齿来自采样不足，MSAA 通过增加覆盖样本进行近似，而 Z-Buffer 则在每个样本上解决前后遮挡关系。

## 本系列的其他文章

{% series %}

> 本文根据 GAMES101 课程内容整理，用于记录个人学习过程。部分示意图来自课程课件。
