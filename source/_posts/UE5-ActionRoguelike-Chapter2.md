---
title: UE5 C++ 第二章复盘：从一次点击到一发法球的完整远程攻击链路
date: 2026-08-07 20:00:00
categories:
  - [课外, 游戏开发, UE5-Looman]
tags:
  - C++
  - ActionRoguelike
  - Niagara
  - 碰撞系统
  - 委托与事件分发
  - 伤害系统
description: 完整梳理 ActionRoguelike 第二章的五节课，内容包括投射物 Actor 由哪些组件构成、碰撞配置的三个层次、动态委托与命中回调、Enhanced Input 的触发器、SpawnActor 与伤害归属链、计时器与动画蒙太奇、音效和特效的三种生成方式，以及物理冲量的完整链路，并解释每一步为什么要这样写。
cover: /img/covers/UE5-ActionRoguelike-Chapter2.svg
series: UE5 ActionRoguelike
privacy: protected
sitemap: false
private_section: 课外
---

# 前言

本文是 Tom Looman《UE5 C++》第二章 **Projectile & Damage** 的完整复盘，覆盖了课程五节课的全部内容。

上一篇见{% post_link UE5-ActionRoguelike-Chapter1 %}。第一章搭建好了一个「能移动、能观察、有动画的第三人称角色」，这一章要给这个角色加上第一个能对世界产生影响的能力。

本章使用的开发环境如下：

- Unreal Engine `5.6.1`
- Rider
- Visual Studio 2022 Build Tools / MSVC 编译工具链
- 项目名称：`ActionRoguelike`

本章的目标是打通一条完整的远程攻击链路：

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

这条链路表面上只是「做一个技能」，但实际上它把 UE 的组件系统、碰撞系统、模块系统、反射与 UPROPERTY、委托、Actor 生命周期、增强输入、计时器、伤害系统，以及特效与音频全部串联了一遍。

五节课的分工如下：

| 节 | 主题 | 核心产出 |
| --- | --- | --- |
| 第一节 | 创建投射物 Actor | 组件构成、碰撞预设、模块依赖 |
| 第二节 | 命中检测与伤害 | 动态委托、命中回调、伤害归属链 |
| 第三节 | 输入绑定与生成投射物 | Enhanced Input 触发器、`SpawnActor` |
| 第四节 | 计时器与动画蒙太奇 | 前摇结构、`FTimerManager` |
| 第五节 | 表现层与伤害精化 | 点伤害、音效三件套、物理冲量 |

和第一章一样，这篇文章不只记录写了哪些代码，还会重点解释下面几个问题：

- 为什么要写这段代码；
- 每个改动解决了什么问题；
- 本章出现过和可能出现的坑，以及它们的排查顺序。

---

## 目录

- [第一节：创建投射物 Actor](#第一节：创建投射物-Actor)
- [第二节：命中检测与伤害](#第二节：命中检测与伤害)
- [第三节：输入绑定与生成投射物](#第三节：输入绑定与生成投射物)
- [第四节：计时器与动画蒙太奇](#第四节：计时器与动画蒙太奇)
- [第五节：表现层与伤害精化](#第五节：表现层与伤害精化)
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

在 UE 的类继承树上，和「能放进世界的东西」有关的主要有三层：

| 类 | 增加的能力 | 代价 |
|---|---|---|
| `AActor` | 能放进关卡、能持有组件、有 Transform、有生命周期 | 无 |
| `APawn` | 能被 Controller 占据（Possess）、能接收输入 | 多一套占据/控制逻辑 |
| `ACharacter` | 胶囊体 + CharacterMovementComponent + 骨骼网格 | 大量移动状态机开销 |

投射物既不需要被玩家或者 AI 占据，也不需要走路和爬楼梯，所以停在 `AActor` 这一层是最经济的选择。

这里体现了 UE 的一个核心思路，那就是优先通过组合组件来实现功能，而不是通过继承来堆砌功能。投射物需要会飞，并不是去继承一个 `AFlyingActor`，而是挂上一个 `ProjectileMovementComponent`；需要拖尾效果，就挂上一个 `NiagaraComponent`。类本身只负责定义**这些组件之间如何协作**。

`ACTIONROGUELIKE_API` 是 UBT（UnrealBuildTool）自动生成的宏，展开之后是 `__declspec(dllexport)` 或者 `dllimport`，它的作用是让这个类能够被其他模块引用。编写自己模块内的类时必须带上它，否则跨模块链接时会失败。

`GENERATED_BODY()` 是 UHT（UnrealHeaderTool）使用的占位符，在编译之前会被替换成一大段反射所需的样板代码（包括构造函数声明、`StaticClass()`、序列化钩子等）。它必须放在类体的最开头，而且这个类的头文件必须 `#include "XXX.generated.h"`，这条 include 还必须是**最后一个** include。

### `UCLASS(Abstract)` 的作用

这个标记的含义是，**这个 C++ 类本身不能被实例化，但它的子类可以**。具体的表现如下：

- 不出现在关卡编辑器的"放置 Actor"面板里
- 不出现在 `TSubclassOf<>` 属性的下拉框里
- `SpawnActor` 直接传入它会失败并返回 `nullptr`

为什么要加上这个标记呢？因为 `ARogueProjectileMagic` 这个 C++ 类只是一个空壳，Niagara 特效和音效资产全都在蓝图子类 `BP_MagicProjectile` 里指定。如果有人不小心把 `ProjectileClass` 设成了 C++ 类，运行时就会生成一个看不见、也听不到声音的球体，而且不会报错。加上 `Abstract` 之后，这种错误在编辑器层面就不可能发生了。

> 需要注意区分，UE 的 `Abstract` 和 C++ 的抽象类是两个独立的概念。C++ 的抽象性依靠纯虚函数（`virtual void F() = 0;`）实现，由编译器强制检查；而 UE 的 `Abstract` 是反射系统层面的一个标记，并不需要任何纯虚函数，这个类在纯 C++ 的意义上仍然是一个完全具体的类。它约束的是引擎的生成和放置系统，而不是编译器。
>
> Abstract 类仍然会生成 CDO（类默认对象），继承链也照常工作。

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

这个函数**只能在构造函数里调用**，在其他任何地方调用都会触发断言并导致崩溃。要理解这一点，需要先理解 CDO。

在 UE 里，每个 `UClass` 都有一个唯一的 **CDO（Class Default Object，类默认对象）**。它在引擎启动、加载模块时被创建一次，本质上是这个类的「出厂设置样板」。在编辑器的详情面板里看到的默认值，读取的就是 CDO；而在 `SpawnActor` 生成新实例时，引擎实际上是**以 CDO 为模板做一次内存拷贝**，然后再应用蓝图和关卡里覆盖的值。

所以构造函数在整个程序运行期间至少会执行两次，一次是引擎启动时创建 CDO，另一次（或多次）是真正生成实例时。用 `CreateDefaultSubobject` 创建的组件被称为「默认子对象」，它们会随着 CDO 一起被建立，之后每个实例都会拷贝一份。这就是它必须在构造函数里调用的原因，因为一旦离开构造函数，模板就已经定型，再创建就来不及了。

> 由此可以推出，构造函数里不要写任何依赖世界状态的逻辑（比如 `GetWorld()->GetTimeSeconds()`，或者查找其他 Actor），因为创建 CDO 时根本还没有世界。这类逻辑应该放在 `BeginPlay` 或者 `PostInitializeComponents` 里。

`TEXT("SphereComp")` 这个名字必须在**同一个类的继承链内是唯一的**。如果重名，组件就会创建失败，症状通常是运行时崩溃，或者组件莫名其妙地变成了 `nullptr`。这个名字在编辑器的组件树里是可见的，起得清楚一些，对后期调试很有帮助。

### 为什么用碰撞体当 RootComponent

```cpp
RootComponent = SphereComponent;
```

一个 Actor 的所有组件构成一棵树，树根就是 RootComponent。**Actor 的 Transform 实际上就是 RootComponent 的 Transform**，`GetActorLocation()` 返回的是根组件的世界坐标，`SetActorLocation()` 移动的也是根组件，子组件则会跟着一起移动。

这里有两种常见的做法：

- **用一个空的 `USceneComponent` 作为根**，碰撞体作为子组件挂在它下面。这样做的好处是层级清晰，碰撞体也可以有偏移。
- **直接用碰撞体作为根**（本例采用的做法）。这样做的好处是少了一层组件，也少了一次变换计算，移动逻辑更直接。

选择后一种做法的一个关键理由是，`UProjectileMovementComponent` 默认移动的是 **`UpdatedComponent`**，而这个字段在组件初始化时会自动指向 Actor 的 RootComponent。如果根组件本身就是碰撞体，那么「驱动移动的对象」和「检测碰撞的对象」就是同一个，扫掠（sweep）检测自然就能生效，不需要额外的配置。

如果根组件是一个空的 SceneComponent，那么投射物移动时，进行扫掠的就是这个没有碰撞的空组件，球体只是被动地跟着移动，于是**碰撞事件就无法正常触发**。这是一个非常典型的新手陷阱。

半径 16 是一个凭手感调出来的值，它同时决定了两件事情。一是命中判定的宽容度，半径越大越容易打中；二是生成时和角色胶囊体重叠的概率，半径越大，就越容易一出生就撞到自己。

### `UProjectileMovementComponent` 详解

这是 `UMovementComponent` 的一个子类，它**没有任何视觉表现**，唯一的工作就是每一帧计算一个位移增量，并驱动 `UpdatedComponent` 移动（移动时带有扫掠检测）。

它的常用字段如下：

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

其中 `bInitialVelocityInLocalSpace = true` 是关键，它让初速度的方向等于生成时传入的 Rotation 的正前方。这就是为什么在第三节里传入 `GetControlRotation()`，法球就会朝着摄像机的方向飞，因为生成时的旋转直接决定了飞行方向。

`bRotationFollowsVelocity = true` 会让 Actor 的朝向始终和速度向量保持一致。这一点在第五节计算 `HitFromDirection` 时会派上用场，因为用 `GetActorRotation().Vector()` 就能得到入射的方向。

> 补充一点，把 `ProjectileGravityScale` 设为 0 是制作「魔法飞弹」的典型做法，这样飞弹沿直线飞行，可以预测，也容易瞄准。如果设为 0.3 到 0.5，就会得到类似手雷或者弓箭的手感，玩家需要把准星抬高一些。这个值和 `InitialSpeed` 配合起来，是调整投射物手感的两个主要参数。

## 1.3 碰撞系统：本章最重要的基础设施

UE 的碰撞配置由三个层次构成，缺少任何一层都不行：

### 第一层：Collision Enabled（碰撞检测开关）

| 选项 | Query（射线/扫掠查询） | Physics（物理模拟） |
|---|---|---|
| No Collision | ✗ | ✗ |
| Query Only | ✓ | ✗ |
| Physics Only | ✗ | ✓ |
| Collision Enabled | ✓ | ✓ |

- **Query** 负责射线检测（LineTrace）、扫掠移动检测、重叠事件和 `OnComponentHit` 事件。
- **Physics** 负责刚体模拟，也就是物体之间真实的推挤、堆叠和反弹。

这里选择的是 **Query Only**。原因是投射物的移动完全由 `ProjectileMovementComponent` 用代码驱动，不需要物理引擎来接管，但又需要它能检测到自己撞上了什么。如果开启 Physics，不但浪费性能，还会让投射物被重力和碰撞推得到处乱飞。

> 这是一条通用的规律，由代码驱动移动的东西用 Query Only，只有需要真实物理反应的东西才开启 Physics。角色的胶囊体、触发器盒子和投射物，几乎都使用 Query Only。

这里顺便澄清一个非常容易混淆的选项。组件详情面板里的 `Hidden in Game`（中文界面是「游戏中隐藏」）**只控制渲染，并不控制碰撞**。

| 选项 | 控制什么 |
|---|---|
| `Hidden in Game` | 运行时看不看得见 |
| `Collision Enabled` | 能不能发生碰撞 |

调试阶段可以取消球体的隐藏，这样在游戏里就能直接看到碰撞球的实际大小和位置；等外观完全交给 Niagara 以后，再把它隐藏起来。取消隐藏并不会让它多撞到任何东西，而勾选隐藏也不会让它穿过墙壁。

### 第二层：Object Type（我是什么）

每个碰撞组件都属于某一种对象类型。引擎内置的类型有 `WorldStatic`（不会动的场景，比如墙壁和地板）、`WorldDynamic`（会动的场景物件）、`Pawn`、`PhysicsBody`、`Vehicle` 和 `Destructible`，另外还可以自定义类型。

投射物设置为 **WorldDynamic**，因为它会移动，但它既不是 Pawn，也不参与物理模拟。

### 第三层：Response（我对每种类型的反应）

对于每一种对象类型，都可以设置三种反应：

| 反应 | 行为 | 触发的事件 |
|---|---|---|
| **Ignore** | 完全无视，穿过去 | 无 |
| **Overlap** | 穿过去，但通知双方 | `OnComponentBeginOverlap` / `EndOverlap` |
| **Block** | 挡住，停止移动 | `OnComponentHit` |

**这一层和第二节的事件绑定是紧密相关的**。如果绑定了 `OnComponentHit`，就必须把碰撞设置为 Block，否则这个事件永远不会触发。反过来，如果要用 Overlap 制作穿透型的子弹（打中之后不停下，继续飞行），就要绑定 `OnComponentBeginOverlap`。

> 调试时可以记住一点，如果事件不触发，先不要去看代码，而是先去检查碰撞设置。绝大多数问题都出在 Block 和 Overlap 配错了，或者 Collision Enabled 是关闭的。

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

其中两个 Ignore 各有明确的理由：

- **Visibility → Ignore**：`Visibility` 是一个 Trace Channel（追踪通道），大量的瞄准逻辑、拾取检测和 AI 视线判断都使用这个通道。如果投射物会 Block 它，那么一发飞在半空中的法球就会**挡住瞄准用的射线**，导致准星判定落到法球上，而不是落到墙上。
- **Camera → Ignore**：`Camera` 通道被 SpringArm 用来实现摄像机防穿墙。如果投射物会 Block 它，那么每次开火时，摄像机都会被自己的法球往前推，画面就会剧烈抖动。

为什么要用 Preset，而不是逐项手动设置呢？因为**预设是一份可以复用的、有名字的配置**。以后还会有火球、冰箭、箭矢和飞刀，它们全都可以使用 `Projectile` 这个预设。如果哪天需要修改规则（比如让投射物之间互相 Ignore），只要改一处，整个项目就都生效了。

在代码里应用这个预设：

```cpp
SphereComponent->SetCollisionProfileName("Projectile");
```

> 这里埋下了一个隐患。预设里的「其余全部 Block」也包含了 **Pawn**，这意味着法球会撞到角色。这本身是需要的，因为这样才能打到敌人，但它也导致了两个打到自己的问题，分别会在第三节和第五节处理。

## 1.4 `Build.cs` 与模块系统

要使用 Niagara，必须先在 `ActionRoguelike.Build.cs` 里添加依赖：

```csharp
PublicDependencyModuleNames.AddRange(new string[] { 
    "Core", "CoreUObject", "Engine", "InputCore", 
    "EnhancedInput", "Niagara" 
});
```

UE 的代码被划分成上百个**模块（Module）**，每个模块都独立编译成一个 DLL，游戏本身也是一个模块。模块之间必须**显式地声明依赖**，才能相互 include 和链接。

如果漏掉了依赖，症状很典型，要么 `#include "NiagaraComponent.h"` 报出「找不到文件」，要么虽然能编译，但在链接阶段报出一大堆 `unresolved external symbol`。

`Public` 和 `Private` 的区别如下：

- `PublicDependencyModuleNames`：依赖会**传递**给依赖当前模块的其他模块。如果头文件里 include 了某个模块的头文件，就必须把这个模块放在 Public 里。
- `PrivateDependencyModuleNames`：依赖只对本模块可见，不会传递。只在 `.cpp` 里用到的模块放在这里，可以减轻下游模块的编译负担。

常用模块的速查表如下：

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

> 需要注意，修改完 `Build.cs` 之后，需要重新生成项目文件并完整地重新编译。Rider 通常会自动检测到这一点，但如果出现了奇怪的编译错误，可以手动删除 `Binaries` 和 `Intermediate` 目录，再执行 Generate Project Files，这个办法几乎总能解决问题。

## 1.5 蓝图子类 `BP_MagicProjectile`

### 先分清两个 `Projectiles` 文件夹

写到这里，项目里会同时出现两个同名的文件夹，但它们的作用完全不同：

| 路径 | 保存内容 | 作用 |
|---|---|---|
| `Source/ActionRoguelike/Projectiles/` | `.h`、`.cpp` | 存放投射物的 C++ 源码 |
| `Content/Projectiles/` | `.uasset` | 存放可在编辑器中使用的蓝图与资产 |

前者是给编译器和 IDE 看的代码分类，后者是给内容浏览器看的资产分类。它们各自独立，名字相同纯属巧合，彼此不会产生影响。

> 另外还有一个容易出错的顺序问题。新建 C++ 类之后，**必须先编译成功**，虚幻编辑器才能识别这个新的 `UCLASS`，「选择父类」窗口里才会出现 `RogueProjectileMagic`。如果还没编译就去找这个父类，是找不到的。
>
> 还要注意，`Content` 下的资产**最好在内容浏览器里移动和重命名**，不要在 Windows 资源管理器里直接拖动 `.uasset` 文件。因为引擎需要有机会去更新引用或者创建 Redirector，绕过它会导致引用在不知不觉中失效。

### 蓝图里要做的三件事

C++ 类建好之后，右键选择基于它创建蓝图类。然后在蓝图里完成下面三件事：

- 给 `LoopedNiagaraComponent` 分配 `NS_Gideon_Primary`
- 把该组件 Z 轴旋转 180°（因为这个特效资产的默认朝向和飞行方向相反）
- 勾选 `Auto Activate`（否则特效不会自动播放）

这一步体现了 UE 的另一个核心思路，那就是由 C++ 定义行为和接口，由蓝图填写数据和资产。

为什么不在 C++ 里直接用 `ConstructorHelpers::FObjectFinder` 把资产路径写死呢？原因有以下几点：

1. 资产路径是字符串，改名或移动文件就会静默失效
2. 每次换资产都要重编译 C++
3. 美术/策划无法自行调整
4. 硬编码路径会造成不必要的资产强引用，拖慢加载

这种模式在后面会反复出现。`InputAction`、`AnimMontage`、`NiagaraSystem`、`SoundBase` 和 `DamageType` 全都是在 C++ 里声明一个 `UPROPERTY` 指针，再在蓝图里填入具体的资产。

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

**一定不要忘记调用 `Super::`。** 父类在这个阶段做了大量必要的初始化工作（比如完成组件注册、准备网络同步等），漏掉这一句会导致各种难以诊断的问题。

一个由 `SpawnActor` 生成的 Actor，它的关键阶段大致按下面的顺序进行：

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

那么，为什么要把绑定放在第 5 步，而不是放在构造函数里呢？

- 构造函数会在创建 CDO 时执行。如果在构造函数里绑定委托，就相当于给「类模板」绑定了一个回调，含义混乱，而且可能造成引用泄漏。
- 更实际的原因是，**构造函数执行时，`GetInstigator()` 返回的是 `nullptr`**。如果把第三节要添加的 `IgnoreActorWhenMoving(GetInstigator(), true)` 写在构造函数里，就相当于传进去了一个空指针，**而且不会报任何错误**，只会看到法球照样在手上爆炸。

那为什么不放在 `BeginPlay` 里呢？其实放在 `BeginPlay` 里也能正常工作。之所以选择 `PostInitializeComponents`，是因为它执行得更早，可以保证在 `BeginPlay` 中的任何逻辑执行之前，事件绑定就已经完成了。对于一生成就可能立刻发生碰撞的高速投射物来说，这一点时间差是有意义的。

## 2.2 委托系统与 `AddDynamic`

```cpp
UFUNCTION()
void OnActorHit(UPrimitiveComponent* HitComponent, AActor* OtherActor, 
                UPrimitiveComponent* OtherComp, FVector NormalImpulse, 
                const FHitResult& Hit);
```

### 为什么必须加 `UFUNCTION()`

`OnComponentHit` 的类型是 `FComponentHitSignature`，它是一个**动态多播委托**（`DECLARE_DYNAMIC_MULTICAST_DELEGATE_*`）。

- **动态（Dynamic）**：委托内部保存的不是函数指针，而是「对象指针加上函数名字符串」，调用时通过**反射系统按照名字查找**函数。这样做的好处是可以序列化（保存到蓝图资产里），也可以跨越 C++ 和蓝图的边界。
- **多播（Multicast）**：可以绑定多个监听者，广播时会调用所有的监听者。

因为需要按照名字查找函数，所以这个函数**必须注册到反射系统里**，而这正是 `UFUNCTION()` 的作用。如果漏掉了它，编译仍然能够通过（因为 `AddDynamic` 是一个宏），但运行时绑定会失败，回调永远也不会被触发。

这里顺便把 Unreal 的几个反射宏放在一起对照一下，它们各自标记的对象都不相同：

| 宏 | 标记对象 |
|---|---|
| `UCLASS()` | Unreal 类 |
| `USTRUCT()` | Unreal 结构体 |
| `UENUM()` | Unreal 枚举 |
| `UPROPERTY()` | 成员变量 |
| `UFUNCTION()` | 成员函数 |
| `GENERATED_BODY()` | 插入 Unreal 自动生成的反射代码 |

括号里留空**并不代表这个宏没有生效**。即使 `UFUNCTION()` 不写任何说明符，函数也一样会进入反射系统，`AddDynamic` 也能正常绑定。空括号只是表示没有额外指定任何行为。

但是需要注意，如果没有写 `BlueprintCallable` 之类的说明符，这个函数**就不会出现在蓝图的节点菜单里**。所以现在的 `OnActorHit()` 处于「反射系统认识它，但在蓝图里搜不到它」的状态，而这正好符合需要，因为它是由引擎内部调用的回调，不需要暴露给蓝图。

`AddDynamic(this, &Class::Func)` 这个宏展开之后，大致是下面的样子：

```cpp
__Internal_AddDynamic(this, &Class::Func, FName(TEXT("Func")))
```

宏用 `#` 操作符把函数名转换成了字符串。**这也解释了为什么函数名不能写错**，因为一旦写错，字符串就对不上，反射查找就会失败。

### 为什么五个参数必须完全匹配

委托宏定义了严格的函数签名。参数的**个数、类型、顺序、const 修饰以及是否为引用**，都必须一一对应，哪怕少了一个 `const` 也不行。

参数不匹配时，编译错误非常难读（通常是几十行模板展开的错误信息），所以最保险的做法是，**到引擎源码里找到委托的声明，直接复制它的参数列表**。

`OnComponentHit` 的声明如下：

```cpp
DECLARE_DYNAMIC_MULTICAST_DELEGATE_FiveParams(FComponentHitSignature, 
    UPrimitiveComponent*, HitComponent, 
    AActor*, OtherActor, 
    UPrimitiveComponent*, OtherComp, 
    FVector, NormalImpulse, 
    const FHitResult&, Hit);
```

各个参数的含义如下：

| 参数 | 含义 |
|---|---|
| `HitComponent` | 我方发生碰撞的组件（这里就是 SphereComponent） |
| `OtherActor` | 撞到的 Actor（可能为 `nullptr`，比如撞到没有 Actor 的几何体） |
| `OtherComp` | 对方被撞到的具体组件 |
| `NormalImpulse` | 碰撞产生的法向冲量（仅在双方都模拟物理时才有值） |
| `Hit` | **信息最丰富的参数**，见下 |

`FHitResult` 里的关键字段如下：

| 字段 | 含义 | 典型用途 |
|---|---|---|
| `ImpactPoint` | 实际接触点的世界坐标 | 特效/弹孔的精确位置 |
| `ImpactNormal` | 接触表面的法线 | 让弹孔贴合墙面朝向；计算反弹 |
| `Location` | 扫掠体停下时的中心位置 | 与 ImpactPoint 差一个半径 |
| `BoneName` | 击中的骨骼名 | **爆头判定** |
| `PhysMaterial` | 表面物理材质 | 打金属冒火花、打木头崩木屑 |
| `Distance` | 从起点到命中点的距离 | 弹道衰减 |
| `bBlockingHit` | 是否为阻挡命中 | 区分 Block / Overlap |

> 这里说明一下 `Hit.ImpactPoint` 和 `GetActorLocation()` 的区别。投射物的 `GetActorLocation()` 返回的是球心的位置，而 `Hit.ImpactPoint` 是球面和墙面的接触点，两者相差一个半径（16）。打在平整的墙面上时，差别并不明显；但打在斜面或者带圆角的物体上时，如果使用球心，特效就会「陷进」物体里面。**这就是本章的遗留待办①。**

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

`UGameplayStatics` 是一个**静态函数库**（它是 `UBlueprintFunctionLibrary` 的子类），里面全都是无状态的工具函数，同时也暴露给了蓝图。凡是以 `UGameplayStatics::` 开头的函数，都属于这一类由引擎提供的通用工具。

这个函数有五个参数：

| 参数 | 含义 | 本例 |
|---|---|---|
| `DamagedActor` | 谁受伤 | `OtherActor` |
| `BaseDamage` | 基础伤害值 | `10.0f` |
| `EventInstigator` | **哪个 Controller 该为这次伤害负责** | `GetInstigatorController()` |
| `DamageCauser` | 直接造成伤害的物体 | `this`（法球本身） |
| `DamageTypeClass` | 伤害类型 | `DmgTypeClass` |

### `EventInstigator` 与 `DamageCauser` 的区别

这两个参数经常被混淆，但它们的含义完全不同：

- **`DamageCauser`** 相当于「凶器」，指的是直接接触目标的东西，比如法球、手雷或者地刺。
- **`EventInstigator`** 相当于「凶手」，指的是最终应该负责的那个玩家或者 AI 的 **Controller**。

举个例子，玩家 A 扔出的手雷炸死了玩家 B，这时击杀提示应该显示「A 击杀了 B」，而不是「手雷击杀了 B」。这个归属信息就是靠 `EventInstigator` 来传递的。

`GetInstigatorController()` 的追溯路径如下：

```
法球.GetInstigator()          → 返回 SpawnParams 里设的 APawn*（玩家角色）
     ↓
角色.GetController()          → 返回控制它的 AController*
     ↓
即 GetInstigatorController() 的结果
```

**如果第三节生成投射物时忘了写 `SpawnParams.Instigator = this;`，这里得到的就是 `nullptr`**，伤害记录里的「凶手」就是空的。这样一来，后续的击杀提示、伤害统计、友军伤害判定和仇恨系统就全都会失效。

> 那么为什么用 Controller，而不是 Pawn 呢？这是因为 Pawn 会死亡并被销毁，也会在重生时被替换，而 Controller 在整局游戏中通常是一直存在的。用 Controller 作为归属的主体，玩家死亡重生之后，统计数据仍然能够连贯起来。

## 2.4 爆炸特效与销毁

```cpp
UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, ExplosionEffect, GetActorLocation());
Destroy();
```

那么，为什么爆炸特效要单独生成，而不是激活挂在投射物自己身上的组件呢？

因为下一行就调用了 `Destroy()`。Actor 被销毁时，它的所有组件也会一起被销毁。如果爆炸特效是投射物的子组件，就只能看到它闪现一帧，然后马上消失。

`SpawnSystemAtLocation` 生成的是一个**独立的、不属于任何对象的 NiagaraComponent**，它挂在世界上，播放完毕后会自动销毁（`bAutoDestroy` 默认为 true）。这就是所谓「发射之后就不用管」的一次性特效。

### `UNiagaraSystem` 与 `UNiagaraComponent` 的区别

这两个类型在本章里反复出现，一定要分清楚：

| 类型 | 是什么 | 本章实例 |
|---|---|---|
| `UNiagaraSystem` | Content 里的**特效资产**，相当于"特效文件" | `ExplosionEffect`、`CastingEffect` |
| `UNiagaraComponent` | 挂在 Actor 上、负责在世界中**实际播放**这个资产的组件，相当于"播放器" | `LoopedNiagaraComponent` |

由此可以直接得出下面的结论：

- `UNiagaraComponent` 是一个组件，需要用 `CreateDefaultSubobject` 创建，再用 `SetupAttachment` 挂接上去；
- `UNiagaraSystem` 只是一个资产引用，**不需要创建**，只要在蓝图里选择一个资产赋值即可。

`UNiagaraFunctionLibrary` 是 Niagara 提供的 C++ 和蓝图工具函数库，`SpawnSystemAtLocation` 和 `SpawnSystemAttached` 都在这个库里。它们的工作是临时创建一个播放器，装上指定的资产，播放完毕后自动销毁。

> 这个模式非常重要，第五节的爆炸音效遵循的也是完全相同的逻辑。可以记住这样一条规律：
>
> 如果某种表现需要在生成它的对象销毁之后继续存在，就必须用 `AtLocation` 系列函数单独生成；只有需要跟随对象移动的表现，才使用组件或者 `Attached` 系列函数。

`Destroy()` 并不会立即释放内存，而是把 Actor 标记为 `PendingKill`，并把它从世界中移除，实际的内存回收则交给 GC 来完成。调用 `Destroy()` 之后，函数会立刻返回，同一个函数里后面的代码仍然会继续执行，所以 `Destroy()` 一般放在最后一行。

---

# 第三节：输入绑定与生成投射物

## 3.1 Enhanced Input：`IA_PrimaryAttack`

`UInputAction` 是一个**纯粹的数据资产**。它既不知道自己绑定在哪个按键上（那是 IMC 负责的事情），也不知道谁会响应它（那是 `BindAction` 负责的事情），它只描述这个「操作」在语义上是什么形式。

### 值类型（Value Type）

| 类型 | 底层 | 用途 | 本项目 |
|---|---|---|---|
| Digital (bool) | `bool` | 开关型操作 | `IA_PrimaryAttack` |
| Axis1D (float) | `float` | 单轴模拟量，如扳机 | — |
| Axis2D (Vector2D) | `FVector2D` | 双轴，如摇杆/WASD | `IA_Move`, `IA_Look` |
| Axis3D (Vector) | `FVector` | 三轴，少见 | — |

值类型决定了在回调中能从 `FInputActionValue` 里取出什么，比如 `Value.Get<bool>()` 或者 `Get<FVector2D>()`。如果取错了类型，程序并不会崩溃，但得到的会是零值。

**驱动阈值（Actuation Threshold）0.5** 是给模拟量输入使用的，意思是手柄扳机要按到 50% 的行程才算「按下」。键盘和鼠标的输入只有 0 和 1，所以它对本例没有影响，但需要知道有这样一个设置。

### 触发器（Trigger）：本节最大的坑

触发器决定了这个 Action 的**状态机是什么形式**。最常用的三种如下：

| 触发器 | 按下瞬间 | 按住期间 | 松开 |
|---|---|---|---|
| **（不加，默认 Down）** | `Started` + `Triggered` | **每帧 `Triggered`** | `Completed` |
| **Pressed（已按下）** | `Started` + `Triggered` | 无 | `Completed` |
| **Tap（点按）** | `Started` + `Ongoing` | `Ongoing` | <阈值 → `Triggered`；否则 `Canceled` |

**需要特别注意，中文界面里的「点按」对应的是 Tap，而不是 Pressed**，这个翻译很容易误导人。Tap 的行为是，按下之后必须在「点按释放时间阈值」（默认 0.2 秒）之内松开，才算触发；如果按住的时间超过了阈值，就会被判定为 `Canceled`，什么也不会发生。

对于射击来说，这几乎肯定不是想要的效果。因为玩家按住鼠标不放时，法球不会发射出来，玩家会以为是代码写错了。

正确的做法有两种，它们的效果是等价的：

1. **不加任何触发器 + 绑 `ETriggerEvent::Started`**（Tom Looman 原版）
2. **加 Pressed 触发器 + 绑 `ETriggerEvent::Triggered`**（更显式）

这两种做法的行为一致，都是在按下的那一帧触发一次。

> 一定要避开的组合是不加触发器，同时绑定 `Triggered`。这会导致**按住鼠标时每一帧都生成一个法球**，一瞬间就会生成几百发，帧率直接降到零。

### `ETriggerEvent` 六种事件

| 事件 | 含义 |
|---|---|
| `Started` | 状态机从 None 进入非 None，即"开始了" |
| `Ongoing` | 条件部分满足但尚未触发（如 Hold 蓄力中） |
| `Triggered` | **触发成立**，最常用 |
| `Completed` | 触发结束（通常是松手） |
| `Canceled` | 中途取消（如 Tap 超时、Hold 提前松手） |
| `None` | 无 |

这里有一个关键的概念需要分清，触发器改变的是**状态机的形式**，而 `ETriggerEvent` 只是选择**监听哪一个输出**。两者是相互独立的，不要把它们混在一起理解。

> 补充一点，Enhanced Input 还有 Hold（长按）、Hold And Release、Pulse（连发）、Chorded Action（组合键）等触发器，以及用来处理死区、反转、平滑和缩放的 Modifier（修改器）。制作「蓄力攻击」的标准做法，是使用 Hold 触发器，通过 `Ongoing` 读取蓄力进度，再在 `Triggered` 时释放。

## 3.2 `UPROPERTY` 说明符体系

```cpp
UPROPERTY(EditDefaultsOnly, Category="Input")
TObjectPtr<UInputAction> Input_PrimaryAttack;
```

### 为什么必须有 `UPROPERTY`

理由有两个，缺少任何一个都不行：

1. **GC（垃圾回收）**：UE 的 GC 是通过遍历标记了 `UPROPERTY` 的引用，来判断对象是否还能被访问到的。如果一个 `UObject*` 成员没有加 `UPROPERTY`，GC 就不知道它正在被引用，可能会在任意时刻把它回收掉，留下一个野指针。这类崩溃极难复现，也很难定位。
2. **反射**：如果不加 `UPROPERTY`，这个成员就不会出现在编辑器的详情面板里，也就无法在蓝图里给它指定资产。

### 编辑权限说明符对照

| 说明符 | 类默认值可改 | 关卡实例可改 | 典型用途 |
|---|---|---|---|
| `EditAnywhere` | ✓ | ✓ | 需要逐实例微调的参数 |
| `EditDefaultsOnly` | ✓ | ✗ | **类级别配置**（本例） |
| `EditInstanceOnly` | ✗ | ✓ | 巡逻点、关卡专属引用 |
| `VisibleAnywhere` | 只读 | 只读 | 组件指针（能看不能换） |
| `VisibleDefaultsOnly` | 只读 | ✗ | — |
| `VisibleInstanceOnly` | ✗ | 只读 | 运行时状态展示 |

选择 `EditDefaultsOnly` 的理由是，**「左键是普通攻击」是这个角色类的定义，而不是关卡里某一个实例的属性**。把它锁定以后，在关卡里选中某个角色实例时根本看不到这个属性，从而避免了「策划不小心改掉了关卡里某一个角色的普通攻击，程序员调试了两个小时」这种典型的事故。

蓝图的访问权限是另一组相互独立的说明符：

| 说明符 | 含义 |
|---|---|
| `BlueprintReadOnly` | 蓝图可读不可写 |
| `BlueprintReadWrite` | 蓝图可读可写 |
| （不加） | 蓝图完全不可见 |

其他常用的说明符还有 `Replicated`（网络同步）、`Transient`（不序列化保存）、`meta=(ClampMin="0")`（限制编辑器中的数值范围），以及 `meta=(AllowPrivateAccess="true")`（让 private 成员也能被蓝图访问）。

### `TObjectPtr<>` 而不是裸指针

这是 UE5 的新规范。在编辑器构建中，它是一个包装类，能够追踪指针的读写访问，从而为**增量 GC** 和**延迟加载**（Lazy Load）提供支持；而在 Shipping 构建中，它会被编译成普通的裸指针，没有任何运行时开销。

它在使用上和普通的指针完全一样，`->`、`== nullptr` 以及隐式转换都可以正常使用，所以 UE5 的新代码都应该使用它。

### `Category`

`Category` 纯粹用于详情面板的分组显示。如果不写，这个属性就会落进一个默认的分类里，和引擎自带的几百个属性混在一起。它还支持用 `Category="A|B"` 的写法进行二级分组。

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

**需要注意，`PrimaryAttack()` 既不需要 `UFUNCTION()` 标记，也不需要参数。**

它不需要 `UFUNCTION` 的原因是，`BindAction` 使用的是**模板绑定**，在编译期直接获取成员函数的指针，并不经过反射系统。这和第二节的 `OnActorHit` 正好形成了鲜明的对比。

> 由此可以总结出一条规律：
> - 如果委托的名字里带有 **Dynamic**（比如 `AddDynamic`、`AddUniqueDynamic`），它就要通过反射系统调用，所以**必须加上 `UFUNCTION()`**；
> - 如果是模板绑定（比如 `BindAction`、`AddUObject`、`SetTimer`，但 `BindUFunction` 除外），它在编译期就完成了绑定，所以**不需要加**。

它不需要参数的原因是，回调函数可以选择是否接收 `const FInputActionValue&`。开火是 bool 类型的操作，它的值始终为 true，并不携带任何信息，所以这里省略了参数。而 `Move()` 则需要接收这个参数，才能读取 `FVector2D` 的值。

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

`GetMesh()` 是 `ACharacter` 提供的便捷函数，它返回作为角色主体的 `USkeletalMeshComponent`。

**Socket（插槽）** 是挂在骨骼上的一个有名字的坐标点，它可以带有位置、旋转和缩放的偏移，而且会随着动画实时移动。比如角色抬起手时，手上的插槽位置也会跟着变化，而这正是「从手上发射法球」所需要的。

> **⚠️ 这里有一个静默失败的陷阱。** 如果 `GetSocketLocation` 找不到指定名字的插槽，它**并不会报错**，而是退回去返回组件本身的世界位置，症状就是法球从角色的脚下（也就是 Mesh 组件的原点）冒出来。
>
> 防御性的写法如下：
> ```cpp
> ensureMsgf(GetMesh()->DoesSocketExist(MuzzleSocketName), 
>            TEXT("Muzzle socket '%s' not found on %s"), 
>            *MuzzleSocketName.ToString(), *GetName());
> ```
> `ensure` 系列是 UE 提供的断言。当条件为假时，它会在 Output Log 里打印红字，并在调试器中中断，但**程序会继续运行**（这和 `check` 不同，`check` 会直接让程序崩溃）。它适合用在「配置错误时要提醒开发者，但还不至于让程序崩溃」的场景。

把 `"Muzzle_01"` 提取成一个 `FName MuzzleSocketName` 成员变量，是一个好习惯。`FName` 是 UE 中的**不可变字符串池**类型，相同的字符串在全局只保存一份，比较时只需要比较整数（时间复杂度是 O(1)），所以非常适合用作标识符。凡是带有「名字」性质的东西（比如骨骼名、插槽名、GameplayTag 和资产名），都应该使用 `FName`，而不要使用 `FString`。

> 关于这个成员的 `UPROPERTY` 权限，课程里使用的是 `VisibleAnywhere`（只读）。这样可以防止误改，但代价是以后制作敌人时（敌人使用另一套骨骼，插槽名也不同），就必须修改 C++ 并重新编译。如果使用 `EditDefaultsOnly`，就可以在蓝图里修改它。这两种选择都说得通，前者优先考虑防止出错，后者优先考虑复用。知道存在这样一个取舍，比具体选择哪一种更重要。

### `GetControlRotation()` 而不是 `GetActorRotation()`

- **ControlRotation** 是玩家视角，也就是摄像机的朝向；
- **ActorRotation** 是角色模型的朝向。

在第三人称游戏里，这两个朝向经常是不一致的。比如角色可以站着不动，只转动视角；也可以朝前跑，同时视角看向侧面。玩家的直觉是「瞄准哪里就打到哪里」，所以这里要使用 ControlRotation。

再配合第一节设置的 `bInitialVelocityInLocalSpace = true`，这个旋转就直接决定了法球的飞行方向。

### `FActorSpawnParameters`

C++ 没有 Python 那样的关键字参数，所以 UE 的惯例是使用一个带有默认值的配置结构体，只修改关心的那几个字段。这个结构体在栈上创建，以 const 引用的方式传入，没有堆分配的开销。

**`SpawnParams.Instigator = this;`**

它的类型是 `APawn*`，含义是「这次生成最终应该由哪个 Pawn 负责」。这是第二节所讲的伤害归属链的起点。**如果忘了写这一行，`GetInstigatorController()` 得到的就是 `nullptr`。**

另一个相关的字段是 `SpawnParams.Owner`（类型是 `AActor*`），它表示「归属权」，主要用于网络权限的判断和 `GetOwner()` 查询。它对单机项目的影响不大，但规范的做法是把它也一起设置上。

**`SpawnCollisionHandlingOverride`**

这个字段控制的是「如果生成点已经和别的碰撞体重叠了，应该怎么处理」：

| 选项 | 行为 |
|---|---|
| `AlwaysSpawn` | 不管重叠，照样生成 |
| `AdjustIfPossibleButAlwaysSpawn` | 尝试挪到附近空位，挪不动也生成 |
| `AdjustIfPossibleButDontSpawnIfColliding` | 尝试挪，挪不动就放弃 |
| `DontSpawnIfColliding` | 重叠就不生成，返回 nullptr |
| `Undefined` | 用类的默认值 |

这里选择的是 `AlwaysSpawn`。**需要注意的是，它的作用范围非常窄，它只决定生成的那一瞬间能否成功，并不管生成之后发生的事情。** 所以它并不能解决「法球生成后立刻撞到自己」的问题，要解决这个问题，需要使用下面介绍的忽略列表。

严格来说，`AActor` 的默认值本来就是 `AlwaysSpawn`，所以这一行是多余的。但是把它明确写出来是有价值的，因为它表明了「这里知道会发生重叠，但仍然要生成」，可以防止以后有人修改了类的默认值，导致这里在不知不觉中失效。

### `TSubclassOf<>` 与类型安全

```cpp
UPROPERTY(EditAnywhere, Category="PrimaryAttack")
TSubclassOf<ARogueProjectileMagic> ProjectileClass;
```

`TSubclassOf<T>` 是 `UClass*` 的一个类型安全的包装，它提供了**双重保护**：

- **在编译期**，如果赋给它一个不相关的类，就会直接报错；
- **在编辑器中**，下拉框里只会列出 `T` 的子类。

如果使用裸的 `UClass*`，下拉框里就会列出项目中全部几千个类，于是可能会选中 `ASoundCue`，然后在运行时崩溃。

### 为什么生成蓝图类而不是 C++ 类

```cpp
GetWorld()->SpawnActor<ARogueProjectileMagic>(ProjectileClass, ...)
```

尖括号里的类型**只影响返回值的类型**（这样可以省去手写 `Cast<>`），真正决定生成什么的，是 `ProjectileClass` 这个运行时的参数。

如果直接写 `SpawnActor<ARogueProjectileMagic>()`（不传入 class 参数），生成的就是纯 C++ 类，也就是一个没有任何 Niagara 资产、也没有音效的隐形球体，因为所有的资产引用都在 `BP_MagicProjectile` 里。

**这正是第一节加上 `UCLASS(Abstract)` 的意义**，它从编辑器的层面杜绝了这种错误。

### 头文件包含规范

```cpp
// RogueCharacter.h
class ARogueProjectileMagic;    // 前置声明就够了

// RogueCharacter.cpp
#include "RogueProjectileMagic.h"   // 实现文件里 include 完整头
```

`TSubclassOf<T>` 是一个模板，它只需要 `T` 的前置声明，并不需要完整的定义。

那么为什么要这么麻烦呢？因为 `RogueCharacter.h` 会被几十个文件包含。如果它 include 了 `RogueProjectileMagic.h`，那么每次修改投射物的头文件，这几十个文件就全都要重新编译。UE 项目的编译时间，在很大程度上就是被滥用的 include 拖慢的。

> 所以有这样一条规律，在头文件里能用前置声明的地方就用前置声明，在 `.cpp` 里再 include 完整的头文件。

## 3.5 自伤问题（其一）

第一节的碰撞预设里，「其余全部 Block」包含了 Pawn，这导致法球会撞到角色自己。由于生成点在手上，很可能落在胶囊体的半径（默认是 42）以内，所以法球一出生就会撞到自己，触发 `OnActorHit`，然后当场爆炸。

解决办法是在投射物这一侧加入忽略：

```cpp
void ARogueProjectileMagic::PostInitializeComponents()
{
	Super::PostInitializeComponents();
	SphereComponent->OnComponentHit.AddDynamic(this, &ARogueProjectileMagic::OnActorHit);
	SphereComponent->IgnoreActorWhenMoving(GetInstigator(), true);
}
```

它会把目标 Actor 加进这个组件的 `MoveIgnoreActors` 列表。这个列表只影响**移动时的扫掠（sweep）检测**，也就是在 ProjectileMovementComponent 推动球体前进时，扫掠到的碰撞会跳过列表里的 Actor。

**这句代码的位置必须在 `PostInitializeComponents()` 里，而不能放在构造函数里**（因为在构造函数里，`GetInstigator()` 返回的是 `nullptr`，而且不会报错）。

> 需要注意，它的作用范围很窄。它并不影响其他类型的射线检测和重叠事件，所以不能指望它让法球完全无视玩家。
>
> 而且这样做只解决了一半的问题，另一半见第五节的 5.5。

---

# 第四节：计时器与动画蒙太奇

## 4.1 为什么要把生成延后

改造之前，按下左键之后，法球会立刻出现。问题在于角色还在抬手的时候，法球就已经飞出去了，视觉表现和逻辑脱节。

改造之后的代码如下：

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

0.2 秒这个数字是**对照动画测量出来的**，它对应的是角色抬手到位的那一帧。

这里引入了动作游戏里最基础的时间结构概念。一次攻击并不是一个瞬间发生的事件，而是一段有内部结构的时间轴：

```
输入 ──┬─── 前摇 (Startup) ───┬─── 生效帧 (Active) ───┬─── 后摇 (Recovery) ───┤
       │                      │                       │
    动画开始              判定/生成发生            可以输入下一个动作
```

把「生效」从「输入」中分离出来，是后面所有进阶功能的基础。受击判定窗口、取消（Cancel）窗口、连段输入缓冲、霸体帧和无敌帧，全部都建立在这个结构之上。

## 4.2 `PlayAnimMontage`

这是 `ACharacter` 提供的一个便捷函数，它大致等价于下面的代码：

```cpp
GetMesh()->GetAnimInstance()->Montage_Play(AttackMontage, InPlayRate);
```

它会返回蒙太奇的时长（以秒为单位），**如果失败，就返回 0**。

> 所以当蒙太奇不播放时，调试的第一步就是把这个返回值打印出来，看看它是不是 0。

### 蒙太奇不显示的经典陷阱：Slot 节点

**Animation Montage（动画蒙太奇）** 的工作机制是，占用一个插槽（Slot），并覆盖动画蓝图在这个插槽位置上的输出。

如果动画蓝图（ABP）的姿势输出链路上**没有 `Slot 'DefaultSlot'` 节点**，蒙太奇就会出现下面的情况：

- 正常播放（返回值不是 0）
- 正常触发通知事件
- **但画面上完全看不到**

这是因为它的输出没有被接入最终的姿势。这个 bug 的症状非常迷惑人，一切看起来都很正常，只是没有动画，所以排查时几乎不会第一时间想到 ABP。

本项目使用的是标准的 Manny ABP，它自带 DefaultSlot，所以能够正常运行。但是如果自己搭建 ABP，就一定会遇到这个问题。

> 补充一点，Slot 还可以用来实现**上下半身分离**。比如让上半身的动画走 `UpperBody` 插槽，就能实现「边跑边开枪」的效果。这需要在 ABP 里使用 Layered Blend Per Bone 节点进行混合。

## 4.3 `FTimerManager` 与 `FTimerHandle`

### `FTimerHandle` 本质上是一个 ID

`FTimerHandle` 内部只有一个 `uint64`，它并不持有任何计时器的数据。真正的计时器状态保存在 `FTimerManager` 内部的容器里，Handle 只是用来查询它的一把钥匙。

这就导致了一个违反直觉的现象：

```cpp
void ARogueCharacter::PrimaryAttack()
{
	FTimerHandle AttackTimerHandle;   // ❌ 局部变量
	GetWorldTimerManager().SetTimer(AttackTimerHandle, this, &ARogueCharacter::AttackTimerElapsed, 0.2f);
}
```

**像这样写，计时器仍然会正常触发。** 函数返回之后，局部变量虽然被销毁了，但管理器里的计时器并没有受到任何影响，因为被销毁的只是那把「钥匙」。

但是这样一来，ID 就丢失了，这会带来两个后果。

**第一个后果是，再也无法引用这个计时器了。** 下面这些操作全都无法完成：

```cpp
GetWorldTimerManager().ClearTimer(TimerHandle_PrimaryAttack);      // 取消攻击（如角色死亡/被打断）
GetWorldTimerManager().IsTimerActive(TimerHandle_PrimaryAttack);   // 判断"是否正在攻击中"
GetWorldTimerManager().GetTimerRemaining(TimerHandle_PrimaryAttack); // 剩余前摇时间
GetWorldTimerManager().PauseTimer(TimerHandle_PrimaryAttack);      // 暂停
```

**第二个后果是，连续点击时的行为会完全不同。** `SetTimer` 的内部实现一开始是这样的：

```cpp
if (FindTimer(InOutHandle))
{
    ClearTimer(InOutHandle);   // 已存在则先清掉
}
```

也就是说，**用同一个 Handle 重复调用 `SetTimer`，会重置计时器，而不是再叠加一个新的计时器**。

| Handle 类型 | 连点 5 次的结果 |
|---|---|
| 局部变量 | 每次都是全新的空 Handle → 5 个独立计时器 → 0.2 秒后连续蹦出 **5 个法球** |
| 成员变量 | 后一次清掉前一次 → 只有最后一次生效 → 出 **1 个法球** |

哪一种行为是「对」的，取决于设计意图，但**使用局部变量得到的是一种无意中产生的行为**。正确的写法是把 Handle 声明成成员变量：

```cpp
// RogueCharacter.h
protected:
	FTimerHandle TimerHandle_PrimaryAttack;
```

### 生命周期安全性

`SetTimer(Handle, this, &Func, Rate)` 这个重载在内部使用 `FTimerDelegate::CreateUObject`，它对 `this` 持有的是**弱引用**。

更关键的是，`UWorld::DestroyActor` 在内部会调用下面的代码：

```cpp
ThisActor->GetWorldTimerManager().ClearAllTimersForObject(ThisActor);
```

**Actor 被销毁时，绑定在它身上的所有计时器都会被自动清除。** 所以不会出现「角色死了 0.2 秒之后，空气里又飞出一个法球」的情况，也不会发生野指针导致的崩溃。

这是 UE 计时器系统提供的一个很重要的安全保证，也是它比在 `Tick` 里手动累加时间更值得使用的核心原因。

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

第 3 种写法是「计时器回调需要传递参数」时的标准解法（需要注意，`BindUFunction` 会通过反射调用，所以这时目标函数**需要**加上 `UFUNCTION()`）。

`bLoop = true` 再配合 `ClearTimer`，是实现「持续射击」和「周期性伤害（比如灼烧、中毒）」的常规手段。

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

这种写法的问题在于，需要手动管理状态标志，需要让 Actor 开启 Tick（每一帧都有开销），Actor 被销毁时需要自己清理，多个并行的延迟需要多套变量，而且代码里会有大量的干扰内容。

`FTimerManager` 是引擎级别的统一调度器，只有在计时器到期时才会产生开销，而且它会自动处理生命周期的问题。

## 4.4 展望：Anim Notify

这种「用计时器对齐动画」的做法有明显的局限性，Tom Looman 在后面的章节中会用 **Anim Notify（动画通知）** 来替换它：

| | 计时器方案 | Anim Notify 方案 |
|---|---|---|
| 时间点写在哪 | C++ 常量 | **蒙太奇资产内部的标记** |
| 改动画节奏 | 要改代码重编译 | 动画师拖动标记即可 |
| 变速播放 | 不同步（计时器不受 PlayRate 影响） | 自动同步 |
| 精度 | 独立时间线，可能漂移 | 与动画帧严格对齐 |

后一种方案是工业界的标准做法。现阶段使用计时器的价值在于，可以先单独理解「延迟触发」这件事，而不必同时去消化动画通知系统。

**但是需要清楚，`0.2f` 只是一个魔法数字，并不是正确的答案。** 至少可以把它提取成一个可以配置的属性：

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

这并不只是换了一个函数名，**它决定了伤害事件能够携带多少信息**。

### 三种伤害函数

| 函数 | 事件类型 | 携带信息 | 典型用途 |
|---|---|---|---|
| `ApplyDamage` | `FDamageEvent` | 只有数值 | 掉落伤害、毒圈、DoT |
| `ApplyPointDamage` | `FPointDamageEvent` | 数值 + `FHitResult` + 入射方向 | **子弹、法球、近战** |
| `ApplyRadialDamage` | `FRadialDamageEvent` | 数值 + 中心点 + 内外半径 + 衰减曲线 | 爆炸、AOE |

`ApplyPointDamage` 多出来的两个参数如下：

- **`HitFromDirection`**：入射方向的单位向量。它的用途包括决定受击动画的朝向（从前、后、左、右哪个方向挨打）、屏幕边缘受击指示器的方向，以及**物理冲量的方向**（见 5.6）。
- **`HitInfo`**：完整的 `FHitResult`。其中的 `BoneName` 让**部位伤害**成为可能：

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

如果使用 `ApplyDamage`，`FDamageEvent` 里的这些字段全都是空的，什么也拿不到。

### `HitFromDirection = GetActorRotation().Vector()`

`FRotator::Vector()` 会把旋转转换成单位方向向量（也就是这个旋转的本地 +X 轴在世界空间中的方向）。因为第一节设置了 `bRotationFollowsVelocity = true`，投射物的朝向始终等于飞行的方向，所以这里的含义是正确的。

> 更稳妥的写法是使用 `GetVelocity().GetSafeNormal()`。因为以后如果加入了重力或者制导，投射物的朝向和实际速度的方向可能会不一致。不过现在 `ProjectileGravityScale = 0`，而且是直线飞行，所以两种写法是等价的。
>
> 这里使用 `GetSafeNormal()`，而不是 `Normalize()`，是因为前者对零向量是安全的（遇到零向量时返回零向量，而不是 NaN）。

## 5.2 `UDamageType`：伤害的属性载体

```cpp
UPROPERTY(EditDefaultsOnly, Category="Damage")
TSubclassOf<UDamageType> DmgTypeClass;
```

然后在内容浏览器里创建一个名为 `DmgType_Default` 的蓝图类（父类是 `UDamageType`），并在 `BP_MagicProjectile` 里给它赋值。

`UDamageType` 是一个**纯数据类**，它不执行任何逻辑，只是一个「标签加参数包」。需要注意一个关键的细节，**引擎使用的是它的 CDO**，也就是说，这个类的所有实例共享同一份数据，所以它本质上是一个「配置资产」。

父类自带的字段如下：

| 字段 | 含义 |
|---|---|
| `DamageImpulse` | 命中时施加的物理冲量大小（**默认 0**） |
| `bCausedByWorld` | 是否为环境伤害（跌落、岩浆） |
| `bScaleMomentumByMass` | 冲量是否按质量缩放 |
| `DestructibleImpulse` | 对可破坏物的冲量 |
| `DamageFalloff` | 径向伤害的衰减指数 |

这个设计之所以重要，是因为同样造成 10 点伤害，霰弹（冲量大，能把目标推得很远）和毒箭（冲量为零，目标纹丝不动）之间的区别，**并不是写在武器的逻辑里，而是通过换一个 DamageType 资产来实现的**。如果策划想让「火箭弹的击退感更强」，只需要修改 `DmgType_Explosive` 这个数据资产，既不用碰任何代码，也不用重新编译。

> 补充一点，这个设计可以进一步扩展成元素伤害系统：
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
> 接收伤害的一方在 `TakeDamage` 里用 Cast 判断伤害的类型，就可以实现抗性、易伤和附加状态。绝大多数 RPG 的元素系统，都是以此为骨架的。

> **⚠️ 别忘了赋值。** `DmgTypeClass` 被提取成成员变量之后，默认值是 `nullptr`。把 nullptr 传给 `ApplyPointDamage` 并不会导致崩溃（引擎内部会退回使用默认的伤害类型），但是**冲量会失效**，因为读不到 `DamageImpulse`。所以要么在蓝图里选择 `DmgType_Default`，要么在构造函数里补上 `DmgTypeClass = UDamageType::StaticClass();`。

## 5.3 音效三件套：本节的知识核心

这一节一下子用到了三种不同的音频 API，正好可以做一个完整的对比。

### `PlaySound2D` —— 施法音效

```cpp
UGameplayStatics::PlaySound2D(this, CastingSound);
```

它播放的声音**不在 3D 空间里**，而是直接进入主声道，音量不会随距离衰减，也没有左右的方位感。

那么为什么施法音效要用 2D 的方式播放呢？因为这是玩家自己的动作。玩家角色的技能音效通常都做成 2D 的，这样可以保证在任何镜头距离下都能听得很清楚。如果做成 3D 的，镜头拉远时，自己的技能声音就会变小，手感也会变得发虚。

它适用于 UI 点击、玩家自身的技能音效、旁白、背景音乐和系统提示。

> 需要注意 `bIsUISound` 这个参数。`PlaySound2D` 的这个参数**默认为 true**，这意味着游戏暂停（`SetGamePaused`）时，声音仍然会继续播放。这对 UI 音效来说是对的，但对玩法相关的音效来说可能就不对了。如果希望游戏暂停时施法音效也停止，就需要显式地传入 false。`UAudioComponent` 上也有一个同名的属性（在 Advanced 分类下），它的默认值是 false。

### `PlaySoundAtLocation` —— 爆炸音效

```cpp
UGameplayStatics::PlaySoundAtLocation(this, ExplosionSound, GetActorLocation(), FRotator::ZeroRotator);
```

它会在世界坐标中的某个点触发一个 **3D 音源**，这个音源有距离衰减和方位感（包括左右耳的区别和 HRTF 空间化）。它也属于发射之后就不用管的类型，不会返回可以控制的组件，声音会在那个固定的位置播放完毕。

那么为什么爆炸音效必须用这种方式，而不能挂在投射物上呢？因为下一行就调用了 `Destroy()`。

> **⚠️ 这是一个经典的 bug。** 如果在这里用 `SpawnSoundAttached` 把音效挂在投射物上，`Destroy()` 就会把声音也一起销毁，结果只能听到「啪」的一声开头，声音就没有了。
>
> 所以爆炸和命中这类音效必须使用 `AtLocation` 系列函数。这和第二节的爆炸特效使用 `SpawnSystemAtLocation`，是完全相同的道理。

### `UAudioComponent` 成员 —— 飞行循环音

```cpp
// .h
UPROPERTY(EditDefaultsOnly, Category="Components")
TObjectPtr<UAudioComponent> LoopedAudioComponent;

// 构造函数
LoopedAudioComponent = CreateDefaultSubobject<UAudioComponent>(TEXT("LoopedAudioComp"));
LoopedAudioComponent->SetupAttachment(SphereComponent);
```

这里用的并不是一次函数调用，而是一个**常驻的组件**。它挂在 SphereComponent 的下面，随着投射物一起移动，声源的位置也会实时更新，所以玩家能听到法球「嗖」地一声从左耳飞到右耳。

那么为什么循环音效必须用组件，而不能用函数播放呢？因为它需要**被持有和被控制**。比如在销毁时要停止播放（这里依靠 `Destroy()` 自动处理），可能还需要调整音量、切换音高，或者给 SoundCue 传递参数。而函数式的 `PlaySound*` 返回的东西是无法抓住并控制的。

> **⚠️ 这对资产有要求。** 循环音效必须是开启了 Looping 属性的 SoundWave，或者是在 SoundCue 里放了 Looping 节点。否则它播放一次就会停止，`UAudioComponent` 并不会自动重新播放。

### 完整对照表（音频与特效遵循同一套逻辑）

| 需求 | 音频 API | Niagara API | 特点 |
|---|---|---|---|
| 一次性、位置固定、可脱离生成者 | `PlaySoundAtLocation` | `SpawnSystemAtLocation` | 射后不理 |
| 一次性、跟随某个组件 | `SpawnSoundAttached` | `SpawnSystemAttached` | 随目标移动，目标销毁则消失 |
| 持续、随物体移动、需后续控制 | `UAudioComponent` 成员 | `UNiagaraComponent` 成员 | 常驻，可读可写 |
| 无空间感、始终清晰 | `PlaySound2D` | —（UI 特效走 UMG） | 不衰减 |

> 可以按照下面的顺序来判断：
> 1. 生成这个表现的对象，会不会在表现播放完之前就被销毁？如果会，就必须使用 `AtLocation` 系列函数。
> 2. 这个表现需要跟随对象移动吗？如果需要，就使用 `Attached` 系列函数或者组件。
> 3. 之后还需要控制它吗（比如停止播放或者调整参数）？如果需要，就**必须使用组件**。

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

选择 `SnapToTarget` 时，传入 `ZeroVector` 和 `ZeroRotator` 是配套的做法，两者合起来表达的意思是「直接贴在枪口上，不做任何偏移」。这是最常见的默认组合。

### `bAutoDestroy = true` 的隐含要求

这个参数表示特效播放完毕后会自动销毁，**它要求 Niagara System 的时长是有限的**。

如果 `CastingEffect` 内部设置成了循环播放，它就永远也播放不完，所以永远不会被销毁，结果就会在角色的手上积攒下一大堆无人管理的特效组件，性能也会逐渐变差。

施法特效一般是 burst 类型的，也就是爆发一次就结束，所以不会有问题。但是**更换资产时要留意这一点**。

## 5.5 自伤问题（其二）：忽略是单向的

第三节解决了「法球飞行时不会撞到角色」的问题。但是**站着不动测试时没有问题，一边往前冲一边开火时，法球还是会爆炸**。这是因为这时候是角色的胶囊体主动撞上了法球。

**碰撞忽略列表的含义并不是「两者互相看不见」，而是「当我移动时，不会撞到你」，它是有方向性的。**

```cpp
// 投射物侧（PostInitializeComponents 里）
SphereComponent->IgnoreActorWhenMoving(GetInstigator(), true);
// 含义：法球飞的时候不撞角色

// 角色侧（AttackTimerElapsed 里）
MoveIgnoreActorAdd(NewProjectile);
// 含义：角色走的时候不撞法球
```

**所以两个方向都要处理。** 角色的移动扫掠是另一套独立的检测，投射物那边的忽略列表管不到它。

`MoveIgnoreActorAdd` 是 `AActor` 的成员函数，它在内部会转交给 RootComponent（也就是角色的胶囊体）来处理：

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

**这也是为什么必须接住 `SpawnActor` 的返回值。** 因为要加进列表的是刚刚生成的这一个实例，所以必须拿到它的指针。`SpawnActor<T>` 的模板参数的价值就体现在这里，它的返回类型直接就是 `ARogueProjectileMagic*`，不需要再用 `Cast` 转换。

> **⚠️ 这里有一个需要留意的清理问题。** 法球调用 `Destroy()` 之后，角色的 `MoveIgnoreActors` 列表里会留下失效的条目。UE 内部有惰性清理机制（下次移动时会剔除无效的指针），所以不会崩溃，也不会出现明显的泄漏。但如果是一秒钟发射 20 发的机枪，这个列表在短时间内就会膨胀。
>
> 工业级的解法是从碰撞通道的层面来解决，也就是给投射物一个专属的 ObjectChannel，并在预设里对 Pawn 进行更精细的分级（比如区分 `Pawn` 和 `PlayerPawn`）。现阶段的写法已经够用了，只要知道它的局限在哪里即可。

## 5.6 物理冲量的完整链路

在测试场景里放几个 `SM_ChamferCube`，勾选相关的选项之后，就能把这些方块打飞。这条链路有一个特点，**任何一环没有打开，都会静默失败，不会有任何报错**。

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

这里有一个非常重要的推论：

> `ReceiveComponentDamage` 只有在 `FPointDamageEvent` 或者 `FRadialDamageEvent` 的情况下才会计算冲量。**普通的 `ApplyDamage`（基类 `FDamageEvent`）根本不携带 `HitInfo.Component`，所以冲量的流程完全不会启动。**
>
> 也就是说，**第五节把 `ApplyDamage` 改成 `ApplyPointDamage`，正是物理冲量能够生效的前提**。这两处改动看起来没有关系，其实是同一件事。

这四个开关分别在下面这些位置：

| 开关 | 所在层级 | 默认值 | 关掉的效果 |
|---|---|---|---|
| **模拟物理** `bSimulatePhysics` | 组件（Physics 分类） | false | 组件是运动学的，冲量被直接丢弃 |
| **可被伤害** `bCanBeDamaged` | Actor | true | 伤害被拦截，返回 0 |
| **在伤害上应用冲量** `bApplyImpulseOnDamage` | 组件（Physics 分类） | true | 能被打但纹丝不动 |
| **`DamageImpulse`** | DamageType CDO | **0** | 冲量为零，无反应 |

> 其中最容易被忽略的是最后一项，`DamageImpulse` 的默认值是 0。如果方块能被打中，伤害也正常，但就是不会飞起来，那么首先要检查的就是 `DmgType_Default` 里的这个数值，它需要手动填写（数值在几百到几千之间，具体取决于目标的质量）。

这四个开关各自都有实际的设计用途：

- 关闭 `bCanBeDamaged`，可以实现无敌帧，或者制作不可摧毁的场景物件；
- 关闭 `bApplyImpulseOnDamage`，可以制作站桩型的 Boss（能被打中，但推不动）；
- 给 `DamageImpulse` 设置不同的值，可以让霰弹把目标推得很远，而狙击枪只穿透不推动。

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

从这条主线可以看出，碰撞是 UE 里最容易出现静默 bug 的地方。如果遇到事件不触发、穿模或者莫名其妙的爆炸，首先应该检查碰撞设置。

### 主线二：C++ 定契约，蓝图填数据

这种模式在本章里至少出现了 7 次：

| C++ 声明 | 蓝图赋值 |
|---|---|
| `TObjectPtr<UInputAction> Input_PrimaryAttack` | `IA_PrimaryAttack` |
| `TSubclassOf<ARogueProjectileMagic> ProjectileClass` | `BP_MagicProjectile` |
| `TObjectPtr<UAnimMontage> AttackMontage` | `Primary_Attack_A_Medium_Montage` |
| `TObjectPtr<UNiagaraSystem> CastingEffect` | `NS_Casting` |
| `TObjectPtr<UNiagaraSystem> ExplosionEffect` | `NS_Gideon_Primary_HitWorld` |
| `TObjectPtr<USoundBase> CastingSound` / `ExplosionSound` | `MSS_Combat_...` |
| `TSubclassOf<UDamageType> DmgTypeClass` | `DmgType_Default` |

这样做的好处是，更换资产时不需要重新编译，策划可以自行调整，可以避免硬编码的路径失效，还可以减少强引用带来的加载负担。

它的代价是多了一种「忘记赋值」的失败方式，而且这种失败通常是静默的。`UCLASS(Abstract)` 和 `ensure` 就是用来应对这个代价的工具。

### 主线三：UFUNCTION 加不加？

| 绑定方式 | 机制 | 需要 `UFUNCTION()` | 本章实例 |
|---|---|---|---|
| `AddDynamic` / `AddUniqueDynamic` | 反射，按函数名字符串查找 | **✓ 必须** | `OnActorHit` |
| `BindAction`（模板重载） | 编译期成员函数指针 | ✗ 不要 | `PrimaryAttack` |
| `SetTimer`（模板重载） | 编译期成员函数指针 | ✗ 不要 | `AttackTimerElapsed` |
| `AddUObject` | 编译期成员函数指针 | ✗ 不要 | — |
| `BindUFunction` | 反射，按名字 | **✓ 必须** | — |

总结起来，名字里带有 Dynamic 或者 UFunction 的绑定方式会通过反射调用，所以必须加上 `UFUNCTION()` 标记；其余的模板绑定方式则不需要加。

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

目前的代码是这样的：

```cpp
UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, ExplosionEffect, GetActorLocation());
```

`GetActorLocation()` 返回的是球心的位置，和实际的接触面相差一个半径（16）。打在平整的墙面上时看不出差别，但打在斜面或者带圆角的物体上时，特效就会「陷」进物体里，或者浮在半空中。

修改的方法如下（`Hit` 就是回调函数的参数，可以直接使用）：

```cpp
UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, ExplosionEffect, Hit.ImpactPoint);
```

更进一步，还可以使用 `Hit.ImpactNormal`，让特效的朝向贴合物体的表面：

```cpp
FRotator ImpactRotation = Hit.ImpactNormal.Rotation();
UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, ExplosionEffect, Hit.ImpactPoint, ImpactRotation);
```

### ② 瞄准偏移

**问题在于**，生成点在**手上**（角色的右前方），而飞行方向是**摄像机的朝向**。这是两条平行但不重合的射线，所以法球永远打不到准心正对着的那个点。近处不太明显，但打远处的目标时，就会发现「明明瞄准了，却打偏了」。

**标准的解法如下**（后面的章节会讲到）：

1. 从摄像机位置沿视线方向做一次 `LineTraceSingleByChannel`
2. 取命中点（没命中就取视线上一个很远的点）
3. 用 `UKismetMathLibrary::FindLookAtRotation(SpawnLocation, TargetPoint)` 反算出"从枪口指向该点"的旋转
4. 用这个旋转作为 `SpawnRotation`

### ③ 用 Anim Notify 替代硬编码计时器

`0.2f` 是对照动画测量出来的魔法数字，一旦更换蒙太奇，就需要重新调整，而且它不会随着 PlayRate 的变化而变化。后面会改用动画通知，把时间点直接放进资产里。

### ④ 自伤问题回到碰撞通道层面解决

现在是依靠两条 `IgnoreActorWhenMoving` 从两个方向分别堵住漏洞（见 3.5 和 5.5），虽然能用，但只是在打补丁。每发射一个法球，都要往列表里加一条记录，销毁之后又会留下失效的条目，射速很高时，列表在短时间内就会膨胀。

更彻底的做法是给投射物一个专属的 Object Channel，并在碰撞预设里对「发射者」和「其他 Pawn」进行分级处理。这需要更完整的碰撞通道规划，所以等到后面出现了敌人和队友的概念之后，再统一设计会更合适。

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
