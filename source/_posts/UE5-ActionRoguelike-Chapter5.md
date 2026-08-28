---
title: UE5 C++ 第五章复盘：属性组件、多播委托，以及从轮询到事件驱动
date: 2026-08-21 10:00:00
categories:
  - [课外, 游戏开发, UE5-Looman]
tags:
  - C++
  - ActionRoguelike
  - 属性组件
  - 委托与事件分发
  - UMG
description: 第五章第一次做"系统"而不是"单个 Actor"。本篇完整梳理四节课：为什么血量要做成 ActorComponent、TakeDamage 只是引擎的伤害入口而非伤害逻辑、UMG 血条那一大坨蓝图连线到底每根线是什么、执行流与数据流的区别、DECLARE_DYNAMIC_MULTICAST_DELEGATE 每个词的含义、Bind Event 的三根输入线、事件驱动必须配的初始同步、AddDynamic 为什么会在运行期而不是编译期报错、以及绑定为什么非得放在 PostInitializeComponents。重点解释蓝图每一根连线的语义，以及每个坑的真实成因。
cover: /img/covers/UE5-ActionRoguelike-Chapter5.svg
series: UE5 ActionRoguelike
privacy: protected
sitemap: false
private_section: 课外
---

# 前言

这是我跟随 Tom Looman 学习 UE5 C++ 时，对第五章 **Attribute** 的完整复盘。

本章使用的开发环境：

- Unreal Engine `5.6.1`
- Rider
- Visual Studio 2022 Build Tools / MSVC 编译工具链
- 项目名称：`ActionRoguelike`

**这一章第一次做"系统"，而不是"单个 Actor"。** 前四章每一节的产出都是一个具体东西——宝箱、拉杆、投射物、炮台。这一章做的是**血量**，它不属于任何一个 Actor，而是所有 Actor 共用的一套规则。

本章还有一条特别清晰的主线，我认为是全章最有价值的东西：

> **同一个功能（血条 UI），先用轮询做一遍，再用事件驱动重做一遍。**

第二节的 `Event Tick` 版本能跑，但它在第三节被整个删掉了。这不是浪费时间——**只有先体会过轮询的坏处，才知道委托到底在解决什么问题**。所以这篇复盘会把两个版本都完整记录下来，包括那个"注定要被删掉"的实现。

我个人在这一章最大的困难不是 C++，而是**蓝图里那一大坨连线**。第二节和第三节的控件图表节点密密麻麻，我是跟着老师一根根连出来的，连完能跑，但完全不知道为什么。所以本篇专门花了大量篇幅拆解蓝图：每根线代表什么、每个节点从哪来、以及**下次怎么自己连出来**。

四节课的分工：

| 节 | 主题 | 核心产出 |
| --- | --- | --- |
| 第一节 | 属性组件骨架 | `UActorComponent`、`ApplyHealthChange`、`TakeDamage` |
| 第二节 | 血条 UI（轮询版） | `AHUD`、UMG 控件、`Get Class Defaults`、CDO |
| 第三节 | 多播委托（事件版） | `DECLARE_DYNAMIC_MULTICAST_DELEGATE`、`BlueprintAssignable`、`Bind Event` |
| 第四节 | C++ 侧订阅与死亡 | `AddDynamic`、`PostInitializeComponents`、`FMath::Clamp` |

和前四章一样，这篇不只记录"点了哪些按钮"，还会重点解释：

- 每一根蓝图连线的语义，以及节点是从哪个 C++ 宏里冒出来的；
- 为什么这段逻辑放在这一层，而不是上一层或下一层；
- 每个坑的真实成因，以及下次该怎么排查。

---

## 目录

- [第零节：为什么血量要做成组件](#第零节：为什么血量要做成组件)
- [第一节：属性组件的骨架](#第一节：属性组件的骨架)
- [第二节：血条 UI 与蓝图连线详解](#第二节：血条-UI-与蓝图连线详解)
- [第三节：多播委托，干掉 Tick](#第三节：多播委托，干掉-Tick)
- [第四节：C++ 侧订阅与死亡处理](#第四节：C-侧订阅与死亡处理)
- [知识链路总览](#知识链路总览)
- [易错点速查表](#易错点速查表)
- [遗留待办](#遗留待办)
- [第五章完成检查清单](#第五章完成检查清单)
- [术语表](#术语表)
- [参考资料](#参考资料)

---

# 第零节：为什么血量要做成组件

这一节课程里没有，是我自己补的。因为看到"新建一个 ActorComponent"的时候，我第一反应是：血量不就是个 `float` 吗，直接写在角色类里不行？

先把这个问题答清楚，后面四节才不会变成"跟着老师敲代码"。

## 0.1 三种放血量的方案

**方案一：写在 `ARoguePlayerCharacter` 里。**

```cpp
class ARoguePlayerCharacter : public ACharacter
{
    float Health = 100.f;   // ❌
};
```

玩家能用了。然后敌人也要血量——敌人是 `APawn` 派生的，不是 `ACharacter`，拿不到。爆炸桶要血量——它是 `AActor`，更拿不到。三个类各抄一份，三份逻辑各自演化，迟早不一致。

**方案二：往上提，做一个公共基类。**

```cpp
class ARogueBaseActor : public AActor { float Health; };   // ❌
```

问题更大：`ACharacter` 已经是 `APawn → AActor` 的子类了，你插不进去这条继承链。UE 的 Gameplay Framework 基类是固定的，你只能在末端派生。而且就算插得进去，"会飞的道具""能被摧毁的门"这些完全不需要血量的东西也被迫背上了这个字段。

**方案三：做成组件，谁需要谁挂。**

![组合而非继承：同一个属性组件挂在三条不同继承链上](/img/posts/ue5-ch5/ue5-ch5-composition.svg)

血量是一个**横切关注点**——它横穿整个继承树，不属于其中任何一条分支。这类东西的标准解法是**组合优于继承**：把能力做成独立零件，需要的对象自己挂上去。

这也是 UE 里 `ActorComponent` 存在的根本理由。以后你会看到大量这种模式：`UCharacterMovementComponent`、`UHealthComponent`、`UInventoryComponent`——它们都不是"某个类的一部分"，而是"一种可插拔的能力"。

## 0.2 组件不只是数据容器，还是权限边界

第二个容易忽略的点：组件不只是"把 float 挪了个地方"，它还**顺手把权限管起来了**。

血量这个数据，如果是角色的 public 成员，那任何代码都能 `Character->Health -= 10;`。而这里所有对血量的修改都必须走：

```cpp
void ApplyHealthChange(float InValueChange);
```

**唯一入口。** 这一条约束在第四节会兑现出巨大的价值——钳制、变化守卫、死亡广播，全部只需要在这一个函数里写一遍，全世界自动生效。

如果血量是散着改的，你就得在每一个 `Health -= X` 后面都补一遍 `Clamp` 和判定，漏一处就是一个 bug。

## 0.3 本章的权限地图

顺便把整章的权限设计先列出来，后面每一节都在往这张表里填格子：

| 东西 | 说明符 | 含义 |
|---|---|---|
| `AttributeSet` | `BlueprintReadOnly` | 蓝图能读，不能写 |
| `float health` | `BlueprintReadOnly` | 同上 |
| `ActionSystemComponent` | `VisibleDefaultsOnly` + `BlueprintReadOnly` | 编辑器只能看，蓝图只能读 |
| `OnHealthChanged` 委托 | `BlueprintAssignable`（不加 `BlueprintCallable`） | 蓝图能**订阅**，不能**广播** |
| `DeathMontage` | `EditDefaultsOnly` | 只能在蓝图类默认值里配，实例不能改 |

一条主线：**只开放刚好够用的权限**。这和第四章 `bChestOpened` 用 `BlueprintReadOnly` 是同一个思路——状态的所有权必须归属明确。

---

# 第一节：属性组件的骨架

## 1.1 文件结构与类

在 `Source/ActionRoguelike/` 下新建 `ActionSystem/` 目录，创建继承自 `UActorComponent` 的类：

```text
Source/ActionRoguelike/
├─ ActionSystem/
│  ├─ RogueActionSystemComponent.h
│  └─ RogueActionSystemComponent.cpp
├─ Core/
├─ Player/
├─ Projectiles/
└─ World/
```

> Rider 的"Unreal 类"创建向导里，"基文件夹"选**根**、"路径"填 `Source\ActionRoguelike\ActionSystem`，它会自动把 `.h` 和 `.cpp` 放到同一个目录下。这个项目没有用 `Public/Private` 分离，所以选"根"是对的。

## 1.2 `FRogueAttributeSet`：先用最朴素的写法

```cpp
struct FRogueAttributeSet
{
    FRogueAttributeSet()
        : health(100.f) {}

    float health;
};
```

第一节这里**故意还没加任何反射宏**。为什么要单独包一个结构体，而不是直接在组件里放一个 `float Health`？

因为血量只是第一个属性。后面还会有法力、耐力、护甲、移速加成……把它们打包进一个 `AttributeSet`，好处是：

- 整组属性可以一次性拷贝、序列化、网络同步
- 增加新属性时，组件的接口不用动
- 语义上"这是一组属性"，而不是"组件里散着几个变量"

> 这个设计其实是 Epic 官方 **GAS（Gameplay Ability System）** 的简化版。GAS 里的 `UAttributeSet` 就是同样的思路，只是复杂得多。课程用手写版本先让你理解"为什么需要这个东西"。

## 1.3 `ApplyHealthChange`：唯一入口

```cpp
void URogueActionSystemComponent::ApplyHealthChange(float InValueChange)
{
    AttributeSet.health += InValueChange;
    UE_LOG(LogTemp, Log, TEXT("New Health: %f"), AttributeSet.health);
}
```

注意参数名是 `InValueChange` 而不是 `Damage`——**这个函数不区分伤害和治疗**。传负数是掉血，传正数是回血。伤害/治疗的语义由**调用方**决定，组件只负责改数。

这是个很好的接口设计习惯：让底层保持中立，把语义留给上层。否则你会写出 `ApplyDamage` 和 `ApplyHeal` 两个几乎一样的函数，然后 Clamp 逻辑要维护两遍。

## 1.4 `CreateDefaultSubobject` 与挂载时机

```cpp
// RoguePlayerCharacter.h
UPROPERTY(VisibleDefaultsOnly, Category = "Components")
TObjectPtr<URogueActionSystemComponent> ActionSystemComponent;
```

```cpp
// RoguePlayerCharacter.cpp 构造函数
ActionSystemComponent = CreateDefaultSubobject<URogueActionSystemComponent>(
    TEXT("ActionSystemComp"));
```

三点值得记：

**① `CreateDefaultSubobject` 只能在构造函数里调用。** 它创建的是 **CDO（类默认对象）的子对象**，之后每个实例都是从 CDO 拷贝出来的。在别的地方调会直接崩。

**② 正因如此，这个指针不需要判空。** 构造期就保证存在了，只要不手动 `DestroyComponent`，它的生命周期和 Actor 一样长。

**③ 它不是 `SceneComponent`，所以没有 `SetupAttachment`。** `UActorComponent` 没有变换（Transform），不参与场景层级——它只是挂在 Actor 上的一段逻辑和数据。这和 `SpringArmComponent`、`CameraComponent` 那种有位置的组件是两码事。

> **说明符选择**：这里 `VisibleDefaultsOnly` 其实偏保守，一般组件用 `VisibleAnywhere` 更合适。区别是前者在关卡里选中某个实例时，细节面板里**看不到**这个组件；后者两处都能看到（只读）。调试时能在实例上看到组件是有用的。

## 1.5 `TakeDamage` 是引擎的伤害入口，不是伤害逻辑

```cpp
// .h
virtual float TakeDamage(float DamageAmount, struct FDamageEvent const& DamageEvent,
    class AController* EventInstigator, AActor* DamageCauser) override;
```

```cpp
// .cpp
float ARoguePlayerCharacter::TakeDamage(float DamageAmount, struct FDamageEvent const& DamageEvent,
    class AController* EventInstigator, AActor* DamageCauser)
{
    float ActualDamage = Super::TakeDamage(DamageAmount, DamageEvent, EventInstigator, DamageCauser);
    ActionSystemComponent->ApplyHealthChange(-DamageAmount);
    return ActualDamage;
}
```

搞清楚这条链很重要：

```text
爆炸桶 → UGameplayStatics::ApplyDamage(...)
          → Actor->TakeDamage(...)              ← 引擎的标准伤害入口
            → Super::TakeDamage(...)            ← 父类可能修改伤害值
            → ActionSystemComponent->ApplyHealthChange(...)   ← 你的属性系统
```

`TakeDamage` 是 **`AActor` 的虚函数**，是整个引擎公认的"伤害进来的地方"。UE 自带的伤害体（`RadialDamage`、`PointDamage`）、AI 感知、投射物系统，全都通过它来打人。

**所以你重写的这一层本质上是个"适配器"**：把引擎的通用伤害事件，翻译成你自己的属性变更。它里面就应该只有转发，不该塞死亡判定、特效、音效——那些是属性变更之后的**后果**，属于监听者的职责（第四节会看到）。

## 1.6 踩坑：`-DamageAmount` 应该是 `-ActualDamage`

上面那段代码接了 `Super::TakeDamage` 的返回值，却没用它。

`AActor::TakeDamage` 的基类实现目前是原样返回 `DamageAmount`，所以**现在两者行为完全一致，测不出任何区别**。

但你既然写了 `float ActualDamage = Super::TakeDamage(...)`，就等于承认了"父类有权修改伤害值"这个契约。一旦以后：

- 加了 `ARogueBaseCharacter` 中间层，在那里做护甲减伤
- 加了无敌帧，父类判断后返回 0
- 加了伤害类型系统，某些伤害对某些角色无效

父类的这些修改会被 `-DamageAmount` **静默绕过**。护甲加了没效果，而代码看起来完全正确——这类 bug 排查起来极其痛苦。

**正确写法：**

```cpp
ActionSystemComponent->ApplyHealthChange(-ActualDamage);
```

> 这是"改了之后行为完全不变"的典型修复。现在改，成本为零；等到加了减伤系统才发现，就得回过头怀疑人生。

## 1.7 第一节结束时的三个已知缺陷

跑起来之后，日志里能看到血量从 100 一路掉到 0：

```text
LogTemp: New Health: 90.000000
LogTemp: New Health: 80.000000
...
LogTemp: New Health: 0.000000
```

看起来很完美。但**再打一发就是 -10**。这三个问题会在后面几节陆续暴露和修复，先记在这里：

| 缺陷 | 后果 | 修复位置 |
|---|---|---|
| 没有 `FMath::Clamp` | 血量掉负数、治疗会超上限 | 第四节 |
| `FRogueAttributeSet` 不是 `USTRUCT` | 蓝图完全看不见，初始血量硬编码 100 | 第二节 |
| `float health` 命名不规范 | UE 约定成员用 PascalCase | 未修 |

> **验证习惯**：日志里显示 `0.000000` 时，我的第一反应是"正好，clamp 好像生效了"。实际上那只是**碰巧打了 10 次 10 点伤害**。**编译通过 ≠ 正确，日志好看 ≠ 正确**——多打一发才是真正的验证。

---

# 第二节：血条 UI 与蓝图连线详解

这一节是我全章最吃力的地方，所以写得最细。

**先说结论：这一节做出来的东西，第三节会被整个删掉。** 但它必须先做一遍——不体验一次轮询，就理解不了委托的价值。

## 2.1 四层结构，每层的存在理由

![血条 UI 的四层结构与各层职责](/img/posts/ue5-ch5/ue5-ch5-ui-stack.svg)

**为什么 UI 挂在 `AHUD` 上，而不是挂在角色身上？**

角色会死、会重生，销毁时它创建的一切都跟着没了。`AHUD` 归 `PlayerController` 所有，玩家在整局游戏里只有一个 Controller，UI 的生命周期就稳了。

**为什么不是 GameMode？**

GameMode 在多人游戏里**只存在于服务器**。UI 是纯客户端的东西，放那儿客户端根本看不到。

**为什么 `MainHUD_WBP` 和 `PlayerHealth_WBP` 要拆成两个控件？**

职责分离：

- `MainHUD_WBP` 是**屏幕布局**——以后准心、弹药、小地图都是它的子控件
- `PlayerHealth_WBP` 是**可复用零件**——以后做敌人头顶血条，直接把它塞进 `WidgetComponent` 就行

如果把进度条直接画在 `MainHUD_WBP` 里，这份复用就没了。

## 2.2 `BP_HUD` 图表：创建和显示是两步

```text
Event BeginPlay ─▶ Create Main HUD WBP Widget ─▶ Add to Viewport
                        Class: MainHUD_WBP
                        Owning Player: (空)
                        Return Value ────────────▶ Target
```

**`Event BeginPlay`**：HUD 这个 Actor 生成并初始化完成时触发一次。UI 只需要建一次，所以用 BeginPlay 而不是 Tick。

**`Create Widget`** 做的事只有一件：**在内存里 new 一个控件对象**。此时屏幕上什么都没有。

- `Class` 引脚是**紫色**的——紫色在蓝图里表示**类引用**（`UClass*`），不是对象实例。你选的是"要造哪种控件"，不是"某个控件"。
- `Return Value` 是**蓝色**——蓝色表示**对象引用**，这才是造出来的那个实例。

**`Add to Viewport`**：把控件对象加进玩家视口的渲染列表，这一步才让它显示出来。

> **"创建"和"显示"是两步**，这是 UMG 最经典的坑：忘了 `Add to Viewport`，编译通过、运行不报错、屏幕上什么都没有。

## 2.3 反射链条：蓝图里那些节点是从哪冒出来的

这是本节最关键的一段，也是我一开始最迷惑的地方——**"Break Rogue Attribute Set"这个节点我根本没创建过，它哪来的？**

答案是：**你在 C++ 里加的每一个说明符，都精确对应蓝图里的一个节点或引脚。**

![C++ 反射说明符与蓝图节点的对应关系](/img/posts/ue5-ch5/ue5-ch5-reflection-chain.svg)

本节 C++ 侧的改动只有这些：

```cpp
USTRUCT(BlueprintType)
struct FRogueAttributeSet
{
    GENERATED_BODY()

    FRogueAttributeSet()
        : health(100.f) {}

    UPROPERTY(BlueprintReadOnly)
    float health;
};
```

```cpp
protected:
    UPROPERTY(BlueprintReadOnly, Category = "Attributes")
    FRogueAttributeSet AttributeSet;
```

```cpp
// RoguePlayerCharacter.h
UPROPERTY(VisibleDefaultsOnly, BlueprintReadOnly, Category = "Components")
TObjectPtr<URogueActionSystemComponent> ActionSystemComponent;
```

对应关系一条条列清楚：

| C++ 写法 | 蓝图里变出什么 | 不写会怎样 |
|---|---|---|
| `BlueprintReadOnly` on `ActionSystemComponent` | 角色引脚拖出来能搜到 `Action System Component` 取值节点 | 链条第一环断，节点不存在 |
| `USTRUCT(BlueprintType)` on `FRogueAttributeSet` | 结构体成为蓝图类型，**UHT 自动生成 `Break` / `Make` 节点** | 蓝图完全不认识这个类型 |
| `GENERATED_BODY()` 在结构体内 | 反射数据的生成入口 | 编译报错 |
| `BlueprintReadOnly` on `float health` | `Break` 节点上那个 `Health` 输出引脚 | Break 节点在，但**一个引脚都没有** |
| `BlueprintReadOnly` on `AttributeSet` | 组件引脚拖出来能搜到 `Attribute Set` 取值节点 | 链条中间断 |

**所以 `Break Rogue Attribute Set` 是白送的**——任何标了 `BlueprintType` 的结构体，UHT 都会自动生成一对 Break/Make 节点。你不需要写任何东西。

还有一点值得记：**这里全是 `BlueprintReadOnly`，没有一个 `BlueprintReadWrite`**。这是刻意的——UI 只准读，血量的修改只能走 `ApplyHealthChange()`。第零节说的封装，在这一节落地了。

> `Category = "..."` 只影响细节面板和节点搜索列表里的分组，不影响功能。

## 2.4 执行流 vs 数据流：读懂蓝图的钥匙

控件图表里节点密密麻麻，我第一次看完全懵。后来发现关键是：**只有三个节点在执行链上**。

![蓝图的执行流与数据流](/img/posts/ue5-ch5/ue5-ch5-exec-vs-data.svg)

蓝图节点分两类：

**非纯节点（Impure）——有白色执行引脚。** 它会**改变状态**，所以必须排进执行顺序里。`Set Percent` 就是——它要写进度条。

**纯节点（Pure）——没有执行引脚。** 它只**取值/算值**，不改任何东西。所有 Getter、`Break`、`÷`、`Get Class` 都是纯节点。

纯节点**不排队执行**，而是**被下游拉取时才求值**。当执行流走到 `Set Percent`，它发现 `In Percent` 引脚缺个数，就顺着连线往回一路拉：拉除法 → 除法往回拉 Break 和 Class Defaults → 再往回拉组件……整条数据链在那一瞬间被**倒着**求出来。

> **副作用：纯节点没有缓存。** 同一个纯节点的输出接到 3 个地方，就会被求值 3 次。以后遇到"某个 Getter 里有随机数，结果每处都不一样"，根因就在这。第四章提到的 `BlueprintPure` 说的是同一件事。

## 2.5 逐节点拆解

**`Get Owning Player Pawn`** — 拿到"拥有这个控件的玩家"当前控制的 Pawn。注意它依赖的是控件的 Owning Player，而不是"第 0 号玩家"。比 `Get Player Pawn(0)` 规范，分屏时才不会串台。

**`Cast To RoguePlayerCharacter`** — `APawn` 类型上根本没有 `ActionSystemComponent`，只有你的角色类才有。所以必须先向下转型，编译器才允许访问那个属性。

**这就是蓝图里绝大多数 Cast 存在的理由：你手上的引用类型太"泛"，够不到你要的成员。**

`Cast Failed` 引脚没接东西 = 转型失败时这一帧什么都不做。这其实是**对的**——玩家死亡到重生之间 Pawn 为空，静默跳过比报错好。

**`Get Class` → `Get Class Defaults`** — 这一对是"最大血量"的来源，也是本节最巧妙、也最有争议的一步。

每个 `UClass` 在引擎里都有一个 **CDO（Class Default Object，类默认对象）**，它是这个类的"出厂模板"，所有实例都是从它拷贝出来的。`Get Class` 拿到组件的类，`Get Class Defaults` 就去读那个模板里的属性值——也就是 `FRogueAttributeSet` 构造函数里写死的 `100.f`。

于是"最大血量"不用新增字段，白嫖 CDO 就有了。

> 图里那个绿色的 `Attribute Set Health` 引脚，是把结构体引脚**右键 → 分割结构体引脚**拆出来的。这个操作在处理小结构体时很常用，比再接一个 `Break` 节点干净。

**`÷`** — 当前 ÷ 最大 = 0~1 的比例。`Set Percent` 要的就是 0~1，不是 0~100。

**`Progress Bar 71`** — 之所以能在图表里拿到它，是因为在设计器里勾了**"是变量"**。

> UMG 里设计器摆的控件**默认不生成成员变量**，图表里搜不到。勾上之后编译器才为控件类生成一个同名成员。另外这个自动生成的名字 `ProgressBar_71` 很难看，它是要写进图表的变量名，应该改成 `HealthBar`。

## 2.6 方法论：以后怎么自己连出来

我跟着连完之后完全不知道下次该怎么办，所以专门总结了套路。

### ① 从终点倒推，不要从起点正推

先问"我最终要调用什么？"→ `Set Percent`。
再问"它要什么参数？"→ 一个 0~1 的 float。
再问"这个数从哪来？"→ 血量 ÷ 最大血量。
再问"血量在哪？"→ 组件里。
再问"组件在谁身上？"→ 角色。
再问"控件怎么拿到角色？"→ `Get Owning Player Pawn` + Cast。

倒推到"我手上已经有的东西"为止，然后正着连回去。

### ② 从引脚拖，不要在空白处右键

这是效率差十倍的地方。在空白处右键，候选节点有几千个；**从一个 `ARoguePlayerCharacter*` 引脚拖出来再松手，UE 会只列出这个类型能用的节点**，几十个而已，搜 "action" 就出来了。

### ③ 认引脚颜色

| 颜色 | 类型 |
|---|---|
| 白色 | 执行（Exec） |
| 蓝色 | 对象引用（`UObject*`） |
| **紫色** | **类**引用（`UClass*`） |
| 深蓝 | 结构体 |
| 绿色 | float |
| 红色 | bool，**或委托**（见第三节） |

`Get Class` 输出紫色接进 `Get Class Defaults` 的 `Class` 输入——一眼就能确认是"类"不是"实例"。

### ④ 连不上时，先看类型对不对

蓝图不让你连，99% 是类型不匹配，答案通常是"中间缺一个 Cast"或"缺一个 Break"。

## 2.7 第二节结束时的问题

**① `Event Tick` 轮询——本节最大的设计缺陷**

每一帧都做：Cast + 4 次取值 + Break + 除法 + Set Percent。血量一小时不变也照跑不误。

更要命的是它**堵死了表现效果**：血条受击闪红、缓动掉血，这些都需要"血量**变化的那一刻**"这个时机，Tick 给不了。

这正是第三节要解决的问题。

**② 最大血量绑死在 CDO 上**

`AttributeSet` 只有 `BlueprintReadOnly`，没有 `EditAnywhere` / `EditDefaultsOnly`——意味着在细节面板和蓝图子类里**都改不了**这个默认值。现在全世界所有角色都是 100 血。

另外这个方案把"初始血量"和"最大血量"当成同一个数。以后要做"半血复活"或"临时上限提升"，这条链就得推翻。

**③ `Create Widget` 的 `Owning Player` 是空的**

留空时 UMG 会回退到"第一个本地玩家"，单机能跑。但控件里用了 `Get Owning Player Pawn`，这个值就是它的依据。规范做法是在 `BP_HUD` 里接 `Get Player Owner`（`AHUD::PlayerOwner`）传进去。分屏时两个 HUD 都指向 0 号玩家的 bug 就是这么来的。

**④ 返回值没存成变量**

`Create Widget` 的 `Return Value` 直接进了 `Add to Viewport` 就丢了。以后想 `Remove from Parent`、想暂停时隐藏 HUD，找不到这个引用。

**⑤ 负血量被 UI 掩盖了**

第一节没做 Clamp，血量会掉到负数。`Set Percent` 收到负数时进度条**显示上会截断到 0**，看起来一切正常，但底层数据是错的。

> **一个教训：UI 正常 ≠ 数据正常。** 界面层往往自带钳制和容错，会把底层的错误盖住。验证一定要看数据本身。

---

# 第三节：多播委托，干掉 Tick

## 3.1 委托解决的是"依赖方向"问题

先看没有委托时的两条死路：

**死路 A：组件持有 UI 指针。**

```cpp
// 组件里
HealthBarWidget->SetPercent(...);   // ❌
```

属性组件从此依赖 UMG。以后敌人也挂这个组件，但敌人没有血条 UI——组件被迫写一堆判空。更糟的是它还得知道"有几个东西关心我"：血条、受击特效、AI 逃跑判断、成就系统……每加一个就要改组件。

**死路 B：UI 每帧轮询。** 就是第二节那个版本。组件干净了，但代价是白跑帧数，而且拿不到"变化那一刻"。

委托走的是第三条路——**观察者模式**：组件只负责喊一嗓子"血量变了，从 X 到 Y"，至于谁在听、听了干什么，它一概不知也不关心。

![轮询与事件驱动的对比](/img/posts/ue5-ch5/ue5-ch5-poll-vs-event.svg)

**依赖方向被反转了**：不是组件依赖 UI，而是 UI 主动去订阅组件。组件的头文件里从头到尾没出现过任何 UMG 的东西。

> 第四章的**事件分发器**其实就是这个东西的蓝图版。当时是在蓝图面板里点一下加一个 `OnHandlePulled`，这一节是在 C++ 里手写同一个东西。**事件分发器 = 蓝图 UI 包装过的 `DECLARE_DYNAMIC_MULTICAST_DELEGATE`。**

## 3.2 拆解这个宏名

```cpp
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnHealthChanged, float, NewHealth, float, OldHealth);
```

名字看着吓人，其实是四段拼起来的：

| 片段 | 含义 |
|---|---|
| `DECLARE` | 这是个宏，展开后**定义出一个类型**（一个 struct），不是定义变量 |
| `DYNAMIC` | 走反射系统，按**函数名（FName）**绑定，因此可被序列化、可被蓝图看见 |
| `MULTICAST` | 可以挂 0 到 N 个监听者，`Broadcast` 一次全部调用 |
| `_TwoParams` | 参数个数，有 `_OneParam` 到 `_NineParams` |

**`DYNAMIC` 是关键的那个词。** 普通 C++ 委托存的是原始函数指针，快，但蓝图和序列化系统都看不懂它。Dynamic 版本存的是"对象引用 + 函数名字符串"，调用时要查一次名字表，**性能明显更差**——但换来两件事：**蓝图能绑定，存档能保存**。

推论：

- 绑定的 C++ 函数必须标 `UFUNCTION()`，否则反射系统查不到那个名字（第四节会踩到）
- Dynamic 版本**不能有返回值**（没有 `_RetVal` 变体）。挂了 3 个监听者，你要哪个的返回值？
- 高频事件（每帧、每次碰撞）别用 Dynamic，用普通 `DECLARE_MULTICAST_DELEGATE`

还有个隐藏福利：**Dynamic 委托内部存的是弱引用**。监听者对象被 GC 掉之后，那条绑定会自动失效并被跳过，不会像裸指针那样崩溃。所以一般**不需要手动 `RemoveDynamic`**。

## 3.3 参数写法：为什么要写参数名

```cpp
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnHealthChanged, float, NewHealth, float, OldHealth);
//                                           ─┬─────────────  ─┬──  ─┬────────
//                                        委托类型名          类型   参数名
```

**类型和参数名要成对写**，这是 Dynamic 委托独有的。普通委托只写类型：`DECLARE_MULTICAST_DELEGATE_TwoParams(FFoo, float, float)`。

为什么 Dynamic 版要参数名？因为**这些名字会变成蓝图节点上的引脚名**。

自定义事件节点上那两个绿色输出引脚，一个叫 `New Health`、一个叫 `Old Health`——它们不是在蓝图里创建的，是从这行宏里生成出来的。UE 还顺手把驼峰拆成了带空格的显示名（和第四章 `bChestOpened` → `Chest Opened` 是同一套显示名规则）。

**声明位置必须在类外、文件作用域。** 因为宏展开后是一个完整的 `struct` 定义，塞进类体里语法就崩了。惯例是放在头文件顶部、`UCLASS` 之前。

## 3.4 `Broadcast` 与 OldHealth 的顺序

```cpp
void URogueActionSystemComponent::ApplyHealthChange(float InValueChange)
{
    float OldHealth = AttributeSet.health;                 // ① 先存旧值
    AttributeSet.health += InValueChange;                  // ② 再改
    OnHealthChanged.Broadcast(AttributeSet.health, OldHealth);  // ③ 最后广播
}
```

这三行的顺序不能动。①必须在②之前，否则 `OldHealth` 抓到的是改完的值，两个参数就一样了。

`Broadcast` 的行为：**同步、立即、按绑定顺序依次调用所有监听者**。它不是"发个消息进队列"，而是当场把所有回调跑完才返回。所以：

- 监听者里如果做了重活（生成一堆特效），会直接卡住 `ApplyHealthChange` 的调用栈
- **别依赖调用顺序**。两个监听者谁先跑取决于谁先绑定，这不该成为你逻辑的一部分（第四章 3.5 讨论多连 `Explode` 时是同一个结论）
- **没有任何监听者时，`Broadcast` 是空操作，不报错、不警告**

最后这条是本节头号坑：忘记 `Broadcast`、或者绑定没生效，表现完全一样——UI 纹丝不动，日志干干净净，编译毫无怨言。

## 3.5 `BlueprintAssignable` 与 `Bind Event` 的三根线

```cpp
UPROPERTY(BlueprintAssignable)
FOnHealthChanged OnHealthChanged;
```

`BlueprintAssignable` 这一个说明符做了两件事：让蓝图能搜到 `Bind Event to OnHealthChanged` 节点，并且让 `Assign OnHealthChanged` 出现在右键菜单里。

> 还有个 `BlueprintCallable` 用在委托上，表示允许蓝图调用 `Broadcast`。这里**故意不加**——只有组件自己有权广播，外人只能听。这跟 `BlueprintReadOnly` 是同一个封装思路。

![Bind Event 节点的三根输入线](/img/posts/ue5-ch5/ue5-ch5-bind-event.svg)

| 引脚 | 颜色 | 含义 |
|---|---|---|
| 执行 | 白 | 什么时候执行"订阅"这个动作 |
| `Target` | 蓝 | **哪一个组件实例**的委托 |
| `Event` | **红** | 红色 = 委托引脚，接一个签名匹配的事件 |

红色引脚是蓝图里表示"函数引用"的颜色，相当于 C++ 里的 `&AMyClass::MyFunc`。从它拖出来松手，UE 会直接生成一个**签名已经对好**的自定义事件——`New Health`、`Old Health` 两个引脚自动就在那儿，因为签名是从宏里读出来的。

> **绑定 ≠ 调用。** `Bind Event` 只是把"我在听"登记进去，它自己不执行任何血条逻辑。执行发生在将来某次 `Broadcast` 的时候。图连完了运行没反应，往往就是把 Bind 当成了 Call。

**`Event Construct`** 是 UMG 的"控件构建完成"事件，地位相当于 Actor 的 `BeginPlay`。订阅只需要做一次，所以放这儿。

另外蓝图的 `Bind Event` 底层走的是 **AddUnique** 语义——同一个对象的同一个事件重复绑定不会叠加。

## 3.6 红蓝两种事件节点，别看混了

图里有两个都叫 `OnHealthChanged_事件` 的节点，长得完全不一样，我一开始以为画重复了：

**红色那个** — 标着 `Custom Event`，`New Health` / `Old Health` 是**输出**引脚。这是**事件的定义**，是逻辑的入口。

**蓝色那个** — 标着 `Target is Player Health WBP`，有 `Target(self)`、`New Health`、`Old Health` 三个**输入**引脚。这是**对该事件的一次调用**。

> **判别方法：看引脚朝哪边。输出在右 = 定义；输入在左 = 调用。**

## 3.7 初始同步：事件驱动的先天空洞

这是本节设计上最值得琢磨的一处，也是第二个事件节点存在的理由。

事件驱动有个天生的空洞：

> **血条只在血量"变化"时更新。游戏刚开始，血量还没变过，于是那一刻血条显示的是设计器里留下的默认值 0.5——半血。**

轮询版没这问题（第一帧就会读一次真实值），换成事件驱动后它冒出来了。

所以解法是：**绑定完成后，立刻手动调用一次那个自定义事件**，参数用当前真实血量，把 UI 拉到正确状态。

```text
Event Construct
  → Cast To RoguePlayerCharacter
  → Bind Event to OnHealthChanged     ← 登记
  → 调用 OnHealthChanged 事件          ← 初始同步
       New Health = Attribute Set Health（当前真实值）
       Old Health = 0.0（占位）
```

这个模式叫**初始同步（initial sync）**，任何事件驱动的 UI 都逃不掉。以后做能量条、弹药数、Buff 图标全都要写这一步。

> `Old Health = 0.0` 是**编的**。现在没人用 `OldHealth` 所以无所谓，但一旦加了"`NewHealth < OldHealth` 就闪红"的逻辑，这次初始调用会被解读成"从 0 血被治疗到满血"，触发一个错误的绿光。更干净的做法是初始调用时把 Old 也填成当前血量，表示"没有变化，只是同步"。

## 3.8 第三节结束时的问题

**① 委托签名少了"是谁"**

现在的 `(NewHealth, OldHealth)` 里没有任何身份信息。单个玩家血条够用，但一旦同一个监听者要处理多个组件（比如一个管理器同时听所有敌人的血量），它收到通知却不知道是谁掉血了。

行业里这类委托通常还会带上发送者和伤害来源：

```cpp
DECLARE_DYNAMIC_MULTICAST_DELEGATE_FourParams(FOnHealthChanged,
    AActor*, InstigatorActor,                   // 谁造成的
    URogueActionSystemComponent*, OwningComp,   // 谁的血量变了
    float, NewHealth,
    float, Delta);                              // 变化量，而非旧值
```

`Delta` 比 `OldHealth` 更实用——飘伤害数字、判断是治疗还是伤害，直接用 Delta，不用每个监听者自己减一遍。

> 这里的 `InstigatorActor` 和第四章 `SpawnActor` 的 `Instigator` 引脚是同一个概念：**伤害归属**。当时不连会导致击杀播报空白，这里不带会导致监听者无法归因。

**② 血量仍未 Clamp，现在多了一层影响**

不 Clamp 的话 `NewHealth` 会广播出负数，所有监听者都得自己防御。

**③ 血量没变也会广播**

`ApplyHealthChange(0)` 会照发不误，UI 白刷一次。

**④ 同一条数据链被求值了两次**

图里有两组 `Get Owning Player Pawn` + `Cast`：一组是 Construct 时的非纯 Cast（用于绑定），另一组是纯 Cast（用于事件处理里的 `Get Class`）。第二组每次血量变化都会重跑一遍。

更干净的做法：Construct 时把组件引用**提升为变量**存起来，事件处理里直接取，顺便把最大血量也一次性算好。

---

# 第四节：C++ 侧订阅与死亡处理

## 4.1 现在有两个监听者了

这一节让 `ARoguePlayerCharacter` 也订阅同一个委托，于是：

| 监听者 | 绑定位置 | 绑定方式 | 干什么 |
|---|---|---|---|
| `PlayerHealth_WBP` | 蓝图 `Event Construct` | `Bind Event` 节点 | 更新进度条 |
| `ARoguePlayerCharacter` | C++ `PostInitializeComponents` | `AddDynamic` | 死亡表现 |

组件对这两位一无所知——它的头文件里既没有 UMG 也没有角色类。

**这也是 `DYNAMIC` 这个词的价值兑现现场**：正因为它走反射、按名字绑定，C++ 和蓝图才能挂在同一个委托上。换成普通的 `DECLARE_MULTICAST_DELEGATE`，蓝图那一半根本接不上。3.2 说 Dynamic"性能更差"，这就是买回来的东西。

## 4.2 `AddDynamic` 的双重身份

```cpp
ActionSystemComponent->OnHealthChanged.AddDynamic(this, &ARoguePlayerCharacter::OnHealthChanged);
```

`AddDynamic` **不是函数，是宏**。它大致展开成：

```cpp
__Internal_AddDynamic(this, &ARoguePlayerCharacter::OnHealthChanged, TEXT("OnHealthChanged"));
//                    ─┬──  ─┬────────────────────────────────────   ─┬──────────────────
//                  监听者    函数指针（编译期类型检查）              函数名字符串（运行期查表）
```

注意它把函数名**同时**当指针和当字符串用了。这带来一个很反直觉的错误分裂：

| 错误 | 什么时候炸 |
|---|---|
| **签名不匹配**（参数个数/类型不对） | **编译期报错**——因为函数指针是有类型的 |
| **忘记写 `UFUNCTION()`** | **运行期断言失败**——反射表里查不到这个名字 |

第二条是真正的坑：代码编译得干干净净，一运行就挂，报错信息只说"找不到函数"，跟你脑子里"我明明写了这个函数"的印象完全对不上。

> **凡是要被 Dynamic 委托绑定的函数，必须标 `UFUNCTION()`。** 括号里可以什么都不写——唯一的作用就是让 UHT 把它登记进反射表。

```cpp
UFUNCTION()
void OnHealthChanged(float NewHealth, float OldHealth);
```

配套记忆：`AddDynamic` 的反面是 `RemoveDynamic`，另外还有 `AddUniqueDynamic`（重复绑定不叠加，相当于蓝图 `Bind Event` 节点的行为）。

## 4.3 为什么绑定要放在 `PostInitializeComponents`

这是本节最重要的架构点。

![Actor 初始化顺序与委托绑定时机](/img/posts/ue5-ch5/ue5-ch5-init-order.svg)

**为什么不能在构造函数里绑？**

构造函数**也会为 CDO 执行一遍**。CDO 是"出厂模板"，不是游戏里的真实实例。在那儿绑定，等于给模板挂了个监听者——语义完全错乱。而且此时组件虽然被 `CreateDefaultSubobject` 创建了，但还没注册进世界，很多操作是非法的。

**为什么不放 `BeginPlay`？**

能跑，但更晚。`PostInitializeComponents` 到 `BeginPlay` 之间存在一个窗口期，如果有别的系统在这段时间造成了伤害，广播就漏掉了。而且**不同 Actor 的 `BeginPlay` 之间没有顺序保证**——依赖它做跨 Actor 的初始化很容易踩到"我 BeginPlay 时对方还没 BeginPlay"。

> 第四章 3.3 讨论"为什么事件分发器的登记必须在 BeginPlay"时，结论是"登记要早于广播"。这里是同一条原则更严格的版本：**能更早，就更早**。

**结论：凡是"Actor 和自己组件之间的接线"，`PostInitializeComponents` 是标准答案。**

```cpp
void ARoguePlayerCharacter::PostInitializeComponents()
{
    Super::PostInitializeComponents();   // 别漏
    ActionSystemComponent->OnHealthChanged.AddDynamic(this, &ARoguePlayerCharacter::OnHealthChanged);
}
```

漏掉 `Super::` 会破坏父类的初始化，这和第四章忘连 `Parent: Interact` 节点是同一类错误。

## 4.4 Clamp + 守卫：顺手修好两个坑，白送一个性质

```cpp
void URogueActionSystemComponent::ApplyHealthChange(float InValueChange)
{
    float OldHealth = AttributeSet.health;
    float MaxHealth = GetDefault<URogueActionSystemComponent>()->AttributeSet.health;

    AttributeSet.health = FMath::Clamp(AttributeSet.health + InValueChange, 0.f, MaxHealth);

    if (!FMath::IsNearlyEqual(OldHealth, AttributeSet.health))
    {
        OnHealthChanged.Broadcast(AttributeSet.health, OldHealth);
    }

    UE_LOG(LogTemp, Log, TEXT("New Health: %f, MaxHealth: %f"), AttributeSet.health, MaxHealth);
}
```

- **Clamp** 解决了血量掉负数（第一节缺陷）
- **`IsNearlyEqual` 守卫**解决了"值没变也广播"（第三节问题③）

而且这两条凑在一起，**白送了一个很重要的性质：死亡逻辑保证只触发一次。**

推演一下：

```text
血量 10，挨 100 伤害
  → Clamp(10-100, 0, 100) = 0
  → Old=10, New=0，不相等 → 广播 → 死亡触发 ✅

尸体再挨一发
  → Clamp(0-100, 0, 100) = 0
  → Old=0, New=0，相等 → 不广播 → 死亡不重复触发 ✅
```

如果没有守卫，尸体上每中一枪就重播一次死亡动画。**这类"两个看似无关的改动顺带解决了第三个问题"的情况，是好架构的信号**——反过来说，如果每加一个功能都要额外补一堆特判，说明抽象层次不对。

> 对比第四章的宝箱：那里的重复触发要靠 `bChestOpened` 双层守卫手动挡住。这里因为"改血量"只有一个入口，守卫写一次就全局生效了。这就是第零节说的"唯一入口"的价值。

## 4.5 死亡处理三行

```cpp
void ARoguePlayerCharacter::OnHealthChanged(float NewHealth, float OldHealth)
{
    if (FMath::IsNearlyZero(NewHealth))
    {
        DisableInput(nullptr);
        GetMovementComponent()->StopMovementImmediately();
        PlayAnimMontage(DeathMontage);
    }
}
```

**`IsNearlyZero` 而不是 `== 0.f`**

浮点数不能用 `==` 比较：`0.1f + 0.2f != 0.3f`。血量经过多次加减会累积误差，可能停在 `0.0000001` 这种值上。`IsNearlyZero` 用 `KINDA_SMALL_NUMBER`（1e-4）做容差。

> 这里其实有点微妙：因为 Clamp 会把结果**精确**设成 `0.f`，`== 0.f` 在当前实现下反而成立。但依赖这个巧合不是好习惯。

**`DisableInput` 和 `StopMovementImmediately` 是两件事**

`DisableInput` 断掉**新的**输入，但角色身上的**速度**还在。少了第二行，尸体会滑出去一段——因为 CharacterMovement 会继续消化残余 velocity。这两行必须成对。

`DisableInput(nullptr)` 里的 `nullptr` 表示"对所有玩家控制器生效"。单机没区别；分屏下更精确的写法是传入 `Cast<APlayerController>(GetController())`。

**`PlayAnimMontage` 自带空指针检查**

它是 `ACharacter` 提供的便利封装，内部去取 Mesh 的 `AnimInstance` 再调 `Montage_Play`。关键点：**`DeathMontage` 没赋值时，它安安静静返回 0，不崩溃、不报错、也不播放。**

> 所以"死亡动画不播"最常见的原因根本不是代码，而是 BP 的类默认值里那一栏是空的。这和第四章"`BlueprintImplementableEvent` 没有蓝图实现时静默变成空操作"是同一类静默失败。

## 4.6 `EditDefaultsOnly` 与说明符矩阵

```cpp
UPROPERTY(EditDefaultsOnly, Category = "Death")
TObjectPtr<UAnimMontage> DeathMontage;
```

编辑器可见性说明符其实是个 2×3 的矩阵：

|  | 蓝图类默认值面板 | 关卡中放置的实例 |
|---|---|---|
| `EditDefaultsOnly` | **可改** | 不显示 |
| `EditInstanceOnly` | 不显示 | **可改** |
| `EditAnywhere` | **可改** | **可改** |
| `VisibleDefaultsOnly` | 只读 | 不显示 |
| `VisibleInstanceOnly` | 不显示 | 只读 |
| `VisibleAnywhere` | 只读 | 只读 |

**为什么死亡蒙太奇选 `EditDefaultsOnly`？**

它是**类级别**的属性——所有 `BP_PlayerCharacter` 都该用同一个死亡动画。如果用 `EditAnywhere`，关卡美术不小心给场景里某一个角色换了个蒙太奇，这种 bug 排查起来极其痛苦，因为代码和蓝图都是对的，错的是那**一个实例**。

**用限制换正确性**，这是 UPROPERTY 说明符的核心思路。

## 4.7 `GetDefault<T>()` 的陷阱：蓝图版反而更对

```cpp
float MaxHealth = GetDefault<URogueActionSystemComponent>()->AttributeSet.health;   // ⚠️
```

`GetDefault<T>()` 等价于 `T::StaticClass()->GetDefaultObject<T>()`——**类型在编译期就定死了**。

如果以后有人基于这个组件做了个蓝图子类 `BP_BossAttributeComp`，把默认血量改成 500，这行代码依然会读到 C++ 基类的 **100**。

正确写法是从**实例的运行时类**去取：

```cpp
float MaxHealth = GetClass()->GetDefaultObject<URogueActionSystemComponent>()->AttributeSet.health;
```

**有意思的是，蓝图那边反而是对的**——控件里的 `Get Class` 是对**组件实例**调用的，拿到的是真实的运行时类。

| | 拿到的类 | 蓝图子类改了默认值 |
|---|---|---|
| C++ `GetDefault<T>()` | 编译期写死的 `T` | ❌ 读不到 |
| C++ `GetClass()->GetDefaultObject<T>()` | 实例的运行时类 | ✅ 读得到 |
| 蓝图 `Get Class` → `Get Class Defaults` | 实例的运行时类 | ✅ 读得到 |

> 目前这个 bug 是**潜伏**的：`AttributeSet` 只有 `BlueprintReadOnly`，还没法在蓝图里改默认值，所以子类做不出来。但迟早要给敌人配不同血量，那时候必须加 `EditDefaultsOnly`——**加的那一刻这个 bug 就活了**。

## 4.8 有死亡"反应"，没有死亡"状态"

现在角色被禁用输入、停止移动、播了动画——但**它不知道自己死了**。后果：

- 如果以后加复活/治疗，血量回到 50，`OnHealthChanged` 会正常广播，但 `IsNearlyZero` 为假，什么都不做——**输入永远不会恢复**，角色变成一个能被推动的植物人
- 死亡后碰撞体还在，还会继续挡子弹、触发重叠事件

这是"事件驱动"很容易掉进去的思维陷阱：**只处理了转变的那一刻，忘了维护转变之后的状态。**

另外，"什么叫死亡"这件事现在是**每个监听者自己判断**的：角色里写 `IsNearlyZero(NewHealth)`，以后 AI 要判断"低血量逃跑"又得自己写一遍。**这个定义应该由组件说了算**：

```cpp
UFUNCTION(BlueprintCallable, Category = "Attributes")
bool IsAlive() const { return AttributeSet.health > 0.f; }
```

---

# 知识链路总览

![第五章完整链路](/img/posts/ue5-ch5/ue5-ch5-chain.svg)

```text
爆炸桶 / 投射物
  → UGameplayStatics::ApplyDamage
  → ARoguePlayerCharacter::TakeDamage          ← 引擎的伤害入口，只做转发
      → Super::TakeDamage（父类可能改伤害值）
      → ActionSystemComponent->ApplyHealthChange(-ActualDamage)

  → URogueActionSystemComponent::ApplyHealthChange   ← 唯一入口，规则全在这
      → 记录 OldHealth
      → FMath::Clamp(0, MaxHealth)                   ← 钳制
      → if (变化了) OnHealthChanged.Broadcast(...)    ← 守卫 + 广播

  ├─→【蓝图监听者】PlayerHealth_WBP
  │     Event Construct → Bind Event（登记，不执行）
  │     Broadcast 时唤醒自定义事件
  │       → New Health ÷ CDO 默认 Health
  │       → Set Percent
  │
  └─→【C++ 监听者】ARoguePlayerCharacter
        PostInitializeComponents → AddDynamic（登记）
        Broadcast 时调用 OnHealthChanged
          → IsNearlyZero → DisableInput + StopMovement + PlayAnimMontage
```

把这一章浓缩成四句话：

1. **横切能力做成组件**——血量不属于任何一条继承链，所以用组合而非继承。
2. **修改必须有唯一入口**——`ApplyHealthChange` 是唯一改血量的地方，于是钳制、守卫、广播都只写一遍。
3. **委托反转依赖方向**——组件不认识 UI，是 UI 主动订阅组件；一次广播，C++ 和蓝图同时收到。
4. **事件驱动要配初始同步**——只监听"变化"会漏掉"初始状态"，这是它的先天空洞。

关于蓝图，再浓缩成三条：

1. **蓝图里每个节点都对应一个 C++ 宏**——搜不到节点，先回头看说明符。
2. **白线是执行流，其余是数据流**——数据流不排队，被下游拉取时才倒着求值。
3. **绑定 ≠ 调用**——`Bind Event` 只是登记，真正执行在 `Broadcast` 那一刻。

---

# 易错点速查表

| 症状 | 最可能的原因 | 检查位置 |
|---|---|---|
| 血量能掉到负数 | 没有 `FMath::Clamp` | `ApplyHealthChange` |
| 满血吃治疗，UI 闪了一下 | 没有"值没变就不广播"的守卫 | `ApplyHealthChange` |
| 尸体每中一枪就重播死亡动画 | 同上，缺守卫 | `ApplyHealthChange` |
| 加了护甲减伤但完全没效果 | `TakeDamage` 里用了 `-DamageAmount` 而非 `-ActualDamage` | `TakeDamage` |
| 蓝图里搜不到 `Attribute Set` | 结构体没加 `USTRUCT(BlueprintType)` | 结构体声明 |
| `Break` 节点有，但一个引脚都没有 | 结构体成员没加 `UPROPERTY` | 结构体成员 |
| 蓝图里搜不到组件 | 组件指针少了 `BlueprintReadOnly` | 角色头文件 |
| 蓝图里搜不到 `Bind Event to ...` | 委托少了 `BlueprintAssignable` | 委托声明 |
| 控件建了但屏幕上什么都没有 | 忘了 `Add to Viewport` | `BP_HUD` 图表 |
| 图表里搜不到设计器摆的进度条 | 没勾"是变量" | 控件细节面板 |
| 血条一直停在半血（0.5） | 事件驱动缺初始同步 | `Event Construct` 后面 |
| 血条完全不动，且无任何报错 | 忘了 `Broadcast` / 绑定没生效 | `ApplyHealthChange` + Construct |
| 委托绑定编译通过，一运行就崩 | 回调函数忘了标 `UFUNCTION()` | 角色头文件 |
| 委托绑定编译报错 | 回调函数签名和宏声明不一致 | 两处对照 |
| 绑定在构造函数里，行为诡异 | CDO 也会执行构造函数 | 改到 `PostInitializeComponents` |
| 父类初始化异常 | 漏了 `Super::PostInitializeComponents()` | 重写函数第一行 |
| 蓝图子类改了默认血量但读不到 | `GetDefault<T>()` 忽略运行时类 | 改用 `GetClass()->GetDefaultObject<T>()` |
| 死亡动画不播，也不报错 | `DeathMontage` 在 BP 里没赋值 | 蓝图类默认值 |
| 死后尸体还在滑行 | 只 `DisableInput`，没 `StopMovementImmediately` | 死亡回调 |
| 复活后角色不能动 | 只有死亡"反应"，没有死亡"状态" | 见待办③ |
| UI 显示正常但数据是错的 | 进度条会把负值截断到 0 | 看日志，别看界面 |
| 血条数值和实际不一致（多目标） | 委托签名里没带发送者身份 | 见待办④ |

---

# 遗留待办

## ① `TakeDamage` 改用 `ActualDamage`

**优先级最高，因为改了行为完全不变，成本为零。**

```cpp
ActionSystemComponent->ApplyHealthChange(-ActualDamage);
```

现在不改，等加了减伤系统才发现，就得回头排查一整条链。

## ② `GetDefault<T>()` 改为运行时类

```cpp
float MaxHealth = GetClass()->GetDefaultObject<URogueActionSystemComponent>()->AttributeSet.health;
```

同样是"改了看不出区别"的修复。见 4.7。

## ③ 死亡改为状态而非反应

组件提供 `IsAlive()`，角色维护 `bIsDead`，死亡时同时处理碰撞。否则复活功能一加就露馅。见 4.8。

## ④ 委托签名补上身份与 Delta

```cpp
DECLARE_DYNAMIC_MULTICAST_DELEGATE_FourParams(FOnHealthChanged,
    AActor*, InstigatorActor,
    URogueActionSystemComponent*, OwningComp,
    float, NewHealth,
    float, Delta);
```

见 3.8。做敌人血条和飘伤害数字之前必须改。

## ⑤ 最大血量独立成字段

现在"初始血量"和"最大血量"是同一个数，做不了半血复活和上限提升。配合 `EditDefaultsOnly` 一起改，顺便解决"所有角色都是 100 血"。

## ⑥ 初始同步的 `OldHealth` 别填 0

改成填当前血量，语义是"没有变化，只是同步"。见 3.7。

## ⑦ 控件里缓存组件引用

Construct 时把组件和最大血量提升为变量，去掉重复的 `Get Owning Player Pawn` + `Cast`。见 3.8 问题④。

## ⑧ `Create Widget` 补上 `Owning Player`

在 `BP_HUD` 里接 `Get Player Owner`。同时把 `Return Value` 提升为变量，以便后续 `Remove from Parent`。见 2.7。

## ⑨ 命名规范化

`float health` → `Health`，`ProgressBar_71` → `HealthBar`，`VisibleDefaultsOnly` 大小写，组件改 `VisibleAnywhere`。

> **注意**：`BlueprintAssignable` 属性改名会**断开蓝图里的 `Bind Event` 节点**，需要用第三章学的 CoreRedirects 补救。趁引用点少的时候改。

## ⑩ 清理调试日志

`UE_LOG` 现在每次调用都打（包括没变化的），定稿前降级成 `Verbose` 或删掉。

---

# 第五章完成检查清单

## 属性组件

- [x] 新建 `ActionSystem/` 目录与 `URogueActionSystemComponent`
- [x] 定义 `FRogueAttributeSet`，构造函数初始化 `health = 100.f`
- [x] `ApplyHealthChange(float)` 作为唯一修改入口
- [x] 角色构造函数 `CreateDefaultSubobject` 挂载组件
- [x] 重写 `TakeDamage` 转发到组件
- [ ] `TakeDamage` 改用 `ActualDamage`（待办①）

## 反射暴露

- [x] `USTRUCT(BlueprintType)` + `GENERATED_BODY()`
- [x] `UPROPERTY(BlueprintReadOnly)` on `float health`
- [x] `UPROPERTY(BlueprintReadOnly)` on `AttributeSet`
- [x] `UPROPERTY(BlueprintReadOnly)` on `ActionSystemComponent`
- [x] 理解"每个说明符对应一个蓝图节点"
- [ ] `AttributeSet` 补 `EditDefaultsOnly` 以支持配血量（待办⑤）

## 血条 UI

- [x] 新建 `UI/` 目录，创建 `PlayerHealth_WBP` 并放置进度条
- [x] 勾选进度条的**"是变量"**
- [x] 创建 `MainHUD_WBP`，画布面板里放入 `PlayerHealth_WBP`
- [x] 创建 `BP_HUD`（父类 `HUD`），`BeginPlay → Create Widget → Add to Viewport`
- [x] `BP_GameMode` 的 HUD Class 指向 `BP_HUD`
- [x] 理解执行流与数据流的区别
- [x] 理解 CDO 与 `Get Class Defaults`
- [ ] `Create Widget` 补 `Owning Player`（待办⑧）
- [ ] 进度条改名 `HealthBar`（待办⑨）

## 多播委托

- [x] 文件作用域声明 `DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams`
- [x] `UPROPERTY(BlueprintAssignable)` 暴露委托实例
- [x] `ApplyHealthChange` 里先存 `OldHealth` 再改再广播
- [x] 控件 `Event Construct → Cast → Bind Event`
- [x] 红色引脚拖出自定义事件，签名自动匹配
- [x] **绑定后手动调用一次做初始同步**
- [x] 删除 `Event Tick` 版本
- [ ] 初始同步的 `OldHealth` 改为当前血量（待办⑥）
- [ ] 委托签名补身份与 Delta（待办④）

## C++ 侧订阅与死亡

- [x] 回调函数标 `UFUNCTION()`
- [x] 重写 `PostInitializeComponents`，调用 `Super::`
- [x] `AddDynamic` 订阅委托
- [x] `FMath::Clamp` 钳制血量
- [x] `IsNearlyEqual` 守卫，值没变就不广播
- [x] `DeathMontage` 用 `EditDefaultsOnly`，蓝图里赋值
- [x] 死亡：`DisableInput` + `StopMovementImmediately` + `PlayAnimMontage`
- [ ] `GetDefault<T>()` 改为运行时类（待办②）
- [ ] 死亡改为状态，组件提供 `IsAlive()`（待办③）

## 实测验证

- [x] 血量归零后继续攻击，确认死亡动画不重播
- [ ] 验证 `DisableInput` 对 Enhanced Input 确实生效
- [ ] 清空 `DeathMontage` 运行，确认是静默无动画而非崩溃
- [ ] 断开初始同步，确认血条停在设计器默认值 0.5

---

# 术语表

| 术语 | 含义 |
|---|---|
| **`UActorComponent`** | 无变换的可插拔能力零件，不参与场景层级 |
| **横切关注点** | 横穿整个继承树、不属于任何单一分支的功能（如血量） |
| **组合优于继承** | 用"挂零件"代替"改继承链"来提供能力 |
| **`CreateDefaultSubobject`** | 只能在构造函数里调用的组件创建函数 |
| **CDO（Class Default Object）** | 每个 `UClass` 的"出厂模板"，所有实例从它拷贝 |
| **`GetDefault<T>()`** | C++ 取 CDO，**类型编译期写死，忽略蓝图子类** |
| **`GetClass()->GetDefaultObject<T>()`** | C++ 取运行时类的 CDO，正确处理子类 |
| **`Get Class Defaults`** | 蓝图版取 CDO，因为走实例的运行时类所以是对的 |
| **`TakeDamage`** | `AActor` 的虚函数，引擎公认的伤害入口 |
| **`AHUD`** | 归 `PlayerController` 所有的每玩家 UI 宿主 |
| **`Event Construct`** | UMG 控件的初始化事件，相当于 Actor 的 `BeginPlay` |
| **"是变量"** | UMG 设计器控件默认不生成成员变量，勾选后才能在图表里取到 |
| **纯节点 / 非纯节点** | 无执行引脚 / 有执行引脚；前者被拉取时才求值且无缓存 |
| **执行流 / 数据流** | 白线的先后顺序 / 被下游倒着拉取的取值链 |
| **`DECLARE_DYNAMIC_MULTICAST_DELEGATE`** | 走反射、可挂多个监听者、蓝图可见的委托类型声明 |
| **`DYNAMIC`** | 按函数名绑定，可序列化、蓝图可见，代价是查表开销 |
| **`MULTICAST`** | 可挂 0..N 个监听者，`Broadcast` 一次全调 |
| **`BlueprintAssignable`** | 蓝图能**订阅**这个委托（生成 `Bind Event` 节点） |
| **`AddDynamic`** | 宏，同时用函数指针（编译期）和函数名（运行期）绑定 |
| **`UFUNCTION()`** | Dynamic 委托回调的必需标记，缺了运行期才炸 |
| **`PostInitializeComponents`** | 组件已注册、`BeginPlay` 之前，绑定委托的标准位置 |
| **初始同步（initial sync）** | 事件驱动 UI 必须在订阅后手动跑一次以填充初始状态 |
| **`FMath::IsNearlyZero` / `IsNearlyEqual`** | 带容差的浮点比较，替代 `==` |
| **`EditDefaultsOnly`** | 只能在蓝图类默认值面板改，关卡实例不显示 |
| **`AnimMontage`** | 可被代码触发的动画片段 |

---

# 参考资料

- [Epic Games：Components in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/components-in-unreal-engine)
- [Epic Games：Actor Lifecycle](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-actor-lifecycle)
- [Epic Games：Delegates and Lambda Functions](https://dev.epicgames.com/documentation/en-us/unreal-engine/delegates-and-lamba-functions-in-unreal-engine)
- [Epic Games：Dynamic Delegates](https://dev.epicgames.com/documentation/en-us/unreal-engine/dynamic-delegates-in-unreal-engine)
- [Epic Games：UMG UI Designer](https://dev.epicgames.com/documentation/en-us/unreal-engine/umg-ui-designer-for-unreal-engine)
- [Epic Games：Creating Widgets](https://dev.epicgames.com/documentation/en-us/unreal-engine/creating-widgets-in-unreal-engine)
- [Epic Games：Reflection System / UProperties](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-uproperties)
- [Epic Games：Gameplay Ability System](https://dev.epicgames.com/documentation/en-us/unreal-engine/gameplay-ability-system-for-unreal-engine)
- [Unreal Garden：All UPROPERTY Specifiers](https://unreal-garden.com/docs/uproperty/)
- [Tom Looman：ActionRoguelike on GitHub](https://github.com/tomlooman/ActionRoguelike)
