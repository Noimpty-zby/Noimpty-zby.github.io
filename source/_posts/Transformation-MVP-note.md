---
title: 从齐次坐标到 MVP 变换：GAMES101 学习笔记
date: 2026-07-15 13:53:20
description: 整理二维与三维变换、齐次坐标，以及 Model、View、Projection 变换的基本原理。
categories:
  - [课外, GAMES101]
tags:
  - MVP 变换
cover: /img/covers/Transformation-MVP-note.svg
series: GAMES101
privacy: protected
sitemap: false
private_section: 课外
---

这篇文章整理二维、三维空间中的基础变换，以及经典的 MVP（Model-View-Projection）变换。

本文采用**列向量**和**右手坐标系**。旋转的正方向遵循右手定则；标准摄像机位于原点，看向 $-z$ 方向，向上方向为 $+y$。

<!-- more -->

## 一、为什么需要齐次坐标

常见的几何变换包括缩放、旋转和平移。缩放和旋转都可以直接写成矩阵乘法，但普通的二维矩阵无法直接表示平移。

齐次坐标增加了一个额外维度，使缩放、旋转和平移都能统一写成矩阵乘法，多个变换也就可以通过矩阵相乘组合起来。

在二维齐次坐标中，一个点可以表示为：

$$
p = (x,\ y,\ 1)^\top
$$

一个向量可以表示为：

$$
v = (x,\ y,\ 0)^\top
$$

点和向量最后一维的区别非常重要：平移会改变点的位置，却不会改变只表示方向的向量。

例如，将点 $(1, 1)$ 平移 $(2, 3)$，结果为 $(3, 4)$；如果对最后一维为 0 的向量做同样的运算，平移量不会产生影响。

## 二、二维变换

二维变换主要包括缩放、旋转和平移。引入齐次坐标后，它们都可以使用 $3 \times 3$ 矩阵表示。

$$
\begin{aligned}
S(s_x, s_y) &= \begin{bmatrix} s_x & 0 & 0 \\ 0 & s_y & 0 \\ 0 & 0 & 1 \end{bmatrix}
\\[6pt]
R(\alpha) &= \begin{bmatrix} \cos\alpha & -\sin\alpha & 0 \\ \sin\alpha & \cos\alpha & 0 \\ 0 & 0 & 1 \end{bmatrix}
\\[6pt]
T(t_x, t_y) &= \begin{bmatrix} 1 & 0 & t_x \\ 0 & 1 & t_y \\ 0 & 0 & 1 \end{bmatrix}
\end{aligned}
$$

对于复杂的变换，可以将其拆分为多个简单变换，再把对应矩阵组合起来。

需要特别注意，矩阵乘法通常不满足交换律。采用列向量时，最右侧的矩阵最先作用。例如：

$$
p' = T \cdot R \cdot S \cdot p
$$

它表示先缩放，再旋转，最后平移。改变矩阵顺序，通常会得到不同结果。

## 三、三维变换

三维齐次坐标比二维多一个空间维度。三维点写作 $(x,\ y,\ z,\ 1)^\top$，三维向量写作 $(x,\ y,\ z,\ 0)^\top$，因此变换矩阵使用 $4 \times 4$ 的形式。

### 1. 缩放和平移

三维缩放可以分别控制物体在 $x$、$y$、$z$ 三个方向上的大小，平移则控制物体在三个方向上的位置。

$$
\begin{aligned}
S(s_x, s_y, s_z) &= \begin{bmatrix} s_x & 0 & 0 & 0 \\ 0 & s_y & 0 & 0 \\ 0 & 0 & s_z & 0 \\ 0 & 0 & 0 & 1 \end{bmatrix}
\\[6pt]
T(t_x, t_y, t_z) &= \begin{bmatrix} 1 & 0 & 0 & t_x \\ 0 & 1 & 0 & t_y \\ 0 & 0 & 1 & t_z \\ 0 & 0 & 0 & 1 \end{bmatrix}
\end{aligned}
$$

### 2. 绕坐标轴旋转

三维旋转比二维旋转更复杂，因为物体可以分别绕 $x$、$y$、$z$ 轴旋转。

$$
\begin{aligned}
R_x(\alpha) &=
\begin{bmatrix} 1 & 0 & 0 & 0 \\ 0 & \cos\alpha & -\sin\alpha & 0 \\ 0 & \sin\alpha & \cos\alpha & 0 \\ 0 & 0 & 0 & 1 \end{bmatrix}
\\[6pt]
R_y(\alpha) &=
\begin{bmatrix} \cos\alpha & 0 & \sin\alpha & 0 \\ 0 & 1 & 0 & 0 \\ -\sin\alpha & 0 & \cos\alpha & 0 \\ 0 & 0 & 0 & 1 \end{bmatrix}
\\[6pt]
R_z(\alpha) &=
\begin{bmatrix} \cos\alpha & -\sin\alpha & 0 & 0 \\ \sin\alpha & \cos\alpha & 0 & 0 \\ 0 & 0 & 1 & 0 \\ 0 & 0 & 0 & 1 \end{bmatrix}
\end{aligned}
$$

上面三个矩阵中的正负号依赖本文开头给出的坐标约定。

其中，绕 $y$ 轴旋转的矩阵看起来与另外两个矩阵的符号规律不同。可以通过观察坐标轴方向，或者把三维旋转退化到对应的二维平面中进行判断，不能只依靠记忆。

### 3. 罗德里格斯旋转公式

如果旋转轴不是 $x$、$y$、$z$ 轴，而是任意一条经过原点的轴，可以使用罗德里格斯旋转公式。

$$
\begin{aligned}
R(n, \alpha) &= \cos(\alpha)\,I \\
&\quad + \big(1 - \cos(\alpha)\big)\,n n^\top \\
&\quad + \sin(\alpha)\,N
\\[6pt]
N &= \begin{bmatrix} 0 & -n_z & n_y \\ n_z & 0 & -n_x \\ -n_y & n_x & 0 \end{bmatrix}
\end{aligned}
$$

公式中的 $n = (n_x,\ n_y,\ n_z)^\top$ 是单位长度的旋转轴，$I$ 是三阶单位矩阵。$N$ 是由 $n$ 构造的反对称矩阵，它满足：

$$
N \cdot x = n \times x
$$

使用公式前必须先把旋转轴归一化，否则计算结果不会是纯旋转。

## 四、M：Model 模型变换

模型变换负责把物体从自己的局部坐标系移动到世界坐标系。

一个模型通常先调整大小，再改变朝向，最后移动到世界中的指定位置。采用列向量时，可以写成：

$$
M_{\text{model}} = T \cdot R \cdot S
$$

因为最右侧矩阵最先作用，所以实际顺序是：

1. 使用 $S$ 缩放模型；
2. 使用 $R$ 旋转模型；
3. 使用 $T$ 将模型平移到世界中的目标位置。

如果改变这个顺序，旋转中心和最终位置也可能随之改变。

## 五、V：View 观察变换

View 变换负责把世界坐标转换到摄像机坐标。它并不是简单地“移动摄像机”，也可以理解为保持摄像机不动，对整个世界施加相反的变换。

### 1. 如何描述摄像机

描述一台摄像机通常需要三个要素：

1. **Position**：摄像机所在的位置 $e$；
2. **Gaze direction**：摄像机看向的方向 $g$；
3. **Up direction**：摄像机的上方向 $t$。

![摄像机的位置、观察方向和上方向](/img/posts/transformation-mvp/camera-definition.png)

*图 1：描述摄像机所需的三个要素。*

为了简化后续计算，我们希望把任意摄像机转换成标准状态：摄像机位于原点，看向 $-z$ 方向，向上方向为 $+y$。

### 2. 构造 View 矩阵

View 变换可以分成两步：

1. 将整个世界平移 $-e$，使摄像机位置落到原点；
2. 旋转整个世界，使摄像机的右、上、后方向分别与 $x$、$y$、$z$ 轴重合。

采用列向量时，整体顺序为：

$$
M_{\text{view}} = R_{\text{view}} \cdot T_{\text{view}}
$$

$$
T_{\text{view}} =
\begin{bmatrix} 1 & 0 & 0 & -x_e \\ 0 & 1 & 0 & -y_e \\ 0 & 0 & 1 & -z_e \\ 0 & 0 & 0 & 1 \end{bmatrix}
$$

先写出它的逆变换（把标准基旋转到摄像机的三个方向），再取转置即可得到 $R_{\text{view}}$：

$$
\begin{aligned}
R_{\text{view}}^{-1} &=
\begin{bmatrix}
x_{\hat{g} \times t} & x_t & x_{-g} & 0 \\
y_{\hat{g} \times t} & y_t & y_{-g} & 0 \\
z_{\hat{g} \times t} & z_t & z_{-g} & 0 \\
0 & 0 & 0 & 1
\end{bmatrix}
\\[6pt]
R_{\text{view}} &=
\begin{bmatrix}
x_{\hat{g} \times t} & y_{\hat{g} \times t} & z_{\hat{g} \times t} & 0 \\
x_t & y_t & z_t & 0 \\
x_{-g} & y_{-g} & z_{-g} & 0 \\
0 & 0 & 0 & 1
\end{bmatrix}
\end{aligned}
$$

旋转矩阵是正交矩阵，因此它的逆矩阵等于转置矩阵：

$$
R^{-1} = R^\top
$$

这解释了为什么构造 View 矩阵时，摄像机的基向量最终会出现在矩阵的行中。

实际计算时，还应保证摄像机的方向向量已经归一化，并让右方向、上方向和观察方向组成一组相互垂直的单位向量。

## 六、P：Projection 投影变换

Projection 变换负责把摄像机空间中的三维场景投影到二维画面。常见投影方式分为正交投影和透视投影。

### 1. 正交投影

正交投影不会产生近大远小的效果。互相平行的直线投影后仍然保持平行，因此比较适合工程制图等场景。

正交投影可以分为两步：

1. 将观察盒的中心平移到坐标原点；
2. 将观察盒缩放到标准立方体 $[-1, 1]^3$ 中。

$$
\begin{aligned}
M_{\text{translate}} &=
\begin{bmatrix}
1 & 0 & 0 & -\frac{r+l}{2} \\
0 & 1 & 0 & -\frac{t+b}{2} \\
0 & 0 & 1 & -\frac{n+f}{2} \\
0 & 0 & 0 & 1
\end{bmatrix}
\\[6pt]
M_{\text{scale}} &=
\begin{bmatrix}
\frac{2}{r-l} & 0 & 0 & 0 \\
0 & \frac{2}{t-b} & 0 & 0 \\
0 & 0 & \frac{2}{n-f} & 0 \\
0 & 0 & 0 & 1
\end{bmatrix}
\end{aligned}
$$

两步合起来就是正交投影矩阵（先平移，后缩放）：

$$
M_{\text{ortho}} = M_{\text{scale}} \cdot M_{\text{translate}}
$$

![正交投影：先把观察盒平移到原点，再缩放到标准立方体](/img/posts/transformation-mvp/orthographic-boxes.png)

*图 2：先平移观察盒中心到原点，再缩放到标准立方体。*

这里移动的是观察盒的中心，而不一定是某个物体的中心。矩阵中的 $l$、$r$、$b$、$t$、$n$、$f$ 分别表示观察盒的左、右、下、上、近、远边界。

### 2. 透视投影

透视投影能够产生近大远小的视觉效果，更接近人眼和摄像机观察世界的方式。

一种常见的推导思路是：

```text
透视视锥体 → 正交观察盒 → 标准立方体
```

首先利用相似三角形，把透视视锥体压缩成正交观察盒。

![利用相似三角形推导透视投影](/img/posts/transformation-mvp/perspective-triangle.png)

*图 3：利用相似三角形求投影后坐标。*

在本文采用的坐标约定下，$x$ 和 $y$ 方向可以得到类似下面的关系：

$$
x' = \frac{n}{z}\,x, \qquad y' = \frac{n}{z}\,y
$$

同时还需要构造 $z$ 和齐次分量，最终得到从透视视锥体到正交观察盒的矩阵。

$$
M_{\text{persp} \to \text{ortho}} =
\begin{bmatrix}
n & 0 & 0 & 0 \\
0 & n & 0 & 0 \\
0 & 0 & n+f & -nf \\
0 & 0 & 1 & 0
\end{bmatrix}
$$

完成这一步后，再应用正交投影矩阵，将观察盒映射到标准立方体。

矩阵相乘后得到的仍然是齐次坐标，还需要执行**透视除法**：将 $x$、$y$、$z$ 分量分别除以 $w$。近处物体看起来更大、远处物体看起来更小，正是这一过程带来的结果。

不同教材或图形 API 对摄像机朝向、近远平面的符号以及深度范围可能采用不同约定，因此透视矩阵的具体符号也可能不同。使用公式前，必须先确认所采用的坐标约定。

## 七、完整的 MVP 流程

把前面的三个阶段组合起来，可以得到：

$$
p_{\text{clip}} = M_{\text{projection}} \cdot M_{\text{view}} \cdot M_{\text{model}} \cdot p_{\text{local}}
$$

整个过程可以概括为：

```text
局部坐标
→ Model：世界坐标
→ View：摄像机坐标
→ Projection：裁剪坐标
→ 透视除法：标准设备坐标
→ 视口变换：屏幕坐标
```

MVP 的关键并不只是记住三个矩阵，而是理解每个矩阵负责在哪两个坐标空间之间进行转换。

## 八、这次学习中的几个重点

整理这一部分内容后，我认为最容易出错的地方有以下几个：

1. 点和向量在齐次坐标中的最后一维不同；
2. 矩阵的相乘顺序不能随意交换；
3. 旋转矩阵的符号取决于坐标系和旋转方向的约定；
4. View 变换可以理解为对整个世界施加摄像机变换的逆；
5. 透视投影结束后还需要执行透视除法；
6. 不同教材和图形 API 的坐标约定可能不同，不能脱离约定直接比较矩阵。

这篇文章目前主要记录了整体框架。之后如果继续学习，我希望再补充一个完整的数值计算例子，从局部坐标开始，依次经过 Model、View、Projection，最后得到屏幕坐标。

## 本系列的其他文章

{% series %}

> 本文根据 GAMES101 课程内容整理，用于记录个人学习过程。部分示意图来自课程课件。
