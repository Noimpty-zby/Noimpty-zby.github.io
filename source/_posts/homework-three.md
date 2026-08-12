---
title: GAMES101 作业三：Blinn–Phong 着色与纹理映射
date: 2026-07-20 21:25:04
description: 记录 GAMES101 作业三中 Blinn–Phong 光照、纹理采样和透视校正插值的实现思路，并对比纯材质与纹理着色的结果。
categories:
  - [Study, GAMES101]
tags:
  - 纹理
cover: /img/covers/homework-three.svg
series: GAMES101
---

这篇文章记录 GAMES101 第三次作业中我完成的两个主要部分：**Blinn–Phong 片元着色**和**纹理映射**。

上一篇笔记已经整理过光照模型和纹理采样的基础概念，这次则把公式真正放进光栅化管线中，观察一个片元如何从“插值后的属性”变成最终颜色。

<!-- more -->

> 前置知识：{% post_link shading-1 %}

## 一、这次作业完成了什么

光栅化阶段已经为每个片元准备了下面几类数据：

- 观察空间中的位置；
- 插值后的法线；
- 顶点颜色；
- 纹理坐标 $(u, v)$；
- 可选的纹理对象。

片元着色器要做的，就是根据这些数据以及场景中的光源、相机和材质参数，计算最终颜色。

这次主要实现并比较了两种结果：

1. 使用固定材质颜色的 Blinn–Phong 着色；
2. 从纹理中取得漫反射系数后，再执行相同的光照计算。

## 二、Blinn–Phong 片元着色

在计算光照前，需要先确定三个单位向量：

- $l$：从着色点指向光源；
- $v$：从着色点指向相机；
- $h$：光照方向和观察方向的半程向量。

可以用下面的伪代码概括：

$$
\begin{aligned}
l &= \text{normalize}(\text{light\_position} - \text{point}) \\
v &= \text{normalize}(\text{eye\_position} - \text{point}) \\
h &= \text{normalize}(l + v) \\
r^2 &= \lVert \text{light\_position} - \text{point} \rVert^2
\end{aligned}
$$

其中 $r^2$ 用于点光源的距离衰减。准备好这些量后，就可以分别计算环境光、漫反射和镜面反射。

### 2.1 环境光

$$
L_a = k_a \odot I_a
$$

$k_a$ 是环境光反射系数，$I_a$ 是人为设定的环境光强度，符号 $\odot$ 表示逐分量相乘。

环境光与某一盏具体光源无关，因此更合理的写法是**在光源循环外只添加一次**。如果把它放在循环内部，有几盏灯就会重复累加几次环境光。

### 2.2 漫反射

$$
L_d = k_d \odot \frac{I}{r^2} \cdot \max(0,\ n \cdot l)
$$

$n \cdot l$ 描述表面朝向光源的程度。表面越正对光源，接收到的能量越多；背向光源时通过 $\max(0,\ \cdot)$ 把结果截断为 0。

### 2.3 镜面反射

$$
L_s = k_s \odot \frac{I}{r^2} \cdot \max(0,\ n \cdot h)^p
$$

$k_s$ 控制高光颜色，指数 $p$ 控制高光范围。这里使用半程向量 $h$，就是 Blinn–Phong 与经典 Phong 镜面项的主要区别。

### 2.4 多光源累加

把三部分整理起来，整体逻辑可以写成：

```text
result = ka ⊙ Ia

for each light:
    calculate l, v, h and r²
    result += diffuse(light) + specular(light)
```

这样既能累加多盏灯的直接光照，也不会重复添加环境光。

### 2.5 核心 C++ 实现

为了避免 `phong_fragment_shader` 和 `texture_fragment_shader` 重复两遍相同的光照代码，我把 Blinn–Phong 计算整理成一个辅助函数。两个着色器只需要准备不同的 $k_d$，再调用它即可。

```cpp
Eigen::Vector3f evaluate_blinn_phong(
    const fragment_shader_payload& payload,
    const Eigen::Vector3f& kd)
{
    const Eigen::Vector3f ka(0.005f, 0.005f, 0.005f);
    const Eigen::Vector3f ks(0.7937f, 0.7937f, 0.7937f);
    const Eigen::Vector3f ambient_intensity(10.0f, 10.0f, 10.0f);
    const Eigen::Vector3f eye_position(0.0f, 0.0f, 10.0f);
    const float shininess = 150.0f;

    const std::vector<light> lights = {
        {{20.0f, 20.0f, 20.0f}, {500.0f, 500.0f, 500.0f}},
        {{-20.0f, 20.0f, 0.0f}, {500.0f, 500.0f, 500.0f}}
    };

    const Eigen::Vector3f point = payload.view_pos;
    const Eigen::Vector3f normal = payload.normal.normalized();
    const Eigen::Vector3f view_dir =
        (eye_position - point).normalized();

    // 环境光与具体光源无关，只添加一次。
    Eigen::Vector3f result =
        ka.cwiseProduct(ambient_intensity);

    for (const auto& current_light : lights)
    {
        const Eigen::Vector3f to_light =
            current_light.position - point;
        const float distance_squared = to_light.squaredNorm();
        const Eigen::Vector3f light_dir = to_light.normalized();
        const Eigen::Vector3f half_dir =
            (light_dir + view_dir).normalized();

        const float n_dot_l =
            std::max(0.0f, normal.dot(light_dir));
        const float n_dot_h =
            std::max(0.0f, normal.dot(half_dir));

        const Eigen::Vector3f irradiance =
            current_light.intensity / distance_squared;

        const Eigen::Vector3f diffuse =
            kd.cwiseProduct(irradiance) * n_dot_l;

        const Eigen::Vector3f specular =
            ks.cwiseProduct(irradiance)
            * std::pow(n_dot_h, shininess);

        result += diffuse + specular;
    }

    return result * 255.0f;
}
```

这里把观察方向提到循环外，是因为相机位置和着色点在遍历光源时不会改变；光照方向、距离和半程向量则必须针对每一盏灯重新计算。

## 三、固定材质颜色的结果

不使用纹理时，漫反射系数 $k_d$ 直接来自片元携带的材质颜色。模型的不同区域只有几何形状和法线不同，因此整体颜色比较统一，明暗与高光主要由光照方向决定。

```cpp
Eigen::Vector3f phong_fragment_shader(
    const fragment_shader_payload& payload)
{
    const Eigen::Vector3f kd = payload.color;
    return evaluate_blinn_phong(payload, kd);
}
```

![未使用纹理的 Blinn–Phong 着色结果](/img/posts/games101-assignment3/phong-shading.png)

从结果中可以观察到：

- 牛头和身体上的亮度变化体现了漫反射；
- 额头、鼻部和身体上的小块亮斑来自镜面反射；
- 没有直接受光的位置仍保留少量亮度，这是环境光项的作用。

## 四、纹理着色

纹理着色和前面的光照计算几乎相同，真正变化的是漫反射系数 $k_d$ 的来源。

### 4.1 通过 UV 查询纹理颜色

片元数据中保存了透视校正插值后的纹理坐标。纹理着色器先根据 $(u, v)$ 查询颜色，再把通常位于 $[0, 255]$ 的 RGB 值转换到 $[0, 1]$：

```text
texture_color = sample_texture(u, v)
kd = texture_color / 255
```

之后仍然使用相同的环境光、漫反射和镜面反射公式。也就是说，**纹理负责描述表面不同位置的基础颜色，光照负责描述这些颜色在当前场景中有多亮。**

对应的纹理片元着色器可以写成：

```cpp
Eigen::Vector3f texture_fragment_shader(
    const fragment_shader_payload& payload)
{
    Eigen::Vector3f kd = payload.color;

    if (payload.texture)
    {
        const float u = payload.tex_coords.x();
        const float v = payload.tex_coords.y();

        // getColor 返回 [0, 255]，光照计算使用 [0, 1]。
        kd = payload.texture->getColor(u, v) / 255.0f;
    }

    return evaluate_blinn_phong(payload, kd);
}
```

### 4.2 纹理结果

![使用纹理后的 Blinn–Phong 着色结果](/img/posts/games101-assignment3/texture-shading.png)

加入纹理后，模型出现了眼睛、鼻子、斑纹和四肢颜色等局部细节，同时依然保留了原有的明暗与高光。

与第一张结果相比，可以更直观地理解纹理和光照的分工：

- 没有纹理时，$k_d$ 近似为统一材质颜色；
- 使用纹理时，每个片元从纹理中获得不同的 $k_d$；
- 两种情况使用的是同一套 Blinn–Phong 光照逻辑。

## 五、透视校正插值

作业中另一个容易漏掉的细节，是经过透视投影后不能直接使用屏幕空间的重心坐标插值所有属性。

先计算三个未经归一化的权重：

```cpp
const float alpha_over_w = alpha / v[0].w();
const float beta_over_w  = beta  / v[1].w();
const float gamma_over_w = gamma / v[2].w();

const float weight_sum =
    alpha_over_w + beta_over_w + gamma_over_w;

const float corrected_alpha = alpha_over_w / weight_sum;
const float corrected_beta  = beta_over_w  / weight_sum;
const float corrected_gamma = gamma_over_w / weight_sum;
```

最后再用校正后的 $a$、$b$、$c$ 插值纹理坐标、观察空间位置等属性。

如果只做除以 $w$ 而不进行归一化，三个权重之和不再等于 1，插值结果仍然会出错。透视校正尤其会影响倾斜或远近变化明显的三角形，缺少它时纹理可能出现“贴不稳”或不自然拉伸的问题。

## 六、这次实现中值得注意的问题

### 6.1 插值法线需要归一化

三个顶点的单位法线经过线性插值后，长度一般不再等于 1。进入点积计算前应再次归一化，否则漫反射和镜面反射强度会产生误差。

### 6.2 颜色范围要保持一致

纹理读取结果可能位于 $[0, 255]$，而材质和光照公式通常按 $[0, 1]$ 计算。中途要明确当前使用的范围，最后输出时再统一转换，避免画面过暗、过亮或颜色溢出。

### 6.3 环境光不要随光源数量增加

环境光是对场景间接光照的统一近似，不属于任何一盏点光源。把它放进多光源循环会使结果随着灯光数量无意中变亮。

### 6.4 纹理采样还可以继续改进

这次只完成了基础纹理查询。最近邻采样在纹理放大时可能出现方块感，之后可以继续实现双线性插值，并比较两种采样方式的边缘效果。

## 七、总结

第三次作业把前面学过的概念真正连接了起来：光栅化器先插值位置、法线和 UV，片元着色器再使用 Blinn–Phong 模型与纹理计算颜色。

这次最大的收获不是记住几条公式，而是理解了数据在渲染管线中的流动：

```text
顶点属性
  → 透视校正插值
  → 片元属性
  → 纹理查询与局部光照
  → 最终颜色
```

虽然目前实现的仍然是一个比较基础的局部光照模型，但它已经包含了实时渲染中非常核心的一条路径。下一步可以继续完成双线性纹理采样、法线贴图，以及作业中的凹凸映射和位移映射部分。

## 本系列的其他文章

{% series %}

> 本文根据 GAMES101 课程内容整理，用于记录个人学习过程。部分示意图来自课程课件。
