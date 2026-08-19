---
title: GAMES101 作业 2：三角形光栅化与 Z-Buffer
date: 2026-07-17 15:55:14
description: 记录 GAMES101 作业 2 中三角形内部判断、包围盒遍历、透视正确深度插值与 Z-Buffer 深度测试的实现过程。
categories:
  - [课外, GAMES101]
tags:
  - 光栅化
cover: /img/covers/homework-two.svg
series: GAMES101
privacy: protected
sitemap: false
private_section: 课外
---

今天完成了 GAMES101 作业 2。这次作业的任务，是把已经完成坐标变换的三角形真正光栅化到屏幕上，并使用 Z-Buffer 处理两个三角形之间的遮挡关系。

具体实现可以拆成四步：确定三角形包围盒、判断像素中心是否在三角形内、插值当前样本的深度，以及执行深度测试并写入颜色。

<!-- more -->

前置知识：{% post_link rasterization-antialiasing-z-buffer %}


## 一、判断像素中心是否在三角形内

光栅化需要判断屏幕上的哪些像素被三角形覆盖。这份实现对每个像素取中心点 $(x+0.5,\ y+0.5)$，然后使用二维叉积判断该点是否位于三角形内部。

```cpp
static bool insideTriangle(int x, int y, const Vector3f* _v)
{
    // 三角形的三条有向边。
    Vector3f e1 = _v[1] - _v[0];
    Vector3f e2 = _v[2] - _v[1];
    Vector3f e3 = _v[0] - _v[2];

    // 当前像素的中心位置。
    Vector3f p(x + 0.5f, y + 0.5f, 0.0f);

    // 计算每条有向边与待测点之间的二维叉积。
    float c1 = e1.x() * (p.y() - _v[0].y())
             - e1.y() * (p.x() - _v[0].x());

    float c2 = e2.x() * (p.y() - _v[1].y())
             - e2.y() * (p.x() - _v[1].x());

    float c3 = e3.x() * (p.y() - _v[2].y())
             - e3.y() * (p.x() - _v[2].x());

    return (c1 >= 0 && c2 >= 0 && c3 >= 0)
        || (c1 <= 0 && c2 <= 0 && c3 <= 0);
}
```

*代码 1：使用三条边的叉积符号判断像素中心是否在三角形内。*

参数 `x`、`y` 表示像素索引，`_v` 指向三角形三个顶点坐标组成的数组。

对于三角形的一条有向边 $A \to B$ 和待测点 $P$，二维叉积可以写成：

$$
(B_x - A_x)(P_y - A_y) - (B_y - A_y)(P_x - A_x)
$$

叉积的正负表示点位于有向边的哪一侧。如果三个结果同号，说明待测点位于三条边的同一侧，也就是位于三角形内部。

代码同时接受全部为正和全部为负，是因为三角形顶点既可能按顺时针排列，也可能按逆时针排列。

这里使用 `>=` 和 `<=`，因此落在三角形边界上的点也被视为内部。对于这次作业已经足够；更完整的光栅器通常会采用统一的 Top-Left Rule，避免相邻三角形在公共边上重复覆盖或出现缝隙。

## 二、确定三角形包围盒

如果对整张屏幕的所有像素调用 `insideTriangle`，会产生大量没有必要的计算。更合理的方法，是先用三角形三个顶点的最小和最大 `x`、`y` 坐标构造轴对齐包围盒，只遍历包围盒覆盖的像素。

```cpp
void rst::rasterizer::rasterize_triangle(const Triangle& t)
{
    auto v = t.toVector4();

    int min_x = std::max(
        0,
        static_cast<int>(std::floor(
            std::min({v[0].x(), v[1].x(), v[2].x()})))
    );

    int max_x = std::min(
        width - 1,
        static_cast<int>(std::ceil(
            std::max({v[0].x(), v[1].x(), v[2].x()})))
    );

    int min_y = std::max(
        0,
        static_cast<int>(std::floor(
            std::min({v[0].y(), v[1].y(), v[2].y()})))
    );

    int max_y = std::min(
        height - 1,
        static_cast<int>(std::ceil(
            std::max({v[0].y(), v[1].y(), v[2].y()})))
    );

    // 遍历包围盒中的像素。
    for (int x = min_x; x <= max_x; ++x)
    {
        for (int y = min_y; y <= max_y; ++y)
        {
            if (!insideTriangle(x, y, t.v))
                continue;

            auto [alpha, beta, gamma] =
                computeBarycentric2D(x + 0.5f, y + 0.5f, t.v);

            float w_reciprocal = 1.0f /
                (alpha / v[0].w()
               + beta  / v[1].w()
               + gamma / v[2].w());

            float z_interpolated =
                alpha * v[0].z() / v[0].w()
              + beta  * v[1].z() / v[1].w()
              + gamma * v[2].z() / v[2].w();

            z_interpolated *= w_reciprocal;

            int index = get_index(x, y);
            if (z_interpolated < depth_buf[index])
            {
                depth_buf[index] = z_interpolated;
                set_pixel(Eigen::Vector3f(x, y, 1), t.getColor());
            }
        }
    }
}
```

*代码 2：在包围盒中进行覆盖测试、深度插值和 Z-Buffer 测试。*

包围盒的四个边界分别来自三个顶点坐标的最小值和最大值。因为顶点坐标是浮点数，所以最小值向下取整、最大值向上取整，得到一个不会漏掉三角形的保守范围。

这种写法可能会多测试包围盒边缘的少量像素，但 `insideTriangle` 会把它们过滤掉。与此同时，还要使用 `std::max` 和 `std::min` 把范围限制在：

$$
\begin{aligned}
x &\in [\,0,\ \text{width}-1\,] \\
y &\in [\,0,\ \text{height}-1\,]
\end{aligned}
$$

否则三角形超出屏幕时，可能访问不存在的帧缓冲或深度缓冲位置。

## 三、重心坐标与透视正确插值

像素中心位于三角形内部后，还需要求出它在三角形中的深度。函数 `computeBarycentric2D` 返回重心坐标 `alpha`、`beta` 和 `gamma`，三者满足：

$$
\alpha + \beta + \gamma = 1
$$

如果三角形没有经过透视投影，可以直接用三个权重对顶点属性进行线性插值。但透视投影后，屏幕空间中的线性插值不再等价于三维空间中的线性插值，因此代码中需要结合各顶点的齐次分量 $w$ 进行修正。

`w_reciprocal` 先计算修正后的权重归一化因子，然后使用 `z / w` 插值深度，最后再乘回这个因子。这就是透视正确插值（Perspective-Correct Interpolation）的基本形式。

这次作业只使用三角形的统一颜色。以后插值纹理坐标、法线或顶点颜色时，也需要考虑同样的透视修正问题。

## 四、Z-Buffer 深度测试

当前实现规定：**深度值越小，表示距离摄像机越近**。深度缓冲在开始渲染前应初始化为一个足够大的值。

对于三角形覆盖的每个像素：

1. 计算当前样本的插值深度 `z_interpolated`；
2. 与 `depth_buf[index]` 中已经保存的深度比较；
3. 如果当前深度更小，就更新深度和颜色；
4. 如果当前深度更大，说明它被前面的物体遮挡，不进行写入。

这里先执行深度测试，再调用 `set_pixel`，因此最后保存的是离摄像机最近的三角形颜色。

对于不透明三角形，这种方法让最终遮挡结果基本不依赖三角形的绘制顺序。透明物体则还需要额外的排序与颜色混合，不能只依靠普通的 Z-Buffer 覆盖。

## 五、运行结果

最终运行结果如下。蓝色和绿色三角形在屏幕空间发生重叠，重叠部分显示深度更近的三角形颜色，说明光栅化和深度测试都已经生效。

![GAMES101 作业 2 光栅化运行结果](/img/posts/games101-assignment2/assignment2-rasterization-result.png)

*图 1：两个三角形经过光栅化和 Z-Buffer 深度测试后的结果。*

## 六、这次作业的收获

完成作业后，我对以下几点理解得更清楚了：

1. 光栅化的核心是判断离散采样点是否被连续几何图元覆盖；
2. 叉积符号可以用于实现三角形内部测试；
3. 包围盒负责减少候选像素数量，`insideTriangle` 负责精确过滤；
4. 重心坐标可以用来插值深度和其他顶点属性；
5. 透视投影后的属性插值需要结合齐次分量 $w$ 进行修正；
6. Z-Buffer 在每个像素或样本上保存当前最近深度，从而解决不透明物体的遮挡关系。

下一步可以在这个光栅器上继续实现 MSAA，并比较单采样和多重采样在三角形边缘处的区别。

## 本系列的其他文章

{% series %}

> 本文根据 GAMES101 课程内容整理，用于记录个人学习过程。部分示意图来自课程课件。
