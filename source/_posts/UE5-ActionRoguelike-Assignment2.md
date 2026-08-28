---
title: UE5 C++ 作业二复盘：黑洞弹与传送弹，从旧账清理到弹丸基类
date: 2026-08-20 19:00:00
categories:
  - [课外, 游戏开发, UE5-Looman]
tags:
  - C++
  - ActionRoguelike
  - 继承与重构
  - 定时器(Timer)
  - RadialForce
  - Instigator
description: ActionRoguelike 课程 Assignment 2 的完整复盘。先清掉第三、四章遗留的七处崩溃级与逻辑级隐患，再抽出弹丸基类，实现具备引力吞噬的黑洞弹与两段计时的传送弹，最后用 FTimerDelegate 把三个技能的发射流程收口成一套。覆盖 UCLASS(Abstract)、PostInitializeComponents 绑定时机、TeleportTo 的 bNoCheck 陷阱、FTimerHandle 生命周期，以及 check / ensure / if 的选择标准。
cover: /img/covers/UE5-ActionRoguelike-Assignment2.svg
series: UE5 ActionRoguelike
privacy: protected
sitemap: false
private_section: 课外
---

# 前言

这是我跟随 Tom Looman 学习 UE5 C++ 时，对 **Assignment 2** 的完整复盘。

本次使用的开发环境：

- Unreal Engine `5.6.1`
- Rider
- Visual Studio 2022 Build Tools / MSVC 编译工具链
- 项目名称：`ActionRoguelike`

## 这次作业和作业一的区别

作业一是**从零造一个新东西**（爆炸桶），所有代码都是新写的，不需要动已有的类。

作业二是**在既有代码上长新功能**。它要新增两个技能，而这两个技能会：

- 用到第二章写的弹丸类（要抽基类）
- 用到第三章写的交互组件所在的角色/控制器（要加输入绑定）
- 大量销毁 Actor（会踩到第三章遗留的悬空指针问题）

所以这次真正的第一步不是写黑洞，而是**把前面欠的账还掉**。第一节整节都在做这件事，它不属于作业清单，但如果跳过，后面所有 bug 都要多排查一层。

## 作业原始需求

**准备级别**

- 将拉伸的立方体静态网格体（可以复制/粘贴墙壁）放置为地板，以避免在实现传送器投射物时与玩家发生传送/碰撞问题。
- 启用之前放置的三个方块的"生成重叠事件"，以确保黑洞弹丸能够与这些方块重叠并摧毁它们。

**黑洞弹丸**

- 从抛射体基类派生而来。
- 通过按键输入生成的投射物类（类似于魔法投射物）。按键绑定建议：鼠标右键、`Q` 或 `F`。
- `RadialForceComponent`，但使用连续的"力"（而不是冲量）来拉入 Actor。记住，我们需要将物体拉向组件，而不是远离组件（正/负力）。
- 你需要一个极其巨大的数字才能对立方体产生影响，想想几百万个数字吧。
- 使用 `SphereComponent` 在重叠时"销毁" Actor。
- 只能销毁"模拟"角色。
- 大约 5 秒后自行毁灭（这与粒子系统的持续时间一致）。
- 抛射体可以"穿过"世界上的一切，永远不会被其他物体阻挡。
- 玩家不应受到拉扯影响。忽略 `RadialForceComponent` 上的 `Pawn` 碰撞对象类型。
- 用于黑洞特效的粒子组件。

**冲刺/传送投射技能**

- 从抛射体基类派生而来。
- 通过按键输入生成投射物类（类似于魔法投射物）。
- 0.2 秒后"爆炸"（计时器）。
- 在爆炸点播放粒子特效。
- 再次等待 0.2 秒（计时器）后，传送玩家角色（即投射物的"发起者"）。让爆炸效果播放一会儿再传送，以便玩家可以看到。
- 等待期间，请确保"停止"抛射体的运动。
- 受到世界攻击时：执行相同的行为（爆炸 + 传送）。
- 粒子显示弹丸。

**分配资产**

| 资产 | 路径 |
| --- | --- |
| `NS_Gideon_Ultimate` | `tharlevfx_tutorials/CharacterFX/ParagonSourceAssets/Niagara/` |
| `NS_Gideon_Primary_Projectile` | 同上 |
| `NS_Portal_Teleport_Exit` | 同上 |
| `MI_PrototypeGrid_TopDark` | `LevelPrototyping/Materials/` |

**关于地形/景观几何形状的说明**

本次作业未使用地形，因此在使用 `TeleportTo` 时，地形不支持碰撞"穿透"。这意味着传送时可能会失败（函数返回 `false`）。虚幻引擎 5 自带的默认"开放世界"关卡会导致此问题。

**其他提示**

- `EnhancedInput` 可以通过 `BindAction` 轻松传递额外的参数，Timer 也可以通过 `FTimerDelegate` 实现。
- 对于传送弹，请使用 `Actor->TeleportTo(…)` 而不是直接设置 Actor 的位置。
- 我们漏掉了 `Abstract` 基类内部的 `UCLASS()`，你可以将其添加到你的新弹道类中。
- 看看我们之前用来忽略碰撞的 `Instigator`，在这里它可以用来进行传送。

## 最终效果

- 鼠标左键发射魔法弹（原有功能，行为不变）
- `Q` 发射黑洞弹：缓慢飞行、穿透一切、吸引周围物理方块并销毁、5 秒后消失、不影响玩家
- `F` 发射传送弹：0.2 秒后（或撞到东西时）爆炸并停在原地、再过 0.2 秒把角色传送过去
- 三个技能共用同一套发射流程，代码只有一份

---

## 目录

- [第一节：开工前的旧账清理](#第一节：开工前的旧账清理)
- [第二节：抽出弹丸基类](#第二节：抽出弹丸基类)
- [第三节：黑洞弹](#第三节：黑洞弹)
- [第四节：传送弹](#第四节：传送弹)
- [第五节：三个技能收口成一套](#第五节：三个技能收口成一套)
- [完整代码](#完整代码)
- [知识链路总览](#知识链路总览)
- [遗留待办](#遗留待办)
- [作业二完成检查清单](#作业二完成检查清单)
- [术语表](#术语表)
- [参考资料](#参考资料)

---

# 第一节：开工前的旧账清理

## 1.1 为什么必须先做这一步

第三、四章我一路记了一张"遗留待办"清单，当时判断都是"不影响跑通，以后再说"。

作业二让其中三条从"以后再说"变成了"现在必须做"，原因只有一个：**黑洞弹会大批量销毁 Actor**。

在此之前，我的关卡里没有任何东西会在运行时消失，所以"扫到的 Actor 一直存在"这个隐含假设从来没被打破过。黑洞一上线，假设立刻失效：

- 交互组件的 `SelectedActor` 可能指向一个已被黑洞销毁的方块
- `OverlapMultiByChannel` 返回的组件，其宿主 Actor 可能在同一帧被销毁

这两条都是空指针解引用，直接崩。

## 1.2 崩溃级：三处指针

### ① `Cast<UEnhancedInputComponent>` 未检查

```cpp
UEnhancedInputComponent* EnhancedInput = CastChecked<UEnhancedInputComponent>(InputComponent);
```

选 `CastChecked` 而不是 `Cast` + 判空，判断依据是：**这个条件为假时，程序还能不能正常工作？**

如果项目设置里的 Default Input Component Class 不是 `UEnhancedInputComponent`，那么优雅降级的结果是"游戏能启动，但一个按键都没反应"。这种 bug 排查起来能耗掉半天。所以这里要的不是降级，是**立刻崩**。

`CastChecked` 在 Shipping 构建里断言会被编译掉，退化成 `static_cast`。所以它保护的是**开发期**——这没问题，因为这类配置错误必然在开发期暴露。

### ② `GetPawn()` 未判空

交互组件挂在 `ARoguePlayerController` 上，而坐标在 Pawn 身上，所以必须走一次 `GetPawn()`：

```cpp
APlayerController* PC = CastChecked<APlayerController>(GetOwner());

APawn* MyPawn = PC->GetPawn();
if (MyPawn == nullptr)
{
    return;
}

FVector Center = MyPawn->GetActorLocation();
```

`TickComponent` 从组件注册那一刻就开始跑，而 `Possess` 是 GameMode 后续才做的；角色死亡到重生之间也有一段真空期。这两个时刻 `GetPawn()` 返回 `nullptr`。

**这里同一个函数里出现了两种相反的处理，值得对照记住**：

| 指针 | 为空意味着 | 处理 |
| --- | --- | --- |
| `GetOwner()` 不是 PlayerController | 程序结构错了 | `CastChecked`，立刻崩 |
| `GetPawn()` 为空 | 正常运行时状态 | 静默 `if` + `return` |

我中途走过一次弯路：一度把 `Center` 改成了 `GetOwner()->GetActorLocation()`，想省掉那次 `GetPawn()`。

**这行代码能编译、能运行、不崩，但结果是错的。** `AController` 确实是 `AActor`，有 Transform，但它的 `bAttachToPawn` 默认为 `false`——控制器的 Transform **不跟随** Pawn，它停在 GameMode 生成它时的位置，也就是世界原点附近。结果是交互检测球固定在世界原点，跟角色位置完全无关。

发现它只花了两秒，因为 Tick 里那行 `DrawDebugSphere` 画的就是 `Center`——白球没跟着角色，而是待在地图角落。**这是把中间状态可视化的探针第一次真正兑现价值。**

结论：**控制器是玩家意志的代理，没有身体。它的坐标是无意义的。**

### ③ `SelectedActor` 未判空

```cpp
void URogueInteractionComponent::Interact()
{
    if (SelectedActor == nullptr)
    {
        return;
    }

    if (SelectedActor->Implements<URogueInteractionInterface>())
    {
        IRogueInteractionInterface::Execute_Interact(SelectedActor);
    }
}
```

判断"该不该判空"最可靠的办法是**点进去看被调函数开头有没有 `check`**。UHT 生成的 `Execute_Interact` 长这样：

```cpp
static void Execute_Interact(UObject* O)
{
    check(O != nullptr);
    check(O->GetClass()->ImplementsInterface(URogueInteractionInterface::StaticClass()));
    UFunction* const Func = O->FindFunction(...);
    if (Func) { O->ProcessEvent(Func, &Parms); }
    else if (auto I = (IRogueInteractionInterface*)(O->GetNativeInterfaceAddress(...)))
    { I->Interact_Implementation(); }
}
```

两句 `check` 就是它的**前置条件**。外面这两个 `if` 一一对应地把这两个前置条件挡在门外。有几个 `check`，外面就该有几道守卫——这比背规则管用。

## 1.3 `check` / `ensure` / `if` 的选择标准

这一节写代码时我在这三者之间反复摇摆，最后收敛成一条标准：

> **这个条件为假，是"不该发生的事"，还是"正常会发生的事"？**

| 场景 | 是不是正常 | 该不该告诉我 | 写法 |
| --- | --- | --- | --- |
| InputComponent 类型不对 | 否，配置错了 | 该，且不该继续跑 | `CastChecked` |
| Pawn 还没被 Possess | 是，每局都发生 | 不该，纯噪音 | `if` + `return` |
| 玩家对着空气按 E | 是，每天几百次 | 不该 | `if` + `return` |
| 目标没实现交互接口 | 否，资产配错了 | 该，但不该崩 | `if (!ensure(...))` |

我一开始把 `SelectedActor` 的判空写成了 `ensure(SelectedActor);`，两个错误叠在一起：

**① `ensure` 不中断执行。** 它的语义是"检查、报告一次、**返回 bool 继续往下跑**"。所以它触发之后紧跟着还是会执行 `Execute_Interact(nullptr)`，然后被里面的 `check` 崩掉——想防的崩溃一次都没防住。正确用法是接住返回值：`if (!ensure(X)) { return; }`。

**② 这里根本不该用 `ensure`。** 玩家对着空气按 E 完全正常，而 `ensure` 在开发版本里会弹断言。测关卡时手贱按一下就吃一次。

`ensure` 默认整个进程只触发一次（`ensureAlways` 才每次都报），这个设计本身就说明它是给"稀有异常"准备的。

## 1.4 逻辑级：三处筛选

### ④ `SelectedActor` 每帧未重置

原来的写法是"循环里找到更好的就赋值"，没找到就保留上一帧的值。走开之后 `SelectedActor` 还指着那个方块，黑洞把它销毁之后就是悬空指针。

修法不是在 Tick 开头写 `SelectedActor = nullptr`，而是循环结束后**无条件赋值**：

```cpp
AActor* BestActor = nullptr;
// ... 循环里只更新 BestActor ...
SelectedActor = BestActor;
```

**能用一次无条件赋值解决的，不要用"先清空再有条件填充"**——后者有两个写入点，就有两倍的出错面。

### ⑤ `Overlap.GetActor()` 裸解引用

```cpp
AActor* OverlapActor = Overlap.GetActor();
if (OverlapActor == nullptr)
{
    continue;
}
```

重叠查询返回的是**组件**列表，`GetActor()` 是从组件反查宿主的弱引用解析，可以返回 `nullptr`。

注意这里用 `continue` 而不是 `return`：**一个候选无效不该终止整轮筛选**，后面可能还有合法目标。这和函数开头的 `return`（前提不成立，整件事做不了）是两种不同的语义。

顺带把两次 `GetActor()` 合并成一次缓存。

### ⑥ 点积没有阈值

```cpp
float HighestDotResult = 0.7f;   // 原来是 -1.0f
```

原来初始化成 `-1.0f`，意味着**任何方向都能通过**——正后方的点积正好是 `-1.0`，只要不是浮点意义上的精确相等，背后的宝箱也会被选中。改之前我特意先转身实测了一次，确认红框真的还在。

`0.7` 约等于 45° 半角。这里有个顺手的收益：**阈值和"取最大值"合并成了同一个机制**。低于 0.7 的候选连进入 `if` 的资格都没有，不需要额外写一句 `if (DotResult < Threshold) continue;`。用初始值编码约束，省一个分支，也省掉了"阈值和初始值不一致"这种未来的 bug。

### ⑦ `Implements<U>()` 校验

碰撞通道已经过滤过一轮，为什么代码还要再验一次？因为**碰撞通道和接口实现是两张互相独立、由人手工维护的表，引擎不做任何交叉校验**：

1. 美术在编辑器里给一个装饰物设了 `Interaction` 预设，但没实现接口——碰撞预设是运行时数据，编译器看不见。
2. 有人在蓝图的 Class Settings 里删掉了接口——同样不触发编译错误。
3. **通道在组件上，接口在 Actor 上。** 一个 Actor 挂十个组件，只要其中一个开了 Interaction 通道，这个 Actor 就进候选列表。第三章我把宝箱盖子设成 `NoCollision` 来避免重复计数，那是**内容层面的修补**，不是代码层面的保证。

概括一句：**碰撞通道是"谁能被扫到"的过滤器，不是"谁能被交互"的类型断言。**

注意模板参数是 **U 类**：

```cpp
SelectedActor->Implements<URogueInteractionInterface>()
```

只有 U 类进反射系统、有 `UClass` 和 `StaticClass()`，而 `Implements` 是查表操作。我第一次写成了 `Implements<IRogueInteractionInterface>`，编译不过。

**凡是"查表 / 路由"的场合一律用 U 类，凡是 C++ 继承链上的场合用 I 类。** 同一行代码里两个都会出现：`IRogueInteractionInterface::Execute_Interact` 用 I（那是静态成员函数），模板参数用 U。

也不能退回去用 `Cast<IRogueInteractionInterface>`——那是第四章修掉的 bug：纯蓝图实现的接口在 C++ 层没有 I 类实例，转型必然返回 `nullptr`。

## 1.5 一个附带发现：调试球写进了循环里

跑起来之后发现一个现象：周围没有可交互物时，那个白色调试球会消失，靠近才又出现。

原因是 `DrawDebugSphere` 被写进了 `for` 循环体内。`Overlaps` 为空 → 循环一次都不执行 → 球不画；同时捞到三个物体 → 球被重复画三遍。

**这个 bug 把探针的价值整个反转了。** 调试球存在的意义，就是让我在"什么都没发生"的时候还能看见检测范围——半径够不够、中心在不在角色身上。这些问题恰恰只在没捞到东西时才需要排查，而它偏偏在那个时候消失。

顺带说清楚这个球是什么：它**不是**碰撞体，不参与任何碰撞。`DrawDebugSphere` 只是往渲染器的调试线框列表里塞一组线段。真正做检测的是 `OverlapMultiByChannel`，那是一次瞬时查询，不留下任何东西。两者靠同一个 `Center` 和 `InteractionRadius` 保持一致，但代码上没有强制关系。

**调试可视化是"我以为我在算什么"的显示，不是"我实际在算什么"。两者对不上的时候，错的可能是任何一边。**

## 1.6 关卡准备

作业"准备级别"两条，加上一个作业没写但必须做的判断。

**判断关卡地面是不是 Landscape。** 作业提示说 UE5 自带的开放世界关卡会导致 `TeleportTo` 失败。我原来就在 `P_OpenWorldTestMap` 上，一度以为"我在平地上，避开有地形的地方就行"——**这个想法是错的：Open World 模板里整片地面就是一个 Landscape Actor，包括看起来完全平坦的部分。平不平是高度数据的事，跟几何体类型无关。**

验证方法：点一下要测试的地面，看大纲里选中的是什么。我这里显示的是 `LandscapeStreamingProxy_3_2_0`，确认是地形。

**铺一块拉伸立方体当地板。** 复制粘贴一面墙，缩放成 `X=40, Y=40, Z=0.5`（即 4000×4000×50），Z 抬高约 100 让它明确是独立的一层——贴太近，传送查询可能仍然摸到下面的地形。碰撞预设保持 `BlockAll`（`WorldStatic`），**不要开物理模拟**，否则黑洞会把地板吸走。

材质用作业指定的 `MI_PrototypeGrid_TopDark`。这一步别省：**网格纹理是判断传送落点偏了多少、偏在哪个方向的唯一参照。** 灰色平板上根本看不出位移。

**三个方块的设置。** 作业只写了"生成重叠事件"，实际要检查三项：

| 设置 | 值 | 为什么 |
| --- | --- | --- |
| 生成重叠事件 | 勾上 | 黑洞的 `SphereComponent` 靠它检测 |
| 模拟物理 | 开 | 黑洞要吸它们，静止 Actor 吸不动 |
| 对象类型 | `PhysicsBody` | `RadialForceComponent` 默认只影响这个类型 |

第三条作业没写但一定会咬人：物理开了、事件也勾了，ObjectType 不对照样吸不动。开了模拟物理后 UE 通常会自动把碰撞预设切成 `PhysicsActor`（对象类型即 `PhysicsBody`），没自动切就手动改。这跟作业一那个 `ObjectTypesToAffect` 的坑是同一个。

**顺带清掉一条 World Partition 警告。** 消息日志的"地图检测"里有一条：关卡蓝图引用了一个"空间加载"的 Actor（第四章那个 `BP_ProjectileSpammer`）。关卡蓝图属于持久关卡永远加载，而世界里的 Actor 是玩家走近才流送进来的，这是一条从"永远存在"指向"随时可能不存在"的硬引用。

它不阻止 PIE，但打包后引用可能解析成空，`StartSpawning` 静默不执行。**又是一个"不崩、不报错、就是不工作"。** 处理方式三选一：取消勾选该 Actor 的 `Is Spatially Loaded`、改用事件分发器让 Actor 自己持有引用、或者直接删掉这个练习产物。我选了最后一条。

---

# 第二节：抽出弹丸基类

## 2.1 问题

作业两处都写了"从抛射体基类派生"。看一眼第二章的 `ARogueProjectileMagic`，再看黑洞和传送弹的需求，三者共有的东西是：一个球形碰撞体、一个抛射物移动组件、一套飞行途中的循环特效与音效。

如果每个类各写一遍，改一处施法表现就要改三处。

## 2.2 执行顺序

这一步我按"**先建空基类 → 改继承 → 再搬成员**"三段走，每段编译一次。合并成一步做的话，出问题时分不清是继承关系的锅还是成员搬迁的锅。

## 2.3 搬哪些

判断依据是逐个成员问一句：**黑洞弹和传送弹也需要它吗？**

| 成员 | 去向 | 理由 |
| --- | --- | --- |
| `USphereComponent` | 基类 | 三者都要碰撞 |
| `UProjectileMovementComponent` | 基类 | 三者都要飞 |
| `UNiagaraComponent`（循环特效） | 基类 | 三者都有飞行表现 |
| `UAudioComponent`（循环音效） | 基类 | 同上 |
| 伤害数值 | 留在魔法弹 | 黑洞不造成伤害，传送弹也不 |

基类构造函数里顺带设了两个所有弹丸通用的默认值：

```cpp
ProjectileMovementComponent->InitialSpeed = 2000.f;
ProjectileMovementComponent->ProjectileGravityScale = 0.0f;   // 弹丸不受重力
```

子类想改（比如黑洞飞得更慢），在子类构造函数里直接改就行——基类构造已经跑完，指针有效。

## 2.4 组件名字符串是身份，不能随便改

```cpp
SphereComponent = CreateDefaultSubobject<USphereComponent>(TEXT("SphereComp"));
```

那个 `TEXT("SphereComp")` 是**组件的身份标识**。蓝图里对组件做的所有默认值覆盖（半径、Niagara 资产、碰撞预设）都是按这个名字挂上去的。

**搬到基类时，字符串和 `UPROPERTY` 变量名都必须一字不差。** 改一个字母，蓝图里的覆盖静默丢失——不报错，就是回到默认值。搬的时候要用复制粘贴，别手打。

我在黑洞类上就打错了一个：`TEXT("RadiaForceComp")`，少了个 `l`。现在改的话会丢掉 `BP_BlackHole` 里对 RadialForce 的所有覆盖值，所以暂时留着当记号，列进遗留待办。**别在有蓝图依赖之后随手改这类字符串。**

## 2.5 `UCLASS(Abstract)`

作业专门点名了这个说明符。它**不影响 C++ 编译**（那是 `= 0` 纯虚函数管的事），它管的是引擎的内容层：让这个类在类选择器、放置面板里消失，`SpawnActor` 也拒绝生成它。

为什么基类需要它：基类没有赋任何资产（Niagara 是空的、音效是空的），也没有具体行为，拖进关卡就是个隐形的、什么都不做的 Actor。`Abstract` 从源头杜绝这件事。

**我犯的错是把它顺手也加到了黑洞类上。** 黑洞是具体类，理应可以被直接生成。之所以一直没暴露，是因为 `ProjectileClass` 指向的是 `BP_BlackHole`，而**蓝图子类不继承 `Abstract`**。但如果哪天在 C++ 里直接 `SpawnActor<ARogueProjectileBlackhole>`，会静默返回 `nullptr`。

发现它的方式很朴素：传送弹是 `UCLASS()`，黑洞是 `UCLASS(Abstract)`——**两个平级的兄弟类标记不一致，这本身就是复制粘贴留下的痕迹。**

## 2.6 改完之后

打开 `BP_MagicProjectile` 确认能正常打开、变量还在。C++ 类的身份是"模块 + 类名"，只改父类不改类名的话不需要 CoreRedirects；如果顺手改了类名，第三章那套就得上场。

另外：**Live Coding 处理不了新增 UCLASS 和继承关系变更。** 这一步要关掉编辑器、在 Rider 里完整 Build、再重开编辑器。虽然慢，但比排查"为什么改了代码没生效"快得多。

**检查点：火球攻击行为完全不变**——飞行速度、命中特效、命中音效、伤害数值全部和重构前一样。重构的定义就是"改结构不改行为"，这一步没做到就不该往下走。

---

# 第三节：黑洞弹

## 3.1 需求逐条对应

| 需求 | 实现 |
| --- | --- |
| 从基类派生 | `: public ARogueProjectileBase` |
| 穿过世界上的一切 | `SetCollisionResponseToAllChannels(ECR_Overlap)` |
| 连续的"力"而非冲量 | `ForceStrength`（而非 `ImpulseStrength`）+ `SetAutoActivate(true)` |
| 拉向组件 | `ForceStrength` 取负值 |
| 极其巨大的数字 | `-2000000.f` |
| 玩家不受拉扯 | `RemoveObjectTypeToAffect(...ECC_Pawn)` |
| 重叠时销毁 Actor | `OnComponentBeginOverlap` → `Destroy()` |
| 只销毁"模拟"角色 | `OtherComp->IsSimulatingPhysics()` |
| 5 秒后自毁 | `SetLifeSpan(5.f)` |
| 黑洞特效 | 基类的 `LoopedNiagaraComponent` 在蓝图里赋 `NS_Gideon_Ultimate` |

## 3.2 和爆炸桶几乎全部相反

作业一的爆炸桶也用了 `URadialForceComponent`，但两者的配置是镜像的：

| | 爆炸桶 | 黑洞 |
| --- | --- | --- |
| 力的类型 | 冲量（一次性 `FireImpulse`） | 力（持续，每帧施加） |
| 强度符号 | 正（推开） | 负（吸引） |
| `bAutoActivate` | `false` | `true` |

持续力走的是组件 Tick 路径，所以必须激活；冲量走的是 `FireImpulse()` 主动调用路径，与激活状态无关。这是同一个组件的两条完全独立的路径，第一次接触时很容易混。

## 3.3 数量级

作业提示"想想几百万个数字吧"，我还是先按自己的直觉试了 `-2000`——方块纹丝不动，然后一路往上加到 `-2000000` 才有效果。

**这个弯路值得走一次。** 亲手体验"数量级错误"比直接抄一个数字记得牢。原因是 `ForceStrength` 走的是 `AddForce` 路径，力要先除以质量才变成加速度，而且是每帧施加、要克服重力和摩擦；`ImpulseStrength` 配合 `bImpulseVelChange = true` 则是直接改速度、跳过质量。所以爆炸桶的 `2500` 和黑洞的 `2000000` 不在一个尺度上——**它们根本不是同一种物理量。**

## 3.4 两个半径是两件事

`SphereComponent` 的半径管**重叠判定**（销毁），`RadialForceComponent` 的 `Radius` 管**吸力范围**。两者独立。

调错会出现两种症状：吸力范围小于碰撞球 → 方块还没被吸就已经被销毁了，看不到吸引过程；反过来则是"被吸过来但一直不消失"。

我设的是 `RadialForceComponent->Radius = 750.f`，明显大于球体半径，先看到吸引再看到销毁。

## 3.5 "只能销毁模拟角色"

这句是需求里最容易写错的一条。关键是判断依据挂在**组件**上而不是 Actor 上——物理模拟是 `UPrimitiveComponent` 的属性：

```cpp
if (OtherActor && OtherComp && OtherComp->IsSimulatingPhysics()
    && OtherActor != GetInstigator() && OtherActor != this)
{
    OtherActor->Destroy();
}
```

三个额外条件对应三个具体的失败场景：

- `IsSimulatingPhysics()` —— 不加会把地板、墙壁一起销毁，地图出现大洞
- `!= GetInstigator()` —— 不加会把玩家自己删掉
- `!= this` —— 不加，黑洞在某些情况下会自己删自己

顺带：`Destroy()` 是显式销毁并标记 pending kill，`!= nullptr` 判不出"正在销毁中"的对象。所以第一节那个 `SelectedActor` 更稳的写法其实是 `IsValid(SelectedActor)`，它同时检查空指针和 pending kill 标记。

## 3.6 `SetLifeSpan` 而不是自己起 Timer

```cpp
void ARogueProjectileBlackhole::BeginPlay()
{
    Super::BeginPlay();
    SetLifeSpan(5.f);
}
```

`AActor::SetLifeSpan` 内部就是一个定时器，到期调 `Destroy()`。自己写一遍没有任何收益。

**但要记住它的边界**：到期走的是 `Destroy()`，**不会**触发任何自定义的爆炸逻辑。黑洞不需要（消失就是它的终态），传送弹需要，所以传送弹用的是显式 `FTimerHandle`（见 4.2）。

## 3.7 `AddDynamic` 放在 `PostInitializeComponents`

```cpp
void ARogueProjectileBlackhole::PostInitializeComponents()
{
    Super::PostInitializeComponents();
    SphereComponent->OnComponentBeginOverlap.AddDynamic(this, &ARogueProjectileBlackhole::OnSphereOverlap);
}
```

不放构造函数的原因：构造函数运行在 CDO（类默认对象）创建时，绑定会被序列化进 CDO。`PostInitializeComponents` 是每个实例各绑各的，更干净。

`OnSphereOverlap` 必须加 `UFUNCTION()`。`AddDynamic` 是**动态多播委托**，靠反射系统按函数名查找，不标记就找不到——而且这个错误的形态是运行时才报，不是编译错误。

---

# 第四节：传送弹

## 4.1 时序设计

这是本次作业逻辑最复杂的部分。先把时序画出来再写代码：

```text
生成 ──[0.2s 定时器]──▶ Explode ──[0.2s 定时器]──▶ TeleportInstigator ──▶ Destroy
                            ▲
                            │
                     撞到世界时从这里进
```

两个 0.2 秒是**两个不同性质的等待**：

- 第一个决定"弹丸飞多远"
- 第二个是纯粹的视觉留白，让玩家看清爆炸再被传送

作业专门强调了第二条的理由："让爆炸效果播放一会儿再传送，以便玩家可以看到"。直接传送的话，打击感会整个消失。

## 4.2 为什么这里不能用 `SetLifeSpan`

3.6 说过：`SetLifeSpan` 到期走 `Destroy()`，不触发自定义逻辑。传送弹的第一段等待必须能调用 `Explode()`，所以只能用显式定时器：

```cpp
void ARogueProjectileTeleport::BeginPlay()
{
    Super::BeginPlay();
    GetWorldTimerManager().SetTimer(ExplodeTimer, this, &ARogueProjectileTeleport::Explode, 0.2f);
}
```

**这是"超时不生效"最高频的来源**：写 `SetLifeSpan` 然后奇怪为什么爆炸逻辑从来没跑过。要么重写 `LifeSpanExpired()`，要么就用定时器。

## 4.3 "受到世界攻击时执行相同行为"

这句话意味着 `Explode` 有**两个入口**：定时器到期，和命中事件。这正是把它做成一个独立函数（而不是写在回调里）的理由。

```cpp
void ARogueProjectileTeleport::OnActorHit(UPrimitiveComponent* HitComponent, AActor* OtherActor,
    UPrimitiveComponent* OtherComp, FVector NormalImpulse, const FHitResult& Hit)
{
    Explode();
}
```

**注意碰撞设置和黑洞相反**：黑洞是 `ECR_Overlap`（穿透一切），传送弹必须能被 `Block` 才会触发 `OnComponentHit`。全设成 Overlap 的话，弹丸直接穿墙而过，永远不触发爆炸。

```cpp
SphereComponent->SetCollisionProfileName("Projectile");
SphereComponent->IgnoreActorWhenMoving(GetInstigator(), true);
```

第二行是忽略发射者自身，否则弹丸第一帧就撞在角色胶囊体上原地爆炸。

**位置很关键**：这行必须在 `PostInitializeComponents` 里，不能在构造函数里。`Instigator` 是 `SpawnActor` 过程中在 `PostSpawnInitialize` 设置的，早于 `PostInitializeComponents`，但晚于构造函数——放构造函数里取到的是 `nullptr`。

## 4.4 停止运动要停两样

```cpp
void ARogueProjectileTeleport::Explode()
{
    GetWorldTimerManager().ClearTimer(ExplodeTimer);

    if (ProjectileMovementComponent)
    {
        ProjectileMovementComponent->StopMovementImmediately();
    }
    // ...
}
```

`ClearTimer` 挡住"撞墙之后定时器又炸一次"，`StopMovementImmediately` 让弹丸悬停在原地展示特效。

**这里的幂等保护其实不完整**：`ClearTimer` 挡不住"同一帧触发两次 Hit"。更彻底的做法是加一个 `bool bExploded` 守卫，或者在 `Explode()` 开头 `SetActorEnableCollision(false)`。这跟作业一爆炸桶那个 `bExploded` 是同一个模式，列进遗留待办。

## 4.5 爆炸特效必须是独立生成的

```cpp
UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, ExplosionEffect, GetActorLocation());
UGameplayStatics::PlaySoundAtLocation(this, ExplosionSound, GetActorLocation(), FRotator::ZeroRotator);
```

不能做成挂在弹丸上的组件。弹丸 0.2 秒后就 `Destroy()` 了，附着的组件跟着一起销毁，特效播一瞬就没。

这和作业一爆炸桶的"循环燃烧用组件、一次性爆炸用 `SpawnSystemAtLocation`"是同一条判断：**效果的生命周期是否需要超出宿主 Actor。**

## 4.6 `TeleportTo` 与我关掉的那个安全检查

```cpp
void ARogueProjectileTeleport::TeleportInstigator()
{
    AActor* InstigatorActor = GetInstigator();
    if (InstigatorActor)
    {
        const bool bSuccess = InstigatorActor->TeleportTo(
            GetActorLocation(), InstigatorActor->GetActorRotation());

        UE_LOG(LogTemp, Log, TEXT("TeleportTo: %s"), bSuccess ? TEXT("OK") : TEXT("FAILED"));
    }
    Destroy();
}
```

作业明确要求用 `TeleportTo` 而不是 `SetActorLocation`，理由是前者带碰撞检查，会在落点不合法时尝试寻找空位，防止玩家卡进墙里。

**我一度把这个收益自己关掉了。** 完整签名是：

```cpp
bool TeleportTo(const FVector& DestLocation, const FRotator& DestRotation,
                bool bIsATest = false, bool bNoCheck = false);
```

我最初写的是 `TeleportTo(..., false, true)`。`bNoCheck = true` 的含义是**跳过落点合法性检查**——不做 encroachment 查询、不尝试寻找空位、不管目标点是否被几何体占据，直接挪过去。

也就是说：我换了函数名，然后用第四个参数把那个函数存在的意义关掉了，行为退回到 `SetActorLocation`。

之所以会写成这样，是因为不加它传送经常失败，加了就"好了"。**这是个值得记住的模式：当一个参数让问题消失时，先搞清楚它关掉的是什么。**

改回 `false` 之后要配合那行 `UE_LOG`。`TeleportTo` 失败时是**静默返回 `false`**，不打任何日志。有了这行，"传送没反应"能立刻分成两种：

- 打了 `FAILED` → 几何体拒绝了落点，去看角色站在什么上面
- **什么都没打** → 这行代码压根没执行，问题在时序或定时器

**没有这行日志，这两种情况在屏幕上长得一模一样。** 这已经是本次作业里第三次遇到"不崩、不报错、就是不工作"了（前两次是 `GetOwner()` 取错坐标、调试球写进循环）。这类 bug 的通用解法就是**在关键分支上留一个可观测点**。

## 4.7 `Instigator`：作业提示指向的那个字段

作业提示说"看看我们之前用来忽略碰撞的 `Instigator`，在这里它可以用来进行传送"。

第二章设 `Instigator` 是为了让弹丸忽略发射者的碰撞；这次用它找回"该被传送的那个角色"。同一个字段，两种用途。

它和 `Owner` 的区别值得记牢：

| | `AActor::GetOwner()` | `AActor::GetInstigator()` |
| --- | --- | --- |
| 回答的问题 | 谁负责我 | 谁的行为造成了我 |
| 返回类型 | `AActor*` | `APawn*` |
| 主要用途 | 网络权限、所有权 | 伤害归属、行为溯源 |

注意 `GetInstigator()` 返回 `APawn*` 而不是 `AActor*`——**Instigator 在语义上只可能是 Pawn，类型直接把这件事说清楚了。** 这和第二节把 `TSubclassOf` 收窄到基类是同一条原则：用能满足需求的最合适的类型，类型本身在传递设计意图。

还要和组件上的同名函数区分开：`UActorComponent::GetOwner()` 问的是"我挂在哪个 Actor 上"，来自 Outer 链、构造时确定、实际上不会为空；`AActor::GetOwner()` 需要手动 `SetOwner`，经常是空的。同名不同义。

---

# 第五节：三个技能收口成一套

## 5.1 问题

第一版我图省事，三个技能各写了一对函数，一共六个：

```text
PrimaryAttack()   / AttackTimerElapsed()
BlackHoleAttack() / BlackHoleAttackTimerElapsed()
TeleportAttack()  / TeleportTimerElapsed()
```

三对之间是**逐字复制**的，只有两处不同：定时器回调的函数指针，和 `SpawnActor` 的类。

省下的是当时的十分钟。代价是：改施法特效要改三处、加冷却要改三处、加"施法期间不能移动"要改三处，漏一处就有一个技能行为不一致。

而作业提示专门点了 `FTimerDelegate` 和 `BindAction 传额外参数`——**这两条提示存在的唯一目的就是让人做这个重构。** 它不是额外要求，是作业的一部分。

## 5.2 先修一个真 bug：`FTimerHandle` 是局部变量

```cpp
void ARoguePlayerCharacter::BlackHoleAttack()
{
    FTimerHandle BlackHoleAttackTimerHandle;   // ← 局部变量
    // ...
    GetWorldTimerManager().SetTimer(BlackHoleAttackTimerHandle, ...);
}   // 函数返回，handle 析构
```

定时器本身注册在 `TimerManager` 里，所以回调**照样会执行**——这就是它当时"能跑"的原因。

但那个 handle 是**取消、查询、重置定时器的唯一凭据**，函数一返回就没了。后果：

- 快速连按技能键 → 每次注册一个新定时器，全部会触发 → 一次按键连发多个弹丸
- 角色在 0.2 秒窗口内被销毁 → 定时器照常触发，对着正在析构的对象调成员函数
- 想加打断、冷却、"施法中不能再施法" → 没有 handle，做不了

`FTimerHandle` 必须是成员变量。顺带 `const float AttackDelayTime = 0.2f;` 也是局部的、三处各写一遍，改成 `UPROPERTY(EditDefaultsOnly)`——这个值是要反复试手感的。

## 5.3 统一 `TSubclassOf` 的类型参数

原来三个类引用的类型各不相同：

```cpp
TSubclassOf<ARogueProjectileMagic>     ProjectileClass;
TSubclassOf<ARogueProjectileBlackhole> BlackHoleProjectileClass;
TSubclassOf<ARogueProjectileTeleport>  TeleportClass;
```

三个不同的类型，没法传给同一个函数。既然抽了基类，这里就该统一成 `TSubclassOf<ARogueProjectileBase>`——**这正是基类存在的意义之一**，而且蓝图里的下拉框仍然只会列出弹丸类，不会污染成全部 Actor。

类型收窄成父类是兼容的，改完打开 `BP_playerCharacter` 确认三个资产引用还在即可。

## 5.4 `FTimerDelegate::CreateUObject`

`SetTimer` 的常规重载只接受无参函数指针，没法把"生成哪个类"传进去。作业提示的 `FTimerDelegate` 就是解法：

```cpp
void ARoguePlayerCharacter::StartAttack(TSubclassOf<ARogueProjectileBase> InProjectileClass)
{
    PlayAnimMontage(AttackMontage);

    UNiagaraFunctionLibrary::SpawnSystemAttached(CastingEffect, GetMesh(), MuzzleSocketName,
        FVector::ZeroVector, FRotator::ZeroRotator, EAttachLocation::SnapToTarget, true);
    UGameplayStatics::PlaySound2D(this, CastingSound);

    FTimerDelegate Delegate = FTimerDelegate::CreateUObject(
        this, &ARoguePlayerCharacter::AttackTimerElapsed, InProjectileClass);

    GetWorldTimerManager().SetTimer(AttackTimerHandle, Delegate, AttackDelayTime, false);
}
```

`CreateUObject` 把 `this`、成员函数指针、以及**额外参数**一起打包，0.2 秒后连同参数一起调用。

**为什么不用 `CreateLambda`**：Lambda 版本也能捕获参数，但它**不检查对象是否还活着**。角色在那 0.2 秒里被销毁，Lambda 照样执行，访问已析构的 `this`。`CreateUObject` 内部存的是弱引用，对象没了 delegate 自动失效。

> **在 UE 里凡是延迟执行的回调，优先选带 UObject 生命周期检查的版本。**

三个技能共用一个 `AttackTimerHandle` 之后，语义也变对了：施法期间再按别的技能，`SetTimer` 覆盖前一个，等于打断重来。这通常正是想要的行为。

## 5.5 生成端

```cpp
void ARoguePlayerCharacter::AttackTimerElapsed(TSubclassOf<ARogueProjectileBase> InProjectileClass)
{
    if (!ensure(InProjectileClass)) { return; }

    FVector SpawnLocation = GetMesh()->GetSocketLocation(MuzzleSocketName);
    FRotator SpawnRotation = GetControlRotation();

    FActorSpawnParameters SpawnParams;
    SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
    SpawnParams.Instigator = this;

    GetWorld()->SpawnActor<ARogueProjectileBase>(InProjectileClass, SpawnLocation, SpawnRotation, SpawnParams);
}
```

几个点：

- `SpawnActor` 的模板参数用基类，它只影响返回值的静态类型，实际生成什么由 `InProjectileClass` 决定。
- `ensure` 用在这里是合适的：蓝图里忘了给某个技能赋类引用，属于"资产配错了，需要被告知"，符合 1.3 那张表的标准。
- `AlwaysSpawn` 是第四章遗留待办里的一条。默认的 `AdjustIfPossibleButAlwaysSpawn` 会在生成点被占据时悄悄挪动弹丸位置，从枪口发射时经常和角色胶囊体重叠，导致弹丸莫名偏移。
- `SpawnParams.Instigator = this` 是传送弹能找回"家"的前提，漏了它传送弹会静默不传送。

三个入口各剩一行，输入绑定完全不用改：

```cpp
void ARoguePlayerCharacter::PrimaryAttack()   { StartAttack(ProjectileClass); }
void ARoguePlayerCharacter::BlackHoleAttack() { StartAttack(BlackHoleProjectileClass); }
void ARoguePlayerCharacter::TeleportAttack()  { StartAttack(TeleportClass); }
```

六个函数变四个，重复代码从三份变成一份。

---

# 完整代码

## RogueProjectileBase.h

```cpp
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "RogueProjectileBase.generated.h"

class UProjectileMovementComponent;
class USphereComponent;
class UAudioComponent;
class UNiagaraComponent;

UCLASS(Abstract)
class ACTIONROGUELIKE_API ARogueProjectileBase : public AActor
{
    GENERATED_BODY()

protected:
    // 球体：根组件，负责碰撞与重叠判定
    UPROPERTY(EditDefaultsOnly, Category="Components")
    TObjectPtr<USphereComponent> SphereComponent;

    // 投射物移动
    UPROPERTY(EditDefaultsOnly, Category="Components")
    TObjectPtr<UProjectileMovementComponent> ProjectileMovementComponent;

    // 飞行过程中的循环粒子效果
    UPROPERTY(EditDefaultsOnly, Category="Components")
    TObjectPtr<UNiagaraComponent> LoopedNiagaraComponent;

    // 飞行过程中的循环声音效果
    UPROPERTY(EditDefaultsOnly, Category="Components")
    TObjectPtr<UAudioComponent> LoopedAudioComponent;

public:
    ARogueProjectileBase();
};
```

> 这四个组件用的是 `EditDefaultsOnly`，标准写法应为 `VisibleAnywhere`——组件指针本身不该被替换，需要编辑的是组件**内部**的属性。作业一的第 6 个坑就是这条，这次又回退了。见遗留待办。

## RogueProjectileBase.cpp

```cpp
#include "RogueProjectileBase.h"

#include "GameFramework/ProjectileMovementComponent.h"
#include "Components/SphereComponent.h"
#include "Components/AudioComponent.h"
#include "NiagaraComponent.h"

ARogueProjectileBase::ARogueProjectileBase()
{
    SphereComponent = CreateDefaultSubobject<USphereComponent>(TEXT("SphereComp"));
    RootComponent = SphereComponent;

    ProjectileMovementComponent =
        CreateDefaultSubobject<UProjectileMovementComponent>(TEXT("ProjectileMoveComp"));
    ProjectileMovementComponent->InitialSpeed = 2000.f;
    ProjectileMovementComponent->ProjectileGravityScale = 0.0f;

    LoopedNiagaraComponent = CreateDefaultSubobject<UNiagaraComponent>(TEXT("LoopedNiagaraComp"));
    LoopedNiagaraComponent->SetupAttachment(SphereComponent);

    LoopedAudioComponent = CreateDefaultSubobject<UAudioComponent>(TEXT("LoopedAudioComp"));
    LoopedAudioComponent->SetupAttachment(SphereComponent);
}
```

`ProjectileMovementComponent` 没有 `SetupAttachment`，因为 `UMovementComponent` 派生自 `UActorComponent` 而不是 `USceneComponent`——它没有 Transform，不参与组件树。这是第三章那条"`UActorComponent` vs `USceneComponent`"的直接应用。

## RogueProjectileBlackhole.h

```cpp
#pragma once

#include "CoreMinimal.h"
#include "RogueProjectileBase.h"
#include "RogueProjectileBlackhole.generated.h"

class URadialForceComponent;

UCLASS()
class ACTIONROGUELIKE_API ARogueProjectileBlackhole : public ARogueProjectileBase
{
    GENERATED_BODY()

protected:
    UPROPERTY(EditDefaultsOnly, Category="Components")
    TObjectPtr<URadialForceComponent> RadialForceComponent;

    virtual void BeginPlay() override;

public:
    ARogueProjectileBlackhole();

    virtual void PostInitializeComponents() override;

    UFUNCTION()
    void OnSphereOverlap(UPrimitiveComponent* OverlappedComponent, AActor* OtherActor,
                         UPrimitiveComponent* OtherComp, int32 OtherBodyIndex,
                         bool bFromSweep, const FHitResult& SweepResult);
};
```

## RogueProjectileBlackhole.cpp

```cpp
#include "RogueProjectileBlackhole.h"

#include "Components/SphereComponent.h"
#include "PhysicsEngine/RadialForceComponent.h"

ARogueProjectileBlackhole::ARogueProjectileBlackhole()
{
    // 需求：抛射体可以"穿过"世界上的一切
    SphereComponent->SetCollisionResponseToAllChannels(ECR_Overlap);

    RadialForceComponent = CreateDefaultSubobject<URadialForceComponent>(TEXT("RadiaForceComp"));
    RadialForceComponent->SetupAttachment(SphereComponent);

    // 需求：连续的"力"而非冲量 —— 走 Tick 路径，必须激活
    RadialForceComponent->SetAutoActivate(true);
    RadialForceComponent->Radius = 750.f;

    // 需求：拉向组件（负值）+ 极其巨大的数字
    RadialForceComponent->ForceStrength = -2000000.f;

    // 需求：玩家不应受到拉扯影响
    RadialForceComponent->RemoveObjectTypeToAffect(UEngineTypes::ConvertToObjectType(ECC_Pawn));
}

void ARogueProjectileBlackhole::BeginPlay()
{
    Super::BeginPlay();

    // 需求：大约 5 秒后自行毁灭
    SetLifeSpan(5.f);
}

void ARogueProjectileBlackhole::PostInitializeComponents()
{
    Super::PostInitializeComponents();

    SphereComponent->OnComponentBeginOverlap.AddDynamic(
        this, &ARogueProjectileBlackhole::OnSphereOverlap);
}

void ARogueProjectileBlackhole::OnSphereOverlap(UPrimitiveComponent* OverlappedComponent,
    AActor* OtherActor, UPrimitiveComponent* OtherComp, int32 OtherBodyIndex,
    bool bFromSweep, const FHitResult& SweepResult)
{
    // 需求：只能销毁"模拟"角色
    // IsSimulatingPhysics 是组件的属性，不是 Actor 的
    if (OtherActor && OtherComp && OtherComp->IsSimulatingPhysics()
        && OtherActor != GetInstigator()      // 不吞掉玩家
        && OtherActor != this)                // 不吞掉自己
    {
        OtherActor->Destroy();
    }
}
```

## RogueProjectileTeleport.h

```cpp
#pragma once

#include "CoreMinimal.h"
#include "RogueProjectileBase.h"
#include "RogueProjectileTeleport.generated.h"

class UNiagaraSystem;
class USoundBase;

UCLASS()
class ACTIONROGUELIKE_API ARogueProjectileTeleport : public ARogueProjectileBase
{
    GENERATED_BODY()

protected:
    UPROPERTY(EditDefaultsOnly, Category="Effects")
    TObjectPtr<UNiagaraSystem> ExplosionEffect;

    UPROPERTY(EditDefaultsOnly, Category="Sound")
    TObjectPtr<USoundBase> ExplosionSound;

    virtual void BeginPlay() override;

    void Explode();
    void TeleportInstigator();

    FTimerHandle ExplodeTimer;
    FTimerHandle TeleportTimer;

public:
    ARogueProjectileTeleport();

    virtual void PostInitializeComponents() override;

    UFUNCTION()
    virtual void OnActorHit(UPrimitiveComponent* HitComponent, AActor* OtherActor,
                            UPrimitiveComponent* OtherComp, FVector NormalImpulse,
                            const FHitResult& Hit);
};
```

## RogueProjectileTeleport.cpp

```cpp
#include "RogueProjectileTeleport.h"

#include "NiagaraFunctionLibrary.h"
#include "Components/SphereComponent.h"
#include "GameFramework/ProjectileMovementComponent.h"
#include "Kismet/GameplayStatics.h"

ARogueProjectileTeleport::ARogueProjectileTeleport()
{
    // 与黑洞相反：必须能被 Block，才会触发 OnComponentHit
    SphereComponent->SetCollisionProfileName("Projectile");
}

void ARogueProjectileTeleport::PostInitializeComponents()
{
    Super::PostInitializeComponents();

    SphereComponent->OnComponentHit.AddDynamic(this, &ARogueProjectileTeleport::OnActorHit);

    // Instigator 在 PostSpawnInitialize 设置，早于本函数、晚于构造函数
    SphereComponent->IgnoreActorWhenMoving(GetInstigator(), true);
}

void ARogueProjectileTeleport::BeginPlay()
{
    Super::BeginPlay();

    // 需求：0.2 秒后"爆炸"
    // 不能用 SetLifeSpan —— 它到期只 Destroy，不会调用 Explode
    GetWorldTimerManager().SetTimer(ExplodeTimer, this,
                                    &ARogueProjectileTeleport::Explode, 0.2f);
}

// 需求：受到世界攻击时，执行相同的行为
void ARogueProjectileTeleport::OnActorHit(UPrimitiveComponent* HitComponent, AActor* OtherActor,
    UPrimitiveComponent* OtherComp, FVector NormalImpulse, const FHitResult& Hit)
{
    Explode();
}

void ARogueProjectileTeleport::Explode()
{
    // 防止撞墙之后定时器又触发一次
    GetWorldTimerManager().ClearTimer(ExplodeTimer);

    // 需求：等待期间"停止"抛射体的运动
    if (ProjectileMovementComponent)
    {
        ProjectileMovementComponent->StopMovementImmediately();
    }

    // 需求：在爆炸点播放粒子特效
    // 用独立生成而非组件 —— 弹丸马上要 Destroy，附着的组件会跟着消失
    UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, ExplosionEffect, GetActorLocation());
    UGameplayStatics::PlaySoundAtLocation(this, ExplosionSound,
                                          GetActorLocation(), FRotator::ZeroRotator);

    // 需求：再次等待 0.2 秒后传送，给视觉留白
    GetWorldTimerManager().SetTimer(TeleportTimer, this,
                                    &ARogueProjectileTeleport::TeleportInstigator, 0.2f);
}

void ARogueProjectileTeleport::TeleportInstigator()
{
    AActor* InstigatorActor = GetInstigator();
    if (InstigatorActor)
    {
        // 用两参数版本：bNoCheck 保持默认 false，保留落点合法性检查
        const bool bSuccess = InstigatorActor->TeleportTo(
            GetActorLocation(), InstigatorActor->GetActorRotation());

        // TeleportTo 失败时静默返回 false，必须自己留可观测点
        UE_LOG(LogTemp, Log, TEXT("TeleportTo: %s"), bSuccess ? TEXT("OK") : TEXT("FAILED"));
    }

    Destroy();
}
```

## RoguePlayerCharacter.h（攻击相关部分）

```cpp
protected:
    // ---------- 三个技能的弹丸类，统一用基类做类型参数 ----------
    UPROPERTY(EditDefaultsOnly, Category="Attack")
    TSubclassOf<ARogueProjectileBase> ProjectileClass;

    UPROPERTY(EditDefaultsOnly, Category="Attack")
    TSubclassOf<ARogueProjectileBase> BlackHoleProjectileClass;

    UPROPERTY(EditDefaultsOnly, Category="Attack")
    TSubclassOf<ARogueProjectileBase> TeleportClass;

    // ---------- 共用配置 ----------
    UPROPERTY(EditDefaultsOnly, Category="Attack")
    float AttackDelayTime = 0.2f;

    UPROPERTY(EditDefaultsOnly, Category="Attack")
    FName MuzzleSocketName;

    UPROPERTY(EditDefaultsOnly, Category="Attack")
    TObjectPtr<UAnimMontage> AttackMontage;

    UPROPERTY(EditDefaultsOnly, Category="Attack")
    TObjectPtr<UNiagaraSystem> CastingEffect;

    UPROPERTY(EditDefaultsOnly, Category="Attack")
    TObjectPtr<USoundBase> CastingSound;

    // ---------- 运行时状态：三个技能共用一个 handle ----------
    FTimerHandle AttackTimerHandle;

    // ---------- 函数 ----------
    void StartAttack(TSubclassOf<ARogueProjectileBase> InProjectileClass);
    void AttackTimerElapsed(TSubclassOf<ARogueProjectileBase> InProjectileClass);

    void PrimaryAttack();
    void BlackHoleAttack();
    void TeleportAttack();
```

## RoguePlayerCharacter.cpp（攻击相关部分）

```cpp
void ARoguePlayerCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);

    UEnhancedInputComponent* EnhancedInput = CastChecked<UEnhancedInputComponent>(PlayerInputComponent);

    // ...第一章、第二章、作业一的绑定...

    EnhancedInput->BindAction(Input_PrimaryAttack,   ETriggerEvent::Triggered, this,
                              &ARoguePlayerCharacter::PrimaryAttack);
    EnhancedInput->BindAction(Input_BlackHoleAttack, ETriggerEvent::Triggered, this,
                              &ARoguePlayerCharacter::BlackHoleAttack);
    EnhancedInput->BindAction(Input_Teleport,        ETriggerEvent::Triggered, this,
                              &ARoguePlayerCharacter::TeleportAttack);
}

// ---------- 三个入口各一行 ----------

void ARoguePlayerCharacter::PrimaryAttack()
{
    StartAttack(ProjectileClass);
}

void ARoguePlayerCharacter::BlackHoleAttack()
{
    StartAttack(BlackHoleProjectileClass);
}

void ARoguePlayerCharacter::TeleportAttack()
{
    StartAttack(TeleportClass);
}

// ---------- 唯一的施法准备实现 ----------

void ARoguePlayerCharacter::StartAttack(TSubclassOf<ARogueProjectileBase> InProjectileClass)
{
    PlayAnimMontage(AttackMontage);

    UNiagaraFunctionLibrary::SpawnSystemAttached(CastingEffect, GetMesh(), MuzzleSocketName,
        FVector::ZeroVector, FRotator::ZeroRotator, EAttachLocation::SnapToTarget, true);

    UGameplayStatics::PlaySound2D(this, CastingSound);

    // FTimerDelegate 把额外参数一起打包
    // CreateUObject 带弱引用检查：角色销毁后 delegate 自动失效
    FTimerDelegate Delegate = FTimerDelegate::CreateUObject(
        this, &ARoguePlayerCharacter::AttackTimerElapsed, InProjectileClass);

    GetWorldTimerManager().SetTimer(AttackTimerHandle, Delegate, AttackDelayTime, false);
}

// ---------- 唯一的发射实现 ----------

void ARoguePlayerCharacter::AttackTimerElapsed(TSubclassOf<ARogueProjectileBase> InProjectileClass)
{
    // 蓝图里忘了赋值就是这里 —— 属于"资产配错了，需要被告知"
    if (!ensure(InProjectileClass))
    {
        return;
    }

    FVector  SpawnLocation = GetMesh()->GetSocketLocation(MuzzleSocketName);
    FRotator SpawnRotation = GetControlRotation();

    FActorSpawnParameters SpawnParams;
    // 不允许引擎悄悄挪动生成点
    SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
    // 传送弹靠这个字段找回要传送的角色
    SpawnParams.Instigator = this;

    GetWorld()->SpawnActor<ARogueProjectileBase>(
        InProjectileClass, SpawnLocation, SpawnRotation, SpawnParams);
}
```

## RogueInteractionComponent.cpp（第一节修复后）

```cpp
void URogueInteractionComponent::TickComponent(float DeltaTime, ELevelTick TickType,
                                               FActorComponentTickFunction* ThisTickFunction)
{
    Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

    // 本组件按设计只挂在 PlayerController 上，挂错 = 程序结构错误 → 立刻崩
    APlayerController* PC = CastChecked<APlayerController>(GetOwner());

    // Possess 之前、死亡到重生之间为空 —— 正常状态，静默返回
    APawn* MyPawn = PC->GetPawn();
    if (MyPawn == nullptr)
    {
        return;
    }

    // 坐标来自 Pawn，不是 Controller（Controller 的 Transform 不跟随 Pawn）
    FVector Center = MyPawn->GetActorLocation();

    TArray<FOverlapResult> Overlaps;
    FCollisionShape Shape;
    Shape.SetSphere(InteractionRadius);
    GetWorld()->OverlapMultiByChannel(Overlaps, Center, FQuat::Identity,
                                      COLLISION_INTERACTION, Shape);

    AActor* BestActor = nullptr;
    // 初始值即阈值：低于 0.7（约 45° 半角）的候选连参与比较的资格都没有
    float HighestDotResult = 0.7f;

    for (const FOverlapResult& Overlap : Overlaps)
    {
        // 弱引用解析可能失败；一个候选无效不该终止整轮筛选 → continue 而非 return
        AActor* OverlapActor = Overlap.GetActor();
        if (OverlapActor == nullptr)
        {
            continue;
        }

        FVector OverlapLocation  = OverlapActor->GetActorLocation();
        FVector OverlapDirection = (OverlapLocation - Center).GetSafeNormal();

        float DotResult = FVector::DotProduct(PC->GetControlRotation().Vector(), OverlapDirection);

        if (DotResult > HighestDotResult)
        {
            BestActor        = OverlapActor;
            HighestDotResult = DotResult;
        }

        FString DebugString = FString::Printf(TEXT("Dot: %f"), DotResult);
        DrawDebugBox(GetWorld(), OverlapLocation, FVector(50.f), FColor::Red);
        DrawDebugString(GetWorld(), OverlapLocation, DebugString, nullptr, FColor::White, 0.f, true);
    }

    // 必须在循环外：否则周围没东西时看不到检测范围
    DrawDebugSphere(GetWorld(), Center, InteractionRadius, 32, FColor::White);

    // 无条件赋值：一个写入点，不存在"某条分支忘了重置"
    SelectedActor = BestActor;

    if (SelectedActor)
    {
        DrawDebugBox(GetWorld(), SelectedActor->GetActorLocation(), FVector(60.f), FColor::Green);
    }
}

void URogueInteractionComponent::Interact()
{
    // Execute_Interact 内部第一句是 check(O != nullptr)
    if (SelectedActor == nullptr)
    {
        return;
    }

    // 第二句 check 是 ImplementsInterface —— 碰撞通道过滤不等于类型断言
    // 模板参数必须是 U 类：只有它在反射系统里有 UClass
    if (SelectedActor->Implements<URogueInteractionInterface>())
    {
        IRogueInteractionInterface::Execute_Interact(SelectedActor);
    }
}
```

---

# 知识链路总览

## 主线一：类型选择在传递设计意图

这次有四处都在做同一件事——**用能满足需求的最合适的类型**：

| 位置 | 选择 | 传达的意图 |
| --- | --- | --- |
| `CastChecked<APlayerController>` 而非 `AController` | 收窄 | 这个组件只服务于玩家 |
| `TSubclassOf<ARogueProjectileBase>` 而非 `TSubclassOf<AActor>` | 收窄 | 只能填弹丸类 |
| 交互组件里用 `APlayerController` 而非 `ARoguePlayerController` | 放宽 | 不需要知道具体型号，可复用 |
| `GetInstigator()` 返回 `APawn*` 而非 `AActor*` | 引擎的选择 | Instigator 语义上只可能是 Pawn |

放宽和收窄不矛盾，标准是同一条：**恰好覆盖需求，不多不少。** 多了限制复用（低层模块认识高层模块），少了丢失约束（蓝图下拉框里出现一堆不该选的东西）。

## 主线二：静态类型只是"看这块内存的窗口"

`GetOwner()` 返回 `AActor*`，却能转成 `APlayerController*`，因为那块内存里的对象**本来就是**一个 `ARoguePlayerController`。

派生类对象在内存里的布局是基类部分放在起始位置，所以两个指针存的是**完全相同的地址**，转型在机器层面可能连一条指令都不产生。变的只是编译器允许你调用什么。

`Cast` 的验证机制走的是反射系统：拿到实际对象的 `UClass`，沿 `SuperStruct` 链往上找目标类。UE 不用标准的 `dynamic_cast`，三个原因：项目默认关闭 RTTI、遍历 `SuperStruct` 更快、**蓝图类在编译期不存在**，RTTI 里根本没有它们的条目。

第三条也解释了为什么 `Cast<IRogueInteractionInterface>` 找不到纯蓝图实现——**编译期类型系统看不见蓝图**，这是同一个根源的两种表现。

## 主线三：同一个组件的两条独立路径

`URadialForceComponent` 在作业一和作业二里的用法完全相反：

```text
冲量路径   FireImpulse() 主动调用   一次性   与 bAutoActivate 无关   爆炸桶
力路径     组件 Tick 自动执行       持续     必须 bAutoActivate      黑洞
```

`ImpulseStrength` 配合 `bImpulseVelChange = true` 直接改速度、跳过质量；`ForceStrength` 走 `AddForce`，要除以质量、要克服重力和摩擦、每帧施加。所以 `2500` 和 `2000000` 不在一个尺度上——**它们不是同一种物理量。**

## 主线四：静默失败的形态

这次遇到的三个"不崩、不报错、就是不工作"：

| 现象 | 静默原因 | 怎么发现的 |
| --- | --- | --- |
| 交互检测球固定在世界原点 | `GetOwner()` 是 Controller，其 Transform 不跟随 Pawn | DrawDebugSphere 没跟着角色 |
| 周围没东西时看不到检测范围 | `DrawDebugSphere` 写进了 for 循环 | 移动时观察到球时有时无 |
| 传送落点不合法但仍然传送 | `bNoCheck = true` 关掉了落点检查 | 对照函数签名逐个参数核对 |

**通用解法只有一条：在关键分支上留可观测点。** 一行 `UE_LOG` 或一个 debug 绘制，能把排查范围砍掉一半。而且要注意：**可视化探针本身也可能是错的**（第二条就是探针自己坏了），所以它和被观测的逻辑要尽量解耦。

## 主线五：延迟执行的三种写法

这次一共出现了三种"等一会儿再做"：

| 写法 | 到期行为 | 能否取消 | 用在 |
| --- | --- | --- | --- |
| `SetLifeSpan(5.f)` | 只 `Destroy()` | 可以（再次 SetLifeSpan） | 黑洞自毁 |
| `SetTimer(Handle, this, &Func, T)` | 调用无参成员函数 | 可以 | 传送弹两段计时 |
| `SetTimer(Handle, FTimerDelegate, T)` | 调用带参函数 | 可以 | 三技能共用发射 |

选择依据：**到期时需不需要跑自己的逻辑**（需要 → 不能用 `SetLifeSpan`），以及**需不需要传参**（需要 → `FTimerDelegate`）。

`FTimerHandle` 必须是成员变量，否则失去取消/查询能力。`FTimerDelegate` 优先用 `CreateUObject` 而不是 `CreateLambda`，因为前者带弱引用检查。

---

# 遗留待办

### ① 组件的 `UPROPERTY` 改成 `VisibleAnywhere`

现在基类四个组件和黑洞的 `RadialForceComponent` 用的都是 `EditDefaultsOnly`。标准写法是 `VisibleAnywhere`：组件指针本身不该被替换，需要编辑的是组件**内部**的属性。

作业一的第 6 个坑就是这一条，这次又回退了。**说明当时只记住了"改成什么"，没记住"为什么"。**

### ② `TEXT("RadiaForceComp")` 拼写

少了一个 `l`。现在改会丢掉 `BP_BlackHole` 里对 RadialForce 的所有覆盖值，需要改完重新配一遍数值。

### ③ 把 `Explode()` 提到基类做成 `BlueprintNativeEvent`

现在三个弹丸的"炸掉"逻辑各写各的，传送弹的 `Explode()` 既不是 `virtual` 也不是 `BlueprintNativeEvent`——基类和蓝图都碰不到。

提到基类之后：基类给默认实现（播特效 + `Destroy`），子类各自覆盖，蓝图侧也能改表现，不用回来动 C++。第四章刚学的东西在这里能派上用场。

### ④ 传送弹的幂等保护做彻底

`ClearTimer` 挡不住同一帧触发两次 `Hit`。加 `bool bExploded` 守卫，或在 `Explode()` 开头 `SetActorEnableCollision(false)`。

参照作业一爆炸桶的 `bExploded` 模式。

### ⑤ 传送落点补胶囊半高

角色胶囊半高是 88，而弹丸中心离地可能只有几十单位。`TeleportTo` 打开检查后会自己往上找空位，但给它一个合理的起点成功率会高很多。

### ⑥ `bDrawDebug` 开关

交互组件里的三个 debug 绘制 + 每帧构造的 `FString::Printf` 应该收进一个 `UPROPERTY(EditAnywhere) bool bDrawDebug`。弹丸满天飞的时候屏幕上挂着白球、红框、点积文字会很吵。

更进阶的做法是用 `TAutoConsoleVariable`，运行时敲命令切换。

### ⑦ `Interact()` 改名 `PrimaryInteract()`

现在这条调用链上有三个同名 `Interact`：PlayerController 的输入回调、组件的方法、接口的函数。同一个函数体里会同时出现 `URogueInteractionComponent::Interact` 和 `Execute_Interact`。

### ⑧ 交互接口加 `InstigatorPawn` 参数

改接口签名会连带改所有实现类和调用点。课程后面讲 Action 系统时会自然需要它，那时一起改。

### ⑨ 交互评分加距离权重

现在只看角度不看距离，远处正对着的会赢过近处偏一点的。这是手感优化不是 bug，做的时候要处理"角度和距离怎么加权"的调参问题。

### ⑩ 用 `BindAction` 传参的另一条路

作业提示给了两条路，我选了 `FTimerDelegate`。另一条是在 `BindAction` 时就把弹丸类作为额外参数传进来，那样连三个一行的入口函数都能省掉。值得试一次做对比。

---

# 作业二完成检查清单

## 阶段 0：旧账清理

- [x] `Cast<UEnhancedInputComponent>` 改 `CastChecked`
- [x] `PC->GetPawn()` 缓存 + 判空，坐标取自 Pawn 而非 Controller
- [x] `SelectedActor` 调 `Execute_Interact` 前判空
- [x] `SelectedActor` 改为循环后无条件赋值
- [x] `Overlap.GetActor()` 缓存 + `continue`
- [x] `Execute_Interact` 前加 `Implements<URogueInteractionInterface>()`
- [x] 点积初始值从 `-1.0f` 改为 `0.7f`（改之前先转身实测确认 bug 存在）
- [x] `DrawDebugSphere` 移出 for 循环

## 阶段 0：关卡准备

- [x] 确认原地面是 `LandscapeStreamingProxy`
- [x] 铺拉伸立方体地板，`BlockAll` / `WorldStatic`，不开物理模拟
- [x] 地板材质用 `MI_PrototypeGrid_TopDark`
- [x] 三个方块：生成重叠事件 + 模拟物理 + ObjectType 为 `PhysicsBody`
- [x] World Partition 地图检测警告清零

## 阶段 1：基类

- [x] `ARogueProjectileBase` 标 `UCLASS(Abstract)`
- [x] 四个共有组件上提，组件名字符串与变量名逐字不变
- [x] `ARogueProjectileMagic` 改继承基类，删除重复成员
- [x] `BP_MagicProjectile` 能正常打开，变量未丢失
- [x] **火球攻击行为完全不变**
- [x] 关闭编辑器完整 Build（Live Coding 处理不了继承变更）

## 阶段 2：发射流程收口

- [x] 三个 `TSubclassOf` 统一为 `ARogueProjectileBase`
- [x] `FTimerHandle` 从局部变量提为成员变量
- [x] `AttackDelayTime` 提为 `UPROPERTY(EditDefaultsOnly)`
- [x] 用 `FTimerDelegate::CreateUObject` 传递弹丸类
- [x] 六个函数收敛为一套 `StartAttack` + `AttackTimerElapsed`
- [x] `SpawnParams.Instigator = this`
- [x] `SpawnCollisionHandlingOverride = AlwaysSpawn`

## 阶段 3：黑洞弹

- [x] 从基类派生，`UCLASS()` 不带 `Abstract`
- [x] `SetCollisionResponseToAllChannels(ECR_Overlap)`
- [x] `ForceStrength` 为负、量级百万、`SetAutoActivate(true)`
- [x] `RemoveObjectTypeToAffect(...ECC_Pawn)`
- [x] `RadialForce` 的 `Radius` 大于球体半径
- [x] 重叠销毁带 `IsSimulatingPhysics()` / `!= GetInstigator()` / `!= this` 三重过滤
- [x] `SetLifeSpan(5.f)`
- [x] `OnSphereOverlap` 带 `UFUNCTION()`，绑定在 `PostInitializeComponents`
- [x] 蓝图里赋 `NS_Gideon_Ultimate`

## 阶段 4：传送弹

- [x] 从基类派生
- [x] 碰撞用 `Projectile` 预设（能被 Block）
- [x] `IgnoreActorWhenMoving(GetInstigator(), true)` 放在 `PostInitializeComponents`
- [x] `BeginPlay` 起 0.2 秒 `ExplodeTimer`（不是 `SetLifeSpan`）
- [x] `Explode` 里 `ClearTimer` + `StopMovementImmediately`
- [x] 爆炸特效用 `SpawnSystemAtLocation` 而非组件
- [x] 第二段 0.2 秒 `TeleportTimer`
- [x] `TeleportTo` 不传 `bNoCheck = true`
- [x] 加 `UE_LOG` 观测 `TeleportTo` 返回值
- [x] 蓝图里赋 `NS_Gideon_Primary_Projectile` / `NS_Portal_Teleport_Exit`

## 运行验证

- [x] 三个技能都能正常发射
- [x] 连按同一个技能键不会连发
- [x] 黑洞能吸引方块
- [x] 黑洞能销毁方块，且不销毁地板与墙壁
- [x] 黑洞不影响玩家
- [x] 黑洞 5 秒后消失
- [x] 黑洞穿过墙壁不被阻挡
- [x] 传送弹命中墙壁后能传送
- [x] 传送弹超时（打向空中）也能传送
- [x] `TeleportTo` 日志打印 `OK`
- [x] 交互功能（宝箱、拉杆）在新地板上正常
- [x] 转身背对宝箱时不再被选中

---

# 术语表

| 术语 | 含义 |
| --- | --- |
| **`UCLASS(Abstract)`** | 内容层标记，禁止该类被放置到关卡或直接 `SpawnActor`；不影响 C++ 编译，蓝图子类不继承 |
| **`CreateDefaultSubobject` 的名字字符串** | 组件的身份标识，蓝图的默认值覆盖按它挂载；改动会静默丢失覆盖 |
| **`PostInitializeComponents`** | 组件全部注册完成、`BeginPlay` 之前调用；`Instigator` 此时已设置，是绑定委托的推荐位置 |
| **CDO（类默认对象）** | 每个 UClass 的模板实例，构造函数在此运行，因此构造函数里的绑定会被序列化 |
| **`AddDynamic`** | 动态多播委托的绑定方式，靠反射按函数名查找，目标函数必须标 `UFUNCTION()` |
| **`SetLifeSpan`** | Actor 内置的自毁定时器，到期只调 `Destroy()`，不触发自定义逻辑 |
| **`FTimerDelegate`** | 可携带参数的定时器回调载体，`CreateUObject` 版本带 UObject 弱引用检查 |
| **`TeleportTo` 的 `bNoCheck`** | 为 `true` 时跳过落点合法性检查，函数退化为直接设置位置 |
| **`AController::bAttachToPawn`** | 控制器的 Transform 是否跟随 Pawn，默认 `false`，因此控制器坐标通常无意义 |
| **`Owner`** | "谁负责我"。组件的 Owner 来自 Outer 链、构造时确定；Actor 的 Owner 需手动 `SetOwner` |
| **`Instigator`** | "谁的行为造成了我"，类型是 `APawn*`，`SpawnActor` 时通过 `FActorSpawnParameters` 设置 |
| **`ForceStrength` vs `ImpulseStrength`** | 前者走 Tick 持续施力、需除以质量；后者由 `FireImpulse` 一次性施加，配合 `bImpulseVelChange` 可跳过质量 |
| **`ObjectTypesToAffect`** | `URadialForceComponent` 的数组成员，`RemoveObjectTypeToAffect` 可从中移除某个类型 |
| **`IsSimulatingPhysics()`** | `UPrimitiveComponent` 的方法——物理模拟是组件属性，不是 Actor 属性 |
| **`Implements<T>()`** | 查询 `UClass` 的接口列表，模板参数必须是 U 类 |
| **`check` / `ensure`** | 前者失败直接中断，后者报告一次并返回 bool 由调用方决定；两者在 Shipping 下都被编译掉 |
| **`ensureAlways`** | 每次失败都报告的 `ensure` 变体（`ensure` 默认整个进程只报一次） |
| **`IsValid()`** | 同时检查空指针和 pending kill 标记，比 `!= nullptr` 更适合可能被 `Destroy()` 的对象 |
| **World Partition 空间加载** | Actor 随玩家距离流送加载/卸载；被持久关卡蓝图硬引用时可能解析为空 |
| **`SpawnCollisionHandlingOverride`** | 控制生成点被占据时的行为，`AlwaysSpawn` 表示不允许引擎挪动生成位置 |

---

# 参考资料

- [Epic Games：Actor Lifecycle](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-actor-lifecycle)
- [Epic Games：Gameplay Timers](https://dev.epicgames.com/documentation/unreal-engine/gameplay-timers-in-unreal-engine?lang=en-US)
- [Epic Games：Delegates and Lambda Functions](https://dev.epicgames.com/documentation/en-us/unreal-engine/delegates-and-lamba-functions-in-unreal-engine)
- [Epic Games：Physics in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/physics-in-unreal-engine)
- [Epic Games：Collision in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/collision-in-unreal-engine)
- [Epic Games：Asserts（check / ensure / verify）](https://dev.epicgames.com/documentation/en-us/unreal-engine/asserts-in-unreal-engine)
- [Epic Games：World Partition](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine)
- [Epic Games：Interfaces in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/interfaces-in-unreal-engine)
- [Tom Looman：Unreal Engine 5 C++ Timers](https://tomlooman.com/unreal-engine-cpp-timers/)
- [Tom Looman：Unreal Engine C++ Complete Guide](https://tomlooman.com/unreal-engine-cpp-guide/)
