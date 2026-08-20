---
title: UE5 C++ 第二章复盘：从一次点击到一发法球的完整远程攻击链路
date: 2026-08-07 20:00:00
categories:
  - [课外, UE5-Looman]
tags:
  - C++
  - ActionRoguelike
  - Niagara
  - 碰撞系统
  - 委托与事件分发
  - 伤害系统
description: 完整梳理 ActionRoguelike 第二章五节课：投射物 Actor 的组件构成、碰撞三层配置、动态委托与命中回调、Enhanced Input 触发器、SpawnActor 与伤害归属链、计时器与动画蒙太奇、音效与特效的三种生成方式、物理冲量的完整链路，并解释每一步为什么这么写。
cover: /img/covers/UE5-ActionRoguelike-Chapter2.svg
series: UE5 ActionRoguelike
privacy: protected
sitemap: false
private_section: 课外
---

# 前言

这是我跟随 Tom Looman 学习 UE5 C++ 时，对第二章 **Projectile & Damage** 的完整复盘，覆盖课程五节课的全部内容。

上一篇见{% post_link UE5-ActionRoguelike-Chapter1 %}。第一章搭好了"能移动、能观察、有动画的第三人称角色"，本章要给这个角色装上第一个能对世界产生影响的能力。

本章使用的开发环境：

- Unreal Engine `5.6.1`
- Rider
- Visual Studio 2022 Build Tools / MSVC 编译工具链
- 项目名称：`ActionRoguelike`

本章目标是打通一条完整的远程攻击链路：

```text
按下左键
  → 播放施法动画
  → 延迟 0.2 秒
  → 从手上生成法球
  → 法球飞行
  → 命中目标
  → 造成伤害 + 物理冲量 + 爆炸特效 + 音效
  → 销毁
```

这条链路表面上只是"做一个技能"，实际上它把 UE 的 **组件系统、碰撞系统、模块系统、反射与 UPROPERTY、委托、Actor 生命周期、增强输入、计时器、伤害系统、特效与音频** 全部串了一遍。

五节课的分工：

| 节 | 主题 | 核心产出 |
| --- | --- | --- |
| 第一节 | 创建投射物 Actor | 组件构成、碰撞预设、模块依赖 |
| 第二节 | 命中检测与伤害 | 动态委托、命中回调、伤害归属链 |
| 第三节 | 输入绑定与生成投射物 | Enhanced Input 触发器、`SpawnActor` |
| 第四节 | 计时器与动画蒙太奇 | 前摇结构、`FTimerManager` |
| 第五节 | 表现层与伤害精化 | 点伤害、音效三件套、物理冲量 |

和第一章一样，这篇不只记录"敲了哪些代码"，还会重点解释：

- 为什么要写这段代码；
- 每个改动解决了什么问题；
- 本章出现过和可能出现的坑，以及它们的排查顺序。

---

## 目录

- [第一节：创建投射物 Actor](#第一节创建投射物-actor)
- [第二节：命中检测与伤害](#第二节命中检测与伤害)
- [第三节：输入绑定与生成投射物](#第三节输入绑定与生成投射物)
- [第四节：计时器与动画蒙太奇](#第四节计时器与动画蒙太奇)
- [第五节：表现层与伤害精化](#第五节表现层与伤害精化)
- [知识链路总览](#知识链路总览)
- [易错点速查表](#易错点速查表)
- [遗留待办](#遗留待办)
- [第二章完成检查清单](#第二章完成检查清单)
- [术语表](#术语表)
- [参考资料](#参考资料)

---

# 第一节：创建投射物 Actor

## 1.1 为什么继承 `AActor`

```cpp
UCLASS(Abstract)
class ACTIONROGUELIKE_API ARogueProjectileMagic : public AActor
{
	GENERATED_BODY()
	// ...
};
```

UE 的类继承树上，和"能放进世界的东西"相关的主要有三层：

| 类 | 增加的能力 | 代价 |
|---|---|---|
| `AActor` | 能放进关卡、能持有组件、有 Transform、有生命周期 | 无 |
| `APawn` | 能被 Controller 占据（Possess）、能接收输入 | 多一套占据/控制逻辑 |
| `ACharacter` | 胶囊体 + CharacterMovementComponent + 骨骼网格 | 大量移动状态机开销 |

投射物不需要被玩家或 AI 占据，也不需要走路爬楼梯，所以停在 `AActor` 这一层是最经济的选择。

**这体现了 UE 的第一条核心哲学：优先用组件组合，而不是用继承堆功能。** 投射物需要"会飞"，不是通过继承一个 `AFlyingActor`，而是挂一个 `ProjectileMovementComponent`。需要"有拖尾"，就挂 `NiagaraComponent`。类只负责定义**这些组件如何协作**。

`ACTIONROGUELIKE_API` 是 UBT（UnrealBuildTool）自动生成的宏，展开后是 `__declspec(dllexport)` 或 `dllimport`，作用是让这个类能被其它模块引用。写自己模块内的类时必须带上，否则跨模块链接会失败。

`GENERATED_BODY()` 是 UHT（UnrealHeaderTool）的占位符，编译前会被替换成一大堆反射所需的样板代码（构造函数声明、`StaticClass()`、序列化钩子等）。它必须放在类体最开头，且这个类的头文件必须 `#include "XXX.generated.h"`，且该 include 必须是**最后一个** include。

### `UCLASS(Abstract)` 的作用

这个标记的含义是：**本 C++ 类不能被实例化，但子类可以**。具体表现为：

- 不出现在关卡编辑器的"放置 Actor"面板里
- 不出现在 `TSubclassOf<>` 属性的下拉框里
- `SpawnActor` 直接传入它会失败并返回 `nullptr`

为什么要加？因为 `ARogueProjectileMagic` 的 C++ 类是个**空壳** —— Niagara 特效、音效资产全都在蓝图子类 `BP_MagicProjectile` 里指定。如果有人手滑把 `ProjectileClass` 设成 C++ 类，运行时会生成一个隐形无声的球体，还不报错。加上 `Abstract` 之后，这个错误在编辑器层面就变得不可能发生。

> **注意区分**：UE 的 `Abstract` 和 C++ 的抽象类是两个独立概念。C++ 的抽象性靠纯虚函数（`virtual void F() = 0;`）由编译器强制；UE 的 `Abstract` 是反射系统层面的标记，不需要任何纯虚函数，本类在纯 C++ 意义上仍然是完全具体的类。它约束的是引擎的生成/放置系统，不是编译器。
>
> Abstract 类仍然会生成 CDO（类默认对象），继承链照常工作。

## 1.2 三个核心组件

```cpp
ARogueProjectileMagic::ARogueProjectileMagic()
{
	SphereComponent = CreateDefaultSubobject<USphereComponent>(TEXT("SphereComp"));
	SphereComponent->SetCollisionProfileName("Projectile");
	SphereComponent->SetSphereRadius(16.f);
	RootComponent = SphereComponent;

	LoopedNiagaraComponent = CreateDefaultSubobject<UNiagaraComponent>(TEXT("NiagaraComp"));
	LoopedNiagaraComponent->SetupAttachment(SphereComponent);

	LoopedAudioComponent = CreateDefaultSubobject<UAudioComponent>(TEXT("LoopedAudioComp"));
	LoopedAudioComponent->SetupAttachment(SphereComponent);

	ProjectileMovementComponent = CreateDefaultSubobject<UProjectileMovementComponent>(TEXT("ProjectileMoveComp"));
	ProjectileMovementComponent->InitialSpeed = 2000.f;
	ProjectileMovementComponent->bRotationFollowsVelocity = true;
	ProjectileMovementComponent->bInitialVelocityInLocalSpace = true;
	ProjectileMovementComponent->ProjectileGravityScale = 0.0f;
}
```

### `CreateDefaultSubobject` 与 CDO

这个函数**只能在构造函数里调用**，在其它任何地方调用都会触发断言崩溃。理解这一点需要先理解 CDO。

UE 里每个 `UClass` 都有一个唯一的 **CDO（Class Default Object，类默认对象）**。它在引擎启动、模块加载时被创建一次，本质上是"这个类的出厂设置样板"。你在编辑器详情面板里看到的默认值，读的就是 CDO；你 `SpawnActor` 生成新实例时，引擎实际上是**以 CDO 为模板做一次内存拷贝**，然后再应用蓝图和关卡里的覆盖值。

所以构造函数一生中至少会跑两次：一次是引擎启动创建 CDO 时，一次（或多次）是真正生成实例时。`CreateDefaultSubobject` 创建的组件被称为"默认子对象"，它们随 CDO 一起被建立，之后每个实例拷贝一份。这就是为什么它必须在构造函数里 —— 出了构造函数，模板已经定型，来不及了。

> **推论**：构造函数里不要写任何依赖世界状态的逻辑（比如 `GetWorld()->GetTimeSeconds()`、查找其它 Actor）。CDO 创建时压根没有世界。这类逻辑应该放在 `BeginPlay` 或 `PostInitializeComponents`。

`TEXT("SphereComp")` 这个名字必须在**同一个类的继承链内唯一**。重名会导致组件创建失败，症状通常是运行时崩溃或者组件莫名其妙是 `nullptr`。名字本身在编辑器组件树里可见，起得清楚一点对后期调试有帮助。

### 为什么用碰撞体当 RootComponent

```cpp
RootComponent = SphereComponent;
```

一个 Actor 的组件构成一棵树，树根就是 RootComponent。**Actor 的 Transform 实际上就是 RootComponent 的 Transform**，`GetActorLocation()` 返回的是根组件的世界坐标，`SetActorLocation()` 移动的也是它（子组件跟着走）。

这里有两种常见做法：

- **用一个空的 `USceneComponent` 当根**，碰撞体作为子组件挂上去。好处是层级清晰、碰撞体可以有偏移。
- **直接用碰撞体当根**（本例的做法）。好处是少一层组件、少一次变换计算，而且移动逻辑更直接。

选后者的一个关键理由是：`UProjectileMovementComponent` 默认移动的是 **`UpdatedComponent`**，而这个字段在组件初始化时会自动指向 Actor 的 RootComponent。让根组件本身就是碰撞体，意味着"驱动移动的对象"和"检测碰撞的对象"是同一个，扫掠（sweep）检测天然生效，不需要额外配置。

如果根是空 SceneComponent，投射物移动时扫掠的是那个没有碰撞的空组件，球体只是被动跟随，**碰撞事件不会正常触发** —— 这是一个非常经典的新手陷阱。

半径 16 是个手感值。它同时决定了两件事：命中判定的宽容度（越大越容易打中），以及生成时与角色胶囊体重叠的概率（越大越容易一出生就撞到自己）。

### `UProjectileMovementComponent` 详解

这是一个 `UMovementComponent` 的子类，**没有任何视觉表现**，它的唯一工作是每帧计算一个位移增量并驱动 `UpdatedComponent` 移动（带扫掠检测）。

常用字段：

| 字段 | 含义 | 本例值 |
|---|---|---|
| `InitialSpeed` | 生成瞬间的初速度（cm/s） | 2000 |
| `MaxSpeed` | 速度上限，0 表示无上限 | 默认 |
| `ProjectileGravityScale` | 重力倍率，0 = 直线飞行，1 = 正常抛物线 | 0 |
| `bRotationFollowsVelocity` | Actor 朝向是否跟随速度方向 | true |
| `bInitialVelocityInLocalSpace` | 初速度方向是"本地 +X" 还是"世界 +X" | true |
| `bShouldBounce` | 撞到东西是否弹跳 | false |
| `Bounciness` / `Friction` | 弹性系数 / 摩擦 | — |
| `bIsHomingProjectile` + `HomingTargetComponent` | 追踪弹 | — |

`bInitialVelocityInLocalSpace = true` 是关键：它让"初速度方向"等于"生成时传入的 Rotation 的正前方"。这就是为什么第三节里我们传 `GetControlRotation()` 进去，法球就会朝摄像机方向飞 —— 生成旋转直接决定了飞行方向。

`bRotationFollowsVelocity = true` 让 Actor 的朝向持续对齐速度向量。这在第五节计算 `HitFromDirection` 时会派上用场（用 `GetActorRotation().Vector()` 就能拿到入射方向）。

> **延伸**：`ProjectileGravityScale` 设为 0 是"魔法飞弹"的典型做法（直线、可预测、好瞄准）。设为 0.3~0.5 会得到"手雷/弓箭"的手感，玩家需要抬高瞄准。这个值配合 `InitialSpeed` 是投射物手感调校的两个主要旋钮。

## 1.3 碰撞系统：本章最重要的基础设施

UE 的碰撞配置由**三层**构成，缺一不可：

### 第一层：Collision Enabled（碰撞检测开关）

| 选项 | Query（射线/扫掠查询） | Physics（物理模拟） |
|---|---|---|
| No Collision | ✗ | ✗ |
| Query Only | ✓ | ✗ |
| Physics Only | ✗ | ✓ |
| Collision Enabled | ✓ | ✓ |

- **Query** 负责：射线检测（LineTrace）、扫掠移动检测、重叠事件、`OnComponentHit` 事件。
- **Physics** 负责：刚体模拟，物体之间真实的推挤、堆叠、反弹。

我们选 **Query Only**。原因是投射物的移动完全由 `ProjectileMovementComponent` 用代码驱动，不需要物理引擎接管；但我们需要它能检测到"撞上了什么"。开启 Physics 不但浪费性能，还会导致投射物被重力和碰撞推得乱飞。

> 这是一条通用规律：**代码驱动移动的东西用 Query Only，需要真实物理反应的东西才开 Physics。** 角色的胶囊体、触发器盒子、投射物，几乎都是 Query Only。

**顺带澄清一个极易混淆的选项**：组件详情面板里的 `Hidden in Game`（中文"游戏中隐藏"）**只控制渲染，不控制碰撞**。

| 选项 | 控制什么 |
|---|---|
| `Hidden in Game` | 运行时看不看得见 |
| `Collision Enabled` | 能不能发生碰撞 |

调试阶段可以把球体的隐藏取消，直接在游戏里看到碰撞球的实际大小和位置；等外观完全交给 Niagara 之后再隐藏回去。取消隐藏不会让它多撞到任何东西，勾上隐藏也不会让它穿墙。

### 第二层：Object Type（我是什么）

每个碰撞组件属于一个对象类型。引擎内置的有 `WorldStatic`（不动的场景，墙地板）、`WorldDynamic`（会动的场景物件）、`Pawn`、`PhysicsBody`、`Vehicle`、`Destructible`，另外还能自定义。

投射物设为 **WorldDynamic**，因为它会动但不是 Pawn，也不参与物理模拟。

### 第三层：Response（我对每种类型的反应）

对每一种对象类型，可以设置三种反应：

| 反应 | 行为 | 触发的事件 |
|---|---|---|
| **Ignore** | 完全无视，穿过去 | 无 |
| **Overlap** | 穿过去，但通知双方 | `OnComponentBeginOverlap` / `EndOverlap` |
| **Block** | 挡住，停止移动 | `OnComponentHit` |

**这一层和第二节的事件绑定是强耦合的**：你绑了 `OnComponentHit`，就必须让碰撞设为 Block，否则事件永远不会触发。反过来，用 Overlap 做穿透型子弹（打中不停、继续飞）时，就要绑 `OnComponentBeginOverlap`。

> **调试口诀**：事件不触发时，先别看代码，去看碰撞设置。九成问题出在 Block/Overlap 配错、或者 Collision Enabled 关着。

### 自定义预设 "Projectile"

在 `项目设置 → 引擎 → 碰撞` 里新建一个 Preset：

```
Name:              Projectile
CollisionEnabled:  Query Only
ObjectType:        WorldDynamic
Response:
    Visibility ..... Ignore
    Camera ......... Ignore
    其余全部 ....... Block
```

两个 Ignore 各有明确理由：

- **Visibility → Ignore**：`Visibility` 是一个 Trace Channel（追踪通道），大量瞄准逻辑、拾取检测、AI 视线判断都走这个通道。如果投射物 Block 它，一发飞在半空的法球会**挡住你的瞄准射线**，导致准星判定跳到法球上而不是墙上。
- **Camera → Ignore**：`Camera` 通道被 SpringArm 用来做"摄像机防穿墙"。如果投射物 Block 它，每次开火摄像机都会被自己的法球顶着往前推，画面剧烈抖动。

为什么用 Preset 而不是逐项手设？因为**预设是可复用的具名配置**。以后你会有火球、冰箭、箭矢、飞刀，全都用 `Projectile` 预设。哪天要改规则（比如让投射物之间互相 Ignore），改一处，全项目生效。

代码里应用：

```cpp
SphereComponent->SetCollisionProfileName("Projectile");
```

> **埋雷预告**：预设里"其余全部 Block"包含了 **Pawn**。这意味着法球会撞到角色 —— 这是我们想要的（能打到敌人），但也导致了两个自伤问题，将在第三节和第五节分别处理。

## 1.4 `Build.cs` 与模块系统

要用 Niagara，必须先在 `ActionRoguelike.Build.cs` 里加依赖：

```csharp
PublicDependencyModuleNames.AddRange(new string[] { 
    "Core", "CoreUObject", "Engine", "InputCore", 
    "EnhancedInput", "Niagara" 
});
```

UE 的代码被切分成上百个**模块（Module）**，每个模块独立编译成一个 DLL。你的游戏也是一个模块。模块之间必须**显式声明依赖**才能互相 include 和链接。

漏加的症状很典型：`#include "NiagaraComponent.h"` 报"找不到文件"，或者能编译但链接阶段报一堆 `unresolved external symbol`。

`Public` 和 `Private` 的区别：

- `PublicDependencyModuleNames`：依赖会**传递**给依赖你的模块。如果你的头文件里 include 了某模块的头，就必须放 Public。
- `PrivateDependencyModuleNames`：仅本模块可见，不传递。只在 `.cpp` 里用到的模块放这里，能减少下游模块的编译负担。

常用模块速查：

| 模块 | 用途 |
|---|---|
| `EnhancedInput` | 增强输入系统 |
| `Niagara` | Niagara 特效 |
| `UMG` | UI 控件蓝图 |
| `AIModule` | 行为树、黑板、AI 控制器 |
| `GameplayTasks` | AI 任务系统（AIModule 常需一起加） |
| `GameplayTags` | GameplayTag |
| `GameplayAbilities` | GAS 技能系统 |
| `PhysicsCore` | 物理材质等 |

> **注意**：改完 `Build.cs` 需要重新生成项目文件并完整重编。Rider 里通常会自动检测，但如果出现诡异的编译错误，手动删除 `Binaries`、`Intermediate` 目录再 Generate Project Files 是万能解法。

## 1.5 蓝图子类 `BP_MagicProjectile`

### 先分清两个 `Projectiles` 文件夹

写到这里，项目里会同时出现两个同名文件夹，作用完全不同：

| 路径 | 保存内容 | 作用 |
|---|---|---|
| `Source/ActionRoguelike/Projectiles/` | `.h`、`.cpp` | 存放投射物的 C++ 源码 |
| `Content/Projectiles/` | `.uasset` | 存放可在编辑器中使用的蓝图与资产 |

前者是给编译器和 IDE 看的代码分类，后者是给内容浏览器看的资产分类。它们各自独立，重名纯属巧合，不会互相影响。

> **另一个容易踩的顺序问题**：新建 C++ 类后**必须先编译成功**，虚幻编辑器才能识别这个新的 `UCLASS`，"选择父类"窗口里才会出现 `RogueProjectileMagic`。没编译就去找父类，是找不到的。
>
> 还要注意 `Content` 下的资产**尽量在内容浏览器里移动和重命名**，不要用 Windows 资源管理器直接拖 `.uasset`——引擎需要机会更新引用或创建 Redirector，绕过它会导致引用静默失效。

### 蓝图里要做的三件事

C++ 类建好后，右键 → 基于它创建蓝图类。在蓝图里：

- 给 `LoopedNiagaraComponent` 分配 `NS_Gideon_Primary`
- 把该组件 Z 轴旋转 180°（因为这个特效资产的默认朝向和飞行方向相反）
- 勾选 `Auto Activate`（否则特效不会自动播放）

**这一步体现了 UE 的第二条核心哲学：C++ 定行为和契约，蓝图填数据和资产。**

为什么不在 C++ 里直接用 `ConstructorHelpers::FObjectFinder` 硬编码资产路径？因为：

1. 资产路径是字符串，改名或移动文件就会静默失效
2. 每次换资产都要重编译 C++
3. 美术/策划无法自行调整
4. 硬编码路径会造成不必要的资产强引用，拖慢加载

这个模式在后面会反复出现：`InputAction`、`AnimMontage`、`NiagaraSystem`、`SoundBase`、`DamageType` —— 全都是 C++ 声明一个 `UPROPERTY` 指针，蓝图里填具体资产。

---

# 第二节：命中检测与伤害

## 2.1 Actor 生命周期与 `PostInitializeComponents`

```cpp
void ARogueProjectileMagic::PostInitializeComponents()
{
	Super::PostInitializeComponents();

	SphereComponent->OnComponentHit.AddDynamic(this, &ARogueProjectileMagic::OnActorHit);
	SphereComponent->IgnoreActorWhenMoving(GetInstigator(), true);  // 第三节加入
}
```

**永远不要忘记 `Super::` 调用。** 父类在这个阶段做了大量必要的初始化（组件注册收尾、网络同步准备等），漏掉它会导致各种难以诊断的问题。

一个由 `SpawnActor` 生成的 Actor，关键阶段顺序大致是：

```
1. 构造函数
       ↓  （此时 Owner / Instigator 尚未赋值，GetWorld() 可能为空）
2. Owner / Instigator 赋值、初始 Transform 设置
       ↓
3. OnConstruction / 蓝图构造脚本
       ↓
4. 所有组件注册（RegisterAllComponents）
       ↓
5. PostInitializeComponents()      ← 我们在这里
       ↓
6. BeginPlay()
```

**为什么绑定要放在第 5 步而不是构造函数？**

- 构造函数会在 CDO 创建时执行。如果在那里绑定委托，等于给"类模板"绑了一个回调，语义混乱且可能造成引用泄漏。
- 更实际的原因：**构造函数执行时 `GetInstigator()` 返回 `nullptr`**。第三节要加的 `IgnoreActorWhenMoving(GetInstigator(), true)` 如果写在构造函数里，等于传了个空指针进去 —— **而且不会报任何错**，你只会看到法球照样在手上炸。

**为什么不放 `BeginPlay`？** 放 `BeginPlay` 也能工作。选 `PostInitializeComponents` 是因为它更早，能保证在 `BeginPlay` 中的任何逻辑执行前，事件绑定就已经就位。对于生成即可能立刻碰撞的高速投射物，这点时间差有意义。

## 2.2 委托系统与 `AddDynamic`

```cpp
UFUNCTION()
void OnActorHit(UPrimitiveComponent* HitComponent, AActor* OtherActor, 
                UPrimitiveComponent* OtherComp, FVector NormalImpulse, 
                const FHitResult& Hit);
```

### 为什么必须加 `UFUNCTION()`

`OnComponentHit` 的类型是 `FComponentHitSignature`，它是一个**动态多播委托**（`DECLARE_DYNAMIC_MULTICAST_DELEGATE_*`）。

- **动态（Dynamic）**：委托内部存的不是函数指针，而是"对象指针 + 函数名字符串"。调用时通过**反射系统按名字查找**函数。这样做的好处是可以序列化（存进蓝图资产）、可以跨 C++/蓝图边界。
- **多播（Multicast）**：可以绑定多个监听者，广播时全部调用。

因为要按名字查找，函数**必须被注册进反射系统**，这就是 `UFUNCTION()` 的作用。漏掉它，编译能过（`AddDynamic` 是宏），但运行时绑定失败，回调永不触发。

顺便把 Unreal 的几个反射宏放在一起对照，它们标记的对象各不相同：

| 宏 | 标记对象 |
|---|---|
| `UCLASS()` | Unreal 类 |
| `USTRUCT()` | Unreal 结构体 |
| `UENUM()` | Unreal 枚举 |
| `UPROPERTY()` | 成员变量 |
| `UFUNCTION()` | 成员函数 |
| `GENERATED_BODY()` | 插入 Unreal 自动生成的反射代码 |

括号里留空**不代表这个宏没生效**。`UFUNCTION()` 即使不写任何说明符，函数一样会进入反射系统，`AddDynamic` 就能正常绑定；空括号只表示"没有额外指定行为"。

但要注意：没写 `BlueprintCallable` 之类的说明符时，这个函数**不会出现在蓝图节点菜单里**。所以当前的 `OnActorHit()` 是"反射系统认识它，但蓝图里搜不到"——这正是我们想要的，它是引擎内部调用的回调，不需要暴露给蓝图。

`AddDynamic(this, &Class::Func)` 这个宏展开后大致是：

```cpp
__Internal_AddDynamic(this, &Class::Func, FName(TEXT("Func")))
```

宏用 `#` 操作符把函数名字面量转成字符串。**这也解释了为什么函数名不能写错** —— 写错了字符串对不上，反射查找失败。

### 为什么五个参数必须完全匹配

委托宏定义了严格的签名。参数的**个数、类型、顺序、const 修饰、引用与否**必须逐一对应，少一个 `const` 都不行。

不匹配时的编译错误极其难读（通常是几十行模板展开的错误），所以最保险的做法是：**在引擎源码里找到委托声明，直接复制参数列表**。

`OnComponentHit` 的声明：

```cpp
DECLARE_DYNAMIC_MULTICAST_DELEGATE_FiveParams(FComponentHitSignature, 
    UPrimitiveComponent*, HitComponent, 
    AActor*, OtherActor, 
    UPrimitiveComponent*, OtherComp, 
    FVector, NormalImpulse, 
    const FHitResult&, Hit);
```

各参数含义：

| 参数 | 含义 |
|---|---|
| `HitComponent` | 我方发生碰撞的组件（这里就是 SphereComponent） |
| `OtherActor` | 撞到的 Actor（可能为 `nullptr`，比如撞到没有 Actor 的几何体） |
| `OtherComp` | 对方被撞到的具体组件 |
| `NormalImpulse` | 碰撞产生的法向冲量（仅在双方都模拟物理时才有值） |
| `Hit` | **信息最丰富的参数**，见下 |

`FHitResult` 里的关键字段：

| 字段 | 含义 | 典型用途 |
|---|---|---|
| `ImpactPoint` | 实际接触点的世界坐标 | 特效/弹孔的精确位置 |
| `ImpactNormal` | 接触表面的法线 | 让弹孔贴合墙面朝向；计算反弹 |
| `Location` | 扫掠体停下时的中心位置 | 与 ImpactPoint 差一个半径 |
| `BoneName` | 击中的骨骼名 | **爆头判定** |
| `PhysMaterial` | 表面物理材质 | 打金属冒火花、打木头崩木屑 |
| `Distance` | 从起点到命中点的距离 | 弹道衰减 |
| `bBlockingHit` | 是否为阻挡命中 | 区分 Block / Overlap |

> **`Hit` 和 `ImpactPoint` vs `GetActorLocation()`**：投射物的 `GetActorLocation()` 是球心，`Hit.ImpactPoint` 是球面与墙面的接触点，相差一个半径（16）。打平面墙差异不明显，打斜面或圆角物体时，用球心会让特效"陷进"物体里。**这就是本章遗留待办①。**

### `Hit` vs `Overlap` 的选择

| | `OnComponentHit` | `OnComponentBeginOverlap` |
|---|---|---|
| 需要的碰撞响应 | **Block** | **Overlap** |
| 移动是否停止 | 是 | 否 |
| 是否提供完整 `FHitResult` | 是 | 部分（需要开启 `bReturnMaterialOnMove` 等） |
| 典型用途 | 撞墙即爆的火球、子弹 | 穿透型激光、拾取物、触发区域 |

## 2.3 `ApplyDamage` 与伤害归属链

```cpp
UGameplayStatics::ApplyDamage(OtherActor, 10.0f, GetInstigatorController(), this, DmgTypeClass);
```

`UGameplayStatics` 是一个**静态函数库**（`UBlueprintFunctionLibrary` 子类），里面全是无状态的工具函数，同时暴露给蓝图。凡是看到 `UGameplayStatics::` 开头的，都是这类"引擎提供的通用工具"。

五个参数：

| 参数 | 含义 | 本例 |
|---|---|---|
| `DamagedActor` | 谁受伤 | `OtherActor` |
| `BaseDamage` | 基础伤害值 | `10.0f` |
| `EventInstigator` | **哪个 Controller 该为这次伤害负责** | `GetInstigatorController()` |
| `DamageCauser` | 直接造成伤害的物体 | `this`（法球本身） |
| `DamageTypeClass` | 伤害类型 | `DmgTypeClass` |

### `EventInstigator` 与 `DamageCauser` 的区别

这两个经常被混淆，但语义完全不同：

- **`DamageCauser`** 是"凶器"—— 直接接触目标的东西。法球、手雷、地刺。
- **`EventInstigator`** 是"凶手"—— 最终该负责的玩家/AI 的 **Controller**。

举个例子：玩家 A 扔的手雷炸死了玩家 B。击杀提示应该显示"A 击杀了 B"，而不是"手雷击杀了 B"。这个归属信息就靠 `EventInstigator` 传递。

`GetInstigatorController()` 的追溯路径是：

```
法球.GetInstigator()          → 返回 SpawnParams 里设的 APawn*（玩家角色）
     ↓
角色.GetController()          → 返回控制它的 AController*
     ↓
即 GetInstigatorController() 的结果
```

**如果第三节生成时忘了写 `SpawnParams.Instigator = this;`，这里就是 `nullptr`**，伤害记录里的"凶手"是空的。后续的击杀提示、伤害统计、友军伤害判定、仇恨系统全部失效。

> **延伸**：为什么是 Controller 而不是 Pawn？因为 Pawn 会死亡销毁、会被重生替换，而 Controller 在整局游戏中通常是持久的。用 Controller 做归属主体，玩家死了重生后统计数据仍然连贯。

## 2.4 爆炸特效与销毁

```cpp
UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, ExplosionEffect, GetActorLocation());
Destroy();
```

**为什么爆炸特效要独立生成，而不是激活挂在自己身上的组件？**

因为下一行就 `Destroy()` 了。Actor 被销毁时，它的所有组件一并销毁。如果爆炸特效是子组件，你只能看到它闪现一帧就消失。

`SpawnSystemAtLocation` 生成的是一个**独立的、不属于任何人的 NiagaraComponent**，它挂在世界上，播完自动销毁（`bAutoDestroy` 默认 true）。这就是"射后不理"型的一次性特效。

### `UNiagaraSystem` 与 `UNiagaraComponent` 的区别

这两个类型在本章反复出现，一定要分清：

| 类型 | 是什么 | 本章实例 |
|---|---|---|
| `UNiagaraSystem` | Content 里的**特效资产**，相当于"特效文件" | `ExplosionEffect`、`CastingEffect` |
| `UNiagaraComponent` | 挂在 Actor 上、负责在世界中**实际播放**这个资产的组件，相当于"播放器" | `LoopedNiagaraComponent` |

推论很直接：

- `UNiagaraComponent` 是组件，需要 `CreateDefaultSubobject` 创建并 `SetupAttachment` 挂上去；
- `UNiagaraSystem` 只是一个资产引用，**不需要创建**，在蓝图里选一个资产赋值即可。

`UNiagaraFunctionLibrary` 则是 Niagara 提供的 C++/蓝图工具函数库，`SpawnSystemAtLocation` / `SpawnSystemAttached` 都在这里——它们的工作是"临时造一个播放器，装上指定资产，播完自毁"。

> **这个模式非常重要，第五节的爆炸音效遵循完全相同的逻辑。** 记住这条规律：
>
> **需要在自己销毁后继续存在的表现，必须用 `AtLocation` 系列函数独立生成；需要跟随自己移动的表现，才用组件或 `Attached` 系列。**

`Destroy()` 不是立即释放内存，而是把 Actor 标记为 `PendingKill`，把它从世界中移除，实际的内存回收交给 GC。调用后立刻返回，同一函数内后续代码仍会执行（所以 `Destroy()` 一般放最后一行）。

---

# 第三节：输入绑定与生成投射物

## 3.1 Enhanced Input：`IA_PrimaryAttack`

`UInputAction` 是一个**纯数据资产**。它不知道自己绑在哪个按键上（那是 IMC 的事），也不知道谁会响应它（那是 `BindAction` 的事）。它只描述这个"操作"的语义形状。

### 值类型（Value Type）

| 类型 | 底层 | 用途 | 本项目 |
|---|---|---|---|
| Digital (bool) | `bool` | 开关型操作 | `IA_PrimaryAttack` |
| Axis1D (float) | `float` | 单轴模拟量，如扳机 | — |
| Axis2D (Vector2D) | `FVector2D` | 双轴，如摇杆/WASD | `IA_Move`, `IA_Look` |
| Axis3D (Vector) | `FVector` | 三轴，少见 | — |

值类型决定了回调里 `FInputActionValue` 能取出什么：`Value.Get<bool>()` / `Get<FVector2D>()`。取错类型不会崩溃，但会得到零值。

**驱动阈值（Actuation Threshold）0.5**：给模拟量输入用的。手柄扳机按到 50% 行程才算"按下"。键鼠只有 0/1，所以对本例无影响，但要知道它存在。

### 触发器（Trigger）：本节最大的坑

触发器决定了这个 Action 的**状态机形状**。三个最常用的：

| 触发器 | 按下瞬间 | 按住期间 | 松开 |
|---|---|---|---|
| **（不加，默认 Down）** | `Started` + `Triggered` | **每帧 `Triggered`** | `Completed` |
| **Pressed（已按下）** | `Started` + `Triggered` | 无 | `Completed` |
| **Tap（点按）** | `Started` + `Ongoing` | `Ongoing` | <阈值 → `Triggered`；否则 `Canceled` |

**中文界面的「点按」对应的是 Tap，不是 Pressed。** 这个翻译很容易误导。Tap 的行为是：按下后必须在"点按释放时间阈值"（默认 0.2s）内松开才算触发；按住超时会被判定为 `Canceled`，什么都不会发生。

对射击来说这几乎肯定不是想要的 —— 玩家按住鼠标不放，法球不出来，会以为代码写错了。

**正确做法有两条等价路径：**

1. **不加任何触发器 + 绑 `ETriggerEvent::Started`**（Tom Looman 原版）
2. **加 Pressed 触发器 + 绑 `ETriggerEvent::Triggered`**（更显式）

两者行为一致：按下那一帧触发一次。

> **绝对要避开的组合**：不加触发器 + 绑 `Triggered`。这会导致**按住鼠标每帧生成一个法球**，瞬间几百发，帧率归零。

### `ETriggerEvent` 六种事件

| 事件 | 含义 |
|---|---|
| `Started` | 状态机从 None 进入非 None，即"开始了" |
| `Ongoing` | 条件部分满足但尚未触发（如 Hold 蓄力中） |
| `Triggered` | **触发成立**，最常用 |
| `Completed` | 触发结束（通常是松手） |
| `Canceled` | 中途取消（如 Tap 超时、Hold 提前松手） |
| `None` | 无 |

**关键概念**：触发器改变的是**状态机的形状**，`ETriggerEvent` 只是选择**监听哪个输出**。两者独立，不要混着理解。

> **延伸**：Enhanced Input 还有 Hold（长按）、Hold And Release、Pulse（连发）、Chorded Action（组合键）等触发器，以及 Modifier（修改器）用来处理死区、反转、平滑、缩放。做"蓄力攻击"用 Hold + `Ongoing` 读进度 + `Triggered` 释放，是标准做法。

## 3.2 `UPROPERTY` 说明符体系

```cpp
UPROPERTY(EditDefaultsOnly, Category="Input")
TObjectPtr<UInputAction> Input_PrimaryAttack;
```

### 为什么必须有 `UPROPERTY`

两个理由，缺一不可：

1. **GC（垃圾回收）**：UE 的 GC 通过遍历 `UPROPERTY` 标记的引用来确定对象可达性。一个 `UObject*` 成员不加 `UPROPERTY`，GC 就不知道你在引用它，可能在任意时刻回收掉，留给你一个野指针。这类崩溃极难复现和定位。
2. **反射**：不加就不会出现在编辑器详情面板，你也就无法在蓝图里指定资产。

### 编辑权限说明符对照

| 说明符 | 类默认值可改 | 关卡实例可改 | 典型用途 |
|---|---|---|---|
| `EditAnywhere` | ✓ | ✓ | 需要逐实例微调的参数 |
| `EditDefaultsOnly` | ✓ | ✗ | **类级别配置**（本例） |
| `EditInstanceOnly` | ✗ | ✓ | 巡逻点、关卡专属引用 |
| `VisibleAnywhere` | 只读 | 只读 | 组件指针（能看不能换） |
| `VisibleDefaultsOnly` | 只读 | ✗ | — |
| `VisibleInstanceOnly` | ✗ | 只读 | 运行时状态展示 |

选 `EditDefaultsOnly` 的理由：**"左键是普攻"是这个角色类的定义，不是某个摆在关卡里的实例的属性**。锁死后，关卡里选中某个角色实例根本看不到这个属性，避免了"策划不小心把关卡里某一个角色的普攻改掉，程序 debug 两小时"的经典事故。

蓝图访问权限是另一组正交的说明符：

| 说明符 | 含义 |
|---|---|
| `BlueprintReadOnly` | 蓝图可读不可写 |
| `BlueprintReadWrite` | 蓝图可读可写 |
| （不加） | 蓝图完全不可见 |

其它常用：`Replicated`（网络同步）、`Transient`（不序列化保存）、`meta=(ClampMin="0")`（编辑器数值限制）、`meta=(AllowPrivateAccess="true")`（让 private 成员也能被蓝图访问）。

### `TObjectPtr<>` 而不是裸指针

UE5 的新规范。在编辑器构建下它是一个包装类，能追踪指针的读写访问，为**增量 GC** 和 **延迟加载（Lazy Load）** 服务；在 Shipping 构建下会被编译成裸指针，零运行时开销。

使用上完全等同普通指针：`->`、`== nullptr`、隐式转换都正常。**UE5 新代码一律用它。**

### `Category`

纯粹是详情面板的分组显示。不写的话属性会掉进一个默认分类里，和引擎自带的几百个属性混在一起。支持 `Category="A|B"` 做二级分组。

## 3.3 `BindAction`

```cpp
void ARogueCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	UEnhancedInputComponent* Input = CastChecked<UEnhancedInputComponent>(PlayerInputComponent);

	Input->BindAction(Input_Move, ETriggerEvent::Triggered, this, &ARogueCharacter::Move);
	Input->BindAction(Input_Look, ETriggerEvent::Triggered, this, &ARogueCharacter::Look);
	Input->BindAction(Input_PrimaryAttack, ETriggerEvent::Triggered, this, &ARogueCharacter::PrimaryAttack);
}
```

```cpp
void ARogueCharacter::PrimaryAttack()
{
	// ...
}
```

**注意：`PrimaryAttack()` 不需要 `UFUNCTION()` 标记，也不需要参数。**

不需要 `UFUNCTION` 的原因：`BindAction` 用的是**模板绑定**，编译期直接取成员函数指针，不走反射。这和第二节的 `OnActorHit` 形成鲜明对比。

> **固化一条规律**：
> - 委托名字里带 **Dynamic**（`AddDynamic`、`AddUniqueDynamic`）→ 走反射 → **必须加 `UFUNCTION()`**
> - 模板绑定（`BindAction`、`AddUObject`、`SetTimer`、`BindUFunction` 除外）→ 编译期绑定 → **不要加**

不需要参数的原因：回调可以选择性接收 `const FInputActionValue&`。开火是 bool 型，值恒为 true，没有信息量，所以省略。`Move()` 就需要接收这个参数来读取 `FVector2D`。

## 3.4 `SpawnActor` 完整解析

```cpp
void ARogueCharacter::AttackTimerElapsed()
{
	FVector SpawnLocation = GetMesh()->GetSocketLocation(MuzzleSocketName);
	FRotator SpawnRotation = GetControlRotation();

	FActorSpawnParameters SpawnParams;
	SpawnParams.Instigator = this;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	ARogueProjectileMagic* NewProjectile = GetWorld()->SpawnActor<ARogueProjectileMagic>(
		ProjectileClass, SpawnLocation, SpawnRotation, SpawnParams);

	MoveIgnoreActorAdd(NewProjectile);   // 第五节加入
}
```

### `GetMesh()->GetSocketLocation(MuzzleSocketName)`

`GetMesh()` 是 `ACharacter` 提供的便捷函数，返回作为角色主体的 `USkeletalMeshComponent`。

**Socket（插槽）** 是挂在骨骼上的具名坐标点，可以带位置/旋转/缩放偏移。它随动画实时运动 —— 角色抬手时，手上的插槽位置跟着变。这正是"从手上放法球"需要的。

> **⚠️ 静默失败陷阱**：`GetSocketLocation` 如果找不到指定名字的插槽，**不会报错**，而是退回返回组件自身的世界位置。症状是法球从角色脚下（Mesh 组件原点）冒出来。
>
> 防御写法：
> ```cpp
> ensureMsgf(GetMesh()->DoesSocketExist(MuzzleSocketName), 
>            TEXT("Muzzle socket '%s' not found on %s"), 
>            *MuzzleSocketName.ToString(), *GetName());
> ```
> `ensure` 系列是 UE 的断言：条件为假时在 Output Log 打红字并在调试器中断，但**程序继续运行**（不像 `check` 会直接崩溃）。适合"配错了要吵醒你，但不至于要命"的场景。

把 `"Muzzle_01"` 提成 `FName MuzzleSocketName` 成员变量是好习惯。`FName` 是 UE 的**不可变字符串池**类型：相同字符串在全局只存一份，比较是整数比较（O(1)），非常适合做标识符。凡是"名字"性质的东西（骨骼名、插槽名、GameplayTag、资产名）都用 `FName`，不要用 `FString`。

> **关于它的 `UPROPERTY` 权限选择**：课程用了 `VisibleAnywhere`（只读）。这能防止误改，但代价是以后做敌人（另一套骨骼、另一个插槽名）时必须改 C++ 重编译。用 `EditDefaultsOnly` 则可以在蓝图里改。两种选择都成立 —— 前者优先防错，后者优先复用。**知道这个取舍存在，比选哪一边更重要。**

### `GetControlRotation()` 而不是 `GetActorRotation()`

- **ControlRotation** = 玩家视角/摄像机的朝向
- **ActorRotation** = 角色模型的朝向

第三人称游戏里这两者经常不一致 —— 你可以站着不动只转视角，或者角色朝前跑但视角看向侧面。玩家的直觉是"我瞄哪打哪"，所以要用 ControlRotation。

配合第一节的 `bInitialVelocityInLocalSpace = true`，这个旋转直接决定了法球的飞行方向。

### `FActorSpawnParameters`

C++ 没有 Python 那种关键字参数，UE 的惯例是用一个带默认值的配置结构体，你只改关心的字段。它在栈上创建，以 const 引用传入，没有堆分配开销。

**`SpawnParams.Instigator = this;`**

类型是 `APawn*`，语义是"这次生成最终该由哪个 Pawn 负责"。这是第二节讲的伤害归属链的起点。**忘了写这行，`GetInstigatorController()` 就是 `nullptr`。**

另一个相关字段 `SpawnParams.Owner`（类型 `AActor*`）表示"归属权"，多用于网络权限判断和 `GetOwner()` 查询。单机项目影响不大，但规范做法是一起设上。

**`SpawnCollisionHandlingOverride`**

控制"生成点如果已经和别的碰撞体重叠了怎么办"：

| 选项 | 行为 |
|---|---|
| `AlwaysSpawn` | 不管重叠，照样生成 |
| `AdjustIfPossibleButAlwaysSpawn` | 尝试挪到附近空位，挪不动也生成 |
| `AdjustIfPossibleButDontSpawnIfColliding` | 尝试挪，挪不动就放弃 |
| `DontSpawnIfColliding` | 重叠就不生成，返回 nullptr |
| `Undefined` | 用类的默认值 |

我们选 `AlwaysSpawn`。**注意它的作用域非常窄：它只决定"生成这一瞬间成不成功"，不管生成之后的事。** 所以它并不能解决"法球生成后立刻撞到自己"的问题 —— 那需要下面的忽略列表。

严格说 `AActor` 的默认值本来就是 `AlwaysSpawn`，这行是冗余的。但显式写出来有价值：它声明了"我知道这里会重叠，我就是要生成"，防止以后有人改了类默认值导致静默失效。

### `TSubclassOf<>` 与类型安全

```cpp
UPROPERTY(EditAnywhere, Category="PrimaryAttack")
TSubclassOf<ARogueProjectileMagic> ProjectileClass;
```

`TSubclassOf<T>` 是 `UClass*` 的类型安全包装，提供**双重保护**：

- **编译期**：赋一个不相干的类进去直接报错
- **编辑器**：下拉框只列出 `T` 的子类

用裸 `UClass*` 的话，下拉框会列出项目里全部几千个类，你能选中 `ASoundCue` 然后运行时崩溃。

### 为什么生成蓝图类而不是 C++ 类

```cpp
GetWorld()->SpawnActor<ARogueProjectileMagic>(ProjectileClass, ...)
```

尖括号里的类型**只影响返回值类型**（省掉手写 `Cast<>`），真正决定生成什么的是 `ProjectileClass` 这个运行时参数。

如果直接写 `SpawnActor<ARogueProjectileMagic>()`（不传 class），生成的是纯 C++ 类 —— 一个没有任何 Niagara 资产、没有音效的隐形球。所有资产引用都在 `BP_MagicProjectile` 里。

**这正是第一节 `UCLASS(Abstract)` 存在的意义** —— 从编辑器层面杜绝这个错误。

### 头文件包含规范

```cpp
// RogueCharacter.h
class ARogueProjectileMagic;    // 前置声明就够了

// RogueCharacter.cpp
#include "RogueProjectileMagic.h"   // 实现文件里 include 完整头
```

`TSubclassOf<T>` 是模板，只需要 `T` 的前置声明，不需要完整定义。

**为什么要这么麻烦？** 因为 `RogueCharacter.h` 会被几十个文件包含。如果它 include 了 `RogueProjectileMagic.h`，那你每改一次投射物的头文件，这几十个文件全要重编译。UE 项目的编译时间很大程度上就是被滥用的 include 拖垮的。

> **规律**：头文件里能前置声明就前置声明，`.cpp` 里再 include 完整头。

## 3.5 自伤问题（其一）

第一节的碰撞预设里"其余全部 Block"包含了 Pawn，导致法球会撞到角色自己。生成点在手上，很可能落在胶囊体半径（默认 42）内 —— 法球一出生就撞到自己、触发 `OnActorHit`、当场爆炸。

解法是在投射物侧加入忽略：

```cpp
void ARogueProjectileMagic::PostInitializeComponents()
{
	Super::PostInitializeComponents();
	SphereComponent->OnComponentHit.AddDynamic(this, &ARogueProjectileMagic::OnActorHit);
	SphereComponent->IgnoreActorWhenMoving(GetInstigator(), true);
}
```

它把目标 Actor 加进这个组件的 `MoveIgnoreActors` 列表。这个列表只影响**移动扫掠（sweep）** —— ProjectileMovementComponent 推着球前进时，扫到的碰撞会跳过列表里的 Actor。

**位置必须在 `PostInitializeComponents()`，不能在构造函数**（构造函数里 `GetInstigator()` 是 `nullptr`，且不报错）。

> **作用范围很窄**：它不影响其它类型的射线检测和重叠事件，别指望它能"让法球完全无视玩家"。
>
> **这只解决了一半问题。** 见第五节 5.5。

---

# 第四节：计时器与动画蒙太奇

## 4.1 为什么要把生成延后

改造前：按下左键 → 法球立刻出现。问题是角色还在抬手，法球已经飞出去了，视觉与逻辑脱节。

改造后：

```cpp
void ARogueCharacter::PrimaryAttack()
{
	PlayAnimMontage(AttackMontage);

	GetWorldTimerManager().SetTimer(TimerHandle_PrimaryAttack, this, 
	                                &ARogueCharacter::AttackTimerElapsed, AttackDelayTime);
}

void ARogueCharacter::AttackTimerElapsed()
{
	// 原本 PrimaryAttack 里的生成逻辑全部搬到这里
}
```

0.2 秒这个数字是**对着动画量出来的**，对应角色抬手到位的那一帧。

**这里引入了动作游戏最基础的时间结构概念**：一次攻击不是瞬间事件，而是一段有内部结构的时间轴 ——

```
输入 ──┬─── 前摇 (Startup) ───┬─── 生效帧 (Active) ───┬─── 后摇 (Recovery) ───┤
       │                      │                       │
    动画开始              判定/生成发生            可以输入下一个动作
```

把"生效"从"输入"里剥离出来，是后面所有进阶功能的地基：受击判定窗口、取消（Cancel）窗口、连段输入缓冲、霸体帧、无敌帧，全部建立在这个结构上。

## 4.2 `PlayAnimMontage`

这是 `ACharacter` 提供的便捷函数，大致等价于：

```cpp
GetMesh()->GetAnimInstance()->Montage_Play(AttackMontage, InPlayRate);
```

它返回蒙太奇的时长（秒），**失败返回 0**。

> **调试第一步**：蒙太奇不播放时，先把返回值打出来看是不是 0。

### 蒙太奇不显示的经典陷阱：Slot 节点

**Animation Montage（动画蒙太奇）** 的工作机制是"占用一个插槽（Slot），覆盖掉动画蓝图在该插槽位置的输出"。

如果动画蓝图（ABP）的姿势输出链路上**没有 `Slot 'DefaultSlot'` 节点**，蒙太奇会：

- 正常播放（返回值不是 0）
- 正常触发通知事件
- **但画面上完全看不到**

因为它的输出没有被接进最终姿势。这个 bug 的症状极其迷惑（"一切正常就是没动画"），排查时几乎不会第一时间想到 ABP。

本项目用的是标准 Manny ABP，自带 DefaultSlot，所以能跑。但自己搭 ABP 时百分之百会踩到。

> **延伸**：Slot 还能做**上下半身分离** —— 把上半身动画走 `UpperBody` 插槽，就能实现"边跑边开枪"。这需要在 ABP 里用 Layered Blend Per Bone 节点混合。

## 4.3 `FTimerManager` 与 `FTimerHandle`

### `FTimerHandle` 本质上是一个 ID

`FTimerHandle` 内部只有一个 `uint64`，它不持有任何计时器数据。真正的计时器状态存在 `FTimerManager` 内部的容器里，Handle 只是查询它的钥匙。

**这导致一个反直觉的现象**：

```cpp
void ARogueCharacter::PrimaryAttack()
{
	FTimerHandle AttackTimerHandle;   // ❌ 局部变量
	GetWorldTimerManager().SetTimer(AttackTimerHandle, this, &ARogueCharacter::AttackTimerElapsed, 0.2f);
}
```

**这样写计时器会正常触发。** 函数返回后局部变量销毁，但管理器里的计时器毫发无伤 —— 因为销毁的只是那把"钥匙"。

但你丢掉了 ID，后果有两个：

**其一，永远无法再引用这个计时器。** 这些操作全部做不到：

```cpp
GetWorldTimerManager().ClearTimer(TimerHandle_PrimaryAttack);      // 取消攻击（如角色死亡/被打断）
GetWorldTimerManager().IsTimerActive(TimerHandle_PrimaryAttack);   // 判断"是否正在攻击中"
GetWorldTimerManager().GetTimerRemaining(TimerHandle_PrimaryAttack); // 剩余前摇时间
GetWorldTimerManager().PauseTimer(TimerHandle_PrimaryAttack);      // 暂停
```

**其二，连点行为完全不同。** `SetTimer` 的内部实现开头是：

```cpp
if (FindTimer(InOutHandle))
{
    ClearTimer(InOutHandle);   // 已存在则先清掉
}
```

即：**用同一个 Handle 重复 `SetTimer` 会重置计时器，而不是叠加一个新的**。

| Handle 类型 | 连点 5 次的结果 |
|---|---|
| 局部变量 | 每次都是全新的空 Handle → 5 个独立计时器 → 0.2 秒后连续蹦出 **5 个法球** |
| 成员变量 | 后一次清掉前一次 → 只有最后一次生效 → 出 **1 个法球** |

哪个"对"取决于设计意图，但**局部变量得到的是无意中的行为**。正确写法：

```cpp
// RogueCharacter.h
protected:
	FTimerHandle TimerHandle_PrimaryAttack;
```

### 生命周期安全性

`SetTimer(Handle, this, &Func, Rate)` 这个重载内部走 `FTimerDelegate::CreateUObject`，对 `this` 持有的是**弱引用**。

更关键的是 `UWorld::DestroyActor` 内部会调用：

```cpp
ThisActor->GetWorldTimerManager().ClearAllTimersForObject(ThisActor);
```

**Actor 被销毁时，绑在它身上的所有计时器自动清空。** 所以不会出现"角色死了 0.2 秒后从空气里飞出一个法球"，也不会有野指针崩溃。

这是 UE 计时器系统一个很重要的安全保证，也是它比手搓 `Tick` 累加时间更值得用的核心原因。

### 常用重载

```cpp
// 1. 成员函数
SetTimer(Handle, this, &AMyActor::Func, Rate, bLoop, InitialDelay);

// 2. Lambda
SetTimer(Handle, [this]() { /* ... */ }, Rate, bLoop);

// 3. 委托
FTimerDelegate Del;
Del.BindUFunction(this, FName("Func"), Arg1, Arg2);   // 可以带参数！
SetTimer(Handle, Del, Rate, bLoop);

// 4. 下一帧执行
SetTimerForNextTick(this, &AMyActor::Func);
```

第 3 种是"计时器回调需要传参"的标准解法（注意 `BindUFunction` 走反射，此时目标函数**需要** `UFUNCTION()`）。

`bLoop = true` 配合 `ClearTimer` 是实现"持续射击""周期性伤害（灼烧/中毒）"的常规手段。

### 为什么不用 `Tick` 累加

```cpp
// ❌ 不推荐
void Tick(float DeltaTime)
{
	if (bIsAttacking)
	{
		AttackElapsed += DeltaTime;
		if (AttackElapsed >= 0.2f) { AttackTimerElapsed(); bIsAttacking = false; }
	}
}
```

问题：需要手动管理状态标志、需要 Actor 开启 Tick（每帧开销）、Actor 销毁时要自己清理、多个并行延迟需要多套变量、代码噪音大。

`FTimerManager` 是引擎级的统一调度器，只在到期时才有开销，且自动处理生命周期。

## 4.4 展望：Anim Notify

这套"计时器对齐动画"的做法有明显天花板，Tom Looman 在后续章节会用 **Anim Notify（动画通知）** 替换：

| | 计时器方案 | Anim Notify 方案 |
|---|---|---|
| 时间点写在哪 | C++ 常量 | **蒙太奇资产内部的标记** |
| 改动画节奏 | 要改代码重编译 | 动画师拖动标记即可 |
| 变速播放 | 不同步（计时器不受 PlayRate 影响） | 自动同步 |
| 精度 | 独立时间线，可能漂移 | 与动画帧严格对齐 |

后者是工业标准。现阶段用计时器的价值在于：先单独理解"延迟触发"这件事，不用同时消化动画通知系统。

**但要清楚 `0.2f` 是个魔法数字，不是正确答案。** 至少可以把它提成可配置属性：

```cpp
UPROPERTY(EditDefaultsOnly, Category="PrimaryAttack")
float AttackDelayTime = 0.2f;
```

---

# 第五节：表现层与伤害精化

## 5.1 `ApplyDamage` → `ApplyPointDamage`

```cpp
FVector HitFromDirection = GetActorRotation().Vector();
UGameplayStatics::ApplyPointDamage(OtherActor, 10.f, HitFromDirection, Hit, 
                                   GetInstigatorController(), this, DmgTypeClass);
```

这不只是换个函数名，**它决定了伤害事件能携带多少信息**。

### 三种伤害函数

| 函数 | 事件类型 | 携带信息 | 典型用途 |
|---|---|---|---|
| `ApplyDamage` | `FDamageEvent` | 只有数值 | 掉落伤害、毒圈、DoT |
| `ApplyPointDamage` | `FPointDamageEvent` | 数值 + `FHitResult` + 入射方向 | **子弹、法球、近战** |
| `ApplyRadialDamage` | `FRadialDamageEvent` | 数值 + 中心点 + 内外半径 + 衰减曲线 | 爆炸、AOE |

`ApplyPointDamage` 多出来的两个参数：

- **`HitFromDirection`**：入射方向单位向量。用途包括决定受击动画朝向（前/后/左/右挨打）、屏幕边缘的受击指示器方向、以及**物理冲量的方向**（见 5.6）。
- **`HitInfo`**：完整的 `FHitResult`。这里面的 `BoneName` 让**部位伤害**成为可能：

```cpp
// 接收方的 TakeDamage 里
if (DamageEvent.IsOfType(FPointDamageEvent::ClassID))
{
	const FPointDamageEvent* PointEvent = (FPointDamageEvent*)&DamageEvent;
	if (PointEvent->HitInfo.BoneName == "head")
	{
		ActualDamage *= 2.0f;   // 爆头双倍
	}
}
```

用 `ApplyDamage` 的话，`FDamageEvent` 里这些字段全是空的，什么也拿不到。

### `HitFromDirection = GetActorRotation().Vector()`

`FRotator::Vector()` 把旋转转换成单位方向向量（即该旋转的本地 +X 轴在世界空间的方向）。因为第一节设了 `bRotationFollowsVelocity = true`，投射物的朝向始终等于飞行方向，所以这里语义正确。

> **更稳健的写法**：`GetVelocity().GetSafeNormal()`。如果以后加了重力或制导，朝向和实际速度方向可能不一致。现在 `ProjectileGravityScale = 0` 且直线飞行，两者等价。
>
> `GetSafeNormal()` 而不是 `Normalize()`：前者对零向量安全（返回零向量而不是 NaN）。

## 5.2 `UDamageType`：伤害的属性载体

```cpp
UPROPERTY(EditDefaultsOnly, Category="Damage")
TSubclassOf<UDamageType> DmgTypeClass;
```

然后在内容浏览器里创建 `DmgType_Default` 蓝图类（父类 `UDamageType`），在 `BP_MagicProjectile` 里赋值。

`UDamageType` 是一个**纯数据类** —— 它不执行任何逻辑，只是"标签 + 参数包"。注意一个关键细节：**引擎使用的是它的 CDO**，也就是说这个类的所有实例共享同一份数据，它本质上是一个"配置资产"。

父类自带的字段：

| 字段 | 含义 |
|---|---|
| `DamageImpulse` | 命中时施加的物理冲量大小（**默认 0**） |
| `bCausedByWorld` | 是否为环境伤害（跌落、岩浆） |
| `bScaleMomentumByMass` | 冲量是否按质量缩放 |
| `DestructibleImpulse` | 对可破坏物的冲量 |
| `DamageFalloff` | 径向伤害的衰减指数 |

**为什么这个设计很重要**：同样打 10 点伤害，霰弹（大冲量，推得老远）和毒箭（零冲量，纹丝不动）的区别**不写在武器逻辑里，而是换一个 DamageType 资产**。策划想调"火箭弹击退感更强"，改的是 `DmgType_Explosive` 这个数据资产，不用碰任何代码，不用重编译。

> **延伸：元素伤害系统**
>
> ```cpp
> UCLASS()
> class UDamageType_Fire : public UDamageType
> {
> 	GENERATED_BODY()
> public:
> 	UPROPERTY(EditDefaultsOnly) float BurnChance = 0.3f;
> 	UPROPERTY(EditDefaultsOnly) float BurnDuration = 3.0f;
> };
> ```
> 接收方在 `TakeDamage` 里 Cast 判断类型，实现抗性、易伤、状态附加。这就是绝大多数 RPG 的元素系统骨架。

> **⚠️ 别忘了赋值**：`DmgTypeClass` 提成成员变量后默认是 `nullptr`。传 nullptr 给 `ApplyPointDamage` 不会崩（引擎内部会退回默认类型），但**冲量会失效**，因为读不到 `DamageImpulse`。要么在蓝图里选 `DmgType_Default`，要么在构造函数里补 `DmgTypeClass = UDamageType::StaticClass();`。

## 5.3 音效三件套：本节的知识核心

这一节一口气用了三种不同的音频 API，正好凑齐完整对比。

### `PlaySound2D` —— 施法音效

```cpp
UGameplayStatics::PlaySound2D(this, CastingSound);
```

**不在 3D 空间里**，直接进主声道，音量不随距离衰减，没有左右方位感。

**为什么施法音用 2D？** 因为这是"你自己"的动作。玩家角色的技能音效通常做成 2D，保证任何镜头距离下都清晰可闻。如果做成 3D，镜头拉远时自己的技能声会变小，手感会变虚。

适用：UI 点击、玩家自身技能音、旁白、BGM、系统提示。

> **`bIsUISound` 参数**：`PlaySound2D` 的这个参数**默认为 true**，意味着游戏暂停（`SetGamePaused`）时声音仍会播放。对 UI 音效这是对的，对玩法音效可能不是 —— 如果你希望暂停时施法音也停，需要显式传 false。`UAudioComponent` 上也有同名属性（在 Advanced 分类下），默认 false。

### `PlaySoundAtLocation` —— 爆炸音效

```cpp
UGameplayStatics::PlaySoundAtLocation(this, ExplosionSound, GetActorLocation(), FRotator::ZeroRotator);
```

在世界坐标某点触发一个 **3D 音源**，有距离衰减和方位感（左右耳、HRTF 空间化）。**射后不理** —— 不返回可控组件，声音在那个固定位置播完。

**为什么爆炸必须用这个而不是挂载？** 因为下一行就 `Destroy()` 了。

> **⚠️ 经典 bug**：如果这里用 `SpawnSoundAttached` 把音效挂在投射物上，`Destroy()` 会连声音一起销毁，你只能听到"啪"的一声开头就没了。
>
> **爆炸/命中类音效必须用 `AtLocation`。** 这和第二节爆炸特效用 `SpawnSystemAtLocation` 是完全相同的道理。

### `UAudioComponent` 成员 —— 飞行循环音

```cpp
// .h
UPROPERTY(EditDefaultsOnly, Category="Components")
TObjectPtr<UAudioComponent> LoopedAudioComponent;

// 构造函数
LoopedAudioComponent = CreateDefaultSubobject<UAudioComponent>(TEXT("LoopedAudioComp"));
LoopedAudioComponent->SetupAttachment(SphereComponent);
```

这不是函数调用，是一个**常驻组件**。它挂在 SphereComponent 下，随投射物移动，声源位置实时更新 —— 玩家能听到法球"嗖"地从左耳飞到右耳。

**为什么循环音必须用组件而不是函数？** 因为它需要**被持有和被控制**：要在销毁时停止（这里靠 `Destroy()` 自动带走）、可能要调音量、切换音高、传参数给 SoundCue。函数式的 `PlaySound*` 返回的东西你抓不住。

> **⚠️ 资产要求**：循环音必须是 Looping 属性的 SoundWave，或者 SoundCue 里放了 Looping 节点。否则播一次就停，`UAudioComponent` 不会自动重播。

### 完整对照表（音频与特效遵循同一套逻辑）

| 需求 | 音频 API | Niagara API | 特点 |
|---|---|---|---|
| 一次性、位置固定、可脱离生成者 | `PlaySoundAtLocation` | `SpawnSystemAtLocation` | 射后不理 |
| 一次性、跟随某个组件 | `SpawnSoundAttached` | `SpawnSystemAttached` | 随目标移动，目标销毁则消失 |
| 持续、随物体移动、需后续控制 | `UAudioComponent` 成员 | `UNiagaraComponent` 成员 | 常驻，可读可写 |
| 无空间感、始终清晰 | `PlaySound2D` | —（UI 特效走 UMG） | 不衰减 |

> **判断链**：
> 1. 生成者会不会在表现播完前销毁？会 → 必须用 `AtLocation`
> 2. 需要跟随移动吗？需要 → `Attached` 或组件
> 3. 需要后续控制（停止/调参）吗？需要 → **必须是组件**

## 5.4 `SpawnSystemAttached` 参数详解

```cpp
UNiagaraFunctionLibrary::SpawnSystemAttached(
	CastingEffect,                    // 特效资产
	GetMesh(),                        // 附加到哪个组件
	MuzzleSocketName,                 // 附加到哪个插槽
	FVector::ZeroVector,              // 位置偏移
	FRotator::ZeroRotator,            // 旋转偏移
	EAttachLocation::SnapToTarget,    // 附加方式
	true                              // bAutoDestroy
);
```

### `EAttachLocation` 四个选项

| 选项 | 含义 |
|---|---|
| `KeepRelativeOffset` | 把传入的 Location/Rotation 当作**相对偏移**使用 |
| `KeepWorldPosition` | 保持当前世界位置不变，再建立附加关系 |
| `SnapToTarget` | **忽略传入偏移，直接对齐到目标插槽的变换** |
| `SnapToTargetIncludingScale` | 同上，且继承缩放 |

选 `SnapToTarget` 时传 `ZeroVector`/`ZeroRotator` 是配套的 —— 两者一起表达"就贴在枪口上，不做任何偏移"。这是最常见的默认组合。

### `bAutoDestroy = true` 的隐含要求

特效播完自动销毁。**这要求 Niagara System 是有限时长的。**

如果 `CastingEffect` 内部设成了 Loop，它永远播不完 → 永远不销毁 → 你会在角色手上攒下一堆孤儿特效组件，性能逐渐劣化。

施法特效一般是 burst 型（爆发一次就结束），没问题。但**换资产时要留意这一点**。

## 5.5 自伤问题（其二）：忽略是单向的

第三节解决了"法球飞的时候不撞角色"。但**站着不动测试没问题，一边前冲一边开火时法球还是会炸** —— 因为这时候是角色的胶囊体主动撞上了法球。

**碰撞忽略列表不是"两人互相看不见"，而是"我移动时不撞你"，方向性很强。**

```cpp
// 投射物侧（PostInitializeComponents 里）
SphereComponent->IgnoreActorWhenMoving(GetInstigator(), true);
// 含义：法球飞的时候不撞角色

// 角色侧（AttackTimerElapsed 里）
MoveIgnoreActorAdd(NewProjectile);
// 含义：角色走的时候不撞法球
```

**两个方向都要堵。** 角色的移动扫掠是独立的一套检测，投射物那边的忽略列表管不着它。

`MoveIgnoreActorAdd` 是 `AActor` 的成员函数，内部转发给 RootComponent（角色的胶囊体）：

```cpp
void AActor::MoveIgnoreActorAdd(AActor* ActorToIgnore)
{
	UPrimitiveComponent* RootPrimitiveComponent = Cast<UPrimitiveComponent>(GetRootComponent());
	if (RootPrimitiveComponent)
	{
		RootPrimitiveComponent->IgnoreActorWhenMoving(ActorToIgnore, true);
	}
}
```

**这也是为什么必须接住 `SpawnActor` 的返回值** —— 你要加进列表的是"刚生成的这一个实例"，得拿到它的指针。`SpawnActor<T>` 模板参数的价值在这里体现：返回类型直接就是 `ARogueProjectileMagic*`，不用 `Cast`。

> **⚠️ 一个需要留意的清理问题**：法球 `Destroy()` 后，角色的 `MoveIgnoreActors` 里会留下失效条目。UE 内部有惰性清理（下次移动时剔除无效指针），不会崩也不会明显泄漏。但如果做机枪一秒 20 发，这个列表会短时间膨胀。
>
> **工业级解法是从碰撞通道层面解决**：给投射物一个专属 ObjectChannel，在预设里直接对 Pawn 做更精细的分级（比如区分 `Pawn` 和 `PlayerPawn`）。现阶段的写法够用，知道天花板在哪即可。

## 5.6 物理冲量的完整链路

在测试场景里放几个 `SM_ChamferCube`，勾选相关选项后就能把方块打飞。这条链路有个特点：**任何一环没打开，都是静默失败，没有任何报错。**

```
UGameplayStatics::ApplyPointDamage(...)
      │
      │  构造 FPointDamageEvent，装入 HitInfo 和 ShotDirection
      ▼
AActor::TakeDamage(...)
      │
      │  ① 检查 bCanBeDamaged（Actor 级"可被伤害"）
      │  ② 检查 ActualDamage != 0
      ▼
UPrimitiveComponent::ReceiveComponentDamage(...)
      │
      │  ③ 检查 bApplyImpulseOnDamage（组件级"在伤害上应用冲量"）
      │  ④ 读取 DamageType CDO 的 DamageImpulse，要求 > 0
      │  ⑤ 要求 ShotDirection 非零
      │  ⑥ 检查 IsSimulatingPhysics（组件级"模拟物理"）
      ▼
AddImpulseAtLocation(ShotDirection * DamageImpulse, ImpactPoint, BoneName)
      │
      ▼
   方块飞出去
```

**这里有一个非常重要的推论**：

> `ReceiveComponentDamage` 只在 `FPointDamageEvent` 或 `FRadialDamageEvent` 的情况下才会计算冲量。**普通的 `ApplyDamage`（基类 `FDamageEvent`）根本不携带 `HitInfo.Component`，冲量流程完全不会启动。**
>
> 换句话说：**第五节从 `ApplyDamage` 改成 `ApplyPointDamage`，正是物理冲量能生效的前提。** 这两个改动看似无关，其实是一件事。

四个开关分别在哪：

| 开关 | 所在层级 | 默认值 | 关掉的效果 |
|---|---|---|---|
| **模拟物理** `bSimulatePhysics` | 组件（Physics 分类） | false | 组件是运动学的，冲量被直接丢弃 |
| **可被伤害** `bCanBeDamaged` | Actor | true | 伤害被拦截，返回 0 |
| **在伤害上应用冲量** `bApplyImpulseOnDamage` | 组件（Physics 分类） | true | 能被打但纹丝不动 |
| **`DamageImpulse`** | DamageType CDO | **0** | 冲量为零，无反应 |

> **最容易被忽略的是最后一项**：`DamageImpulse` 默认是 0。如果方块能被打中、伤害正常，但就是不飞，第一个要检查的就是 `DmgType_Default` 里这个数值 —— 需要手动填（几百到几千的量级，取决于目标质量）。

这四个开关各有实际的设计用途：

- 关掉 `bCanBeDamaged` → 无敌帧、不可摧毁的场景物件
- 关掉 `bApplyImpulseOnDamage` → 站桩 Boss（能打但推不动）
- `DamageImpulse` 差异化 → 霰弹推得远、狙击穿透不推

---

# 知识链路总览

## 完整时序图

```
【玩家按下鼠标左键】
        │
        │  IMC_DefaultPlayer 把按键映射到 IA_PrimaryAttack
        │  IA 的 Pressed 触发器 → 状态机输出一次 Triggered
        ▼
BindAction(Input_PrimaryAttack, Triggered, this, &PrimaryAttack)
        │  （模板绑定，无需 UFUNCTION）
        ▼
ARogueCharacter::PrimaryAttack()
        ├── PlayAnimMontage(AttackMontage)              → 角色开始抬手
        ├── SpawnSystemAttached(CastingEffect, 手部插槽) → 手上聚集魔法能量
        ├── PlaySound2D(CastingSound)                   → 施法音（2D，不衰减）
        └── SetTimer(Handle, &AttackTimerElapsed, 0.2f) → 延迟 0.2 秒
                    │
                    │  （FTimerManager 调度，Actor 销毁时自动清理）
                    ▼
ARogueCharacter::AttackTimerElapsed()
        ├── SpawnLocation = GetMesh()->GetSocketLocation(MuzzleSocketName)
        ├── SpawnRotation = GetControlRotation()        → 摄像机朝向
        ├── SpawnParams.Instigator = this               → 伤害归属链起点
        ├── SpawnActor<ARogueProjectileMagic>(ProjectileClass, ...)
        │        │
        │        │  ┌─────────────────────────────────────┐
        │        │  │ 【投射物生命周期】                    │
        │        │  ├─ 构造函数                            │
        │        │  │    ├─ SphereComponent (Root, 预设 "Projectile")
        │        │  │    ├─ NiagaraComponent (拖尾)         │
        │        │  │    ├─ AudioComponent (飞行循环音)     │
        │        │  │    └─ ProjectileMovementComponent     │
        │        │  │         (Speed 2000, Gravity 0,      │
        │        │  │          LocalSpace 初速)             │
        │        │  ├─ Instigator 赋值                     │
        │        │  ├─ PostInitializeComponents()          │
        │        │  │    ├─ OnComponentHit.AddDynamic(...) │
        │        │  │    └─ IgnoreActorWhenMoving(玩家)     │
        │        │  └─ BeginPlay → 开始飞行                │
        │        │  └─────────────────────────────────────┘
        │        ▼
        └── MoveIgnoreActorAdd(NewProjectile)           → 反向忽略，防前冲自伤
                    │
                    │  【飞行中：拖尾特效 + 3D 循环音随之移动】
                    ▼
        【撞到 Block 的物体，扫掠停止】
                    │
                    ▼
ARogueProjectileMagic::OnActorHit(五参数, UFUNCTION 必须)
        ├── HitFromDirection = GetActorRotation().Vector()
        ├── ApplyPointDamage(OtherActor, 10, Dir, Hit, InstigatorController, this, DmgType)
        │        │
        │        └──► TakeDamage → ReceiveComponentDamage
        │                  └──► AddImpulseAtLocation → 方块飞出去
        ├── SpawnSystemAtLocation(ExplosionEffect, ...)  → 独立特效，不随销毁
        ├── PlaySoundAtLocation(ExplosionSound, ...)     → 独立音效，不随销毁
        └── Destroy()
```

## 三条贯穿全章的主线

### 主线一：碰撞设置决定了后面的一切

```
第1节：预设 "Projectile" = WorldDynamic + Query Only + 大部分 Block
   │
   ├─► Block 是 OnComponentHit 能触发的前提           （第2节）
   ├─► Query Only 让移动扫掠生效但不参与物理模拟       （第1节）
   ├─► Visibility/Camera Ignore 避免挡瞄准、顶摄像机   （第1节）
   └─► Block Pawn 埋下自伤隐患
            ├─► 法球一出生就炸  → IgnoreActorWhenMoving   （第3节）
            └─► 前冲时撞到法球  → MoveIgnoreActorAdd      （第5节）
```

**教训**：碰撞是 UE 里最容易出静默 bug 的地方。事件不触发、穿模、莫名爆炸，先查碰撞。

### 主线二：C++ 定契约，蓝图填数据

这个模式在本章出现了至少 7 次：

| C++ 声明 | 蓝图赋值 |
|---|---|
| `TObjectPtr<UInputAction> Input_PrimaryAttack` | `IA_PrimaryAttack` |
| `TSubclassOf<ARogueProjectileMagic> ProjectileClass` | `BP_MagicProjectile` |
| `TObjectPtr<UAnimMontage> AttackMontage` | `Primary_Attack_A_Medium_Montage` |
| `TObjectPtr<UNiagaraSystem> CastingEffect` | `NS_Casting` |
| `TObjectPtr<UNiagaraSystem> ExplosionEffect` | `NS_Gideon_Primary_HitWorld` |
| `TObjectPtr<USoundBase> CastingSound` / `ExplosionSound` | `MSS_Combat_...` |
| `TSubclassOf<UDamageType> DmgTypeClass` | `DmgType_Default` |

**好处**：换资产不用重编译、策划可自行调整、避免硬编码路径失效、减少强引用加载负担。

**代价**：多了一层"忘记赋值"的失败模式，且通常是静默的。`UCLASS(Abstract)` 和 `ensure` 是对抗这个代价的工具。

### 主线三：UFUNCTION 加不加？

| 绑定方式 | 机制 | 需要 `UFUNCTION()` | 本章实例 |
|---|---|---|---|
| `AddDynamic` / `AddUniqueDynamic` | 反射，按函数名字符串查找 | **✓ 必须** | `OnActorHit` |
| `BindAction`（模板重载） | 编译期成员函数指针 | ✗ 不要 | `PrimaryAttack` |
| `SetTimer`（模板重载） | 编译期成员函数指针 | ✗ 不要 | `AttackTimerElapsed` |
| `AddUObject` | 编译期成员函数指针 | ✗ 不要 | — |
| `BindUFunction` | 反射，按名字 | **✓ 必须** | — |

**口诀：名字里带 Dynamic 或 UFunction 的走反射，必须加标记；其余模板绑定不用加。**

---

# 易错点速查表

| 症状 | 最可能的原因 | 检查位置 |
|---|---|---|
| 编译报"找不到 Niagara 头文件" | 模块依赖没加 | `Build.cs` |
| 投射物飞出去但撞墙没反应 | 碰撞没设 Block / Collision Enabled 关着 / 没绑事件 | 碰撞预设、`PostInitializeComponents` |
| `OnActorHit` 从不触发 | 忘了 `UFUNCTION()` / 参数签名不匹配 / 根组件没碰撞 | 函数声明 |
| 法球一出生就在手上炸 | `IgnoreActorWhenMoving` 写在构造函数里了（Instigator 为 null） | `PostInitializeComponents` |
| 站着不炸，前冲就炸 | 少了 `MoveIgnoreActorAdd` | `AttackTimerElapsed` |
| 法球从脚下冒出来 | 插槽名写错，`GetSocketLocation` 静默退回组件原点 | `MuzzleSocketName` 与骨骼资产 |
| 法球隐形无声 | `ProjectileClass` 设成了 C++ 类而非蓝图类 | 蓝图详情面板 |
| 按住鼠标不出球 | 触发器用了 Tap（中文"点按"），超时被 Cancel | `IA_PrimaryAttack` |
| 按住鼠标喷出几百个球 | 无触发器 + 绑了 `Triggered` | 触发器 / `ETriggerEvent` |
| 连点出一堆球（意料之外） | `FTimerHandle` 是局部变量 | 改成成员变量 |
| 蒙太奇不显示（但返回值正常） | ABP 里缺 Slot 节点 | 动画蓝图输出链路 |
| 蒙太奇完全不播（返回 0） | 资产未赋值 / AnimInstance 为空 | 蓝图详情面板 |
| 爆炸音只响一瞬间 | 用了 `SpawnSoundAttached`，被 `Destroy()` 带走 | 改用 `PlaySoundAtLocation` |
| 飞行音只播一次 | 音频资产不是 Looping | SoundWave / SoundCue |
| 手上的施法特效越攒越多 | Niagara System 设了 Loop 但 `bAutoDestroy=true` 等不到结束 | 特效资产 |
| 击杀提示没有凶手 | 忘了 `SpawnParams.Instigator = this` | `AttackTimerElapsed` |
| 方块能被打中但不飞 | ①`DamageImpulse` 是 0 ②没勾模拟物理 ③用的是 `ApplyDamage` 不是 `ApplyPointDamage` | DamageType / 组件 / 伤害调用 |
| 爆炸特效"陷"进墙里 | 用了 `GetActorLocation()`（球心）而非 `Hit.ImpactPoint` | `OnActorHit` |
| 瞄远处打偏 | 生成点在手上、方向是摄像机朝向，两条射线平行但有偏移 | 待办② |

---

# 遗留待办

### ① 爆炸位置改用 `Hit.ImpactPoint`

现状：

```cpp
UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, ExplosionEffect, GetActorLocation());
```

`GetActorLocation()` 是球心，与实际接触面相差一个半径（16）。打平面墙看不出，打斜面或圆角物体时特效会"陷"进去或浮在半空。

改法（`Hit` 就是回调参数，直接可用）：

```cpp
UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, ExplosionEffect, Hit.ImpactPoint);
```

进一步还可以用 `Hit.ImpactNormal` 让特效朝向贴合表面：

```cpp
FRotator ImpactRotation = Hit.ImpactNormal.Rotation();
UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, ExplosionEffect, Hit.ImpactPoint, ImpactRotation);
```

### ② 瞄准偏移

**问题**：生成点在**手上**（角色右前方），飞行方向是**摄像机朝向**。这是两条平行但不重合的射线，法球永远打不到准心正对的那个点。近处不明显，打远处会发现"明明瞄准了却打偏"。

**标准解法**（后续章节会讲）：

1. 从摄像机位置沿视线方向做一次 `LineTraceSingleByChannel`
2. 取命中点（没命中就取视线上一个很远的点）
3. 用 `UKismetMathLibrary::FindLookAtRotation(SpawnLocation, TargetPoint)` 反算出"从枪口指向该点"的旋转
4. 用这个旋转作为 `SpawnRotation`

### ③ 用 Anim Notify 替代硬编码计时器

`0.2f` 是对着动画量出来的魔法数字，换蒙太奇就要重调，且不随 PlayRate 变化。后续会改用动画通知，把时间点埋进资产。

### ④ 自伤问题回到碰撞通道层面解决

现在靠两条 `IgnoreActorWhenMoving` 双向堵漏（见 3.5 与 5.5），能用，但属于打补丁：每发法球都要往列表里加一条，销毁后留下失效条目，射速高时列表会短时间膨胀。

更彻底的做法是给投射物一个专属的 Object Channel，在碰撞预设里对"发射者"和"其它 Pawn"做分级处理。这需要更完整的碰撞通道规划，等后面敌人和队友概念出现后再统一设计更合适。

---

# 第二章完成检查清单

## 投射物类

- [x] 创建 `ARogueProjectileMagic`（继承 `AActor`）
- [x] 加上 `UCLASS(Abstract)` 防止误用 C++ 类
- [x] `SphereComponent` 作为 RootComponent 兼碰撞体，半径 16
- [x] `ProjectileMovementComponent`：`InitialSpeed = 2000`
- [x] `ProjectileGravityScale = 0`（直线飞行）
- [x] `bRotationFollowsVelocity = true`
- [x] `bInitialVelocityInLocalSpace = true`
- [x] `LoopedNiagaraComponent` 挂在球体下
- [x] `LoopedAudioComponent` 挂在球体下（第五节）

## 碰撞

- [x] 在项目设置中创建 `Projectile` 碰撞预设
- [x] Collision Enabled 设为 Query Only
- [x] Object Type 设为 WorldDynamic
- [x] Visibility 与 Camera 设为 Ignore，其余 Block
- [x] 代码中用 `SetCollisionProfileName("Projectile")` 应用

## 模块与资产

- [x] `Build.cs` 中加入 `Niagara`
- [x] 创建蓝图子类 `BP_MagicProjectile`
- [x] 分配飞行特效 `NS_Gideon_Primary`，Z 轴旋转 180°，勾选 Auto Activate
- [x] 分配爆炸特效 `NS_Gideon_Primary_HitWorld`
- [x] 分配爆炸音效与飞行循环音
- [x] 创建 `DmgType_Default` 并在蓝图中赋值

## 命中处理

- [x] 在 `PostInitializeComponents()` 中绑定 `OnComponentHit`
- [x] `OnActorHit` 加 `UFUNCTION()` 标记
- [x] 五个回调参数与委托宏完全一致
- [x] 调用 `ApplyPointDamage` 发送伤害
- [x] 用 `SpawnSystemAtLocation` 生成独立爆炸特效
- [x] 用 `PlaySoundAtLocation` 播放独立爆炸音效
- [x] 最后调用 `Destroy()`

## 输入与生成

- [x] 创建 `IA_PrimaryAttack`（Digital 值类型）
- [x] 触发器配置正确（Pressed + Triggered，或无触发器 + Started）
- [x] 在 `IMC_DefaultPlayer` 中映射鼠标左键
- [x] 声明 `UPROPERTY(EditDefaultsOnly) TObjectPtr<UInputAction> Input_PrimaryAttack`
- [x] 蓝图中完成资产赋值
- [x] `BindAction` 绑定到 `PrimaryAttack()`
- [x] 用 `GetSocketLocation(MuzzleSocketName)` 取生成位置
- [x] 用 `GetControlRotation()` 取生成朝向
- [x] `SpawnParams.Instigator = this`
- [x] 接住 `SpawnActor` 的返回值

## 时间结构

- [x] `PlayAnimMontage(AttackMontage)` 播放施法动画
- [x] `FTimerHandle` 声明为成员变量
- [x] `SetTimer` 延迟 0.2 秒后调用 `AttackTimerElapsed()`
- [x] 生成逻辑全部搬进 `AttackTimerElapsed()`

## 自伤处理

- [x] 投射物侧：`IgnoreActorWhenMoving(GetInstigator(), true)`（写在 `PostInitializeComponents`）
- [x] 角色侧：`MoveIgnoreActorAdd(NewProjectile)`
- [x] 验证站立开火与前冲开火都不自爆

## 表现层与物理

- [x] 施法特效 `SpawnSystemAttached` 挂到手部插槽
- [x] 施法音效 `PlaySound2D`
- [x] 测试方块勾选"模拟物理"
- [x] 测试方块勾选"在伤害上应用冲量"
- [x] `DmgType_Default` 中填写非零的 `DamageImpulse`
- [x] 实测方块能被法球打飞

---

# 术语表

| 术语 | 含义 |
|---|---|
| **CDO** | Class Default Object，类默认对象。每个 UClass 唯一的"出厂设置样板"，生成实例时以它为模板拷贝 |
| **UHT** | UnrealHeaderTool，编译前解析 `UCLASS`/`UPROPERTY` 等宏并生成反射代码 |
| **UBT** | UnrealBuildTool，读取 `.Build.cs` 决定模块依赖和编译配置 |
| **Sweep（扫掠）** | 移动时用碰撞体沿路径做连续检测，防止高速穿模 |
| **Socket（插槽）** | 挂在骨骼上的具名坐标点，随动画运动 |
| **Montage（蒙太奇）** | 可被代码播放的动画片段，通过占用 Slot 覆盖 ABP 输出 |
| **Slot（插槽，动画）** | ABP 中的一个占位节点，蒙太奇播放时接管此处的姿势输出 |
| **Instigator** | 伤害/生成的最终责任 Pawn |
| **DamageCauser** | 直接造成伤害的物体（"凶器"） |
| **动态多播委托** | 通过反射按名字调用、可绑多个监听者、可序列化的事件类型 |
| **Preset（碰撞预设）** | 一组具名的碰撞配置，可全项目复用 |
| **Trace Channel** | 追踪通道（如 Visibility、Camera），用于射线查询的分类 |
| **Object Channel** | 对象通道（如 WorldStatic、Pawn），描述碰撞体"是什么" |
| **PendingKill** | Actor 被 `Destroy()` 后的中间状态，等待 GC 实际回收 |

---

# 参考资料

- [Epic Games：Collision in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/collision-in-unreal-engine)
- [Epic Games：Collision Settings in the Project Settings](https://dev.epicgames.com/documentation/en-us/unreal-engine/collision-settings-in-the-unreal-engine-project-settings)
- [Epic Games：Dynamic Delegates](https://dev.epicgames.com/documentation/en-us/unreal-engine/dynamic-delegates-in-unreal-engine)
- [Epic Games：Gameplay Timers](https://dev.epicgames.com/documentation/unreal-engine/gameplay-timers-in-unreal-engine?lang=en-US)
- [Epic Games：Animation Montage](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-montage-in-unreal-engine)
- [Epic Games：Overview of Niagara Effects](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-niagara-effects-for-unreal-engine)
- [Epic Games：Enhanced Input](https://dev.epicgames.com/documentation/en-us/unreal-engine/enhanced-input-in-unreal-engine)
- [Tom Looman：Unreal Engine 5 C++ Timers](https://tomlooman.com/unreal-engine-cpp-timers/)
