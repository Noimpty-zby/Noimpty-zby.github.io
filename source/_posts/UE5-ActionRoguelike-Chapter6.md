---
title: UE5 C++ 第六章复盘：把前五章欠的债还掉——准星、碰撞通道、控制台变量与弹道修正
date: 2026-08-21 16:00:00
categories:
  - [课外, 游戏开发, UE5-Looman]
tags:
  - C++
  - ActionRoguelike
  - 碰撞通道
  - 控制台变量
  - 相机与瞄准
description: 第六章没有做任何新玩法，五节课全部是在做优化。本篇完整梳理这一章的内容，包括为什么过肩相机必须使用 SocketOffset，而不能直接移动相机组件；碰撞响应「取两边中较弱的一方」这条规则，怎样让子弹穿过胶囊体打在 Mesh 上；TAutoConsoleVariable 每个参数的含义，以及 ECVF_Cheat 的实际效果；为什么 API 要求显式地写出 GetValueOnGameThread；弹道修正的三步几何，以及它自带的两个失效场景；交互评分加入距离项之后，权重的配比为什么会让背后的物体胜出。重点解释每一项优化在解决什么问题，优化之后得到了什么，以及每段代码为什么要这样写。
cover: /img/covers/UE5-ActionRoguelike-Chapter6.svg
series: UE5 ActionRoguelike
privacy: protected
sitemap: false
private_section: 课外
---

# 前言

本文是 Tom Looman《UE5 C++》第六章 **Optimization** 的完整复盘。

本章使用的开发环境如下：

- Unreal Engine `5.6.1`
- Rider
- Visual Studio 2022 Build Tools / MSVC 编译工具链
- 项目名称：`ActionRoguelike`

**这一章没有做任何新玩法。** 前五章每一节的产出都能直接展示给别人看，比如宝箱、拉杆、投射物、炮台和血条。而这一章的五节课做下来，游戏里「新增」的东西只有屏幕中央一个 6×6 的白点。

所以初学这一章时，很容易怀疑这五节课是不是在做无用功。

但是仔细分析之后会发现，这一章真正的主线是下面这句话：

> **前五章为了「先跑起来」，欠下了一堆技术债。这一章要把它们一次还清。**

胶囊体命中、瞄不准的弹道、写死的调试绘制，以及只看朝向的交互判定，这些在前五章里都「能用」，既没有报错，也都通过了编译。它们的共同点在于，**只有真正拿起手柄玩过的人，才能说出哪里不对。**

所以这篇复盘会花大量的篇幅来回答两个问题：

- **每一项优化在解决什么问题？** 也就是如果不优化会怎样，玩家会看到什么。
- **优化之后得到了什么？** 这里不只是说「变好了」，而是要说明具体解锁了哪些后续的能力。

从这一章可以看出，**优化并不是锦上添花，而是把之前图省事留下的问题补回来。** 每一项优化都不是凭空冒出来的需求，而是某个早期决策留下的后果。

五节课的分工如下：

| 节 | 主题 | 核心产出 |
| --- | --- | --- |
| 第一节 | 准星与过肩相机 | UMG 控件三层结构、`SocketOffset`、`TargetOffset` |
| 第二节 | 自定义碰撞通道 | `Object Channel`、碰撞预设、双向握手规则 |
| 第三节 | 控制台变量 | `TAutoConsoleVariable`、`ECVF_Cheat`、`GetValueOnGameThread` |
| 第四节 | 弹道修正 | `LineTraceSingleByChannel`、`FRotator` 重算、float 型 CVar |
| 第五节 | 交互评分加距离 | 双基准点、加权评分、`EditDefaultsOnly` 调参 |

和前几章一样，这篇文章不只记录点了哪些按钮，还会重点解释下面几个问题：

- 每一项设置背后的引擎机制，以及不这样设置会怎样；
- 为什么这段逻辑放在这一层，而不是放在上一层或者下一层；
- 每个坑的真正成因，以及下次应该怎样排查。

---

## 目录

- [第零节：这一章到底在优化什么](#第零节：这一章到底在优化什么)
- [第一节：准星与过肩相机](#第一节：准星与过肩相机)
- [第二节：自定义碰撞通道，让攻击打在 Mesh 上](#第二节：自定义碰撞通道，让攻击打在-Mesh-上)
- [第三节：控制台变量，把调试绘制变成开关](#第三节：控制台变量，把调试绘制变成开关)
- [第四节：弹道修正，让子弹去准星指的地方](#第四节：弹道修正，让子弹去准星指的地方)
- [第五节：交互评分加入距离](#第五节：交互评分加入距离)
- [知识链路总览](#知识链路总览)
- [易错点速查表](#易错点速查表)
- [遗留待办](#遗留待办)
- [第六章完成检查清单](#第六章完成检查清单)
- [术语表](#术语表)
- [参考资料](#参考资料)

---

# 第零节：这一章到底在优化什么

这一节课程里没有，是额外补充的。第一次看到「第六章：优化」这个标题时，通常会产生一个疑问，**到底要优化什么，是性能吗？**

并不是。这一章几乎没有涉及性能，它优化的是三种完全不同的东西。

## 0.1 三层优化

![第六章的三层优化](/img/posts/ue5-ch6/ue5-ch6-layers.svg)

**第一层是表现层，也就是玩家一眼就能看到的部分。** 准星让玩家知道自己在瞄准哪里；过肩偏移让角色不再挡住视野的正中央；命中点从胶囊体表面挪到了 Mesh 上，爆炸不再发生在离身体半米远的空气里。

**第二层是判定层，玩家看不见，但能感觉得到。** 子弹从「沿角色朝向飞行」改成了「飞向准星所指的点」；交互目标的选择从「只看朝向」改成了「既看朝向，也看距离」。玩家不会说「你们的点积算法改了」，而是会说「手感对了」。

**第三层是开发效率层，只有开发者自己能看到。** 调试绘制从写死在代码里变成了控制台开关；交互评分的权重从硬编码变成了可以在编辑器里调整。这一层对成品的画面没有一个像素的影响，但它决定了在后面几十个小时的开发中，调整一次参数是要花 3 秒，还是要花 3 分钟。

## 0.2 优化的共同特征：改完"看不出新东西"

这三层有一个共同点，也是它们最违反直觉的地方：

> **每一项优化完成之后，游戏里都没有多出任何新东西。**

这正是优化最难被排进日程的原因，因为它的产出并不是一个可以演示的功能，而是一堆消失了的问题。所以本文对每一项优化都**写清楚「不做会怎样」**。如果写不出来，就说明还没有真正理解为什么要做这项优化。

## 0.3 债是什么时候欠下的

把五节课倒过来看，每一项优化都能追溯到前面某一章里的一个决策：

| 本章优化 | 欠债时间 | 当时的决策 | 后果 |
|---|---|---|---|
| 过肩相机 | 第一章 | 相机正对角色背后 | 角色挡住画面正中，没法瞄准 |
| 打在 Mesh 上 | 第三章 | 用默认碰撞预设 | 命中点在胶囊体表面，离身体十几厘米 |
| 弹道修正 | 第三章 | 子弹沿角色朝向发射 | 准星和弹道不重合 |
| CVar 调试开关 | 第三章 | `DrawDebug*` 直接写在逻辑里 | 想关就得改代码重编译 |
| 交互加距离 | 第三章 | 只用点积算朝向 | 远处正对的赢过脚边的 |

**其中有四项技术债都是在第三章欠下的。** 这并不是巧合，因为第三章是第一次做「完整功能」的章节，为了让整条链路先跑通，每一个环节都选择了最省事的做法。

---

# 第一节：准星与过肩相机

这一节完全没有写 C++，全部是在编辑器里操作，但它的信息密度并不低。

## 1.1 为什么现在才需要准星

前五章的「瞄准」其实是靠猜的。子弹从角色手上沿着角色朝向飞出去，玩家能做的只有把角色转向目标，然后开火看结果。

在打**静止的大目标**（比如爆炸桶）时，这样做没有问题。但是一旦目标会移动、会躲避，或者体积很小，玩家就需要一个**开火之前的预测反馈**，告诉玩家现在按下去，子弹会落在哪里。

准星就是这样一个反馈。它的存在本身就确立了一条新的契约：

> **屏幕正中那个点，就是子弹会去的地方。**

这条契约在这一节还无法兑现（要到第四节才补上），但它必须先确立起来。因为**没有准星，玩家就不知道该期待什么；而有了准星，弹道却不对，玩家会立刻发现「这个准星是骗人的」。** 这也是第一节和第四节必须放在同一章里的原因。

## 1.2 三层控件结构与各自的职责

这一节创建了三个控件蓝图：

```text
MainHUD_WBP                ← 屏幕级容器，一个画布面板
├─ PlayerHealth_WBP        ← 第五章做的血条
└─ Crosshair_WBP           ← 本节新增
   └─ Image (6 × 6, 无贴图)
```

为什么准星要单独做成一个控件，而不是直接往 `MainHUD_WBP` 的画布里放一个 Image 呢？

- **可以替换**。以后如果要做「霰弹枪的四片准星」「狙击镜的十字线」或者「命中时会张开的动态准星」，只需要修改这一个控件，`MainHUD_WBP` 一个字都不用改。
- **可以复用**。载具、观战和教学关卡都可能用到同一个准星。
- **可以独立管理状态**。将来准星需要根据「当前有没有可交互的目标」「是否处于冷却中」来改变颜色和形状，这些逻辑应该属于准星自己，而不应该塞进 HUD 容器里。

这和第五章把 `PlayerHealth_WBP` 单独做成一个控件是同一个思路，**容器只负责摆放位置，内容各自负责自己的行为。**

## 1.3 让准星精确居中的三个设置

`Crosshair_WBP` 位于 `MainHUD_WBP` 的画布面板槽里，要让它精确地落在屏幕正中央，需要同时满足三项设置：

| 设置 | 值 | 作用 |
|---|---|---|
| **锚点（Anchors）** | 中心 | 参照点定在屏幕中心，而不是左上角 |
| **对齐（Alignment）** | `0.5, 0.5` | 用控件自身的中心去对齐锚点，而不是左上角 |
| **位置（Position）** | `0, 0` | 相对锚点零偏移 |

> **锚点和对齐是两个不同的概念，也最容易混淆。** 锚点说的是「参照屏幕上的哪个位置」，对齐说的是「用控件自身的哪个点去贴到那个位置上」。如果只设置了锚点而没有设置对齐，那么落在屏幕中心的是控件的**左上角**，一个 6×6 的准星就会向右下方偏移 3 个像素。这个偏差小到会让人以为是错觉，但又大到会让玩家打不准。

另外还勾选了「**大小到内容（Size To Content）**」，让槽的尺寸跟随 Image 变化，省去了手动同步两处尺寸的麻烦。

至于 Image 本身，**图像留空（None），只把图像大小填为 6×6**。没有贴图时，UMG 会画出一个纯白色的矩形，正好可以当作最简单的准星来使用。

## 1.4 弹簧臂：三个偏移量的区别

这一节把弹簧臂调整成了下面的样子：

```text
TargetArmLength = 175
SocketOffset    = (0, 80, 0)
TargetOffset    = (0, 0, 0)
```

`TargetArmLength` 很好理解，就是相机往后拉多远。**`SocketOffset` 和 `TargetOffset` 看起来很像，但它们完全是两回事。**

引擎每一帧计算相机位置的核心逻辑位于 `USpringArmComponent::UpdateDesiredArmLocation` 中，简化之后是下面三行：

```cpp
// ① 定枢轴：组件世界位置 + TargetOffset（不经过任何旋转变换）
FVector ArmOrigin = GetComponentLocation() + TargetOffset;

FVector DesiredLoc = ArmOrigin;

// ② 沿视线方向往后拉
DesiredLoc -= DesiredRot.Vector() * TargetArmLength;

// ③ 末端平移：SocketOffset 被 DesiredRot 变换过
DesiredLoc += FRotationMatrix(DesiredRot).TransformVector(SocketOffset);
```

这三行代码已经把两者的区别说清楚了。

![弹簧臂的两种偏移](/img/posts/ue5-ch6/ue5-ch6-springarm-offset.svg)

**区别一：坐标空间不同。**

`TargetOffset` 直接加在组件的世界坐标上，**没有经过任何旋转变换**，所以它位于世界空间。而 `SocketOffset` 经过了 `DesiredRot`（弹簧臂当前的朝向）的变换，所以它位于相机的局部空间。

这是实际使用中最关键的差别。**转动视角时，`SocketOffset` 的 `Y = 80` 会一直保持在「相机右手边 80 个单位」的位置**，相机绕着角色转一圈，偏移也跟着转一圈；而 `TargetOffset` 的 `Y = 80` 永远指向世界的 +Y 方向，视角转到角色背面时，它就跑到画面的左边去了。

所以**过肩视角必须使用 `SocketOffset`**。

**区别二：移动的对象不同。**

`TargetOffset` 移动的是**枢轴**（`ArmOrigin`），也就是相机围绕旋转的中心点、碰撞探测的起点，以及位置延迟（Location Lag）的目标点，这三者会一起移动。而 `SocketOffset` 只移动末端的相机，枢轴纹丝不动。

所以设置 `SocketOffset.Y = 80` 之后，相机向右移动，但仍然朝着原来的方向看，角色被挤到了画面的左侧，准星则落在角色右前方的空地上，这正是标准的第三人称射击构图。

**典型用法：**

- `SocketOffset.Y` 用于过肩的左右偏移；
- `TargetOffset.Z` 用于抬高俯视点（世界空间的 Z 就是绝对的向上方向，不受相机俯仰的影响，在这里正好是想要的行为）。

## 1.5 为什么必须用 SocketOffset，而不是直接挪相机组件

一个很自然的想法是，既然只是想把相机往右挪 80，直接给 `CameraComponent` 设置一个相对位置 `(0, 80, 0)` 不就行了吗？

**不行，这样会穿墙。**

引擎官方在 `SocketOffset` 的 tooltip 里写得很直白，使用这个偏移，而不是被挂载组件的相对偏移，是**为了让射线检测按照预期工作**。

看一下代码的执行顺序就明白了：

```cpp
// SocketOffset 已经加进 DesiredLoc
DesiredLoc += FRotationMatrix(DesiredRot).TransformVector(SocketOffset);

// 然后才做碰撞扫描，终点是加完偏移的位置
GetWorld()->SweepSingleByChannel(Result, ArmOrigin, DesiredLoc, ...);
```

弹簧臂的防穿墙扫描，**起点是枢轴，终点是加上 `SocketOffset` 之后的最终相机位置**，所以它知道相机偏出去了。

如果改成给 `CameraComponent` 设置相对位置，弹簧臂就完全不知情。它会按照「没有偏移」的位置做扫描，判定为安全，然后相机在扫描之后，又被子组件的相对变换挪出去 80 个单位，于是**被挪进了墙里**。贴着墙时，相机会直接插进几何体，看到墙的背面。

> 这是一个非常典型的「两个系统各自都正确，合在一起却出错」的 bug。弹簧臂的扫描逻辑没有问题，组件的相对变换也没有问题，问题在于**扫描发生在偏移之前**。这类问题的排查思路是，如果 A 做了检查，而 B 在检查之后又修改了结果，那么这次检查就失去了作用。

## 1.6 这一节埋下的坑

准星已经立在屏幕的正中央，相机也偏到了角色的右后方，但子弹仍然是**从角色手上的插槽生成、沿着角色朝向发射**的。

这两条线并不重合。**准星所指的点和子弹实际飞行的方向之间存在夹角，而且距离越近，偏差越大。**

这个坑会在第四节补上。

---

# 第二节：自定义碰撞通道，让攻击打在 Mesh 上

## 2.1 胶囊体命中的三个问题

在前五章里，子弹打到角色时，命中的是**胶囊体**，也就是一个包住整个角色的粗糙圆柱体。这会带来三个问题。

**问题一：命中点的位置不真实。** 胶囊体的半径要覆盖角色最宽的部分（通常是肩膀），所以打中手臂或者侧身时，命中点会落在离身体十几厘米远的空气里，爆炸特效和弹孔贴花全都飘在空中。

**问题二：拿不到部位信息。** 胶囊体只有一个碰撞体，`FHitResult` 里的 `BoneName` 是空的，所以无法知道玩家打中的是头部、胸部还是腿部。

**问题三：判定的形状和视觉的形状不一致。** 角色摆出一个侧身的姿势时，在视觉上很窄，但胶囊体还是那么粗，玩家就会觉得「明明已经躲开了」。

换成 Mesh 之后，这三个问题会一起得到解决。命中点落在真实的三角面上，`FHitResult` 会带回 `BoneName`，判定的形状也会跟着动画变化。

> **这一节真正的价值并不在于「看起来更准了」，而在于它是伤害系统的前置条件。** 爆头倍率、部位减伤，以及按骨骼选择特效的附着点，这些功能全都要求命中信息精确到骨骼。这节课看起来只是勾选了几个选项，实际上是在为第七章以后的内容铺路。

## 2.2 碰撞响应是双向握手

要理解这一节所有的勾选，只需要记住一条规则：

> **碰撞响应是双向的，最终结果取两边中更弱的一方。**

响应由弱到强的顺序是 `Ignore < Overlap < Block`（在引擎里，`ECollisionResponse` 枚举的值就是 0 / 1 / 2）。两个物体相撞时，引擎会取两者中的 `min`。**只要有一方设置为「忽略」，另一方设置得再强也没有用。**

这一节的配置正好是这条规则最清楚的演示。需要注意，**胶囊体和 Mesh 的对象类型都是 `Pawn`**，抛射物对它们两个的响应位于同一个格子里，所以差别完全来自另一方的设置，如下图所示。

![碰撞响应是双向握手](/img/posts/ue5-ch6/ue5-ch6-collision-handshake.svg)

## 2.3 四个预设逐个拆解

**第一步：新建 Object Channel。**

依次打开项目设置、碰撞、Object Channels，点击新建，命名为 `projectile`，并把**默认响应设为「忽略」**。

**第二步：新建 `Projectile` 预设。**

| 项 | 值 | 理由 |
|---|---|---|
| 碰撞启用 | `Query Only (No Physics Collision)` | 抛射物靠 `ProjectileMovementComponent` 自己驱动，只需要扫描能报告命中，不需要参与刚体接触 |
| 对象类型 | `projectile` | 让世界上的其他东西能针对"抛射物"这一类单独配置 |
| Visibility / Camera / Interaction | 全部**忽略** | 见 2.4 |
| WorldStatic / WorldDynamic / Pawn / PhysicsBody / Vehicle / Destructible | 全部**阻挡** | 该撞的都撞 |
| projectile | **忽略** | 子弹之间互不干扰 |

**第三步：改 `CharacterMesh` 预设。**

| 项 | 值 | 理由 |
|---|---|---|
| projectile | **阻挡** | 这是本节的目的：让子弹能打到 Mesh |
| Camera | 阻挡 | 弹簧臂防穿墙用的是 Camera 通道 |
| Pawn / Vehicle | 忽略 | Mesh 不该把别的角色顶开，那是胶囊体的活 |

**第四步：改 `Pawn` 预设（胶囊体用的）。**

| 项 | 值 | 理由 |
|---|---|---|
| projectile | **忽略** | 让子弹直接穿过胶囊体，不在这里就被拦下 |

**第五步：改 `PhysicsActor` 预设。**

| 项 | 值 | 理由 |
|---|---|---|
| projectile | **阻挡** | 场景里的物理道具（箱子、桶）该被打中 |

把这五步串起来看，**唯一的关键在于 `Pawn` 预设里的那一格，胶囊体主动放行，子弹才能飞进去，打到里面的 Mesh。** 其他四步都是配套的设置。

## 2.4 Projectile 预设里最容易漏看的三处

**第一处：Visibility / Camera / Interaction 三个检测通道全部设为「忽略」。**

这并不是随手填写的，三个通道各有各的理由：

- **Camera** 是弹簧臂 `ProbeChannel` 的默认值。如果抛射物阻挡 Camera 通道，那么当一颗子弹从角色身后飞过时，相机就会突然被拉近，玩家会以为游戏卡住了。
- **Visibility** 是第四节的瞄准射线要用到的通道之一。如果抛射物挡在那里，射线就会打到刚刚发射出去的子弹上。
- **Interaction** 是第三章自定义的交互检测通道。子弹从可交互物体前面飞过时，会短暂地遮断交互判定。

**第二处：projectile 对 projectile 设为「忽略」。** 否则连发时，后一颗子弹会撞上前一颗。这一格在实机测试中最容易发现问题，却也最容易在配置时漏掉。

**第三处：`Query Only`。** 抛射物不需要参与物理求解，这样可以节省一份开销。选择 `Collision Enabled (Query and Physics)` 也能运行，但每颗子弹都会进入物理场景，子弹一多，就会白白消耗 CPU。

## 2.5 默认响应设"忽略"= 白名单思维

新建通道时的那个「默认响应」下拉框，它的作用是决定**所有没有被手动修改过的预设，对这个新通道的响应是什么。**

设成「忽略」意味着，项目里几十个现成的预设（各种 UI、触发器、装饰物和导航体）全都会自动放行子弹，只有显式打开的那五个预设才参与判定。

这是一种**白名单**的思路，而不是黑名单。如果设成「阻挡」，就得反过来逐个排查「哪些东西不应该挡住子弹」，遗漏一个，就会有一颗子弹莫名其妙地在半空中爆炸，而且极难定位原因。

> 这条经验可以推广开来，**新增一个横向的维度时，默认值应该选择「什么都不发生」的那一档。** 这样每一个生效的位置，都是开发者主动写下的。

## 2.6 这一节埋下的坑

现在角色的 Mesh 会阻挡 projectile，而子弹是从角色手上的插槽生成的，也就是说，**生成点就在角色自己 Mesh 的碰撞范围附近。**

这里需要实际测试确认两件事，一是站着不动开火时，子弹能不能正常飞出；二是一边冲刺一边开火时（角色可能会追上自己刚生成的子弹），会不会伤到自己。

第四节会展开讨论这个坑。

---

# 第三节：控制台变量，把调试绘制变成开关

## 3.1 调试绘制不能一直开着的三个理由

第三章编写交互组件时，`DrawDebugBox` 和 `DrawDebugString` 是直接写在 `TickComponent` 里的。那时这样做没有关系，因为整个游戏只有这一个功能。但现在就不行了，原因有三个。

**理由一：看不清。** 每一帧都要给每个候选物体画一个红框和一行文字，场景里的道具一多，屏幕就会被完全糊住。

**理由二：会掩盖别的问题。** 调试绘制本身就有渲染开销，一直开着它，会误导开发者对帧率问题来源的判断。

**理由三：注释掉再取消注释是最糟糕的方案。** 需要看的时候取消注释，编译一次；看完之后再注释回去，又要编译一次。UE 编译一次动辄就要几十秒，一天下来能浪费掉半个小时。而且很容易忘记把它注释回去，结果把调试代码提交进了 git。

控制台变量能一次解决这三个问题，它可以**在运行时切换，不需要重新编译，而且在发行版中会被自动裁掉。**

## 3.2 TAutoConsoleVariable 逐参数拆解

```cpp
static TAutoConsoleVariable<bool> CVarInteractionDebugDrawing(
    TEXT("game.interaction.DebugDraw"),                                    // ① 名字
    false,                                                                  // ② 默认值
    TEXT("Enable interaction component debug rendering. (0 = off, 1 = enabled)"),  // ③ 帮助文本
    ECVF_Cheat);                                                            // ④ 标志位
```

**① 名字**采用点分的层级结构。引擎自带的 `r.` 表示渲染，`p.` 表示物理，`a.` 表示动画。**建议使用项目专属的短前缀**（Tom 在原版 ActionRoguelike 里用的是 `su.`，取自 SurvivalGame），因为 `game.` 太宽泛了，自动补全时会混进引擎自带的一大堆变量。使用专属的前缀，只要敲出这个前缀，就能把项目自己的所有调试开关都筛选出来。

**② 默认值**的类型决定了变量的类型。这里传入的是 `bool`，第四节传入的是 `float`。

**③ 帮助文本**会出现在控制台的 `help` 输出和自动补全提示里，它是写给人看的。**一定要写清楚取值范围**，因为三个月之后，连作者自己都不会记得 2 和 3 有什么区别。

**④ 标志位** `ECVF_Cheat` 的作用见下一小节。

> **不要忘了加 `static`。** `TAutoConsoleVariable` 是文件作用域里的全局变量，不加 `static` 就是外部链接，将来如果另一个 `.cpp` 里出现了同名的变量，就会在链接期发生冲突。UE 源码里所有的 CVar 声明都带有 `static`。

## 3.3 ECVF_Cheat 与 DISABLE_CHEAT_CVARS

`ECVF_Cheat` 不只是一个标记，它有实实在在的效果，那就是**带有这个标志的变量会在 Shipping 和 Test 构建中被裁掉。**

控制这个行为的宏是 `DISABLE_CHEAT_CVARS`，它的定义如下：

```cpp
#define DISABLE_CHEAT_CVARS (UE_BUILD_SHIPPING || (UE_BUILD_TEST && !ALLOW_CHEAT_CVARS_IN_TEST))
```

需要注意 Test 构建的这一分支。通过 `ALLOW_CHEAT_CVARS_IN_TEST` 可以放行作弊变量，这是专门留给 QA 的一个口子，测试人员可以使用作弊变量来复现问题，而正式的玩家不能使用。

**此外还有一层保险，`DrawDebug*` 系列函数本身在 Shipping 构建下会被 `ENABLE_DRAW_DEBUG` 宏替换成空的内联函数。** 所以调试代码不会泄漏到发行版中。

但 Epic 官方文档在介绍 CVar 时，给出的建议还要更进一步，<mark>大多数控制台变量只用于开发期，加 `ECVF_Cheat` 是好主意，**更好的做法是用宏直接把功能编译掉**</mark>。它使用的正是下面这种写法：

```cpp
#if !(UE_BUILD_SHIPPING || UE_BUILD_TEST)
    // 调试代码
#endif
```

第四节的代码已经用上了这个模式（不过只判断了 `UE_BUILD_SHIPPING`，漏掉了 `UE_BUILD_TEST`）。

## 3.4 为什么 API 强迫你写 GetValueOnGameThread

```cpp
bool bEnabledDebugDraw = CVarInteractionDebugDrawing.GetValueOnGameThread();
```

第一次看到这个函数名时，会觉得它很啰嗦，只是取一个值而已，为什么非要在函数名里写清楚线程呢？

这是因为 **CVar 的值可能在任意时刻被控制台修改，而渲染线程比游戏线程滞后一帧。**

引擎为渲染线程维护了一份**独立的缓存副本**，并在帧的边界统一进行同步。这样渲染线程在整整一帧里看到的都是同一个值，不会出现「画到一半参数变了」的撕裂现象。所以取值时必须显式地声明「当前在哪个线程」，**在非游戏线程上调用 `GetValueOnGameThread()`，调试构建里会直接断言失败。**

此外还有一个 `GetValueOnAnyThread()`，但除非确实无法确定当前所在的线程，否则不要使用它，因为它绕过了这层保护。

## 3.5 读一次、用多次

```cpp
// ✅ 函数开头取一次
bool bEnabledDebugDraw = CVarInteractionDebugDrawing.GetValueOnGameThread();

for (const FOverlapResult& Overlap : Overlaps)
{
    // ...
    if (bEnabledDebugDraw) { /* 画框 */ }
}

if (bEnabledDebugDraw) { /* 画球 */ }
```

在函数的开头把值取到一个局部变量里，然后在循环内外都使用这个局部变量，而不是每次绘制之前都调用一遍 `GetValueOnGameThread()`。

`TickComponent` 每一帧都会被调用，循环里还要遍历所有的重叠体，而取值本身是有原子读取开销的。**读取放在外层，使用放在内层，这里的分层是正确的。**

## 3.6 三处待改

| 问题 | 现状 | 应改为 |
|---|---|---|
| 缺 `static` | `TAutoConsoleVariable<bool> CVar...` | `static TAutoConsoleVariable<bool> CVar...` |
| 帮助文本拼写 | `"Eable interaction..."` | `"Enable interaction..."` |
| 变量混用 | `if (SelectedActor)` 却取 `BestActor->GetActorLocation()` | 统一成同一个变量 |

第三条需要多解释几句。这两个变量刚刚被赋值为相等，运行起来完全正常，但是读代码的人（包括三个月之后的作者自己）会停下来确认一次「这两个是不是同一个东西」。**这类不影响运行、只消耗读者注意力的问题，最应该在编写代码的当下就消除掉。**

## 3.7 除了控制台，还有三种设值途径

每次 PIE 时都手动敲一遍命令很麻烦，下面是三种更省事的办法：

```ini
; DefaultEngine.ini —— 作为项目默认值
[SystemSettings]
game.interaction.DebugDraw=1
```

```text
# 编辑器启动参数 —— 只对这次会话生效
-ExecCmds="game.interaction.DebugDraw 1"
```

```text
# Engine/Config/ConsoleVariables.ini 的 [Startup] 段
# 这是唯一允许加载 ECVF_Cheat 变量的 ini 文件
```

调试某个特性期间挂上它，调试完成后再删掉，这比每次重新敲命令要可靠得多。

---

# 第四节：弹道修正，让子弹去准星指的地方

这一节要补上的，正是第一节留下的那个坑。

## 4.1 问题的本质

准星固定在屏幕的正中央，代表的是**相机视线**的方向；而子弹从角色手上的插槽生成，沿着**角色朝向**发射。

这两条线的起点相差将近一米（相机在头顶后方，枪口在手上），方向也不完全一致。结果就是，**玩家把准星压在敌人身上开火，子弹却从敌人旁边飞了过去。** 而且距离越近，偏差就越大。

## 4.2 三步几何

```cpp
void ARoguePlayerCharacter::AttackTimerElapsed(TSubclassOf<ARogueProjectileBase> InProjectileClass)
{
    if (!ensure(InProjectileClass)) { return; }

    FVector SpawnLocation = GetMesh()->GetSocketLocation(MuzzleSocketName);

    FActorSpawnParameters SpawnParams;
    SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
    SpawnParams.Instigator = this;

    // ① 从相机沿控制旋转打一条射线
    FVector  EyeLocation = CameraComponent->GetComponentLocation();
    FRotator EyeRotation = GetControlRotation();
    FVector  TraceEnd    = EyeLocation + (EyeRotation.Vector() * 5000.f);

    FCollisionQueryParams QueryParams;
    QueryParams.AddIgnoredActor(this);

    UWorld* World = GetWorld();
    FHitResult Hit;

    // ② 取命中点；没命中就用射线末端
    FVector AdjustedLocation;
    if (World->LineTraceSingleByChannel(Hit, EyeLocation, TraceEnd, COLLISION_PROJECTILE, QueryParams))
    {
        AdjustedLocation = Hit.Location;
    }
    else
    {
        AdjustedLocation = TraceEnd;
    }

    // ③ 用「枪口 → 目标点」重算生成旋转
    FRotator SpawnRotation = (AdjustedLocation - SpawnLocation).Rotation();

    ARogueProjectileBase* Projectile =
        World->SpawnActor<ARogueProjectileBase>(InProjectileClass, SpawnLocation, SpawnRotation, SpawnParams);

    MoveIgnoreActorAdd(Projectile);
}
```

这三步的核心在于第三步，**生成位置仍然是枪口（在视觉上必须如此），但生成旋转不再来自角色的朝向，而是「从枪口指向准星命中点」的方向。**

这样一来，无论相机偏到哪里，子弹的终点始终都落在准星上。**起点和视觉保持一致，终点和准星保持一致，中间的夹角由代码来承担。**

## 4.3 为什么用 COLLISION_PROJECTILE 而不是 Visibility

射线使用的是 `COLLISION_PROJECTILE` 通道，而不是最常见的 `ECC_Visibility`。这是一个很值得单独记下来的设计。

**这意味着「准星判定会命中什么」和「抛射物实际会撞上什么」查询的是同一套响应表。** 第二节配置的那些勾选，在这里第二次发挥了作用。

如果图省事使用 `Visibility`，就会出现两套判定不一致的情况。假如某个物体对 Visibility 是阻挡，而对 projectile 是忽略（比如一层玻璃，或者一道能量场），那么准星会把目标点定在玻璃上，子弹却会穿过去打到后面，**玩家看到的和实际发生的对不上，而且没有任何报错。**

> 由此可以得到一条通用的经验，**做预测性的判定时，要使用被预测的那个行为本身的通道。** 瞄准射线预测的是子弹，就使用子弹的通道；脚步声的遮挡预测的是声音，就使用声音的通道。

## 4.4 float 型 CVar：开关与持续时间合一

```cpp
static TAutoConsoleVariable<float> CVarProjectileAdjustmentDebugDrawing(
    TEXT("game.Projectile.DebugDraw"), 0.f,
    TEXT("Enable projectile aim adjustment debug rendering. (0 = off, > 0 is duration)"),
    ECVF_Cheat);
```

```cpp
#if !UE_BUILD_SHIPPING
    float DebugDrawDuration = CVarProjectileAdjustmentDebugDrawing.GetValueOnGameThread();
    if (DebugDrawDuration > 0.f)
    {
        DrawDebugBox (World, AdjustedLocation, FVector(20.f), FColor::Green,  false, DebugDrawDuration);
        DrawDebugLine(World, EyeLocation,   TraceEnd,         FColor::Green,  false, DebugDrawDuration);
        DrawDebugLine(World, SpawnLocation, AdjustedLocation, FColor::Yellow, false, DebugDrawDuration);
        DrawDebugLine(World, SpawnLocation,
                      SpawnLocation + (GetControlRotation().Vector() * 5000.f),
                      FColor::Purple, false, DebugDrawDuration);
    }
#endif
```

**这个模式比第三节的 bool 版本更好用。** 一个 float 同时表达了两件事：

- 值 `> 0` 表示开启；
- 值本身就是 `LifeTime`，比如 `game.Projectile.DebugDraw 10` 的意思就是「开启，并且每条线保留 10 秒」。

抛射物是一种**瞬时事件**，如果调试线只画一帧，根本来不及看清楚。所以保留的时间必须可以调整，调整生成角度时用 10 秒（这样能同时看到好几发子弹的轨迹叠加在一起），验证连发时用 0.5 秒（以免画面被糊住）。

**建议回过头去，把第三节的那个 bool 也改成同样的形式**，这样两个调试开关的行为一致，使用时就不需要记住哪个是哪个了。

## 4.5 三条调试线各自是什么

| 颜色 | 起点 → 终点 | 含义 |
|---|---|---|
| 绿色线 | 相机 → 射线末端 | 准星方向，玩家意图 |
| 绿色框 | 目标点 | 射线命中的位置 |
| 黄色线 | 枪口 → 目标点 | **修正后**的实际弹道 |
| 紫色线 | 枪口 → 沿控制旋转 5000 | **修正前**的弹道（对照组） |

**紫色线是这套调试中最有价值的一条**，因为它画出的是「如果不修正会怎样」。黄色和紫色两条线之间的夹角就是修正量，在远处它们几乎重合，在近处则张得很开，一眼就能看出这项优化在哪个距离段起作用。

> 做对照类的调试时，**一定要把「修正前」的结果也画出来**。如果只画修正后的结果，就无法判断修正到底有没有生效，以及生效了多少。

## 4.6 这套方案的两个失效场景

这套方案是第三人称射击游戏的标准解法，但它有两个内在的失效场景，值得主动去复现一次。

![相机看得到，枪口打不到](/img/posts/ue5-ch6/ue5-ch6-aim-parallax.svg)

**场景一：掩体或者墙角。** 相机在头顶后方，枪口在手上，两点之间相距将近一米。**相机能越过矮墙看到的东西，枪口未必能打得到。** 玩家看着准星压在敌人身上开枪，子弹却「啪」的一声炸在了面前的箱子上。

缓解的办法是，拿到修正后的目标点之后，**再从枪口向这个点补一条射线**。如果被挡住了，就退回到那个阻挡点上（至少让特效的位置和视觉保持一致），或者干脆在被挡住时禁止开火，并让准星变一下颜色。

**场景二：极近的距离。** 敌人贴脸时，相机射线可能会从敌人的肩膀旁边掠过，打到十几米外的墙上。这样目标点就跑到了远处，子弹反而擦着敌人飞了过去。

缓解的办法是给射线加上一个**最小有效距离**，或者在近距离时，直接退回到沿控制旋转发射的方式。

> 这两个都是第三人称射击游戏的通用问题，并不是代码写错了。**但是提前知道它们的存在，要比等到玩家反馈「手感有问题」再回头排查节省大量的时间。**

## 4.7 MoveIgnoreActorAdd 的方向问题

```cpp
MoveIgnoreActorAdd(Projectile);
```

这一行需要实机验证。`AActor::MoveIgnoreActorAdd` 会把调用转发到**调用者自己的根组件**的 `MoveIgnoreActors` 列表中：

```cpp
void AActor::MoveIgnoreActorAdd(AActor* InActor)
{
    UPrimitiveComponent* RootPrimComp = Cast<UPrimitiveComponent>(GetRootComponent());
    if (RootPrimComp)
    {
        RootPrimComp->IgnoreActorWhenMoving(InActor, true);
    }
}
```

在角色身上调用它，效果是「**角色的胶囊体在移动时忽略这颗子弹**」，而不是「子弹在移动时忽略角色」。**它的方向是反的。**

而胶囊体在第二节里已经通过通道设置忽略了 projectile，所以这一行代码大概率是在空转。真正的风险在于**子弹从手上生成时撞到角色自己的 Mesh**，而这个风险并没有被覆盖到，因为 Mesh 在第二节被设置成了阻挡 projectile，而且 Mesh 不是根组件，不受这一行代码的影响。

**两个测试：**

1. 站定开火，确认子弹正常飞出
2. **边向前冲刺边开火**，这时角色可能追上刚生成的子弹

如果出现了自伤，或者子弹在身边消失的情况，解决办法是在抛射物那边加上下面的代码：

```cpp
SphereComp->IgnoreActorWhenMoving(GetInstigator(), true);
```

`SpawnParams.Instigator = this` 已经设置好了，正好可以用上。

## 4.8 代码上的四处改进

| 问题 | 现状 | 应改为 |
|---|---|---|
| 拼写 | `TranceEnd` | `TraceEnd`（"trance" 是恍惚） |
| 命名违约定 | `FAdjustLocation` | `AdjustedLocation`——`F` 前缀在 UE 里专给结构体类型用，局部变量带 `F` 会被误读成类型名 |
| 魔数重复 | `5000.f` 出现两次 | 提成 `UPROPERTY(EditDefaultsOnly, Category="Attack") float MaxAimTraceDistance = 5000.f;` |
| 缺判空 | `SpawnActor` 返回值直接使用 | 加 `if (Projectile)` |
| 编译裁剪不全 | `#if !UE_BUILD_SHIPPING` | `#if !(UE_BUILD_SHIPPING \|\| UE_BUILD_TEST)` |

> **命名已经连续三节出现问题了**（第三节混用了 `SelectedActor` 和 `BestActor`，本节有 `TranceEnd` 和 `FAdjustLocation`，第五节还会有 `DistanceTo` 和 `BoxExtend`）。所以有必要在流程中加上一步，**每节提交之前，把新增的变量名扫一遍**，并问自己三个问题：拼写对不对？前缀是否符合 UE 的约定？名字说的是不是它实际存储的东西？

---

# 第五节：交互评分加入距离

## 5.1 只看方向的三个问题

第三章的交互组件在评分时只看点积，也就是**角色朝向与「角色到物体」方向之间夹角的余弦**。哪个物体最正对着角色，就选择哪个。

在测试关卡里只放一两个道具时，这样做没有问题。但是东西一多，三个问题就全部出现了。

**问题一：远处正对着的物体胜过了脚边的物体。** 站在宝箱旁边，视线越过宝箱看向二十米外的一扇门，按下 E 时打开的却是门。这在物理上是说不通的，因为**够得着的物体应该优先。**

**问题二：无法区分同一方向上的多个物体。** 在一条走廊上前后摆放三个箱子，它们的点积几乎一模一样，最终选中哪一个，完全取决于遍历的顺序。

**问题三：没有「太远了」的概念。** 只要物体在球体范围内，并且朝向合适，二十米外和半米外就被同等对待。

加入距离项，就是给评分补上第二个维度。

## 5.2 两个基准点

这是本节代码里最值得肯定的设计，也是最容易写错的地方：

```cpp
FVector Center         = MyPawn->GetActorLocation();                      // 距离基准
FVector CameraLocation = PC->PlayerCameraManager->GetCameraLocation();    // 方向基准
```

![交互评分的两个基准点](/img/posts/ue5-ch6/ue5-ch6-interaction-basis.svg)

**球体重叠和距离项使用的是 `Center`（Pawn 的位置），而点积的方向使用的是 `CameraLocation`（相机的位置）。** 这两个基准点是故意设置成不同的，而且分工是正确的：

- **「哪些东西够得着」是以角色身体为准的物理问题**，所以使用 Pawn 的位置；
- **「正在看哪一个」是以相机为准的视觉问题**，所以使用相机的位置。

第一节把相机偏移出去 80 个单位之后，这两个点相差将近一米。**如果混用，就会出现准星指着 A，却选中了 B 的情况。**

而且点积的前向量使用的是 `PC->GetControlRotation().Vector()`，它和相机这个基准点是配套的，没有和 Pawn 的朝向混在一起。这部分的分层是清晰的。

## 5.3 评分公式逐项拆解

```cpp
// 权重，暴露到编辑器
UPROPERTY(EditDefaultsOnly, Category = "Interaction")
float DistanceToWeightScale = 2.f;

UPROPERTY(EditDefaultsOnly, Category = "Interaction")
float DirectionWeightScale = 1.f;
```

```cpp
FVector Origin, BoxExtent;
OverlapActor->GetActorBounds(true, Origin, BoxExtent);

FVector OverlapDirection = (Origin - CameraLocation).GetSafeNormal();

float RadiusSquared        = InteractionRadius * InteractionRadius;
float DistSquared          = (Origin - Center).SizeSquared();
float NormalizedDistanceTo = 1.0f - (DistSquared / RadiusSquared);

float DotResult           = FVector::DotProduct(PC->GetControlRotation().Vector(), OverlapDirection);
float NormalizedDotResult = DotResult * 0.5f + 0.5f;

float Weight = (NormalizedDotResult  * DirectionWeightScale)
             + (NormalizedDistanceTo * DistanceToWeightScale);

if (Weight > HighestWeight)
{
    BestActor     = OverlapActor;
    HighestWeight = Weight;
}
```

下面逐项来看：

| 表达式 | 值域 | 含义 |
|---|---|---|
| `DotResult` | `[-1, 1]` | 1 = 正前方，0 = 正侧面，-1 = 正后方 |
| `NormalizedDotResult` | `[0, 1]` | 把上面线性映射到 0~1，**正后方得 0 分，而不是被排除** |
| `NormalizedDistanceTo` | `(-∞, 1]` | 1 = 贴脸，0 = 恰好在半径上，**可能为负**（见 5.6） |
| `Weight` | 加权和 | 两项各自乘以可调权重后相加 |

**先把两项都归一化到 `[0, 1]`，再进行加权，这是这个公式设计得好的地方。** 这样权重值就是纯粹的「重要性倍数」，修改权重时不需要在心里换算量纲。如果一项的范围是 0~1，另一项是 0~5000（比如直接使用以厘米为单位的距离），权重就得写成 `0.0002` 这种难以理解的数字。

**使用 `GetActorBounds` 的中心，而不是 `GetActorLocation`**，也是有理由的。很多 Actor 的原点在脚底或者角落（比如一扇门的原点在合页上），使用包围盒的中心，更接近「这个东西看起来在哪里」。

## 5.4 权重配比会让背后的物体胜出

现在配置的是 `DistanceToWeightScale = 2.0`、`DirectionWeightScale = 1.0`，也就是说，**距离项的量级是方向项的两倍。**

再加上 `NormalizedDotResult` 把正后方映射成 0 分，而不是将其排除，就会算出一个很尴尬的结果。设 `R` 为交互半径，分别计算两个候选物体的得分。

**候选 A：正前方，距离 `0.8R`**

```text
距离项 = 1 − 0.8² = 0.36     × 2.0 = 0.72
方向项 = 1                    × 1.0 = 1.00
总分  = 1.72
```

**候选 B：正后方，距离 `0.3R`**

```text
距离项 = 1 − 0.3² = 0.91     × 2.0 = 1.82
方向项 = 0                    × 1.0 = 0.00
总分  = 1.82
```

**结果是背后的那个物体胜出了。**

玩家正对着一扇门，身后的脚边有一个箱子，按下 E 后打开的却是箱子。这是会被玩家抱怨的那种 bug，而且开发者自己很难复现，因为测试时总是面朝着目标站立的。

**临界条件**是可以计算出来的。设前方物体的距离为 `d_f`，后方物体的距离为 `d_b`，那么后方物体获胜的条件是

```text
d_f² − d_b² > 0.5 R²
```

也就是说，**正前方距离为 `0.8R` 的物体，会输给正后方任何距离小于 `0.374R` 的物体。**

**两种修法：**

```cpp
// 方案一：硬约束，直接剔除身后的候选
if (DotResult < 0.f) { continue; }
```

```cpp
// 方案二：调权重，让方向项占主导
float DirectionWeightScale  = 3.f;
float DistanceToWeightScale = 1.f;
```

更可取的是**方案一**，因为它表达的是一条硬约束，「背后的东西不应该能交互」是一条规则，而不是一种偏好。权重只应该用来在**合法的候选之间**做进一步的区分。这两个方案也可以叠加使用。

## 5.5 平方距离：省了开方，也换了曲线

需要注意，`DistSquared` 存储的是 `SizeSquared()`，除以 `RadiusSquared` 之后得到的是 `(d/R)²`：

```text
NormalizedDistanceTo = 1 − (d/R)²
```

这样做**省掉了一次开方运算**（`Size()` 内部要计算 `sqrt`，在每帧的遍历中值得节省），但是**衰减曲线的形状也改变了**：

| 实际距离 | 平方版得分 | 线性版得分 |
|---|---|---|
| `0.25R` | 0.94 | 0.75 |
| `0.50R` | 0.75 | 0.50 |
| `0.75R` | 0.44 | 0.25 |
| `1.00R` | 0.00 | 0.00 |

平方版本在**近处的半程区分度低，在远处的半程下降得快**。对交互来说，这未必是坏事，因为近处的东西「都算够得着」，远处的东西会迅速失去竞争力，这其实很符合直觉。

但是开发者必须清楚自己使用的是哪一条曲线。如果想要线性的衰减，就改成下面这样：

```cpp
float NormalizedDistanceTo = 1.0f - ((Origin - Center).Size() / InteractionRadius);
```

## 5.6 NormalizedDistanceTo 可能是负的

这是一个真实存在的边界 bug。

**重叠检测使用的是 Actor 的碰撞体，而距离计算使用的是 `GetActorBounds` 返回的包围盒中心。** 这两者之间可能相差很远。

一个体积很大的 Actor（比如长桌、大门或者平台）的碰撞边缘已经伸进了球体里，但它包围盒的中心可能在 `1.5R` 之外。这时的计算结果如下：

```text
NormalizedDistanceTo = 1 − 1.5² = −1.25    × 2.0 = −2.5
方向项最高也只有 1.0
总分 ≤ −1.5
```

而 `HighestWeight` 被初始化成了 `0.0f`，所以**得分为负的候选永远都不会被选中**，哪怕角色正贴着那扇门。

修复只需要一行代码：

```cpp
float NormalizedDistanceTo = FMath::Clamp(1.0f - (DistSquared / RadiusSquared), 0.f, 1.f);
```

> **这类 bug 的共同特征是，两个数据来自不同的来源，却被默认为是一致的。** 重叠检测使用碰撞体，评分使用包围盒，编写代码时很容易意识不到这是两套不同的几何。排查的思路是，**凡是「用 A 筛选、用 B 打分」的地方，都要问一句 A 和 B 是不是同一个东西。**

## 5.7 循环不变量：一个反复出现的模式

```cpp
for (const FOverlapResult& Overlap : Overlaps)
{
    // ...
    float RadiusSquared = InteractionRadius * InteractionRadius;              // ❌ 每次都算
    float DotResult = FVector::DotProduct(PC->GetControlRotation().Vector(),  // ❌ 每次都算
                                          OverlapDirection);
}
```

`RadiusSquared` 和 `PC->GetControlRotation().Vector()` 在整个循环中都是常量，应该提到循环的外面，因为这是 `TickComponent` 里每一帧都要运行的代码。

**这和之前几次出现的问题属于同一类，逻辑本身写对了，但放在了比它应在的位置更深一层的地方。** 第三章是调试绘制掉进了算法的循环里，这一次是循环不变量掉进了循环里，而第三节的 CVar 读取则放对了位置（读取一次，使用多次）。

有一个值得固定下来的习惯，**写完循环之后，先把循环体扫一遍，逐行问自己「这一行的结果在每次迭代时会不会变化」。** 不会变化的，一律提到外面去。

修改之后的代码如下：

```cpp
const float    RadiusSquared = InteractionRadius * InteractionRadius;
const FVector  ControlVector = PC->GetControlRotation().Vector();
const bool     bEnabledDebugDraw = CVarInteractionDebugDrawing.GetValueOnGameThread();

for (const FOverlapResult& Overlap : Overlaps)
{
    // ...
    float DotResult = FVector::DotProduct(ControlVector, OverlapDirection);
}
```

## 5.8 CastChecked 是一条硬约束

```cpp
APlayerController* PC = CastChecked<APlayerController>(GetOwner());
```

这一行的含义是，**这个组件从此只能挂在 `APlayerController` 上。**

- 如果挂到 `AAIController` 或者角色身上，在 Development 构建下会直接断言崩溃；
- **在 Shipping 构建下情况更糟**，因为 `CastChecked` 不做校验，而是直接进行 `static_cast`，于是会拿到一个野指针，然后在某个完全无关的地方崩溃。

如果确定这个组件永远只为玩家服务，那就没有问题，但**最好在头文件里写一行注释，把这个前提说清楚**。如果将来想让 AI 也能使用「选择最近的可交互目标」这个功能（比如让同伴 NPC 自动捡东西），这里就得换成 `Cast` 加判空。

> `CastChecked` 和 `Cast` 的选择标准是，**`CastChecked` 表达的是「这里不可能不是这个类型，如果不是，就说明设计出了 bug」**，而 `Cast` 表达的是「这里可能是这个类型，也可能不是，两种情况都会处理」。不要因为「不想写判空」就使用 `CastChecked`。

---

# 知识链路总览

![第六章瞄准链路总览](/img/posts/ue5-ch6/ue5-ch6-chain.svg)

```text
【瞄准链路】
玩家按下开火
  → ARoguePlayerCharacter::AttackTimerElapsed
      → 相机位置 + 控制旋转 → TraceEnd
      → LineTraceSingleByChannel(COLLISION_PROJECTILE)   ← 第二节配的响应表在这生效
          ├─ 命中 → AdjustedLocation = Hit.Location
          └─ 未命中 → AdjustedLocation = TraceEnd
      → SpawnRotation = (AdjustedLocation − 枪口).Rotation()
      → SpawnActor(枪口位置, SpawnRotation)

  → 抛射物飞行（Projectile 预设，Query Only）
      → 逐帧 sweep
      → 穿过胶囊体（Pawn 预设对 projectile 忽略）      ← 双向握手取较弱者
      → 撞上角色 Mesh（CharacterMesh 预设对 projectile 阻挡）
      → FHitResult 带回 BoneName                        ← 为部位伤害铺路

【交互链路】
UInteractionComponent::TickComponent（每帧）
  → OverlapMultiByChannel(COLLISION_INTERACTION, 以 Pawn 位置为球心)
  → 遍历候选
      → 距离项：以 Pawn 位置为基准，1 − (d/R)²
      → 方向项：以相机位置为基准，Dot × 0.5 + 0.5
      → Weight = 方向项 × DirectionWeightScale + 距离项 × DistanceToWeightScale
      → 取最高分 → BestActor
  → SelectedActor = BestActor
  → 调试绘制（受 game.interaction.DebugDraw 控制）
```

把这一章的内容浓缩成五句话：

1. **优化是在还技术债，而不是在加功能**。本章的五项优化中，有四项都能追溯到第三章为了「先跑通」而走的捷径。
2. **碰撞响应取两方中较弱的一方**。胶囊体主动放行，子弹才能进去打到 Mesh，这是整章最需要记住的一条规则。
3. **预测性的判定要使用被预测行为的通道**。瞄准射线预测的是子弹，就使用子弹的通道，否则准星和弹道就会使用两套不同的判定。
4. **调试能力也是产品的一部分**。CVar 开关和可以调整的权重不会出现在成品里，但它们决定了后面几十个小时的迭代速度。
5. **先归一化，再加权**。把两项都压缩到 `[0, 1]` 之后，权重才是可以读懂的「重要性倍数」，而不是一串无法解释的小数。

关于分层，可以再浓缩成三条：

1. **读取放在外层，使用放在内层**。CVar 的值和循环不变量都应该在循环外面取一次。
2. **两个基准点各司其职**。「够不够得着」使用身体的位置，「正在看谁」使用相机的位置。
3. **检查必须发生在最后一次修改之后**。弹簧臂先加上 `SocketOffset` 再做扫描，如果顺序反了，防穿墙就失去了作用。

---

# 易错点速查表

| 症状 | 最可能的原因 | 检查位置 |
|---|---|---|
| 准星偏离屏幕中心几个像素 | 只设了锚点，没设对齐 `0.5, 0.5` | 画布槽细节面板 |
| 准星根本不显示 | Image 没设图像大小，或忘了 `Add to Viewport` | 控件 / `BP_HUD` |
| 转视角时相机偏移方向乱跑 | 用了 `TargetOffset` 而非 `SocketOffset` | 弹簧臂细节面板 |
| 贴墙时相机插进几何体 | 偏移设在 Camera 组件的相对位置上，弹簧臂扫描不知情 | 改用 `SocketOffset` |
| 子弹还是打在胶囊体上 | `Pawn` 预设对 projectile 不是"忽略" | 碰撞预设 |
| 子弹穿过角色什么都不碰 | `CharacterMesh` 预设对 projectile 不是"阻挡" | 碰撞预设 |
| 身后飞过子弹时相机被拉近 | `Projectile` 预设对 Camera 通道没设"忽略" | 碰撞预设 |
| 连发时后一颗子弹撞上前一颗 | `Projectile` 对 projectile 自身没设"忽略" | 碰撞预设 |
| 瞄准射线打到自己刚发的子弹 | `Projectile` 对 Visibility 没设"忽略" | 碰撞预设 |
| 一开火子弹就在手边消失 | 自己的 Mesh 阻挡 projectile，缺 `IgnoreActorWhenMoving` | 抛射物 `BeginPlay` |
| 控制台敲变量名提示找不到命令 | `ECVF_Cheat` + Shipping/Test 构建，被 `DISABLE_CHEAT_CVARS` 裁掉 | 正常行为 |
| CVar 在非游戏线程读取时断言失败 | 用了 `GetValueOnGameThread()` | 改用对应线程的取值函数 |
| 链接期报同名符号冲突 | `TAutoConsoleVariable` 忘了加 `static` | CVar 声明 |
| 准星压在敌人身上却打中面前的箱子 | 相机与枪口视差，掩体挡住枪口 | 见 4.6 场景一 |
| 贴脸时子弹擦着敌人飞过 | 相机射线越过近处目标打到远墙 | 见 4.6 场景二 |
| 准星显示能打中，子弹却穿过去 | 瞄准射线用了 Visibility 而非 projectile 通道 | 射线通道参数 |
| 按 E 打开了身后的箱子而不是面前的门 | 距离权重压过方向权重，且身后不被排除 | 见 5.4 |
| 大体积物体贴着也交互不了 | `NormalizedDistanceTo` 为负，被 `HighestWeight = 0` 挡掉 | 加 `Clamp` |
| 交互目标和准星指的对不上 | 距离和方向混用了同一个基准点 | `Center` vs `CameraLocation` |
| 交互组件挂到 AI 身上就崩 | `CastChecked<APlayerController>` | 见 5.8 |
| 调试绘制关不掉 | CVar 名字打错，或读取放在了 `if` 外面 | 控制台 `help` 查名字 |

---

# 遗留待办

## ① 交互评分排除身后的候选

**它的优先级最高，因为这是本章中唯一会被玩家直接察觉到的逻辑错误。**

```cpp
if (DotResult < 0.f) { continue; }
```

详见 5.4 节，只需要加一行代码就能解决。

## ② `NormalizedDistanceTo` 加钳制

```cpp
float NormalizedDistanceTo = FMath::Clamp(1.0f - (DistSquared / RadiusSquared), 0.f, 1.f);
```

详见 5.6 节。这同样只需要一行代码，但如果不加，就会出现「贴着大门也无法交互」的奇怪现象。

## ③ 验证并修复子弹自撞

运行 4.7 节里的那两个测试。如果问题复现了，就在抛射物里加上下面的代码：

```cpp
SphereComp->IgnoreActorWhenMoving(GetInstigator(), true);
```

## ④ 补一条枪口→目标点的验证射线

详见 4.6 节的场景一。至少要让在掩体后开火时，特效的位置和实际的命中位置保持一致。

## ⑤ 两个 CVar 加 `static`，统一成 float 型

把第三节的 bool 版本改成 float 版本，和第四节保持一致，同时顺便把 `"Eable"` 改成 `"Enable"`。

## ⑥ 编译裁剪补上 `UE_BUILD_TEST`

```cpp
#if !(UE_BUILD_SHIPPING || UE_BUILD_TEST)
```

详见 3.3 节，这是 Epic 官方推荐的写法。

## ⑦ 循环不变量提到循环外

需要外提的是 `RadiusSquared` 和 `ControlVector`，详见 5.7 节。

## ⑧ 命名清理

`TranceEnd` → `TraceEnd`，`FAdjustLocation` → `AdjustedLocation`，`DistanceTo` → `DistSquared`，`BoxExtend` → `BoxExtent`，`SelectedActor` / `BestActor` 统一。

## ⑨ 魔数提取为属性

把 `5000.f`（瞄准射线的长度）提取成一个 `EditDefaultsOnly` 属性，和本章刚刚添加的权重属性放在同一个 Category 里。

## ⑩ CVar 前缀改为项目专属

把 `game.` 改成一个更短的项目前缀，避免在自动补全时和引擎自带的变量混在一起。**需要注意，这会让已经写进 ini 文件的旧名字失效**，所以最好趁引用的地方还少的时候修改。

---

# 第六章完成检查清单

## 准星与相机

- [x] 创建 `Crosshair_WBP`，放置 Image（6×6，无贴图）
- [x] 创建 `MainHUD_WBP`，画布面板里放入血条与准星
- [x] 准星槽设置锚点中心 + 对齐 `0.5, 0.5` + 位置 `0, 0`
- [x] 弹簧臂 `TargetArmLength = 175`
- [x] 弹簧臂 `SocketOffset = (0, 80, 0)`
- [x] 理解 `SocketOffset` 与 `TargetOffset` 的坐标空间差异
- [x] 理解为什么不能用 Camera 组件的相对位置代替

## 碰撞通道

- [x] 新建 Object Channel `projectile`，默认响应"忽略"
- [x] 新建 `Projectile` 预设，`Query Only`，对象类型 `projectile`
- [x] `Projectile` 对 Visibility / Camera / Interaction 全设"忽略"
- [x] `Projectile` 对 projectile 自身设"忽略"
- [x] `CharacterMesh` 对 projectile 设"阻挡"
- [x] `Pawn` 对 projectile 设"忽略"
- [x] `PhysicsActor` 对 projectile 设"阻挡"
- [x] 理解"响应取两边中较弱者"这条规则

## 控制台变量

- [x] 声明 `TAutoConsoleVariable<bool>` 控制交互调试绘制
- [x] 声明 `TAutoConsoleVariable<float>` 控制弹道调试绘制
- [x] 使用 `ECVF_Cheat` 标志
- [x] 函数开头取一次值，循环内外复用
- [x] 弹道调试用 `#if !UE_BUILD_SHIPPING` 包住
- [ ] 两个 CVar 补 `static`（待办⑤）
- [ ] 编译裁剪补 `UE_BUILD_TEST`（待办⑥）

## 弹道修正

- [x] 相机位置 + 控制旋转构造射线
- [x] 用 `COLLISION_PROJECTILE` 通道做 `LineTraceSingleByChannel`
- [x] `AddIgnoredActor(this)` 排除自己
- [x] 未命中时退回射线末端
- [x] 用「目标点 − 枪口」重算 `SpawnRotation`
- [x] 画出修正前（紫）与修正后（黄）两条对照线
- [ ] `SpawnActor` 返回值判空（待办⑨相关）
- [x] 验证子弹是否自撞 Mesh

## 交互评分

- [x] 距离用 Pawn 位置，方向用相机位置
- [x] 两项都归一化到 `[0, 1]` 再加权
- [x] 权重暴露为 `EditDefaultsOnly` 属性
- [x] 用 `GetActorBounds` 中心而非 `GetActorLocation`
- [ ] 排除身后候选（待办①）
- [ ] `NormalizedDistanceTo` 加钳制（待办②）
- [ ] 循环不变量外提（待办⑦）

## 实测验证

- [ ] 转一圈视角，确认相机偏移始终在右侧
- [ ] 贴墙站立，确认相机不插进几何体
- [ ] 打角色手臂，确认命中特效贴在手臂上而非空气中
- [ ] 连发，确认后一颗不撞前一颗
- [ ] 边冲刺边开火，确认不自伤
- [ ] 掩体后开火，观察 4.6 场景一是否复现
- [ ] 贴脸开火，观察 4.6 场景二是否复现
- [ ] 面朝一个物体、脚边放另一个，确认选中的是面前那个

---

# 术语表

| 术语 | 含义 |
|---|---|
| **锚点（Anchors）** | UMG 槽的参照点，决定"相对屏幕的哪里定位" |
| **对齐（Alignment）** | 用控件自身的哪个点去贴锚点，`0.5, 0.5` 为自身中心 |
| **`TargetArmLength`** | 弹簧臂把相机沿视线往后拉的距离 |
| **`SocketOffset`** | 弹簧臂**末端**偏移，**相机局部空间**，跟随相机旋转，只移动相机 |
| **`TargetOffset`** | 弹簧臂**枢轴**偏移，**世界空间**，不跟随旋转，连带移动探测起点与 Lag 目标 |
| **`ProbeChannel`** | 弹簧臂防穿墙扫描使用的通道，默认 `ECC_Camera` |
| **Object Channel** | 自定义的"对象类型"，回答"这是个什么东西" |
| **Trace Channel** | 自定义的"检测类型"，回答"这条射线在找什么" |
| **碰撞预设（Collision Profile）** | 一组打包好的对象类型 + 响应表，供组件直接引用 |
| **双向握手** | 碰撞响应由两边共同决定，结果取 `Ignore < Overlap < Block` 中较弱的一方 |
| **`Query Only`** | 只参与扫描 / 重叠查询，不参与物理刚体求解 |
| **`TAutoConsoleVariable`** | 自注册的控制台变量，构造时即完成注册 |
| **`ECVF_Cheat`** | 标记为作弊变量，Shipping / Test 下被 `DISABLE_CHEAT_CVARS` 裁掉 |
| **`ALLOW_CHEAT_CVARS_IN_TEST`** | 允许 Test 构建保留作弊变量的开关，留给 QA |
| **`ENABLE_DRAW_DEBUG`** | 控制 `DrawDebug*` 系列是否编译进来的宏 |
| **`GetValueOnGameThread`** | 取游戏线程侧的 CVar 值；渲染线程有独立缓存副本，帧边界同步 |
| **`LineTraceSingleByChannel`** | 按通道做单命中射线检测，响应由目标对该通道的设置决定 |
| **`FCollisionQueryParams`** | 射线检测的附加参数，`AddIgnoredActor` 用来排除自己 |
| **`ESpawnActorCollisionHandlingMethod::AlwaysSpawn`** | 生成时即使重叠也照常生成，不做位置调整 |
| **`Instigator`** | 生成参数里的"发起者"，用于伤害归因与自碰撞排除 |
| **`MoveIgnoreActorAdd`** | `AActor` 方法，让**自己的根组件**移动时忽略指定 Actor（单向） |
| **`IgnoreActorWhenMoving`** | `UPrimitiveComponent` 方法，方向由调用的组件决定 |
| **`GetActorBounds`** | 取 Actor 包围盒的中心与半径，比 `GetActorLocation` 更接近视觉中心 |
| **`SizeSquared`** | 向量长度的平方，省掉 `sqrt`，但改变了归一化后的曲线形状 |
| **归一化加权** | 各项先压到 `[0, 1]` 再乘权重，让权重成为可读的"重要性倍数" |
| **循环不变量** | 循环体内每次迭代结果都相同的表达式，应提到循环外 |
| **`CastChecked` / `Cast`** | 前者断言必定成功（Shipping 下不校验），后者返回可能为空的指针 |

---

# 参考资料

- [Epic Games：Collision in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/collision-in-unreal-engine)
- [Epic Games：Collision Response Reference](https://dev.epicgames.com/documentation/en-us/unreal-engine/collision-response-reference-in-unreal-engine)
- [Epic Games：Console Variables in C++](https://dev.epicgames.com/documentation/en-us/unreal-engine/console-variables-in-cplusplus)
- [Epic Games：EConsoleVariableFlags](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Core/EConsoleVariableFlags)
- [Epic Games：Camera Components / Spring Arm](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-cameras-in-unreal-engine)
- [Epic Games：UMG UI Designer](https://dev.epicgames.com/documentation/en-us/unreal-engine/umg-ui-designer-for-unreal-engine)
- [Epic Games：Traces with Raycasts](https://dev.epicgames.com/documentation/en-us/unreal-engine/traces-with-raycasts-in-unreal-engine)
- [Tom Looman：ActionRoguelike on GitHub](https://github.com/tomlooman/ActionRoguelike)
- [Unreal Garden：All UPROPERTY Specifiers](https://unreal-garden.com/docs/uproperty/)
