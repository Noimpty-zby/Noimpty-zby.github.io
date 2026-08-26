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
description: 第六章一节新玩法都没做，五节课全在优化。本篇完整梳理：为什么过肩相机必须用 SocketOffset 而不是直接挪相机组件、碰撞响应"取两边较弱者"这条规则如何让子弹穿过胶囊体打在 Mesh 上、TAutoConsoleVariable 每个参数的含义与 ECVF_Cheat 的真实效果、为什么 API 强迫你写 GetValueOnGameThread、弹道修正的三步几何与它自带的两个失效场景、交互评分加入距离项后权重配比会让背后的物体胜出。重点解释每个优化在解决什么问题、优化后得到了什么，以及每段代码为什么这么写。
cover: /img/covers/UE5-ActionRoguelike-Chapter1.svg
series: UE5 ActionRoguelike
privacy: protected
sitemap: false
private_section: 课外
---

# 前言

这是我跟随 Tom Looman 学习 UE5 C++ 时，对第六章 **Optimization** 的完整复盘。

本章使用的开发环境：

- Unreal Engine `5.6.1`
- Rider
- Visual Studio 2022 Build Tools / MSVC 编译工具链
- 项目名称：`ActionRoguelike`

**这一章一个新玩法都没做。** 前五章每一节的产出都能直接指给别人看——宝箱、拉杆、投射物、炮台、血条。这一章五节课下来，游戏里"新增"的东西只有屏幕中央一个 6×6 的白点。

第一次过这一章的时候，我心里是有点犯嘀咕的：这不就是在磨洋工吗？

后来想明白了，这一章的真正主线是：

> **前五章为了"先跑起来"，欠下了一堆债。这一章把它们一次还清。**

胶囊体命中、瞄不准的弹道、写死的调试绘制、只看朝向的交互判定——这些在前五章都"能用"，都没报错，都通过了编译。它们的共同点是：**只有真正拿手柄玩过的人才会说出哪里不对。**

所以这篇复盘会花大量篇幅回答两个问题：

- **每一项优化在解决什么问题？** 不优化会怎样，玩家会看到什么。
- **优化之后得到了什么？** 不只是"变好了"，而是具体解锁了什么后续能力。

我个人在这一章最大的收获是意识到：**优化不是锦上添花，而是把之前偷的懒还回去。** 每一项优化都不是凭空冒出来的需求，而是某个早期决策留下的后果。

五节课的分工：

| 节 | 主题 | 核心产出 |
| --- | --- | --- |
| 第一节 | 准星与过肩相机 | UMG 控件三层结构、`SocketOffset`、`TargetOffset` |
| 第二节 | 自定义碰撞通道 | `Object Channel`、碰撞预设、双向握手规则 |
| 第三节 | 控制台变量 | `TAutoConsoleVariable`、`ECVF_Cheat`、`GetValueOnGameThread` |
| 第四节 | 弹道修正 | `LineTraceSingleByChannel`、`FRotator` 重算、float 型 CVar |
| 第五节 | 交互评分加距离 | 双基准点、加权评分、`EditDefaultsOnly` 调参 |

和前几章一样，这篇不只记录"点了哪些按钮"，还会重点解释：

- 每一项设置背后的引擎机制，以及不这么设会怎样；
- 为什么这段逻辑放在这一层，而不是上一层或下一层；
- 每个坑的真实成因，以及下次该怎么排查。

---

## 目录

- [第零节：这一章到底在优化什么](#第零节这一章到底在优化什么)
- [第一节：准星与过肩相机](#第一节准星与过肩相机)
- [第二节：自定义碰撞通道，让攻击打在 Mesh 上](#第二节自定义碰撞通道让攻击打在-mesh-上)
- [第三节：控制台变量，把调试绘制变成开关](#第三节控制台变量把调试绘制变成开关)
- [第四节：弹道修正，让子弹去准星指的地方](#第四节弹道修正让子弹去准星指的地方)
- [第五节：交互评分加入距离](#第五节交互评分加入距离)
- [知识链路总览](#知识链路总览)
- [易错点速查表](#易错点速查表)
- [遗留待办](#遗留待办)
- [第六章完成检查清单](#第六章完成检查清单)
- [术语表](#术语表)
- [参考资料](#参考资料)

---

# 第零节：这一章到底在优化什么

这一节课程里没有，是我自己补的。因为第一次看到"第六章：优化"这个标题时，我的疑问是：**优化什么？性能吗？**

不是。这一章几乎没碰性能。它优化的是三样完全不同的东西。

## 0.1 三层优化

![第六章的三层优化](/img/posts/ue5-ch6/ue5-ch6-layers.svg)

**表现层——玩家一眼能看到的。** 准星让玩家知道自己在瞄哪；过肩偏移让角色不再挡住视野正中；命中点从胶囊体表面挪到 Mesh 上，爆炸不再发生在离身体半米远的空气里。

**判定层——玩家看不见，但感觉得到的。** 子弹从"沿角色朝向飞"改成"飞向准星指的点"；交互目标从"看朝向"改成"看朝向 + 看距离"。玩家不会说"你们的点积算法改了"，玩家会说"手感对了"。

**开发效率层——只有你自己能看到的。** 调试绘制从写死变成控制台开关；交互评分的权重从硬编码变成编辑器可调。这一层不影响成品一个像素，但它决定了后面几十个小时里你调一次参数要花 3 秒还是 3 分钟。

## 0.2 优化的共同特征：改完"看不出新东西"

三层有一个共同点，也是它们最反直觉的地方：

> **每一项都是"改完之后，游戏里没有多出任何新东西"。**

这正是优化最难被安排进日程的原因——它的产出不是一个可以演示的功能，而是一堆消失的问题。所以我在复盘时给自己定了一条规矩：**每写一项优化，必须写清楚"不做会怎样"。** 如果写不出来，说明我根本没理解为什么要做。

## 0.3 债是什么时候欠下的

把五节课倒着看，每一项优化都能追溯到前面某一章的一个决策：

| 本章优化 | 欠债时间 | 当时的决策 | 后果 |
|---|---|---|---|
| 过肩相机 | 第一章 | 相机正对角色背后 | 角色挡住画面正中，没法瞄准 |
| 打在 Mesh 上 | 第三章 | 用默认碰撞预设 | 命中点在胶囊体表面，离身体十几厘米 |
| 弹道修正 | 第三章 | 子弹沿角色朝向发射 | 准星和弹道不重合 |
| CVar 调试开关 | 第三章 | `DrawDebug*` 直接写在逻辑里 | 想关就得改代码重编译 |
| 交互加距离 | 第三章 | 只用点积算朝向 | 远处正对的赢过脚边的 |

**四项债都是第三章欠的。** 这不是巧合——第三章是第一次做"完整功能"的章节，为了让链路先跑通，每一个环节都取了最省事的做法。

---

# 第一节：准星与过肩相机

这一节完全没写 C++，全在编辑器里点。但它的信息密度不低。

## 1.1 为什么现在才需要准星

前五章的"瞄准"其实是靠猜的：子弹从角色手上沿角色朝向飞出去，玩家能做的只有把角色转向目标，然后开火看结果。

这在打**静止的大目标**（爆炸桶）时没问题。一旦目标会动、会躲、体积小，玩家就需要一个**开火前的预测反馈**——我现在按下去，弹会去哪。

准星就是这个反馈。它的存在本身就产生了一条新契约：

> **屏幕正中那个点，就是子弹会去的地方。**

这条契约在这一节还兑现不了（第四节才补上），但它必须先立起来——**没有准星，玩家不知道该期待什么；有了准星而弹道不对，玩家会立刻发现"你们骗人"。** 这也是为什么第一节和第四节必须放在同一章。

## 1.2 三层控件结构与各自的职责

这一节建了三个控件蓝图：

```text
MainHUD_WBP                ← 屏幕级容器，一个画布面板
├─ PlayerHealth_WBP        ← 第五章做的血条
└─ Crosshair_WBP           ← 本节新增
   └─ Image (6 × 6, 无贴图)
```

为什么准星要单独做一个控件，而不是直接往 `MainHUD_WBP` 的画布里扔一个 Image？

- **可替换**：以后要做"霰弹枪四片准星""狙击镜十字线""命中时张开的动态准星"，改一个控件就行，`MainHUD_WBP` 一个字都不用动。
- **可复用**：载具、观战、教学关都可能要用同一个准星。
- **可独立管状态**：准星将来需要根据"当前是否有可交互目标""是否在冷却中"变色变形，这些逻辑应该属于准星自己，不该塞进 HUD 容器。

这和第五章 `PlayerHealth_WBP` 单独成件是同一个思路：**容器只负责摆位置，内容各自负责自己的行为。**

## 1.3 让准星精确居中的三个设置

`Crosshair_WBP` 在 `MainHUD_WBP` 的画布面板槽里，要精确落在屏幕正中，需要三个设置同时成立：

| 设置 | 值 | 作用 |
|---|---|---|
| **锚点（Anchors）** | 中心 | 参照点定在屏幕中心，而不是左上角 |
| **对齐（Alignment）** | `0.5, 0.5` | 用控件自身的中心去对齐锚点，而不是左上角 |
| **位置（Position）** | `0, 0` | 相对锚点零偏移 |

> **锚点和对齐是两个不同的东西，最容易混。** 锚点说的是"参照屏幕的哪里"，对齐说的是"用我自己的哪个点去贴过去"。只设锚点不设对齐，控件的**左上角**会落在屏幕中心，一个 6×6 的准星会偏右下 3 像素——小到你以为是错觉，大到玩家打不准。

另外勾选了**"大小到内容（Size To Content）"**，让槽的尺寸跟着 Image 走，省得手动同步两处尺寸。

至于 Image 本身：**图像留空（None），只填图像大小 6×6**。没有贴图时 UMG 会画一个纯白矩形，正好当作最简准星用。

## 1.4 弹簧臂：三个偏移量的区别

这一节把弹簧臂调成了：

```text
TargetArmLength = 175
SocketOffset    = (0, 80, 0)
TargetOffset    = (0, 0, 0)
```

`TargetArmLength` 好理解，就是相机往后拉多远。**`SocketOffset` 和 `TargetOffset` 长得像，但完全不是一回事。**

引擎每帧算相机位置的核心逻辑在 `USpringArmComponent::UpdateDesiredArmLocation`，简化后是三行：

```cpp
// ① 定枢轴：组件世界位置 + TargetOffset（不经过任何旋转变换）
FVector ArmOrigin = GetComponentLocation() + TargetOffset;

FVector DesiredLoc = ArmOrigin;

// ② 沿视线方向往后拉
DesiredLoc -= DesiredRot.Vector() * TargetArmLength;

// ③ 末端平移：SocketOffset 被 DesiredRot 变换过
DesiredLoc += FRotationMatrix(DesiredRot).TransformVector(SocketOffset);
```

三行代码就把区别说清楚了：

![弹簧臂的两种偏移](/img/posts/ue5-ch6/ue5-ch6-springarm-offset.svg)

**区别一：坐标空间不同。**

`TargetOffset` 直接加在组件的世界坐标上，**没有经过任何旋转变换**——它是世界空间的。`SocketOffset` 被 `DesiredRot`（弹簧臂当前朝向）变换过——它是相机局部空间的。

这是实际使用中最关键的差别：**你转动视角时，`SocketOffset` 的 `Y = 80` 会一直保持在"相机右手边 80 单位"**，相机绕角色转一圈，偏移跟着转一圈；而 `TargetOffset` 的 `Y = 80` 永远指向世界 +Y，你转到背面时它就跑到画面左边去了。

所以**过肩视角必须用 `SocketOffset`**。

**区别二：移动的对象不同。**

`TargetOffset` 移动的是**枢轴**（`ArmOrigin`）——相机围着转的中心点、碰撞探测的起点、以及位置延迟（Location Lag）的目标点，三者一起动。`SocketOffset` 只移动末端相机，枢轴纹丝不动。

所以设 `SocketOffset.Y = 80` 之后，相机右移但仍朝原方向看，角色被挤到画面左侧，准星落在他右前方的空地上——正是标准的第三人称射击构图。

**典型用法：**

- `SocketOffset.Y` → 过肩左右偏移
- `TargetOffset.Z` → 抬高俯视点（世界空间的 Z 就是绝对向上，不受相机俯仰影响，这里正好是想要的行为）

## 1.5 为什么必须用 SocketOffset，而不是直接挪相机组件

一个很自然的想法：既然只是想把相机往右挪 80，直接给 `CameraComponent` 设一个相对位置 `(0, 80, 0)` 不就行了？

**不行，会穿墙。**

引擎官方在 `SocketOffset` 的 tooltip 里写得很直白：用这个偏移，而不是被挂组件的相对偏移，是**为了让射线检测按预期工作**。

看代码顺序就明白了：

```cpp
// SocketOffset 已经加进 DesiredLoc
DesiredLoc += FRotationMatrix(DesiredRot).TransformVector(SocketOffset);

// 然后才做碰撞扫描，终点是加完偏移的位置
GetWorld()->SweepSingleByChannel(Result, ArmOrigin, DesiredLoc, ...);
```

弹簧臂的防穿墙扫描，**起点是枢轴，终点是加完 `SocketOffset` 的最终相机位置**——它知道相机偏出去了。

如果你改成给 `CameraComponent` 设相对位置，弹簧臂完全不知情：它按"没有偏移"的位置做扫描，判定为安全，然后相机在那之后又被子组件的相对变换挪出去 80 单位——**挪进墙里了**。贴墙时相机会直接插进几何体，看到墙的背面。

> 这是一个非常典型的"两个系统各自都对，合起来错"的 bug。弹簧臂的扫描逻辑没问题，组件的相对变换也没问题，问题在于**扫描发生在偏移之前**。记住这类问题的排查思路：当 A 做了检查、B 在检查之后又改了结果，检查就白做了。

## 1.6 这一节埋下的坑

准星立在了屏幕正中，相机偏到了角色右后方。而子弹仍然是**从角色手上的插槽生成、沿角色朝向发射**的。

这两条线不重合。**准星指的点和子弹实际飞的方向存在夹角，距离越近偏得越狠。**

这个坑第四节补。

---

# 第二节：自定义碰撞通道，让攻击打在 Mesh 上

## 2.1 胶囊体命中的三个问题

前五章里，子弹打到角色时，命中的是**胶囊体**——一个包住整个角色的粗糙圆柱。这带来三个问题：

**问题一：命中点位置假。** 胶囊体的半径要覆盖角色最宽的部分（通常是肩膀），所以打手臂、打侧身时，命中点会落在离身体十几厘米外的空气里。爆炸特效、弹孔贴花全部飘着。

**问题二：拿不到部位信息。** 胶囊体只有一个碰撞体，`FHitResult` 里的 `BoneName` 是空的。你没法知道玩家打中的是头、是胸还是腿。

**问题三：判定形状和视觉形状不符。** 角色摆出一个侧身姿势，视觉上很窄，胶囊体还是那么粗，玩家会觉得"我明明躲开了"。

换成 Mesh 之后，三个问题一起解决：命中点落在真实的三角面上，`FHitResult` 带回 `BoneName`，判定跟着动画走。

> **这一节的真正价值不在于"看起来准了"，而在于它是伤害系统的前置条件。** 爆头倍率、部位减伤、按骨骼选特效附着点——这些全都要求命中信息精确到骨骼。这节课看着只是勾几个框，实际上是在给第七章以后铺路。

## 2.2 碰撞响应是双向握手

要理解这一节所有的勾选，只需要记住一条规则：

> **碰撞响应是双向的，最终结果取两边中更弱的一方。**

响应的强弱顺序是 `Ignore < Overlap < Block`（引擎里 `ECollisionResponse` 枚举值就是 0 / 1 / 2）。两个物体相撞时引擎取 `min`。**只要有一边说"忽略"，另一边喊得再大声也没用。**

这一节的配置正好是这条规则最干净的演示——注意**胶囊体和 Mesh 的对象类型都是 `Pawn`**，抛射物对它俩的响应是同一个格子，差别完全来自另一边：

![碰撞响应是双向握手](/img/posts/ue5-ch6/ue5-ch6-collision-handshake.svg)

## 2.3 四个预设逐个拆解

**第一步：新建 Object Channel。**

项目设置 → 碰撞 → Object Channels → 新建，命名 `projectile`，**默认响应设为"忽略"**。

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

把这五步串起来看：**唯一的关键是 `Pawn` 预设那一格 —— 胶囊体主动放行，子弹才能飞进去打到里面的 Mesh。** 其他四步都是配套。

## 2.4 Projectile 预设里最容易漏看的三处

**第一处：Visibility / Camera / Interaction 三个检测通道全设"忽略"。**

这不是随手填的，三个通道各有各的理由：

- **Camera** 是弹簧臂 `ProbeChannel` 的默认值。抛射物如果阻挡 Camera，你身后飞过一颗子弹，相机就会突然被拉近——玩家会以为游戏卡了。
- **Visibility** 是第四节瞄准射线要用的通道之一。抛射物挡在那儿，射线会打到自己刚发射的子弹上。
- **Interaction** 是第三章自定义的交互检测通道。子弹从可交互物体前面飞过，会短暂遮断交互判定。

**第二处：projectile 对 projectile 设"忽略"。** 连发时后一颗会撞上前一颗，这是最容易在实机测试里发现、却最容易在配置时漏掉的一格。

**第三处：`Query Only`。** 抛射物不需要参与物理求解，省一份开销。选 `Collision Enabled (Query and Physics)` 也能跑，但每颗子弹都会进物理场景，弹幕一多就是白白烧 CPU。

## 2.5 默认响应设"忽略"= 白名单思维

新建通道时那个"默认响应"下拉框，作用是：**所有你没手动改过的预设，对这个新通道的响应是什么。**

设成"忽略"意味着：项目里几十个现成预设（各种 UI、触发器、装饰物、导航体）全部自动放行子弹，只有你显式打开的那五个才参与判定。

这是**白名单**而不是黑名单。如果设成"阻挡"，你就得反过来去挨个排查"哪些东西不该挡子弹"——遗漏一个就是一颗子弹莫名其妙在半空炸掉，而且极难定位。

> 这条经验可以推广：**新增一个横向维度时，默认值永远选"什么都不发生"的那一档。** 让每一个生效的位置都是你主动写下的。

## 2.6 这一节埋下的坑

角色 Mesh 现在阻挡 projectile，而子弹是从角色手上的插槽生成的——**生成点就在自己 Mesh 的碰撞范围附近。**

需要实测确认：站定开火子弹是否正常飞出？边冲刺边开火（角色可能追上自己刚生成的子弹）会不会自伤？

第四节会展开这个坑。

---

# 第三节：控制台变量，把调试绘制变成开关

## 3.1 调试绘制不能一直开着的三个理由

第三章写交互组件时，`DrawDebugBox` / `DrawDebugString` 是直接写在 `TickComponent` 里的。当时无所谓，因为整个游戏就那一个功能。现在不行了：

**理由一：看不清。** 每帧每个候选物体画一个红框加一行文字，场景里道具一多，屏幕直接糊掉。

**理由二：会掩盖别的问题。** 调试绘制本身有渲染开销，一直开着会让你误判帧率问题的来源。

**理由三：注释掉再取消注释是最糟的方案。** 这是我原来的做法——需要看就取消注释，编译一次；看完再注释回去，再编译一次。UE 一次编译动辄几十秒，一天下来能浪费掉半小时。而且极容易忘记注释回去，把调试代码提交进 git。

控制台变量把这三件事一次解决：**运行时切换，零编译，且发行版自动裁掉。**

## 3.2 TAutoConsoleVariable 逐参数拆解

```cpp
static TAutoConsoleVariable<bool> CVarInteractionDebugDrawing(
    TEXT("game.interaction.DebugDraw"),                                    // ① 名字
    false,                                                                  // ② 默认值
    TEXT("Enable interaction component debug rendering. (0 = off, 1 = enabled)"),  // ③ 帮助文本
    ECVF_Cheat);                                                            // ④ 标志位
```

**① 名字**采用点分层级。引擎自带的 `r.` 是渲染，`p.` 是物理，`a.` 是动画。**建议用项目专属的短前缀**（Tom 在原版 ActionRoguelike 里用的是 `su.`，取自 SurvivalGame），因为 `game.` 太泛，自动补全时会混进引擎自带的一堆变量。用专属前缀，敲一个前缀就能把自己项目的所有调试开关筛出来。

**② 默认值**的类型决定了变量类型。这里传 `bool`，第四节传 `float`。

**③ 帮助文本**会出现在控制台的 `help` 输出和自动补全提示里，是给人看的。**要写清楚取值范围**——三个月后的你不会记得 2 和 3 有什么区别。

**④ 标志位** `ECVF_Cheat` 见下一小节。

> **别忘了 `static`。** `TAutoConsoleVariable` 是文件作用域的全局变量，不加 `static` 就是外部链接，将来另一个 `.cpp` 里出现同名变量会在链接期撞车。UE 源码里所有的 CVar 声明都带 `static`。

## 3.3 ECVF_Cheat 与 DISABLE_CHEAT_CVARS

`ECVF_Cheat` 不只是一个标记，它有实打实的效果：**带这个标志的变量会在 Shipping / Test 构建下被裁掉。**

控制这个行为的宏是 `DISABLE_CHEAT_CVARS`，定义为：

```cpp
#define DISABLE_CHEAT_CVARS (UE_BUILD_SHIPPING || (UE_BUILD_TEST && !ALLOW_CHEAT_CVARS_IN_TEST))
```

注意 Test 构建这一支：通过 `ALLOW_CHEAT_CVARS_IN_TEST` 可以放行，这是专门留给 QA 的口子——测试同事能用作弊变量复现问题，正式玩家不能。

**再加一层保险：`DrawDebug*` 系列函数本身在 Shipping 下会被 `ENABLE_DRAW_DEBUG` 宏替换成空的内联函数。** 所以调试代码不会泄漏到发行版。

但 Epic 官方文档在讲 CVar 时给的建议还要更进一步：<mark>大多数控制台变量只用于开发期，加 `ECVF_Cheat` 是好主意，**更好的做法是用宏直接把功能编译掉**</mark>，用的正是：

```cpp
#if !(UE_BUILD_SHIPPING || UE_BUILD_TEST)
    // 调试代码
#endif
```

第四节的代码已经用上了这个模式（不过只判了 `UE_BUILD_SHIPPING`，漏了 `UE_BUILD_TEST`）。

## 3.4 为什么 API 强迫你写 GetValueOnGameThread

```cpp
bool bEnabledDebugDraw = CVarInteractionDebugDrawing.GetValueOnGameThread();
```

第一次看到这个函数名会觉得很啰嗦——取个值而已，为什么非要在函数名里写清楚线程？

因为 **CVar 的值可能在任意时刻被控制台改掉，而渲染线程比游戏线程滞后一帧。**

引擎为渲染线程维护了一份**独立的缓存副本**，在帧边界统一同步。这样渲染线程整帧看到的都是同一个值，不会出现"画到一半参数变了"的撕裂。所以取值必须显式声明"我在哪个线程"——**在非游戏线程上调 `GetValueOnGameThread()`，调试构建里会直接断言失败。**

还有一个 `GetValueOnAnyThread()`，但除非确实不确定当前线程，否则别用——它绕过了这层保护。

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

在函数开头把值取到局部变量，然后循环内外都用它——而不是每次画之前都调一遍 `GetValueOnGameThread()`。

`TickComponent` 每帧调用，循环里还要遍历所有重叠体，取值本身是有原子读开销的。**这是"读取属于外层，使用属于内层"的分层判断，放对了位置。**

## 3.6 三处待改

| 问题 | 现状 | 应改为 |
|---|---|---|
| 缺 `static` | `TAutoConsoleVariable<bool> CVar...` | `static TAutoConsoleVariable<bool> CVar...` |
| 帮助文本拼写 | `"Eable interaction..."` | `"Enable interaction..."` |
| 变量混用 | `if (SelectedActor)` 却取 `BestActor->GetActorLocation()` | 统一成同一个变量 |

第三条要多说两句：两者刚被赋值成相等，跑起来完全正常，但读代码的人（三个月后的你）会停下来确认一次"这俩是不是一个东西"。**这类不影响运行、只消耗读者注意力的问题，才是最该在写的当下就消灭的。**

## 3.7 除了控制台，还有三种设值途径

每次 PIE 都手敲一遍命令很烦。三种更省事的办法：

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

调试某个特性期间挂上，调完删掉，比每次重新敲命令可靠得多。

---

# 第四节：弹道修正，让子弹去准星指的地方

这一节补的正是第一节埋下的坑。

## 4.1 问题的本质

准星固定在屏幕正中，代表**相机视线**的方向；子弹从角色手上的插槽生成，沿**角色朝向**发射。

这两条线的起点差了将近一米（相机在头顶后方，枪口在手上），方向也不完全一致。结果就是：**玩家把准星压在敌人身上开火，子弹从敌人旁边飞过去。** 距离越近，偏差越大。

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

三步的核心是第三步：**生成位置仍然是枪口（视觉上必须如此），但生成旋转不再来自角色朝向，而是"从枪口指向准星命中点"。**

这样一来，无论相机偏到哪里，子弹的终点始终落在准星上。**起点和视觉保持一致，终点和准星保持一致，中间的夹角由代码承担。**

## 4.3 为什么用 COLLISION_PROJECTILE 而不是 Visibility

射线用的是 `COLLISION_PROJECTILE` 通道，不是最常见的 `ECC_Visibility`。这是一个很值得单独记下来的设计点。

**这意味着「准星判定会命中什么」和「抛射物实际会撞上什么」查的是同一套响应表。** 第二节配的那些勾选在这里第二次生效了。

如果图省事用 `Visibility`，就会出现两套判定不一致的情况：某个物体对 Visibility 是阻挡、对 projectile 是忽略（比如一层玻璃、一道能量场），那么准星会把目标点定在玻璃上，子弹却穿过去打到后面——**玩家看到的和实际发生的对不上，而且没有任何报错。**

> 一条通用经验：**做预测性判定时，用被预测行为本身的通道。** 瞄准射线预测的是子弹，就用子弹的通道；脚步声遮挡预测的是声音，就用声音的通道。

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

**这个模式比第三节的 bool 版更好用。** 一个 float 同时表达两件事：

- `> 0` 就是"开启"
- 值本身就是 `LifeTime`——`game.Projectile.DebugDraw 10` 意思是"开启，且每条线留 10 秒"

抛射物是**瞬时事件**，如果调试线只画一帧，你根本来不及看清。留驻时间必须可调：调整生成角度时用 10 秒（能同时看到好几发的轨迹叠加），验证连发时用 0.5 秒（免得画面糊掉）。

**建议回头把第三节那个 bool 也改成同样的形式**，两个调试开关行为一致，用起来不用记哪个是哪个。

## 4.5 三条调试线各自是什么

| 颜色 | 起点 → 终点 | 含义 |
|---|---|---|
| 绿色线 | 相机 → 射线末端 | 准星方向，玩家意图 |
| 绿色框 | 目标点 | 射线命中的位置 |
| 黄色线 | 枪口 → 目标点 | **修正后**的实际弹道 |
| 紫色线 | 枪口 → 沿控制旋转 5000 | **修正前**的弹道（对照组） |

**紫色线是这套调试里最有价值的一条**，因为它画的是"如果不修正会怎样"。黄紫两条线之间的夹角就是修正量——远处几乎重合，近处张得很开，一眼就能看出这个优化在什么距离段起作用。

> 做对照类调试时，**永远把"修正前"也画出来**。只画修正后的结果，你无法判断修正到底有没有生效、生效了多少。

## 4.6 这套方案的两个失效场景

这套方案是第三人称射击的标准解法，但它有两个内建的失效场景，值得主动去复现一次：

![相机看得到，枪口打不到](/img/posts/ue5-ch6/ue5-ch6-aim-parallax.svg)

**场景一：掩体 / 墙角。** 相机在头顶后方，枪口在手上，两点相距近一米。**相机能越过矮墙看到的东西，枪口未必打得到。** 玩家看着准星压在敌人身上开枪，子弹啪一声炸在面前的箱子上。

缓解办法：拿到修正后的目标点后，**再从枪口向该点补一条射线**，如果被挡就退回到那个阻挡点（至少让特效位置和视觉一致），或者干脆在被挡时禁止开火并给准星变个色。

**场景二：极近距离。** 敌人贴脸时，相机射线可能从他肩膀旁边掠过去打到十几米外的墙，目标点跑到远处，子弹反而擦着敌人飞过。

缓解办法：给射线加一个**最小有效距离**，或者近距离时直接退化成沿控制旋转发射。

> 这两个都是第三人称射击的通用问题，不是代码写错了。**但知道它存在，比等玩家反馈"手感有问题"再回头查要省太多时间。**

## 4.7 MoveIgnoreActorAdd 的方向问题

```cpp
MoveIgnoreActorAdd(Projectile);
```

这行需要实机验证。`AActor::MoveIgnoreActorAdd` 转发到**调用者自己的根组件**的 `MoveIgnoreActors` 列表：

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

在角色身上调它，效果是「**角色的胶囊体移动时忽略这颗子弹**」——而不是「子弹移动时忽略角色」。**方向是反的。**

而胶囊体在第二节里已经通过通道设置忽略 projectile 了，所以这行大概率是空转。真正的风险——**子弹从手上生成时撞到自己的 Mesh**（Mesh 在第二节被设成阻挡 projectile，且 Mesh 不是根组件，不受这行影响）——并没有被覆盖。

**两个测试：**

1. 站定开火，确认子弹正常飞出
2. **边向前冲刺边开火**，这时角色可能追上刚生成的子弹

如果出现自伤或子弹在身边消失，解法是在抛射物那边加：

```cpp
SphereComp->IgnoreActorWhenMoving(GetInstigator(), true);
```

`SpawnParams.Instigator = this` 已经设好了，正好能用上。

## 4.8 代码上的四处改进

| 问题 | 现状 | 应改为 |
|---|---|---|
| 拼写 | `TranceEnd` | `TraceEnd`（"trance" 是恍惚） |
| 命名违约定 | `FAdjustLocation` | `AdjustedLocation`——`F` 前缀在 UE 里专给结构体类型用，局部变量带 `F` 会被误读成类型名 |
| 魔数重复 | `5000.f` 出现两次 | 提成 `UPROPERTY(EditDefaultsOnly, Category="Attack") float MaxAimTraceDistance = 5000.f;` |
| 缺判空 | `SpawnActor` 返回值直接使用 | 加 `if (Projectile)` |
| 编译裁剪不全 | `#if !UE_BUILD_SHIPPING` | `#if !(UE_BUILD_SHIPPING \|\| UE_BUILD_TEST)` |

> **命名已经连着三节出问题了**（第三节 `SelectedActor` / `BestActor` 混用，本节 `TranceEnd` 和 `FAdjustLocation`，第五节还会有 `DistanceTo` 和 `BoxExtend`）。我给自己加了一条流程：**每节提交前扫一遍新增的变量名**，问三个问题——拼写对吗？前缀符合 UE 约定吗？名字说的是它实际存的东西吗？

---

# 第五节：交互评分加入距离

## 5.1 只看方向的三个问题

第三章的交互组件，评分只看点积——**角色朝向和"角色到物体"方向的夹角余弦**。谁最正对着，选谁。

这在测试关里只放一两个道具时没问题。东西一多，三个问题全出来了：

**问题一：远处正对的赢过脚边的。** 你站在宝箱旁边，视线越过它看向二十米外的一扇门，按 E 打开了门。这在物理上说不通——**够得着的应该优先。**

**问题二：无法在同方向的多个物体里区分。** 一条走廊上前后摆三个箱子，点积几乎一模一样，选中哪个纯看遍历顺序。

**问题三：没有"太远了"的概念。** 只要在球体范围内且朝向合适，二十米外和半米外一视同仁。

加入距离项就是给评分补上第二个维度。

## 5.2 两个基准点

这是本节代码里最值得肯定的设计，也是最容易写错的地方：

```cpp
FVector Center         = MyPawn->GetActorLocation();                      // 距离基准
FVector CameraLocation = PC->PlayerCameraManager->GetCameraLocation();    // 方向基准
```

![交互评分的两个基准点](/img/posts/ue5-ch6/ue5-ch6-interaction-basis.svg)

**球体重叠和距离项用 `Center`（Pawn 位置），点积方向用 `CameraLocation`（相机位置）。** 两个基准点故意不同，而且分工是对的：

- **「什么东西够得着」是以角色身体为准的物理问题** → 用 Pawn 位置
- **「我在看哪个」是以相机为准的视觉问题** → 用相机位置

第一节把相机偏出去 80 单位之后，这两点差了将近一米。**混用会让准星指着 A、却选中 B。**

而且点积的前向量用的是 `PC->GetControlRotation().Vector()`，和相机基准是配套的，没有和 Pawn 朝向混起来。这块分层是清晰的。

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

逐项看：

| 表达式 | 值域 | 含义 |
|---|---|---|
| `DotResult` | `[-1, 1]` | 1 = 正前方，0 = 正侧面，-1 = 正后方 |
| `NormalizedDotResult` | `[0, 1]` | 把上面线性映射到 0~1，**正后方得 0 分，而不是被排除** |
| `NormalizedDistanceTo` | `(-∞, 1]` | 1 = 贴脸，0 = 恰好在半径上，**可能为负**（见 5.6） |
| `Weight` | 加权和 | 两项各自乘以可调权重后相加 |

**把两项都归一化到 `[0, 1]` 再加权，是这个公式设计得好的地方**——权重值就是纯粹的"重要性倍数"，改权重时不用去心算量纲。如果一项是 0~1、另一项是 0~5000（比如直接用距离的厘米数），权重就得写成 `0.0002` 这种没法读的数字。

**用 `GetActorBounds` 的中心而不是 `GetActorLocation`**，也是有理由的：很多 Actor 的原点在脚底或者角落（比如一扇门的原点在合页上），用包围盒中心更接近"这个东西看起来在哪"。

## 5.4 权重配比会让背后的物体胜出

现在配的是 `DistanceToWeightScale = 2.0`、`DirectionWeightScale = 1.0`——**距离项的量级是方向项的两倍。**

再加上 `NormalizedDotResult` 把正后方映射成 0 分而不是排除，会算出一个很尴尬的结果。设 `R` 为交互半径：

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

**背后那个赢了。**

玩家正对着一扇门，脚边有个身后的箱子，按 E 结果开了箱子——这是会被玩家骂的那种 bug，而且极难自己复现，因为你测试时总是面朝目标站着。

**临界条件**可以算出来：当前方物体距离为 `d_f`、后方物体距离为 `d_b` 时，后方获胜的条件是

```text
d_f² − d_b² > 0.5 R²
```

也就是说，**正前方 `0.8R` 的物体，会输给正后方任何近于 `0.374R` 的物体。**

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

我倾向**方案一**，因为它表达的是硬约束——"背后的东西不该能交互"是规则，不是偏好。权重只应该用来在**合法候选之间**做细分。两个方案也可以叠加使用。

## 5.5 平方距离：省了开方，也换了曲线

注意 `DistSquared` 存的是 `SizeSquared()`，除以 `RadiusSquared` 得到的是 `(d/R)²`：

```text
NormalizedDistanceTo = 1 − (d/R)²
```

**省掉了一次开方**（`Size()` 内部要算 `sqrt`，在每帧遍历里值得省），但**衰减曲线的形状变了**：

| 实际距离 | 平方版得分 | 线性版得分 |
|---|---|---|
| `0.25R` | 0.94 | 0.75 |
| `0.50R` | 0.75 | 0.50 |
| `0.75R` | 0.44 | 0.25 |
| `1.00R` | 0.00 | 0.00 |

平方版**近半程区分度低、远半程掉得快**。对交互来说这未必不好——近处的东西"都算够得着"，远处的迅速失去竞争力，其实挺符合直觉。

但你得知道自己在用哪条曲线。想要线性就改成：

```cpp
float NormalizedDistanceTo = 1.0f - ((Origin - Center).Size() / InteractionRadius);
```

## 5.6 NormalizedDistanceTo 可能是负的

这是一个真实的边界 bug：

**重叠检测是拿 Actor 的碰撞体去测的，而距离算的是 `GetActorBounds` 返回的包围盒中心。** 这两者可以差很远。

一个体积很大的 Actor（长桌、大门、平台）碰撞边缘伸进球里了，但包围盒中心可能在 `1.5R` 之外。此时：

```text
NormalizedDistanceTo = 1 − 1.5² = −1.25    × 2.0 = −2.5
方向项最高也只有 1.0
总分 ≤ −1.5
```

而 `HighestWeight` 初始化成 `0.0f`——**负分的候选永远选不中**，哪怕你正贴着那扇门。

修法一行：

```cpp
float NormalizedDistanceTo = FMath::Clamp(1.0f - (DistSquared / RadiusSquared), 0.f, 1.f);
```

> **这类 bug 的共同特征：两个数据来自不同的来源，你默认它们一致。** 重叠检测用碰撞体，评分用包围盒——写的时候完全没意识到这是两套几何。排查思路：**凡是"用 A 筛出来、用 B 打分"的地方，都要问一句 A 和 B 是不是同一个东西。**

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

`RadiusSquared` 和 `PC->GetControlRotation().Vector()` 在整个循环里是常量，应该提到循环外。这是 `TickComponent` 里每帧跑的代码。

**这和之前几次出现的问题是同一类：逻辑本身写对了，但放在了比它该在的地方更深一层。** 第三章是调试绘制掉进算法循环里，这次是循环不变量掉进循环里，第三节的 CVar 读取则是放对了（读一次用多次）。

我给自己定的固定动作：**写完循环先扫一遍循环体，逐行问"这一行的结果每次迭代会变吗"。** 不变的一律往外提。

改完是这样：

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

这一行的含义是：**这个组件从此只能挂在 `APlayerController` 上。**

- 挂到 `AAIController` 或角色身上，Development 构建下直接断言崩溃
- **Shipping 下更糟**——`CastChecked` 不做校验，直接 `static_cast`，你会拿到一个野指针，然后在某个完全无关的地方崩溃

如果你确定这个组件永远只服务玩家，那没问题，但**值得在头文件里写一行注释把这个前提说清楚**。如果将来想让 AI 也用"选择最近的可交互目标"（比如同伴 NPC 自动捡东西），这里得换成 `Cast` + 判空。

> `CastChecked` 和 `Cast` 的选择标准：**`CastChecked` 表达的是"这里不可能不是这个类型，如果不是就是我的设计出了 bug"**，`Cast` 表达的是"这里可能是也可能不是，我会处理两种情况"。别因为"不想写判空"就用 `CastChecked`。

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

把这一章浓缩成五句话：

1. **优化是还债，不是加功能**——本章五项优化里有四项能追溯到第三章为了"先跑通"取的捷径。
2. **碰撞响应取两边中较弱的一方**——胶囊体主动放行，子弹才能进去打到 Mesh。这是整章最需要背下来的一条规则。
3. **预测性判定要用被预测行为的通道**——瞄准射线预测子弹，就用子弹的通道，否则准星和弹道会两套判定。
4. **调试能力也是产品的一部分**——CVar 开关和可调权重不会出现在成品里，但它们决定了你后面几十小时的迭代速度。
5. **归一化之后再加权**——两项都压到 `[0, 1]`，权重才是可读的"重要性倍数"，而不是一串没法解释的小数。

关于分层，再浓缩成三条：

1. **读取属于外层，使用属于内层**——CVar 值和循环不变量都该在循环外取一次。
2. **两个基准点各司其职**——"够得着"用身体位置，"在看谁"用相机位置。
3. **检查必须发生在最后一次修改之后**——弹簧臂先加 `SocketOffset` 再做扫描，顺序反了防穿墙就白做。

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

**优先级最高，因为这是本章唯一会被玩家直接察觉的逻辑错误。**

```cpp
if (DotResult < 0.f) { continue; }
```

见 5.4。加一行就解决。

## ② `NormalizedDistanceTo` 加钳制

```cpp
float NormalizedDistanceTo = FMath::Clamp(1.0f - (DistSquared / RadiusSquared), 0.f, 1.f);
```

见 5.6。同样是一行的事，但不加就会有"大门贴着也交互不了"的诡异现象。

## ③ 验证并修复子弹自撞

跑 4.7 里那两个测试。如果复现，在抛射物里加：

```cpp
SphereComp->IgnoreActorWhenMoving(GetInstigator(), true);
```

## ④ 补一条枪口→目标点的验证射线

见 4.6 场景一。至少让掩体后开火时的特效位置和实际一致。

## ⑤ 两个 CVar 加 `static`，统一成 float 型

第三节的 bool 版改成 float 版，和第四节保持一致。顺便把 `"Eable"` 改成 `"Enable"`。

## ⑥ 编译裁剪补上 `UE_BUILD_TEST`

```cpp
#if !(UE_BUILD_SHIPPING || UE_BUILD_TEST)
```

见 3.3，Epic 官方推荐写法。

## ⑦ 循环不变量提到循环外

`RadiusSquared`、`ControlVector`。见 5.7。

## ⑧ 命名清理

`TranceEnd` → `TraceEnd`，`FAdjustLocation` → `AdjustedLocation`，`DistanceTo` → `DistSquared`，`BoxExtend` → `BoxExtent`，`SelectedActor` / `BestActor` 统一。

## ⑨ 魔数提取为属性

`5000.f`（瞄准射线长度）提成 `EditDefaultsOnly` 属性，和本章刚做的权重属性放同一个 Category。

## ⑩ CVar 前缀改为项目专属

`game.` → 更短的项目前缀，避免和引擎自带变量在自动补全里混淆。**注意这会让已经写进 ini 的旧名字失效**，趁引用点少的时候改。

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
- [Tom Looman：Unreal Engine UPROPERTY Specifiers](https://tomlooman.com/unreal-engine-uproperty-specifiers/)
