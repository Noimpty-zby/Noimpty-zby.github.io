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
description: 第四章是从"纯 C++ 搭骨架"转向"C++ 与蓝图协作"的转折点。本篇完整梳理四节课：什么时候该在蓝图里建组件、BlueprintImplementableEvent 与 BlueprintNativeEvent 的调用方向、接口为什么必须用 Execute_ 调用、Parent 节点为什么不能省、事件分发器如何解耦拉杆与爆炸桶、以及 SpawnActor 的几个隐藏参数。重点解释每一次报错的成因与排查路径。
cover: /img/covers/UE5-ActionRoguelike-Chapter4.svg
series: UE5 ActionRoguelike
privacy: protected
sitemap: false
private_section: 课外
---

# 前言

这是我跟随 Tom Looman 学习 UE5 C++ 时，对第四章 **Blueprint Scripting** 的完整复盘。

本章使用的开发环境：

- Unreal Engine `5.6.1`
- Rider
- Visual Studio 2022 Build Tools / MSVC 编译工具链
- 项目名称：`ActionRoguelike`

**这一章和前三章有本质区别。** 前三章我在纯 C++ 里搭骨架，蓝图只用来赋值资产；这一章开始，蓝图第一次真正参与逻辑：在编辑器里加组件、在蓝图里实现 C++ 声明的函数、用事件分发器把两个互不认识的 Actor 连起来。

所以本章学的其实是一件事：**什么时候不该写 C++。**

本章代码量很少，四节课加起来新增的 C++ 不到二十行。难点全在"这段逻辑该放哪"以及"两边怎么互相调用"。我第一次接触蓝图建组件和蓝图实现函数，中间踩了五个坑，每一个都会在下面详细写清楚成因。

四节课的分工：

| 节 | 主题 | 核心产出 |
| --- | --- | --- |
| 第一节 | 蓝图里加组件 | `BlueprintImplementableEvent`、Niagara 特效 |
| 第二节 | 接口的蓝图化 | `BlueprintNativeEvent`、`Execute_` 调用、`Parent` 节点 |
| 第三节 | 事件分发器 | 纯蓝图 Actor、多播委托、关卡蓝图 |
| 第四节 | 蓝图 Pawn 与生成 | `SpawnActor`、Tick Interval、`BlueprintCallable` |

和前三章一样，这篇不只记录"点了哪些按钮"，还会重点解释：

- 为什么这个东西建在蓝图而不是 C++；
- 两边是怎么互相调用的，每一根连线代表什么；
- 每一次报错的真实成因，以及下次该怎么排查。

---

## 目录

- [第零节：先把分工搞清楚](#第零节先把分工搞清楚)
- [第一节：在蓝图中添加组件与实现函数](#第一节在蓝图中添加组件与实现函数)
- [第二节：接口的蓝图化与两次报错](#第二节接口的蓝图化与两次报错)
- [第三节：事件分发器与关卡蓝图](#第三节事件分发器与关卡蓝图)
- [第四节：蓝图 Pawn 与投射物生成](#第四节蓝图-pawn-与投射物生成)
- [知识链路总览](#知识链路总览)
- [易错点速查表](#易错点速查表)
- [遗留待办](#遗留待办)
- [第四章完成检查清单](#第四章完成检查清单)
- [术语表](#术语表)
- [参考资料](#参考资料)

---

# 第零节：先把分工搞清楚

这一节课程里没有，是我自己整理的。因为学完第一节我脑子是乱的：**明明什么都能在 C++ 里写，为什么突然要跑到编辑器里点鼠标？**

先把这个问题回答清楚，后面四节才不会变成"跟着老师点按钮"。

## 0.1 痛点：C++ 引用资产很难受

假设宝箱开启时要播一个粒子特效。纯 C++ 的写法只有两条路：

```cpp
// 路线一：硬编码资产路径
static ConstructorHelpers::FObjectFinder<UNiagaraSystem> EffectAsset(
    TEXT("/Game/FX/NS_TreasureBurst.NS_TreasureBurst"));
TreasureBurstEffect = EffectAsset.Object;
```

问题：美术把文件改个名或挪个文件夹，这行就崩了，而且是**运行时**才发现。

```cpp
// 路线二：留个空指针等人填
UPROPERTY(EditDefaultsOnly, Category = "Effects")
TObjectPtr<UNiagaraSystem> TreasureBurstEffect;
```

这条好一点，但还是有代价：策划想把"一个粒子"改成"两个粒子 + 一次震屏 + 一个音效"，就得来找程序加字段、改代码、重编译。

而在蓝图里，美术自己拖一个组件、选一个资产，秒级完成，不需要编译，不需要程序在场。

## 0.2 结论：C++ 定"能力和规则"，蓝图填"数据和表现"

![C++ 与蓝图的分工决策树](/img/posts/BluePrint/ue5-ch4-split.svg)

用宝箱举例：

- **C++ 决定**："宝箱可以被交互""交互后盖子会在 2.4 秒内转到 120 度""转完会发出一个通知"
- **蓝图决定**："用哪个网格体""转完之后放哪个粒子、哪个音效""金币堆摆在什么位置"

判断一个组件建在哪，标准只有一条：**C++ 代码里需不需要有一个指针指向它？**

| | 建在 C++ | 建在蓝图 |
|---|---|---|
| 判断依据 | 有代码要操作它 | 纯表现，代码不碰 |
| 建立方式 | `CreateDefaultSubobject` + `UPROPERTY` | 编辑器里点"添加" |
| 本章实例 | `BaseMeshComp`、`LidMeshComp` | `TreasurePileComp`、`TreasureBurstEffectComp` |
| C++ 能否访问 | 能，直接用指针 | **不能** |

`LidMeshComp` 必须在 C++，因为 `Tick` 里有 `LidMeshComponent->SetRelativeRotation(...)`；`TreasureBurstEffectComp` 只需要在某个时刻被 `Activate` 一下，而这个 `Activate` 完全可以在蓝图里做，所以 C++ 没必要知道它。

> **一个重要的单向性**：蓝图里加的组件，C++ **看不见**。理论上能用 `FindComponentByClass` 或 `GetComponentsByTag` 在运行时搜出来，但那是靠类型和字符串去猜——组件被删掉或改名时，编译器不会报错，只会在运行时静默返回 `nullptr`。属于"能用，但不该用"的手段。

## 0.3 支撑这一切的是反射系统

蓝图凭什么能"看见"C++ 里的类和函数？靠的是 UE 的反射系统。

![UE 反射系统的工作流程](/img/posts/BluePrint/ue5-ch4-reflection.svg)

流程是：编译之前，UHT（Unreal Header Tool）先扫一遍你的头文件，只认 `UCLASS()` / `UPROPERTY()` / `UFUNCTION()` 这几个宏，把它们记录的类型信息生成到 `Xxx.generated.h` 里。蓝图虚拟机运行时就查这份元数据。

**没加宏 = 在蓝图眼里根本不存在。** 这句话是本章所有"蓝图里搜不到"类报错的第一排查点。

---

# 第一节：在蓝图中添加组件与实现函数

这一节的目标很简单：宝箱开完之后，放一堆金币和一个爆开的粒子特效。但实现方式和前三章完全不同——**C++ 里一行特效代码都不写**。

## 1.1 组件树最终长这样

```text
BP_ItemChest (自我)
└─ BaseMeshComponent (BaseMeshComp)      ← C++ 创建
   └─ LidMeshComponent (LidMeshComp)     ← C++ 创建
   TreasurePileComp                      ← 蓝图创建
   TreasureBurstEffectComp               ← 蓝图创建
```

前两个在细节面板里会标注"在 C++ 中定义"，意味着**不能在蓝图里删除或改名**，只能改它们的属性。后两个是纯蓝图组件，可以随便增删。

这是我第一次看到"一个类的组件分别来自两个地方"，一开始觉得别扭，但对照 0.2 的判断标准就很清楚了：前两个 C++ 要操作，后两个不要。

## 1.2 `BlueprintImplementableEvent`：C++ 声明，蓝图实现

C++ 侧只加了两行：

```cpp
UFUNCTION(BlueprintImplementableEvent)
void ChestAnimationComplete();
```

**注意：只有声明，`.cpp` 里没有任何实现。** 这是本节最反直觉的地方，也是我第一次见到"声明了却不用实现"的函数。

### 为什么不能写函数体

UHT 扫到这个宏之后，会在 `.generated.h` 里**替你生成函数体**，内容大致是：

```text
查找这个函数的 UFunction 元数据
  → 调用 ProcessEvent
  → 把控制权交给蓝图虚拟机
  → 跑蓝图里画的那张图
```

也就是说符号已经存在了。你再写一份 `void ARogueItemChest::ChestAnimationComplete() {}`，链接器会看到两个同名符号，报 duplicate symbol 错误。

**这不是"可以不写"，是"不能写"。**

### 一个静默的坑

如果**没有任何蓝图实现它**，调用会静默变成空操作——不崩溃、不警告、什么都不发生。

Rider 在函数声明旁边会显示一行小字提示（`已在 1 个蓝图中实现` / `没有蓝图用法`），那行小字就是安全网，值得养成扫一眼的习惯。

## 1.3 蓝图侧：两个节点搞定

```text
Event ChestAnimationComplete
  → Activate (Target = TreasureBurstEffectComp)
```

就这么两个节点。C++ 手上根本没有 `TreasureBurstEffectComp` 的引用，所以这个 `Activate` **只能**画在蓝图里——这不是风格选择，是唯一可行的方案。

> **必须确认的一项设置**：`TreasureBurstEffectComp` 的细节面板里，`Auto Activate` 要**取消勾选**。否则关卡一加载宝箱就自己炸一次特效，然后开箱时因为已经激活过反而没反应。这个 bug 的表现和预期正好相反，很容易查错方向。

## 1.4 Tick 里的状态管理：一个我当时没意识到的问题

第三章的 `Tick` 是这么写的：

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

它现在能工作，但依赖了一个巧合：**宝箱是一次性的，开了就不会再关**。

问题在于：`SetActorTickEnabled(false)` 是**性能开关**，我却拿它当**状态记录**用了。"动画有没有播完"这个语义信息，被编码进了"Tick 开没开"里。这两件事的生命周期迟早会分叉：

- 想做可开可关的宝箱 → 得重新开 Tick，状态就丢了
- 想加别的 Tick 逻辑（漂浮、发光呼吸）→ 一关全停

正确做法是把两者拆开：

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

宝箱刚放进关卡、还没被交互时，`CurrentAnimationPitch` 和 `AnimationTargetPitch` 都是 0，`IsNearlyEqual` **第一帧就为真**。于是关卡一加载，每个宝箱都会：关掉自己的 Tick + 触发一次 `ChestAnimationComplete()`。

我没发现是因为 `Interact_Implementation()` 里有 `SetActorTickEnabled(true)` 正好补上了。但更干净的做法是在构造函数里：

```cpp
PrimaryActorTick.bStartWithTickEnabled = false;
```

顺带省掉所有未开启宝箱的每帧开销。

> **顺带记一下插值函数的选择**：`FInterpConstantTo` 是匀速逼近，内部会 clamp 到目标值，能精确抵达；`FInterpTo` 是指数逼近，速度随距离衰减，**理论上永远到不了目标**，只能靠 `IsNearlyEqual` 的容差兜底，收尾会拖很久。开箱这种要求"确定性结束"的动画，匀速是正确选择。代价是没有缓入缓出，看起来有点机械——真要手感就上 Timeline（蓝图）或 `UCurveFloat`（C++ 暴露一条曲线资产），又是一次"C++ 定规则、蓝图填数据"。

---

# 第二节：接口的蓝图化与两次报错

这一节要给宝箱加开箱音效。目标听起来简单，实际上把第三章的接口整个重构了一遍，中间连报两次错。

## 2.1 三个说明符的调用方向

先把三个概念区分清楚，这是本章最容易混的地方：

![三种 UFUNCTION 说明符的调用方向](/img/posts/BluePrint/ue5-ch4-specifiers.svg)

| 说明符 | 方向 | C++ 要不要写实现 | 蓝图能不能改 |
|---|---|---|---|
| `BlueprintCallable` | 蓝图 → C++ | **必须写** | 不能，只能调用 |
| `BlueprintImplementableEvent` | C++ → 蓝图 | **不能写** | 唯一实现就在蓝图 |
| `BlueprintNativeEvent` | C++ → 蓝图 | 写 `_Implementation` | 可选覆盖 |

本章三种全用到了：`ChestAnimationComplete` 是第二种，`Interact` 是第三种，第四节的 `Explode` 是第一种。

另外还有个纯计算版本 `BlueprintPure`：没有执行引脚，**每根连出去的线都会重新求值一次**，所以别在里面做耗时操作。

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

改完之后，`Interact` 从"C++ 的纯虚函数"变成了"注册进反射系统的 `UFunction`"。这个变化会连带影响调用方，于是有了第一次报错。

## 2.3 报错一：为什么必须用 `Execute_Interact`

原来的调用代码是这样：

```cpp
// 报错版本
IRogueInteractionInterface* InteractInterface = Cast<IRogueInteractionInterface>(SelectedActor);
if (InteractInterface)
{
    InteractInterface->Interact();
}
```

改成：

```cpp
IRogueInteractionInterface::Execute_Interact(SelectedActor);
```

![Execute_Interact 的反射路由与 Parent 节点](/img/posts/BluePrint/ue5-ch4-execute.svg)

### 两条路的区别

`Cast<IRogueInteractionInterface>(Actor)` 拿到的是 **C++ 的接口指针**，走 C++ 虚函数表。这条路有个根本盲区：

如果某个类是**纯蓝图**实现的接口（在 Class Settings 里勾了接口，没有对应的 C++ 父类），它的 C++ vtable 里压根没有这个接口，`Cast` 返回 `nullptr`——`if` 静默跳过，什么都不发生，而且不报错。

`Execute_Interact(Obj)` 走的是**反射路径**：查这个对象的 `UClass` 元数据 → 找到对应 `UFunction` → 判断是蓝图重写了还是走 C++ 的 `_Implementation`。两种实现都能正确路由。

**一句话记法：接口函数一旦带上 `BlueprintNativeEvent` / `BlueprintImplementableEvent`，就必须用 `Execute_` 调用。** 直接调 `->Interact()` 是绕过反射，从此蓝图重写就失效了。

这一点在第三节会立刻兑现——`BP_Lever` 是个纯蓝图 Actor，如果还用 `Cast`，拉杆永远不会响应。

## 2.4 报错二：有声音但没动画

改完调用方式，编译通过，进游戏——**能听见音效，但盖子不动**。

原因：`BlueprintNativeEvent` 的语义是"C++ 给默认实现，蓝图**可选**覆盖"。注意是**覆盖**，不是**追加**。

蓝图里一旦画了 `Event Interact`，C++ 的 `Interact_Implementation()` 就**完全不执行了**。我的 `SetActorTickEnabled(true)` 从未运行，所以盖子纹丝不动。

解法是在蓝图里补一个 `Parent: Interact` 节点：

```text
Event Interact → Parent: Interact → Play Sound at Location
```

这个节点等价于 C++ 里的 `Super::Interact_Implementation()`。跟重写虚函数忘了调 `Super::` 是同一类错误，区别是**蓝图不会给你任何警告**。

> **养成习惯**：只要在蓝图里重写 `BlueprintNativeEvent`，第一件事就是右键 → `Add Call to Parent Function`，之后再决定要不要删。

## 2.5 一个课程里没提的 bug：狂按 E 会重复触发

跑通之后我发现，一直按 E，音效和粒子会一直重复播放。**这不是我抄错了**，老师的代码就是这个行为——教程通常不做状态管理，因为那会稀释当节的教学重点。

有意思的是，这个 bug 有**两条完全独立的成因**。

### 路径一：音效

蓝图里 `Event Interact → Play Sound`，没有任何条件判断。按一次走一次图，播一次音效。纯粹是"没写守卫"。

### 路径二：粒子

这条绕了一圈：

```text
按 E → Interact_Implementation() → SetActorTickEnabled(true)
  → 下一帧 Tick：CurrentAnimationPitch 已经等于 AnimationTargetPitch
  → FInterpConstantTo 原地不动，IsNearlyEqual 立刻为真
  → SetActorTickEnabled(false) + ChestAnimationComplete()
  → Niagara 重新 Activate
```

每按一次 E，动画系统就"空跑一帧然后宣布自己完成了一次"。这正是 1.4 那个问题的另一副面孔——**`SetActorTickEnabled` 记录不了"已经开过了"这个语义**。

### 关键陷阱：C++ 里的 return 拦不住蓝图

我的第一反应是这么修：

```cpp
void ARogueItemChest::Interact_Implementation()
{
    if (bChestOpened) { return; }
    bChestOpened = true;
    SetActorTickEnabled(true);
}
```

**粒子确实不重复了，但音效照样每次都播。**

因为蓝图里的执行流是 `Event Interact → Parent: Interact → Play Sound`。`Parent: Interact` 只是"调用一次父类实现"，父类里 `return` 了，控制权照样回到蓝图，执行引脚继续往右走到 `Play Sound`。

**C++ 的 `return` 管不着调用方后面的节点**——就像 `Super::Foo()` 提前返回，不影响你在 `Foo()` 里 `Super::Foo()` 之后写的代码。

所以修复必须解决"蓝图侧怎么知道该不该播"。三个方向：

**方案 A：把状态暴露给蓝图（我最后选的）**

```cpp
UPROPERTY(BlueprintReadOnly, Category = "Chest")
bool bChestOpened = false;
```

蓝图里：`Event Interact → Branch (NOT bChestOpened) → True → Parent: Interact → Play Sound`。

`BlueprintReadOnly` 是关键——蓝图能读、不能写。**"宝箱开没开"这个真相始终由 C++ 独占**，蓝图只是消费者。一旦让蓝图自己维护这个 bool，C++ 就没法信任自己的动画状态了。

注意 Branch 必须在 `Parent: Interact` **之前**，否则父类已经把标志位置 `true` 了，判断的是修改后的值，永远进不了 True 分支。

C++ 里那层 `if (bChestOpened) return;` 也别省。蓝图的 Branch 只能挡住蓝图这一条调用路径，将来要是有别的 C++ 代码直接调 `Interact`，C++ 里那道才是最后一道闸。**双层守卫。**

**方案 B：把音效挪到 `ChestAnimationComplete`**

那里已经有 C++ 状态保护了。开箱音效和爆金币粒子本来就是同一个"开箱成功"时刻的表现。代价是音效延后到动画播完才响，按下 E 的瞬间没有反馈，手感偏迟钝。实际项目里更常见的做法是拆成两个音效：开始的"咔哒"+ 结束的"哗啦"。

**方案 C：改成可开可关的宝箱**

`bChestOpened = !bChestOpened`，`AnimationTargetPitch` 在 0 和 120 之间切换，每次交互都重新开 Tick。这时"重复触发"不再是 bug 而是 feature。

## 2.6 踩坑记录：`bChestOpened` 在蓝图里搜不到

这个坑让我卡了很久，值得单独写，因为**所有常规排查手段都会失效**。

现象：C++ 里写好了 `UPROPERTY(BlueprintReadOnly)`，完整重新编译，父类继承关系正确，`protected` 访问级别也对，但在蓝图里搜 `bChestOpened` **什么都搜不到**。

我按标准流程全查了一遍：

- ✅ 关掉编辑器，Rider 里完整 Build，重开
- ✅ 取消"情境关联"勾选再搜
- ✅ 确认 `BP_ItemChest` 的父类是 `Rogue Item Chest`
- ✅ 确认是 `protected` 不是 `private`
- ✅ 确认 `UPROPERTY` 宏在类体内部

全对。但就是搜不到。

**真正的原因：UE 的反射系统对布尔变量有个特殊规则——显示时会自动剥掉开头的小写 `b`。**

所以 `bChestOpened` 在蓝图里显示成 **`Chest Opened`**，而蓝图搜索框匹配的是**显示名**，不是 C++ 里的真实变量名。搜 `bChestOpened` 一辈子也搜不到。

这个规则只针对 `bool`，而且只剥小写 `b`：

| C++ 变量名 | 蓝图显示名 |
|---|---|
| `bChestOpened` | `Chest Opened` |
| `bIsDead` | `Is Dead` |
| `AnimationTargetPitch` | `Animation Target Pitch` |
| `BaseMeshComponent` | `Base Mesh Component` |

非 bool 类型只是加空格分词，改动不大还认得出来；唯独 bool 少了个字母，搜索直接失配。

反过来说，这也解释了**为什么 UE 强制要求 bool 用 `b` 前缀命名**——引擎知道你会加，所以显示时替你去掉，最终呈现给策划和美术的就是干净的 `Chest Opened`。命名规范和显示系统是配套设计的。

> **更省事的办法**：左侧 My Blueprint 面板 → 齿轮菜单 → 勾选 `Show Inherited Variables`，从父类继承来的变量会全部列出来，直接拖进图表就是 Get 节点，不用猜名字。以后再遇到"C++ 里明明有但蓝图搜不到"，先来这里看一眼比在搜索框里试拼写快得多。

**记住一条就够：C++ 名字 ≠ 蓝图显示名。**

## 2.7 踩坑记录：Branch 接错引脚

连完线后运行，宝箱**完全不打开了**。

原因很蠢但很典型：`Parent: Interact` 接在了 Branch 的 `False` 引脚上，`True` 是空的。

```text
NOT bChestOpened = NOT false = true
  → 走 True 分支
  → True 引脚是空的
  → 执行流到此为止，什么都不发生
```

Branch 的两个引脚在视觉上离得很近，拖线时手一抖就接到下面那格了。而且**蓝图不会报错**——空的执行引脚是完全合法的，引擎认为你就是想让这个分支什么都不做。

> **蓝图调试的核心手段**：逻辑"完全没反应"时，点 Play，然后回到蓝图窗口看节点上有没有**橙色的执行流高亮**。走到哪断了一目了然，比盯着连线找快得多。蓝图没有断点单步，但有实时执行流可视化，这是它相对 C++ 唯一的调试优势。

---

# 第三节：事件分发器与关卡蓝图

这一节做一个拉杆，拉一下引爆场景里的两个桶。目标是学**事件分发器**——UE 里第一个真正的解耦工具。

## 3.1 `BP_Lever`：一个纯蓝图 Actor

这一节的拉杆**没有对应的 C++ 类**，直接从 `Actor` 派生一个蓝图。组件、逻辑、接口实现全在蓝图里：

```text
BP_Lever (父类：Actor)
├─ SwitchBaseMeshComp
│  └─ SwitchHandleMeshComp
└─ Sphere（碰撞体，供交互检测捞到）
```

在 Class Settings → 已实现的接口里添加 `Rogue Interaction Interface`，蓝图里就能画出 `Event Interact` 节点了。

**这正是 2.3 的兑现现场**：如果交互组件还用 `Cast<IRogueInteractionInterface>`，这个纯蓝图 Actor 的 C++ vtable 里没有接口，`Cast` 会返回 `nullptr`，拉杆永远不响应。因为已经改成 `Execute_Interact`，走反射路由，纯蓝图实现也能被正确调用。

> **碰撞设置**：Sphere 组件要用第三章建的 `Interaction` 碰撞预设（对象类型 `WorldDynamic`，对 `Interaction` 通道设为重叠），否则交互组件的球体查询捞不到它。

## 3.2 事件分发器 = C++ 的多播委托

在 My Blueprint 面板的"事件分发器"里加一个 `OnHandlePulled`，然后在 `Event Interact` 后面连一个 `Call On Handle Pulled`。

对应关系：

| 角色 | C++ 对应 | 蓝图里的操作 |
|---|---|---|
| 声明 | `DECLARE_DYNAMIC_MULTICAST_DELEGATE` | 事件分发器面板里加 `OnHandlePulled` |
| 广播 | `OnHandlePulled.Broadcast()` | `Call On Handle Pulled` 节点 |
| 订阅 | `OnHandlePulled.AddDynamic(...)` | `Bind Event to On Handle Pulled` 节点 |

**关键在于：`BP_Lever` 从头到尾不知道有桶存在。** 它只管喊一声"我被拉了"，谁听、听了干什么，全在别处决定。

以后想让拉杆开门、亮灯、放音乐，改订阅方就行，拉杆本身一行不动。这就是解耦的价值。

## 3.3 关卡蓝图里那三根线

我第一次看这张图完全没看懂，因为三根线的语义完全不同。

![事件分发器的登记与广播两个阶段](/img/posts/BluePrint/ue5-ch4-dispatcher.svg)

`Bind Event to On Handle Pulled` 有三个输入：

| 线 | 从哪来 | 语义 |
|---|---|---|
| **白线** | `Event BeginPlay` | 什么时候登记 |
| **蓝线** | `BP_Lever`（从持久关卡） | 登记到谁的名单上 |
| **红线** | `OnHandlePulled_事件`（Custom Event） | 交上哪个函数 |

红线颜色不一样，是因为它传的既不是执行流也不是普通数据，而是**函数引用**——相当于 C++ 里的 `&AMyClass::MyFunc`。

### 最容易卡住的一点

**`Bind` 执行完的那一刻，`OnHandlePulled_事件` 并不会运行。** 它只是被记进了名单。真正运行是在拉杆被交互、`Broadcast` 发生的那一瞬间。

所以 Custom Event 那条支线看起来跟 BeginPlay 是"断开"的，这不是画错了——**它本来就不由执行流驱动，而是被回调唤醒的**。

### 为什么必须在 BeginPlay

登记要早于广播。BeginPlay 是关卡里所有 Actor 都已生成、但玩家还没来得及操作的时刻，是登记的标准时机。

要是放在别处（比如某次交互之后），拉杆可能已经喊过一次而名单还是空的，那次广播就白喊了。

## 3.4 `Explode` 暴露给蓝图

爆炸桶的爆炸逻辑早在 Assignment 1 就写好了，这里只需要加个宏：

```cpp
UFUNCTION(BlueprintCallable)
void Explode();
```

注意它和 `Interact` 的方向**完全相反**：

- `BlueprintCallable` = **蓝图调 C++**，实现在 C++，蓝图只是发起方
- `BlueprintNativeEvent` = **C++ 调蓝图**，蓝图可以改写行为

这一节两种都用到了，正好对照着记。

> Rider 会在函数旁提示"没有蓝图用法"，那是因为刚加完宏还没在任何蓝图里用它。关卡蓝图用上之后重新扫一遍提示就没了。

## 3.5 一个关于多连线的争议（记录一下，结论是我原来判断错了）

我把两个桶的引用都连到了同一个 `Explode` 节点的 `Target` 引脚上。

我当时的判断是：**蓝图的数据输入引脚只能接一根线**，拖第二根进去会把第一根静默顶掉，所以应该只有一个桶会炸。

实测结果：**两个桶都炸了。** 而且我把两个桶拉开 20 米，排除了"爆炸冲击连锁引爆"的可能，结果依然是两个一起飞上天。

所以对象引用类型的输入引脚在这种情况下确实接受了多连，引擎会对每个连上来的 Target 各调一次。这和纯数据引脚（`float`、`bool` 那种确实只能接一根）的行为不同。

> **但仍然建议串成两个 `Explode` 节点**：不是因为多连不工作，而是**多连时的调用顺序没有承诺**。现在两个桶谁先炸无所谓，但如果要做"先炸 A、A 的冲击把 B 顶起来、再炸 B"这种有先后的效果，多连就不可靠了。串联的执行顺序是明确的。
>
> 桶多了就换 `Make Array` → `ForEachLoop` → `Explode`。

## 3.6 关卡蓝图的特权与代价

那些标着"从持久关卡"的节点是**关卡蓝图独有的能力**——它可以直接引用关卡里摆放的**具体实例**。

普通蓝图类做不到这一点。`BP_Lever` 是一个模板，它不知道自己会被摆在哪一关、旁边有什么，所以无法在编辑时硬引用某个具体的桶。

代价是这套逻辑**焊死在这一关**上。换个关卡，拉杆还是拉杆、桶还是桶，但连线全得重画。

**判断标准：这个逻辑是"这一关的剧本"，还是"这类物体的通用行为"？**

拉杆炸桶作为教学演示放关卡蓝图没问题；真做项目时，"拉杆触发某组目标"这种可复用逻辑应该做成 `TArray<AActor*>` 暴露在拉杆类上，关卡里拖拽指定目标就行。

---

# 第四节：蓝图 Pawn 与投射物生成

最后一节把前面的东西串起来：拉一下杆，一个炮台开始每 0.5 秒发射一枚投射物。

## 4.1 `BP_ProjectileSpammer`：又一个纯蓝图类

从 `Pawn` 派生，组件树：

```text
BP_ProjectileSpammer (父类：Pawn)
└─ DefaultSceneRoot
   └─ Arrow
```

`Event Tick → SpawnActor BP Magic Projectile`，参数：

| 引脚 | 连什么 | 作用 |
|---|---|---|
| `Class` | `BP_MagicProjectile` | 生成什么 |
| `Spawn Transform` | `Arrow` 的 `Get World Transform` | 在哪生成、朝哪 |
| `Instigator` | `Self` | **伤害归属** |

## 4.2 `Arrow` 组件：让美术决定发射口

`UArrowComponent` 在游戏里不可见，纯粹是个"朝向标记"。它的作用是让你在编辑器里**可视化地摆好发射口的位置和方向**，代码直接取它的世界变换。

对比硬编码的写法：

```cpp
// 偏移量写死在代码里，改一次要重编译
FVector SpawnLoc = GetActorLocation() + GetActorForwardVector() * 100.f;
```

用 `Arrow` 的话，美术在视口里拖一下箭头就行。**又是一次"C++ 定规则、编辑器填数据"。**

## 4.3 `Instigator` 连 `Self` 不是可选项

这个引脚很容易被跳过，但它决定了**伤害归属**。投射物打中目标时，伤害系统会顺着 `Instigator` 往上追责任方。

连了 `Self` 之后：

- 投射物不会误伤发射者自己（很多伤害逻辑会检查 `Instigator == DamagedActor`）
- 击杀统计、仇恨系统能正确归因
- 玩家被打死时，死亡提示能显示"被 XX 击杀"

不连的话，伤害来源是 `nullptr`，上面这些全部失效，**而且不报错**。属于那种"能跑，但半年后做击杀播报时发现全是空白"的坑。

## 4.4 `Tick 间隔 = 0.5` 是个被低估的功能

在细节面板的 `Actor Tick` 里把 `Tick间隔（秒）` 设成 `0.5`，比在 Tick 里累加 `DeltaTime` 攒够 0.5 秒再发射高明得多。

后者每帧都要跑一次函数调用和浮点比较；前者是**引擎在调度层面就跳过了这个 Actor**，中间那些帧根本不进 Tick。

代价是精度：实际间隔会被帧率量化。60 帧下每帧 16.7ms，0.5 秒会落到 0.5 或 0.517 上，不会精确到毫秒。

> 做投射物完全够用。但如果要做节奏游戏的判定，Tick Interval 的精度是不够的，得用 `FTimerManager` 或直接对齐音频时钟。

同时勾掉 `启用Tick并开始`（`bStartWithTickEnabled`），让炮台默认不发射。这和宝箱那边是同一个模式：**Tick 默认关闭、按需开启**，是 UE 里的标准性能习惯——一个关卡里几百个 Actor，绝大多数在绝大多数时间都不需要每帧更新。

## 4.5 `StartSpawning`：蓝图里也能定义函数

在 My Blueprint → 函数 → 加一个 `StartSpawning`，内容就一个节点：

```text
StartSpawning → Set Actor Tick Enabled (Target = self, Enabled = ✓)
```

然后关卡蓝图里，`OnHandlePulled_事件 → Start Spawning (Target = BP_ProjectileSpammer)`。

> **第一次运行的失误**：`Enabled` 那个勾没打。默认是不勾的，等于 `Set Actor Tick Enabled(false)`——拉了杆，炮台反而更不动了。这个引脚和 Branch 的 Condition 一样，是那种"默认值恰好是你不想要的"的地方。

**为什么要包一层函数，而不是在关卡蓝图里直接 `Set Actor Tick Enabled`？**

因为那样关卡蓝图就得知道"炮台是靠 Tick 开关来控制发射的"——这是炮台的**内部实现细节**。今天用 Tick，明天改成 Timer，关卡蓝图就得跟着改。

包一层 `StartSpawning` 之后，关卡蓝图只需要知道"这个东西能开始发射"，怎么发射是炮台自己的事。这就是**封装**，和 C++ 里的 public 方法包裹 private 成员是同一件事。

## 4.6 `Collision Handling Override` 值得显式指定

这个下拉现在是"默认"，它决定了**生成位置被占用时怎么办**：

| 选项 | 行为 |
|---|---|
| `Always Spawn, Ignore Collisions` | 无视一切，强行生成 |
| `Try To Adjust Location, But Always Spawn` | 尝试挪开，挪不开也生成 |
| `Try To Adjust Location, Don't Spawn If Still Colliding` | 挪不开就**返回 nullptr** |

最后一种最危险：它会**静默失败**，返回值是空的。如果后面接了 `Return Value → 设置什么属性`，那就是一次空指针访问。

做投射物建议显式选 `Always Spawn`，别留"默认"。

## 4.7 一个设计缺口：`StartSpawning` 只开不关

拉一次杆，炮台就**永远发射下去**，直到关卡结束。

这在教学演示里无所谓，但暴露了一个设计问题：`OnHandlePulled` 是个"单向开关信号"，接收方没法知道该开还是该关。

两条改进路线：

1. **委托带参数**：事件分发器支持带输入参数，在细节面板里加一个 `bool`
2. **接收方自己维护状态**：收到信号就取反

第二种更灵活——同一个信号可以让 A 开始发射、让 B 停止移动、让 C 切换灯光，各自决定语义。

这也是委托设计里的常见取舍：**信号只说"发生了什么"，不说"你该做什么"。**

---

# 知识链路总览

![第四章完整链路](/img/posts/BluePrint/ue5-ch4-chain.svg)

两条链路共用第三章建好的交互入口，之后分道扬镳：

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

把这一章浓缩成三句话：

1. **反射系统是桥梁**——没有 `UCLASS` / `UPROPERTY` / `UFUNCTION`，蓝图什么都看不见。
2. **方向决定说明符**——蓝图调 C++ 用 `BlueprintCallable`；C++ 调蓝图看有没有默认实现，分 `BlueprintImplementableEvent` 和 `BlueprintNativeEvent`。
3. **状态归 C++，表现归蓝图**——`bChestOpened` 用 `BlueprintReadOnly` 单向暴露，蓝图只读不写。

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

**优先级最高，会直接崩溃。**

```cpp
IRogueInteractionInterface::Execute_Interact(SelectedActor);
```

`Execute_` 系列内部有两个 `check()`：对象非空、且确实实现了该接口。任一不满足，Development 构建直接崩。

也就是说**对着空气按 E 会崩**。改法：

```cpp
if (SelectedActor && SelectedActor->Implements<URogueInteractionInterface>())
{
    IRogueInteractionInterface::Execute_Interact(SelectedActor);
}
```

> 注意 `Implements<>` 的模板参数用的是 **`U` 前缀**（`URogueInteractionInterface`），不是 `I` 前缀——这里传的是 UClass 类型，第一次写很容易搞错。

## ② 第三章结转：`SelectedActor` 每帧重置

不重置的话，看向宝箱再转头看天，`SelectedActor` 仍然指着宝箱，隔着墙也能开箱。和 ① 是同一个雷区。

## ③ 第三章结转：`GetPawn()` 判空

`TickComponent` 从组件注册就开始跑，而 `Possess` 是后续才做的；角色死亡到重生之间也有真空期。

## ④ `bAnimationCompleted` 与 Tick 开关解耦

见 1.4。当前用 `SetActorTickEnabled` 兼职记录状态，宝箱一次性时能工作，做成可开可关就会漏。

## ⑤ 宝箱音效的时机

现在按下 E 立刻响，但如果改成方案 C（可开可关），需要区分开箱音和关箱音。更好的做法是拆成两个：交互瞬间的"咔哒"+ 动画结束的"哗啦"。

## ⑥ 关卡蓝图里的 `Explode` 改为串联

见 3.5。多连能工作，但调用顺序无承诺。

## ⑦ `StartSpawning` 加上停止能力

见 4.7。当前只开不关。

## ⑧ 拉杆的通用化

把"炸哪些桶"从关卡蓝图挪进 `BP_Lever` 的 `TArray<AActor*>` 属性，关卡里拖拽指定目标。这样拉杆就能跨关卡复用了。

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
