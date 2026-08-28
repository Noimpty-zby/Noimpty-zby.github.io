---
title: UE5 C++ 第三章复盘：从每帧筛选目标到接口解耦的完整交互系统
date: 2026-08-11 18:00:00
categories:
  - [课外, 游戏开发, UE5-Looman]
tags:
  - C++
  - ActionRoguelike
  - Gameplay Framework
  - 接口
  - 碰撞系统
  - Enhanced Input
description: 完整梳理 ActionRoguelike 第三章六节课：GameMode/PlayerController/Pawn 的职责划分、球体重叠与点积目标筛选、Tick 驱动的程序化动画、UInterface 双类结构与依赖倒置、Enhanced Input 到接口调用的完整链路、自定义检测通道的白名单过滤、以及核心重定向背后的对象命名机制，并解释每一步为什么这么写。
cover: /img/covers/UE5-ActionRoguelike-Chapter3.svg
series: UE5 ActionRoguelike
privacy: protected
sitemap: false
private_section: 课外
---

# 前言

这是我跟随 Tom Looman 学习 UE5 C++ 时，对第三章 **Interaction System** 的完整复盘，覆盖课程六节课的全部内容。

本章使用的开发环境：

- Unreal Engine `5.6.1`
- Rider
- Visual Studio 2022 Build Tools / MSVC 编译工具链
- 项目名称：`ActionRoguelike`

本章目标是打通一条完整的交互链路：

```text
每帧
  → 以玩家为中心做球体重叠查询
  → 用点积给每个候选打分
  → 记住得分最高的那个（SelectedActor）

按下 E
  → PlayerController 收到输入
  → 交给交互组件
  → 组件读取 SelectedActor
  → 转成接口指针调用 Interact()
  → 宝箱打开自己的 Tick
  → 逐帧转动盖子，到位后自行关闭 Tick
```

这条链路表面上只是"做一个开宝箱"，实际上它把 UE 的 **Gameplay Framework 分层、组件化拆分、几何筛选算法、程序化动画、Tick 生命周期管理、UInterface 反射接口、Enhanced Input 绑定、自定义碰撞通道、对象命名与重定向** 全部串了一遍。

和第二章最大的区别是：**第二章在往 Character 上堆功能，第三章开始把逻辑拆成独立的模块**。思路上是从"写功能"转向"设计结构"。

六节课的分工：

| 节 | 主题 | 核心产出 |
| --- | --- | --- |
| 第一节 | Gameplay Framework 与骨架 | GameMode / PlayerController / 交互组件 / 宝箱类 |
| 第二节 | 目标筛选算法 | 球体重叠 + 点积打分 |
| 第三节 | 程序化开盖动画 | 双网格体结构、`FInterpConstantTo`、Tick 开关 |
| 第四节（上） | 交互接口 | `UInterface` 双类结构、依赖倒置 |
| 第四节（下） | 输入串联 | `SetupInputComponent`、`SelectedActor` 提升为成员 |
| 第五节 | 碰撞过滤 | 自定义检测通道、宏定义 |
| 第六节 | 重构与重定向 | `[CoreRedirects]`、对象路径机制 |

和前两章一样，这篇不只记录"敲了哪些代码"，还会重点解释：

- 为什么要写这段代码；
- 每个改动解决了什么问题；
- 本章出现过和可能出现的坑，以及它们的排查顺序。

---

## 目录

- [第一节：Gameplay Framework 与交互组件骨架](#第一节：Gameplay-Framework-与交互组件骨架)
- [第二节：球体重叠与点积筛选](#第二节：球体重叠与点积筛选)
- [第三节：宝箱网格体与程序化开盖动画](#第三节：宝箱网格体与程序化开盖动画)
- [第四节：交互接口与输入串联](#第四节：交互接口与输入串联)
- [第五节：自定义碰撞检测通道](#第五节：自定义碰撞检测通道)
- [第六节：重构与核心重定向](#第六节：重构与核心重定向)
- [知识链路总览](#知识链路总览)
- [易错点速查表](#易错点速查表)
- [遗留待办](#遗留待办)
- [第三章完成检查清单](#第三章完成检查清单)
- [术语表](#术语表)
- [参考资料](#参考资料)

---

# 第一节：Gameplay Framework 与交互组件骨架

这一节创建了四个类、改了一处项目设置，最后只在屏幕上画出一个红色方框。**它的重点不是代码，是 UE 的 Gameplay Framework**。第一次学的时候会觉得七零八落，因为 Tom 是在铺地基。

## 1.1 本节创建了什么

| 文件 | 位置 | 父类 | 作用 |
|---|---|---|---|
| `RogueInteractionComponent` | `Source/ActionRoguelike/Player/` | `UActorComponent` | 交互逻辑容器 |
| `RoguePlayerController` | `Source/ActionRoguelike/Player/` | `APlayerController` | 持有交互组件 |
| `RogueGameMode` | `Source/ActionRoguelike/Core/` | `AGameModeBase` | 指定使用哪个 PC 类 |
| `RogueItemChest` | `Source/ActionRoguelike/World/` | `AActor` | 后续几节的交互目标 |

## 1.2 `UActorComponent` 与 `USceneComponent` 的分水岭

第二章里 `CreateDefaultSubobject` 出来的组件全是 `USceneComponent` 的子类（`SphereComponent`、`NiagaraComponent`、`AudioComponent`）。这一节的交互组件继承的是更基础的 `UActorComponent`。

| | `UActorComponent` | `USceneComponent` |
|---|---|---|
| 有 Transform | ✗ | ✓ |
| 能挂进组件树 | ✗ | ✓ |
| 需要 `SetupAttachment` | **不需要，也不能** | 需要 |
| 典型用途 | 纯逻辑（血量、库存、交互、AI 行为） | 有空间位置的东西（网格体、碰撞体、特效） |

继承链是 `UObject → UActorComponent → USceneComponent → UPrimitiveComponent → ...`。

> **第一个容易踩的坑**：写惯了第二章的代码，创建 `UActorComponent` 时会顺手补一句 `SetupAttachment(RootComponent)`，编译直接报错——这个函数是 `USceneComponent` 才有的。没有 Transform 的组件不参与空间层级，只需要 `CreateDefaultSubobject` 一句就够。

```cpp
ARoguePlayerController::ARoguePlayerController()
{
	InteractionComponent = CreateDefaultSubobject<URogueInteractionComponent>(TEXT("InteractionComp"));
	// 注意：这里没有也不能有 SetupAttachment
}
```

## 1.3 为什么交互组件挂在 PlayerController 上

这是本节最需要想清楚的设计决策。

UE 的 Gameplay Framework 把"一局游戏"拆成几个职责明确的角色：

| 类 | 是什么 | 生命周期 |
|---|---|---|
| `AGameModeBase` | 规则与类型配置中心，不参与任何表现 | 整局游戏，**只存在于服务器** |
| `APlayerController` | **玩家本人**的代理 | 从加入到退出，跨越 Pawn 的生死 |
| `APawn` / `ACharacter` | 玩家的**身体** | 会死、会重生、会被换掉 |
| `UActorComponent` | 挂在某个 Actor 上的一块可复用逻辑 | 随宿主 |

**一句话记法：PlayerController 是"意志"，Pawn 是"身体"。**

身体会死、会被换成另一个角色，但玩家本人一直存在。所以：

- 属于"玩家本人"的东西 → 放 PC：输入映射、UI、得分、**交互意图**
- 属于"这具身体"的东西 → 放 Character：移动、动画、血量、碰撞

把交互组件放在 PC 上的三条具体理由：

1. **AI 敌人也是 Character**。挂在 Character 上会让所有敌人白白背一个永远用不到的组件。
2. **角色死亡重生时 PC 不变**，当前聚焦的目标、交互冷却这类状态不会丢。
3. **多人游戏里 PC 只在自己的客户端上完整存在**，而射线检测 + 高亮描边是纯本地表现，放这里最自然。

代价是：**PC 自己没有世界位置**（它不在关卡里），拿位置必须绕一层 `GetPawn()`。这正是后面 `PC->GetPawn()->GetActorLocation()` 的来历。

> 顺带一提，Tom 早期版本的课程把 `InteractionComponent` 挂在 `SCharacter` 上。新版挪到 PC 是一次有意的重构，理由就是上面这三条。

## 1.4 `GameMode`：谁来指名

```cpp
// RogueGameMode.h
UCLASS()
class ACTIONROGUELIKE_API ARogueGameMode : public AGameModeBase
{
	GENERATED_BODY()
public:
	ARogueGameMode();
};
```

```cpp
// RogueGameMode.cpp
#include "RogueGameMode.h"
#include "Player/RoguePlayerController.h"

ARogueGameMode::ARogueGameMode()
{
	PlayerControllerClass = ARoguePlayerController::StaticClass();
}
```

这里要解决的问题很直白：**你在 C++ 里写了一个 `ARoguePlayerController` 类，引擎完全不知道它的存在**。C++ 里定义一个类，不等于游戏会用它。

`AGameModeBase` 就是那个"指名"的地方。它身上有一组类型配置字段：

| 字段 | 含义 |
|---|---|
| `PlayerControllerClass` | 玩家加入时生成哪个 PC |
| `DefaultPawnClass` | 给玩家生成哪个 Pawn |
| `HUDClass` | 用哪个 HUD |
| `GameStateClass` | 用哪个 GameState |
| `PlayerStateClass` | 用哪个 PlayerState |
| `SpectatorClass` | 观战时用哪个 Pawn |

而 GameMode 自己也要被指名——那就是 `项目设置 → 地图和模式 → 默认游戏模式`（写进 `DefaultEngine.ini`）。

`AGameMode` 与 `AGameModeBase` 的区别：前者是后者的子类，多了一套比赛状态机（`MatchState`：`WaitingToStart` / `InProgress` / `WaitingPostMatch` 等）和玩家重生逻辑。单人 Roguelike 用不到那套状态机，所以选 `AGameModeBase` 更轻。

## 1.5 完整的启动链条

![UE Gameplay Framework 启动链条](/img/posts/ue5-ch3/ue5-ch3-framework.svg)

按时间顺序展开：

```text
1. 引擎加载关卡
2. 读取项目设置里的默认 GameMode → 实例化 ARogueGameMode
3. GameMode 构造函数执行，PlayerControllerClass 被设为 ARoguePlayerController
4. 玩家加入（单人游戏也走这个流程）
5. GameMode 用 PlayerControllerClass 生成 PC 实例
6. PC 构造函数执行 → CreateDefaultSubobject 创建 InteractionComponent
7. GameMode 按 DefaultPawnClass 生成 Pawn
8. PC->Possess(Pawn)
9. 组件开始 Tick
```

**这条链缺任何一环，红框都不会出现。** 这就是第一节那四个类和一处设置之间的关系：它们不是四个独立的东西，是一条依赖链上的四个节点。

## 1.6 `EditDefaultsOnly` 还是 `VisibleAnywhere`

```cpp
UPROPERTY(EditDefaultsOnly, Category="Components")
TObjectPtr<URogueInteractionComponent> InteractionComponent;
```

第二章里所有组件用的都是 `VisibleAnywhere`，这里换成了 `EditDefaultsOnly`，第一眼会觉得不一致。

先分清一件事：**说明符修饰的是"指针这个槽位"，不是它指向的组件对象**。

| 维度 | 含义 |
|---|---|
| `Visible` | 槽位只读，但仍可展开、编辑组件内部的属性 |
| `Edit` | 槽位本身可写 |
| `Anywhere` | 关卡实例 + 类默认值都能改 |
| `DefaultsOnly` | 只在类默认值面板能改 |
| `InstanceOnly` | 只在关卡实例上能改 |

然后是关键：**`APlayerController` 不能被拖进关卡**，它是运行时 Spawn 的。所以"关卡实例"这个编辑场景根本不存在，`Anywhere` 和 `DefaultsOnly` 在这里等价。而 `CreateDefaultSubobject` 产生的是 default subobject，编辑器也不会真让你把这个指针换成别的对象，所以 `Edit` 和 `Visible` 也基本等价。

**结论：这一处两者差别几乎为零。** 引擎自身的惯例是 `VisibleAnywhere`（`ACharacter` 的 `Mesh`、`CharacterMovement` 都是这么写的），跟着惯例走不会错。

但这个说明符在**另一处**是真正起作用的——第四节的 `Input_Interact`。那里必须是 `Edit`，因为需要在蓝图里塞资源进去。届时会详细展开。

## 1.7 DebugBox：一根探针

```cpp
void URogueInteractionComponent::TickComponent(float DeltaTime, ELevelTick TickType,
                                               FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	APlayerController* PC = CastChecked<APlayerController>(GetOwner());
	FVector Center = PC->GetPawn()->GetActorLocation();
	DrawDebugBox(GetWorld(), Center, FVector(20.f), FColor::Red);
}
```

这段代码没有任何游戏逻辑，它是一根**探针**。红框出现，同时证明了四件事成立：

1. GameMode 确实是 `RogueGameMode`
2. 生成的 PC 确实是 `ARoguePlayerController`
3. `InteractionComponent` 确实被创建并且在 Tick
4. PC 确实 Possess 了一个 Pawn

**`CastChecked` vs `Cast`**：`CastChecked` 在类型不匹配时直接断言崩溃，`Cast` 返回 `nullptr`。这里用 `CastChecked` 是有意的——交互组件按设计只可能挂在 PlayerController 上，如果不是，那是程序结构出了问题，应该**立刻大声地崩**，而不是静默走一条错误分支。

> **一个观察**：红框大概在角色骨盆高度而不是脚底。因为 `ACharacter` 的 `GetActorLocation()` 返回的是**胶囊体中心**，而胶囊体的中心在角色腰部。以后做特效生成位置、判断落点时，这个半高偏移会反复咬人。

> **一处潜在崩溃**：`PC->GetPawn()` 没有判空。`TickComponent` 从组件注册那一刻就开始跑，而 `Possess` 是 GameMode 后续才做的；另外角色死亡到重生之间也有一段真空期。这两个时刻 `GetPawn()` 会返回 `nullptr`，紧接着的 `->GetActorLocation()` 就是空指针解引用。见[遗留待办](#遗留待办)。

---

# 第二节：球体重叠与点积筛选

上一节的 DebugBox 只是探针。这一节要真正回答：**玩家想跟哪个东西交互？**

## 2.1 为什么放弃射线检测

最直接的想法是从摄像机打一条射线，打中谁就是谁。但射线在数学上宽度为零，玩家必须把准星精确压在物体上。手柄操作时这几乎是折磨。

Tom 用的是另一套思路：**先圈出所有候选，再挑一个最符合"我正看着它"的**。这是 3D 动作游戏的通行做法（塞尔达、魂系的锁定都是这个骨架）。

于是代码分成两步：`OverlapMultiByChannel` 撒网捞候选，然后用点积给每个候选打分。

## 2.2 本节完整代码

```cpp
void URogueInteractionComponent::TickComponent(float DeltaTime, ELevelTick TickType,
                                               FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	APlayerController* PC = CastChecked<APlayerController>(GetOwner());
	FVector Center = PC->GetPawn()->GetActorLocation();

	TArray<FOverlapResult> Overlaps;
	ECollisionChannel CollisionChannel = ECC_Visibility;   // 第五节会换成自定义通道
	FCollisionShape Shape;
	Shape.SetSphere(InteractionRadius);
	GetWorld()->OverlapMultiByChannel(Overlaps, Center, FQuat::Identity, CollisionChannel, Shape);
	DrawDebugSphere(GetWorld(), Center, InteractionRadius, 32, FColor::White);

	AActor* BestActor = nullptr;
	float HighestDotResult = -1.0f;
	for (const FOverlapResult& Overlap : Overlaps)
	{
		FVector OverlapLocation = Overlap.GetActor()->GetActorLocation();
		DrawDebugBox(GetWorld(), OverlapLocation, FVector(50.f), FColor::Red);

		FVector OverlapDirection = (OverlapLocation - Center).GetSafeNormal();
		float DotResult = FVector::DotProduct(PC->GetControlRotation().Vector(), OverlapDirection);

		FString DebugString = FString::Printf(TEXT("Dot: %f"), DotResult);
		DrawDebugString(GetWorld(), OverlapLocation, DebugString, nullptr, FColor::White, 0.f, true);

		if (DotResult > HighestDotResult)
		{
			BestActor = Overlap.GetActor();
			HighestDotResult = DotResult;
		}
	}

	if (BestActor)
	{
		DrawDebugBox(GetWorld(), BestActor->GetActorLocation(), FVector(60.f), FColor::Green);
	}
}
```

配套的成员变量：

```cpp
UPROPERTY(EditDefaultsOnly, Category = "Interaction")
float InteractionRadius = 800.f;
```

## 2.3 `OverlapMultiByChannel` 逐参数解析

```cpp
GetWorld()->OverlapMultiByChannel(Overlaps, Center, FQuat::Identity, CollisionChannel, Shape);
```

| 参数 | 含义 | 本例 |
|---|---|---|
| `OutOverlaps` | 输出数组，装所有命中结果 | `Overlaps` |
| `Pos` | 查询形状的中心位置 | 玩家胶囊体中心 |
| `Rot` | 查询形状的旋转 | `FQuat::Identity`（球体旋转无意义） |
| `TraceChannel` | **按哪个检测通道过滤** | `ECC_Visibility`（第五节会改） |
| `CollisionShape` | 查询形状 | 半径 800 的球 |
| `Params` | 查询参数（忽略列表等），有默认值 | 省略 |

`FCollisionShape` 是一个可以表示多种形状的联合体，通过工厂方法构造：

```cpp
FCollisionShape Shape;
Shape.SetSphere(InteractionRadius);
// 等价写法：FCollisionShape::MakeSphere(InteractionRadius)
// 其它形状：MakeBox(FVector) / MakeCapsule(Radius, HalfHeight)
```

**Overlap 查询与第二章的射线/扫掠查询的区别**：射线是"从 A 到 B 有没有东西"，Overlap 是"这个位置的这个形状里有什么东西"。前者关心路径，后者关心区域。

`FQuat::Identity` 是"不旋转"的四元数。这里用四元数而不是 `FRotator` 是因为底层物理引擎（Chaos）内部用四元数表示旋转，传 `FRotator` 还要转一次。

## 2.4 点积：本节的数学核心

![点积挑选交互目标](/img/posts/ue5-ch3/ue5-ch3-dot.svg)

**两个单位向量的点积等于夹角的余弦。** 所以 `DotResult` 不是什么抽象的数，它就是 cos θ：

| 值 | 几何含义 |
|---|---|
| `1.0` | 目标在正前方 |
| `0.7` | 约 45° 偏角 |
| `0.0` | 正侧面，90° |
| `-1.0` | 正后方 |

如果学过 GAMES101，这和 Lambert 漫反射的 `max(0, n·l)` 是同一个东西——那里用 cos 衡量"光线有多正对着表面"，这里用 cos 衡量"物体有多正对着视线"。

### 为什么必须 `GetSafeNormal()`

点积的完整形式是 `|A||B|cos θ`。如果不归一化，`OverlapLocation - Center` 的长度（也就是距离）会混进结果里——**远处的物体光凭"远"就能拿到更大的点积**。归一化把长度抹掉，只留下纯粹的角度信息。

`GetControlRotation().Vector()` 本身已经是单位长度（`FRotator::Vector()` 返回该旋转的单位前向量），所以只需要归一化另一个。

`GetSafeNormal()` 而不是 `GetNormal()` / `Normalize()`：`GetSafeNormal` 在向量长度接近零时返回 `FVector::ZeroVector` 而不是产生 NaN。零长度向量在这里是可能出现的——如果重叠结果里包含玩家自己，`OverlapLocation - Center` 就恰好是零向量。

### 为什么用 `GetControlRotation()` 而不是 `GetActorForwardVector()`

玩家感知的"我在看哪"是**摄像机方向**，不是角色身体的朝向。第三人称游戏里角色会朝移动方向转身，身体和视线经常差几十度。

`GetControlRotation()` 是 PlayerController 上的旋转，由鼠标/右摇杆直接驱动，代表玩家的**意图**。这又回到了第一节"PC 是意志、Pawn 是身体"那条线——用 PC 的旋转做交互判定，是这个设计的自然结果。

> **注意 Pitch 的影响**：`ControlRotation` 包含俯仰角。第三人称视角通常有一定俯角，所以即使你正对着一个地面上的箱子，dot 也拿不到 1.0。这不是 bug，但会影响阈值的选取。

## 2.5 打擂台算法与 `-1.0f` 初值

```cpp
float HighestDotResult = -1.0f;
```

为什么是 `-1`？因为这是单位向量点积的**理论下界**。初始化成"比任何可能值都差"，循环里第一个候选必然刷新它。这是打擂台（找最值）算法的标准写法。

> **一个边角**：正后方 dot 恰好等于 `-1.0` 时 `>` 不成立，那个候选会被漏掉。浮点数里几乎不会真的撞上，但知道这个边界在哪是好习惯。想彻底避免可以用 `-FLT_MAX` 或者引入 `bool bFound`。

## 2.6 调试绘制的三件套

| 函数 | 作用 | 关键参数 |
|---|---|---|
| `DrawDebugSphere` | 画交互范围球 | `Segments`：分段数，越大越圆越费 |
| `DrawDebugBox` | 标记每个候选 / 最终目标 | `Extent`：**半长**，不是全长 |
| `DrawDebugString` | 在世界坐标显示文字 | `Duration = 0` 表示只存活一帧 |

`DrawDebugBox` 的 `Extent` 是**半尺寸**：`FVector(50.f)` 画出来的是 100×100×100 的立方体。

`DrawDebugString` 有个特殊之处：它不是直接画的，而是往 HUD 的调试文字列表里塞一条，由 `AHUD::DrawDebugTextList` 渲染。所以它**需要一个有效的 HUD 才会显示**。`Duration` 传 `0` 意味着"下一帧移除"，配合 Tick 里每帧重新调用，效果就是持续显示。

这些函数都在 `DrawDebugHelpers.h` 里，属于 `Engine` 模块，不需要额外的 `Build.cs` 依赖。**它们在 Shipping 构建里会被编译掉**，所以放心在开发期大量使用。

## 2.7 本节留下的隐患

这一节的代码能跑，但有五个问题会在后面的节里陆续暴露：

1. **`ECC_Visibility` 撒的网太大**。这个通道的语义是"能不能被看见"，墙、地板、静态网格体默认全都 Block 它。截图里那些红框只是恰好都是箱子，场景复杂后会捞进大量垃圾。→ **第五节解决**
2. **重叠结果里可能包含玩家自己**。角色胶囊体的 `Pawn` 预设对 Visibility 是 Block，所以玩家自己也会进数组，`OverlapDirection` 是零向量，dot 恒为 0。→ **第五节顺带解决**
3. **没有任何阈值**。只要球体里有东西，`BestActor` 就一定非空——背后的宝箱也会被选中。→ **[遗留待办](#遗留待办)**
4. **距离被完全丢掉了**。20 米外正对着你的箱子会赢过 1 米外偏 30° 的箱子。→ **[遗留待办](#遗留待办)**
5. **`Overlap.GetActor()` 没有判空**。`FOverlapResult` 内部持有的是弱引用。→ **[遗留待办](#遗留待办)**

---

# 第三节：宝箱网格体与程序化开盖动画

先纠正一个可能的误解：**这一节里根本没有"动画"**。

没有 AnimSequence，没有 Timeline，没有 Montage。所谓"盖子打开"，就是每一帧往盖子的旋转值里写一个稍微大一点的数，写 144 次，人眼看起来就是连续运动。这是最原始的**程序化动画**。

## 3.1 为什么拆成两个 StaticMeshComponent

```cpp
BaseMeshComponent = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("BaseMeshComp"));
RootComponent = BaseMeshComponent;

LidMeshComponent = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LidMeshComp"));
LidMeshComponent->SetupAttachment(BaseMeshComponent);
```

**静态网格体是刚体，你没法让它的一部分动。** 要让盖子单独转，盖子就必须是一个独立的、有自己 Transform 的组件。

门、拉杆、抽屉、宝箱这类简单机关，业界普遍都是这么做的——**组件层级 + 变换操作**，比骨骼动画便宜得多，也不需要美术导骨骼。

对应地，资产也要拆成两个：`SM_Chest_Bottom` 和 `SM_Chest_Lid`。

## 3.2 `RootComponent = BaseMeshComponent` 这句不能省

和第二章的投射物一样，但原因值得再强调一次：

- `ACharacter` 的根组件（胶囊体）是父类已经建好的，你不用管；
- **纯 `AActor` 的 `RootComponent` 默认是 `nullptr`**。

不指定根组件的后果：`SetupAttachment` 会挂空，Actor 没有有效的世界变换，放进关卡后位置行为诡异。

顺带记住一条推论：**Actor 的位置就是根组件的位置**。所以第二节点积检测里拿到的 `Chest->GetActorLocation()`，其实是 `BaseMeshComponent` 的原点。

> 构造函数里直接写 `RootComponent = BaseMeshComponent;` 是标准写法。运行时要换根组件才需要 `SetRootComponent()`（它多做了一些注册与变换保持的工作）。

## 3.3 `Tick` 里的三行

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
	}
}
```

三行分别是：**算这一帧应该转到哪 → 写进去 → 检查到没到**。

`FInterpConstantTo` 的语义是"每秒匀速前进 `InterpSpeed` 个单位"。配置是速度 50、目标 120，所以开盖恰好耗时 `120 / 50 = 2.4` 秒。

内部实现大致是：

```cpp
const T Dist = Target - Current;
if (FMath::Square(Dist) < SMALL_NUMBER) { return Target; }   // 足够近就直接落到目标
const float Step = InterpSpeed * DeltaTime;
return Current + FMath::Clamp(Dist, -Step, Step);            // 否则前进一个受限的步长
```

`DeltaTime` 乘进去就是**帧率无关**的来源：30 帧时每帧走 1.67 度，144 帧时每帧走 0.35 度，墙上时钟看到的都是 2.4 秒。

> **这是 Tick 里所有"随时间变化"逻辑的铁律**：任何速率量都必须乘 `DeltaTime`。忘了乘，游戏在高刷屏上就会快得离谱。

## 3.4 `FInterpConstantTo` 还是 `FInterpTo`

这是本节最值得记住的细节，因为**插值函数的选择和退出条件是耦合的**。

| | `FInterpConstantTo` | `FInterpTo` |
|---|---|---|
| 数学形式 | 每帧走固定步长 | `Current + (Target-Current) * Clamp(DT*Speed, 0, 1)` |
| 曲线 | 匀速直线 | 指数缓出（先快后慢） |
| 能否精确到达 | **能**，最后一步 clamp 后直接返回 `Target` | **不能**，渐近逼近，数学上永远差一点 |
| 手感 | 机械、可预测 | 自然、有质感 |
| 适合 | 需要精确终止的机关、匀速旋转 | 摄像机跟随、UI 缓动、瞄准辅助 |

如果换成 `FInterpTo`，`IsNearlyEqual` 的默认容差是 `UE_KINDA_SMALL_NUMBER`（`1e-4`），而指数逼近的最后那一段极慢——盖子看起来早就停了，Tick 却还在空转好一阵子才肯关掉。

`FInterpConstantTo` 在剩余距离小于一步时直接返回 `Target`，差值精确变成 0，所以 `IsNearlyEqual` **必然在到达的那一帧成立**。

> 想要缓出手感又要精确终止，常见做法是：用 `FInterpTo` 做插值，但退出条件改成"总时长计时器到点"或者手动放宽容差（`IsNearlyEqual(A, B, 0.5f)`）。

## 3.5 相对旋转与旋转中心

```cpp
LidMeshComponent->SetRelativeRotation(FRotator(CurrentAnimationPitch, 0.f, 0.f));
```

**为什么是 `SetRelativeRotation` 而不是 `SetWorldRotation`？**

相对旋转是相对**父组件**（也就是 `BaseMeshComponent`）的。这样你把整个宝箱在关卡里摆成任意角度，盖子依然沿着宝箱自己的合页轴开。用世界旋转的话，一旦摆放角度不是默认的就全乱了。

这个"相对"之所以有意义，正是因为构造函数里那句 `SetupAttachment` 建立了父子关系。

**`FRotator(Pitch, Yaw, Roll)` 的参数顺序**是 UE 最经典的陷阱之一——不是直觉上的 Roll-Pitch-Yaw：

| 分量 | 绕哪个轴 | 直观含义 |
|---|---|---|
| `Pitch` | Y 轴 | 抬头 / 低头 |
| `Yaw` | Z 轴 | 左转 / 右转 |
| `Roll` | X 轴 | 侧倾 |

盖子绕 Y 轴翻起，所以填 Pitch。

### 旋转中心：不在代码里，在蓝图里

**组件永远绕自己的原点旋转。** 所以 `LidMeshComponent` 在 `BP_ItemChest` 里被设置了相对位置 `(-35, 0, 50)`——这个偏移把盖子的旋转中心挪到了合页那条边上。

如果 `SM_Chest_Lid` 这个资源的原点在网格中心，又不设这个偏移，盖子就会绕着自己中间翻跟头。想验证的话把 Z 改成 0 跑一次，效果一目了然。

> **通用规律**：程序化动画里，"转起来对不对"有一半取决于**资产原点**和**组件相对位置**，而不是代码。调不出效果时先去蓝图看这两个值。

## 3.6 Tick 的三个开关

![宝箱 Actor 的 Tick 开关生命周期](/img/posts/ue5-ch3/ue5-ch3-tick.svg)

```cpp
PrimaryActorTick.bCanEverTick = true;
PrimaryActorTick.bStartWithTickEnabled = false;
```

三个东西各管一件事，用装灯打比方：

| 开关 | 比喻 | 何时设置 | 说明 |
|---|---|---|---|
| `bCanEverTick` | 这个房间要不要装灯 | **只能在构造函数** | `false` 时引擎压根不注册 Tick 函数 |
| `bStartWithTickEnabled` | 通电瞬间灯是开还是关 | 构造函数 | 函数已注册，只是初始状态为关 |
| `SetActorTickEnabled()` | 墙上那个开关 | 运行时任意 | 随时可以拨 |

**最关键的一条**：`bCanEverTick = false` 时，`SetActorTickEnabled(true)` **完全没用**。引擎源码里的实现是：

```cpp
void AActor::SetActorTickEnabled(bool bEnabled)
{
	if (!IsTemplate() && PrimaryActorTick.bCanEverTick)
	{
		PrimaryActorTick.SetTickFunctionEnable(bEnabled);
	}
}
```

第一句就在检查 `bCanEverTick`，不满足直接 return。这是"为什么我的 Tick 不跑"的头号原因。

### 为什么要费这个劲

因为 Tick 是有成本的。关卡里放 200 个宝箱，如果它们全都无脑 Tick，就是每帧 200 次浮点插值 + 200 次 `SetRelativeRotation`（后者还会触发变换更新链和渲染状态标脏）。而实际上 99% 的时间它们什么都不用做。

**只在真正需要动的那 2.4 秒里 Tick**，这是性能上最划算的一笔交易。

组件也有对应的一套：`PrimaryComponentTick.bCanEverTick` / `SetComponentTickEnabled()`。另外还有 `PrimaryActorTick.TickInterval`（限频，比如 0.1 表示每秒最多 10 次）和 `SetActorTickInterval()`。

### 在 Tick 里关掉自己的 Tick

```cpp
if (FMath::IsNearlyEqual(CurrentAnimationPitch, AnimationTargetPitch))
{
	SetActorTickEnabled(false);
}
```

这在 UE 里是完全合法的。引擎不会立刻把你从当前帧的执行中拽出来，只是把这个 Tick 函数标记为**下一帧不再调用**。当前 `Tick()` 函数体会正常执行到结尾。

## 3.7 本节的脚手架：`BeginPlay` 里的 `SetActorTickEnabled(true)`

课程在这一节写了：

```cpp
void ARogueItemChest::BeginPlay()
{
	Super::BeginPlay();
	SetActorTickEnabled(true);
}
```

**这会导致游戏一开始宝箱就自己打开。** 构造函数里 `bStartWithTickEnabled = false` 的意图明明是"不要一开始就动"，`BeginPlay` 立刻把它打开了，两句自相矛盾。

这不是错误，是 Tom 故意留的**脚手架**——为了不写交互就能先看到动画效果。第四节接上接口之后，这句会被搬进 `Interact()`，`BeginPlay` 的重写整个删掉。

> 记录这类"临时代码"很重要。半年后回看，如果博客里只有最终代码，你会想不起中间为什么绕了这么一圈。

## 3.8 `CurrentAnimationPitch` 为什么没有 `UPROPERTY`

```cpp
float CurrentAnimationPitch = 0.0f;                    // 没有 UPROPERTY

UPROPERTY(EditAnywhere, Category="Animation")
float AnimationTargetPitch = 120.f;                    // 有

UPROPERTY(EditAnywhere, Category="Animation")
float AnimationSpeed = 50.f;                           // 有
```

三个变量的性质不同：

| 变量 | 性质 | 谁该改它 |
|---|---|---|
| `AnimationTargetPitch` | **配置** | 策划，在编辑器里调 |
| `AnimationSpeed` | **配置** | 策划，在编辑器里调 |
| `CurrentAnimationPitch` | **运行时状态** | 只有代码 |

配置需要暴露给编辑器，所以要 `UPROPERTY(EditAnywhere)`；运行时状态不需要。

那不加 `UPROPERTY` 的代价是什么？

- 不参与序列化（存档/网络同步都拿不到它）
- 不会出现在蓝图和编辑器里
- **如果它是 UObject 指针，不受 GC 保护**（这一条在第四节的 `SelectedActor` 上是致命的）

因为它只是个 `float`，这三条在这里都无所谓。但**判断标准要记牢：这个成员是不是指向 UObject。** 是的话必须加 `UPROPERTY()`，哪怕括号里空着。

---

# 第四节：交互接口与输入串联

这一节课程分成上下两半，是整章的核心。上半解决"交互组件怎么跟宝箱说话"，下半解决"按键怎么触发这件事"。

## 4.1 上半：没有接口的世界

先设想没有接口会怎样。交互组件拿到目标之后要开宝箱，只能写：

```cpp
ARogueItemChest* Chest = Cast<ARogueItemChest>(BestActor);
if (Chest) { Chest->OpenLid(); }
```

然后加了门，再来一段 `Cast<ARogueDoor>`。加了 NPC，再来一段。三个月后这个函数里有二十个 `Cast`，而且**交互组件必须 `#include` 每一个可交互物体的头文件**——一个玩家输入模块，反过来依赖了全世界。

接口把这条依赖翻了过来。

![交互接口的依赖关系](/img/posts/ue5-ch3/ue5-ch3-interface.svg)

注意箭头方向：**宝箱指向接口，而不是组件指向宝箱**。交互组件的 cpp 里从头到尾没有 `#include "RogueItemChest.h"`。以后加一百种可交互物体，这个文件一行都不用改。

这就是"面向接口编程"（也叫依赖倒置），是这一章继"拆组件"之后的第二个结构性教训。

## 4.2 `UInterface` 的双类结构

用 Rider 的 Unreal 类向导，父类选 `Interface`，会在一个文件里生成**两个类**：

```cpp
// RogueInteractionInterface.h
UINTERFACE(MinimalAPI)
class URogueInteractionInterface : public UInterface
{
	GENERATED_BODY()
};

class ACTIONROGUELIKE_API IRogueInteractionInterface
{
	GENERATED_BODY()
public:
	virtual void Interact() = 0;
};
```

这是 UE 里最反直觉的一处设计：

| 类 | 前缀 | 作用 | 你要不要碰它 |
|---|---|---|---|
| `URogueInteractionInterface` | `U` | 空壳，唯一作用是让反射系统知道"世界上存在这么一个接口" | **永远不继承、不实现** |
| `IRogueInteractionInterface` | `I` | 真正的接口，装函数声明 | **继承它、实现它、调用它** |

为什么要搞两个？因为 UE 的反射系统只认识 `UObject` 派生类，需要一个 `UClass` 对象来登记"接口"这个概念；但 C++ 的多重继承要求接口本身是个轻量的抽象类，不能也是 `UObject`（否则会有菱形继承和双份 `UObject` 数据）。于是拆成两个：一个进反射系统，一个进继承链。

**记忆规则：继承和调用用 I 类，查询反射系统用 U 类。**

`UINTERFACE(MinimalAPI)` 里的 `MinimalAPI` 表示只导出最小必要的符号（`StaticClass()` 等），减少 DLL 导出表体积。因为 U 类本来就是空壳，没有别的东西需要导出。

## 4.3 宝箱实现接口

```cpp
UCLASS()
class ACTIONROGUELIKE_API ARogueItemChest : public AActor, public IRogueInteractionInterface
{
	GENERATED_BODY()
public:
	virtual void Interact() override;
	// ...
};
```

```cpp
void ARogueItemChest::Interact()
{
	// 开始播放动画
	SetActorTickEnabled(true);
}
```

**注意继承顺序**：`AActor` 必须在前。UE 的约定是主父类（UObject 派生）放第一位，接口跟在后面。UHT 依赖这个顺序生成正确的反射代码。

同时，第三节那个 `BeginPlay` 脚手架现在可以删掉了——开盖的触发点正式移交给 `Interact()`。

## 4.4 `Cast<I>` 与 `Implements<U>`：一个会静默失效的坑

课程里的调用是：

```cpp
IRogueInteractionInterface* InteractInterface = Cast<IRogueInteractionInterface>(SelectedActor);
if (InteractInterface)
{
	InteractInterface->Interact();
}
```

这句现在能跑，但它有个限制：**`Cast<I接口>` 只能找到 C++ 里实现的接口**。

假设以后做了一个 `BP_Door`，在蓝图的类设置里勾上这个接口、在蓝图里实现 `Interact`——这句 `Cast` 会返回 `nullptr`。门纹丝不动，日志里一个字都不报。这类"没报错但就是不工作"的 bug 最难查。

原因是：蓝图实现的接口在 C++ 层面根本没有那个 `I` 类的对象指针，它只在反射系统里注册了一条"这个类实现了 `URogueInteractionInterface`"的记录。

正确的通用查询方式走反射：

```cpp
if (SelectedActor->Implements<URogueInteractionInterface>())   // 注意传的是 U 类
{
	IRogueInteractionInterface::Execute_Interact(SelectedActor);
}
```

三种写法的对照：

| 写法 | 找得到 C++ 实现 | 找得到蓝图实现 | 前置条件 |
|---|---|---|---|
| `Cast<IXxx>(Actor)` | ✓ | **✗** | 无 |
| `Actor->Implements<UXxx>()` | ✓ | ✓ | 接口函数需为 `UFUNCTION` |
| `Actor->GetClass()->ImplementsInterface(UXxx::StaticClass())` | ✓ | ✓ | 同上 |

## 4.5 纯虚函数 vs `BlueprintNativeEvent`

课程当前的写法是纯 C++ 虚函数：

```cpp
virtual void Interact() = 0;
```

它上面**没有 `UFUNCTION()`**，意味着反射系统看不见它。这个接口目前是"纯 C++ 俱乐部"——蓝图里既没法实现它，也没法调用它。

UE 里接口函数的标准写法是：

```cpp
UFUNCTION(BlueprintNativeEvent)
void Interact(APawn* InstigatorPawn);
```

三种 `UFUNCTION` 变体的区别：

| 说明符 | C++ 能否提供默认实现 | 蓝图能否覆盖 | C++ 侧写在哪 |
|---|---|---|---|
| （纯虚，无 UFUNCTION） | 必须提供 | ✗ | `Interact()` |
| `BlueprintImplementableEvent` | **不能** | 必须 | 无 |
| `BlueprintNativeEvent` | 可以 | 可以 | `Interact_Implementation()` |

`BlueprintNativeEvent` 的代价是**调用方式必须换成 `Execute_Interact()`**：

```cpp
IRogueInteractionInterface::Execute_Interact(SelectedActor, MyPawn);
```

UHT 会自动生成这个 `Execute_` 静态函数，它内部会先查蓝图有没有覆盖、没有再走 C++ 实现。

> **这是 UE 接口最大的坑**：如果用了 `BlueprintNativeEvent` 却直接调虚函数 `InteractInterface->Interact()`，**蓝图里的实现会被静默跳过**，不报错、不警告，只是没反应。

另外，Tom 原版的签名是 `Interact(APawn* InstigatorPawn)`——宝箱需要知道是谁打开了它。想想什么时候会用上：需要钥匙的门、只有特定阵营能用的终端、要给拾取者加分的物品。**加参数是接口最贵的改动之一**，因为所有实现方都得跟着改，所以早点想清楚划算。

## 4.6 下半：`SelectedActor` 是两条时间线的接头

上半节课程把 `Interact()` 的调用直接写在了 `TickComponent` 里。这会导致：走到宝箱前面还没按 E，宝箱就自己开了；`Interact()` 每秒被调用 60 次；宝箱 Tick 关掉自己后又被下一帧重新打开，反复开关。

下半节的修正是本节的架构精华：

> **Tick 的职责是"持续找出当前聚焦的目标"，按键的职责是"对当前聚焦的目标发动交互"。**

这两件事的频率差了几个数量级——一个每帧，一个几秒才一次——塞在同一个函数里，按键就永远没机会插手。

于是 `BestActor` 从局部变量提升为成员变量：

```cpp
UPROPERTY()
TObjectPtr<AActor> SelectedActor;
```

`TickComponent` 的最后一步变成把结果存进 `SelectedActor`，而新增的 `Interact()` 负责读它：

```cpp
void URogueInteractionComponent::Interact()
{
	IRogueInteractionInterface* InteractInterface = Cast<IRogueInteractionInterface>(SelectedActor);
	if (InteractInterface)
	{
		InteractInterface->Interact();
	}
}
```

> **这个"每帧算出的结果存起来给别处用"的模式，是所有聚焦系统、锁定系统、UI 高亮提示的共同骨架。** 想清楚这一步，后面加描边、加"按 E 开启"的提示文字都是顺水推舟。

> **务必检查**：`SelectedActor` 现在是成员变量，**不会自己清零**。如果 `TickComponent` 开头没有 `SelectedActor = nullptr;`（或者没有把局部的 `BestActor` 无条件赋值过去），那么走开之后它会保留上一次的值——你可以在地图另一头按 E 开启一个看不见的宝箱。

## 4.7 `UPROPERTY()` 那个空括号别删

```cpp
UPROPERTY()
TObjectPtr<AActor> SelectedActor;
```

没有任何说明符，看起来像废话，其实很关键：**它让垃圾回收器知道这个指针的存在**。

场景：你聚焦着一个宝箱，`SelectedActor` 指向它，这时宝箱被销毁了（爆炸、被捡走、关卡流送卸载）。

- 有 `UPROPERTY()`：引擎在 GC 时自动把这个指针置空，下次按 E 走 `if` 的 false 分支，什么也不发生。
- 没有：它变成野指针，下次按 E 直接崩溃，而且崩溃点离真正的原因十万八千里。

对比第三节的 `CurrentAnimationPitch`——那是个 `float`，没有对象生命周期问题，不加也无所谓。**判断标准：这个成员是不是指向 UObject。**

`TObjectPtr<>` 是 UE5 引入的包装类型，在编辑器构建下提供访问追踪（用于延迟加载和资产依赖分析），在打包构建下会退化成裸指针，零开销。新代码一律用它。

## 4.8 三层 `Interact` 的职责划分

串联完成后，代码里会出现三个几乎同名的函数。**这是本节最容易把人绕晕的地方**，务必分清：

| 层 | 函数 | 它负责回答 |
|---|---|---|
| `ARoguePlayerController` | `StartInteract()` | **玩家想干这件事了**（输入层） |
| `URogueInteractionComponent` | `Interact()` | **对谁干**（目标选择层） |
| `ARogueItemChest` | `Interact()` | **干了会怎样**（响应层） |

每一层都不知道另外两层的内部细节：PC 不知道当前聚焦的是什么，组件不知道宝箱会开盖子，宝箱不知道是键盘还是手柄触发的。

收益很具体：

| 需求变更 | 只需要改 |
|---|---|
| 换成手柄 X 键 | `IMC_Default` 资源 |
| 改成"离得最近"而不是"最正对" | 组件的 `TickComponent` |
| 加一扇门 | 门自己的 `Interact()` |

> **强烈建议把中间那层改名**为 `PrimaryInteract()` 或 `TryInteract()`。三层变成 `StartInteract` → `PrimaryInteract` → `Interact`，一眼能看出谁是谁。Tom 原版用的就是 `PrimaryInteract`（"主交互键"的意思，为以后可能的次要交互键留了命名空间）。

## 4.9 `SetupInputComponent` 与绑定

```cpp
// RoguePlayerController.h
UPROPERTY(EditDefaultsOnly, Category="Input")
TObjectPtr<UInputAction> Input_Interact;

virtual void SetupInputComponent() override;
void StartInteract();
```

```cpp
// RoguePlayerController.cpp
void ARoguePlayerController::SetupInputComponent()
{
	Super::SetupInputComponent();

	UEnhancedInputComponent* EnhancedInput = Cast<UEnhancedInputComponent>(InputComponent);
	EnhancedInput->BindAction(Input_Interact, ETriggerEvent::Triggered,
	                          this, &ARoguePlayerController::StartInteract);
}

void ARoguePlayerController::StartInteract()
{
	InteractionComponent->Interact();
}
```

### 为什么绑定放在 `SetupInputComponent`

`APlayerController::SetupInputComponent()` 由引擎在 `InitInputSystem()` 阶段调用，此时 `InputComponent` 刚被创建好。这是 PC 侧绑定输入的标准位置，对应 Pawn 侧的 `SetupPlayerInputComponent()`。

**Enhanced Input 的映射上下文（IMC）在哪加不影响这里**——IMC 是注册在 `UEnhancedInputLocalPlayerSubsystem` 上的，属于 LocalPlayer 级别。第一章在 Character 的 `BeginPlay` 里 `AddMappingContext`，那个上下文里的所有 IA 在 PC 和 Pawn 上都能绑。

### `ETriggerEvent::Triggered` 与 IA 资源的耦合

`IA_Interact` 的配置是：

```text
值类型（Value Type）:  Digital (bool)
触发器（Triggers）:    [0] Pressed
```

加了「已按下」触发器后，`ETriggerEvent::Triggered` 只在按下那一帧发一次。

**但这是一个隐性依赖**：如果哪天有人把那个触发器删了，`Triggered` 就会在按住期间**每帧触发**，宝箱会被反复 `Interact`。也就是说，C++ 代码的正确性依赖于一个策划能随手改的资源配置。

`ETriggerEvent` 六种事件的语义回顾：

| 事件 | 何时触发 |
|---|---|
| `Started` | 从"无输入"变为"有输入"的那一帧，**不依赖触发器配置** |
| `Ongoing` | 触发器条件正在评估中（如 Hold 蓄力期间） |
| `Triggered` | 触发器条件**满足**（无触发器时 = 每帧只要有输入） |
| `Completed` | 触发过程结束 |
| `Canceled` | 触发过程被中断（如 Tap 超时） |
| `Ended` | 输入完全归零 |

对"按一下就生效"的交互，`Started` 是更稳的选择——它的语义不依赖触发器配置。

> 这个坑和第二章"按住鼠标喷出几百个球"是同一类错误的两个入口。第二章是在触发器上踩的，这里是在 `ETriggerEvent` 上。

### 一处裸解引用

```cpp
UEnhancedInputComponent* EnhancedInput = Cast<UEnhancedInputComponent>(InputComponent);
EnhancedInput->BindAction(...);   // 没判空
```

`Cast` 失败会返回 `nullptr`，下一行立刻解引用。什么情况下会失败？`项目设置 → 输入 → Default Input Component Class` 不是 `EnhancedInputComponent` 的时候。

这里更合适的是 `CastChecked`（和交互组件里对 `GetOwner()` 的处理保持一致）——项目配置错误应该立刻大声崩，而不是留一个空指针慢慢发作。

## 4.10 完整调用链

![交互系统完整调用链](/img/posts/ue5-ch3/ue5-ch3-callchain.svg)

**两条线的频率完全不同**——左边每秒 60 次，右边可能几秒才一次。它们唯一的接头就是中间那个 `SelectedActor`。

## 4.11 蓝图三件套与 `EditDefaultsOnly` 的真正用途

本节还创建了 `BP_GameMode` / `BP_PlayerController` / `BP_playerCharacter` 三个蓝图，配置链变成：

```text
项目设置 → BP_GameMode → BP_PlayerController → C++ 的 ARoguePlayerController
                       → BP_playerCharacter  → C++ 的 ARoguePlayerCharacter
```

中间这层蓝图的唯一存在意义，就是给一个**不用重编译就能改东西的地方**。

这也终于回答了第一节留下的问题——`EditDefaultsOnly` 到底在哪起作用：

```cpp
UPROPERTY(EditDefaultsOnly, Category="Input")
TObjectPtr<UInputAction> Input_Interact;
```

C++ 里只说"我需要一个输入动作"，**完全不提 `IA_Interact` 这个资源的名字或路径**。具体是哪个资源，在 `BP_PlayerController` 的默认值面板里填。

如果写成 `VisibleAnywhere`，这个格子就是只读的，你根本没法在蓝图里塞资源进去。

**这就是贯穿全课程的"C++ 定契约，蓝图填数据"模式。** 本章的实例：

| C++ 声明 | 蓝图赋值 |
|---|---|
| `TObjectPtr<UInputAction> Input_Interact` | `IA_Interact` |
| `TObjectPtr<UStaticMeshComponent> BaseMeshComponent` 的 Static Mesh | `SM_Chest_Bottom` |
| `TObjectPtr<UStaticMeshComponent> LidMeshComponent` 的 Static Mesh | `SM_Chest_Lid` |
| `PlayerControllerClass`（GameMode 默认值） | `BP_PlayerController` |
| `DefaultPawnClass`（GameMode 默认值） | `BP_playerCharacter` |

## 4.12 小插曲：`Build.cs` 的 `PublicIncludePaths`

```csharp
PublicIncludePaths.Add("ActionRoguelike");
```

作用是给编译器多一个头文件搜索起点，于是可以写：

```cpp
#include "Player/RoguePlayerController.h"          // 而不是
#include "ActionRoguelike/Player/RoguePlayerController.h"
```

两个副作用值得知道：

1. **改完 `Build.cs` 需要重新生成项目文件**才会在 IDE 里生效，否则 Rider 会一直标红。
2. 它是 **Public**，意味着以后依赖本模块的其它模块也会继承这些搜索路径。单模块项目里无所谓，多模块时要注意别污染下游。

> 现代 UE 推崇 IWYU（Include What You Use），有些团队反而倾向保留完整路径以提高可读性和避免歧义。这是个团队风格选择，没有绝对对错。

---

# 第五节：自定义碰撞检测通道

这一节做的事情比看起来重要——**从"黑名单"切换到了"白名单"**，这是碰撞过滤的核心思路转变。

## 5.1 先分清两个同名的东西

Tom 让它们同名是为了方便，但它们是两个层面的东西：

| | 检测通道 `Interaction` | 碰撞预设 `Interaction` |
|---|---|---|
| 是什么 | 在碰撞响应矩阵里新增一**列** | 一个命名的配置包，一次性填好某个物体的一整**行** |
| 在哪配 | 项目设置 → 碰撞 → Trace Channels | 项目设置 → 碰撞 → Preset |
| 谁用它 | 查询函数（`OverlapMultiByChannel` 的 `TraceChannel` 参数） | 碰撞组件（`SetCollisionProfileName`） |

**新建检测通道时最关键的一步是「默认响应」选「忽略」**（图中那一行）。

## 5.2 从黑名单到白名单

![自定义检测通道的白名单过滤](/img/posts/ue5-ch3/ue5-ch3-collision.svg)

因为新通道的默认响应是「忽略」，世界上所有已存在的物体——木桶、墙、地板、玩家胶囊体——自动对这个通道视而不见，**你一个都不用改**。

| | `ECC_Visibility` 通道 | `Interaction` 通道 |
|---|---|---|
| 木桶 / 墙 / 地板 | 阻挡 | **忽略**（新通道默认值） |
| 玩家胶囊体 | 阻挡 | **忽略** |
| 宝箱底座 | 阻挡 | **重叠** ← 全场唯一响应的 |
| 宝箱盖子 | 无碰撞 | 无碰撞 |

`OverlapMultiByChannel` 问的问题是"**对这个通道**，谁的响应是重叠或阻挡"。答案现在只有宝箱底座一个。

对比第二节用 `ECC_Visibility` 的时候：那个通道的语义是"能不能被看见"，所有静态网格体默认都阻挡它，所以球体捞回来一堆垃圾。

| | 黑名单（`ECC_Visibility`） | 白名单（`Interaction`） |
|---|---|---|
| 默认状态 | 大家都参与 | 大家都不参与 |
| 要做的工作 | **逐个排除**不想要的 | 只标记想要的 |
| 加新装饰物时 | 可能要改代码或加忽略 | **零工作量** |
| 出错模式 | 静默混入垃圾 | 忘标记 → 那个物体不可交互（明显） |

**白名单的出错模式远比黑名单友好**：忘标记的后果是"这个宝箱按 E 没反应"，很容易发现；黑名单混入垃圾的后果是"偶尔会选中墙"，极难复现。

## 5.3 为什么是检测通道，不是对象类型

这个决策接上第二章整理的碰撞三层模型：

| | 对象类型（Object Type） | 检测通道（Trace Channel） |
|---|---|---|
| 回答的问题 | 我**是**什么 | 这次查询**为了什么** |
| 每个组件有几个 | **只能有一个** | 对每一个通道都有一条响应 |
| 自定义上限 | 两者共享 18 个 | 同左 |
| 查询函数 | `...ByObjectType` | `...ByChannel` |

**"可交互"不是一个身份，是一种用途。** 宝箱是 WorldDynamic 且可交互，门可能是 WorldStatic 且可交互，NPC 是 Pawn 且可交互。

如果把"可交互"做成对象类型，物体就得放弃自己真正的身份，物理和移动碰撞立刻全乱——比如宝箱不再是 WorldDynamic，角色的移动扫掠就不会正确处理它。

> **一句话记法：身份只有一个，用途可以有很多个。**

## 5.4 `RogueEngineTypes.h` 与宏定义

```cpp
// Source/ActionRoguelike/RogueEngineTypes.h
#pragma once

#define COLLISION_INTERACTION ECC_GameTraceChannel1
```

```cpp
// 使用处
ECollisionChannel CollisionChannel = COLLISION_INTERACTION;
```

`ECC_GameTraceChannel1` 这个名字毫无信息量。它到底是哪个通道，答案不在代码里，而在 `DefaultEngine.ini` 里：

```ini
[/Script/Engine.CollisionProfile]
+DefaultChannelResponses=(Channel=ECC_GameTraceChannel1,DefaultResponse=ECR_Ignore,bTraceType=True,bStaticObject=False,Name="Interaction")
```

**引擎只认序号，"Interaction" 这个名字只是编辑器给你看的皮肤。**

所以这个宏做的是：**把"序号"翻译成"含义"，并且只翻译一次**。以后全项目都写 `COLLISION_INTERACTION`，通道顺序真要调整时只改这一行。

`RogueEngineTypes.h` 这种"没有类、只有项目级定义"的头文件，在稍大的项目里很常见，专门放这类跨模块共享的常量、枚举、结构体。

### 两个值得想的点

**1. `#define` 不是最好的 C++ 写法。** 预处理器替换没有类型、不受命名空间约束、调试器里看不到。更现代的写法是：

```cpp
constexpr ECollisionChannel COLLISION_INTERACTION = ECC_GameTraceChannel1;
```

UE 官方示例（比如 ShooterGame 的 `COLLISION_WEAPON`）用的是 `#define`，Tom 是在跟惯例。两种写法都该知道，以及知道为什么惯例是那样（历史原因 + 需要在预处理阶段可用）。

**2. 这个宏和 ini 之间没有任何编译期约束。** 如果有人在项目设置里删掉又重建通道，导致 Interaction 变成了 `ECC_GameTraceChannel2`，这个宏会**静默指向错误的通道**，编译照过，运行时交互失效且不报错。

同理，`SetCollisionProfileName("Interaction")` 里那个字符串打错也只会在日志里留条警告。

> **这类"字符串/配置与代码的脆弱耦合"是 UE 项目里最难查的一类 bug。** 遇到"代码看起来完全正确但就是不工作"，优先怀疑这一层。

## 5.5 宝箱的碰撞配置

```cpp
BaseMeshComponent = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("BaseMeshComp"));
BaseMeshComponent->SetCollisionProfileName("Interaction");
RootComponent = BaseMeshComponent;

LidMeshComponent = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LidMeshComp"));
LidMeshComponent->SetCollisionProfileName("NoCollision");
LidMeshComponent->SetupAttachment(BaseMeshComponent);
```

**盖子为什么是 `NoCollision`？** 两个理由，第二个更重要：

1. **避免重复命中。** 如果盖子也用 Interaction 预设，重叠查询会返回两个组件，但 `Overlap.GetActor()` 都是同一个宝箱。循环会对同一个宝箱算两次点积、画两个框、比较两次。不会崩，但纯属浪费。
2. **盖子是会动的。** 它每帧旋转 120° 中的一小步。一个带碰撞的活动几何体意味着：每帧的物理状态更新、可能把玩家或物理物体顶飞、碰撞形状在空间中扫过。而盖子纯粹是视觉表现，它的"存在感"由底座代表就够了。

> **通用习惯：能动的东西默认不要带碰撞，除非你确实需要它撞到什么。** 这能省掉很多莫名其妙的 bug。

## 5.6 顺手解决的一个老问题

第二节留下的隐患之二——"重叠结果里可能包含玩家自己"——现在自动消失了：玩家胶囊体对 Interaction 通道是默认的忽略。

但这里有个值得想的问题：**还需不需要 `FCollisionQueryParams::AddIgnoredActor`？**

答案是"看情况"。如果以后玩家角色本身也变成可交互的（比如多人游戏里可以扶起队友），那么玩家就会对 Interaction 通道有响应，自己又会回到结果里。

**通道过滤解决的是"哪一类物体参与这种查询"，忽略列表解决的是"这一次查询要排除哪个具体实例"。** 两者是不同层面的工具，不能互相替代。

---

# 第六节：重构与核心重定向

这一节内容很少但概念很干净：把 `RogueCharacter` 的 `.h/.cpp` 移到 `Player/` 文件夹，并改名为 `RoguePlayerCharacter`。

Rider 弹窗询问是否添加 Core Redirect，勾选后 `DefaultEngine.ini` 里多了一行：

```ini
[CoreRedirects]
+ClassRedirects=(OldName="/Script/ActionRoguelike.RogueCharacter",NewName="/Script/ActionRoguelike.RoguePlayerCharacter")
```

## 6.1 为什么重定向里没有文件夹信息

这是本节最值得问的问题：**我明明既移动了文件夹又改了名，为什么重定向里只体现了改名？**

看那条路径的结构：`/Script/ActionRoguelike.RogueCharacter`

| 片段 | 含义 |
|---|---|
| `/Script/ActionRoguelike` | **包名**。对原生 C++ 类来说，包 = **模块**，不是文件夹 |
| `.RogueCharacter` | **类名** |

反射系统认的就是这两样东西。`Source/ActionRoguelike/Player/` 这层目录结构，对 UE 的对象系统来说**完全不存在**——它只影响两件事：`#include` 写什么路径、IDE 里文件显示在哪。编译产物里没有任何地方记录"这个类的源文件曾经在哪个子目录"。

所以：

| 操作 | 类路径变了吗 | 需要重定向吗 |
|---|---|---|
| 文件从根目录移到 `Player/` | 没变 | **不需要** |
| `RogueCharacter` → `RoguePlayerCharacter` | 变了（后半段） | 需要 `+ClassRedirects` |
| 模块 `ActionRoguelike` 改名 | 变了（前半段） | 需要 `+PackageRedirects` |

Rider 只生成了改名那一条，是对的。

> **一个细节**：重定向里写的是 `RogueCharacter`，不是 `ARogueCharacter`。`A`/`U`/`F`/`I` 这些前缀纯粹是 C++ 侧的命名约定，UHT 在生成反射信息时会剥掉。这也是为什么在蓝图里搜父类时看到的是 "Rogue Player Character"。

## 6.2 资产那边恰好相反

这是最容易混的对照点：**蓝图和资源的身份证里，路径就是身份的一部分**。

```text
C++ 类:  /Script/ActionRoguelike.RoguePlayerCharacter
         └─ 模块 ─┘ └────── 类名 ──────┘        文件夹无关

资 产:  /Game/Blueprints/BP_ItemChest.BP_ItemChest
        └──── 完整内容路径 ────┘ └─ 对象名 ─┘   文件夹就是身份
```

所以在内容浏览器里把资产拖进另一个文件夹，它的路径字符串就变了。UE 会在原位置**自动留下一个隐形的重定向器对象（Redirector）**，旧引用打过来时由它转发。可以在内容浏览器里开启"显示重定向器"，然后右键"修复"来清理。

**一句话总结：**

> **C++ 类靠"模块 + 类名"识别，文件夹无关；资产靠"完整内容路径"识别，文件夹就是身份。**

## 6.3 不加这行会怎样

`BP_playerCharacter` 的父类信息在磁盘上是一个字符串 `/Script/ActionRoguelike.RogueCharacter`。改完名重新打开编辑器，引擎按这个名字去反射注册表里找——找不到。

结果不是报个错让你改，而是**蓝图静默地失去父类**：变量没了、C++ 里设的组件没了，严重时蓝图直接打不开。

同样受影响的还有：引用了这个类的关卡、`DefaultEngine.ini` 里的类设置、任何 `FSoftClassPath` / `TSubclassOf` 的序列化值。

有了重定向，加载时旧名字被翻译成新名字，一切照旧。

## 6.4 三个实用要点

**1. 重定向是加载期翻译，不改磁盘。** 加完这行之后，最好把受影响的资产（`BP_playerCharacter`、用到它的关卡）打开重新保存一遍——保存时会写入新名字，以后就不再依赖这条重定向。

**2. 但那行别删。** 你不知道谁的本地还有旧版本，也不知道有没有没重新保存到的资产。这类重定向在成熟项目的 ini 里会堆几十上百行，是历史包袱，但删的风险远大于留着的成本。

**3. `[CoreRedirects]` 不止管类。**

| 条目 | 用于 |
|---|---|
| `+ClassRedirects` | 类改名 |
| `+PropertyRedirects` | 成员变量改名 |
| `+FunctionRedirects` | `UFUNCTION` 改名 |
| `+EnumRedirects` | 枚举 / 枚举值改名 |
| `+StructRedirects` | `USTRUCT` 改名 |
| `+PackageRedirects` | 模块改名 |

> **这是重构 C++ 时最该记住的一条纪律：任何被反射系统暴露出去的名字，改动都不是纯代码行为。** 改属性名、改枚举值名，同样会打断资产引用。

保险起见，重构后全项目搜一下旧名字字符串（包括 `.ini` 和 `.uproject`），确认没有漏网的硬编码引用。

---

# 知识链路总览

## 完整时序图

```text
【启动期 · 一次性】
项目设置（DefaultEngine.ini）
  └─► BP_GameMode
        ├─► PlayerControllerClass = BP_PlayerController
        │     └─► ARoguePlayerController 构造函数
        │           └─► CreateDefaultSubobject<URogueInteractionComponent>
        │     └─► SetupInputComponent()
        │           └─► BindAction(Input_Interact, Triggered, this, &StartInteract)
        └─► DefaultPawnClass = BP_playerCharacter
              └─► PC->Possess(Pawn)

【每帧 · 60 次/秒】
URogueInteractionComponent::TickComponent
  ├─► CastChecked<APlayerController>(GetOwner())
  ├─► Center = PC->GetPawn()->GetActorLocation()          ← 胶囊体中心
  ├─► OverlapMultiByChannel(Overlaps, Center, ..., COLLISION_INTERACTION, Sphere(800))
  │        └─► 只有 SetCollisionProfileName("Interaction") 的物体会进来
  ├─► for each Overlap:
  │        ├─► Direction = (OverlapLoc - Center).GetSafeNormal()
  │        ├─► Dot = DotProduct(PC->GetControlRotation().Vector(), Direction)
  │        └─► if (Dot > Highest) → 更新擂主
  └─► SelectedActor = BestActor                            ← 两条线的接头

【按下 E · 偶尔一次】
IMC_Default 找到 IA_Interact（触发器 Pressed）
  └─► ETriggerEvent::Triggered
        └─► ARoguePlayerController::StartInteract()
              └─► URogueInteractionComponent::Interact()
                    ├─► Cast<IRogueInteractionInterface>(SelectedActor)
                    └─► InteractInterface->Interact()
                          └─► ARogueItemChest::Interact()
                                └─► SetActorTickEnabled(true)

【宝箱开盖 · 2.4 秒】
ARogueItemChest::Tick
  ├─► CurrentAnimationPitch = FInterpConstantTo(Current, 120, DeltaTime, 50)
  ├─► LidMeshComponent->SetRelativeRotation(FRotator(Pitch, 0, 0))
  └─► if (IsNearlyEqual(Current, Target)) → SetActorTickEnabled(false)
```

## 四条贯穿全章的主线

### 主线一：职责分层

本章每一次"看起来多此一举的拆分"，本质都是同一件事：**让改动的影响范围可控**。

```text
GameMode      ── 决定用哪些类           （改规则只动这里）
   │
PlayerController ── 玩家的意志、输入入口 （改按键只动 IMC）
   │
InteractionComponent ── 怎么选目标      （改筛选算法只动这里）
   │
IRogueInteractionInterface ── 契约      （加新物体不动这里）
   │
ARogueItemChest ── 被交互时做什么       （改宝箱行为只动这里）
```

对照第二章：那时候所有逻辑都堆在 `ARoguePlayerCharacter` 里，`PrimaryAttack` 直接 `SpawnActor`。能跑，但加第二个技能就要在同一个类里再塞一遍。第三章开始，这种"往一个类里堆"的写法被系统性地拆开了。

### 主线二：每帧 vs 事件

本章反复出现的一组对立：

| 每帧做的事 | 事件触发的事 |
|---|---|
| `TickComponent` 找目标 | 按 E 发动交互 |
| 宝箱 `Tick` 转盖子 | `Interact()` 打开 Tick 开关 |
| 频率固定、成本可预测 | 频率低、成本集中 |

处理原则：

1. **每帧的事只做"计算与记录"，不做"执行"**。`TickComponent` 只更新 `SelectedActor`，不调 `Interact`。
2. **每帧的事必须乘 `DeltaTime`**，否则帧率一变行为就变。
3. **不需要每帧做的事就关掉 Tick**。`bStartWithTickEnabled = false` + `SetActorTickEnabled` 是标准组合。

上半节把 `Interact()` 写进 Tick 的那个 bug，正是违反了第 1 条。

### 主线三：谁认识谁

| 关系 | 方向 | 手段 |
|---|---|---|
| GameMode → PlayerController | 单向，编译期 | `StaticClass()` / 蓝图默认值 |
| PlayerController → 交互组件 | 单向，编译期 | `CreateDefaultSubobject` |
| 交互组件 → 宝箱 | **不认识** | 通过 `IRogueInteractionInterface` |
| 交互组件 → PlayerController | 单向，运行时 | `GetOwner()` |
| 宝箱 → 任何人 | **不认识** | 只实现接口，被动响应 |

**"不认识"是设计目标，不是遗漏。** 依赖越少，可替换性越强。

### 主线四：默认值决定工作量

这条在第五节体现得最清楚，但贯穿全章：

| 设计 | 默认值 | 结果 |
|---|---|---|
| `ECC_Visibility` 通道 | 大家都 Block | 要逐个排除 → 工作量随场景增长 |
| `Interaction` 通道 | 大家都 Ignore | 只标记想要的 → 工作量恒定 |
| `bStartWithTickEnabled` | `false` | 默认不耗性能，需要时才开 |
| `UPROPERTY()` | 加了才受 GC 保护 | 默认不保护，所以必须显式加 |

**选一个让"常见情况零工作量"的默认值**，是系统设计里回报最高的决策之一。

---

# 易错点速查表

| 症状 | 最可能的原因 | 检查位置 |
|---|---|---|
| 什么都没发生，红框不出现 | 项目设置里没选自己的 GameMode | 项目设置 → 地图和模式 |
| 编译报错：`SetupAttachment` 找不到 | `UActorComponent` 没有 Transform | 组件父类 |
| Tick 完全不跑 | `bCanEverTick = false`，`SetActorTickEnabled` 是空操作 | 构造函数 |
| 一进游戏宝箱就自己开 | `BeginPlay` 里的脚手架没删 | `ARogueItemChest::BeginPlay` |
| 走近就开，E 键没用 | `Interact()` 被写在 `TickComponent` 里 | 交互组件 |
| 走开后按 E 还能开远处的宝箱 | `SelectedActor` 每帧没重置 | `TickComponent` 开头 |
| 背后的宝箱也被选中 | 点积没有阈值 | 打分循环 |
| 远处的赢过近处的 | 评分只看角度不看距离 | 打分循环 |
| 一进游戏就崩（空指针） | `PC->GetPawn()` 在 Possess 前是 null | `TickComponent` |
| 捞到一堆墙和地板 | 用了 `ECC_Visibility` 而非自定义通道 | 查询通道 |
| 自己也被算进候选 | 玩家胶囊体对该通道是 Block | 通道默认响应 / 忽略列表 |
| 同一个宝箱被算两次 | 盖子也开了 Interaction 碰撞 | `LidMeshComponent` 预设 |
| 交互完全没反应，无报错 | 通道宏与 ini 的序号对不上 | `RogueEngineTypes.h` 与 `DefaultEngine.ini` |
| 交互完全没反应，日志有 profile 警告 | `SetCollisionProfileName` 字符串打错 | 构造函数 |
| 盖子绕着自己中间翻跟头 | 旋转中心不在合页处 | 蓝图里的相对位置 / 资产原点 |
| 盖子转得飞快或极慢 | 忘了乘 `DeltaTime`，或速度单位理解错 | `Tick` |
| 高刷屏上动画明显更快 | 同上 | `Tick` |
| 盖子停了但 Tick 一直在跑 | 用了 `FInterpTo`，渐近逼近达不到容差 | 插值函数选择 |
| 按住 E 宝箱被反复触发 | IA 缺 Pressed 触发器 + 用了 `Triggered` | `IA_Interact` / `ETriggerEvent` |
| 绑定输入时崩溃 | `Cast<UEnhancedInputComponent>` 返回 null | 项目设置 → 输入 |
| 蓝图实现的接口不响应 | `Cast<IXxx>` 找不到蓝图实现 | 改用 `Implements<UXxx>()` |
| `BlueprintNativeEvent` 的蓝图实现被跳过 | 直接调虚函数而非 `Execute_Xxx()` | 调用方式 |
| 改完类名后蓝图打不开 / 变量全没了 | 缺 `[CoreRedirects]` | `DefaultEngine.ini` |
| 交互目标被销毁后按 E 崩溃 | `SelectedActor` 没加 `UPROPERTY()` | 成员声明 |

---

# 遗留待办

## ① `SelectedActor` 每帧重置

**优先级最高**，直接影响手感。

`BestActor` 原本是局部变量，每帧自动从 `nullptr` 开始。提升为成员后不再自动清零：

```cpp
void URogueInteractionComponent::TickComponent(...)
{
	// ...
	SelectedActor = nullptr;           // ← 每帧开头重置
	float HighestDotResult = -1.0f;
	for (const FOverlapResult& Overlap : Overlaps) { /* ... */ }
}
```

或者保留局部 `BestActor`，循环结束后无条件赋值 `SelectedActor = BestActor;`。后者更不容易漏。

## ② 点积阈值

现在只要球体里有东西，`SelectedActor` 就一定非空——背后的宝箱也会被选中。

```cpp
// 大致方向：只接受视线锥内的候选
if (DotResult > InteractionDotThreshold && DotResult > HighestDotResult)
```

阈值取值参考（`cos θ`）：

| 阈值 | 允许的半角 | 手感 |
|---|---|---|
| `0.0` | 90° | 太宽松，侧面的也算 |
| `0.5` | 60° | 宽松 |
| `0.7` | 45° | 常用起点 |
| `0.9` | 25° | 偏严格 |

注意第三人称的摄像机俯角会压低整体 dot 值，实际调参要在游戏里试。

## ③ 把距离纳入评分

现在 20 米外正对着的箱子会赢过 1 米外偏 30° 的。两种常见做法：

- **硬性距离门槛**：超过 `MaxInteractDistance` 的直接跳过，剩下的仍按 dot 排序。简单、可预测。
- **加权评分**：把角度和距离各自映射到 `0~1` 再加权求和。手感更细腻，但多两个要调的参数。

直接把 dot 和距离相乘通常不好用——两者量纲不同，容易被一方主导。

## ④ 三处裸解引用

```cpp
PC->GetPawn()->GetActorLocation()                    // GetPawn 可能为 null
Cast<UEnhancedInputComponent>(InputComponent)->Bind  // Cast 可能失败
Overlap.GetActor()->GetActorLocation()               // 弱引用可能失效
```

处理原则不同：

- `GetPawn()`：**正常的业务状态**（未 Possess、死亡真空期），应该判空后 `return`。
- `Cast<UEnhancedInputComponent>`：**项目配置错误**，应该用 `CastChecked` 立刻崩。
- `Overlap.GetActor()`：**正常的边界情况**，判空后 `continue`。

> 判断标准：这个 null 是"预期内会发生的"还是"发生了就说明程序结构错了"。前者判空，后者断言。

## ⑤ 接口升级为 `BlueprintNativeEvent` 并加 `InstigatorPawn`

```cpp
UFUNCTION(BlueprintNativeEvent)
void Interact(APawn* InstigatorPawn);
```

配套改动：

- 实现方从 `Interact()` 改为 `Interact_Implementation(APawn*)`
- 调用方从 `Cast<I>` + 虚函数调用，改为 `Implements<U>()` + `Execute_Interact()`

收益：蓝图可以实现可交互物体；宝箱能知道是谁打开了它（钥匙、阵营、加分）。

## ⑥ 组件的 `Interact()` 改名

三个同名 `Interact` 是本章最大的认知负担。建议改成 `PrimaryInteract()`，三层变成 `StartInteract` → `PrimaryInteract` → `Interact`。

## ⑦ 宝箱只能开不能关

到达目标后 Tick 关闭，`CurrentAnimationPitch` 停在 120 不动。要做成可开可关，需要一个运行时的"当前目标角度"变量（而不是直接改 `EditAnywhere` 的配置项）加一个 `bool bLidOpened` 状态。

## ⑧ 通道宏改用 `constexpr`

```cpp
constexpr ECollisionChannel COLLISION_INTERACTION = ECC_GameTraceChannel1;
```

有类型、能进命名空间、调试器可见。不改也能用，属于风格改进。

---

# 第三章完成检查清单

## Gameplay Framework

- [x] 创建 `ARogueGameMode`（继承 `AGameModeBase`）
- [x] 构造函数中设置 `PlayerControllerClass`
- [x] 创建 `ARoguePlayerController`（继承 `APlayerController`）
- [x] 项目设置 → 地图和模式 → 默认游戏模式指向自己的 GameMode
- [x] 创建 `BP_GameMode` / `BP_PlayerController` / `BP_playerCharacter` 三件套
- [x] GameMode 蓝图里指向蓝图子类而非 C++ 类

## 交互组件

- [x] 创建 `URogueInteractionComponent`（继承 `UActorComponent`，**不要** `SetupAttachment`）
- [x] 在 PC 构造函数里 `CreateDefaultSubobject`
- [x] `PrimaryComponentTick.bCanEverTick = true`
- [x] `InteractionRadius` 声明为 `EditDefaultsOnly`
- [x] `SelectedActor` 声明为 `UPROPERTY() TObjectPtr<AActor>`
- [ ] `SelectedActor` 每帧开头重置（待办①）
- [x] `OverlapMultiByChannel` + `FCollisionShape::SetSphere`
- [x] `GetSafeNormal()` 归一化方向向量
- [x] `DotProduct(GetControlRotation().Vector(), Direction)`
- [x] `HighestDotResult` 初始化为 `-1.0f`
- [ ] 点积阈值（待办②）
- [ ] 距离参与评分（待办③）

## 宝箱

- [x] 创建 `ARogueItemChest`（继承 `AActor`）
- [x] `BaseMeshComponent` 作为 RootComponent
- [x] `LidMeshComponent` `SetupAttachment` 到底座
- [x] `bCanEverTick = true` + `bStartWithTickEnabled = false`
- [x] 删除第三节的 `BeginPlay` 脚手架
- [x] `FInterpConstantTo` 驱动 `CurrentAnimationPitch`
- [x] `SetRelativeRotation(FRotator(Pitch, 0, 0))`
- [x] `IsNearlyEqual` 后 `SetActorTickEnabled(false)`
- [x] 蓝图里分配 `SM_Chest_Bottom` / `SM_Chest_Lid`
- [x] 蓝图里设置盖子相对位置使旋转中心落在合页

## 接口

- [x] 创建 `RogueInteractionInterface`（父类选 `Interface`）
- [x] 在 `I` 类里声明 `Interact()`
- [x] 宝箱继承 `AActor` 在前、接口在后
- [x] 宝箱 `override` 实现 `Interact()`
- [ ] 升级为 `UFUNCTION(BlueprintNativeEvent)`（待办⑤）
- [ ] 加 `APawn* InstigatorPawn` 参数（待办⑤）
- [ ] 调用改为 `Implements<U>()` + `Execute_Interact()`（待办⑤）

## 输入

- [x] 创建 `IA_Interact`（Digital 值类型 + Pressed 触发器）
- [x] 在 IMC 中映射 E 键
- [x] `UPROPERTY(EditDefaultsOnly) TObjectPtr<UInputAction> Input_Interact`
- [x] `BP_PlayerController` 里赋值 `IA_Interact`
- [x] 重写 `SetupInputComponent()` 并调用 `Super::`
- [x] `BindAction` 绑定到 `StartInteract()`
- [ ] `Cast<UEnhancedInputComponent>` 改用 `CastChecked`（待办④）

## 碰撞

- [x] 项目设置里新建检测通道 `Interaction`，默认响应设为**忽略**
- [x] 新建碰撞预设 `Interaction`（对象类型 WorldDynamic，对 Interaction 通道设为重叠）
- [x] 创建 `RogueEngineTypes.h` 并定义 `COLLISION_INTERACTION`
- [x] 交互组件的查询通道改用该宏
- [x] 底座 `SetCollisionProfileName("Interaction")`
- [x] 盖子 `SetCollisionProfileName("NoCollision")`

## 重构

- [x] `RogueCharacter` → `RoguePlayerCharacter` 并移入 `Player/`
- [x] 勾选添加 Core Redirect
- [x] 确认 `DefaultEngine.ini` 里生成 `+ClassRedirects`
- [x] 打开受影响的蓝图与关卡重新保存
- [x] 全项目搜索旧类名确认无残留

---

# 术语表

| 术语 | 含义 |
|---|---|
| **Gameplay Framework** | UE 的一套基础类分工：GameMode / GameState / PlayerController / PlayerState / Pawn / HUD |
| **GameMode** | 规则与类型配置中心，只存在于服务器，决定用哪些类 |
| **PlayerController** | 玩家本人的代理，跨越 Pawn 的生死，承载输入与 UI |
| **Pawn / Character** | 玩家或 AI 的"身体"，可被 Controller 占据 |
| **Possess** | Controller 接管某个 Pawn 的控制权 |
| **ControlRotation** | PlayerController 上的旋转，由鼠标/摇杆驱动，代表"玩家在看哪" |
| **UActorComponent** | 无 Transform 的纯逻辑组件，不参与空间层级 |
| **USceneComponent** | 有 Transform 的组件，可挂进组件树 |
| **点积（Dot Product）** | 两个单位向量的点积 = 夹角余弦，本章用于衡量"有多正对视线" |
| **Overlap 查询** | 询问"某个位置的某个形状里有什么"，区别于射线的"从 A 到 B 有什么" |
| **FCollisionShape** | 可表示球/盒/胶囊的查询形状，通过 `SetSphere` 等工厂方法构造 |
| **FInterpConstantTo** | 匀速插值，能精确到达目标 |
| **FInterpTo** | 指数缓出插值，渐近逼近，永远差一点 |
| **bCanEverTick** | Tick 能力开关，只能在构造函数设置，`false` 时运行时开关失效 |
| **bStartWithTickEnabled** | Tick 的初始状态 |
| **UInterface / IInterface** | UE 接口的双类结构：U 类进反射系统，I 类进继承链 |
| **BlueprintNativeEvent** | C++ 提供默认实现、蓝图可覆盖的函数，调用需走 `Execute_Xxx()` |
| **依赖倒置** | 高层模块不依赖具体实现，双方都依赖抽象接口 |
| **Trace Channel（检测通道）** | 描述"这次查询为了什么"，一个组件对每个通道都有一条响应 |
| **Object Type（对象类型）** | 描述"我是什么"，一个组件只能有一个 |
| **碰撞预设（Preset）** | 一组具名的碰撞配置，可全项目复用 |
| **CoreRedirects** | 加载期的名字翻译表，让旧资产能找到改名后的类/属性/函数 |
| **Redirector** | 资产移动后在原位置留下的转发对象 |
| **包（Package）** | 对 C++ 类而言 = 模块（`/Script/模块名`）；对资产而言 = 内容路径 |

---

# 参考资料

- [Epic Games：Gameplay Framework](https://dev.epicgames.com/documentation/en-us/unreal-engine/gameplay-framework-in-unreal-engine)
- [Epic Games：Game Mode and Game State](https://dev.epicgames.com/documentation/en-us/unreal-engine/game-mode-and-game-state-in-unreal-engine)
- [Epic Games：Player Controllers](https://dev.epicgames.com/documentation/en-us/unreal-engine/player-controllers-in-unreal-engine)
- [Epic Games：Components](https://dev.epicgames.com/documentation/en-us/unreal-engine/components-in-unreal-engine)
- [Epic Games：Interfaces in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/interfaces-in-unreal-engine)
- [Epic Games：Collision in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/collision-in-unreal-engine)
- [Epic Games：Collision Settings in the Project Settings](https://dev.epicgames.com/documentation/en-us/unreal-engine/collision-settings-in-the-unreal-engine-project-settings)
- [Epic Games：Actor Ticking](https://dev.epicgames.com/documentation/en-us/unreal-engine/actor-ticking-in-unreal-engine)
- [Epic Games：Enhanced Input](https://dev.epicgames.com/documentation/en-us/unreal-engine/enhanced-input-in-unreal-engine)
- [Epic Games：Core Redirects](https://dev.epicgames.com/documentation/en-us/unreal-engine/core-redirects-in-unreal-engine)
- [Tom Looman：Unreal Engine UFUNCTION Specifiers Explained](https://tomlooman.com/unreal-engine-ufunction-specifiers/)
- [Tom Looman：ActionRoguelike on GitHub](https://github.com/tomlooman/ActionRoguelike)
