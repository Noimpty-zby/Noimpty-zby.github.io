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
description: 这是 ActionRoguelike 课程 Assignment 2 的完整复盘。首先清理第三、四章遗留下来的七处崩溃级和逻辑级隐患，然后抽出弹丸基类，实现带有引力吞噬效果的黑洞弹和分两段计时的传送弹，最后使用 FTimerDelegate 把三个技能的发射流程合并成一套。内容涵盖 UCLASS(Abstract)、PostInitializeComponents 的绑定时机、TeleportTo 的 bNoCheck 陷阱、FTimerHandle 的生命周期，以及 check、ensure 和 if 的选择标准。
cover: /img/covers/UE5-ActionRoguelike-Assignment2.svg
series: UE5 ActionRoguelike
privacy: protected
sitemap: false
private_section: 课外
---

# 前言

本文是 Tom Looman《UE5 C++》**Assignment 2** 的完整复盘。

本次使用的开发环境如下：

- Unreal Engine `5.6.1`
- Rider
- Visual Studio 2022 Build Tools / MSVC 编译工具链
- 项目名称：`ActionRoguelike`

## 这次作业和作业一的区别

作业一是**从零开始制作一个新东西**（爆炸桶），所有代码都是新写的，不需要改动已有的类。

而作业二是**在已有的代码上扩展新功能**。它要新增两个技能，而这两个技能会带来下面这些影响：

- 要用到第二章写的弹丸类（因此需要抽出基类）；
- 要用到第三章写的交互组件所在的角色和控制器（因此需要添加输入绑定）；
- 会大量销毁 Actor（因此会遇到第三章遗留下来的悬空指针问题）。

所以这次真正的第一步并不是写黑洞弹，而是**先把前面遗留的问题解决掉**。第一节整节都在做这件事，它不属于作业清单，但如果跳过这一步，后面所有的 bug 都要多排查一层。

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

- 按鼠标左键发射魔法弹（原有的功能，行为保持不变）；
- 按 `Q` 发射黑洞弹，它飞得很慢，能穿透一切，会吸引周围的物理方块并将其销毁，5 秒后消失，而且不影响玩家；
- 按 `F` 发射传送弹，它在 0.2 秒后（或者撞到东西时）爆炸并停在原地，再过 0.2 秒，把角色传送过去；
- 三个技能共用同一套发射流程，代码只有一份。

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

第三、四章一路积累下了一张「遗留待办」清单，当时对这些问题的判断都是「不影响跑通，以后再说」。

而作业二让其中的三条从「以后再说」变成了「现在必须做」，原因只有一个，那就是**黑洞弹会大批量地销毁 Actor**。

在此之前，关卡里没有任何东西会在运行时消失，所以「扫描到的 Actor 会一直存在」这个隐含的假设从来没有被打破过。而黑洞弹一加入，这个假设就立刻失效了：

- 交互组件的 `SelectedActor` 可能会指向一个已经被黑洞销毁的方块；
- `OverlapMultiByChannel` 返回的组件，它的宿主 Actor 可能在同一帧里被销毁。

这两种情况都是空指针解引用，程序会直接崩溃。

## 1.2 崩溃级：三处指针

### ① `Cast<UEnhancedInputComponent>` 未检查

```cpp
UEnhancedInputComponent* EnhancedInput = CastChecked<UEnhancedInputComponent>(InputComponent);
```

这里选择 `CastChecked`，而不是 `Cast` 加判空，判断的依据是，**这个条件为假时，程序还能不能正常工作？**

如果项目设置里的 Default Input Component Class 不是 `UEnhancedInputComponent`，那么优雅降级的结果就是「游戏能够启动，但是所有按键都没有反应」。这种 bug 排查起来能耗掉半天的时间。所以这里需要的不是降级，而是**立刻崩溃**。

`CastChecked` 中的断言在 Shipping 构建里会被编译掉，退化成 `static_cast`。所以它保护的是**开发期**，这并没有问题，因为这类配置错误必然会在开发期暴露出来。

### ② `GetPawn()` 未判空

交互组件挂在 `ARoguePlayerController` 上，而坐标在 Pawn 身上，所以必须调用一次 `GetPawn()`：

```cpp
APlayerController* PC = CastChecked<APlayerController>(GetOwner());

APawn* MyPawn = PC->GetPawn();
if (MyPawn == nullptr)
{
    return;
}

FVector Center = MyPawn->GetActorLocation();
```

`TickComponent` 从组件注册的那一刻起就开始执行，而 `Possess` 是 GameMode 在之后才做的；另外，从角色死亡到重生之间也有一段空档期。在这两个时刻，`GetPawn()` 都会返回 `nullptr`。

**在同一个函数里出现了两种相反的处理方式，值得对照着记住**：

| 指针 | 为空意味着 | 处理 |
| --- | --- | --- |
| `GetOwner()` 不是 PlayerController | 程序结构错了 | `CastChecked`，立刻崩 |
| `GetPawn()` 为空 | 正常运行时状态 | 静默 `if` + `return` |

这里有一条容易走的弯路，就是把 `Center` 改成 `GetOwner()->GetActorLocation()`，想省掉那次 `GetPawn()` 调用。

**这行代码能够编译、能够运行，也不会崩溃，但结果是错误的。** `AController` 确实是一个 `AActor`，也有 Transform，但它的 `bAttachToPawn` 默认为 `false`，也就是说，控制器的 Transform **不会跟随** Pawn，而是停留在 GameMode 生成它时的位置，也就是世界原点附近。结果就是交互检测球固定在世界原点，和角色的位置完全无关。

这个问题很快就能发现，因为 Tick 里那行 `DrawDebugSphere` 画的正是 `Center`，白色的球没有跟着角色移动，而是待在地图的角落里。**在这里，把中间状态可视化的探针真正发挥了作用。**

结论是，**控制器是玩家意志的代理，它没有身体，所以它的坐标是没有意义的。**

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

判断「应不应该判空」，最可靠的办法是**点进被调用的函数，看它的开头有没有 `check`**。UHT 生成的 `Execute_Interact` 是这样的：

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

这两句 `check` 就是它的**前置条件**。外面的两个 `if` 一一对应地把这两个前置条件挡在了门外。函数里有几个 `check`，外面就应该有几道守卫，这比死记规则更管用。

## 1.3 `check` / `ensure` / `if` 的选择标准

写代码时，很容易在这三者之间反复摇摆，最后可以归结为一条标准：

> **这个条件为假，是「不应该发生的事」，还是「正常情况下会发生的事」？**

| 场景 | 是不是正常 | 该不该告诉我 | 写法 |
| --- | --- | --- | --- |
| InputComponent 类型不对 | 否，配置错了 | 该，且不该继续跑 | `CastChecked` |
| Pawn 还没被 Possess | 是，每局都发生 | 不该，纯噪音 | `if` + `return` |
| 玩家对着空气按 E | 是，每天几百次 | 不该 | `if` + `return` |
| 目标没实现交互接口 | 否，资产配错了 | 该，但不该崩 | `if (!ensure(...))` |

把 `SelectedActor` 的判空写成 `ensure(SelectedActor);` 是一种常见的写法，但它有两个错误叠加在一起。

**① `ensure` 不会中断执行。** 它的语义是「检查，报告一次，然后**返回一个 bool 值，继续往下执行**」。所以它触发之后，紧接着还是会执行 `Execute_Interact(nullptr)`，然后被函数里面的 `check` 弄崩溃，想要防止的崩溃一次都没有防住。正确的用法是接住它的返回值，写成 `if (!ensure(X)) { return; }`。

**② 这里根本不应该使用 `ensure`。** 玩家对着空气按 E 是完全正常的操作，而 `ensure` 在开发版本里会弹出断言，测试关卡时随手按一下就会弹出一次。

`ensure` 默认在整个进程里只触发一次（`ensureAlways` 才会每次都报告），这个设计本身就说明它是为「罕见的异常」准备的。

## 1.4 逻辑级：三处筛选

### ④ `SelectedActor` 每帧未重置

原来的写法是「在循环里找到更好的候选就赋值」，如果没找到，就保留上一帧的值。于是角色走开之后，`SelectedActor` 仍然指着那个方块，而黑洞把方块销毁之后，它就变成了悬空指针。

修复的方法并不是在 Tick 的开头写 `SelectedActor = nullptr`，而是在循环结束之后**无条件地赋值**：

```cpp
AActor* BestActor = nullptr;
// ... 循环里只更新 BestActor ...
SelectedActor = BestActor;
```

**如果能用一次无条件赋值来解决，就不要使用「先清空，再有条件地填充」的写法。** 因为后者有两个写入点，出错的可能性也就翻了一倍。

### ⑤ `Overlap.GetActor()` 裸解引用

```cpp
AActor* OverlapActor = Overlap.GetActor();
if (OverlapActor == nullptr)
{
    continue;
}
```

重叠查询返回的是**组件**的列表，`GetActor()` 是从组件反查宿主的弱引用解析，它可能返回 `nullptr`。

需要注意，这里用的是 `continue` 而不是 `return`，因为**一个候选无效，不应该终止整轮的筛选**，后面可能还有合法的目标。这和函数开头的 `return`（前提条件不成立，整件事都做不了）是两种不同的语义。

同时顺便把两次 `GetActor()` 调用合并成了一次，并缓存它的结果。

### ⑥ 点积没有阈值

```cpp
float HighestDotResult = 0.7f;   // 原来是 -1.0f
```

原来的初始值是 `-1.0f`，这意味着**任何方向都能通过**。正后方的点积正好是 `-1.0`，只要不是浮点意义上的精确相等，背后的宝箱也会被选中。修改之前，可以先转身实际测试一次，确认红框确实还在。

`0.7` 大约等于 45° 的半角。这里还有一个附带的好处，**阈值和「取最大值」被合并成了同一个机制**。点积低于 0.7 的候选连进入 `if` 的资格都没有，所以不需要再额外写一句 `if (DotResult < Threshold) continue;`。用初始值来表达约束，既省掉了一个分支，也避免了将来出现「阈值和初始值不一致」这种 bug。

### ⑦ `Implements<U>()` 校验

碰撞通道已经过滤过一轮了，为什么代码里还要再验证一次呢？因为**碰撞通道和接口实现是两张互相独立、由人手工维护的表，引擎不会对它们做任何交叉校验**：

1. 美术人员在编辑器里给一个装饰物设置了 `Interaction` 预设，但它并没有实现接口。碰撞预设是运行时的数据，编译器看不到。
2. 有人在蓝图的 Class Settings 里删掉了接口，这同样不会触发编译错误。
3. **通道设置在组件上，而接口实现在 Actor 上。** 一个 Actor 挂着十个组件，只要其中一个开启了 Interaction 通道，这个 Actor 就会进入候选列表。第三章把宝箱盖子设成 `NoCollision` 来避免重复计数，那只是**内容层面的修补**，而不是代码层面的保证。

概括来说，**碰撞通道是决定「谁能被扫描到」的过滤器，而不是判断「谁能被交互」的类型断言。**

需要注意，模板参数使用的是 **U 类**：

```cpp
SelectedActor->Implements<URogueInteractionInterface>()
```

只有 U 类会进入反射系统，拥有 `UClass` 和 `StaticClass()`，而 `Implements` 是一种查表操作。如果写成 `Implements<IRogueInteractionInterface>`，是无法通过编译的。

**凡是「查表」或者「路由」的场合，一律使用 U 类；凡是 C++ 继承链上的场合，使用 I 类。** 在同一行代码里，两者都会出现，`IRogueInteractionInterface::Execute_Interact` 使用的是 I 类（因为那是一个静态成员函数），而模板参数使用的是 U 类。

这里也不能退回去使用 `Cast<IRogueInteractionInterface>`，那是第四章修复过的 bug，用纯蓝图实现的接口，在 C++ 层没有 I 类的实例，所以转型必然会返回 `nullptr`。

## 1.5 一个附带发现：调试球写进了循环里

运行之后发现了一个现象，周围没有可交互的物体时，那个白色的调试球会消失，靠近可交互物体时才又出现。

原因是 `DrawDebugSphere` 被写进了 `for` 循环的循环体里。如果 `Overlaps` 为空，循环一次都不会执行，球也就不会被画出来；而如果同时捕获到三个物体，球就会被重复画三遍。

**这个 bug 让探针的作用完全反了过来。** 调试球存在的意义，就是在「什么都没有发生」的时候，仍然能看见检测的范围，比如半径够不够、中心在不在角色身上。这些问题恰恰只有在没有捕获到东西时才需要排查，而它偏偏在那个时候消失了。

顺便说明一下这个球是什么。它**并不是**碰撞体，也不参与任何碰撞。`DrawDebugSphere` 只是往渲染器的调试线框列表里加入了一组线段。真正负责检测的是 `OverlapMultiByChannel`，它是一次瞬时的查询，不会留下任何东西。两者依靠同一个 `Center` 和 `InteractionRadius` 保持一致，但在代码上并没有强制的关联。

**调试可视化显示的是「以为代码在算什么」，而不是「代码实际在算什么」。当两者对不上的时候，出错的可能是其中任何一方。**

## 1.6 关卡准备

作业的「准备级别」有两条要求，此外还有一个作业没有写、但必须要做的判断。

**判断关卡的地面是不是 Landscape。** 作业的提示说，UE5 自带的开放世界关卡会导致 `TeleportTo` 失败。在 `P_OpenWorldTestMap` 上，很容易以为「只要站在平地上，避开有地形的地方就可以了」。**但这个想法是错误的，因为 Open World 模板里的整片地面就是一个 Landscape Actor，包括那些看起来完全平坦的部分。地面平不平取决于高度数据，和几何体的类型无关。**

验证的方法是点击一下要测试的地面，看看大纲里选中的是什么。如果显示的是 `LandscapeStreamingProxy_3_2_0`，就说明它是地形。

**铺一块拉伸的立方体作为地板。** 复制粘贴一面墙，把它缩放成 `X=40, Y=40, Z=0.5`（也就是 4000×4000×50），然后把 Z 抬高大约 100，让它明确地成为独立的一层。如果贴得太近，传送查询仍然可能碰到下面的地形。碰撞预设保持 `BlockAll`（`WorldStatic`），**不要开启物理模拟**，否则黑洞会把地板吸走。

材质使用作业指定的 `MI_PrototypeGrid_TopDark`。这一步不要省略，因为**网格纹理是判断传送落点偏了多少、往哪个方向偏的唯一参照。** 在灰色的平板上根本看不出位移。

**设置三个方块。** 作业只写了「生成重叠事件」，但实际上要检查三项设置：

| 设置 | 值 | 为什么 |
| --- | --- | --- |
| 生成重叠事件 | 勾上 | 黑洞的 `SphereComponent` 靠它检测 |
| 模拟物理 | 开 | 黑洞要吸它们，静止 Actor 吸不动 |
| 对象类型 | `PhysicsBody` | `RadialForceComponent` 默认只影响这个类型 |

第三条作业里没有写，但一定会出问题。即使开启了物理，也勾选了事件，如果 ObjectType 不对，照样吸不动。开启模拟物理之后，UE 通常会自动把碰撞预设切换成 `PhysicsActor`（它的对象类型就是 `PhysicsBody`），如果没有自动切换，就需要手动修改。这和作业一中 `ObjectTypesToAffect` 的那个坑是同一个问题。

**顺便清除一条 World Partition 警告。** 消息日志的「地图检测」里有一条警告，说关卡蓝图引用了一个「空间加载」的 Actor（也就是第四章的那个 `BP_ProjectileSpammer`）。关卡蓝图属于持久关卡，会一直处于加载状态，而世界里的 Actor 要等玩家走近时才会被流送进来，所以这是一条从「永远存在」指向「随时可能不存在」的硬引用。

它不会阻止 PIE，但打包之后，这个引用可能会被解析成空，`StartSpawning` 也就会静默地不执行。**这又是一个「不崩溃、不报错，但就是不工作」的问题。** 处理方式有三种，可以取消勾选该 Actor 的 `Is Spatially Loaded`，可以改用事件分发器，让 Actor 自己持有引用，也可以直接删掉这个练习时留下的产物。这里选择的是最后一种。

---

# 第二节：抽出弹丸基类

## 2.1 问题

作业中有两处都写了「从抛射体基类派生」。看一眼第二章的 `ARogueProjectileMagic`，再看看黑洞弹和传送弹的需求，可以发现三者共有的东西包括一个球形碰撞体、一个抛射物移动组件，以及一套飞行途中的循环特效和音效。

如果每个类都各写一遍，那么修改一处施法表现时，就要改三个地方。

## 2.2 执行顺序

这一步按照「**先建立空的基类，再修改继承关系，最后搬移成员**」这三个阶段进行，每个阶段都编译一次。如果合并成一步来做，出了问题时就分不清是继承关系的问题，还是成员搬移的问题。

## 2.3 搬哪些

判断的依据是对每一个成员都问一句，**黑洞弹和传送弹是否也需要它？**

| 成员 | 去向 | 理由 |
| --- | --- | --- |
| `USphereComponent` | 基类 | 三者都要碰撞 |
| `UProjectileMovementComponent` | 基类 | 三者都要飞 |
| `UNiagaraComponent`（循环特效） | 基类 | 三者都有飞行表现 |
| `UAudioComponent`（循环音效） | 基类 | 同上 |
| 伤害数值 | 留在魔法弹 | 黑洞不造成伤害，传送弹也不 |

在基类的构造函数里，顺便设置了两个所有弹丸通用的默认值：

```cpp
ProjectileMovementComponent->InitialSpeed = 2000.f;
ProjectileMovementComponent->ProjectileGravityScale = 0.0f;   // 弹丸不受重力
```

如果子类想修改这些值（比如让黑洞弹飞得更慢），直接在子类的构造函数里修改就可以了，因为这时基类的构造函数已经执行完毕，指针都是有效的。

## 2.4 组件名字符串是身份，不能随便改

```cpp
SphereComponent = CreateDefaultSubobject<USphereComponent>(TEXT("SphereComp"));
```

那个 `TEXT("SphereComp")` 是**组件的身份标识**。在蓝图里对组件所做的所有默认值覆盖（比如半径、Niagara 资产和碰撞预设），都是按照这个名字挂上去的。

**搬到基类时，字符串和 `UPROPERTY` 的变量名都必须一字不差。** 只要改了一个字母，蓝图里的覆盖值就会静默地丢失，不会报错，只是回到了默认值。所以搬移的时候要使用复制粘贴，不要手动输入。

黑洞类上就有一个拼写错误，`TEXT("RadiaForceComp")` 少了一个 `l`。如果现在修改，就会丢掉 `BP_BlackHole` 里对 RadialForce 的所有覆盖值，所以暂时保留它作为标记，并列入遗留待办。**有了蓝图依赖之后，就不要随手修改这类字符串。**

## 2.5 `UCLASS(Abstract)`

作业专门点名了这个说明符。它**不影响 C++ 的编译**（那是 `= 0` 纯虚函数负责的事情），它影响的是引擎的内容层，会让这个类从类选择器和放置面板里消失，`SpawnActor` 也会拒绝生成它。

基类之所以需要它，是因为基类没有设置任何资产（Niagara 和音效都是空的），也没有具体的行为，拖进关卡之后就是一个隐形的、什么都不做的 Actor。`Abstract` 从源头上杜绝了这种情况。

**这里的错误在于，把它顺手也加到了黑洞类上。** 黑洞是一个具体的类，理应可以被直接生成。这个问题之所以一直没有暴露，是因为 `ProjectileClass` 指向的是 `BP_BlackHole`，而**蓝图子类不会继承 `Abstract`**。但是如果哪天在 C++ 里直接调用 `SpawnActor<ARogueProjectileBlackhole>`，它就会静默地返回 `nullptr`。

发现这个问题的方式很简单，传送弹是 `UCLASS()`，而黑洞是 `UCLASS(Abstract)`，**两个平级的兄弟类标记不一致，这本身就是复制粘贴留下的痕迹。**

## 2.6 改完之后

打开 `BP_MagicProjectile`，确认它能正常打开，变量也都还在。C++ 类的身份是「模块 + 类名」，如果只修改了父类而没有修改类名，就不需要 CoreRedirects；但如果顺手改了类名，就需要用上第三章的那套方法。

另外需要注意，**Live Coding 无法处理新增的 UCLASS 和继承关系的变更。** 这一步要先关掉编辑器，在 Rider 里完整地 Build 一遍，然后再重新打开编辑器。这样做虽然慢，但比排查「为什么改了代码却没有生效」要快得多。

**检查点是火球攻击的行为完全不变**，飞行速度、命中特效、命中音效和伤害数值，全都要和重构之前一样。重构的定义就是「只改结构，不改行为」，如果这一步没有做到，就不应该继续往下走。

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

作业一的爆炸桶也使用了 `URadialForceComponent`，但两者的配置正好是镜像的：

| | 爆炸桶 | 黑洞 |
| --- | --- | --- |
| 力的类型 | 冲量（一次性 `FireImpulse`） | 力（持续，每帧施加） |
| 强度符号 | 正（推开） | 负（吸引） |
| `bAutoActivate` | `false` | `true` |

持续的力走的是组件的 Tick 路径，所以必须激活；而冲量走的是主动调用 `FireImpulse()` 的路径，与激活状态无关。这是同一个组件的两条完全独立的路径，初次接触时很容易混淆。

## 3.3 数量级

作业提示说「想想几百万个数字吧」，凭直觉先试了 `-2000`，结果方块纹丝不动，一路往上加，直到 `-2000000` 才有效果。

**这段弯路值得走一次**，因为亲手体验一次「数量级错误」，比直接照抄一个数字记得更牢。原因在于，`ForceStrength` 走的是 `AddForce` 路径，力要先除以质量才会变成加速度，而且它是每帧施加的，还要克服重力和摩擦力；而 `ImpulseStrength` 配合 `bImpulseVelChange = true` 时，是直接修改速度，跳过了质量。所以爆炸桶的 `2500` 和黑洞的 `2000000` 不在同一个尺度上，**它们根本就不是同一种物理量。**

## 3.4 两个半径是两件事

`SphereComponent` 的半径负责**重叠判定**（也就是销毁），而 `RadialForceComponent` 的 `Radius` 负责**吸力的范围**，两者是相互独立的。

如果调错了，会出现两种症状。如果吸力范围小于碰撞球，方块还没有被吸过来就已经被销毁了，看不到吸引的过程；反过来，方块就会被吸过来，但一直不消失。

这里设置的是 `RadialForceComponent->Radius = 750.f`，明显大于球体的半径，所以能先看到吸引，再看到销毁。

## 3.5 "只能销毁模拟角色"

这是需求里最容易写错的一条。关键在于，判断的依据挂在**组件**上，而不是挂在 Actor 上，因为物理模拟是 `UPrimitiveComponent` 的属性：

```cpp
if (OtherActor && OtherComp && OtherComp->IsSimulatingPhysics()
    && OtherActor != GetInstigator() && OtherActor != this)
{
    OtherActor->Destroy();
}
```

三个额外的条件，分别对应着三个具体的失败场景：

- 如果不加 `IsSimulatingPhysics()`，地板和墙壁也会被一起销毁，地图上会出现大洞；
- 如果不加 `!= GetInstigator()`，玩家自己会被删除；
- 如果不加 `!= this`，黑洞在某些情况下会把自己删除。

另外需要注意，`Destroy()` 是显式地销毁对象，并把它标记为 pending kill，而 `!= nullptr` 判断不出「正在被销毁」的对象。所以第一节里的那个 `SelectedActor`，更稳妥的写法其实是 `IsValid(SelectedActor)`，它会同时检查空指针和 pending kill 标记。

## 3.6 `SetLifeSpan` 而不是自己起 Timer

```cpp
void ARogueProjectileBlackhole::BeginPlay()
{
    Super::BeginPlay();
    SetLifeSpan(5.f);
}
```

`AActor::SetLifeSpan` 的内部就是一个定时器，到期时会调用 `Destroy()`，所以自己再写一遍没有任何好处。

**但要记住它的边界**，到期时它走的是 `Destroy()`，**不会**触发任何自定义的爆炸逻辑。黑洞不需要这样的逻辑（消失就是它的最终状态），而传送弹需要，所以传送弹使用的是显式的 `FTimerHandle`（见 4.2 节）。

## 3.7 `AddDynamic` 放在 `PostInitializeComponents`

```cpp
void ARogueProjectileBlackhole::PostInitializeComponents()
{
    Super::PostInitializeComponents();
    SphereComponent->OnComponentBeginOverlap.AddDynamic(this, &ARogueProjectileBlackhole::OnSphereOverlap);
}
```

不放在构造函数里的原因是，构造函数会在创建 CDO（类默认对象）时运行，绑定会被序列化进 CDO 中。而 `PostInitializeComponents` 是每个实例各自进行绑定，所以更干净。

`OnSphereOverlap` 必须加上 `UFUNCTION()`。`AddDynamic` 绑定的是**动态多播委托**，它依靠反射系统按函数名来查找，如果不加标记，就找不到这个函数，而且这个错误要到运行时才会报出来，而不是在编译时。

---

# 第四节：传送弹

## 4.1 时序设计

这是本次作业中逻辑最复杂的部分。先把时序画出来，然后再写代码：

```text
生成 ──[0.2s 定时器]──▶ Explode ──[0.2s 定时器]──▶ TeleportInstigator ──▶ Destroy
                            ▲
                            │
                     撞到世界时从这里进
```

两个 0.2 秒是**两种性质不同的等待**：

- 第一个决定了「弹丸飞多远」；
- 第二个纯粹是视觉上的留白，让玩家先看清爆炸，然后再被传送。

作业专门强调了第二个等待的理由，「让爆炸效果播放一会儿再传送，以便玩家可以看到」。如果直接传送，打击感就会完全消失。

## 4.2 为什么这里不能用 `SetLifeSpan`

3.6 节说过，`SetLifeSpan` 到期时走的是 `Destroy()`，不会触发自定义的逻辑。而传送弹的第一段等待必须能够调用 `Explode()`，所以只能使用显式的定时器：

```cpp
void ARogueProjectileTeleport::BeginPlay()
{
    Super::BeginPlay();
    GetWorldTimerManager().SetTimer(ExplodeTimer, this, &ARogueProjectileTeleport::Explode, 0.2f);
}
```

**这是「超时之后逻辑不生效」最常见的原因。** 写了 `SetLifeSpan`，然后奇怪为什么爆炸逻辑从来没有执行过。解决办法是要么重写 `LifeSpanExpired()`，要么直接使用定时器。

## 4.3 "受到世界攻击时执行相同行为"

这句话意味着 `Explode` 有**两个入口**，一个是定时器到期，另一个是命中事件。这也正是把它做成一个独立的函数（而不是写在回调里）的理由。

```cpp
void ARogueProjectileTeleport::OnActorHit(UPrimitiveComponent* HitComponent, AActor* OtherActor,
    UPrimitiveComponent* OtherComp, FVector NormalImpulse, const FHitResult& Hit)
{
    Explode();
}
```

**需要注意，碰撞设置和黑洞是相反的。** 黑洞使用 `ECR_Overlap`（穿透一切），而传送弹必须能够被 `Block`，才会触发 `OnComponentHit`。如果全部设置成 Overlap，弹丸就会直接穿墙而过，永远不会触发爆炸。

```cpp
SphereComponent->SetCollisionProfileName("Projectile");
SphereComponent->IgnoreActorWhenMoving(GetInstigator(), true);
```

第二行的作用是忽略发射者自身，否则弹丸在第一帧就会撞到角色的胶囊体上，在原地爆炸。

**这行代码的位置很关键**，它必须放在 `PostInitializeComponents` 里，而不能放在构造函数里。`Instigator` 是在 `SpawnActor` 的过程中、由 `PostSpawnInitialize` 设置的，早于 `PostInitializeComponents`，但是晚于构造函数，所以在构造函数里取到的是 `nullptr`。

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

`ClearTimer` 可以防止「撞墙之后定时器又触发一次爆炸」，而 `StopMovementImmediately` 会让弹丸悬停在原地展示特效。

**但这里的幂等保护其实并不完整**，因为 `ClearTimer` 挡不住「同一帧里触发两次 Hit」的情况。更彻底的做法是加上一个 `bool bExploded` 守卫，或者在 `Explode()` 的开头调用 `SetActorEnableCollision(false)`。这和作业一爆炸桶的那个 `bExploded` 是同一种模式，已经列入遗留待办。

## 4.5 爆炸特效必须是独立生成的

```cpp
UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, ExplosionEffect, GetActorLocation());
UGameplayStatics::PlaySoundAtLocation(this, ExplosionSound, GetActorLocation(), FRotator::ZeroRotator);
```

爆炸特效不能做成挂在弹丸上的组件。因为弹丸在 0.2 秒之后就会被 `Destroy()`，附着在它上面的组件也会跟着一起被销毁，特效只能播放一瞬间。

这和作业一爆炸桶的「循环燃烧使用组件，一次性的爆炸使用 `SpawnSystemAtLocation`」是同一条判断标准，也就是**效果的生命周期是否需要超出宿主 Actor。**

## 4.6 `TeleportTo` 与那个被关掉的安全检查

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

作业明确要求使用 `TeleportTo` 而不是 `SetActorLocation`，理由是前者带有碰撞检查，在落点不合法时会尝试寻找空位，防止玩家卡进墙里。

**但这个好处很容易被开发者自己关掉。** 它的完整签名如下：

```cpp
bool TeleportTo(const FVector& DestLocation, const FRotator& DestRotation,
                bool bIsATest = false, bool bNoCheck = false);
```

最初的写法是 `TeleportTo(..., false, true)`。`bNoCheck = true` 的含义是**跳过落点的合法性检查**，也就是不做 encroachment 查询，不尝试寻找空位，也不管目标点是否被几何体占据，直接把角色挪过去。

也就是说，虽然换了一个函数名，但又用第四个参数把这个函数存在的意义关掉了，它的行为退回到了 `SetActorLocation`。

之所以会写成这样，是因为不加这个参数时，传送经常失败，加上之后问题就「好了」。**这是一个值得记住的模式，当一个参数让问题消失的时候，要先弄清楚它关掉的是什么。**

改回 `false` 之后，要配合那一行 `UE_LOG` 来使用。`TeleportTo` 失败时只会**静默地返回 `false`**，不会打印任何日志。有了这行日志，「传送没有反应」这个问题就能立刻分成两种情况：

- 如果打印了 `FAILED`，说明几何体拒绝了这个落点，应该去看看角色站在什么东西上面；
- 如果**什么都没有打印**，说明这行代码根本没有执行，问题出在时序或者定时器上。

**如果没有这行日志，这两种情况在屏幕上看起来一模一样。** 这已经是本次作业里第三次遇到「不崩溃、不报错，但就是不工作」的情况了（前两次分别是 `GetOwner()` 取错了坐标，以及调试球被写进了循环）。这类 bug 的通用解决办法，就是**在关键的分支上留下一个可观测点**。

## 4.7 `Instigator`：作业提示指向的那个字段

作业提示说"看看我们之前用来忽略碰撞的 `Instigator`，在这里它可以用来进行传送"。

第二章设置 `Instigator`，是为了让弹丸忽略发射者的碰撞；而这一次是用它来找回「应该被传送的那个角色」。同一个字段，有两种用途。

它和 `Owner` 的区别值得牢记：

| | `AActor::GetOwner()` | `AActor::GetInstigator()` |
| --- | --- | --- |
| 回答的问题 | 谁负责我 | 谁的行为造成了我 |
| 返回类型 | `AActor*` | `APawn*` |
| 主要用途 | 网络权限、所有权 | 伤害归属、行为溯源 |

需要注意，`GetInstigator()` 返回的是 `APawn*`，而不是 `AActor*`，**因为 Instigator 在语义上只可能是 Pawn，类型本身就把这件事说清楚了。** 这和第二节把 `TSubclassOf` 收窄到基类遵循的是同一条原则，也就是使用能满足需求的、最合适的类型，类型本身就在传递设计意图。

此外，还要和组件上的同名函数区分开来。`UActorComponent::GetOwner()` 问的是「挂在哪个 Actor 上」，它来自 Outer 链，在构造时就已经确定，实际上不会为空；而 `AActor::GetOwner()` 需要手动调用 `SetOwner` 来设置，所以经常是空的。两者名字相同，含义却不同。

---

# 第五节：三个技能收口成一套

## 5.1 问题

第一版为了省事，给三个技能各写了一对函数，一共有六个：

```text
PrimaryAttack()   / AttackTimerElapsed()
BlackHoleAttack() / BlackHoleAttackTimerElapsed()
TeleportAttack()  / TeleportTimerElapsed()
```

这三对函数之间是**逐字复制**的，只有两处不同，一处是定时器回调的函数指针，另一处是 `SpawnActor` 的类。

这样写当时能省下十分钟，但代价是修改施法特效要改三处，加冷却要改三处，加上「施法期间不能移动」也要改三处，只要漏掉一处，就会有一个技能的行为不一致。

而作业的提示专门提到了 `FTimerDelegate` 和 `BindAction 传额外参数`，**这两条提示存在的唯一目的，就是引导学习者完成这次重构。** 它并不是额外的要求，而是作业的一部分。

## 5.2 先修一个真 bug：`FTimerHandle` 是局部变量

```cpp
void ARoguePlayerCharacter::BlackHoleAttack()
{
    FTimerHandle BlackHoleAttackTimerHandle;   // ← 局部变量
    // ...
    GetWorldTimerManager().SetTimer(BlackHoleAttackTimerHandle, ...);
}   // 函数返回，handle 析构
```

定时器本身注册在 `TimerManager` 里，所以回调**照样会执行**，这也是它当时「能运行」的原因。

但是那个 handle 是**取消、查询和重置定时器的唯一凭据**，函数一返回，它就不存在了。这会带来下面这些后果：

- 如果快速地连按技能键，每按一次就会注册一个新的定时器，而且它们全部都会触发，于是按一次键就会连发多个弹丸；
- 如果角色在 0.2 秒的窗口内被销毁，定时器仍然会照常触发，对着一个正在析构的对象调用成员函数；
- 如果想加入打断、冷却或者「施法期间不能再施法」的功能，因为没有 handle，所以根本做不到。

所以 `FTimerHandle` 必须是成员变量。另外，`const float AttackDelayTime = 0.2f;` 也是一个局部变量，而且在三个地方各写了一遍，应该改成 `UPROPERTY(EditDefaultsOnly)`，因为这个值需要反复调试手感。

## 5.3 统一 `TSubclassOf` 的类型参数

原来三个类引用的类型各不相同：

```cpp
TSubclassOf<ARogueProjectileMagic>     ProjectileClass;
TSubclassOf<ARogueProjectileBlackhole> BlackHoleProjectileClass;
TSubclassOf<ARogueProjectileTeleport>  TeleportClass;
```

三个不同的类型，无法传给同一个函数。既然已经抽出了基类，这里就应该统一成 `TSubclassOf<ARogueProjectileBase>`，**这正是基类存在的意义之一**，而且蓝图里的下拉框仍然只会列出弹丸类，不会变成列出所有的 Actor。

把类型收窄成父类是兼容的，修改之后打开 `BP_playerCharacter`，确认三个资产引用都还在就可以了。

## 5.4 `FTimerDelegate::CreateUObject`

`SetTimer` 的常规重载只接受无参的函数指针，没有办法把「要生成哪个类」传进去。作业提示中的 `FTimerDelegate` 就是解决办法：

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

`CreateUObject` 会把 `this`、成员函数指针以及**额外的参数**打包在一起，0.2 秒之后连同参数一起调用。

**为什么不用 `CreateLambda` 呢？** Lambda 版本也能捕获参数，但它**不会检查对象是否还存在**。如果角色在那 0.2 秒里被销毁了，Lambda 照样会执行，并访问已经析构的 `this`。而 `CreateUObject` 内部存储的是弱引用，对象不存在了，delegate 就会自动失效。

> **在 UE 里，凡是延迟执行的回调，都应该优先选择带有 UObject 生命周期检查的版本。**

三个技能共用一个 `AttackTimerHandle` 之后，语义也变得正确了。在施法期间按下别的技能，`SetTimer` 会覆盖前一个定时器，相当于打断之后重新开始。这通常正是想要的行为。

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

这里有几点需要说明：

- `SpawnActor` 的模板参数使用的是基类，它只影响返回值的静态类型，实际生成什么类，由 `InProjectileClass` 决定。
- 在这里使用 `ensure` 是合适的，因为在蓝图里忘了给某个技能设置类引用，属于「资产配置错误，需要被告知」的情况，符合 1.3 节那张表的标准。
- `AlwaysSpawn` 是第四章遗留待办里的一条。默认的 `AdjustIfPossibleButAlwaysSpawn` 会在生成点被占据时悄悄地挪动弹丸的位置，而从枪口发射时，弹丸经常会和角色的胶囊体重叠，导致弹丸莫名其妙地偏移。
- `SpawnParams.Instigator = this` 是传送弹能够找回「家」的前提，如果漏掉了它，传送弹会静默地不进行传送。

三个入口函数各自只剩下一行，输入绑定完全不需要修改：

```cpp
void ARoguePlayerCharacter::PrimaryAttack()   { StartAttack(ProjectileClass); }
void ARoguePlayerCharacter::BlackHoleAttack() { StartAttack(BlackHoleProjectileClass); }
void ARoguePlayerCharacter::TeleportAttack()  { StartAttack(TeleportClass); }
```

六个函数变成了四个，重复的代码从三份变成了一份。

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

> 这四个组件使用的是 `EditDefaultsOnly`，标准的写法应该是 `VisibleAnywhere`，因为组件指针本身不应该被替换，需要编辑的是组件**内部**的属性。作业一的第 6 个坑就是这一条，这次又退回去了，详见遗留待办。

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

`ProjectileMovementComponent` 没有调用 `SetupAttachment`，这是因为 `UMovementComponent` 派生自 `UActorComponent`，而不是 `USceneComponent`，它没有 Transform，也不参与组件树。这是第三章那条「`UActorComponent` 与 `USceneComponent`」区别的直接应用。

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

这次有四个地方都在做同一件事，那就是**使用能满足需求的、最合适的类型**：

| 位置 | 选择 | 传达的意图 |
| --- | --- | --- |
| `CastChecked<APlayerController>` 而非 `AController` | 收窄 | 这个组件只服务于玩家 |
| `TSubclassOf<ARogueProjectileBase>` 而非 `TSubclassOf<AActor>` | 收窄 | 只能填弹丸类 |
| 交互组件里用 `APlayerController` 而非 `ARoguePlayerController` | 放宽 | 不需要知道具体型号，可复用 |
| `GetInstigator()` 返回 `APawn*` 而非 `AActor*` | 引擎的选择 | Instigator 语义上只可能是 Pawn |

放宽和收窄并不矛盾，它们遵循的是同一条标准，**恰好覆盖需求，不多也不少。** 类型选得太具体，会限制复用（低层模块认识了高层模块）；选得太宽泛，又会丢失约束（蓝图的下拉框里会出现一堆不应该选择的东西）。

## 主线二：静态类型只是"看这块内存的窗口"

`GetOwner()` 返回的是 `AActor*`，却能转换成 `APlayerController*`，这是因为那块内存里的对象**本来就是**一个 `ARoguePlayerController`。

派生类对象在内存中的布局，是把基类部分放在起始位置，所以两个指针存储的是**完全相同的地址**，转型在机器层面可能连一条指令都不会产生。改变的只是编译器允许调用哪些成员。

`Cast` 的验证机制依靠的是反射系统，它拿到实际对象的 `UClass`，然后沿着 `SuperStruct` 链往上查找目标类。UE 不使用标准的 `dynamic_cast`，原因有三个，一是项目默认关闭了 RTTI，二是遍历 `SuperStruct` 的速度更快，三是**蓝图类在编译期并不存在**，RTTI 里根本没有它们的条目。

第三个原因也解释了为什么 `Cast<IRogueInteractionInterface>` 找不到纯蓝图的实现，因为**编译期的类型系统看不见蓝图**，这是同一个根源的两种表现。

## 主线三：同一个组件的两条独立路径

`URadialForceComponent` 在作业一和作业二中的用法正好相反：

```text
冲量路径   FireImpulse() 主动调用   一次性   与 bAutoActivate 无关   爆炸桶
力路径     组件 Tick 自动执行       持续     必须 bAutoActivate      黑洞
```

`ImpulseStrength` 配合 `bImpulseVelChange = true`，会直接修改速度，跳过质量；而 `ForceStrength` 走的是 `AddForce`，要除以质量，要克服重力和摩擦力，而且是每帧施加的。所以 `2500` 和 `2000000` 不在同一个尺度上，**它们不是同一种物理量。**

## 主线四：静默失败的形态

这次遇到了三个「不崩溃、不报错，但就是不工作」的问题：

| 现象 | 静默原因 | 怎么发现的 |
| --- | --- | --- |
| 交互检测球固定在世界原点 | `GetOwner()` 是 Controller，其 Transform 不跟随 Pawn | DrawDebugSphere 没跟着角色 |
| 周围没东西时看不到检测范围 | `DrawDebugSphere` 写进了 for 循环 | 移动时观察到球时有时无 |
| 传送落点不合法但仍然传送 | `bNoCheck = true` 关掉了落点检查 | 对照函数签名逐个参数核对 |

**通用的解决办法只有一条，那就是在关键的分支上留下可观测点。** 一行 `UE_LOG` 或者一次 debug 绘制，就能把排查的范围缩小一半。而且需要注意，**可视化探针本身也可能是错的**（第二个问题就是探针自己出了问题），所以它和被观测的逻辑要尽量解耦。

## 主线五：延迟执行的三种写法

这次一共出现了三种「等一会儿再做」的写法：

| 写法 | 到期行为 | 能否取消 | 用在 |
| --- | --- | --- | --- |
| `SetLifeSpan(5.f)` | 只 `Destroy()` | 可以（再次 SetLifeSpan） | 黑洞自毁 |
| `SetTimer(Handle, this, &Func, T)` | 调用无参成员函数 | 可以 | 传送弹两段计时 |
| `SetTimer(Handle, FTimerDelegate, T)` | 调用带参函数 | 可以 | 三技能共用发射 |

选择的依据有两条，一是**到期时需不需要执行自己的逻辑**（如果需要，就不能使用 `SetLifeSpan`），二是**需不需要传递参数**（如果需要，就使用 `FTimerDelegate`）。

`FTimerHandle` 必须是成员变量，否则就失去了取消和查询的能力。`FTimerDelegate` 应该优先使用 `CreateUObject`，而不是 `CreateLambda`，因为前者带有弱引用检查。

---

# 遗留待办

### ① 组件的 `UPROPERTY` 改成 `VisibleAnywhere`

现在基类的四个组件和黑洞的 `RadialForceComponent` 使用的都是 `EditDefaultsOnly`。标准的写法是 `VisibleAnywhere`，因为组件指针本身不应该被替换，需要编辑的是组件**内部**的属性。

作业一的第 6 个坑就是这一条，这次又退回去了。**这说明作业一只记住了「改成什么」，却没有理解「为什么」。**

### ② `TEXT("RadiaForceComp")` 拼写

少了一个 `l`。如果现在修改，就会丢掉 `BP_BlackHole` 里对 RadialForce 的所有覆盖值，所以修改之后需要重新配置一遍数值。

### ③ 把 `Explode()` 提到基类做成 `BlueprintNativeEvent`

现在三个弹丸的「爆炸」逻辑各写各的，传送弹的 `Explode()` 既不是 `virtual`，也不是 `BlueprintNativeEvent`，基类和蓝图都无法触及它。

把它提到基类之后，由基类提供默认的实现（播放特效并调用 `Destroy`），子类各自覆盖，蓝图这一侧也能修改表现，不需要再回来改动 C++。第四章刚学过的内容在这里就能派上用场。

### ④ 传送弹的幂等保护做彻底

`ClearTimer` 挡不住同一帧里触发两次 `Hit` 的情况。可以加上一个 `bool bExploded` 守卫，或者在 `Explode()` 的开头调用 `SetActorEnableCollision(false)`。

可以参照作业一爆炸桶的 `bExploded` 模式。

### ⑤ 传送落点补胶囊半高

角色胶囊体的半高是 88，而弹丸的中心离地面可能只有几十个单位。打开检查之后，`TeleportTo` 会自己往上寻找空位，但如果给它一个合理的起点，成功率会高很多。

### ⑥ `bDrawDebug` 开关

交互组件里的三处 debug 绘制，加上每帧构造的 `FString::Printf`，应该都收进一个 `UPROPERTY(EditAnywhere) bool bDrawDebug` 开关里。否则弹丸满天飞的时候，屏幕上挂着的白球、红框和点积文字会显得非常杂乱。

更进一步的做法是使用 `TAutoConsoleVariable`，在运行时通过敲命令来切换。

### ⑦ `Interact()` 改名 `PrimaryInteract()`

现在这条调用链上有三个同名的 `Interact`，分别是 PlayerController 的输入回调、组件的方法和接口的函数。同一个函数体里会同时出现 `URogueInteractionComponent::Interact` 和 `Execute_Interact`。

### ⑧ 交互接口加 `InstigatorPawn` 参数

修改接口的签名会连带修改所有的实现类和调用点。课程后面讲到 Action 系统时自然会需要它，到那时再一起修改。

### ⑨ 交互评分加距离权重

现在只看角度，不看距离，远处正对着的物体会胜过近处稍微偏一点的物体。这属于手感上的优化，并不是 bug，做的时候需要处理「角度和距离怎样加权」的调参问题。

### ⑩ 用 `BindAction` 传参的另一条路

作业提示给出了两条路，这里走的是 `FTimerDelegate`。另一条路是在 `BindAction` 时就把弹丸类作为额外的参数传进来，这样连三个只有一行的入口函数都可以省掉。值得尝试一次，做个对比。

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
