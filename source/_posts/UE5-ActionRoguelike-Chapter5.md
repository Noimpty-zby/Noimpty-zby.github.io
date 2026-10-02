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
description: 第五章第一次要做的是一个「系统」，而不是一个单独的 Actor。本篇完整梳理这一章的四节课，内容包括为什么血量要做成 ActorComponent，为什么 TakeDamage 只是引擎的伤害入口而不是伤害逻辑，UMG 血条那一大片蓝图连线中每一根线的含义，执行流与数据流的区别，DECLARE_DYNAMIC_MULTICAST_DELEGATE 中每个词的含义，Bind Event 的三根输入线，事件驱动为什么必须配合初始同步，AddDynamic 为什么在运行期而不是编译期报错，以及绑定为什么必须放在 PostInitializeComponents 里。重点解释蓝图中每一根连线的语义，以及每个坑的真正成因。
cover: /img/covers/UE5-ActionRoguelike-Chapter5.svg
series: UE5 ActionRoguelike
privacy: protected
sitemap: false
private_section: 课外
---

# 前言

本文是 Tom Looman《UE5 C++》第五章 **Attribute** 的完整复盘。

本章使用的开发环境如下：

- Unreal Engine `5.6.1`
- Rider
- Visual Studio 2022 Build Tools / MSVC 编译工具链
- 项目名称：`ActionRoguelike`

这一章和前四章不同，要做的是一个**系统**。前四章每一节的产出都是一个具体的东西，比如宝箱、拉杆、投射物和炮台；而这一章做的是**血量**，它不属于任何一个 Actor，而是所有 Actor 共用的一套规则。

本章还有一条非常清晰的主线，它也是全章最有价值的部分：

> **同一个功能（血条 UI），先用轮询做一遍，再用事件驱动重做一遍。**

第二节的 `Event Tick` 版本可以正常运行，但到了第三节，它被整个删掉了。这并不是在浪费时间，因为**只有先体会过轮询的坏处，才能理解委托到底在解决什么问题**。所以这篇复盘会把两个版本都完整地记录下来，包括那个「注定要被删掉」的实现。

这一章最大的困难并不在 C++，而在于**蓝图里那一大片连线**。第二节和第三节的控件图表里节点密密麻麻，跟着老师一根一根地连出来，连完之后能够运行，却完全不知道为什么要这样连。所以本篇专门花了大量篇幅来拆解蓝图，包括每根线代表什么、每个节点从哪里来，以及**下次怎样自己把它连出来**。

四节课的分工如下：

| 节 | 主题 | 核心产出 |
| --- | --- | --- |
| 第一节 | 属性组件骨架 | `UActorComponent`、`ApplyHealthChange`、`TakeDamage` |
| 第二节 | 血条 UI（轮询版） | `AHUD`、UMG 控件、`Get Class Defaults`、CDO |
| 第三节 | 多播委托（事件版） | `DECLARE_DYNAMIC_MULTICAST_DELEGATE`、`BlueprintAssignable`、`Bind Event` |
| 第四节 | C++ 侧订阅与死亡 | `AddDynamic`、`PostInitializeComponents`、`FMath::Clamp` |

和前四章一样，这篇文章不只记录点了哪些按钮，还会重点解释下面几个问题：

- 每一根蓝图连线的语义，以及每个节点是由哪个 C++ 宏生成的；
- 为什么这段逻辑放在这一层，而不是放在上一层或者下一层；
- 每个坑的真正成因，以及下次应该怎样排查。

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

这一节课程里没有，是额外补充的。看到「新建一个 ActorComponent」时，很多人的第一反应是，血量不就是一个 `float` 吗，为什么不直接写在角色类里？

先把这个问题回答清楚，后面的四节才不会变成单纯地「跟着老师敲代码」。

## 0.1 三种放血量的方案

**方案一：写在 `ARoguePlayerCharacter` 里。**

```cpp
class ARoguePlayerCharacter : public ACharacter
{
    float Health = 100.f;   // ❌
};
```

这样玩家可以用了。接下来敌人也需要血量，但敌人是从 `APawn` 派生的，而不是 `ACharacter`，所以拿不到这个字段。爆炸桶也需要血量，它是一个 `AActor`，就更拿不到了。如果三个类各抄一份，三份逻辑就会各自演化，迟早会变得不一致。

**方案二：往上提，做一个公共基类。**

```cpp
class ARogueBaseActor : public AActor { float Health; };   // ❌
```

这样做的问题更大。`ACharacter` 已经是 `APawn → AActor` 的子类了，开发者没有办法把新的基类插进这条继承链。UE 的 Gameplay Framework 基类是固定的，只能在末端继续派生。而且就算能插进去，「会飞的道具」和「能被摧毁的门」这些完全不需要血量的东西，也会被迫背上这个字段。

**方案三：做成组件，谁需要谁挂。**

![组合而非继承：同一个属性组件挂在三条不同继承链上](/img/posts/ue5-ch5/ue5-ch5-composition.svg)

血量是一个**横切关注点**，它横穿整个继承树，不属于其中任何一条分支。这类问题的标准解法是**组合优于继承**，也就是把能力做成独立的零件，需要这种能力的对象自己挂上去。

这也是 UE 里 `ActorComponent` 存在的根本理由。以后还会看到大量这样的模式，比如 `UCharacterMovementComponent`、`UHealthComponent` 和 `UInventoryComponent`。它们都不是「某个类的一部分」，而是「一种可以插拔的能力」。

## 0.2 组件不只是数据容器，还是权限边界

第二个容易忽略的地方是，组件并不只是「把 float 挪了个地方」，它还**顺带把权限管理起来了**。

如果血量是角色的 public 成员，那么任何代码都可以写 `Character->Health -= 10;`。而在这里，所有对血量的修改都必须经过下面这个函数：

```cpp
void ApplyHealthChange(float InValueChange);
```

**这是修改血量的唯一入口。** 这条约束到了第四节会体现出很大的价值，因为钳制、变化守卫和死亡广播都只需要在这一个函数里写一遍，就能对所有的调用方生效。

如果血量在各处被分散地修改，就得在每一个 `Health -= X` 的后面都补上一遍 `Clamp` 和判定，漏掉一处就是一个 bug。

## 0.3 本章的权限地图

下面顺便把整章的权限设计先列出来，后面每一节都是在往这张表里填写内容：

| 东西 | 说明符 | 含义 |
|---|---|---|
| `AttributeSet` | `BlueprintReadOnly` | 蓝图能读，不能写 |
| `float health` | `BlueprintReadOnly` | 同上 |
| `ActionSystemComponent` | `VisibleDefaultsOnly` + `BlueprintReadOnly` | 编辑器只能看，蓝图只能读 |
| `OnHealthChanged` 委托 | `BlueprintAssignable`（不加 `BlueprintCallable`） | 蓝图能**订阅**，不能**广播** |
| `DeathMontage` | `EditDefaultsOnly` | 只能在蓝图类默认值里配，实例不能改 |

这张表贯穿着一条主线，那就是**只开放刚好够用的权限**。这和第四章 `bChestOpened` 使用 `BlueprintReadOnly` 是同一个思路，因为状态的所有权必须有明确的归属。

---

# 第一节：属性组件的骨架

## 1.1 文件结构与类

在 `Source/ActionRoguelike/` 下新建一个 `ActionSystem/` 目录，然后创建一个继承自 `UActorComponent` 的类：

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

> 在 Rider 的「Unreal 类」创建向导里，「基文件夹」选择**根**，「路径」填写 `Source\ActionRoguelike\ActionSystem`，它会自动把 `.h` 和 `.cpp` 放在同一个目录下。这个项目没有使用 `Public/Private` 分离的结构，所以选择「根」是正确的。

## 1.2 `FRogueAttributeSet`：先用最朴素的写法

```cpp
struct FRogueAttributeSet
{
    FRogueAttributeSet()
        : health(100.f) {}

    float health;
};
```

第一节在这里**故意还没有加任何反射宏**。那么，为什么要单独包装一个结构体，而不是直接在组件里放一个 `float Health` 呢？

因为血量只是第一个属性，后面还会有法力、耐力、护甲和移速加成等等。把它们打包进一个 `AttributeSet`，有以下几个好处：

- 整组属性可以一次性地拷贝、序列化和进行网络同步；
- 增加新属性时，组件的接口不需要改动；
- 在语义上，它表示「这是一组属性」，而不是「组件里散落着几个变量」。

> 这个设计其实是 Epic 官方 **GAS（Gameplay Ability System）** 的简化版。GAS 里的 `UAttributeSet` 采用的是同样的思路，只是要复杂得多。课程先用手写的版本，帮助学习者理解「为什么需要这个东西」。

## 1.3 `ApplyHealthChange`：唯一入口

```cpp
void URogueActionSystemComponent::ApplyHealthChange(float InValueChange)
{
    AttributeSet.health += InValueChange;
    UE_LOG(LogTemp, Log, TEXT("New Health: %f"), AttributeSet.health);
}
```

需要注意，参数名是 `InValueChange`，而不是 `Damage`，因为**这个函数并不区分伤害和治疗**。传入负数就是掉血，传入正数就是回血。至于这次变化是伤害还是治疗，由**调用方**来决定，组件只负责修改数值。

这是一个很好的接口设计习惯，让底层保持中立，把语义留给上层。否则就会写出 `ApplyDamage` 和 `ApplyHeal` 这两个几乎一样的函数，而 Clamp 逻辑也得维护两遍。

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

这里有三点值得注意。

**① `CreateDefaultSubobject` 只能在构造函数里调用。** 它创建的是 **CDO（类默认对象）的子对象**，之后的每一个实例都是从 CDO 拷贝出来的。如果在别的地方调用它，程序会直接崩溃。

**② 正因为如此，这个指针不需要判空。** 它在构造期间就已经保证存在了，只要不手动调用 `DestroyComponent`，它的生命周期就和 Actor 一样长。

**③ 它不是 `SceneComponent`，所以没有 `SetupAttachment`。** `UActorComponent` 没有变换（Transform），也不参与场景层级，它只是挂在 Actor 上的一段逻辑和数据。这和 `SpringArmComponent`、`CameraComponent` 那种有位置的组件是两回事。

> **关于说明符的选择**，这里的 `VisibleDefaultsOnly` 其实偏保守，一般的组件使用 `VisibleAnywhere` 会更合适。两者的区别在于，使用前者时，在关卡里选中某个实例，细节面板里是**看不到**这个组件的；而使用后者时，两处都能看到（只读）。调试时能在实例上看到组件，是很有用的。

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

把这条调用链弄清楚非常重要：

```text
爆炸桶 → UGameplayStatics::ApplyDamage(...)
          → Actor->TakeDamage(...)              ← 引擎的标准伤害入口
            → Super::TakeDamage(...)            ← 父类可能修改伤害值
            → ActionSystemComponent->ApplyHealthChange(...)   ← 你的属性系统
```

`TakeDamage` 是 **`AActor` 的虚函数**，也是整个引擎公认的「伤害进入的地方」。UE 自带的伤害类型（`RadialDamage`、`PointDamage`）、AI 感知和投射物系统，全都是通过它来造成伤害的。

**所以重写的这一层本质上是一个「适配器」**，它把引擎的通用伤害事件翻译成项目自己的属性变更。这个函数里应该只有转发，而不应该塞进死亡判定、特效和音效。那些都是属性变更之后的**后果**，属于监听者的职责，第四节会看到具体的做法。

## 1.6 踩坑：`-DamageAmount` 应该是 `-ActualDamage`

上面那段代码接收了 `Super::TakeDamage` 的返回值，却没有使用它。

`AActor::TakeDamage` 的基类实现目前是原样返回 `DamageAmount`，所以**现在两种写法的行为完全一致，测试不出任何区别**。

但是既然写了 `float ActualDamage = Super::TakeDamage(...)`，就等于承认了「父类有权修改伤害值」这个契约。如果以后出现下面这些情况：

- 加了一个 `ARogueBaseCharacter` 中间层，在那里做护甲减伤；
- 加了无敌帧，父类判断之后返回 0；
- 加了伤害类型系统，某些伤害对某些角色无效。

那么父类做的这些修改，都会被 `-DamageAmount` **静默地绕过**。护甲加上了却没有效果，而代码看起来又完全正确，这类 bug 排查起来非常痛苦。

**正确写法：**

```cpp
ActionSystemComponent->ApplyHealthChange(-ActualDamage);
```

> 这是一个典型的「修改之后行为完全不变」的修复。现在修改，成本为零；如果等到加了减伤系统之后才发现，就得回过头去把整条链重新怀疑一遍。

## 1.7 第一节结束时的三个已知缺陷

运行之后，可以在日志里看到血量从 100 一路掉到 0：

```text
LogTemp: New Health: 90.000000
LogTemp: New Health: 80.000000
...
LogTemp: New Health: 0.000000
```

看起来很完美，但是**再打一发，血量就会变成 -10**。下面这三个问题会在后面几节里陆续暴露并得到修复，先记录在这里：

| 缺陷 | 后果 | 修复位置 |
|---|---|---|
| 没有 `FMath::Clamp` | 血量掉负数、治疗会超上限 | 第四节 |
| `FRogueAttributeSet` 不是 `USTRUCT` | 蓝图完全看不见，初始血量硬编码 100 | 第二节 |
| `float health` 命名不规范 | UE 约定成员用 PascalCase | 未修 |

> **关于验证的习惯**，日志里显示 `0.000000` 时，第一反应往往是「正好，clamp 好像生效了」。但实际上，那只是因为**恰好打了 10 次、每次 10 点的伤害**。**编译通过和日志好看都不能说明代码是正确的**，多打一发才是真正的验证。

---

# 第二节：血条 UI 与蓝图连线详解

这一节是全章最吃力的部分，所以写得最详细。

**先说结论，这一节做出来的东西，到了第三节会被整个删掉。** 但是它必须先做一遍，因为不亲身体验一次轮询，就无法理解委托的价值。

## 2.1 四层结构，每层的存在理由

![血条 UI 的四层结构与各层职责](/img/posts/ue5-ch5/ue5-ch5-ui-stack.svg)

**为什么 UI 挂在 `AHUD` 上，而不是挂在角色身上？**

角色会死亡，也会重生，角色被销毁时，它创建的所有东西都会跟着消失。而 `AHUD` 归 `PlayerController` 所有，玩家在整局游戏里只有一个 Controller，所以 UI 的生命周期是稳定的。

**为什么不是 GameMode？**

在多人游戏里，GameMode **只存在于服务器上**。而 UI 是纯客户端的东西，放在 GameMode 里，客户端根本看不到。

**为什么 `MainHUD_WBP` 和 `PlayerHealth_WBP` 要拆成两个控件？**

这是为了职责分离：

- `MainHUD_WBP` 负责**屏幕布局**，以后的准心、弹药和小地图都是它的子控件；
- `PlayerHealth_WBP` 是一个**可以复用的零件**，以后做敌人头顶的血条时，直接把它塞进 `WidgetComponent` 就可以了。

如果把进度条直接画在 `MainHUD_WBP` 里，就没办法这样复用了。

## 2.2 `BP_HUD` 图表：创建和显示是两步

```text
Event BeginPlay ─▶ Create Main HUD WBP Widget ─▶ Add to Viewport
                        Class: MainHUD_WBP
                        Owning Player: (空)
                        Return Value ────────────▶ Target
```

**`Event BeginPlay`** 会在 HUD 这个 Actor 生成并初始化完成时触发一次。UI 只需要创建一次，所以使用 BeginPlay，而不是 Tick。

**`Create Widget`** 只做一件事，那就是**在内存里 new 一个控件对象**。这时屏幕上还什么都没有。

- `Class` 引脚是**紫色**的，紫色在蓝图里表示**类引用**（`UClass*`），而不是对象实例。这里选择的是「要创建哪一种控件」，而不是「某一个控件」。
- `Return Value` 是**蓝色**的，蓝色表示**对象引用**，它才是创建出来的那个实例。

**`Add to Viewport`** 会把控件对象加入玩家视口的渲染列表，执行这一步之后，控件才会显示出来。

> **「创建」和「显示」是两个步骤**，这是 UMG 里最经典的坑。如果忘了 `Add to Viewport`，编译能通过，运行时也不报错，但屏幕上什么都没有。

## 2.3 反射链条：蓝图里那些节点是从哪冒出来的

这是本节最关键、也最容易让人困惑的一段。**「Break Rogue Attribute Set」这个节点根本没有人创建过，它是从哪里来的呢？**

答案是，**在 C++ 里加上的每一个说明符，都精确地对应着蓝图里的一个节点或者引脚。**

![C++ 反射说明符与蓝图节点的对应关系](/img/posts/ue5-ch5/ue5-ch5-reflection-chain.svg)

本节在 C++ 这一侧的改动只有这些：

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

下面把对应关系一条一条地列清楚：

| C++ 写法 | 蓝图里变出什么 | 不写会怎样 |
|---|---|---|
| `BlueprintReadOnly` on `ActionSystemComponent` | 角色引脚拖出来能搜到 `Action System Component` 取值节点 | 链条第一环断，节点不存在 |
| `USTRUCT(BlueprintType)` on `FRogueAttributeSet` | 结构体成为蓝图类型，**UHT 自动生成 `Break` / `Make` 节点** | 蓝图完全不认识这个类型 |
| `GENERATED_BODY()` 在结构体内 | 反射数据的生成入口 | 编译报错 |
| `BlueprintReadOnly` on `float health` | `Break` 节点上那个 `Health` 输出引脚 | Break 节点在，但**一个引脚都没有** |
| `BlueprintReadOnly` on `AttributeSet` | 组件引脚拖出来能搜到 `Attribute Set` 取值节点 | 链条中间断 |

**所以 `Break Rogue Attribute Set` 节点是自动生成的**。任何标记了 `BlueprintType` 的结构体，UHT 都会自动为它生成一对 Break/Make 节点，开发者不需要写任何代码。

还有一点值得注意，**这里全部都是 `BlueprintReadOnly`，没有一个是 `BlueprintReadWrite`**。这是有意为之的，UI 只能读取，对血量的修改只能经过 `ApplyHealthChange()`。第零节所说的封装，在这一节得到了落实。

> `Category = "..."` 只影响细节面板和节点搜索列表里的分组，不影响功能。

## 2.4 执行流 vs 数据流：读懂蓝图的钥匙

控件图表里的节点密密麻麻，刚开始看的时候会完全摸不着头脑。理解它的关键在于，**只有三个节点位于执行链上**。

![蓝图的执行流与数据流](/img/posts/ue5-ch5/ue5-ch5-exec-vs-data.svg)

蓝图节点分为两类。

**非纯节点（Impure）有白色的执行引脚。** 它会**改变状态**，所以必须排进执行顺序里。`Set Percent` 就是一个非纯节点，因为它要写入进度条。

**纯节点（Pure）没有执行引脚。** 它只负责**取值或者计算**，不修改任何东西。所有的 Getter、`Break`、`÷` 和 `Get Class` 都是纯节点。

纯节点**不会排队执行**，而是**在被下游拉取时才求值**。当执行流走到 `Set Percent` 时，它发现 `In Percent` 引脚缺少一个数值，于是顺着连线一路往回拉取，先拉取除法节点，除法节点再往回拉取 Break 和 Class Defaults，然后再往回拉取组件。整条数据链就在那一瞬间被**倒着**求值出来。

> **纯节点的副作用是没有缓存。** 同一个纯节点的输出如果接到了 3 个地方，就会被求值 3 次。以后如果遇到「某个 Getter 里有随机数，结果每一处都不一样」的情况，根本原因就在这里。第四章提到的 `BlueprintPure` 说的也是同一件事。

## 2.5 逐节点拆解

**`Get Owning Player Pawn`** 用来获取「拥有这个控件的玩家」当前控制的 Pawn。需要注意，它依赖的是控件的 Owning Player，而不是「第 0 号玩家」。它比 `Get Player Pawn(0)` 更规范，分屏时也不会把两个玩家弄混。

**`Cast To RoguePlayerCharacter`** 的作用是向下转型。`APawn` 类型上根本没有 `ActionSystemComponent`，只有项目自己的角色类才有，所以必须先向下转型，编译器才允许访问这个属性。

蓝图里绝大多数 Cast 存在的理由都是这一个，**手上引用的类型太宽泛，访问不到需要的成员**。

`Cast Failed` 引脚没有连接任何东西，意味着转型失败时，这一帧什么都不做。这其实是**正确的**做法，因为从玩家死亡到重生之间，Pawn 是空的，这时静默地跳过要比报错更好。

**`Get Class` → `Get Class Defaults`** 这一对节点是「最大血量」的来源，也是本节最巧妙、同时也最有争议的一步。

在引擎里，每个 `UClass` 都有一个 **CDO（Class Default Object，类默认对象）**，它是这个类的「出厂模板」，所有的实例都是从它拷贝出来的。`Get Class` 拿到组件的类之后，`Get Class Defaults` 就去读取那个模板里的属性值，也就是 `FRogueAttributeSet` 构造函数里写死的 `100.f`。

这样一来，「最大血量」不需要新增字段，直接从 CDO 里就能读到。

> 图里那个绿色的 `Attribute Set Health` 引脚，是在结构体引脚上点击右键，选择**分割结构体引脚**拆出来的。这个操作在处理小结构体时很常用，比再接一个 `Break` 节点要干净。

**`÷`** 计算的是当前血量除以最大血量，得到一个 0~1 的比例。`Set Percent` 需要的就是 0~1 之间的值，而不是 0~100。

**`Progress Bar 71`** 之所以能在图表里拿到，是因为在设计器里勾选了「**是变量**」。

> 在 UMG 里，设计器中摆放的控件**默认不会生成成员变量**，所以在图表里搜不到。勾选之后，编译器才会为控件类生成一个同名的成员。另外，这个自动生成的名字 `ProgressBar_71` 很难看，而它又是要写进图表的变量名，所以应该改成 `HealthBar`。

## 2.6 方法论：以后怎么自己连出来

跟着老师连完之后，往往还是不知道下次应该怎么做，所以下面专门总结了一套方法。

### ① 从终点倒推，不要从起点正推

首先问自己最终要调用什么，答案是 `Set Percent`。
接着问它需要什么参数，答案是一个 0~1 的 float。
再问这个数从哪里来，答案是血量除以最大血量。
再问血量在哪里，答案是在组件里。
再问组件在谁身上，答案是在角色身上。
最后问控件怎样拿到角色，答案是 `Get Owning Player Pawn` 加上 Cast。

一直倒推到「手上已经有的东西」为止，然后再正着连回去。

### ② 从引脚拖，不要在空白处右键

这一点会让效率相差十倍。在空白处点击右键时，候选节点有几千个；而**从一个 `ARoguePlayerCharacter*` 引脚拖出来再松开，UE 只会列出这个类型能用的节点**，只有几十个，搜索「action」就能找到。

### ③ 认引脚颜色

| 颜色 | 类型 |
|---|---|
| 白色 | 执行（Exec） |
| 蓝色 | 对象引用（`UObject*`） |
| **紫色** | **类**引用（`UClass*`） |
| 深蓝 | 结构体 |
| 绿色 | float |
| 红色 | bool，**或委托**（见第三节） |

把 `Get Class` 紫色的输出接进 `Get Class Defaults` 的 `Class` 输入时，一眼就能确认这里传递的是「类」，而不是「实例」。

### ④ 连不上时，先看类型对不对

如果蓝图不允许连接，99% 的原因是类型不匹配，解决办法通常是在中间补一个 Cast，或者补一个 Break。

## 2.7 第二节结束时的问题

**① `Event Tick` 轮询，这是本节最大的设计缺陷**

每一帧都要执行一次 Cast、4 次取值、一次 Break、一次除法和一次 Set Percent。即使血量一个小时都不变，这些操作也照样在运行。

更严重的问题是，它**堵死了表现效果的实现**。血条受击时闪红、掉血时的缓动，这些效果都需要「血量**变化的那一刻**」这个时机，而 Tick 提供不了。

这正是第三节要解决的问题。

**② 最大血量绑死在 CDO 上**

`AttributeSet` 只有 `BlueprintReadOnly`，没有 `EditAnywhere` 或者 `EditDefaultsOnly`，这意味着无论是在细节面板里还是在蓝图子类里，**都改不了**这个默认值。现在所有角色都是 100 血。

另外，这个方案把「初始血量」和「最大血量」当成了同一个数。以后如果要做「半血复活」或者「临时提升上限」，这条链就得推翻重来。

**③ `Create Widget` 的 `Owning Player` 是空的**

如果留空，UMG 会回退到「第一个本地玩家」，单机游戏可以正常运行。但控件里使用了 `Get Owning Player Pawn`，而它依据的正是这个值。规范的做法是在 `BP_HUD` 里连接 `Get Player Owner`（`AHUD::PlayerOwner`），把它传进去。分屏时两个 HUD 都指向 0 号玩家的 bug，就是这样产生的。

**④ 返回值没存成变量**

`Create Widget` 的 `Return Value` 直接接进了 `Add to Viewport`，之后就丢失了。以后如果想调用 `Remove from Parent`，或者在暂停时隐藏 HUD，就找不到这个引用了。

**⑤ 负血量被 UI 掩盖了**

第一节没有做 Clamp，所以血量会掉到负数。`Set Percent` 收到负数时，进度条**在显示上会截断到 0**，看起来一切正常，但底层的数据是错的。

> **由此可以得到一个教训，UI 显示正常并不代表数据正常。** 界面层往往自带钳制和容错，会把底层的错误掩盖起来，所以验证时一定要看数据本身。

---

# 第三节：多播委托，干掉 Tick

## 3.1 委托解决的是"依赖方向"问题

先来看看没有委托时的两条死路。

**死路 A：组件持有 UI 指针。**

```cpp
// 组件里
HealthBarWidget->SetPercent(...);   // ❌
```

这样属性组件就依赖上了 UMG。以后敌人也会挂这个组件，但敌人没有血条 UI，组件就被迫写一堆判空。更糟糕的是，它还得知道「有几个东西关心我」，比如血条、受击特效、AI 的逃跑判断和成就系统等等，每增加一个监听方，就要修改一次组件。

**死路 B：UI 每帧轮询。** 也就是第二节的那个版本。组件是干净了，但代价是每一帧都在做无用的计算，而且拿不到「变化的那一刻」。

委托走的是第三条路，也就是**观察者模式**。组件只负责发出通知，告诉外界「血量变了，从 X 变成了 Y」，至于谁在听、听到之后做什么，它既不知道，也不关心。

![轮询与事件驱动的对比](/img/posts/ue5-ch5/ue5-ch5-poll-vs-event.svg)

**依赖的方向被反转了**，现在不是组件依赖 UI，而是 UI 主动去订阅组件。组件的头文件里从头到尾都没有出现过任何与 UMG 相关的东西。

> 第四章的**事件分发器**其实就是这个东西的蓝图版本。当时是在蓝图面板里点一下，添加了一个 `OnHandlePulled`；而这一节是在 C++ 里手写同一个东西。**事件分发器就是经过蓝图 UI 包装的 `DECLARE_DYNAMIC_MULTICAST_DELEGATE`。**

## 3.2 拆解这个宏名

```cpp
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnHealthChanged, float, NewHealth, float, OldHealth);
```

这个宏的名字看起来很吓人，其实是由四段拼起来的：

| 片段 | 含义 |
|---|---|
| `DECLARE` | 这是个宏，展开后**定义出一个类型**（一个 struct），不是定义变量 |
| `DYNAMIC` | 走反射系统，按**函数名**（FName）绑定，因此可被序列化、可被蓝图看见 |
| `MULTICAST` | 可以挂 0 到 N 个监听者，`Broadcast` 一次全部调用 |
| `_TwoParams` | 参数个数，有 `_OneParam` 到 `_NineParams` |

**`DYNAMIC` 是其中最关键的一个词。** 普通的 C++ 委托存储的是原始的函数指针，速度快，但蓝图和序列化系统都无法理解它。Dynamic 版本存储的则是「对象引用 + 函数名字符串」，调用时要查一次名字表，所以**性能明显更差**，但它换来了两项能力，**蓝图可以绑定它，存档也可以保存它**。

由此可以推出以下几点：

- 被绑定的 C++ 函数必须标记 `UFUNCTION()`，否则反射系统就查不到那个名字（第四节会遇到这个坑）；
- Dynamic 版本**不能有返回值**（没有 `_RetVal` 变体），因为如果挂了 3 个监听者，就无法确定应该使用哪一个的返回值；
- 高频事件（每一帧、每一次碰撞）不要使用 Dynamic 版本，而应该使用普通的 `DECLARE_MULTICAST_DELEGATE`。

它还有一个隐藏的好处，**Dynamic 委托内部存储的是弱引用**。监听者对象被 GC 回收之后，那条绑定会自动失效并被跳过，不会像裸指针那样导致崩溃。所以一般情况下，**不需要手动调用 `RemoveDynamic`**。

## 3.3 参数写法：为什么要写参数名

```cpp
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnHealthChanged, float, NewHealth, float, OldHealth);
//                                           ─┬─────────────  ─┬──  ─┬────────
//                                        委托类型名          类型   参数名
```

**类型和参数名要成对地写**，这是 Dynamic 委托独有的要求。普通委托只需要写类型，比如 `DECLARE_MULTICAST_DELEGATE_TwoParams(FFoo, float, float)`。

为什么 Dynamic 版本需要参数名呢？因为**这些名字会变成蓝图节点上的引脚名**。

自定义事件节点上的那两个绿色输出引脚，一个叫 `New Health`，另一个叫 `Old Health`。它们并不是在蓝图里创建的，而是由这一行宏生成出来的。UE 还顺便把驼峰命名拆成了带空格的显示名，这和第四章 `bChestOpened` 显示为 `Chest Opened` 遵循的是同一套显示名规则。

**声明的位置必须在类的外面，也就是文件作用域。** 因为这个宏展开之后是一个完整的 `struct` 定义，如果塞进类体里，语法就会出错。惯例是把它放在头文件的顶部、`UCLASS` 之前。

## 3.4 `Broadcast` 与 OldHealth 的顺序

```cpp
void URogueActionSystemComponent::ApplyHealthChange(float InValueChange)
{
    float OldHealth = AttributeSet.health;                 // ① 先存旧值
    AttributeSet.health += InValueChange;                  // ② 再改
    OnHealthChanged.Broadcast(AttributeSet.health, OldHealth);  // ③ 最后广播
}
```

这三行的顺序不能改变。①必须在②之前，否则 `OldHealth` 抓到的就是修改之后的值，两个参数就变成一样的了。

`Broadcast` 的行为是**同步、立即地按照绑定的顺序依次调用所有监听者**。它并不是「发一条消息到队列里」，而是当场把所有的回调都执行完才返回。由此可以得出下面几点：

- 如果监听者里做了繁重的工作（比如生成一大堆特效），就会直接卡住 `ApplyHealthChange` 的调用栈；
- **不要依赖调用的顺序**。两个监听者谁先执行，取决于谁先绑定，这不应该成为业务逻辑的一部分（第四章 3.5 节讨论用多根连线连接 `Explode` 时，得出的也是同一个结论）；
- **没有任何监听者时，`Broadcast` 是一个空操作，既不报错，也不警告**。

最后这一条是本节头号的坑。忘记调用 `Broadcast`，和绑定没有生效，这两种情况的表现完全一样，UI 纹丝不动，日志里干干净净，编译器也没有任何抱怨。

## 3.5 `BlueprintAssignable` 与 `Bind Event` 的三根线

```cpp
UPROPERTY(BlueprintAssignable)
FOnHealthChanged OnHealthChanged;
```

`BlueprintAssignable` 这一个说明符做了两件事，一是让蓝图能搜索到 `Bind Event to OnHealthChanged` 节点，二是让 `Assign OnHealthChanged` 出现在右键菜单里。

> 还有一个用在委托上的 `BlueprintCallable`，它表示允许蓝图调用 `Broadcast`。这里**故意没有加上它**，因为只有组件自己有权进行广播，外部只能收听。这和 `BlueprintReadOnly` 是同一个封装思路。

![Bind Event 节点的三根输入线](/img/posts/ue5-ch5/ue5-ch5-bind-event.svg)

| 引脚 | 颜色 | 含义 |
|---|---|---|
| 执行 | 白 | 什么时候执行"订阅"这个动作 |
| `Target` | 蓝 | **哪一个组件实例**的委托 |
| `Event` | **红** | 红色 = 委托引脚，接一个签名匹配的事件 |

红色引脚在蓝图里表示「函数引用」，相当于 C++ 里的 `&AMyClass::MyFunc`。从它拖出来再松开，UE 会直接生成一个**签名已经匹配好**的自定义事件，`New Health` 和 `Old Health` 这两个引脚会自动出现，因为签名是从宏里读取出来的。

> **绑定并不等于调用。** `Bind Event` 只是把「正在监听」这件事登记进去，它本身不执行任何血条逻辑。真正的执行发生在将来某一次 `Broadcast` 的时候。如果图连完了，运行时却没有反应，往往就是把 Bind 当成了 Call。

**`Event Construct`** 是 UMG 中表示「控件构建完成」的事件，它的地位相当于 Actor 的 `BeginPlay`。订阅只需要做一次，所以放在这里。

另外，蓝图的 `Bind Event` 在底层使用的是 **AddUnique** 语义，同一个对象的同一个事件重复绑定，不会叠加。

## 3.6 红蓝两种事件节点，别看混了

图里有两个都叫 `OnHealthChanged_事件` 的节点，但它们长得完全不一样，很容易让人以为是画重复了。

**红色的那个节点**上标着 `Custom Event`，`New Health` 和 `Old Health` 是它的**输出**引脚。它是**事件的定义**，也是这段逻辑的入口。

**蓝色的那个节点**上标着 `Target is Player Health WBP`，有 `Target(self)`、`New Health` 和 `Old Health` 三个**输入**引脚。它表示**对这个事件的一次调用**。

> **判别的方法是看引脚朝向哪一边，输出引脚在右侧的是定义，输入引脚在左侧的是调用。**

## 3.7 初始同步：事件驱动的先天空洞

这是本节在设计上最值得琢磨的地方，也是第二个事件节点存在的理由。

事件驱动有个天生的空洞：

> **血条只在血量「变化」时更新。游戏刚开始时，血量还没有变化过，于是在那一刻，血条显示的是设计器里留下的默认值 0.5，也就是半血。**

轮询版本没有这个问题，因为它在第一帧就会读取一次真实的值；而换成事件驱动之后，这个问题就出现了。

所以解决办法是，**在绑定完成之后，立刻手动调用一次那个自定义事件**，参数使用当前真实的血量，把 UI 拉到正确的状态。

```text
Event Construct
  → Cast To RoguePlayerCharacter
  → Bind Event to OnHealthChanged     ← 登记
  → 调用 OnHealthChanged 事件          ← 初始同步
       New Health = Attribute Set Health（当前真实值）
       Old Health = 0.0（占位）
```

这种模式叫作**初始同步（initial sync）**，任何事件驱动的 UI 都离不开它。以后做能量条、弹药数和 Buff 图标时，全都需要写这一步。

> 这里的 `Old Health = 0.0` 是**随意填写的**。现在还没有逻辑用到 `OldHealth`，所以没有关系；但是一旦加上了「`NewHealth < OldHealth` 时就闪红」这样的逻辑，这次初始调用就会被解读成「从 0 血被治疗到满血」，从而触发一次错误的绿光。更干净的做法是在初始调用时，把 Old 也填成当前的血量，表示「没有变化，只是同步」。

## 3.8 第三节结束时的问题

**① 委托签名少了"是谁"**

现在的 `(NewHealth, OldHealth)` 里没有任何身份信息。对于单个玩家的血条来说，这已经够用了；但是一旦同一个监听者要处理多个组件（比如一个管理器要同时监听所有敌人的血量），它收到通知之后，并不知道是谁掉了血。

在业界，这类委托通常还会带上发送者和伤害来源：

```cpp
DECLARE_DYNAMIC_MULTICAST_DELEGATE_FourParams(FOnHealthChanged,
    AActor*, InstigatorActor,                   // 谁造成的
    URogueActionSystemComponent*, OwningComp,   // 谁的血量变了
    float, NewHealth,
    float, Delta);                              // 变化量，而非旧值
```

`Delta` 比 `OldHealth` 更实用。无论是显示飘字的伤害数字，还是判断这次是治疗还是伤害，都可以直接使用 Delta，不需要每个监听者自己再减一遍。

> 这里的 `InstigatorActor` 和第四章 `SpawnActor` 的 `Instigator` 引脚是同一个概念，指的都是**伤害的归属**。在第四章里，不连接它会导致击杀播报是空白的；在这里，不带上它会导致监听者无法归因。

**② 血量仍未 Clamp，现在多了一层影响**

如果不做 Clamp，`NewHealth` 就会把负数广播出去，所有的监听者都得自己做防御。

**③ 血量没变也会广播**

`ApplyHealthChange(0)` 也会照样广播，UI 会白白刷新一次。

**④ 同一条数据链被求值了两次**

图里有两组 `Get Owning Player Pawn` 加 `Cast`，一组是 Construct 时的非纯 Cast（用于绑定），另一组是纯 Cast（用于在事件处理中获取 `Get Class`）。每次血量变化时，第二组都会重新执行一遍。

更干净的做法是，在 Construct 时把组件引用**提升为变量**保存起来，事件处理时直接读取它，同时把最大血量也一次性地计算好。

---

# 第四节：C++ 侧订阅与死亡处理

## 4.1 现在有两个监听者了

这一节让 `ARoguePlayerCharacter` 也订阅同一个委托，于是就有了两个监听者：

| 监听者 | 绑定位置 | 绑定方式 | 干什么 |
|---|---|---|---|
| `PlayerHealth_WBP` | 蓝图 `Event Construct` | `Bind Event` 节点 | 更新进度条 |
| `ARoguePlayerCharacter` | C++ `PostInitializeComponents` | `AddDynamic` | 死亡表现 |

组件对这两个监听者一无所知，它的头文件里既没有 UMG，也没有角色类。

**`DYNAMIC` 这个词的价值在这里得到了体现。** 正因为它走反射、按名字绑定，C++ 和蓝图才能挂在同一个委托上。如果换成普通的 `DECLARE_MULTICAST_DELEGATE`，蓝图那一半就根本接不上。3.2 节说 Dynamic 版本的「性能更差」，换来的就是这项能力。

## 4.2 `AddDynamic` 的双重身份

```cpp
ActionSystemComponent->OnHealthChanged.AddDynamic(this, &ARoguePlayerCharacter::OnHealthChanged);
```

`AddDynamic` **并不是函数，而是一个宏**。它大致会展开成下面这样：

```cpp
__Internal_AddDynamic(this, &ARoguePlayerCharacter::OnHealthChanged, TEXT("OnHealthChanged"));
//                    ─┬──  ─┬────────────────────────────────────   ─┬──────────────────
//                  监听者    函数指针（编译期类型检查）              函数名字符串（运行期查表）
```

需要注意，它把函数名**同时**当作指针和字符串来使用。这会带来一种非常违反直觉的错误分裂：

| 错误 | 什么时候炸 |
|---|---|
| **签名不匹配**（参数个数/类型不对） | **编译期报错**——因为函数指针是有类型的 |
| **忘记写 `UFUNCTION()`** | **运行期断言失败**——反射表里查不到这个名字 |

第二种情况才是真正的坑。代码编译得干干净净，可是一运行就崩溃，报错信息只说「找不到函数」，这和「明明写了这个函数」的印象完全对不上。

> **凡是要被 Dynamic 委托绑定的函数，都必须标记 `UFUNCTION()`。** 括号里可以什么都不写，它唯一的作用就是让 UHT 把这个函数登记进反射表。

```cpp
UFUNCTION()
void OnHealthChanged(float NewHealth, float OldHealth);
```

与它配套的还有两个宏。`AddDynamic` 的反面是 `RemoveDynamic`，另外还有 `AddUniqueDynamic`，它在重复绑定时不会叠加，相当于蓝图里 `Bind Event` 节点的行为。

## 4.3 为什么绑定要放在 `PostInitializeComponents`

这是本节最重要的架构问题。

![Actor 初始化顺序与委托绑定时机](/img/posts/ue5-ch5/ue5-ch5-init-order.svg)

**为什么不能在构造函数里绑？**

因为构造函数**也会为 CDO 执行一遍**。CDO 是「出厂模板」，并不是游戏里真实的实例。在构造函数里绑定，就等于给模板挂上了一个监听者，语义完全混乱了。而且这时组件虽然已经被 `CreateDefaultSubobject` 创建出来，但还没有注册到世界里，很多操作都是非法的。

**为什么不放 `BeginPlay`？**

放在 `BeginPlay` 里也能运行，但时机更晚。从 `PostInitializeComponents` 到 `BeginPlay` 之间存在一个窗口期，如果有别的系统在这段时间里造成了伤害，这次广播就会被漏掉。而且**不同 Actor 的 `BeginPlay` 之间没有顺序保证**，依靠它来做跨 Actor 的初始化，很容易遇到「自己执行 BeginPlay 时，对方还没有执行 BeginPlay」的情况。

> 第四章 3.3 节讨论「为什么事件分发器的登记必须放在 BeginPlay 里」时，得出的结论是「登记要早于广播」。这里是同一条原则更严格的版本，**能够更早，就应该更早**。

**所以凡是「Actor 和自身组件之间的接线」，标准的位置都是 `PostInitializeComponents`。**

```cpp
void ARoguePlayerCharacter::PostInitializeComponents()
{
    Super::PostInitializeComponents();   // 别漏
    ActionSystemComponent->OnHealthChanged.AddDynamic(this, &ARoguePlayerCharacter::OnHealthChanged);
}
```

如果漏掉了 `Super::`，就会破坏父类的初始化，这和第四章忘记连接 `Parent: Interact` 节点是同一类错误。

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

- **Clamp** 解决了血量掉到负数的问题（第一节的缺陷）；
- **`IsNearlyEqual` 守卫**解决了「值没有变化也广播」的问题（第三节的问题③）。

而且这两处修改合在一起，**还额外得到了一个很重要的性质，那就是死亡逻辑保证只会触发一次。**

下面来推演一下：

```text
血量 10，挨 100 伤害
  → Clamp(10-100, 0, 100) = 0
  → Old=10, New=0，不相等 → 广播 → 死亡触发 ✅

尸体再挨一发
  → Clamp(0-100, 0, 100) = 0
  → Old=0, New=0，相等 → 不广播 → 死亡不重复触发 ✅
```

如果没有守卫，尸体每中一枪，死亡动画就会重播一次。**像这样「两个看似无关的改动，顺带解决了第三个问题」的情况，是架构良好的信号。** 反过来说，如果每加一个功能都要额外补上一堆特判，就说明抽象的层次不对。

> 和第四章的宝箱对比一下，那里的重复触发需要依靠 `bChestOpened` 的双层守卫手动挡住；而这里因为「修改血量」只有一个入口，守卫写一次就能在全局生效。这就是第零节所说的「唯一入口」的价值。

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

浮点数不能用 `==` 来比较，比如 `0.1f + 0.2f != 0.3f`。血量经过多次加减之后会累积误差，可能停在 `0.0000001` 这样的值上。`IsNearlyZero` 使用 `KINDA_SMALL_NUMBER`（1e-4）作为容差。

> 这里其实有一点微妙。因为 Clamp 会把结果**精确地**设置成 `0.f`，所以在当前的实现下，`== 0.f` 反而是成立的。但依赖这种巧合并不是一个好习惯。

**`DisableInput` 和 `StopMovementImmediately` 是两件事**

`DisableInput` 会断掉**新的**输入，但角色身上的**速度**仍然存在。如果少了第二行，尸体就会滑出去一段距离，因为 CharacterMovement 会继续消化残余的 velocity。所以这两行必须成对出现。

`DisableInput(nullptr)` 里的 `nullptr` 表示「对所有的玩家控制器生效」。在单机游戏里这没有区别；而在分屏模式下，更精确的写法是传入 `Cast<APlayerController>(GetController())`。

**`PlayAnimMontage` 自带空指针检查**

它是 `ACharacter` 提供的一个便利封装，内部会先获取 Mesh 的 `AnimInstance`，再调用 `Montage_Play`。关键在于，**`DeathMontage` 没有赋值时，它会安安静静地返回 0，既不崩溃，也不报错，同时也不播放动画。**

> 所以「死亡动画不播放」最常见的原因根本不在代码里，而是 BP 类默认值里的那一栏是空的。这和第四章「`BlueprintImplementableEvent` 没有蓝图实现时，会静默地变成空操作」属于同一类静默失败。

## 4.6 `EditDefaultsOnly` 与说明符矩阵

```cpp
UPROPERTY(EditDefaultsOnly, Category = "Death")
TObjectPtr<UAnimMontage> DeathMontage;
```

编辑器可见性说明符其实可以排成一个 2×3 的矩阵：

|  | 蓝图类默认值面板 | 关卡中放置的实例 |
|---|---|---|
| `EditDefaultsOnly` | **可改** | 不显示 |
| `EditInstanceOnly` | 不显示 | **可改** |
| `EditAnywhere` | **可改** | **可改** |
| `VisibleDefaultsOnly` | 只读 | 不显示 |
| `VisibleInstanceOnly` | 不显示 | 只读 |
| `VisibleAnywhere` | 只读 | 只读 |

**为什么死亡蒙太奇选 `EditDefaultsOnly`？**

因为它是**类级别**的属性，所有的 `BP_PlayerCharacter` 都应该使用同一个死亡动画。如果使用 `EditAnywhere`，关卡美术人员不小心给场景里的某一个角色换了一个蒙太奇，这种 bug 排查起来会非常痛苦，因为代码和蓝图都是对的，错的只是那**一个实例**。

**用限制来换取正确性**，这是 UPROPERTY 说明符的核心思路。

## 4.7 `GetDefault<T>()` 的陷阱：蓝图版反而更对

```cpp
float MaxHealth = GetDefault<URogueActionSystemComponent>()->AttributeSet.health;   // ⚠️
```

`GetDefault<T>()` 等价于 `T::StaticClass()->GetDefaultObject<T>()`，也就是说，**它的类型在编译期就已经确定了**。

如果以后有人基于这个组件制作了一个蓝图子类 `BP_BossAttributeComp`，把默认血量改成了 500，那么这行代码读到的仍然是 C++ 基类里的 **100**。

正确的写法是从**实例的运行时类**中去获取：

```cpp
float MaxHealth = GetClass()->GetDefaultObject<URogueActionSystemComponent>()->AttributeSet.health;
```

**有意思的是，蓝图那边的写法反而是对的。** 控件里的 `Get Class` 是对**组件实例**调用的，所以拿到的是真实的运行时类。

| | 拿到的类 | 蓝图子类改了默认值 |
|---|---|---|
| C++ `GetDefault<T>()` | 编译期写死的 `T` | ❌ 读不到 |
| C++ `GetClass()->GetDefaultObject<T>()` | 实例的运行时类 | ✅ 读得到 |
| 蓝图 `Get Class` → `Get Class Defaults` | 实例的运行时类 | ✅ 读得到 |

> 目前这个 bug 还处于**潜伏**状态。`AttributeSet` 只有 `BlueprintReadOnly`，还无法在蓝图里修改默认值，所以子类也就做不出来。但迟早要给敌人配置不同的血量，到那时就必须加上 `EditDefaultsOnly`，**加上的那一刻，这个 bug 就会出现**。

## 4.8 有死亡"反应"，没有死亡"状态"

现在角色被禁用了输入，停止了移动，也播放了动画，但是**它并不知道自己已经死了**。这会带来下面这些后果：

- 如果以后加入复活或者治疗的功能，血量回到 50 时，`OnHealthChanged` 会正常广播，但 `IsNearlyZero` 为假，所以什么都不会做。于是**输入永远不会恢复**，角色就变成了一个只能被推着走的植物人；
- 死亡之后碰撞体仍然存在，会继续挡住子弹，也会继续触发重叠事件。

这是「事件驱动」中很容易掉进去的思维陷阱，**只处理了状态转变的那一刻，却忘了维护转变之后的状态。**

另外，「什么叫作死亡」现在是**由每个监听者自己来判断**的。角色里写了 `IsNearlyZero(NewHealth)`，以后 AI 要判断「低血量时逃跑」，又得自己再写一遍。**这个定义应该由组件来决定**：

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

把这一章的内容浓缩成四句话：

1. **横切的能力要做成组件**。血量不属于任何一条继承链，所以要使用组合，而不是继承。
2. **修改必须有唯一的入口**。`ApplyHealthChange` 是唯一修改血量的地方，所以钳制、守卫和广播都只需要写一遍。
3. **委托反转了依赖的方向**。组件不认识 UI，而是由 UI 主动订阅组件；一次广播，C++ 和蓝图能同时收到。
4. **事件驱动要配合初始同步**。只监听「变化」会漏掉「初始状态」，这是事件驱动先天的空洞。

关于蓝图，可以再浓缩成三条：

1. **蓝图里的每个节点都对应着一个 C++ 宏**，搜不到节点时，先回头检查说明符。
2. **白线是执行流，其余的线是数据流**，数据流不排队，在被下游拉取时才倒着求值。
3. **绑定并不等于调用**，`Bind Event` 只是登记，真正的执行发生在 `Broadcast` 的那一刻。

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

**它的优先级最高，因为修改之后行为完全不变，成本为零。**

```cpp
ActionSystemComponent->ApplyHealthChange(-ActualDamage);
```

如果现在不改，等到加了减伤系统之后才发现，就得回过头去排查一整条链。

## ② `GetDefault<T>()` 改为运行时类

```cpp
float MaxHealth = GetClass()->GetDefaultObject<URogueActionSystemComponent>()->AttributeSet.health;
```

这同样是一个「修改之后看不出区别」的修复，详见 4.7 节。

## ③ 死亡改为状态而非反应

由组件提供 `IsAlive()`，由角色维护 `bIsDead`，并在死亡时同时处理碰撞。否则，一旦加入复活功能，问题就会暴露出来。详见 4.8 节。

## ④ 委托签名补上身份与 Delta

```cpp
DECLARE_DYNAMIC_MULTICAST_DELEGATE_FourParams(FOnHealthChanged,
    AActor*, InstigatorActor,
    URogueActionSystemComponent*, OwningComp,
    float, NewHealth,
    float, Delta);
```

详见 3.8 节。在做敌人血条和飘字伤害数字之前，必须先完成这项修改。

## ⑤ 最大血量独立成字段

现在「初始血量」和「最大血量」是同一个数，所以做不了半血复活和上限提升。这项修改要配合 `EditDefaultsOnly` 一起进行，顺便解决「所有角色都是 100 血」的问题。

## ⑥ 初始同步的 `OldHealth` 别填 0

改成填写当前的血量，语义是「没有变化，只是同步」。详见 3.7 节。

## ⑦ 控件里缓存组件引用

在 Construct 时把组件和最大血量提升为变量，去掉重复的 `Get Owning Player Pawn` 加 `Cast`。详见 3.8 节的问题④。

## ⑧ `Create Widget` 补上 `Owning Player`

在 `BP_HUD` 里连接 `Get Player Owner`，同时把 `Return Value` 提升为变量，以便后续调用 `Remove from Parent`。详见 2.7 节。

## ⑨ 命名规范化

`float health` → `Health`，`ProgressBar_71` → `HealthBar`，`VisibleDefaultsOnly` 大小写，组件改 `VisibleAnywhere`。

> **需要注意**，给 `BlueprintAssignable` 属性改名会**断开蓝图里的 `Bind Event` 节点**，需要用第三章学过的 CoreRedirects 来补救。所以最好趁引用的地方还少的时候进行修改。

## ⑩ 清理调试日志

`UE_LOG` 现在每次调用都会打印（包括数值没有变化的情况），定稿之前要把它降级成 `Verbose`，或者直接删掉。

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
- [x] 勾选进度条的"**是变量**"
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
| "**是变量**" | UMG 设计器控件默认不生成成员变量，勾选后才能在图表里取到 |
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
