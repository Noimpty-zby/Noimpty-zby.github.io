---
title: GAMES101 作业 1：旋转与投影矩阵实践
date: 2026-07-15 20:14:17
description: 记录 GAMES101 作业 1 中绕 z 轴旋转、透视投影与正交投影矩阵的实现过程。
categories:
  - [课外, 游戏开发, GAMES101]
tags:
  - MVP 变换
cover: /img/covers/homework-one.svg
series: GAMES101
privacy: protected
sitemap: false
private_section: 课外
---

今天完成了 GAMES101 作业 1。这次作业主要考察绕 $z$ 轴的模型旋转，以及透视投影和正交投影矩阵的构造。

相比单纯记忆公式，把矩阵真正写进代码之后，我对变换顺序和坐标符号有了更直观的理解。

<!-- more -->


## 一、绕 z 轴旋转

模型矩阵部分需要根据输入角度，让三角形绕 $z$ 轴旋转。

```cpp
Eigen::Matrix4f get_model_matrix(float rotation_angle)
{
    Eigen::Matrix4f model = Eigen::Matrix4f::Identity();

    // C++ 三角函数使用弧度，因此先把角度转换为弧度。
    float c = cos(rotation_angle / 180.0 * MY_PI);
    float s = sin(rotation_angle / 180.0 * MY_PI);

    model(0, 0) = c;
    model(0, 1) = -s;
    model(1, 0) = s;
    model(1, 1) = c;

    return model;
}
```

*代码 1：绕 z 轴旋转的模型矩阵。*

这里先创建一个 $4 \times 4$ 单位矩阵，再替换左上角与二维旋转有关的四个元素。因为绕 $z$ 轴旋转不会改变点的 $z$ 坐标，所以其核心部分与二维旋转矩阵相同。

这一段最容易忽略的问题是：$\sin$ 和 $\cos$ 接收的是弧度，而作业传入的是角度。因此需要进行转换：

$$
\text{radian} = \frac{\text{degree}}{180} \times \pi
$$

旋转矩阵的推导可以参考上一篇笔记：{% post_link Transformation-MVP-note %}

## 二、构造投影矩阵

投影矩阵部分可以拆成两个阶段：

```text
透视视锥体
→ 正交观察盒
→ 标准立方体 [-1, 1]^3
```

第一个矩阵负责把透视视锥体压缩成正交观察盒，第二个矩阵负责把观察盒归一化到标准立方体。

```cpp
Eigen::Matrix4f get_projection_matrix(float eye_fov, float aspect_ratio,
                                      float zNear, float zFar)
{
    Eigen::Matrix4f projection = Eigen::Matrix4f::Identity();

    // 第一步：将透视视锥体压缩为正交观察盒。
    Eigen::Matrix4f perspective_to_ortho = Eigen::Matrix4f::Identity();
    perspective_to_ortho(0, 0) = zNear;
    perspective_to_ortho(1, 1) = zNear;
    perspective_to_ortho(2, 2) = zNear + zFar;
    perspective_to_ortho(2, 3) = -zNear * zFar;
    perspective_to_ortho(3, 2) = 1;
    perspective_to_ortho(3, 3) = 0;

    // 根据垂直视场角和宽高比，计算近裁剪面的范围。
    float t = tan(eye_fov / 2.0 / 180.0 * MY_PI) * zNear;
    float r = t * aspect_ratio;

    // 第二步：将正交观察盒归一化到 [-1, 1]^3。
    Eigen::Matrix4f ortho = Eigen::Matrix4f::Identity();
    ortho(0, 0) = 1.0 / r;
    ortho(1, 1) = 1.0 / t;
    ortho(2, 2) = 2.0 / (zNear - zFar);
    ortho(2, 3) = (zNear + zFar) / (zFar - zNear);

    projection = ortho * perspective_to_ortho;
    return projection;
}
```

*代码 2：将透视变换和正交归一化组合成投影矩阵。*

### 参数分别表示什么

- `eye_fov`：摄像机垂直方向的视场角，也就是 $y$ 方向的可见范围；
- `aspect_ratio`：画面的宽高比；
- `zNear`：近裁剪面的距离或坐标；
- `zFar`：远裁剪面的距离或坐标。

因为观察区域关于 $x$ 轴和 $y$ 轴对称，所以可以先由垂直视场角计算 $t$，再利用宽高比计算 $r$：

$$
\begin{aligned}
t &= \tan\!\left(\frac{\text{eye\_fov}}{2}\right) \times \text{zNear} \\
r &= t \times \text{aspect\_ratio}
\end{aligned}
$$

采用列向量时，最右边的矩阵最先作用，因此组合顺序写成：

$$
M_{\text{projection}} = M_{\text{ortho}} \times M_{\text{persp}\to\text{ortho}}
$$

### 关于 zNear 和 zFar 的符号

这里是我认为最容易出错的地方。

GAMES101 的摄像机默认看向 $-z$ 方向，而不同代码框架可能把 `zNear`、`zFar` 表示为正的距离，也可能直接使用相机坐标系中的负 $z$ 坐标。两种方式都能推导矩阵，但不能混用。

本实现中的 `2 / (zNear - zFar)` 以及后面的平移项，必须和当前作业框架对近远平面的定义保持一致。如果出现画面翻转、深度关系异常或者物体被错误裁剪，应优先检查这里的符号，而不是只看三角形是否出现在画面中。

## 三、运行结果

完成模型矩阵和投影矩阵后，三角形可以在画面中持续旋转。

![GAMES101 作业 1 运行效果](/img/posts/games101-assignment1/assignment1-result.webp)

*图 1：作业 1 的运行效果。动图经过裁剪和加速处理。*

## 四、这次作业的收获

完成这次作业后，我对以下几点理解得更清楚了：

1. 绕 $z$ 轴旋转可以看作二维旋转在三维空间中的扩展；
2. 角度传入三角函数前需要转换成弧度；
3. 透视投影可以拆成“透视到正交”和“正交归一化”两个阶段；
4. 采用列向量时，矩阵从右向左作用；
5. 投影矩阵的符号不能脱离坐标系、摄像机方向和近远平面定义来记忆。

目前这份实现完成了作业的基础要求。之后还可以继续尝试绕任意轴旋转，并用罗德里格斯公式构造对应的模型矩阵。

## 本系列的其他文章

{% series %}

> 本文根据 GAMES101 课程内容整理，用于记录个人学习过程。部分示意图来自课程课件。
