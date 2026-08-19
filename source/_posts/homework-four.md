---
title: GAMES101 作业四：de Casteljau 算法与 Bézier 曲线
date: 2026-07-22 17:25:02
description: 记录 GAMES101 作业四中 de Casteljau 递归算法的实现，解释控制点、参数采样、端点切线和曲线绘制细节。
categories:
  - [课外, GAMES101]
tags:
  - 几何与曲面
cover: /img/covers/homework-four.svg
series: GAMES101
privacy: protected
sitemap: false
private_section: 课外
---

这篇文章记录 GAMES101 第四次作业：根据用户选择的控制点，使用 de Casteljau 算法计算并绘制 Bézier 曲线。

这次代码量不大，但它把“线性插值—递归降阶—参数曲线”三个概念连接了起来。相比直接套用 Bézier 多项式，de Casteljau 的几何意义更直观，也有较好的数值稳定性。

<!-- more -->

> 相关知识：{% post_link Geometry %}

## 一、作业目标

程序接收若干二维控制点。对于每一个 $t \in [0, 1]$，de Casteljau 算法都会返回曲线上的一个点；对足够多的 $t$ 进行采样并连接这些点，就能得到最终曲线。

整个流程可以概括为：

```text
控制点
  → 相邻点线性插值
  → 得到更少的一层点
  → 重复直到只剩一个点
  → 该点就是 B(t)
```

## 二、de Casteljau 算法

### 2.1 一层线性插值

给定同一层中相邻的两个点 $P_i$ 和 $P_{i+1}$，下一层的新点为：

$$
Q_i(t) = (1-t)\,P_i + t\,P_{i+1}
$$

当 $t=0$ 时，新点位于 $P_i$；当 $t=1$ 时，新点位于 $P_{i+1}$；中间取值则落在线段内部。

如果最开始有 4 个控制点，每一层的点数会依次变为：

```text
4 → 3 → 2 → 1
```

最后剩下的唯一点就是三次 Bézier 曲线在参数 $t$ 处的位置。

### 2.2 递归实现

下面保留完整的核心实现。函数先处理非法输入和递归终止条件，再生成下一层控制点：

```cpp
cv::Point2f recursive_bezier(
    const std::vector<cv::Point2f>& points,
    float t)
{
    if (points.empty())
    {
        throw std::invalid_argument(
            "recursive_bezier requires at least one control point");
    }

    if (points.size() == 1)
    {
        return points.front();
    }

    const float s = 1.0f - t;
    std::vector<cv::Point2f> next_level;
    next_level.reserve(points.size() - 1);

    for (std::size_t i = 0; i + 1 < points.size(); ++i)
    {
        next_level.emplace_back(
            s * points[i] + t * points[i + 1]);
    }

    return recursive_bezier(next_level, t);
}
```

这里有三个关键点：

1. `points.size()==1` 是递归出口，否则函数会无限调用下去；
2. 每次只对相邻点插值，因此下一层比当前层少一个点；
3. 参数 $t$ 在所有递归层中保持不变，变化的是参与插值的点。

`reserve()` 不是算法必需的，但可以提前分配容量，避免循环中多次扩容。

## 三、它与三次 Bézier 公式的关系

对于四个控制点 $P_0$、$P_1$、$P_2$、$P_3$，递归展开后会得到熟悉的三次 Bézier 公式：

$$
\begin{aligned}
B(t) = \ & (1-t)^3 P_0 + 3t(1-t)^2 P_1 \\
+\ & 3t^2(1-t) P_2 + t^3 P_3
\end{aligned}
$$

两种写法计算的是同一条曲线：

- Bernstein 多项式形式便于推导和分析；
- de Casteljau 形式便于理解、实现和扩展到任意数量的控制点。

若有 $n+1$ 个控制点，计算一个曲线点需要大约 $n+(n-1)+\cdots+1$ 次插值，因此时间复杂度为 $O(n^2)$，递归深度为 $O(n)$。本次作业只有四个控制点，开销很小。

## 四、采样并绘制曲线

数学上的 Bézier 曲线是连续的，但屏幕只能显示离散像素。程序需要让 $t$ 从 0 变化到 1，计算一系列曲线点。

如果只把每个采样点对应的一个像素染色，取整后可能出现空隙。更稳妥的做法是保存上一个采样点，用抗锯齿线段连接相邻结果：

```cpp
void bezier(
    const std::vector<cv::Point2f>& control_points,
    cv::Mat& image)
{
    constexpr int sample_count = 1000;
    cv::Point2f previous =
        recursive_bezier(control_points, 0.0f);

    for (int i = 1; i <= sample_count; ++i)
    {
        const float t =
            static_cast<float>(i) / sample_count;

        const cv::Point2f current =
            recursive_bezier(control_points, t);

        cv::line(
            image,
            previous,
            current,
            cv::Scalar(0, 255, 0),
            1,
            cv::LINE_AA);

        previous = current;
    }
}
```

这里使用整数循环计算 `t=i/sample_count`，可以确保最后一次严格得到 $t=1$，也避免浮点数反复累加后略过终点。

`cv::Scalar(0,255,0)` 对应绿色，因为 OpenCV 默认颜色顺序是 BGR；`cv::LINE_AA` 则让曲线边缘更平滑。

## 五、结果与控制点分析

![de Casteljau 算法绘制的 Bézier 曲线](/img/posts/games101-assignment4/bezier-result.png)

图中的四个白点是控制点，绿色轨迹是计算得到的三次 Bézier 曲线。

观察这张图可以得到几个重要结论：

### 5.1 曲线经过首尾控制点

当 $t=0$ 时，每次插值都选择左侧点，因此最终结果是 $P_0$；当 $t=1$ 时，每次都选择右侧点，最终结果是 $P_3$。

所以曲线从左上方控制点出发，最终到达右下方控制点。

### 5.2 中间控制点负责“拉动”曲线

左下方和右上方的两个控制点通常不在曲线上，但会改变曲线弯曲的方向和幅度。

在这张结果图中：

- 左下控制点把曲线前半段向下拉；
- 右上控制点把曲线后半段向上拉；
- 两种影响叠加后形成中间较陡、两端较平缓的 S 形走势。

### 5.3 端点切线由相邻控制点决定

对三次 Bézier 曲线，有：

$$
\begin{aligned}
B'(0) &= 3(P_1 - P_0) \\
B'(1) &= 3(P_3 - P_2)
\end{aligned}
$$

因此曲线离开起点时的方向与 $P_0P_1$ 一致，进入终点时的方向与 $P_2P_3$ 一致。移动中间控制点，不仅会改变曲率，也会直接改变端点附近的切线方向。

### 5.4 曲线位于控制点凸包内

每一层新点都是相邻点的凸组合，所以最终曲线不会跑出所有控制点形成的凸包。这也是编辑 Bézier 曲线时能够较直观预测形状的原因。

## 六、可以继续改进的地方

### 6.1 自适应采样

固定采样 1000 次实现简单，但无论曲线平直还是弯曲都使用相同密度。更好的方法可以根据曲率或控制多边形的平坦程度递归细分：平直区域少采样，弯曲区域多采样。

### 6.2 显示构造过程

可以在某个固定 $t$ 下把每一层插值线段和中间点画出来，从而动态展示 de Casteljau 算法如何从四个控制点逐步收缩到一个曲线点。

### 6.3 分段曲线

实际建模通常不会用一个非常高次的 Bézier 曲线，而是拼接多段三次曲线。连接时需要考虑 C⁰、C¹ 或 G¹ 连续性，使不同曲线段在接缝处保持平滑。

## 七、总结

第四次作业虽然代码较短，但完整体现了参数曲线的生成过程：

```text
相邻控制点线性插值
  → 递归降阶
  → 得到 B(t)
  → 对参数区间采样
  → 将离散点绘制成曲线
```

实现之后再回看 Bézier 曲线的端点、切线和凸包性质，会比单独记忆公式更加直观。下一步可以尝试可视化递归过程，或者把同样的思路扩展到分段 Bézier 曲线与 Bézier 曲面。

## 本系列的其他文章

{% series %}

> 本文根据 GAMES101 课程内容整理，用于记录个人学习过程。部分示意图来自课程课件。
