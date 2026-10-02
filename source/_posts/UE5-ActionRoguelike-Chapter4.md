---
title: UE5 C++ 第四章复盘：第一次用蓝图，以及 C++ 与蓝图的分工边界
date: 2026-08-12 13:00:00
categories:
  - [课外, 游戏开发, UE5-Looman]
tags:
  - C++
  - ActionRoguelike
  - 蓝图与反射
  - 委托与事件分发
  - 接口
description: 第四章是从「用纯 C++ 搭建骨架」转向「C++ 与蓝图协作」的转折点。本篇完整梳理这一章的四节课，内容包括什么时候应该在蓝图里创建组件、BlueprintImplementableEvent 与 BlueprintNativeEvent 的调用方向、接口为什么必须用 Execute_ 来调用、Parent 节点为什么不能省略、事件分发器怎样让拉杆和爆炸桶解耦，以及 SpawnActor 的几个隐藏参数，并重点解释每一次报错的成因和排查思路。
cover: /img/covers/UE5-ActionRoguelike-Chapter4.svg
series: UE5 ActionRoguelike
privacy: protected
sitemap: false
private_section: 课外
---

# 前言

本文是 Tom Looman《UE5 C++》第四章 **Blueprint Scripting** 的完整复盘。

本章使用的开发环境如下：

- Unreal Engine `5.6.1`
- Rider
- Visual Studio 2022 Build Tools / MSVC 编译工具链
- 项目名称：`ActionRoguelike`

**这一章和前三章有本质的区别。** 前三章都是在纯 C++ 里搭建骨架，蓝图只用来给资产赋值；而从这一章开始，蓝图第一次真正参与到逻辑中来，包括在编辑器里添加组件、在蓝图里实现 C++ 声明的函数，以及用事件分发器把两个互不认识的 Actor 联系起来。

所以本章学习的其实是一件事，那就是**什么时候不应该写 C++**。

本章的代码量很少，四节课加起来新增的 C++ 代码还不到二十行。难点全在于「这段逻辑应该放在哪里」，以及「两边怎样互相调用」。在用蓝图创建组件和用蓝图实现函数这两件事上，有五个坑，下面会把每一个坑的成因都详细写清楚。

四节课的分工如下：

| 节 | 主题 | 核心产出 |
| --- | --- | --- |
| 第一节 | 蓝图里加组件 | `BlueprintImplementableEvent`、Niagara 特效 |
| 第二节 | 接口的蓝图化 | `BlueprintNativeEvent`、`Execute_` 调用、`Parent` 节点 |
| 第三节 | 事件分发器 | 纯蓝图 Actor、多播委托、关卡蓝图 |
| 第四节 | 蓝图 Pawn 与生成 | `SpawnActor`、Tick Interval、`BlueprintCallable` |

和前三章一样，这篇文章不只记录点了哪些按钮，还会重点解释下面几个问题：

- 为什么这个东西建在蓝图而不是 C++；
- 两边是怎么互相调用的，每一根连线代表什么；
- 每一次报错的真实成因，以及下次该怎么排查。

---

## 目录

- [第零节：先把分工搞清楚](#第零节：先把分工搞清楚)
- [第一节：在蓝图中添加组件与实现函数](#第一节：在蓝图中添加组件与实现函数)
- [第二节：接口的蓝图化与两次报错](#第二节：接口的蓝图化与两次报错)
- [第三节：事件分发器与关卡蓝图](#第三节：事件分发器与关卡蓝图)
- [第四节：蓝图 Pawn 与投射物生成](#第四节：蓝图-Pawn-与投射物生成)
- [知识链路总览](#知识链路总览)
- [易错点速查表](#易错点速查表)
- [遗留待办](#遗留待办)
- [第四章完成检查清单](#第四章完成检查清单)
- [术语表](#术语表)
- [参考资料](#参考资料)

---

# 第零节：先把分工搞清楚

这一节课程里没有，是额外补充的。学完第一节之后，最容易让人困惑的就是这个问题，**明明什么都可以在 C++ 里写，为什么突然要跑到编辑器里去点鼠标？**

先把这个问题回答清楚，后面的四节才不会变成单纯地「跟着老师点按钮」。

## 0.1 痛点：C++ 引用资产很难受

假设宝箱打开时要播放一个粒子特效，用纯 C++ 来写，只有两种做法：

```cpp
// 路线一：硬编码资产路径
static ConstructorHelpers::FObjectFinder<UNiagaraSystem> EffectAsset(
    TEXT("/Game/FX/NS_TreasureBurst.NS_TreasureBurst"));
TreasureBurstEffect = EffectAsset.Object;
```

这种做法的问题在于，美术人员只要把文件改个名，或者挪到别的文件夹，这一行代码就会出错，而且要到**运行时**才能发现。

```cpp
// 路线二：留个空指针等人填
UPROPERTY(EditDefaultsOnly, Category = "Effects")
TObjectPtr<UNiagaraSystem> TreasureBurstEffect;
```

这种做法要好一些，但仍然有代价。如果策划想把「一个粒子」改成「两个粒子加上一次震屏和一个音效」，就得来找程序员添加字段、修改代码，然后重新编译。

而在蓝图里，美术人员自己拖入一个组件、选择一个资产，几秒钟就能完成，既不需要编译，也不需要程序员在场。

## 0.2 结论：C++ 定"能力和规则"，蓝图填"数据和表现"

![C++ 与蓝图的分工决策树](/img/posts/ue5-ch4/ue5-ch4-split.svg)

以宝箱为例：

- **由 C++ 决定的是**，宝箱可以被交互，交互之后盖子会在 2.4 秒内转到 120 度，转完之后会发出一个通知；
- **由蓝图决定的是**，使用哪个网格体，盖子转完之后播放哪个粒子和哪个音效，以及金币堆摆放在什么位置。

判断一个组件应该建在哪里，标准只有一条，那就是 **C++ 代码里需不需要有一个指向它的指针**。

| | 建在 C++ | 建在蓝图 |
|---|---|---|
| 判断依据 | 有代码要操作它 | 纯表现，代码不碰 |
| 建立方式 | `CreateDefaultSubobject` + `UPROPERTY` | 编辑器里点"添加" |
| 本章实例 | `BaseMeshComp`、`LidMeshComp` | `TreasurePileComp`、`TreasureBurstEffectComp` |
| C++ 能否访问 | 能，直接用指针 | **不能** |

`LidMeshComp` 必须建在 C++ 里，因为 `Tick` 里有 `LidMeshComponent->SetRelativeRotation(...)` 这样的代码要操作它；而 `TreasureBurstEffectComp` 只需要在某个时刻被 `Activate` 一下，这个 `Activate` 完全可以在蓝图里完成，所以 C++ 没有必要知道它的存在。

> 这里有一个重要的单向关系，**在蓝图里添加的组件，C++ 是看不到的**。理论上，可以在运行时用 `FindComponentByClass` 或者 `GetComponentsByTag` 把它搜出来，但那是靠类型和字符串去猜。一旦组件被删除或者改了名，编译器不会报错，只会在运行时静默地返回 `nullptr`。所以这属于「能用，但不应该用」的手段。

## 0.3 支撑这一切的是反射系统

蓝图凭什么能「看见」C++ 里的类和函数呢？依靠的是 UE 的反射系统。

![UE 反射系统的工作流程](/img/posts/ue5-ch4/ue5-ch4-reflection.svg)

它的流程是这样的。在编译之前，UHT（Unreal Header Tool）会先扫描一遍头文件，它只识别 `UCLASS()`、`UPROPERTY()` 和 `UFUNCTION()` 这几个宏，并把它们记录的类型信息生成到 `Xxx.generated.h` 里。蓝图虚拟机在运行时查询的就是这份元数据。

**所以没有加宏的东西，在蓝图看来就根本不存在。** 本章所有「在蓝图里搜不到」的报错，首先都应该从这一点开始排查。

---

# 第一节：在蓝图中添加组件与实现函数

这一节的目标很简单，就是在宝箱打开之后，放出一堆金币和一个爆开的粒子特效。但它的实现方式和前三章完全不同，因为**C++ 里一行特效代码都不写**。

## 1.1 组件树最终长这样

```text
BP_ItemChest (自我)
└─ BaseMeshComponent (BaseMeshComp)      ← C++ 创建
   └─ LidMeshComponent (LidMeshComp)     ← C++ 创建
   TreasurePileComp                      ← 蓝图创建
   TreasureBurstEffectComp               ← 蓝图创建
```

前两个组件在细节面板里会标注「在 C++ 中定义」，这意味着**不能在蓝图里删除它们或者给它们改名**，只能修改它们的属性。后两个是纯蓝图组件，可以随意添加和删除。

「一个类的组件分别来自两个地方」，乍一看会觉得很别扭，但对照 0.2 节的判断标准就很清楚了，前两个组件 C++ 需要操作，后两个则不需要。

## 1.2 `BlueprintImplementableEvent`：C++ 声明，蓝图实现

C++ 这一侧只加了两行代码：

```cpp
UFUNCTION(BlueprintImplementableEvent)
void ChestAnimationComplete();
```

**需要注意，这里只有声明，`.cpp` 里没有任何实现。** 这是本节最违反直觉的地方，它是一个「声明了却不用实现」的函数。

### 为什么不能写函数体

UHT 扫描到这个宏之后，会在 `.generated.h` 里**替你生成函数体**，它的内容大致如下：

```text
查找这个函数的 UFunction 元数据
  → 调用 ProcessEvent
  → 把控制权交给蓝图虚拟机
  → 跑蓝图里画的那张图
```

也就是说，这个函数的符号已经存在了。如果再写一份 `void ARogueItemChest::ChestAnimationComplete() {}`，链接器就会看到两个同名的符号，从而报出 duplicate symbol 错误。

**所以 `.cpp` 里不能再写这个函数的实现，写了反而会链接失败。**

### 一个静默的坑

如果**没有任何蓝图实现这个函数**，调用它就会静默地变成一个空操作，既不会崩溃，也不会给出警告，什么都不会发生。

Rider 会在函数声明的旁边显示一行小字提示（比如 `已在 1 个蓝图中实现` 或者 `没有蓝图用法`），这行小字就是一张安全网，值得养成随手看一眼的习惯。

## 1.3 蓝图侧：两个节点搞定

```text
Event ChestAnimationComplete
  → Activate (Target = TreasureBurstEffectComp)
```

蓝图里只需要这两个节点就够了。C++ 手里根本没有 `TreasureBurstEffectComp` 的引用，所以这个 `Activate` **只能**在蓝图里完成。这并不是一种风格上的选择，而是唯一可行的方案。

> **这里必须确认一项设置**，那就是 `TreasureBurstEffectComp` 细节面板里的 `Auto Activate` 要**取消勾选**。否则关卡一加载，宝箱就会自己播放一次特效，等到打开宝箱时，反而因为已经激活过而没有反应。这个 bug 的表现和预期正好相反，所以排查时很容易找错方向。

## 1.4 Tick 里的状态管理：一个容易被忽略的问题

第三章的 `Tick` 是这样写的：

```cpp
void ARogueItemChest::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);
    CurrentAnimationPitch = FMath::FInterpConstantTo(
        CurrentAnimationPitch, AnimationTargetPitch, DeltaTime, AnimationSpeed);
    LidMeshComponent->SetRelativeRotation(FRotator(CurrentAnimationPitch, 0.f, 0.f));

    if (FMath::IsNearlyEqual(CurrentAnimationPitch, AnimationTargetPitch))
    {
        SetActorTickEnabled(false);
        ChestAnimationComplete();
    }
}
```

它现在能够正常工作，但它依赖于一个巧合，那就是**宝箱是一次性的，打开之后就不会再关上**。

问题在于，`SetActorTickEnabled(false)` 本来是一个**性能开关**，而这里却把它当成了**状态记录**来使用。也就是说，「动画有没有播放完」这个语义上的信息，被编码进了「Tick 有没有开启」里。而这两件事的生命周期迟早会分开：

- 如果想做一个可以打开也可以关上的宝箱，就需要重新开启 Tick，这样状态就丢失了；
- 如果想添加别的 Tick 逻辑（比如漂浮或者发光呼吸效果），一旦关闭 Tick，这些效果就会全部停止。

正确的做法是把这两件事分开：

```cpp
// .h
bool bAnimationCompleted = false;

// .cpp
if (!bAnimationCompleted && FMath::IsNearlyEqual(CurrentAnimationPitch, AnimationTargetPitch))
{
    bAnimationCompleted = true;      // 语义
    SetActorTickEnabled(false);      // 性能
    ChestAnimationComplete();
}
```

### 还有一个初始帧的问题

宝箱刚刚放进关卡、还没有被交互时，`CurrentAnimationPitch` 和 `AnimationTargetPitch` 都是 0，所以 `IsNearlyEqual` **在第一帧就为真**。于是关卡一加载，每个宝箱都会关闭自己的 Tick，并触发一次 `ChestAnimationComplete()`。

这个问题之所以一直没有暴露出来，是因为 `Interact_Implementation()` 里的 `SetActorTickEnabled(true)` 正好把 Tick 重新打开了。但更干净的做法是在构造函数里加上：

```cpp
PrimaryActorTick.bStartWithTickEnabled = false;
```

这样还能顺便省掉所有尚未打开的宝箱每一帧的开销。

> 这里顺便说一下插值函数的选择。`FInterpConstantTo` 是匀速逼近，内部会限制到目标值，所以能精确地到达目标；而 `FInterpTo` 是指数逼近，速度会随着距离的减小而衰减，**理论上永远也到达不了目标**，只能依靠 `IsNearlyEqual` 的容差来兜底，所以收尾的过程会拖得很久。像开箱这种要求「确定地结束」的动画，使用匀速插值才是正确的选择。代价是没有缓入缓出的效果，看起来有些机械。如果真的需要好的手感，可以使用 Timeline（蓝图），或者 `UCurveFloat`（在 C++ 里暴露一条曲线资产），这又是一次「C++ 定义规则、蓝图填写数据」。

---

# 第二节：接口的蓝图化与两次报错

这一节要给宝箱加上开箱的音效。目标听起来很简单，但实际上把第三章的接口整个重构了一遍，中间还接连报了两次错。

## 2.1 三个说明符的调用方向

先把三个概念区分清楚，这是本章最容易混淆的地方：

![三种 UFUNCTION 说明符的调用方向](/img/posts/ue5-ch4/ue5-ch4-specifiers.svg)

| 说明符 | 方向 | C++ 要不要写实现 | 蓝图能不能改 |
|---|---|---|---|
| `BlueprintCallable` | 蓝图 → C++ | **必须写** | 不能，只能调用 |
| `BlueprintImplementableEvent` | C++ → 蓝图 | **不能写** | 唯一实现就在蓝图 |
| `BlueprintNativeEvent` | C++ → 蓝图 | 写 `_Implementation` | 可选覆盖 |

这三种说明符本章全都用到了，`ChestAnimationComplete` 属于第二种，`Interact` 属于第三种，第四节的 `Explode` 属于第一种。

另外还有一个纯计算的版本 `BlueprintPure`。它没有执行引脚，**从它连出去的每一根线都会重新求值一次**，所以不要在里面做耗时的操作。

## 2.2 接口升级为 `BlueprintNativeEvent`

```cpp
// RogueInteractionInterface.h
UFUNCTION(BlueprintNativeEvent)
void Interact();
```

```cpp
// RogueItemChest.h
public:
    virtual void Interact_Implementation() override;
```

```cpp
// RogueItemChest.cpp
void ARogueItemChest::Interact_Implementation()
{
    SetActorTickEnabled(true);
}
```

修改之后，`Interact` 就从「C++ 的纯虚函数」变成了「注册到反射系统里的 `UFunction`」。这个变化会连带影响到调用它的地方，于是就有了第一次报错。

## 2.3 报错一：为什么必须用 `Execute_Interact`

原来的调用代码是这样的：

```cpp
// 报错版本
IRogueInteractionInterface* InteractInterface = Cast<IRogueInteractionInterface>(SelectedActor);
if (InteractInterface)
{
    InteractInterface->Interact();
}
```

需要改成：

```cpp
IRogueInteractionInterface::Execute_Interact(SelectedActor);
```

![Execute_Interact 的反射路由与 Parent 节点](/img/posts/ue5-ch4/ue5-ch4-execute.svg)

### 两条路的区别

`Cast<IRogueInteractionInterface>(Actor)` 得到的是 **C++ 的接口指针**，调用时走的是 C++ 的虚函数表。这条路有一个根本性的盲区：

如果某个类是用**纯蓝图**实现这个接口的（在 Class Settings 里勾选了接口，但没有对应的 C++ 父类），那么它的 C++ 虚函数表里根本就没有这个接口，`Cast` 会返回 `nullptr`，`if` 语句会被静默地跳过，什么都不会发生，而且也不会报错。

而 `Execute_Interact(Obj)` 走的是**反射的路径**。它会先查询这个对象的 `UClass` 元数据，找到对应的 `UFunction`，再判断是蓝图重写了这个函数，还是应该执行 C++ 的 `_Implementation`。所以两种实现方式都能被正确地调用。

可以这样来记，**接口函数一旦带上了 `BlueprintNativeEvent` 或者 `BlueprintImplementableEvent`，就必须用 `Execute_` 来调用**。如果直接调用 `->Interact()`，就绕过了反射系统，蓝图的重写从此就失效了。

这一点在第三节马上就会得到验证。`BP_Lever` 是一个纯蓝图 Actor，如果还使用 `Cast`，拉杆就永远不会有反应。

## 2.4 报错二：有声音但没动画

修改完调用方式之后，编译通过了，但是进入游戏后，**能听到音效，盖子却不动**。

原因在于，`BlueprintNativeEvent` 的含义是「由 C++ 提供默认实现，蓝图**可以选择**覆盖它」。需要注意的是，这里是**覆盖**，而不是**追加**。

蓝图里一旦画了 `Event Interact`，C++ 的 `Interact_Implementation()` 就**完全不会执行了**。所以里面那句 `SetActorTickEnabled(true)` 从来没有运行过，盖子也就纹丝不动。

解决办法是在蓝图里补上一个 `Parent: Interact` 节点：

```text
Event Interact → Parent: Interact → Play Sound at Location
```

这个节点等价于 C++ 里的 `Super::Interact_Implementation()`。这和重写虚函数时忘记调用 `Super::` 是同一类错误，区别在于**蓝图不会给出任何警告**。

> 所以最好养成一个习惯，只要在蓝图里重写 `BlueprintNativeEvent`，第一件事就是右键选择 `Add Call to Parent Function`，之后再决定要不要把它删掉。

## 2.5 一个课程里没提的 bug：狂按 E 会重复触发

功能跑通之后，如果一直按 E，音效和粒子就会一直重复播放。课程原版的代码也是这样的行为，因为教程通常不做状态管理，否则会冲淡当节的教学重点。

有意思的是，这个 bug 有**两条完全独立的成因**。

### 路径一：音效

蓝图里的逻辑是 `Event Interact → Play Sound`，中间没有任何条件判断。所以每按一次 E，就会执行一遍这张图，播放一次音效。原因纯粹是没有写守卫条件。

### 路径二：粒子

这一条路径绕了一个圈子：

```text
按 E → Interact_Implementation() → SetActorTickEnabled(true)
  → 下一帧 Tick：CurrentAnimationPitch 已经等于 AnimationTargetPitch
  → FInterpConstantTo 原地不动，IsNearlyEqual 立刻为真
  → SetActorTickEnabled(false) + ChestAnimationComplete()
  → Niagara 重新 Activate
```

每按一次 E，动画系统就会「空跑一帧，然后宣布自己又完成了一次」。这正是 1.4 节那个问题的另一种表现形式，因为 **`SetActorTickEnabled` 无法记录「已经打开过了」这个语义**。

### 关键陷阱：C++ 里的 return 拦不住蓝图

第一反应是这样修改：

```cpp
void ARogueItemChest::Interact_Implementation()
{
    if (bChestOpened) { return; }
    bChestOpened = true;
    SetActorTickEnabled(true);
}
```

**这样修改之后，粒子确实不会重复播放了，但音效仍然每次都会播放。**

这是因为蓝图里的执行流是 `Event Interact → Parent: Interact → Play Sound`。`Parent: Interact` 只是调用了一次父类的实现，即使父类里 `return` 了，控制权也照样会回到蓝图，执行引脚会继续往右走，一直走到 `Play Sound`。

**也就是说，C++ 里的 `return` 管不到调用方后面的节点。** 这就好比 `Super::Foo()` 提前返回了，也不会影响在 `Foo()` 里调用 `Super::Foo()` 之后写的代码。

所以修复的关键是解决「蓝图这一侧怎样知道该不该播放音效」的问题，有以下三个方向。

**方案 A：把状态暴露给蓝图（本文最终采用的方案）**

```cpp
UPROPERTY(BlueprintReadOnly, Category = "Chest")
bool bChestOpened = false;
```

在蓝图里的连线是 `Event Interact → Branch (NOT bChestOpened) → True → Parent: Interact → Play Sound`。

这里的关键是 `BlueprintReadOnly`，它让蓝图只能读取这个值，而不能修改它。**「宝箱有没有打开」这个事实始终由 C++ 独自掌握**，蓝图只是使用者。一旦让蓝图自己来维护这个 bool 值，C++ 就无法再信任自己的动画状态了。

需要注意，Branch 必须放在 `Parent: Interact` 的**前面**。否则父类已经把标志位设成了 `true`，判断的就是修改之后的值，于是永远也进不了 True 分支。

C++ 里的那层 `if (bChestOpened) return;` 也不要省略。因为蓝图里的 Branch 只能挡住来自蓝图的这一条调用路径，如果将来有别的 C++ 代码直接调用 `Interact`，C++ 里的这道检查才是最后一道防线。所以这里需要**两层守卫**。

**方案 B：把音效挪到 `ChestAnimationComplete` 里**

那里已经有了 C++ 的状态保护。开箱的音效和爆出金币的粒子，本来就都是「开箱成功」这一时刻的表现。这种做法的代价是，音效要等到动画播放完才会响起，按下 E 的那一瞬间没有任何反馈，手感会显得迟钝。实际项目中更常见的做法，是把音效拆成两个，开始时一声「咔哒」，结束时一声「哗啦」。

**方案 C：改成可以打开也可以关上的宝箱**

也就是把 `bChestOpened` 改成 `bChestOpened = !bChestOpened`，让 `AnimationTargetPitch` 在 0 和 120 之间切换，每次交互时都重新开启 Tick。这样一来，「重复触发」就不再是一个 bug，而变成了一项功能。

## 2.6 踩坑记录：`bChestOpened` 在蓝图里搜不到

这个坑很容易让人卡上很久，值得单独写出来，因为**所有常规的排查手段都会失效**。

它的现象是这样的。C++ 里已经写好了 `UPROPERTY(BlueprintReadOnly)`，也完整地重新编译了，父类的继承关系正确，`protected` 的访问级别也没有问题，但是在蓝图里搜索 `bChestOpened` 时，**什么也搜不到**。

按照标准流程把所有可能的原因都检查一遍：

- ✅ 关掉编辑器，Rider 里完整 Build，重开
- ✅ 取消"情境关联"勾选再搜
- ✅ 确认 `BP_ItemChest` 的父类是 `Rogue Item Chest`
- ✅ 确认是 `protected` 不是 `private`
- ✅ 确认 `UPROPERTY` 宏在类体内部

结果全都没有问题，但就是搜不到。

**真正的原因在于，UE 的反射系统对布尔变量有一条特殊的规则，在显示时会自动去掉开头的小写字母 `b`。**

所以 `bChestOpened` 在蓝图里显示为 **`Chest Opened`**，而蓝图的搜索框匹配的是**显示名**，并不是 C++ 里真实的变量名。所以搜索 `bChestOpened` 是永远也搜不到的。

这条规则只对 `bool` 类型有效，而且只会去掉小写的 `b`：

| C++ 变量名 | 蓝图显示名 |
|---|---|
| `bChestOpened` | `Chest Opened` |
| `bIsDead` | `Is Dead` |
| `AnimationTargetPitch` | `Animation Target Pitch` |
| `BaseMeshComponent` | `Base Mesh Component` |

非 bool 类型的变量只是在单词之间加上了空格，改动不大，仍然认得出来；唯独 bool 类型少了一个字母，搜索时就直接匹配不上了。

反过来说，这也解释了**为什么 UE 强制要求 bool 类型的变量使用 `b` 作为前缀**。因为引擎知道开发者会加上这个前缀，所以在显示时替开发者去掉它，最终呈现给策划和美术人员的就是干净的 `Chest Opened`。命名规范和显示系统是相互配套设计的。

> 还有一个更省事的办法。在左侧的 My Blueprint 面板中点击齿轮菜单，勾选 `Show Inherited Variables`，从父类继承来的变量就会全部列出来，直接把它拖进图表就是一个 Get 节点，不需要去猜名字。以后再遇到「C++ 里明明有，蓝图里却搜不到」的情况，先到这里看一眼，会比在搜索框里尝试各种拼写快得多。

**只需要记住一条，C++ 里的变量名不等于蓝图里的显示名。**

## 2.7 踩坑记录：Branch 接错引脚

连好线之后运行，宝箱**完全打不开了**。

原因很简单，但也很典型，那就是 `Parent: Interact` 接在了 Branch 的 `False` 引脚上，而 `True` 引脚是空的。

```text
NOT bChestOpened = NOT false = true
  → 走 True 分支
  → True 引脚是空的
  → 执行流到此为止，什么都不发生
```

Branch 的两个引脚在视觉上离得很近，拖线时手一抖就会接到下面那一格去。而且**蓝图并不会报错**，因为空的执行引脚是完全合法的，引擎会认为就是想让这个分支什么都不做。

> 调试蓝图的核心手段是，当逻辑「完全没有反应」时，点击 Play，然后回到蓝图窗口，看看节点上有没有**橙色的执行流高亮**。执行流在哪里断开了，一眼就能看出来，比盯着连线去找要快得多。蓝图没有断点单步调试，但它有实时的执行流可视化，这是它相对于 C++ 唯一的调试优势。

---

# 第三节：事件分发器与关卡蓝图

这一节要制作一个拉杆，拉一下就能引爆场景里的两个桶。这一节的目标是学习**事件分发器**，它是 UE 里第一个真正用来解耦的工具。

## 3.1 `BP_Lever`：一个纯蓝图 Actor

这一节的拉杆**没有对应的 C++ 类**，而是直接从 `Actor` 派生出一个蓝图。它的组件、逻辑和接口实现全都在蓝图里：

```text
BP_Lever (父类：Actor)
├─ SwitchBaseMeshComp
│  └─ SwitchHandleMeshComp
└─ Sphere（碰撞体，供交互检测捞到）
```

在 Class Settings 的「已实现的接口」里添加 `Rogue Interaction Interface`，就可以在蓝图里画出 `Event Interact` 节点了。

**这正好验证了 2.3 节的内容。** 如果交互组件仍然使用 `Cast<IRogueInteractionInterface>`，由于这个纯蓝图 Actor 的 C++ 虚函数表里没有这个接口，`Cast` 会返回 `nullptr`，拉杆也就永远不会有反应。而现在已经改成了 `Execute_Interact`，走的是反射的路由，所以纯蓝图的实现也能被正确地调用。

> 关于碰撞设置，Sphere 组件要使用第三章创建的 `Interaction` 碰撞预设（对象类型是 `WorldDynamic`，对 `Interaction` 通道的响应设为重叠），否则交互组件的球体查询就捞不到它。

## 3.2 事件分发器 = C++ 的多播委托

在 My Blueprint 面板的「事件分发器」里添加一个 `OnHandlePulled`，然后在 `Event Interact` 的后面连接一个 `Call On Handle Pulled` 节点。

它们之间的对应关系如下：

| 角色 | C++ 对应 | 蓝图里的操作 |
|---|---|---|
| 声明 | `DECLARE_DYNAMIC_MULTICAST_DELEGATE` | 事件分发器面板里加 `OnHandlePulled` |
| 广播 | `OnHandlePulled.Broadcast()` | `Call On Handle Pulled` 节点 |
| 订阅 | `OnHandlePulled.AddDynamic(...)` | `Bind Event to On Handle Pulled` 节点 |

**这里的关键在于，`BP_Lever` 从头到尾都不知道有桶的存在。** 它只负责喊一声「我被拉动了」，至于谁来听、听到之后做什么，全都在别处决定。

以后如果想让拉杆去开门、开灯或者播放音乐，只需要修改订阅的一方，拉杆本身一行都不用改，这就是解耦的价值。

## 3.3 关卡蓝图里那三根线

这张图乍一看很难看懂，因为三根线的含义完全不同。

![事件分发器的登记与广播两个阶段](/img/posts/ue5-ch4/ue5-ch4-dispatcher.svg)

`Bind Event to On Handle Pulled` 节点有三个输入：

| 线 | 从哪来 | 语义 |
|---|---|---|
| **白线** | `Event BeginPlay` | 什么时候登记 |
| **蓝线** | `BP_Lever`（从持久关卡） | 登记到谁的名单上 |
| **红线** | `OnHandlePulled_事件`（Custom Event） | 交上哪个函数 |

红线的颜色之所以不一样，是因为它传递的既不是执行流，也不是普通的数据，而是一个**函数引用**，相当于 C++ 里的 `&AMyClass::MyFunc`。

### 最容易卡住的一点

**`Bind` 执行完的那一刻，`OnHandlePulled_事件` 并不会运行**，它只是被登记进了名单。它真正运行的时机，是拉杆被交互、`Broadcast` 发生的那一瞬间。

所以 Custom Event 的那条支线看起来和 BeginPlay 是「断开」的，但这并不是画错了，**因为它本来就不是由执行流驱动的，而是被回调唤醒的**。

### 为什么必须在 BeginPlay

登记必须早于广播。BeginPlay 是关卡里所有的 Actor 都已经生成、而玩家还没来得及操作的时刻，所以它是进行登记的标准时机。

如果把登记放在别的地方（比如某次交互之后），拉杆可能已经喊过一次，而名单还是空的，那一次广播就白喊了。

## 3.4 `Explode` 暴露给蓝图

爆炸桶的爆炸逻辑在 Assignment 1 里就已经写好了，这里只需要加上一个宏：

```cpp
UFUNCTION(BlueprintCallable)
void Explode();
```

需要注意，它和 `Interact` 的调用方向**完全相反**：

- `BlueprintCallable` 是**由蓝图调用 C++**，实现写在 C++ 里，蓝图只是调用的发起方；
- `BlueprintNativeEvent` 是**由 C++ 调用蓝图**，蓝图可以改写它的行为。

这一节把这两种都用到了，正好可以对照着来记。

> Rider 会在函数旁边提示「没有蓝图用法」，这是因为刚刚加上宏，还没有在任何蓝图里使用它。等到关卡蓝图用上它之后，重新扫描一遍，这条提示就消失了。

## 3.5 一个关于多连线的常见误解

把两个桶的引用都连到同一个 `Explode` 节点的 `Target` 引脚上。

按照常识来判断，**蓝图的数据输入引脚只能接一根线**，再拖进第二根线，就会把第一根静默地顶掉，所以应该只有一个桶会爆炸。

但实际测试的结果是，**两个桶都爆炸了**。把两个桶拉开 20 米，排除了「爆炸冲击引发连锁爆炸」的可能之后，结果仍然是两个桶一起飞上了天。

所以在这种情况下，对象引用类型的输入引脚确实接受了多根连线，引擎会对连上来的每一个 Target 分别调用一次。这和纯数据类型的引脚（比如 `float` 和 `bool`，它们确实只能接一根线）的行为是不同的。

> **不过仍然建议把它们串联成两个 `Explode` 节点。** 这并不是因为多根连线不起作用，而是因为**多根连线时，调用的顺序是没有保证的**。现在两个桶谁先爆炸都无所谓，但如果要做「先炸 A，A 的冲击把 B 顶起来，再炸 B」这种有先后顺序的效果，多根连线就不可靠了，而串联的执行顺序是明确的。
>
> 如果桶的数量很多，可以换成 `Make Array` → `ForEachLoop` → `Explode` 的写法。

## 3.6 关卡蓝图的特权与代价

那些标注着「从持久关卡」的节点，是**关卡蓝图独有的能力**，它可以直接引用摆放在关卡里的**具体实例**。

普通的蓝图类是做不到这一点的。`BP_Lever` 是一个模板，它并不知道自己会被摆放在哪一关，也不知道旁边有什么，所以无法在编辑时直接引用某一个具体的桶。

这样做的代价是，这套逻辑被**固定在了这一关里**。换一个关卡，拉杆还是拉杆，桶也还是桶，但所有的连线都得重新画一遍。

**判断的标准是，这段逻辑是「这一关的剧本」，还是「这一类物体的通用行为」？**

作为教学演示，把「拉杆炸桶」放在关卡蓝图里没有问题；但在真正的项目中，「拉杆触发某一组目标」这种可以复用的逻辑，应该做成 `TArray<AActor*>`，暴露在拉杆类上，然后在关卡里拖拽指定目标就可以了。

---

# 第四节：蓝图 Pawn 与投射物生成

最后一节把前面的内容串联了起来，拉一下拉杆，一座炮台就开始每隔 0.5 秒发射一枚投射物。

## 4.1 `BP_ProjectileSpammer`：又一个纯蓝图类

它从 `Pawn` 派生而来，组件树如下：

```text
BP_ProjectileSpammer (父类：Pawn)
└─ DefaultSceneRoot
   └─ Arrow
```

蓝图逻辑是 `Event Tick → SpawnActor BP Magic Projectile`，各个参数如下：

| 引脚 | 连什么 | 作用 |
|---|---|---|
| `Class` | `BP_MagicProjectile` | 生成什么 |
| `Spawn Transform` | `Arrow` 的 `Get World Transform` | 在哪生成、朝哪 |
| `Instigator` | `Self` | **伤害归属** |

## 4.2 `Arrow` 组件：让美术决定发射口

`UArrowComponent` 在游戏里是不可见的，它纯粹是一个「朝向标记」。它的作用是让开发者在编辑器里**可视化地摆好发射口的位置和方向**，代码直接获取它的世界变换即可。

和它对比一下硬编码的写法：

```cpp
// 偏移量写死在代码里，改一次要重编译
FVector SpawnLoc = GetActorLocation() + GetActorForwardVector() * 100.f;
```

如果使用 `Arrow`，美术人员只需要在视口里拖动一下箭头就可以了。**这又是一次「C++ 定义规则、编辑器填写数据」。**

## 4.3 `Instigator` 连 `Self` 不是可选项

这个引脚很容易被忽略，但它决定了**伤害的归属**。投射物打中目标时，伤害系统会顺着 `Instigator` 往上追溯责任方。

连上 `Self` 之后，会有下面这些效果：

- 投射物不会误伤发射者自己（很多伤害逻辑都会检查 `Instigator == DamagedActor`）；
- 击杀统计和仇恨系统能够正确地归因；
- 玩家被打死时，死亡提示能显示「被 XX 击杀」。

如果不连，伤害的来源就是 `nullptr`，上面这些功能就全部失效了，**而且不会报错**。这属于那种「程序能运行，但半年后做击杀播报时才发现全是空白」的坑。

## 4.4 `Tick 间隔 = 0.5` 是个被低估的功能

在细节面板的 `Actor Tick` 里，把 `Tick间隔（秒）` 设为 `0.5`，这比在 Tick 里累加 `DeltaTime`、攒够 0.5 秒再发射要高明得多。

因为后者每一帧都要执行一次函数调用和浮点数比较；而前者是**引擎在调度的层面就直接跳过了这个 Actor**，中间的那些帧根本不会进入 Tick。

它的代价是精度。实际的间隔会受到帧率的影响而被量化，比如在 60 帧时，每一帧是 16.7ms，所以 0.5 秒会落在 0.5 或者 0.517 上，无法精确到毫秒。

> 这对投射物来说完全够用了。但如果要制作节奏游戏的判定，Tick Interval 的精度是不够的，那就需要使用 `FTimerManager`，或者直接对齐音频时钟。

同时取消勾选 `启用Tick并开始`（也就是 `bStartWithTickEnabled`），让炮台默认不发射。这和宝箱那边是同一种模式，**Tick 默认关闭，需要时再开启**，这是 UE 里标准的性能习惯，因为一个关卡里有几百个 Actor，其中绝大多数在绝大多数时间里都不需要每一帧更新。

## 4.5 `StartSpawning`：蓝图里也能定义函数

在 My Blueprint 面板的「函数」里添加一个 `StartSpawning`，它的内容只有一个节点：

```text
StartSpawning → Set Actor Tick Enabled (Target = self, Enabled = ✓)
```

然后在关卡蓝图里，连接 `OnHandlePulled_事件 → Start Spawning (Target = BP_ProjectileSpammer)`。

> 这里很容易出现一个失误，那就是忘了勾选 `Enabled`。这个选项默认是不勾选的，相当于 `Set Actor Tick Enabled(false)`，结果拉了拉杆，炮台反而更不会动了。这个引脚和 Branch 的 Condition 一样，都属于「默认值恰好不是想要的」那种地方。

那么，为什么要包装一层函数，而不是在关卡蓝图里直接调用 `Set Actor Tick Enabled` 呢？

因为如果那样做，关卡蓝图就得知道「炮台是通过开关 Tick 来控制发射的」，而这属于炮台的**内部实现细节**。如果今天用的是 Tick，明天改成了 Timer，关卡蓝图也就得跟着修改。

包装一层 `StartSpawning` 之后，关卡蓝图只需要知道「这个东西可以开始发射」，至于怎样发射，那是炮台自己的事情。这就是**封装**，和 C++ 里用 public 方法包装 private 成员是同一个道理。

## 4.6 `Collision Handling Override` 值得显式指定

这个下拉框现在的值是「默认」，它决定了**当生成位置被占用时应该怎么办**：

| 选项 | 行为 |
|---|---|
| `Always Spawn, Ignore Collisions` | 无视一切，强行生成 |
| `Try To Adjust Location, But Always Spawn` | 尝试挪开，挪不开也生成 |
| `Try To Adjust Location, Don't Spawn If Still Colliding` | 挪不开就**返回 nullptr** |

其中最后一种最危险，因为它会**静默地失败**，返回一个空值。如果后面接了 `Return Value → 设置什么属性`，就会发生一次空指针访问。

对于投射物，建议明确地选择 `Always Spawn`，不要保留「默认」。

## 4.7 一个设计缺口：`StartSpawning` 只开不关

拉一次拉杆，炮台就会**一直发射下去**，直到关卡结束。

这在教学演示中无关紧要，但它暴露了一个设计上的问题，`OnHandlePulled` 是一个「单向的开关信号」，接收的一方无法知道应该开启还是关闭。

改进的思路有两条：

1. **让委托带上参数**：事件分发器支持带输入参数，可以在细节面板里加一个 `bool`；
2. **由接收方自己维护状态**：每收到一次信号，就把状态取反。

第二种做法更灵活，因为同一个信号可以让 A 开始发射，让 B 停止移动，让 C 切换灯光，由各个接收方自己决定信号的含义。

这也是委托设计中常见的取舍，**信号只说明「发生了什么」，而不规定「你应该做什么」**。

---

# 知识链路总览

![第四章完整链路](/img/posts/ue5-ch4/ue5-ch4-chain.svg)

这两条链路共用第三章建好的交互入口，之后再各自分开：

```text
【宝箱线】
按 E → Execute_Interact
  → 蓝图 Event Interact
  → Branch (NOT bChestOpened)     ← 蓝图侧守卫
  → Parent: Interact              ← 必须连，否则 C++ 不执行
      → C++ if (bChestOpened) return  ← C++ 侧守卫
      → SetActorTickEnabled(true)
  → Play Sound
  → Tick 逐帧插值盖子
  → 到位后 ChestAnimationComplete()
  → 蓝图 Activate 粒子            ← C++ 不知道粒子存在

【拉杆线】
按 E → Execute_Interact
  → BP_Lever 的 Event Interact    ← 纯蓝图实现，Cast 会失败
  → Call On Handle Pulled（广播）
  → 关卡蓝图的 Custom Event（BeginPlay 时已登记）
  → Explode（BlueprintCallable，蓝图调 C++）
  → Start Spawning（纯蓝图函数）
  → Tick Interval 0.5s → SpawnActor
```

把这一章的内容浓缩成三句话：

1. **反射系统是连接两边的桥梁**，没有 `UCLASS`、`UPROPERTY` 和 `UFUNCTION`，蓝图就什么都看不到。
2. **调用的方向决定了使用哪种说明符**，蓝图调用 C++ 时用 `BlueprintCallable`；C++ 调用蓝图时，要看有没有默认实现，分别使用 `BlueprintImplementableEvent` 和 `BlueprintNativeEvent`。
3. **状态归 C++ 管理，表现归蓝图负责**，`bChestOpened` 通过 `BlueprintReadOnly` 单向地暴露给蓝图，蓝图只能读取，不能修改。

---

# 易错点速查表

| 症状 | 最可能的原因 | 检查位置 |
|---|---|---|
| 蓝图里搜不到 C++ 变量 | 改完没编译（存盘 ≠ 编译） | Live Coding / 完整 Build |
| 编译了还是搜不到 bool 变量 | **显示名剥掉了首字母 `b`** | 搜 `Chest Opened` 而非 `bChestOpened` |
| 搜不到且不是 bool | 忘了加 `UPROPERTY` 宏 / 写成了 `private` | 成员声明 |
| 蓝图里完全看不到某个 C++ 成员 | 打开的蓝图父类不对 | 蓝图右上角"父类" |
| 链接错误 duplicate symbol | `BlueprintImplementableEvent` 写了函数体 | `.cpp` |
| C++ 调蓝图函数，什么都不发生 | 没有任何蓝图实现它 | Rider 的"已在 N 个蓝图中实现"提示 |
| 关卡一加载特效就自己播一次 | Niagara 组件 `Auto Activate` 没取消 | 组件细节面板 |
| 蓝图实现的接口完全不响应 | 用了 `Cast<IXxx>` 而非 `Execute_Xxx` | 调用方 |
| 蓝图重写后 C++ 逻辑不执行 | 忘了连 `Parent: Xxx` 节点 | 蓝图 Event 图 |
| 有音效但没动画 | 同上 | 蓝图 Event 图 |
| 逻辑完全没反应，无报错 | 执行引脚接到了 Branch 的错误分支 | Play 时看橙色执行流高亮 |
| C++ 里 return 了但蓝图还在跑 | `return` 只结束父类实现，不影响调用方后续节点 | 状态改用 `BlueprintReadOnly` + Branch |
| 狂按交互键重复触发 | 缺状态守卫（C++ 和蓝图两侧都要） | `Interact_Implementation` + Branch |
| 每次交互都空触发一次完成事件 | 到达判断没有状态位，原地插值立刻为真 | `Tick` |
| 对空气按 E 直接崩溃 | `Execute_Xxx` 内部有 `check()`，不接受 null | 调用前判空 |
| 拉杆没反应 | 碰撞预设不对，交互查询捞不到 | Sphere 组件的碰撞预设 |
| Custom Event 好像没连上 | 委托是被回调唤醒的，不由执行流驱动 | 正常现象 |
| 广播了但没人响应 | 登记晚于广播 | 登记必须在 `BeginPlay` |
| 拉杆后炮台反而不动 | `Set Actor Tick Enabled` 的 `Enabled` 没勾 | 节点默认值 |
| `SpawnActor` 返回 null 后崩溃 | `Collision Handling Override` 选了不生成 | 显式改为 `Always Spawn` |
| 投射物误伤自己 / 击杀播报空白 | `Instigator` 没连 | `SpawnActor` 节点 |

---

# 遗留待办

## ① 第三章结转：`SelectedActor` 空值检查

**这一项的优先级最高，因为它会直接导致崩溃。**

```cpp
IRogueInteractionInterface::Execute_Interact(SelectedActor);
```

`Execute_` 系列函数的内部有两个 `check()`，分别检查对象不为空，以及对象确实实现了这个接口。只要有一个条件不满足，Development 构建就会直接崩溃。

也就是说，**对着空气按下 E 就会导致崩溃**。修改方法如下：

```cpp
if (SelectedActor && SelectedActor->Implements<URogueInteractionInterface>())
{
    IRogueInteractionInterface::Execute_Interact(SelectedActor);
}
```

> 需要注意，`Implements<>` 的模板参数使用的是 **`U` 前缀**（`URogueInteractionInterface`），而不是 `I` 前缀，因为这里传入的是 UClass 类型，第一次写时很容易弄错。

## ② 第三章结转：`SelectedActor` 每帧重置

如果不重置，看向宝箱之后再转头看天空，`SelectedActor` 仍然会指向那个宝箱，于是隔着墙也能打开宝箱。这和 ① 属于同一个问题区域。

## ③ 第三章结转：`GetPawn()` 判空

`TickComponent` 从组件注册时就开始执行了，而 `Possess` 要在之后才进行；另外，角色从死亡到重生之间也存在一段空档期。

## ④ `bAnimationCompleted` 与 Tick 开关解耦

详见 1.4 节。目前是用 `SetActorTickEnabled` 兼职记录状态，宝箱是一次性的时候还能工作，但做成可以打开也可以关上的宝箱时，就会出现遗漏。

## ⑤ 宝箱音效的时机

现在按下 E 时音效会立刻响起，但如果改成方案 C（可以打开也可以关上），就需要区分开箱音和关箱音。更好的做法是拆成两个音效，交互的瞬间播放一声「咔哒」，动画结束时再播放一声「哗啦」。

## ⑥ 关卡蓝图里的 `Explode` 改为串联

详见 3.5 节。多根连线虽然可以工作，但调用的顺序没有保证。

## ⑦ `StartSpawning` 加上停止能力

详见 4.7 节。目前只能开启，不能关闭。

## ⑧ 拉杆的通用化

把「炸哪些桶」从关卡蓝图挪到 `BP_Lever` 的 `TArray<AActor*>` 属性里，然后在关卡里拖拽指定目标。这样拉杆就可以在不同的关卡之间复用了。

---

# 第四章完成检查清单

## 蓝图组件

- [x] `BP_ItemChest` 里添加 `TreasurePileComp`（静态网格体）
- [x] 添加 `TreasureBurstEffectComp`（Niagara）并分配资产
- [x] 取消勾选 Niagara 的 `Auto Activate`
- [x] 理解"C++ 组件 vs 蓝图组件"的判断标准

## `BlueprintImplementableEvent`

- [x] C++ 声明 `ChestAnimationComplete()`，**不写实现**
- [x] `Tick` 到位后调用它
- [x] 蓝图里实现 Event 并 `Activate` 特效
- [ ] 加 `bAnimationCompleted` 与 Tick 开关解耦（待办④）

## 接口蓝图化

- [x] `Interact()` 加 `UFUNCTION(BlueprintNativeEvent)`
- [x] 宝箱改为 `Interact_Implementation()` + `override`
- [x] 调用方改为 `IRogueInteractionInterface::Execute_Interact(...)`
- [x] 蓝图里连 `Parent: Interact` 节点
- [ ] 调用前判空 + `Implements<U>()`（待办①）

## 重复触发防护

- [x] C++ 加 `bChestOpened` 早退守卫
- [x] `UPROPERTY(BlueprintReadOnly)` 暴露给蓝图
- [x] 蓝图里 `Branch (NOT Chest Opened)`，**接 True 引脚**
- [x] Branch 放在 `Parent: Interact` **之前**

## 事件分发器

- [x] 创建 `BP_Lever`（父类 `Actor`）
- [x] Class Settings 里添加 `Rogue Interaction Interface`
- [x] Sphere 组件设为 `Interaction` 碰撞预设
- [x] 事件分发器面板加 `OnHandlePulled`
- [x] `Event Interact → Call On Handle Pulled`
- [x] 关卡蓝图 `BeginPlay → Bind Event to On Handle Pulled`
- [x] Custom Event 接到 `Event` 引脚（红线）
- [x] `Explode()` 加 `UFUNCTION(BlueprintCallable)`
- [ ] `Explode` 改为串联而非多连（待办⑥）

## 投射物炮台

- [x] 创建 `BP_ProjectileSpammer`（父类 `Pawn`）
- [x] 添加 `Arrow` 组件标记发射口
- [x] `Event Tick → SpawnActor BP_MagicProjectile`
- [x] `Spawn Transform` 接 `Arrow` 的 `Get World Transform`
- [x] `Instigator` 接 `Self`
- [x] `Tick间隔` 设为 `0.5`
- [x] 取消勾选 `启用Tick并开始`
- [x] 蓝图函数 `StartSpawning` → `Set Actor Tick Enabled(true)`
- [x] 关卡蓝图里从 Custom Event 调用它
- [ ] `Collision Handling Override` 显式设为 `Always Spawn`（待办）
- [ ] 加上停止能力（待办⑦）

---

# 术语表

| 术语 | 含义 |
|---|---|
| **反射系统** | UE 在编译期生成的类型元数据，蓝图靠它"看见"C++ |
| **UHT（Unreal Header Tool）** | 编译前扫描头文件、生成 `.generated.h` 的工具 |
| **`BlueprintCallable`** | 蓝图可以调用的 C++ 函数，实现在 C++ |
| **`BlueprintImplementableEvent`** | C++ 只声明、蓝图实现的函数，**C++ 侧不能写函数体** |
| **`BlueprintNativeEvent`** | C++ 写 `_Implementation` 默认实现，蓝图可选覆盖 |
| **`BlueprintPure`** | 无执行引脚的纯计算函数，每根连出的线都会重新求值 |
| **`BlueprintReadOnly`** | 蓝图能读不能写，用于让 C++ 独占状态所有权 |
| **`Execute_Xxx()`** | 反射路由的接口调用方式，能正确处理纯蓝图实现 |
| **`Parent: Xxx` 节点** | 蓝图版的 `Super::Xxx_Implementation()` |
| **事件分发器** | 蓝图里的多播委托，对应 `DECLARE_DYNAMIC_MULTICAST_DELEGATE` |
| **广播（Broadcast）** | 遍历订阅名单逐个调用 |
| **绑定（Bind）** | 把一个函数登记进订阅名单，对应 `AddDynamic` |
| **Custom Event** | 蓝图里自定义的事件节点，可作为委托的回调目标 |
| **关卡蓝图** | 每个关卡独有的蓝图，能硬引用关卡里的具体实例 |
| **`UArrowComponent`** | 游戏里不可见的朝向标记组件 |
| **`Instigator`** | 伤害/事件的发起者，决定归属与免伤判定 |
| **Tick Interval** | 引擎调度层面的 Tick 间隔，跳过中间帧 |
| **`Collision Handling Override`** | `SpawnActor` 生成位置被占用时的处理策略 |

---

# 参考资料

- [Epic Games：Blueprint Visual Scripting](https://dev.epicgames.com/documentation/en-us/unreal-engine/blueprints-visual-scripting-in-unreal-engine)
- [Epic Games：Blueprint Function Libraries](https://dev.epicgames.com/documentation/en-us/unreal-engine/blueprint-function-libraries-in-unreal-engine)
- [Epic Games：Event Dispatchers](https://dev.epicgames.com/documentation/en-us/unreal-engine/event-dispatchers-in-unreal-engine)
- [Epic Games：Interfaces in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/interfaces-in-unreal-engine)
- [Epic Games：Reflection System / UProperties](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-uproperties)
- [Epic Games：Spawning Actors](https://dev.epicgames.com/documentation/en-us/unreal-engine/spawning-and-destroying-an-actor-in-unreal-engine)
- [Epic Games：Actor Ticking](https://dev.epicgames.com/documentation/en-us/unreal-engine/actor-ticking-in-unreal-engine)
- [Epic Games：Delegates and Lambda Functions](https://dev.epicgames.com/documentation/en-us/unreal-engine/delegates-and-lamba-functions-in-unreal-engine)
- [Tom Looman：Unreal Engine UFUNCTION Specifiers Explained](https://tomlooman.com/unreal-engine-ufunction-specifiers/)
- [Tom Looman：ActionRoguelike on GitHub](https://github.com/tomlooman/ActionRoguelike)
