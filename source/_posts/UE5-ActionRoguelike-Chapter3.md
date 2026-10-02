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
description: 完整梳理 ActionRoguelike 第三章的六节课，内容包括 GameMode、PlayerController 和 Pawn 之间的职责划分，用球体重叠和点积来筛选目标，用 Tick 驱动的程序化动画，UInterface 的双类结构与依赖倒置，从 Enhanced Input 到接口调用的完整链路，用自定义检测通道实现的白名单过滤，以及核心重定向背后的对象命名机制，并解释每一步为什么要这样写。
cover: /img/covers/UE5-ActionRoguelike-Chapter3.svg
series: UE5 ActionRoguelike
privacy: protected
sitemap: false
private_section: 课外
---

# 前言

本文是 Tom Looman《UE5 C++》第三章 **Interaction System** 的完整复盘，覆盖了课程六节课的全部内容。

本章使用的开发环境如下：

- Unreal Engine `5.6.1`
- Rider
- Visual Studio 2022 Build Tools / MSVC 编译工具链
- 项目名称：`ActionRoguelike`

本章的目标是打通一条完整的交互链路：

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

这条链路表面上只是「做一个开宝箱的功能」，但实际上它把 UE 的 Gameplay Framework 分层、组件化拆分、几何筛选算法、程序化动画、Tick 生命周期管理、UInterface 反射接口、Enhanced Input 绑定、自定义碰撞通道，以及对象命名与重定向全部串联了一遍。

它和第二章最大的区别在于，**第二章是在往 Character 上不断添加功能，而第三章开始把逻辑拆分成独立的模块**。思路上也从「编写功能」转向了「设计结构」。

六节课的分工如下：

| 节 | 主题 | 核心产出 |
| --- | --- | --- |
| 第一节 | Gameplay Framework 与骨架 | GameMode / PlayerController / 交互组件 / 宝箱类 |
| 第二节 | 目标筛选算法 | 球体重叠 + 点积打分 |
| 第三节 | 程序化开盖动画 | 双网格体结构、`FInterpConstantTo`、Tick 开关 |
| 第四节（上） | 交互接口 | `UInterface` 双类结构、依赖倒置 |
| 第四节（下） | 输入串联 | `SetupInputComponent`、`SelectedActor` 提升为成员 |
| 第五节 | 碰撞过滤 | 自定义检测通道、宏定义 |
| 第六节 | 重构与重定向 | `[CoreRedirects]`、对象路径机制 |

和前两章一样，这篇文章不只记录写了哪些代码，还会重点解释下面几个问题：

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

这一节创建了四个类，修改了一处项目设置，最后只是在屏幕上画出了一个红色的方框。所以**这一节的重点并不是代码，而是 UE 的 Gameplay Framework**。第一次学的时候可能会觉得内容很零散，这是因为 Tom 在这一节里是在打基础。

## 1.1 本节创建了什么

| 文件 | 位置 | 父类 | 作用 |
|---|---|---|---|
| `RogueInteractionComponent` | `Source/ActionRoguelike/Player/` | `UActorComponent` | 交互逻辑容器 |
| `RoguePlayerController` | `Source/ActionRoguelike/Player/` | `APlayerController` | 持有交互组件 |
| `RogueGameMode` | `Source/ActionRoguelike/Core/` | `AGameModeBase` | 指定使用哪个 PC 类 |
| `RogueItemChest` | `Source/ActionRoguelike/World/` | `AActor` | 后续几节的交互目标 |

## 1.2 `UActorComponent` 与 `USceneComponent` 的分水岭

第二章里用 `CreateDefaultSubobject` 创建出来的组件，全都是 `USceneComponent` 的子类（比如 `SphereComponent`、`NiagaraComponent` 和 `AudioComponent`）。而这一节的交互组件，继承的是更基础的 `UActorComponent`。

| | `UActorComponent` | `USceneComponent` |
|---|---|---|
| 有 Transform | ✗ | ✓ |
| 能挂进组件树 | ✗ | ✓ |
| 需要 `SetupAttachment` | **不需要，也不能** | 需要 |
| 典型用途 | 纯逻辑（血量、库存、交互、AI 行为） | 有空间位置的东西（网格体、碰撞体、特效） |

它们的继承链是 `UObject → UActorComponent → USceneComponent → UPrimitiveComponent → ...`。

> 这里第一个容易出错的地方是，写惯了第二章的代码，在创建 `UActorComponent` 时会顺手加上一句 `SetupAttachment(RootComponent)`，结果编译直接报错，因为这个函数只有 `USceneComponent` 才有。没有 Transform 的组件并不参与空间层级，所以只需要一句 `CreateDefaultSubobject` 就够了。

```cpp
ARoguePlayerController::ARoguePlayerController()
{
	InteractionComponent = CreateDefaultSubobject<URogueInteractionComponent>(TEXT("InteractionComp"));
	// 注意：这里没有也不能有 SetupAttachment
}
```

## 1.3 为什么交互组件挂在 PlayerController 上

这是本节最需要想清楚的一个设计决策。

UE 的 Gameplay Framework 把「一局游戏」拆分成了几个职责明确的角色：

| 类 | 是什么 | 生命周期 |
|---|---|---|
| `AGameModeBase` | 规则与类型配置中心，不参与任何表现 | 整局游戏，**只存在于服务器** |
| `APlayerController` | **玩家本人**的代理 | 从加入到退出，跨越 Pawn 的生死 |
| `APawn` / `ACharacter` | 玩家的**身体** | 会死、会重生、会被换掉 |
| `UActorComponent` | 挂在某个 Actor 上的一块可复用逻辑 | 随宿主 |

可以这样来记，PlayerController 代表玩家的「意志」，而 Pawn 代表玩家的「身体」。

身体可能会死亡，也可能被换成另一个角色，但玩家本人始终存在。所以：

- 属于「玩家本人」的东西放在 PC 上，比如输入映射、UI、得分和**交互意图**；
- 属于「这具身体」的东西放在 Character 上，比如移动、动画、血量和碰撞。

把交互组件放在 PC 上，有三条具体的理由：

1. **AI 敌人也是 Character**。如果把交互组件挂在 Character 上，所有的敌人都要白白背上一个永远用不到的组件。
2. **角色死亡重生时，PC 不会改变**，所以当前聚焦的目标、交互冷却这类状态都不会丢失。
3. **在多人游戏里，PC 只在自己的客户端上完整存在**，而射线检测和高亮描边都是纯粹的本地表现，放在这里最为自然。

这样做的代价是，**PC 自己并没有世界位置**（它并不在关卡里），所以要获取位置，就必须绕一层 `GetPawn()`。这也就是后面 `PC->GetPawn()->GetActorLocation()` 这种写法的由来。

> 顺带说一下，Tom 早期版本的课程把 `InteractionComponent` 挂在了 `SCharacter` 上。新版本把它挪到 PC 上，是一次有意的重构，理由就是上面这三条。

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

这里要解决的问题很直接，**在 C++ 里写了一个 `ARoguePlayerController` 类之后，引擎并不知道它的存在**。在 C++ 里定义了一个类，并不等于游戏就会使用它。

`AGameModeBase` 就是负责「指定」使用哪些类的地方，它身上有一组类型配置字段：

| 字段 | 含义 |
|---|---|
| `PlayerControllerClass` | 玩家加入时生成哪个 PC |
| `DefaultPawnClass` | 给玩家生成哪个 Pawn |
| `HUDClass` | 用哪个 HUD |
| `GameStateClass` | 用哪个 GameState |
| `PlayerStateClass` | 用哪个 PlayerState |
| `SpectatorClass` | 观战时用哪个 Pawn |

而 GameMode 自己也需要被指定，指定的位置是 `项目设置 → 地图和模式 → 默认游戏模式`（这项设置会写进 `DefaultEngine.ini`）。

`AGameMode` 和 `AGameModeBase` 的区别在于，前者是后者的子类，它多了一套比赛状态机（`MatchState`，包括 `WaitingToStart`、`InProgress`、`WaitingPostMatch` 等状态）和玩家重生的逻辑。单人的 Roguelike 游戏用不到这套状态机，所以选择 `AGameModeBase` 会更轻量。

## 1.5 完整的启动链条

![UE Gameplay Framework 启动链条](/img/posts/ue5-ch3/ue5-ch3-framework.svg)

按照时间顺序展开，过程如下：

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

**这条链上缺少任何一环，红框都不会出现。** 这就是第一节的四个类和一处设置之间的关系，它们并不是四个独立的东西，而是同一条依赖链上的四个节点。

## 1.6 `EditDefaultsOnly` 还是 `VisibleAnywhere`

```cpp
UPROPERTY(EditDefaultsOnly, Category="Components")
TObjectPtr<URogueInteractionComponent> InteractionComponent;
```

第二章里的所有组件用的都是 `VisibleAnywhere`，而这里换成了 `EditDefaultsOnly`，乍一看会觉得前后不一致。

首先要分清楚一件事，**说明符修饰的是「指针这个槽位」，而不是它所指向的组件对象**。

| 维度 | 含义 |
|---|---|
| `Visible` | 槽位只读，但仍可展开、编辑组件内部的属性 |
| `Edit` | 槽位本身可写 |
| `Anywhere` | 关卡实例 + 类默认值都能改 |
| `DefaultsOnly` | 只在类默认值面板能改 |
| `InstanceOnly` | 只在关卡实例上能改 |

接下来是关键的一点，**`APlayerController` 不能被拖进关卡里**，它是在运行时生成的。所以「关卡实例」这个编辑场景根本不存在，`Anywhere` 和 `DefaultsOnly` 在这里是等价的。而 `CreateDefaultSubobject` 产生的是默认子对象，编辑器也不会真的允许把这个指针换成别的对象，所以 `Edit` 和 `Visible` 在这里也基本等价。

**所以在这一处，两种写法之间的差别几乎为零。** 引擎自身的惯例是使用 `VisibleAnywhere`（比如 `ACharacter` 的 `Mesh` 和 `CharacterMovement` 都是这样写的），跟着惯例走不会出错。

不过这个说明符在**另一处**是真正起作用的，那就是第四节的 `Input_Interact`。那里必须使用 `Edit`，因为需要在蓝图里给它指定资源，到时候会详细展开。

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

这段代码里没有任何游戏逻辑，它只是一根**探针**。只要红框出现了，就同时证明了下面四件事都已经成立：

1. GameMode 确实是 `RogueGameMode`
2. 生成的 PC 确实是 `ARoguePlayerController`
3. `InteractionComponent` 确实被创建并且在 Tick
4. PC 确实 Possess 了一个 Pawn

**`CastChecked` 和 `Cast` 的区别**在于，`CastChecked` 在类型不匹配时会直接触发断言并崩溃，而 `Cast` 会返回 `nullptr`。这里使用 `CastChecked` 是有意为之的，因为按照设计，交互组件只可能挂在 PlayerController 上。如果不是这样，就说明程序结构出了问题，这时应该**立刻明确地崩溃**，而不是静默地进入一条错误的分支。

> 还可以观察到一点，红框大约位于角色骨盆的高度，而不是脚底。这是因为 `ACharacter` 的 `GetActorLocation()` 返回的是**胶囊体的中心**，而胶囊体的中心在角色的腰部。以后制作特效的生成位置、判断落点时，这个半高的偏移会反复造成麻烦。

> 这里还有一处潜在的崩溃，那就是 `PC->GetPawn()` 没有做空指针判断。`TickComponent` 从组件注册的那一刻起就开始执行了，而 `Possess` 要等到 GameMode 后续才会进行；另外，角色从死亡到重生之间也有一段空档期。在这两个时刻，`GetPawn()` 都会返回 `nullptr`，紧接着的 `->GetActorLocation()` 就会对空指针解引用。详见[遗留待办](#遗留待办)。

---

# 第二节：球体重叠与点积筛选

上一节的 DebugBox 只是一根探针，这一节要真正回答的问题是，**玩家想和哪个东西交互？**

## 2.1 为什么放弃射线检测

最直接的想法，是从摄像机发出一条射线，射线打中谁就和谁交互。但射线在数学上的宽度是零，玩家必须把准星精确地压在物体上，用手柄操作时这几乎是一种折磨。

Tom 采用的是另一种思路，**先圈出所有的候选，再从中挑出一个最符合「我正在看着它」的**。这是 3D 动作游戏中通行的做法（塞尔达和魂系游戏的锁定系统，用的都是这个框架）。

于是代码被分成了两步，先用 `OverlapMultiByChannel` 撒网捞出候选，再用点积给每个候选打分。

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

配套的成员变量如下：

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

`FCollisionShape` 是一个可以表示多种形状的联合体，它通过工厂方法来构造：

```cpp
FCollisionShape Shape;
Shape.SetSphere(InteractionRadius);
// 等价写法：FCollisionShape::MakeSphere(InteractionRadius)
// 其它形状：MakeBox(FVector) / MakeCapsule(Radius, HalfHeight)
```

**Overlap 查询和第二章的射线、扫掠查询的区别在于**，射线查询问的是「从 A 到 B 之间有没有东西」，而 Overlap 查询问的是「这个位置上的这个形状里有什么东西」。前者关心的是路径，后者关心的是区域。

`FQuat::Identity` 是表示「不旋转」的四元数。这里之所以用四元数而不是 `FRotator`，是因为底层的物理引擎（Chaos）在内部用四元数来表示旋转，如果传入 `FRotator`，还要再转换一次。

## 2.4 点积：本节的数学核心

![点积挑选交互目标](/img/posts/ue5-ch3/ue5-ch3-dot.svg)

**两个单位向量的点积，等于它们夹角的余弦值。** 所以 `DotResult` 并不是一个抽象的数字，它就是 cos θ：

| 值 | 几何含义 |
|---|---|
| `1.0` | 目标在正前方 |
| `0.7` | 约 45° 偏角 |
| `0.0` | 正侧面，90° |
| `-1.0` | 正后方 |

如果学过 GAMES101，就会发现这和 Lambert 漫反射中的 `max(0, n·l)` 是同一个东西。那里用 cos 来衡量「光线有多正对着表面」，而这里用 cos 来衡量「物体有多正对着视线」。

### 为什么必须 `GetSafeNormal()`

点积的完整形式是 `|A||B|cos θ`。如果不做归一化，`OverlapLocation - Center` 的长度（也就是距离）就会混进结果里，于是**远处的物体仅仅因为距离远，就能得到更大的点积**。归一化会把长度信息抹掉，只留下纯粹的角度信息。

`GetControlRotation().Vector()` 本身已经是单位长度的向量了（`FRotator::Vector()` 返回的是这个旋转的单位前向量），所以只需要对另一个向量做归一化。

这里使用 `GetSafeNormal()`，而不是 `GetNormal()` 或者 `Normalize()`，是因为当向量的长度接近零时，`GetSafeNormal` 会返回 `FVector::ZeroVector`，而不会产生 NaN。在这里，零长度的向量是有可能出现的，比如重叠结果里包含了玩家自己时，`OverlapLocation - Center` 恰好就是零向量。

### 为什么用 `GetControlRotation()` 而不是 `GetActorForwardVector()`

玩家所感知的「我在看哪里」是**摄像机的方向**，而不是角色身体的朝向。在第三人称游戏里，角色会朝着移动的方向转身，所以身体和视线的方向经常相差几十度。

`GetControlRotation()` 是 PlayerController 上的旋转，它由鼠标或者右摇杆直接驱动，代表的是玩家的**意图**。这又回到了第一节讲的「PC 代表意志，Pawn 代表身体」那条线索上，用 PC 的旋转来做交互判定，是这种设计的自然结果。

> 需要注意俯仰角的影响。`ControlRotation` 包含了俯仰角，而第三人称视角通常会有一定的俯角，所以即使正对着地面上的一个箱子，点积也达不到 1.0。这并不是 bug，但它会影响阈值的选取。

## 2.5 打擂台算法与 `-1.0f` 初值

```cpp
float HighestDotResult = -1.0f;
```

为什么初始值是 `-1` 呢？因为这是单位向量点积的**理论下界**。把它初始化成「比任何可能的值都差」，循环中的第一个候选就一定会刷新它。这是求最大值的「打擂台」算法的标准写法。

> 这里有一个边界情况。如果某个候选恰好位于正后方，点积等于 `-1.0`，`>` 就不成立，这个候选会被漏掉。在浮点数运算中，几乎不会真的遇到这种情况，但知道这个边界在哪里是一个好习惯。如果想彻底避免这个问题，可以把初始值设为 `-FLT_MAX`，或者引入一个 `bool bFound` 变量。

## 2.6 调试绘制的三件套

| 函数 | 作用 | 关键参数 |
|---|---|---|
| `DrawDebugSphere` | 画交互范围球 | `Segments`：分段数，越大越圆越费 |
| `DrawDebugBox` | 标记每个候选 / 最终目标 | `Extent`：**半长**，不是全长 |
| `DrawDebugString` | 在世界坐标显示文字 | `Duration = 0` 表示只存活一帧 |

`DrawDebugBox` 的 `Extent` 表示的是**半尺寸**，所以 `FVector(50.f)` 画出来的是一个 100×100×100 的立方体。

`DrawDebugString` 有一个特殊之处，它并不是直接绘制的，而是往 HUD 的调试文字列表里添加一条记录，再由 `AHUD::DrawDebugTextList` 负责渲染。所以它**需要一个有效的 HUD 才能显示出来**。`Duration` 传入 `0` 意味着「下一帧就移除」，再配合 Tick 里每一帧都重新调用，效果就是文字会持续显示。

这些函数都在 `DrawDebugHelpers.h` 里，属于 `Engine` 模块，所以不需要在 `Build.cs` 里额外添加依赖。**它们在 Shipping 构建中会被编译掉**，所以在开发阶段可以放心地大量使用。

## 2.7 本节留下的隐患

这一节的代码虽然能运行，但它有五个问题，会在后面的几节中陆续暴露出来：

1. **`ECC_Visibility` 撒的网太大了**。这个通道的含义是「能不能被看见」，墙壁、地板和静态网格体默认全都会 Block 它。截图里的那些红框只是碰巧都落在箱子上，一旦场景变得复杂，就会捞进来大量无关的东西。→ **第五节会解决这个问题**
2. **重叠结果里可能包含玩家自己**。角色胶囊体使用的 `Pawn` 预设对 Visibility 是 Block 的，所以玩家自己也会进入数组，这时 `OverlapDirection` 是零向量，点积恒为 0。→ **第五节会顺带解决这个问题**
3. **没有设置任何阈值**。只要球体里有东西，`BestActor` 就一定不为空，即使是身后的宝箱也会被选中。→ **[遗留待办](#遗留待办)**
4. **完全丢掉了距离信息**。20 米外正对着视线的箱子，会赢过 1 米外偏了 30° 的箱子。→ **[遗留待办](#遗留待办)**
5. **`Overlap.GetActor()` 没有做空指针判断**。`FOverlapResult` 内部持有的是弱引用。→ **[遗留待办](#遗留待办)**

---

# 第三节：宝箱网格体与程序化开盖动画

首先要澄清一个可能存在的误解，**这一节里其实根本没有「动画」**。

这里既没有 AnimSequence，也没有 Timeline，也没有 Montage。所谓的「打开盖子」，只是每一帧往盖子的旋转值里写入一个稍大一点的数，写上 144 次，人眼看起来就是连续的运动。这是最原始的**程序化动画**。

## 3.1 为什么拆成两个 StaticMeshComponent

```cpp
BaseMeshComponent = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("BaseMeshComp"));
RootComponent = BaseMeshComponent;

LidMeshComponent = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LidMeshComp"));
LidMeshComponent->SetupAttachment(BaseMeshComponent);
```

**静态网格体是一个刚体，无法让它的某一部分单独运动。** 要让盖子单独转动，盖子就必须是一个独立的、拥有自己 Transform 的组件。

门、拉杆、抽屉和宝箱这类简单的机关，业界普遍都采用这种做法，也就是**组件层级加上变换操作**。这比骨骼动画便宜得多，也不需要美术人员去制作骨骼。

相应地，资产也要拆分成两个，分别是 `SM_Chest_Bottom` 和 `SM_Chest_Lid`。

## 3.2 `RootComponent = BaseMeshComponent` 这句不能省

这一点和第二章的投射物一样，但它的原因值得再强调一次：

- `ACharacter` 的根组件（也就是胶囊体）是父类已经建好的，不需要自己处理；
- 而**纯 `AActor` 的 `RootComponent` 默认是 `nullptr`**。

如果不指定根组件，`SetupAttachment` 就会挂接到一个空的根上，Actor 也就没有有效的世界变换，放进关卡之后，它的位置行为会很奇怪。

这里顺便记住一条推论，**Actor 的位置就是根组件的位置**。所以第二节的点积检测里得到的 `Chest->GetActorLocation()`，其实就是 `BaseMeshComponent` 的原点。

> 在构造函数里直接写 `RootComponent = BaseMeshComponent;` 是标准的写法。只有在运行时要更换根组件时，才需要使用 `SetRootComponent()`（它会额外做一些注册工作，并保持变换不变）。

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

这三行代码分别做的是，**计算这一帧应该转到哪个角度，把角度写进去，再检查有没有转到位**。

`FInterpConstantTo` 的含义是「每秒匀速前进 `InterpSpeed` 个单位」。这里配置的速度是 50，目标是 120，所以打开盖子正好需要 `120 / 50 = 2.4` 秒。

它的内部实现大致如下：

```cpp
const T Dist = Target - Current;
if (FMath::Square(Dist) < SMALL_NUMBER) { return Target; }   // 足够近就直接落到目标
const float Step = InterpSpeed * DeltaTime;
return Current + FMath::Clamp(Dist, -Step, Step);            // 否则前进一个受限的步长
```

乘上 `DeltaTime`，正是它与帧率无关的原因。在 30 帧时，每帧转动 1.67 度；在 144 帧时，每帧转动 0.35 度，但从墙上的时钟来看，花的时间都是 2.4 秒。

> 这是在 Tick 里编写所有「随时间变化」的逻辑时都必须遵守的规则，**任何表示速率的量都必须乘上 `DeltaTime`**。如果忘了乘，游戏在高刷新率的屏幕上就会快得离谱。

## 3.4 `FInterpConstantTo` 还是 `FInterpTo`

这是本节最值得记住的一个细节，因为**插值函数的选择和退出条件是相互关联的**。

| | `FInterpConstantTo` | `FInterpTo` |
|---|---|---|
| 数学形式 | 每帧走固定步长 | `Current + (Target-Current) * Clamp(DT*Speed, 0, 1)` |
| 曲线 | 匀速直线 | 指数缓出（先快后慢） |
| 能否精确到达 | **能**，最后一步 clamp 后直接返回 `Target` | **不能**，渐近逼近，数学上永远差一点 |
| 手感 | 机械、可预测 | 自然、有质感 |
| 适合 | 需要精确终止的机关、匀速旋转 | 摄像机跟随、UI 缓动、瞄准辅助 |

如果换成 `FInterpTo`，由于 `IsNearlyEqual` 的默认容差是 `UE_KINDA_SMALL_NUMBER`（`1e-4`），而指数逼近的最后那一段非常慢，所以盖子看起来早就停下来了，Tick 却还要空转好一阵子才会关闭。

而 `FInterpConstantTo` 在剩余的距离小于一步时，会直接返回 `Target`，差值精确地变成 0，所以 `IsNearlyEqual` **必然在到达目标的那一帧成立**。

> 如果既想要缓出的手感，又想精确地停止，常见的做法是用 `FInterpTo` 做插值，但把退出条件改成「总时长计时器到期」，或者手动放宽容差（比如 `IsNearlyEqual(A, B, 0.5f)`）。

## 3.5 相对旋转与旋转中心

```cpp
LidMeshComponent->SetRelativeRotation(FRotator(CurrentAnimationPitch, 0.f, 0.f));
```

那么为什么要用 `SetRelativeRotation`，而不是 `SetWorldRotation` 呢？

相对旋转是相对于**父组件**（也就是 `BaseMeshComponent`）而言的。这样一来，无论把整个宝箱在关卡里摆成什么角度，盖子都仍然会沿着宝箱自己的合页轴打开。如果使用世界旋转，一旦宝箱的摆放角度不是默认值，就全乱了。

这个「相对」之所以有意义，正是因为构造函数里的那句 `SetupAttachment` 建立了父子关系。

**`FRotator(Pitch, Yaw, Roll)` 的参数顺序**是 UE 最经典的陷阱之一，它并不是直觉上的 Roll、Pitch、Yaw 这样的顺序：

| 分量 | 绕哪个轴 | 直观含义 |
|---|---|---|
| `Pitch` | Y 轴 | 抬头 / 低头 |
| `Yaw` | Z 轴 | 左转 / 右转 |
| `Roll` | X 轴 | 侧倾 |

盖子是绕着 Y 轴翻起来的，所以要填在 Pitch 上。

### 旋转中心：不在代码里，在蓝图里

**组件永远是绕着自己的原点旋转的。** 所以在 `BP_ItemChest` 里，`LidMeshComponent` 被设置了 `(-35, 0, 50)` 的相对位置，这个偏移把盖子的旋转中心挪到了合页的那条边上。

如果 `SM_Chest_Lid` 这个资源的原点在网格的中心，又没有设置这个偏移，盖子就会绕着自己的中间翻跟头。如果想验证这一点，可以把 Z 改成 0 运行一次，效果一目了然。

> 这里有一条通用的规律，在程序化动画里，「转得对不对」有一半取决于**资产的原点**和**组件的相对位置**，而不是代码。所以调不出想要的效果时，先去蓝图里看看这两个值。

## 3.6 Tick 的三个开关

![宝箱 Actor 的 Tick 开关生命周期](/img/posts/ue5-ch3/ue5-ch3-tick.svg)

```cpp
PrimaryActorTick.bCanEverTick = true;
PrimaryActorTick.bStartWithTickEnabled = false;
```

这三个设置各自负责一件事，可以用装灯来打个比方：

| 开关 | 比喻 | 何时设置 | 说明 |
|---|---|---|---|
| `bCanEverTick` | 这个房间要不要装灯 | **只能在构造函数** | `false` 时引擎压根不注册 Tick 函数 |
| `bStartWithTickEnabled` | 通电瞬间灯是开还是关 | 构造函数 | 函数已注册，只是初始状态为关 |
| `SetActorTickEnabled()` | 墙上那个开关 | 运行时任意 | 随时可以拨 |

**其中最关键的一条是**，当 `bCanEverTick = false` 时，`SetActorTickEnabled(true)` **完全不起作用**。引擎源码中的实现如下：

```cpp
void AActor::SetActorTickEnabled(bool bEnabled)
{
	if (!IsTemplate() && PrimaryActorTick.bCanEverTick)
	{
		PrimaryActorTick.SetTickFunctionEnable(bEnabled);
	}
}
```

第一句就在检查 `bCanEverTick`，如果条件不满足，就直接返回。这是「为什么我的 Tick 不执行」最常见的原因。

### 为什么要费这个劲

这是因为 Tick 是有成本的。如果关卡里放了 200 个宝箱，而它们全都不加控制地 Tick，那么每一帧就要做 200 次浮点插值，再加上 200 次 `SetRelativeRotation`（后者还会触发变换的更新链，并把渲染状态标记为需要更新）。可实际上，它们在 99% 的时间里什么都不用做。

所以**只在真正需要动起来的那 2.4 秒里执行 Tick**，在性能上是最划算的做法。

组件也有对应的一套设置，分别是 `PrimaryComponentTick.bCanEverTick` 和 `SetComponentTickEnabled()`。另外还有 `PrimaryActorTick.TickInterval`（用来限制频率，比如 0.1 表示每秒最多执行 10 次）和 `SetActorTickInterval()`。

### 在 Tick 里关掉自己的 Tick

```cpp
if (FMath::IsNearlyEqual(CurrentAnimationPitch, AnimationTargetPitch))
{
	SetActorTickEnabled(false);
}
```

在 UE 里，这样写是完全合法的。引擎并不会立刻把它从当前帧的执行过程中拉出来，只是把这个 Tick 函数标记为**下一帧不再调用**，当前这个 `Tick()` 的函数体会正常执行到结尾。

## 3.7 本节的脚手架：`BeginPlay` 里的 `SetActorTickEnabled(true)`

课程在这一节里写了下面的代码：

```cpp
void ARogueItemChest::BeginPlay()
{
	Super::BeginPlay();
	SetActorTickEnabled(true);
}
```

**这会导致游戏一开始，宝箱就自己打开了。** 构造函数里的 `bStartWithTickEnabled = false` 明明是想让它「一开始不要动」，而 `BeginPlay` 又立刻把 Tick 打开了，两句代码是自相矛盾的。

不过这并不是错误，而是 Tom 故意留下的**脚手架**，目的是在还没有编写交互功能时，就能先看到动画效果。等到第四节接入接口之后，这句代码会被移到 `Interact()` 里，`BeginPlay` 的重写则会被整个删掉。

> 这类临时代码值得单独记下来。因为如果只看最终的代码，就很难明白中间为什么要绕这样一圈。

## 3.8 `CurrentAnimationPitch` 为什么没有 `UPROPERTY`

```cpp
float CurrentAnimationPitch = 0.0f;                    // 没有 UPROPERTY

UPROPERTY(EditAnywhere, Category="Animation")
float AnimationTargetPitch = 120.f;                    // 有

UPROPERTY(EditAnywhere, Category="Animation")
float AnimationSpeed = 50.f;                           // 有
```

这三个变量的性质是不同的：

| 变量 | 性质 | 谁该改它 |
|---|---|---|
| `AnimationTargetPitch` | **配置** | 策划，在编辑器里调 |
| `AnimationSpeed` | **配置** | 策划，在编辑器里调 |
| `CurrentAnimationPitch` | **运行时状态** | 只有代码 |

配置需要暴露给编辑器，所以要加上 `UPROPERTY(EditAnywhere)`；而运行时的状态则不需要。

那么，不加 `UPROPERTY` 的代价是什么呢？

- 它不参与序列化（存档和网络同步都拿不到它）；
- 它不会出现在蓝图和编辑器里；
- **如果它是一个 UObject 指针，就不受 GC 的保护**（这一点对第四节的 `SelectedActor` 来说是致命的）。

因为这里的变量只是一个 `float`，所以这三条都无关紧要。但是**判断的标准一定要记牢，那就是这个成员是不是指向 UObject 的指针**。如果是，就必须加上 `UPROPERTY()`，哪怕括号里是空的。

---

# 第四节：交互接口与输入串联

这一节的课程分成上下两部分，是整章的核心。上半部分解决的是「交互组件怎样和宝箱通信」，下半部分解决的是「按键怎样触发这件事」。

## 4.1 上半：没有接口的世界

先设想一下没有接口时会是什么情况。交互组件拿到目标之后，要想打开宝箱，就只能这样写：

```cpp
ARogueItemChest* Chest = Cast<ARogueItemChest>(BestActor);
if (Chest) { Chest->OpenLid(); }
```

后来加了一扇门，就要再写一段 `Cast<ARogueDoor>`；再加一个 NPC，又要再写一段。三个月后，这个函数里会有二十个 `Cast`，而且**交互组件必须 `#include` 每一个可交互物体的头文件**，结果就是一个负责玩家输入的模块，反过来依赖了整个世界。

而接口把这种依赖关系反转了过来。

![交互接口的依赖关系](/img/posts/ue5-ch3/ue5-ch3-interface.svg)

注意箭头的方向，**是宝箱指向接口，而不是组件指向宝箱**。交互组件的 cpp 文件里，从头到尾都没有 `#include "RogueItemChest.h"`。以后无论再加多少种可交互的物体，这个文件都一行也不需要修改。

这就是「面向接口编程」（也叫依赖倒置），它是这一章继「拆分组件」之后的第二个结构上的收获。

## 4.2 `UInterface` 的双类结构

使用 Rider 的 Unreal 类向导，把父类选为 `Interface`，就会在一个文件里生成**两个类**：

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

这是 UE 里最违反直觉的一处设计：

| 类 | 前缀 | 作用 | 你要不要碰它 |
|---|---|---|---|
| `URogueInteractionInterface` | `U` | 空壳，唯一作用是让反射系统知道"世界上存在这么一个接口" | **永远不继承、不实现** |
| `IRogueInteractionInterface` | `I` | 真正的接口，装函数声明 | **继承它、实现它、调用它** |

为什么要设计成两个类呢？因为 UE 的反射系统只认识派生自 `UObject` 的类，所以需要一个 `UClass` 对象来登记「接口」这个概念；但 C++ 的多重继承又要求接口本身是一个轻量的抽象类，它不能同时也是 `UObject`（否则就会出现菱形继承，以及两份 `UObject` 的数据）。于是就拆成了两个类，一个进入反射系统，另一个进入继承链。

可以这样来记，继承和调用时使用 I 类，查询反射系统时使用 U 类。

`UINTERFACE(MinimalAPI)` 里的 `MinimalAPI` 表示只导出最少的必要符号（比如 `StaticClass()` 等），从而减小 DLL 导出表的体积。因为 U 类本来就是一个空壳，没有别的东西需要导出。

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

**需要注意继承的顺序**，`AActor` 必须放在前面。UE 的约定是把主父类（也就是派生自 UObject 的那个类）放在第一位，接口跟在后面，因为 UHT 要依赖这个顺序来生成正确的反射代码。

同时，第三节留下的那个 `BeginPlay` 脚手架现在可以删掉了，打开盖子的触发点正式交给了 `Interact()`。

## 4.4 `Cast<I>` 与 `Implements<U>`：一个会静默失效的坑

课程里的调用代码是：

```cpp
IRogueInteractionInterface* InteractInterface = Cast<IRogueInteractionInterface>(SelectedActor);
if (InteractInterface)
{
	InteractInterface->Interact();
}
```

这句代码现在能正常运行，但它有一个限制，**`Cast<I接口>` 只能找到在 C++ 里实现的接口**。

假设以后制作了一个 `BP_Door`，在蓝图的类设置里勾选了这个接口，并在蓝图里实现了 `Interact`，那么这句 `Cast` 就会返回 `nullptr`。结果门纹丝不动，日志里也一个字都不会报。这类「没有报错，但就是不工作」的 bug 是最难排查的。

原因在于，在 C++ 层面，蓝图实现的接口根本没有那个 `I` 类的对象指针，它只是在反射系统里登记了一条「这个类实现了 `URogueInteractionInterface`」的记录。

正确的、通用的查询方式要通过反射系统来进行：

```cpp
if (SelectedActor->Implements<URogueInteractionInterface>())   // 注意传的是 U 类
{
	IRogueInteractionInterface::Execute_Interact(SelectedActor);
}
```

三种写法的对比如下：

| 写法 | 找得到 C++ 实现 | 找得到蓝图实现 | 前置条件 |
|---|---|---|---|
| `Cast<IXxx>(Actor)` | ✓ | **✗** | 无 |
| `Actor->Implements<UXxx>()` | ✓ | ✓ | 接口函数需为 `UFUNCTION` |
| `Actor->GetClass()->ImplementsInterface(UXxx::StaticClass())` | ✓ | ✓ | 同上 |

## 4.5 纯虚函数 vs `BlueprintNativeEvent`

课程目前采用的写法是纯 C++ 的虚函数：

```cpp
virtual void Interact() = 0;
```

它的上面**没有 `UFUNCTION()`**，这意味着反射系统看不到它。这个接口目前只能在纯 C++ 中使用，在蓝图里既不能实现它，也不能调用它。

在 UE 里，接口函数的标准写法是：

```cpp
UFUNCTION(BlueprintNativeEvent)
void Interact(APawn* InstigatorPawn);
```

三种 `UFUNCTION` 变体的区别如下：

| 说明符 | C++ 能否提供默认实现 | 蓝图能否覆盖 | C++ 侧写在哪 |
|---|---|---|---|
| （纯虚，无 UFUNCTION） | 必须提供 | ✗ | `Interact()` |
| `BlueprintImplementableEvent` | **不能** | 必须 | 无 |
| `BlueprintNativeEvent` | 可以 | 可以 | `Interact_Implementation()` |

使用 `BlueprintNativeEvent` 的代价是，**调用方式必须换成 `Execute_Interact()`**：

```cpp
IRogueInteractionInterface::Execute_Interact(SelectedActor, MyPawn);
```

UHT 会自动生成这个 `Execute_` 静态函数，它在内部会先检查蓝图有没有覆盖这个函数，如果没有，再去执行 C++ 的实现。

> **这是 UE 接口最大的一个坑。** 如果使用了 `BlueprintNativeEvent`，却直接调用虚函数 `InteractInterface->Interact()`，那么**蓝图里的实现就会被静默地跳过**，既不报错，也不警告，只是没有任何反应。

另外，Tom 原版中的函数签名是 `Interact(APawn* InstigatorPawn)`，因为宝箱需要知道是谁打开了它。可以想一想什么时候会用到这个参数，比如需要钥匙才能打开的门、只有特定阵营才能使用的终端，以及要给拾取者加分的物品。**给接口添加参数是代价最高的改动之一**，因为所有实现这个接口的类都得跟着修改，所以最好尽早想清楚。

## 4.6 下半：`SelectedActor` 是两条时间线的接头

上半节的课程把 `Interact()` 的调用直接写在了 `TickComponent` 里，这会导致几个问题。比如走到宝箱前面，还没有按 E，宝箱就自己打开了；`Interact()` 每秒会被调用 60 次；宝箱的 Tick 关掉之后，又被下一帧重新打开，就这样反复开关。

下半节的修正是本节在架构上最重要的部分：

> Tick 的职责是「持续找出当前聚焦的目标」，而按键的职责是「对当前聚焦的目标发起交互」。

这两件事的频率相差了好几个数量级，一个每帧都要执行，另一个可能几秒钟才执行一次。如果把它们塞进同一个函数里，按键就永远没有机会插手。

于是 `BestActor` 从局部变量被提升成了成员变量：

```cpp
UPROPERTY()
TObjectPtr<AActor> SelectedActor;
```

`TickComponent` 的最后一步，变成了把结果保存到 `SelectedActor` 里，而新增的 `Interact()` 负责读取它：

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

> 这种「把每一帧计算出来的结果保存起来，交给别处使用」的模式，是所有聚焦系统、锁定系统和 UI 高亮提示的共同骨架。想清楚这一步之后，后面再添加描边效果，或者添加「按 E 开启」之类的提示文字，都会变得顺理成章。

> **一定要检查一件事。** `SelectedActor` 现在是一个成员变量，**它不会自己清零**。如果 `TickComponent` 的开头没有 `SelectedActor = nullptr;`（或者没有把局部的 `BestActor` 无条件地赋值给它），那么离开之后，它仍然会保留上一次的值，于是在地图的另一头按下 E，也能打开一个根本看不到的宝箱。

## 4.7 `UPROPERTY()` 那个空括号别删

```cpp
UPROPERTY()
TObjectPtr<AActor> SelectedActor;
```

这行声明里没有任何说明符，看起来像是一句废话，但它其实很关键，因为**它让垃圾回收器知道了这个指针的存在**。

设想这样一个场景，当前聚焦着一个宝箱，`SelectedActor` 指向它，而这时宝箱被销毁了（比如被炸毁、被捡走，或者在关卡流送时被卸载）。

- 如果加了 `UPROPERTY()`，引擎在执行 GC 时会自动把这个指针置空，下次按 E 时就会进入 `if` 的 false 分支，什么也不会发生。
- 如果没有加，它就会变成一个野指针，下次按 E 时程序会直接崩溃，而且崩溃的位置离真正的原因非常远。

对比一下第三节的 `CurrentAnimationPitch`，那只是一个 `float`，不存在对象生命周期的问题，所以不加 `UPROPERTY` 也没有关系。**判断的标准就是这个成员是不是指向 UObject 的指针。**

`TObjectPtr<>` 是 UE5 引入的一种包装类型。在编辑器构建中，它提供访问追踪的功能（用于延迟加载和资产依赖分析）；在打包构建中，它会退化成裸指针，没有任何额外开销。新代码都应该使用它。

## 4.8 三层 `Interact` 的职责划分

串联完成之后，代码里会出现三个几乎同名的函数，**这是本节最容易把人绕晕的地方**，一定要分清楚：

| 层 | 函数 | 它负责回答 |
|---|---|---|
| `ARoguePlayerController` | `StartInteract()` | **玩家想干这件事了**（输入层） |
| `URogueInteractionComponent` | `Interact()` | **对谁干**（目标选择层） |
| `ARogueItemChest` | `Interact()` | **干了会怎样**（响应层） |

每一层都不知道另外两层的内部细节。PC 不知道当前聚焦的是什么，组件不知道宝箱会打开盖子，宝箱也不知道交互是由键盘触发的还是由手柄触发的。

这样做带来的好处很具体：

| 需求变更 | 只需要改 |
|---|---|
| 换成手柄 X 键 | `IMC_Default` 资源 |
| 改成"离得最近"而不是"最正对" | 组件的 `TickComponent` |
| 加一扇门 | 门自己的 `Interact()` |

> **强烈建议把中间那一层改名**为 `PrimaryInteract()` 或者 `TryInteract()`。这样三层就变成了 `StartInteract` → `PrimaryInteract` → `Interact`，一眼就能看出谁是谁。Tom 的原版用的就是 `PrimaryInteract`（意思是「主交互键」，为以后可能添加的次要交互键预留了命名空间）。

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

`APlayerController::SetupInputComponent()` 由引擎在 `InitInputSystem()` 阶段调用，这时 `InputComponent` 刚刚被创建好。这是在 PC 这一侧绑定输入的标准位置，对应的是 Pawn 这一侧的 `SetupPlayerInputComponent()`。

**Enhanced Input 的映射上下文（IMC）在哪里添加，并不影响这里的绑定**，因为 IMC 是注册在 `UEnhancedInputLocalPlayerSubsystem` 上的，属于 LocalPlayer 级别。第一章在 Character 的 `BeginPlay` 里调用了 `AddMappingContext`，那个上下文里的所有 IA，在 PC 和 Pawn 上都可以绑定。

### `ETriggerEvent::Triggered` 与 IA 资源的耦合

`IA_Interact` 的配置如下：

```text
值类型（Value Type）:  Digital (bool)
触发器（Triggers）:    [0] Pressed
```

加上「已按下」触发器之后，`ETriggerEvent::Triggered` 只会在按下的那一帧触发一次。

**但这其实是一种隐性的依赖。** 如果哪天有人把这个触发器删掉了，`Triggered` 就会在按住按键期间**每一帧都触发**，宝箱就会被反复地调用 `Interact`。也就是说，C++ 代码的正确性，依赖于一个策划随手就能修改的资源配置。

这里回顾一下 `ETriggerEvent` 六种事件的含义：

| 事件 | 何时触发 |
|---|---|
| `Started` | 从"无输入"变为"有输入"的那一帧，**不依赖触发器配置** |
| `Ongoing` | 触发器条件正在评估中（如 Hold 蓄力期间） |
| `Triggered` | 触发器条件**满足**（无触发器时 = 每帧只要有输入） |
| `Completed` | 触发过程结束 |
| `Canceled` | 触发过程被中断（如 Tap 超时） |
| `Ended` | 输入完全归零 |

对于「按一下就生效」的交互来说，`Started` 是更稳妥的选择，因为它的含义并不依赖触发器的配置。

> 这个坑和第二章「按住鼠标喷出几百个球」属于同一类错误，只是入口不同。第二章是在触发器的配置上出的问题，而这里是在 `ETriggerEvent` 的选择上。

### 一处裸解引用

```cpp
UEnhancedInputComponent* EnhancedInput = Cast<UEnhancedInputComponent>(InputComponent);
EnhancedInput->BindAction(...);   // 没判空
```

`Cast` 失败时会返回 `nullptr`，而下一行就立刻对它解引用了。那么在什么情况下会失败呢？当 `项目设置 → 输入 → Default Input Component Class` 不是 `EnhancedInputComponent` 的时候。

这里更合适的写法是使用 `CastChecked`（和交互组件里对 `GetOwner()` 的处理保持一致），因为项目配置错误时，应该立刻明确地崩溃，而不是留下一个空指针，让问题慢慢发作。

## 4.10 完整调用链

![交互系统完整调用链](/img/posts/ue5-ch3/ue5-ch3-callchain.svg)

**这两条线的频率完全不同**，左边每秒执行 60 次，右边可能几秒钟才执行一次，而它们唯一的接口就是中间的那个 `SelectedActor`。

## 4.11 蓝图三件套与 `EditDefaultsOnly` 的真正用途

本节还创建了 `BP_GameMode`、`BP_PlayerController` 和 `BP_playerCharacter` 三个蓝图，于是配置链就变成了下面这样：

```text
项目设置 → BP_GameMode → BP_PlayerController → C++ 的 ARoguePlayerController
                       → BP_playerCharacter  → C++ 的 ARoguePlayerCharacter
```

中间这一层蓝图存在的唯一意义，就是提供一个**不需要重新编译就能修改配置的地方**。

这也终于回答了第一节留下的问题，也就是 `EditDefaultsOnly` 到底在哪里起作用：

```cpp
UPROPERTY(EditDefaultsOnly, Category="Input")
TObjectPtr<UInputAction> Input_Interact;
```

在 C++ 里只声明「需要一个输入动作」，**完全不提 `IA_Interact` 这个资源的名字或者路径**。至于具体是哪个资源，则在 `BP_PlayerController` 的默认值面板里填写。

如果写成 `VisibleAnywhere`，这个格子就是只读的，根本无法在蓝图里给它指定资源。

**这就是贯穿整个课程的「C++ 定义接口，蓝图填写数据」的模式。** 本章中的例子如下：

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

它的作用是给编译器多提供一个查找头文件的起点，于是就可以这样写：

```cpp
#include "Player/RoguePlayerController.h"          // 而不是
#include "ActionRoguelike/Player/RoguePlayerController.h"
```

这样做有两个副作用值得了解：

1. **修改完 `Build.cs` 之后，需要重新生成项目文件**，修改才会在 IDE 里生效，否则 Rider 会一直显示红色的错误标记。
2. 它是 **Public** 的，这意味着以后依赖本模块的其他模块，也会继承这些查找路径。在单模块的项目里这无关紧要，但在多模块的项目里，就要注意不要影响到下游的模块。

> 现代的 UE 推崇 IWYU（Include What You Use），所以有些团队反而倾向于保留完整的路径，以提高可读性并避免歧义。这只是团队风格上的选择，并没有绝对的对错。

---

# 第五节：自定义碰撞检测通道

这一节做的事情比看起来要重要，因为**它把过滤方式从「黑名单」切换成了「白名单」**，这是碰撞过滤在思路上的一次核心转变。

## 5.1 先分清两个同名的东西

Tom 让它们使用同一个名字，是为了方便，但它们其实是两个不同层面的东西：

| | 检测通道 `Interaction` | 碰撞预设 `Interaction` |
|---|---|---|
| 是什么 | 在碰撞响应矩阵里新增一**列** | 一个命名的配置包，一次性填好某个物体的一整**行** |
| 在哪配 | 项目设置 → 碰撞 → Trace Channels | 项目设置 → 碰撞 → Preset |
| 谁用它 | 查询函数（`OverlapMultiByChannel` 的 `TraceChannel` 参数） | 碰撞组件（`SetCollisionProfileName`） |

**新建检测通道时，最关键的一步是把「默认响应」选为「忽略」**（也就是图中的那一行）。

## 5.2 从黑名单到白名单

![自定义检测通道的白名单过滤](/img/posts/ue5-ch3/ue5-ch3-collision.svg)

因为新通道的默认响应是「忽略」，所以世界上所有已经存在的物体，比如木桶、墙壁、地板和玩家的胶囊体，都会自动对这个通道视而不见，**一个都不需要修改**。

| | `ECC_Visibility` 通道 | `Interaction` 通道 |
|---|---|---|
| 木桶 / 墙 / 地板 | 阻挡 | **忽略**（新通道默认值） |
| 玩家胶囊体 | 阻挡 | **忽略** |
| 宝箱底座 | 阻挡 | **重叠** ← 全场唯一响应的 |
| 宝箱盖子 | 无碰撞 | 无碰撞 |

`OverlapMultiByChannel` 要问的问题是「**对于这个通道**，哪些物体的响应是重叠或者阻挡」，而现在的答案只有宝箱的底座一个。

对比一下第二节使用 `ECC_Visibility` 的时候，那个通道的含义是「能不能被看见」，所有的静态网格体默认都会阻挡它，所以球体查询会捞回来一大堆无关的东西。

| | 黑名单（`ECC_Visibility`） | 白名单（`Interaction`） |
|---|---|---|
| 默认状态 | 大家都参与 | 大家都不参与 |
| 要做的工作 | **逐个排除**不想要的 | 只标记想要的 |
| 加新装饰物时 | 可能要改代码或加忽略 | **零工作量** |
| 出错模式 | 静默混入垃圾 | 忘标记 → 那个物体不可交互（明显） |

**白名单出错时的表现，远比黑名单友好。** 忘记标记的后果是「这个宝箱按 E 没有反应」，很容易发现；而黑名单混入了无关物体的后果是「偶尔会选中一面墙」，极难复现。

## 5.3 为什么是检测通道，不是对象类型

这个决策和第二章整理的碰撞三层模型是联系在一起的：

| | 对象类型（Object Type） | 检测通道（Trace Channel） |
|---|---|---|
| 回答的问题 | 我**是**什么 | 这次查询**为了什么** |
| 每个组件有几个 | **只能有一个** | 对每一个通道都有一条响应 |
| 自定义上限 | 两者共享 18 个 | 同左 |
| 查询函数 | `...ByObjectType` | `...ByChannel` |

**「可交互」并不是一种身份，而是一种用途。** 宝箱是 WorldDynamic，同时也可以交互；门可能是 WorldStatic，同时也可以交互；NPC 是 Pawn，同时也可以交互。

如果把「可交互」做成一种对象类型，物体就不得不放弃自己真正的身份，物理和移动碰撞也会立刻全部乱掉。比如宝箱不再是 WorldDynamic，角色的移动扫掠就无法正确地处理它。

> 可以这样来记，一个物体的身份只有一个，但它的用途可以有很多个。

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

`ECC_GameTraceChannel1` 这个名字没有提供任何信息。它到底是哪个通道，答案并不在代码里，而在 `DefaultEngine.ini` 里：

```ini
[/Script/Engine.CollisionProfile]
+DefaultChannelResponses=(Channel=ECC_GameTraceChannel1,DefaultResponse=ECR_Ignore,bTraceType=True,bStaticObject=False,Name="Interaction")
```

**引擎只认识通道的序号，「Interaction」这个名字只是编辑器显示给人看的外观。**

所以这个宏所做的事情，就是**把「序号」翻译成「含义」，而且只翻译一次**。以后整个项目都写 `COLLISION_INTERACTION`，如果通道的顺序真的需要调整，只要修改这一行就可以了。

像 `RogueEngineTypes.h` 这样「没有类、只有项目级定义」的头文件，在稍大一些的项目里很常见，它专门用来存放这类跨模块共享的常量、枚举和结构体。

### 两个值得想的点

**第一，`#define` 并不是最好的 C++ 写法。** 预处理器做的替换没有类型，不受命名空间的约束，在调试器里也看不到。更现代的写法如下：

```cpp
constexpr ECollisionChannel COLLISION_INTERACTION = ECC_GameTraceChannel1;
```

UE 的官方示例（比如 ShooterGame 中的 `COLLISION_WEAPON`）使用的是 `#define`，Tom 在这里是遵循惯例。两种写法都应该了解，也应该知道惯例为什么是这样的（一是历史原因，二是需要在预处理阶段就能使用）。

**第二，这个宏和 ini 文件之间没有任何编译期的约束。** 如果有人在项目设置里删掉并重新创建了通道，导致 Interaction 变成了 `ECC_GameTraceChannel2`，那么这个宏就会**静默地指向错误的通道**。编译照样能通过，但运行时交互会失效，而且不会报错。

同样的道理，`SetCollisionProfileName("Interaction")` 里的字符串如果打错了，也只会在日志里留下一条警告。

> **这类「字符串或配置与代码之间的脆弱关联」，是 UE 项目里最难排查的一类 bug。** 如果遇到「代码看起来完全正确，但就是不工作」的情况，首先应该怀疑这一层。

## 5.5 宝箱的碰撞配置

```cpp
BaseMeshComponent = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("BaseMeshComp"));
BaseMeshComponent->SetCollisionProfileName("Interaction");
RootComponent = BaseMeshComponent;

LidMeshComponent = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LidMeshComp"));
LidMeshComponent->SetCollisionProfileName("NoCollision");
LidMeshComponent->SetupAttachment(BaseMeshComponent);
```

**那么盖子为什么要设为 `NoCollision` 呢？** 这里有两个理由，其中第二个更重要：

1. **避免重复命中。** 如果盖子也使用 Interaction 预设，重叠查询就会返回两个组件，但它们的 `Overlap.GetActor()` 都是同一个宝箱。这样循环就会对同一个宝箱计算两次点积、画两个框、比较两次。虽然不会崩溃，但纯属浪费。
2. **盖子是会动的。** 它每一帧都在 120° 的旋转中前进一小步。一个带有碰撞的活动几何体，意味着每一帧都要更新物理状态，它可能会把玩家或者物理物体顶飞，碰撞形状也会在空间中扫过。而盖子只是一种视觉表现，它的「存在感」由底座来代表就足够了。

> 这里有一个通用的习惯，**会动的东西默认不要带碰撞，除非确实需要它撞到什么东西**。这样可以省掉很多莫名其妙的 bug。

## 5.6 顺手解决的一个老问题

第二节留下的第二个隐患，也就是「重叠结果里可能包含玩家自己」，现在自动消失了，因为玩家的胶囊体对 Interaction 通道的响应是默认的忽略。

但是这里有一个值得思考的问题，**还需不需要使用 `FCollisionQueryParams::AddIgnoredActor`？**

答案是要看情况。如果以后玩家角色本身也变成可以交互的（比如在多人游戏里可以扶起倒地的队友），那么玩家就会对 Interaction 通道有响应，自己也就又会回到查询结果里。

**通道过滤解决的是「哪一类物体参与这种查询」，而忽略列表解决的是「这一次查询要排除哪一个具体的实例」。** 两者是不同层面的工具，不能相互替代。

---

# 第六节：重构与核心重定向

这一节的内容很少，但涉及的概念很清楚。这一节把 `RogueCharacter` 的 `.h/.cpp` 文件移到了 `Player/` 文件夹里，并改名为 `RoguePlayerCharacter`。

Rider 会弹出窗口，询问是否添加 Core Redirect，勾选之后，`DefaultEngine.ini` 里会多出一行：

```ini
[CoreRedirects]
+ClassRedirects=(OldName="/Script/ActionRoguelike.RogueCharacter",NewName="/Script/ActionRoguelike.RoguePlayerCharacter")
```

## 6.1 为什么重定向里没有文件夹信息

这是本节最值得思考的问题，**明明既移动了文件夹，又修改了名字，为什么重定向里只体现了改名这一件事？**

先来看一下这条路径的结构，`/Script/ActionRoguelike.RogueCharacter`：

| 片段 | 含义 |
|---|---|
| `/Script/ActionRoguelike` | **包名**。对原生 C++ 类来说，包 = **模块**，不是文件夹 |
| `.RogueCharacter` | **类名** |

反射系统识别的就是这两样东西。`Source/ActionRoguelike/Player/` 这一层目录结构，对 UE 的对象系统来说**完全不存在**，它只影响两件事，一是 `#include` 时要写什么路径，二是文件在 IDE 里显示在哪里。编译产物里并没有任何地方记录「这个类的源文件曾经放在哪个子目录里」。

所以：

| 操作 | 类路径变了吗 | 需要重定向吗 |
|---|---|---|
| 文件从根目录移到 `Player/` | 没变 | **不需要** |
| `RogueCharacter` → `RoguePlayerCharacter` | 变了（后半段） | 需要 `+ClassRedirects` |
| 模块 `ActionRoguelike` 改名 | 变了（前半段） | 需要 `+PackageRedirects` |

Rider 只生成了改名的那一条重定向，这是正确的。

> 还有一个细节，重定向里写的是 `RogueCharacter`，而不是 `ARogueCharacter`。`A`、`U`、`F`、`I` 这些前缀纯粹是 C++ 这一侧的命名约定，UHT 在生成反射信息时会把它们去掉。这也是为什么在蓝图里搜索父类时，看到的是「Rogue Player Character」。

## 6.2 资产那边恰好相反

这是最容易混淆的一个对照点，**对于蓝图和资源来说，路径本身就是身份的一部分**。

```text
C++ 类:  /Script/ActionRoguelike.RoguePlayerCharacter
         └─ 模块 ─┘ └────── 类名 ──────┘        文件夹无关

资 产:  /Game/Blueprints/BP_ItemChest.BP_ItemChest
        └──── 完整内容路径 ────┘ └─ 对象名 ─┘   文件夹就是身份
```

所以在内容浏览器里把一个资产拖进另一个文件夹，它的路径字符串就改变了。这时 UE 会在原来的位置**自动留下一个隐形的重定向器对象（Redirector）**，当旧的引用指向原位置时，由它负责转发。可以在内容浏览器里开启「显示重定向器」，然后右键选择「修复」来清理它们。

用一句话来总结：

> C++ 类依靠「模块加上类名」来识别，和文件夹无关；而资产依靠「完整的内容路径」来识别，文件夹就是它身份的一部分。

## 6.3 不加这行会怎样

`BP_playerCharacter` 的父类信息，在磁盘上是一个字符串 `/Script/ActionRoguelike.RogueCharacter`。改名之后重新打开编辑器，引擎会按照这个名字去反射注册表里查找，结果找不到。

其结果并不是报一个错误让人去修改，而是**蓝图在不知不觉中失去了父类**。变量没有了，在 C++ 里设置的组件也没有了，严重的时候，蓝图甚至会直接打不开。

同样会受到影响的还有引用了这个类的关卡、`DefaultEngine.ini` 里的类设置，以及任何 `FSoftClassPath` 或 `TSubclassOf` 序列化保存的值。

有了重定向之后，加载时旧的名字会被翻译成新的名字，一切都照常运行。

## 6.4 三个实用要点

**第一，重定向只在加载时进行翻译，并不会修改磁盘上的内容。** 加上这一行之后，最好把受影响的资产（比如 `BP_playerCharacter` 以及用到它的关卡）打开并重新保存一遍。保存时会写入新的名字，以后就不再依赖这条重定向了。

**第二，即便如此，也不要删掉这一行。** 因为无法知道谁的本地还保留着旧的版本，也无法确定有没有遗漏了没有重新保存的资产。在成熟的项目里，ini 文件中这类重定向可能会积累几十甚至上百行，虽然是历史包袱，但删掉它的风险远远大于保留它的成本。

**第三，`[CoreRedirects]` 并不只管类。**

| 条目 | 用于 |
|---|---|
| `+ClassRedirects` | 类改名 |
| `+PropertyRedirects` | 成员变量改名 |
| `+FunctionRedirects` | `UFUNCTION` 改名 |
| `+EnumRedirects` | 枚举 / 枚举值改名 |
| `+StructRedirects` | `USTRUCT` 改名 |
| `+PackageRedirects` | 模块改名 |

> 这是重构 C++ 代码时最应该记住的一条纪律，**任何暴露给反射系统的名字，修改它都不只是修改代码那么简单**。修改属性名、修改枚举值的名字，同样会打断资产的引用。

为了保险起见，重构之后，最好在整个项目里搜索一下旧名字的字符串（包括 `.ini` 和 `.uproject` 文件），确认没有遗漏的硬编码引用。

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

本章里每一次「看起来多此一举的拆分」，本质上都是在做同一件事，那就是**让每次修改的影响范围变得可控**。

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

对比一下第二章，那时所有的逻辑都堆在 `ARoguePlayerCharacter` 里，`PrimaryAttack` 直接调用 `SpawnActor`。这样虽然能运行，但每增加一个技能，就要在同一个类里再写一遍类似的代码。从第三章开始，这种「往一个类里堆东西」的写法被系统性地拆开了。

### 主线二：每帧 vs 事件

本章反复出现的一组对立关系如下：

| 每帧做的事 | 事件触发的事 |
|---|---|
| `TickComponent` 找目标 | 按 E 发动交互 |
| 宝箱 `Tick` 转盖子 | `Interact()` 打开 Tick 开关 |
| 频率固定、成本可预测 | 频率低、成本集中 |

处理的原则有以下几条：

1. **每一帧都要做的事，只负责「计算和记录」，而不负责「执行」**。比如 `TickComponent` 只更新 `SelectedActor`，并不调用 `Interact`。
2. **每一帧都要做的事，必须乘上 `DeltaTime`**，否则帧率一变，行为就会跟着改变。
3. **不需要每一帧都做的事，就关掉 Tick**。`bStartWithTickEnabled = false` 加上 `SetActorTickEnabled` 是标准的组合。

上半节把 `Interact()` 写进 Tick 的那个 bug，正是违反了第 1 条原则。

### 主线三：谁认识谁

| 关系 | 方向 | 手段 |
|---|---|---|
| GameMode → PlayerController | 单向，编译期 | `StaticClass()` / 蓝图默认值 |
| PlayerController → 交互组件 | 单向，编译期 | `CreateDefaultSubobject` |
| 交互组件 → 宝箱 | **不认识** | 通过 `IRogueInteractionInterface` |
| 交互组件 → PlayerController | 单向，运行时 | `GetOwner()` |
| 宝箱 → 任何人 | **不认识** | 只实现接口，被动响应 |

**「互不认识」是设计的目标，而不是一种遗漏。** 依赖越少，可替换性就越强。

### 主线四：默认值决定工作量

这一条在第五节体现得最为清楚，但它贯穿了整个章节：

| 设计 | 默认值 | 结果 |
|---|---|---|
| `ECC_Visibility` 通道 | 大家都 Block | 要逐个排除 → 工作量随场景增长 |
| `Interaction` 通道 | 大家都 Ignore | 只标记想要的 → 工作量恒定 |
| `bStartWithTickEnabled` | `false` | 默认不耗性能，需要时才开 |
| `UPROPERTY()` | 加了才受 GC 保护 | 默认不保护，所以必须显式加 |

**选择一个能让「常见情况下的工作量为零」的默认值**，是系统设计中回报最高的决策之一。

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

**这一项的优先级最高**，因为它直接影响手感。

`BestActor` 原本是一个局部变量，每一帧都会自动从 `nullptr` 开始。被提升为成员变量之后，它就不会再自动清零了：

```cpp
void URogueInteractionComponent::TickComponent(...)
{
	// ...
	SelectedActor = nullptr;           // ← 每帧开头重置
	float HighestDotResult = -1.0f;
	for (const FOverlapResult& Overlap : Overlaps) { /* ... */ }
}
```

或者也可以保留局部变量 `BestActor`，在循环结束之后，无条件地执行 `SelectedActor = BestActor;`。后一种写法更不容易遗漏。

## ② 点积阈值

现在只要球体里有东西，`SelectedActor` 就一定不为空，所以身后的宝箱也会被选中。

```cpp
// 大致方向：只接受视线锥内的候选
if (DotResult > InteractionDotThreshold && DotResult > HighestDotResult)
```

阈值的取值可以参考下表（数值是 `cos θ`）：

| 阈值 | 允许的半角 | 手感 |
|---|---|---|
| `0.0` | 90° | 太宽松，侧面的也算 |
| `0.5` | 60° | 宽松 |
| `0.7` | 45° | 常用起点 |
| `0.9` | 25° | 偏严格 |

需要注意，第三人称的摄像机俯角会让点积的整体数值偏低，所以实际调整参数时，要在游戏里试一试。

## ③ 把距离纳入评分

现在 20 米外正对着视线的箱子，会赢过 1 米外偏了 30° 的箱子。常见的做法有两种：

- **设置硬性的距离门槛**：超过 `MaxInteractDistance` 的候选直接跳过，剩下的仍然按点积排序。这种做法简单，结果也可以预测。
- **加权评分**：把角度和距离分别映射到 `0~1` 的范围，再加权求和。这种做法的手感更细腻，但多了两个需要调整的参数。

如果直接把点积和距离相乘，通常效果并不好，因为两者的量纲不同，结果很容易被其中一方主导。

## ④ 三处裸解引用

```cpp
PC->GetPawn()->GetActorLocation()                    // GetPawn 可能为 null
Cast<UEnhancedInputComponent>(InputComponent)->Bind  // Cast 可能失败
Overlap.GetActor()->GetActorLocation()               // 弱引用可能失效
```

这三处的处理原则各不相同：

- `GetPawn()` 返回空指针是**正常的业务状态**（比如还没有 Possess，或者处在死亡后的空档期），所以应该在判空之后 `return`。
- `Cast<UEnhancedInputComponent>` 失败意味着**项目配置错误**，所以应该使用 `CastChecked`，让程序立刻崩溃。
- `Overlap.GetActor()` 返回空指针是**正常的边界情况**，所以应该在判空之后 `continue`。

> 判断的标准是，这个空指针是「预期之内会发生的」，还是「一旦发生就说明程序结构有错误」。如果是前者，就判断是否为空；如果是后者，就使用断言。

## ⑤ 接口升级为 `BlueprintNativeEvent` 并加 `InstigatorPawn`

```cpp
UFUNCTION(BlueprintNativeEvent)
void Interact(APawn* InstigatorPawn);
```

相应地，还需要做下面这些修改：

- 实现接口的类，要把 `Interact()` 改为 `Interact_Implementation(APawn*)`；
- 调用接口的地方，要把 `Cast<I>` 加虚函数调用的写法，改为 `Implements<U>()` 加 `Execute_Interact()`。

这样做的好处是，可以在蓝图里实现可交互的物体，宝箱也能知道是谁打开了它（从而支持钥匙、阵营和加分等功能）。

## ⑥ 组件的 `Interact()` 改名

三个同名的 `Interact` 是本章最大的理解负担。建议把中间那个改名为 `PrimaryInteract()`，这样三层就变成了 `StartInteract` → `PrimaryInteract` → `Interact`。

## ⑦ 宝箱只能开不能关

现在盖子到达目标角度后，Tick 就会关闭，`CurrentAnimationPitch` 停在 120 不再变化。如果要做成既能打开又能关上的宝箱，就需要一个运行时的「当前目标角度」变量（而不是直接修改 `EditAnywhere` 的配置项），再加上一个 `bool bLidOpened` 状态。

## ⑧ 通道宏改用 `constexpr`

```cpp
constexpr ECollisionChannel COLLISION_INTERACTION = ECC_GameTraceChannel1;
```

这种写法有类型，可以放进命名空间里，在调试器里也能看到。不改也能正常使用，所以这只是一项风格上的改进。

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
