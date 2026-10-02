---
title: UE5 C++ 作业一复盘：角色跳跃与爆炸桶，从需求到状态机再到代码
date: 2026-08-09 13:00:00
categories:
  - [课外, 游戏开发, UE5-Looman]
tags:
  - C++
  - ActionRoguelike
  - Enhanced Input
  - 伤害系统
  - 物理冲量
  - Niagara
description: 这是 ActionRoguelike 课程 Assignment 1 的完整复盘。第一部分使用 Enhanced Input 实现角色跳跃，并读懂 ACharacter::Jump 在源码中的分层；第二部分从零开始设计一个爆炸桶，内容包括 TakeDamage 的重写、伤害系统的双端结构、UPROPERTY 说明符的判断标准、组件与一次性效果在生命周期上的差异、RadialForceComponent 与冲量，以及这次作业中实际遇到的十四个坑。
cover: /img/covers/UE5-ActionRoguelike-Assignment1.svg
series: UE5 ActionRoguelike
privacy: protected
sitemap: false
private_section: 课外
---

# 前言

本文是 Tom Looman《UE5 C++》**Assignment 1** 的完整复盘。

本次使用的开发环境如下：

- Unreal Engine `5.6.1`
- Rider
- Visual Studio 2022 Build Tools / MSVC 编译工具链
- 项目名称：`ActionRoguelike`

## 这次作业和前两章的根本区别

前两章都是**跟着老师敲代码**，老师写一行，就跟着写一行，遇到不懂的地方再回看视频。而作业需要**自己设计**，课程只给出一份需求清单和几个资产名，中间所有的类结构、成员划分、函数职责和执行顺序，都要自己来决定。

作业的原始需求（课程给出的完整清单）如下：

**资产**

| 资产 | 路径 |
| --- | --- |
| `SM_OilBarrel` | `Troy/` |
| `NS_Explosion` | `tharlevfx_tutorials/CharacterFX/ParagonSourceAssets/Niagara/` |
| `NS_Flames` | `tharlevfx_tutorials/CharacterFX/ParagonSourceAssets/Niagara/` |
| `MSS_Environmental_BarrelExplode` | `SanderAudio/Sources/Environment/` |
| `MSS_Environmental_BarrelAftermath` | `SanderAudio/Sources/Environment/` |

**第一部分：跳跃**

- 查看引擎源代码，找到玩家角色内置的"跳跃"逻辑。
- 使用增强输入创建一个新的输入绑定，按下空格键跳跃。
- 动画蓝图已经设置好，可以处理跳跃动画。

**第二部分：爆炸桶**

- 使用 C++ 创建基于 Actor 的类，包含用于桶体网格的静态网格组件。
- 启用桶的物理模拟功能，使其能够对弹丸撞击产生的冲击力做出反应。
- 受到伤害后，延迟一段时间后"爆炸"，使用 Epic 内置的伤害施加/承受功能。
  - 在 Actor 类中查找需要重写的 Damage 函数。
  - 延迟爆炸 3 秒。
  - 延迟期间播放燃烧音效和粒子效果。
  - 爆炸时循环燃烧效果停止。
  - 爆炸只能发生一次。
  - 爆炸时播放粒子特效和音效。
- 额外效果：爆炸对周围物体产生物理冲击（`URadialForceComponent`）。
- 提示：力是持续施加的，冲量是一次强烈的力作用。
- **始终在蓝图中分配资源，而不是在 C++ 中分配。**

最终实现的效果如下：

- 按空格键跳跃，动画蓝图自动播放起跳、滞空和落地动画；
- 法球击中油桶后，油桶开始冒火并发出燃烧声，3 秒后爆炸，火焰停止，同时播放爆炸特效和音效，周围的物体被推开；
- 重复击中不会重复起爆。

这篇文章的重点并不是「最终代码长什么样」，而是下面三个问题：

- 每一个设计决策的**判断依据**是什么；
- 需求里的每一句话对应着代码里的哪一行；
- 中间实际出错的十四个地方，以及每个错误暴露出了哪些认知上的盲区。

---

## 目录

- [第一节：角色跳跃](#第一节：角色跳跃)
- [第二节：把需求翻译成状态机](#第二节：把需求翻译成状态机)
- [第三节：头文件设计](#第三节：头文件设计)
- [第四节：构造函数](#第四节：构造函数)
- [第五节：TakeDamage](#第五节：TakeDamage)
- [第六节：Explode](#第六节：Explode)
- [第七节：蓝图与资产配置](#第七节：蓝图与资产配置)
- [完整代码](#完整代码)
- [知识链路总览](#知识链路总览)
- [本次实际踩过的十四个坑](#本次实际踩过的十四个坑)
- [易错点速查表](#易错点速查表)
- [遗留待办](#遗留待办)
- [作业一完成检查清单](#作业一完成检查清单)
- [术语表](#术语表)
- [参考资料](#参考资料)

---

# 第一节：角色跳跃

## 1.1 读源码：`Jump()` 到底做了什么

作业的第一句就是「查看引擎源代码，找到玩家角色内置的跳跃逻辑」。这一步并不是走过场，只有读完源码，第二个需求才有意义。

`ACharacter::Jump()` 的实现非常简单：

```cpp
void ACharacter::Jump()
{
    bPressedJump = true;
    JumpKeyHoldTime = 0.0f;
}

void ACharacter::StopJumping()
{
    bPressedJump = false;
    ResetJumpState();
}
```

**它根本没有让角色移动**，只是设置了一个标志位。

真正的执行发生在别处。`ACharacter::CheckJumpInput(float DeltaTime)` 每一帧都会被调用，它读取 `bPressedJump`，并做一系列合法性判断，包括是否在地面上、`JumpMaxCount` 有没有用完、是否处于下蹲状态，以及 `JumpKeyHoldTime` 有没有超过 `JumpMaxHoldTime`。这些判断都通过之后，才会调用 `UCharacterMovementComponent::DoJump()`：

```cpp
bool UCharacterMovementComponent::DoJump(bool bReplayingMoves, float DeltaTime)
{
    if (CharacterOwner && CharacterOwner->CanJump())
    {
        if (!bConstrainToPlane || ...)
        {
            Velocity.Z = FMath::Max<FVector::FReal>(Velocity.Z, JumpZVelocity);
            SetMovementMode(MOVE_Falling);
            return true;
        }
    }
    return false;
}
```

到了这一步，才真正修改了速度。

**这种分层是本节最值得记住的内容**：

```text
输入层    Jump()               只记录"玩家想跳"
判定层    CheckJumpInput()     每帧判断"现在能不能跳"
执行层    DoJump()             真正修改 Velocity
```

第一章的 `Move()` 也是同样的结构，`AddMovementInput` 只是累加输入向量，真正的执行者是 `CharacterMovementComponent`。**在 UE 的角色系统里，「表达意图」和「执行结果」始终是分开的两个步骤。** 后面做冲刺、闪避和攀爬时，还会反复见到这种模式。

理解了这一点，就能自己避免第 1.4 节里的错误。

## 1.2 `IA_Jump` 资产配置

新建一个 Input Action，把它放在第一章建好的 `Input` 文件夹里。

| 项 | 值 | 说明 |
| --- | --- | --- |
| 值类型（Value Type） | 数字（布尔）Digital (bool) | 跳跃只有"按下/没按下"两种状态，不需要轴数据 |
| 触发器（Triggers） | 已按下（Pressed） | 可选，见下 |

和第二章的 `IA_PrimaryAttack` 对比一下。在那里加上「已按下」触发器是**必须的**，因为绑定使用的是 `ETriggerEvent::Triggered`，如果不加触发器，按住鼠标时每一帧都会喷出一发法球。

而这里最终使用的是 `ETriggerEvent::Started`，所以无论加不加触发器，都能正常工作。保留它只是为了让资产配置保持一致。**但是两种写法的可靠性完全不同**，详见 1.3 节。

然后在 `IMC_DefaultPlayer` 里添加一条映射，把 `IA_Jump` 映射到空格键。这条映射下面的「触发器」和「修改器」数组都保持为空，因为按键这一级不需要额外的处理，`设置行为` 保持「从操作中继承设置」即可。

## 1.3 输入绑定

在头文件里加上一个 Input Action 槽位，格式和第一章的 `Input_Move` 完全一致：

```cpp
UPROPERTY(EditDefaultsOnly, Category="Input")
TObjectPtr<UInputAction> Input_Jump;
```

在 `SetupPlayerInputComponent` 里写两行绑定：

```cpp
EnhancedInput->BindAction(Input_Jump, ETriggerEvent::Started,   this, &ACharacter::Jump);
EnhancedInput->BindAction(Input_Jump, ETriggerEvent::Completed, this, &ACharacter::StopJumping);
```

需要注意，函数指针写的是 `&ACharacter::Jump`，而不是 `&ARogueCharacter::Jump`，因为这两个函数是从 `ACharacter` 继承来的，不需要在自己的类里重新声明。

### 为什么用 `Started` 而不是 `Triggered`

这两个 `ETriggerEvent` 的语义是不同的：

| 事件 | 触发时机 |
| --- | --- |
| `Started` | Action 从"未激活"跃迁到"开始激活"的**那一帧**，只发一次 |
| `Triggered` | 每次 Action 判定为"已触发"就发，无触发器时按住期间**每帧都发** |

写成 `Triggered` 也能运行，而且完全正常，这是因为 `IA_Jump` 上挂了「已按下」触发器，把 `Triggered` 限制成了只在按下的那一帧发出。

**问题在于，这样一来，C++ 代码的正确性就依赖于资产的配置了。** 如果哪天有人在编辑器里删掉了那个触发器，或者把它改成了 Hold，`Triggered` 就会恢复成每一帧都发出，`Jump()` 每秒会被调用 60 次。

`Jump()` 内部只是重复地设置同一个 `true`，它是幂等的，所以不会出问题。但是如果换成攻击、扔手雷或者开门这类**非幂等**的逻辑，同样的写法就会造成严重的后果，而且这种 bug 只有在别人修改了资产之后才会出现，非常难以定位。

**所以一次性的动作应该使用 `Started`，持续性的输入（比如移动和瞄准）应该使用 `Triggered`。** `Started` 是由引擎层保证的「按下瞬间」语义，与资产配置无关。

### 为什么必须绑 `Completed` → `StopJumping`

`Jump()` 会设置 `bPressedJump = true`，而 `CharacterMovementComponent` 每一帧都会检查这个标志。只要它为 true，并且 `JumpKeyHoldTime` 没有超过 `JumpMaxHoldTime`，就会持续施加一个向上的速度，「长按跳得更高」就是这样实现的。

如果不绑定 `StopJumping`，这个标志就永远不会被清除，这会带来两个后果：

- 一旦把 `JumpMaxHoldTime` 设成非 0 的值，短按和长按就会跳得一样高（因为引擎以为按键一直没有松开），高度控制完全失效；
- 残留的 `bPressedJump` 会干扰 `JumpMaxCount > 1` 时的多段跳判定。

默认情况下 `JumpMaxHoldTime = 0`，所以现在还看不出差别。**这是一种典型的「配置一改就出错」的隐藏 bug**，代码现在能够运行，并不代表它是正确的。

## 1.4 第一版的错法：不要自己重写 `Jump()`

第一版的写法是这样的：

```cpp
// 错误示范
void ARogueCharacter::Jump()
{
    PlayAnimMontage(JumpMontage);
    Super::Jump();
}
```

同时还在头文件里加了一个 `TObjectPtr<UAnimMontage> JumpMontage;`。

这种写法有三个问题。

**① 作业已经说明了「动画蓝图已经设置好」。** 动画蓝图依靠 `UCharacterMovementComponent::IsFalling()` 驱动状态机切换到滞空状态，如果再叠加一层 Montage，就会和状态机争抢同一个输出通道（也就是第二章遇到的 Slot 节点问题）。

**② 顺序错误。** `PlayAnimMontage` 写在了 `Super::Jump()` 的**前面**，它是无条件执行的。但是由 1.1 节可知，`Jump()` 只是设置标志位，跳跃本身随时可能被 `CheckJumpInput` 拒绝（比如在空中连按、`JumpMaxCount` 已经用完，或者正在下蹲）。结果就是**跳跃没有成功，动画却照样播放了**。

**③ 更本质的问题在于，这是把表现层塞进了输入层。** 攻击之所以需要 Montage，是因为攻击的动画不由移动状态决定，必须由代码显式地播放。而跳跃的动画完全可以由「是否在空中」这个状态推导出来，交给动画蓝图来处理，分层才更合理。

最终的处理方式是，把重写的 `Jump()` 和 `JumpMontage` 成员一起删掉，`BindAction` 直接绑定基类的 `&ACharacter::Jump`。

**这个错误的根源在于没有读透 1.1 节的源码。** 如果先弄清楚 `Jump()` 只是设置标志位，真正的执行在两层之外，就不会把动画播放放在那个位置。

## 1.5 跳跃手感参数

跳跃功能跑通之后，可以去 `CharacterMovementComponent` 里调整下面这几个值，感受一下差异（在 BP 的组件详情面板里修改，改完立即生效）：

| 参数 | 默认值 | 作用 |
| --- | --- | --- |
| `JumpZVelocity` | 420 | 起跳初速度，直接决定跳跃高度 |
| `AirControl` | 0.05 | 空中的水平操控能力，0 = 完全不能变向，1 = 和地面一样灵活 |
| `GravityScale` | 1.0 | 重力倍率，调大会让下落更快、跳跃更"利落" |
| `JumpMaxHoldTime` | 0 | 长按跳更高的最长持续时间，配合 `StopJumping` 使用 |
| `JumpMaxCount` | 1 | 最大跳跃次数，改成 2 就是二段跳 |

这些参数的直觉只能依靠手感来积累，在代码上没有什么可讲的。但是值得注意的是，**动作游戏的跳跃手感几乎全部取决于这五个数值**，理解它们比多写一百行代码更有用。

---

# 第二节：把需求翻译成状态机

爆炸桶是本次作业的主体。在写任何一行代码之前，先把需求整理成一个结构。

## 2.1 需求里藏着一个三状态机

把需求清单里和行为相关的几条挑出来：

- 受到伤害后，延迟 3 秒爆炸
- 延迟期间播放燃烧音效和粒子效果
- 爆炸时循环燃烧效果停止
- 爆炸只能发生一次

这四条描述的是同一个东西，也就是一个只有三个状态的小型状态机：

```text
   完好  ──(挨打)──>  引信燃烧中  ──(3秒到)──>  已爆炸
    │                    │                      │
  什么都不做          火焰+燃烧声            爆炸特效+音效+冲量
                                            火焰和燃烧声停止
```

一旦画出这张图，两个函数的职责也就自然确定了：

| 函数 | 职责 | 对应状态转移 |
| --- | --- | --- |
| `TakeDamage` | 判断该不该起爆，如果该，点燃引信 | 完好 → 引信燃烧中 |
| `Explode` | 引信烧完了，执行爆炸 | 引信燃烧中 → 已爆炸 |

## 2.2 最关键的认知：`TakeDamage` 不负责爆炸

很多人的第一反应是「挨打之后就爆炸」，然后发现需要延迟 3 秒，于是开始思考怎样在 `TakeDamage` 里「等待」。

这种思路是错误的。**挨打和爆炸是两个在时间上分离的事件，它们之间依靠定时器来连接。**

`TakeDamage` 只做「按下启动按钮」这一件事，然后**立刻返回**。3 秒之后，由 `FTimerManager` 主动调用 `Explode`。这和第二章「延迟 0.2 秒生成法球」是完全相同的结构：

```text
第二章：PrimaryAttack()  → SetTimer(0.2s) → AttackTimerElapsed()  → 生成法球
本次：  TakeDamage()     → SetTimer(3.0s) → Explode()             → 爆炸
```

**在 UE 里，凡是需要「延迟做某件事」，都应该使用定时器，而不是等待。** 游戏线程不能被阻塞，任何形式的「睡眠」都会让整个游戏卡死。

## 2.3 创建 C++ 类的正确姿势

这里有两个坑，值得单独记录下来。

### 坑一：在 Rider 里手写文件

在 Rider 的解决方案树里右键选择「新建 C++ 类」，得到的是下面这样一个文件：

```cpp
#pragma once

class exploding_barrel
{
public:

};
```

这是一个**普通的 C++ 类，而不是 UE 类**。它没有基类，没有 `UCLASS()`，没有 `GENERATED_BODY()`，也没有包含 `CoreMinimal.h` 和 `.generated.h`。

这样做的后果是，UBT 能够编译它（因为它是合法的 C++ 代码），但是 **UHT 不会为它生成反射代码**。所有写下的 `UPROPERTY` 和 `UFUNCTION` 全部失效，蓝图里看不到任何属性，也无法创建蓝图子类。而且这种失败是**静默的**，编译能够通过，只是什么都不工作。

**正确的做法是依次选择编辑器中的「工具」和「新建 C++ 类」，然后选择 Actor 作为基类。** 编辑器会生成正确的样板代码，并自动更新模块的源文件列表。

### 坑二：先建蓝图后建 C++ 类

如果先在 Content Browser 里创建了 `BP_ExplodingBarrel`，而这时 C++ 类还不存在，那么它的父类就是 `AActor`。

后来 C++ 类建好了，Rider 在 `UCLASS()` 的上方提示「没有派生的蓝图类」，这条提示的意思是，**这个 C++ 类和那个蓝图之间没有任何关系。**

修复的方法是在 BP 的「类设置」里把「父类」改成 `ExplodingBarrel`，或者删掉蓝图重新创建。修改之后，可以在资产的悬浮提示里进行验证：

```text
父类：              ActionRoguelike.ExplodingBarrel
Native Parent Class：ActionRoguelike.ExplodingBarrel
Is Data Only：      True
```

`Is Data Only: True` 是一个好的信号，它说明这个蓝图只用来填写资产，没有蓝图逻辑，符合「逻辑写在 C++ 里、资源放在蓝图里」的分工。在整个作业的过程中，都应该让它保持 Data Only 的状态。

**正确的顺序是先让 C++ 类编译通过，然后再从它创建蓝图子类**（在 C++ 类上右键，选择「基于此类创建蓝图类」）。

### 附带一个后续会遇到的现象

C++ 类修改了组件结构（增加或删除组件、修改默认值）之后，已经存在的蓝图子类有时不会立刻同步。如果发现蓝图里的组件对不上，先重新编译蓝图，或者重新打开编辑器，不要急着怀疑代码。

---

# 第三节：头文件设计

完整的头文件见[完整代码](#完整代码)，这里逐块解释设计的依据。

## 3.1 前向声明

```cpp
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ExplodingBarrel.generated.h"

class URadialForceComponent;
class UNiagaraComponent;
class UNiagaraSystem;
class USoundBase;
class UAudioComponent;
class UStaticMeshComponent;
```

和第一章、第二章一样，**头文件里只做前向声明，实际的 include 放到 cpp 文件里**。这样修改 `NiagaraComponent.h` 时，就不会导致所有包含了本头文件的翻译单元都重新编译。

有一个容易漏掉的地方，即使不写 `UStaticMeshComponent` 的前向声明，编译也一样能通过，因为 `GameFramework/Actor.h` 通过传递包含把它带了进来。

**但这属于依赖运气。** IWYU（Include What You Use）的原则是，用到的每一个类型，都应该由当前文件自己保证它可见，而不是指望别的头文件顺便把它带进来。一旦上游的头文件被重构，代码就会莫名其妙地编译失败。所以要么全部显式声明，要么全部不声明，**保持一致**，不要一半声明、一半不声明。

## 3.2 `UPROPERTY` 说明符的判断标准（本次作业最重要的一条）

这是整份作业里最容易出错、也最值得想清楚的一个地方。

第一版把所有成员都标记成了 `EditDefaultsOnly`，其中也包括两个组件：

```cpp
// 错误示范
UPROPERTY(EditDefaultsOnly, Category="Components")
TObjectPtr<UNiagaraComponent> BurntEffect;
```

**错误的原因在于**，`BurntEffect` 是要在构造函数里用 `CreateDefaultSubobject` 创建的**组件实例**，而不是一个可以替换的资产引用。把它标记成 `EditDefaultsOnly`，会让蓝图里出现一个可以编辑的对象引用框，修改它没有任何意义（因为组件早就已经被构造出来了），改错了还会留下悬空引用。

**正确的判断标准**如下：

| 成员类型 | 说明符 | 判断依据 |
| --- | --- | --- |
| 组件实例（`UNiagaraComponent`、`UAudioComponent`、`UStaticMeshComponent`、`URadialForceComponent`） | `VisibleAnywhere` | 构造函数已创建，不该被替换，但需要在面板里看到它的子属性（如网格资产、音效资产） |
| 资产引用（`UNiagaraSystem`、`USoundBase`、`UInputAction`） | `EditDefaultsOnly` | 是需要在蓝图里"填进去"的数据 |
| 配置参数（`float FuseDelay`） | `EditDefaultsOnly` | 需要调整的数值 |
| 运行时状态（`FTimerHandle`、`bool bExploded`） | 不加 `UPROPERTY` | 纯运行时数据，不需要序列化也不需要暴露 |

有一个容易混淆的地方，`VisibleAnywhere` 对**组件**是有用的。虽然面板上那个指针本身是只读的，但组件展开之后的子属性（比如静态网格体、Niagara 系统资产和音效等）仍然可以编辑，第七节配置资产的地方正是这里。

而 `VisibleAnywhere` 对一个 `float` 来说毫无价值，它只是把一个灰色的数字摆出来给人看。

### 关于 `FuseDelay` 该不该可编辑

第一版还考虑过另一种写法，既然延迟固定为 3 秒，那么使用 `VisibleAnywhere` 应该就可以了。

这个想法混淆了两件事。**「当前的设计值是 3 秒」并不等于「这个值应该被锁死」**，原因有两点：

- 策划要调整手感时，就得修改 C++ 并重新编译，而不是在面板里拖动一下；
- 如果想做变体（比如引信 0.5 秒的快速桶和引信 5 秒的慢速桶），只需要创建两个蓝图子类，填写不同的值，不需要改动任何代码。而如果把值写死，就得修改类。

判断的标准很简单，就是**这个值将来有没有可能需要调整**。如果有可能，就使用 `EditDefaultsOnly`。

真正永远不会改变的常量（比如数学常数、协议中的魔数）根本不应该进入反射系统，直接使用 `static constexpr` 就可以了，连 `UPROPERTY` 都不需要。而 `FuseDelay` 显然属于需要调整的那一类。

### 三层覆盖关系

`Radius` 和 `ImpulseStrength` 这类属性在 `URadialForceComponent` 的源码里本身就带有 `UPROPERTY(EditAnywhere, BlueprintReadWrite)`，所以在蓝图里可以直接修改。那么在 C++ 构造函数里给它们赋值还有意义吗？答案是有，因为这是在**设置默认值**。

```text
C++ 构造函数赋值   →  这个类所有实例的初始值，改代码要重编译
蓝图类里改        →  只影响这个蓝图子类，改完立即生效
关卡实例上改      →  只影响那一个桶
```

下层会覆盖上层。构造函数给出一个合理的默认值，让这个类拿出去就能直接使用；具体的参数调整放在蓝图里做，迭代起来更快。

**这里有一个一定会遇到的陷阱**。如果先在蓝图里修改了某个值（比如把 `Radius` 改成 1500），之后再去修改 C++ 构造函数里的默认值，**蓝图里的修改就会覆盖新的默认值**，因为蓝图记录了「这个属性已经被修改过」。

它的现象是，C++ 改了，但游戏里没有反应。这时检查蓝图详情面板里那个属性的右边有没有黄色的回退箭头（↩），如果有，就说明这个值被覆盖了，点击它就可以恢复继承。

## 3.3 函数声明与 `override`

```cpp
virtual float TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent,
                         AController* EventInstigator, AActor* DamageCauser) override;

void Explode();
```

第一版的写法是：

```cpp
// 错误示范
void TakeDamage();
```

**这并不是重写，而是新定义了一个同名的函数。** 参数一个都不能少，返回类型也必须是 `float`。

`override` 关键字在这里是一道关键的防线。如果没有它，签名写错时编译器**不会报错**，只会静默地生成一个永远不会被调用的新函数。运行之后会发现桶怎么也不爆炸，于是去检查定时器、检查资产、检查碰撞，唯独想不到问题出在函数签名上。

**所以要养成一个习惯，所有重写的虚函数一律加上 `override`，让编译器来帮忙检查。**

至于 `Explode()` 要不要加 `UFUNCTION()`，这里保留了它，但严格来说并不必要。因为 `SetTimer` 有一个模板重载，可以直接接受成员函数指针，不经过反射：

```cpp
template<class UserClass>
FORCEINLINE void SetTimer(FTimerHandle& InOutHandle, UserClass* InObj,
                          typename FTimerDelegate::TUObjectMethodDelegate<UserClass>::FMethodPtr InTimerMethod,
                          float InRate, bool InbLoop = false, float InFirstDelay = -1.f);
```

`UFUNCTION()` 只在两种情况下是必需的，一是使用 `SetTimer` 的 FName 版本（`SetTimer(Handle, this, FName("Explode"), ...)`），二是需要在蓝图里调用或者绑定这个函数。

**这一点和第二章的 `OnActorHit` 正好形成对照。** 那里的 `UFUNCTION()` 是**强制的**，因为 `AddDynamic` 绑定的是动态多播委托，必须通过反射按名字查找。同样是「把函数交给别人调用」，是否需要反射，取决于对方的调用机制。

---

# 第四节：构造函数

```cpp
AExplodingBarrel::AExplodingBarrel()
{
    PrimaryActorTick.bCanEverTick = false;

    BarrelMeshComponent = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("BarrelMeshComp"));
    RootComponent = BarrelMeshComponent;

    RadialForceComponent = CreateDefaultSubobject<URadialForceComponent>(TEXT("RadialForceComp"));
    RadialForceComponent->SetupAttachment(BarrelMeshComponent);

    BurningEffect = CreateDefaultSubobject<UNiagaraComponent>(TEXT("BurningEffectComp"));
    BurningEffect->SetupAttachment(BarrelMeshComponent);

    BurningSound = CreateDefaultSubobject<UAudioComponent>(TEXT("BurningSoundComp"));
    BurningSound->SetupAttachment(BarrelMeshComponent);

    BarrelMeshComponent->SetCollisionProfileName("PhysicsActor");
    BarrelMeshComponent->SetSimulatePhysics(true);

    BurningEffect->SetAutoActivate(false);
    BurningSound->SetAutoActivate(false);

    RadialForceComponent->SetAutoActivate(false);
    RadialForceComponent->bImpulseVelChange = true;
    RadialForceComponent->Radius = 750.f;
    RadialForceComponent->ImpulseStrength = 2500.f;
}
```

## 4.1 `PrimaryActorTick.bCanEverTick = false`

`Tick` 是 Actor 每一帧的回调。`bCanEverTick = false` 的意思是，**这个 Actor 永远不需要每帧更新，不要把它加入 Tick 列表。**

这个桶完全是**事件驱动**的，挨打时做事，定时器到期时做事，其他时候什么都不做。它根本没有重写 `Tick()`，如果开着这个开关，引擎每一帧都会为它做一次调度检查，并执行一个空函数。

单个桶的开销可以忽略不计。但如果关卡里放了 200 个桶，每一帧就会有 200 次毫无意义的调度。**这种「每一个都很小，但数量很大」的浪费，是性能问题的典型来源**，而且事后很难定位，因为在 profiler 里看到的是一片均匀的低开销，没有明显的热点。

Rider 和 UE 的类模板默认生成的是 `bCanEverTick = true`，这是一个为了方便新手而设置的不好的默认值。**新建一个 Actor 之后，第一件事就是判断它是否需要 Tick，如果不需要就关掉。**

需要注意区分两种 Tick：

| | 位置 | 本例中 |
| --- | --- | --- |
| Actor 级 Tick | `PrimaryActorTick.bCanEverTick` | 关掉 |
| 组件级 Tick | 蓝图组件详情面板的"启用 Tick 并开始" | **保持开启**，静态网格组件需要它来同步物理模拟的位置 |

关掉 Actor 级的 Tick，并不会影响组件。

## 4.2 组件创建与挂载

它的结构和第一章的相机、第二章的投射物完全一致：

```text
BarrelMeshComponent（Root）
├── RadialForceComponent
├── BurningEffect
└── BurningSound
```

### 为什么网格组件当根

`AActor` 是最基础的基类，里面什么都没有，既没有内置的网格，也**没有 RootComponent**。所以必须自己指定一个根组件，否则这个 Actor 连位置都没有。

与之对比，`ACharacter` 的继承链里已经带有 `USkeletalMeshComponent` 和 `UCapsuleComponent`，所以第一章只需要添加相机和弹簧臂。

让网格组件作为根组件是最省事的选择，原因和物理有关。**开启了物理模拟的组件会跟着物理引擎移动**，挂在它下面的子组件也会自动跟随，这正是这里想要的效果（桶被撞飞时，火焰也跟着飞）。反过来，如果把网格挂在一个没有开启模拟的根组件下面，物理模拟就会脱离父子关系，导致视觉上的错位。

### 为什么三个组件都要挂载

`URadialForceComponent` 派生自 `USceneComponent`，有自己的世界坐标，**爆炸的原点就是它的位置**。把它挂在根组件上，它就会跟着桶移动，桶滚到哪里，爆炸就发生在哪里。如果不挂载，它就没有父级，位置永远是世界原点 (0,0,0)。

`BurningEffect` 也是同样的道理，火焰要在桶的位置燃烧。

`BurningSound` 是一个 3D 空间音源，它的位置决定了玩家听到的方位和距离衰减。

## 4.3 物理配置：注意顺序

```cpp
BarrelMeshComponent->SetCollisionProfileName("PhysicsActor");
BarrelMeshComponent->SetSimulatePhysics(true);
```

作业要求「启用桶的物理模拟功能，使其能够对弹丸撞击产生的冲击力做出反应」，对应的就是这两行代码。

`PhysicsActor` 是引擎内置的碰撞预设，它的 Object Type 是 `PhysicsBody`，对大部分通道都是 Block。之所以使用它而不是默认预设，是因为默认预设不一定支持物理响应。

**在顺序上有讲究**。Profile 会重新设置碰撞响应，所以应该**先配置碰撞，再开启物理**。在构造函数里，两种顺序通常都不会出问题（因为构造阶段还没有进入物理场景），但养成正确的顺序习惯之后，在运行时动态切换碰撞设置的场景里就不会出错。

### 一个静默失败的坑

**如果静态网格资产没有碰撞体，`SetSimulatePhysics(true)` 就会静默地失败**，桶会一直飘在空中不动，而且没有任何报错。

`SM_OilBarrel` 自带碰撞体，所以没有遇到这个问题。但是如果使用 Engine Content 里的基础形状（需要在 Content Browser 的设置里勾选「显示引擎内容」），或者使用自己导入的模型，一定要先确认碰撞体是存在的。

这一条和第二章的经验一致，**与物理和碰撞相关的问题，绝大多数都是静默失败。**

## 4.4 关闭自动激活

```cpp
BurningEffect->SetAutoActivate(false);
BurningSound->SetAutoActivate(false);
RadialForceComponent->SetAutoActivate(false);
```

这三个组件默认都是 `bAutoActivate = true`。如果不关掉，会产生下面这些后果：

- `BurningEffect` 会让桶一放进关卡就开始冒火；
- `BurningSound` 会一直循环播放燃烧声；
- `RadialForceComponent` 会**每一帧都持续推开周围的所有物体**。

第三个后果尤其明显，关卡里的箱子会被一股看不见的力持续地推走。

`RadialForceComponent` 之所以有「自动激活」这个概念，是因为它有两种工作模式，详见 4.5 节。

## 4.5 `RadialForceComponent` 与冲量

```cpp
RadialForceComponent->bImpulseVelChange = true;
RadialForceComponent->Radius = 750.f;
RadialForceComponent->ImpulseStrength = 2500.f;
```

### 力与冲量：作业提示三的真正含义

作业的提示说「力是持续施加的，冲量是一次强烈的力作用」。这并不只是一句物理科普，它对应着 `URadialForceComponent` 源码里两条完全不同的代码路径：

```text
URadialForceComponent
├── TickComponent()   → 每帧遍历半径内的物理体，调 AddRadialForce
│                       只在组件被 Activate() 后运行
│                       用途：持续性的力场（漩涡、风区、引力井）
│
└── FireImpulse()     → 一次性调用，遍历半径内的物理体，直接改速度
                        与激活状态无关，随时可调
                        用途：爆炸、冲击波
```

爆炸是一个瞬间发生的事件，所以：

- 要使用 `FireImpulse()`，而不是 `Activate()`；
- 要设置 `bAutoActivate = false`，否则就会走 Tick 那条路径，持续地施加力。

**这两件事是一体的**，选择了冲量的路径，就必须关掉自动激活，否则就相当于两条路径同时在运行。

### `bImpulseVelChange` 为什么要忽略质量

在物理上，把冲量 J 施加到质量为 m 的物体上，速度的变化量是 `Δv = J / m`。同一次爆炸，10kg 的箱子会飞得很快，而 1000kg 的车几乎不动，这是符合真实情况的。

但是在游戏里，这会带来一个麻烦。关卡里各种物体的质量可能相差两三个数量级，而且质量往往是美术人员随手设置的（或者是根据网格的体积自动算出来的）。如果把 `ImpulseStrength` 调到让轻的物体看起来效果很好，重的物体就会纹丝不动；如果调到让重的物体能飞起来，轻的物体就会直接飞出天际。**这样手感就完全无法控制。**

`bImpulseVelChange = true` 的作用是，**把 `ImpulseStrength` 直接当作速度的变化量（cm/s）来使用，跳过除以质量的那一步。** 这样所有物体都会获得相同的初速度，爆炸的效果看起来是一致的，只需要调整一个数值，就能控制全局的手感。

在源码里，这个布尔值最终会变成传给 `AddImpulse` 的 `bVelChange` 参数。

这样做的代价是不够真实，但在游戏里，「可控」通常比「真实」更重要。**这是一种典型的、面向玩法的物理妥协**，值得记住有这类取舍存在。

### 数值与单位

| 属性 | 值 | 单位 | 说明 |
| --- | --- | --- | --- |
| `Radius` | 750 | 厘米 | 约 7.5 米的影响半径 |
| `ImpulseStrength` | 2500 | cm/s（因为开了 `bImpulseVelChange`） | 物体瞬间获得 25 m/s 的速度 |

需要注意，`Radius` 是**直接给成员变量赋值**，而不是调用 `SetRadius()`（这个函数并不存在）。UE 里的组件属性，有的提供了 Setter，有的没有提供，规律性不强，所以写之前最好直接去看头文件里的成员声明。

作业的排错提示中说「如果脉冲没有任何反应，请先尝试更大的值」，原因就在这里。默认情况下 `ImpulseStrength = 1000`，但是 `bImpulseVelChange = false`，除以质量之后，效果基本上等于零。

### `ObjectTypesToAffect`

此外还有一个数组成员 `ObjectTypesToAffect`，它控制冲量会影响哪些 Object Type。如果冲量对周围的物体没有反应，除了调大数值之外，还要检查目标物体的 Object Type 在不在这个数组里。它的默认值包含 `PhysicsBody`，所以对同样设置了 `PhysicsActor` 预设的物体是生效的。

---

# 第五节：`TakeDamage`

```cpp
float AExplodingBarrel::TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent,
                                   AController* EventInstigator, AActor* DamageCauser)
{
    float ActualDamage = Super::TakeDamage(DamageAmount, DamageEvent, EventInstigator, DamageCauser);

    if (bExploded)
    {
        return ActualDamage;
    }
    bExploded = true;

    BurningEffect->Activate();
    BurningSound->Play();

    GetWorldTimerManager().SetTimer(FuseTimerHandle, this,
                                    &AExplodingBarrel::Explode, FuseDelay, false);

    return ActualDamage;
}
```

## 5.1 前提：伤害系统是双端的

**`TakeDamage` 不会自己被调用。** 它是一个虚函数，必须有人主动调用 `UGameplayStatics::ApplyDamage`（或者 `ApplyPointDamage`、`ApplyRadialDamage`），引擎才会把调用转发到目标 Actor 的 `TakeDamage` 上。

完整的调用链路如下：

```text
弹丸命中 → OnActorHit 回调触发
        → 弹丸调 ApplyPointDamage(被击中的Actor, ...)
        → 引擎内部调用 该Actor->TakeDamage(...)
        → 桶被点燃
```

中间任何一个环节缺失，桶都不会爆炸。

**这决定了调试的顺序。** 在写 `TakeDamage` 的第一版时，里面只放一行 `UE_LOG`，先运行起来验证整条链路。

- 如果日志打印不出来，问题就出在**弹丸端**（没有调用 `ApplyDamage`，或者根本没有检测到碰撞）；
- 如果日志打印出来了，但是没有火焰，问题就出在**组件或者资产的分配**上。

如果不先做这个区分，就很容易出现下面这种情况。弹丸打在桶上，桶被物理撞击推得滚动起来（这是碰撞造成的，和伤害无关），但引信永远也不会点燃。于是开发者在桶的代码里反复检查构造函数、定时器和资产，而问题根本就不在这个类里。

本项目在第二章已经写好了 `ApplyPointDamage`，所以这条链路是通的。

## 5.2 逐行解析

### `Super::TakeDamage(...)` 放在最前面

基类的实现会做伤害修正（应用 `DamageType` 的倍率），检查 `bCanBeDamaged`，广播 `OnTakeAnyDamage` 事件，并返回实际生效的伤害值。

**为什么要把它放在守卫判断之前呢？** 因为桶就算已经被点燃了，它**仍然是「挨了打」**，基类的事件广播和伤害统计不应该被跳过，需要跳过的只是「再点一次火」这个动作。

这是一个需要自己权衡的设计点，没有唯一的答案，但必须有理由。如果放在守卫的后面，语义就变成了「已经点燃的桶完全免疫伤害」，这也是一种合理的设计（比如要做「点燃之后无敌」的机制），只是和当前的需求不符。

### 守卫判断 + 立刻置标志位

```cpp
if (bExploded)
{
    return ActualDamage;
}
bExploded = true;
```

这两行代码合在一起，实现了需求里的「**爆炸只能发生一次**」。

`bExploded = true` 必须在**任何表现代码之前**执行，这是为了防止重入。`Activate()` 和 `Play()` 这些调用在理论上可能会触发某些回调链，如果中间有什么调用又绕回到了 `TakeDamage`，由于标志位已经设置好了，就不会重复起爆。

这是一份成本很低的保险，只需要调整一行代码的位置，就能避免一整类难以复现的 bug。

### 命名上的一个小瑕疵

`bExploded` 的字面意思是「已爆炸」，但它实际表示的是「**引信已点燃**」。在 3 秒的引信期间，这个变量是 true，但桶还没有爆炸。

这不影响功能，但语义上有偏差，更准确的命名是 `bIsFused` 或者 `bTriggered`。这里记录下来作为提醒，**变量名应该描述它实际承载的状态，而不是它最终会导致的结果。**

### 激活两个组件

```cpp
BurningEffect->Activate();
BurningSound->Play();
```

这对应着需求中的「延迟期间播放燃烧音效和粒子效果」。

**需要注意这里的 API 是不对称的。** `UNiagaraComponent` 使用的是 `Activate()` 和 `Deactivate()`，而 `UAudioComponent` 使用的是 `Play()` 和 `Stop()`。

`UAudioComponent` 其实也继承了 `Activate()`（它是 `USceneComponent` 的方法），但音频组件惯用的接口是 `Play()`，因为它还可以带一个起始时间参数（`Play(float StartTime)`）。写代码时，按照各自惯用的接口来调用即可。

### 定时器

```cpp
GetWorldTimerManager().SetTimer(FuseTimerHandle, this,
                                &AExplodingBarrel::Explode, FuseDelay, false);
```

这里有五个参数，分别是句柄、对象、成员函数指针、延迟的秒数，以及**是否循环**。

最后那个 `false` 在第一版里**漏写了**。它的默认值恰好是 `false`，所以功能上碰巧是对的，但在 code review 里，「漏写」和「依赖默认值」是两种不同性质的问题。把它显式地写出来，读代码的人就不需要去查函数签名，也能确认这是一个一次性的定时器。

如果写成 `true`，后果是桶每隔 3 秒就爆炸一次，永远不会停止。

**`FTimerHandle` 是成员变量，而不是局部变量**，第二章已经遇到过这方面的问题（局部的句柄导致连续点击时生成了一大堆法球）。在这里，它的作用是如果将来需要「拆除引信」的功能，可以使用这个句柄来调用 `ClearTimer`。

---

# 第六节：`Explode`

```cpp
void AExplodingBarrel::Explode()
{
    BurningEffect->Deactivate();
    BurningSound->Stop();

    if (ExplosionEffect)
    {
        UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, ExplosionEffect, GetActorLocation());
    }

    if (ExplosionSound)
    {
        UGameplayStatics::PlaySoundAtLocation(this, ExplosionSound, GetActorLocation());
    }

    RadialForceComponent->FireImpulse();
}
```

这个函数是纯粹的「执行」，**里面没有任何条件判断**，因为该不该爆炸的判断已经在 `TakeDamage` 里做完了。它的结构是先停止旧的效果，再播放新的效果，最后施加物理冲量。

## 6.1 停止循环效果

```cpp
BurningEffect->Deactivate();
BurningSound->Stop();
```

这对应着需求中的「爆炸时循环燃烧效果停止」。开启了两个组件，就要关闭两个组件。

## 6.2 本作业最重要的设计判断：组件 vs 静态函数生成

这里有一个看起来很奇怪的不对称现象：

| 效果 | 存储形式 | 播放方式 |
| --- | --- | --- |
| 燃烧火焰 | `UNiagaraComponent`（组件） | `Activate()` |
| 燃烧音效 | `UAudioComponent`（组件） | `Play()` |
| 爆炸特效 | `UNiagaraSystem*`（资产引用） | `UNiagaraFunctionLibrary::SpawnSystemAtLocation()` |
| 爆炸音效 | `USoundBase*`（资产引用） | `UGameplayStatics::PlaySoundAtLocation()` |

**为什么同样是特效，处理方式完全不同？**

两者的区别不在于 API，而在于**生命周期的需求**。

### 组件的特征

- 会跟着 Actor 移动（桶被撞飞时，火焰也跟着飞）；
- 可以被反复地开启和关闭；
- **Actor 销毁时，它们也会一起被销毁**。

引信燃烧正好需要这三个特征，它要持续 3 秒，要跟着桶移动，还要在爆炸时被关掉。

### 一次性效果的特征

- 只播放一次，播放完就应该消失；
- **不需要跟着桶移动**，甚至在桶被销毁之后，爆炸也应该继续播放完；
- 没有「把它关掉」的需求。

如果把爆炸也做成组件，就会面临两个尴尬的问题：

1. 这个组件在桶的整个生命周期里都闲置着，只是为了最后那一下；
2. 桶一旦被销毁，正在播放的特效就会**瞬间消失**（第二章的法球爆炸就遇到过这个问题，`SpawnSoundAttached` 被 `Destroy()` 一起带走了，爆炸音只响了一瞬间）。

`SpawnSystemAtLocation` 生成的是一个**独立的临时 Actor**（`ANiagaraActor`），它在世界里独立存在，播放完之后会自己销毁。`PlaySoundAtLocation` 则更彻底，它连 Actor 都不生成，而是直接给音频引擎发送一条「在这个坐标播放这段声音」的指令，是纯粹的 fire-and-forget。

**判断的标准是，需要持续控制的效果使用组件，一次性 fire-and-forget 的效果使用静态函数。**

这条规律和第二章的「音效三件套」是同一套逻辑在不同场景下的应用：

| 场景 | 方式 | 原因 |
| --- | --- | --- |
| 施法音效（第二章） | `PlaySound2D` | UI 音，不需要空间位置 |
| 爆炸音效（第二章、本次） | `PlaySoundAtLocation` | 有位置，一次性，不能被 Destroy 带走 |
| 法球飞行循环音（第二章） | `UAudioComponent` 成员 | 要跟着法球飞、要能停 |
| 引信燃烧音（本次） | `UAudioComponent` 成员 | 要跟着桶、要在爆炸时停 |

## 6.3 判空：只判资产引用，不判组件

```cpp
if (ExplosionEffect) { ... }
if (ExplosionSound)  { ... }
```

**这两个之所以要判空**，是因为它们是在蓝图里手动填写的资产引用，如果忘了填写，就是 `nullptr`，直接传进去会导致崩溃。

**组件指针之所以不用判空**，是因为 `BurningEffect`、`RadialForceComponent` 这些组件都是由构造函数里的 `CreateDefaultSubobject` 创建的，必然不为空。

这里有一个很典型的错误，就是复制粘贴之后忘了修改变量名：

```cpp
// 错误示范
if (BurningEffect)          // ← 判的是组件（永远非空）
{
    UGameplayStatics::PlaySoundAtLocation(this, ExplosionSound, GetActorLocation());
}
```

守卫判断的是 `BurningEffect`（永远不为空），而保护的却是 `ExplosionSound`（可能为空）。**这个 `if` 的条件恒为真，写了也等于没写。**

这类 bug 的危险在于，编译器发现不了它（因为类型是合法的），它在逻辑上恒为真或者恒为假（所以不会立刻出错），只有在特定的条件下（比如忘了填写资产）才会导致崩溃。**所以连续编写结构相同的判空代码时，要格外留心。**

## 6.4 关于 `Destroy()`

第一版在 `FireImpulse()` 之后加了一行 `Destroy()`，后来又把它删掉了。

理由是**作业并没有要求在爆炸之后销毁桶。** 桶爆炸之后留在原地（可能换成一个焦黑的材质）是更常见的做法。而加上 `Destroy()` 会导致「爆炸之后桶凭空消失，地上没有任何痕迹」，视觉上会显得很突兀。

如果要加上它，位置必须在 `FireImpulse()` **之后**（这时冲量已经施加完毕），而且要清楚特效和音效不会受到影响，因为它们使用的正是 6.2 节所讲的独立生成方式。这也从反面印证了那个设计选择的价值。

## 6.5 需要的额外 include 与模块

```cpp
#include "NiagaraFunctionLibrary.h"     // SpawnSystemAtLocation
#include "Kismet/GameplayStatics.h"     // PlaySoundAtLocation
```

`Build.cs` 的 `PublicDependencyModuleNames` 里必须包含 `"Niagara"`，否则就会出现 **LNK2019 链接错误**，而且从报错信息里完全看不出是模块的问题。本项目在第二章已经加过这个模块了。

另外，严格来说，`GetWorldTimerManager()` 需要 `#include "TimerManager.h"`。不写也能编译通过（因为传递包含提供了它），但是按照 IWYU 原则，应该显式地包含它。

---

# 第七节：蓝图与资产配置

作业强调「**始终在蓝图中分配资源，而不是在 C++ 中分配**」，这是本次作业的一条硬性纪律。

## 7.1 为什么不能在 C++ 里硬编码路径

C++ 里有 `ConstructorHelpers::FObjectFinder`，可以按照路径来加载资产：

```cpp
// 反面教材，工业界严禁
static ConstructorHelpers::FObjectFinder<UNiagaraSystem>
    EffectAsset(TEXT("/Game/tharlevfx_tutorials/.../NS_Explosion"));
```

但是这样做有三个问题：

1. **资产一旦改名或者移动，加载就会静默地失败**，得到的是 `nullptr`，要到运行时才能发现；
2. **在编译期就把美术资源和代码绑死在了一起**，美术人员改一下文件夹结构，程序就得重新编译；
3. **破坏了 C++ 和蓝图的职责边界**，逻辑写在 C++ 里、数据放在蓝图里，这是 UE 的基本工作流。

正确的做法就是本次使用的做法，在 C++ 里声明 `EditDefaultsOnly` 的槽位，然后在蓝图子类里填写资产。这和第一章把 `IA_Move` 填进 `Input_Move`、第二章把 `BP_MagicProjectile` 填进 `ProjectileClass` 是同一套模式。

## 7.2 需要配置的五处

| 位置 | 属性 | 资产 |
| --- | --- | --- |
| `BarrelMeshComp` 组件 → 静态网格体 | 静态网格体 | `SM_OilBarrel` |
| `BurningEffectComp` 组件 → Niagara | Niagara 系统资产 | `NS_Flames` |
| `BurningSoundComp` 组件 → 音效 | 音效 | `MSS_Environmental_BarrelAftermath` |
| 类默认值 → Effects | `Explosion Effect` | `NS_Explosion` |
| 类默认值 → Effects | `Explosion Sound` | `MSS_Environmental_BarrelExplode` |

**前三项在组件的详情面板里**（因为组件使用的是 `VisibleAnywhere`，指针本身是只读的，但它的子属性可以编辑）；**后两项在类默认值面板的 Effects 分类下**（因为它们是 `EditDefaultsOnly` 的资产引用）。

这种分布正好印证了 3.2 节的判断标准，只要说明符选对了，配置的位置就是自然而然的。

## 7.3 配错的两个资产

**① 循环燃烧音填成了 `MSS_Enemy_StatusEffect...`**

作业指定的是 `MSS_Environmental_BarrelAftermath`。由于资产的名字很相似，在下拉框里搜索时又操作得太快，所以很容易选错。

验证的方法是打开这个 MetaSound，确认它是**循环**播放的。如果把一次性的音效塞进 `UAudioComponent`，它播放完就会停止，引信还剩两秒，声音却已经没有了。这种「部分正常」的 bug 最容易被忽略。

**② 火焰特效填成了 `NS_Burning`**

作业指定的是 `NS_Flames`。两者可能是相似的资产，但既然作业点名了，就应该使用点名的那一个，因为如果后面的章节复用了这个资产的某个参数，用错了就会留下隐患。

## 7.4 Niagara 的首次运行现象

作业的排错提示专门写了这一条，**首次运行时，粒子系统可能还在编译 Niagara 脚本，导致特效第一次不显示。**

看不到爆炸效果时，先重新运行一次再做判断，不要急着去查代码，这样能省掉半个小时的无效排查。

---

# 完整代码

## RogueCharacter.cpp（跳跃相关部分）

```cpp
void ARogueCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);

    UEnhancedInputComponent* EnhancedInput = CastChecked<UEnhancedInputComponent>(PlayerInputComponent);

    // ...第一章、第二章的绑定...

    EnhancedInput->BindAction(Input_Jump, ETriggerEvent::Started,   this, &ACharacter::Jump);
    EnhancedInput->BindAction(Input_Jump, ETriggerEvent::Completed, this, &ACharacter::StopJumping);
}
```

对应的头文件成员如下：

```cpp
UPROPERTY(EditDefaultsOnly, Category="Input")
TObjectPtr<UInputAction> Input_Jump;
```

## ExplodingBarrel.h

```cpp
// Fill out your copyright notice in the Description page of Project Settings.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ExplodingBarrel.generated.h"

class URadialForceComponent;
class UNiagaraComponent;
class UNiagaraSystem;
class USoundBase;
class UAudioComponent;
class UStaticMeshComponent;

UCLASS()
class ACTIONROGUELIKE_API AExplodingBarrel : public AActor
{
    GENERATED_BODY()

public:
    AExplodingBarrel();

protected:
    // ---------- 配置参数 ----------
    UPROPERTY(EditDefaultsOnly, Category="Explosion")
    float FuseDelay = 3.0f;

    // ---------- 一次性效果的资产引用 ----------
    UPROPERTY(EditDefaultsOnly, Category="Effects")
    TObjectPtr<UNiagaraSystem> ExplosionEffect;

    UPROPERTY(EditDefaultsOnly, Category="Effects")
    TObjectPtr<USoundBase> ExplosionSound;

    // ---------- 组件 ----------
    UPROPERTY(VisibleAnywhere, Category="Components")
    TObjectPtr<UNiagaraComponent> BurningEffect;

    UPROPERTY(VisibleAnywhere, Category="Components")
    TObjectPtr<UAudioComponent> BurningSound;

    UPROPERTY(VisibleAnywhere, Category="Components")
    TObjectPtr<UStaticMeshComponent> BarrelMeshComponent;

    UPROPERTY(VisibleAnywhere, Category="Components")
    TObjectPtr<URadialForceComponent> RadialForceComponent;

    // ---------- 运行时状态 ----------
    FTimerHandle FuseTimerHandle;
    bool bExploded = false;

    // ---------- 函数 ----------
    virtual float TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent,
                             AController* EventInstigator, AActor* DamageCauser) override;

    UFUNCTION()
    void Explode();
};
```

## ExplodingBarrel.cpp

```cpp
#include "ExplodingBarrel.h"

#include "PhysicsEngine/RadialForceComponent.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"
#include "Components/AudioComponent.h"
#include "Kismet/GameplayStatics.h"

AExplodingBarrel::AExplodingBarrel()
{
    PrimaryActorTick.bCanEverTick = false;

    BarrelMeshComponent = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("BarrelMeshComp"));
    RootComponent = BarrelMeshComponent;

    RadialForceComponent = CreateDefaultSubobject<URadialForceComponent>(TEXT("RadialForceComp"));
    RadialForceComponent->SetupAttachment(BarrelMeshComponent);

    BurningEffect = CreateDefaultSubobject<UNiagaraComponent>(TEXT("BurningEffectComp"));
    BurningEffect->SetupAttachment(BarrelMeshComponent);

    BurningSound = CreateDefaultSubobject<UAudioComponent>(TEXT("BurningSoundComp"));
    BurningSound->SetupAttachment(BarrelMeshComponent);

    // 先配置碰撞，再开物理
    BarrelMeshComponent->SetCollisionProfileName("PhysicsActor");
    BarrelMeshComponent->SetSimulatePhysics(true);

    // 关掉自动激活，否则一放进关卡就冒火、响声、推东西
    BurningEffect->SetAutoActivate(false);
    BurningSound->SetAutoActivate(false);
    RadialForceComponent->SetAutoActivate(false);

    // 走冲量路径，而非每帧持续施力
    RadialForceComponent->bImpulseVelChange = true;   // 忽略质量，手感可控
    RadialForceComponent->Radius = 750.f;             // 厘米
    RadialForceComponent->ImpulseStrength = 2500.f;   // cm/s
}

float AExplodingBarrel::TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent,
                                   AController* EventInstigator, AActor* DamageCauser)
{
    // 基类要做伤害修正和事件广播，即使已点燃也不该跳过
    float ActualDamage = Super::TakeDamage(DamageAmount, DamageEvent, EventInstigator, DamageCauser);

    // 需求：爆炸只能发生一次
    if (bExploded)
    {
        return ActualDamage;
    }
    bExploded = true;   // 在任何表现代码之前置位，防重入

    // 需求：延迟期间播放燃烧音效和粒子效果
    BurningEffect->Activate();
    BurningSound->Play();

    // 需求：延迟 3 秒爆炸。最后一个 false = 不循环
    GetWorldTimerManager().SetTimer(FuseTimerHandle, this,
                                    &AExplodingBarrel::Explode, FuseDelay, false);

    return ActualDamage;
}

void AExplodingBarrel::Explode()
{
    // 需求：爆炸时循环燃烧效果停止
    BurningEffect->Deactivate();
    BurningSound->Stop();

    // 一次性效果：生成独立实例，不受本 Actor 生命周期影响
    // 这两个是蓝图里手填的资产，必须判空
    if (ExplosionEffect)
    {
        UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, ExplosionEffect, GetActorLocation());
    }

    if (ExplosionSound)
    {
        UGameplayStatics::PlaySoundAtLocation(this, ExplosionSound, GetActorLocation());
    }

    // 额外效果：一次性冲量，而非持续力
    RadialForceComponent->FireImpulse();
}
```

---

# 知识链路总览

## 完整时序图

```text
【玩家按下鼠标左键】
        │
        │  （第二章的完整攻击链路）
        ▼
【法球飞行并命中油桶】
        │
        │  OnActorHit 回调触发
        ▼
UGameplayStatics::ApplyPointDamage(HitActor, ...)
        │
        │  构造 FPointDamageEvent
        ▼
AActor::TakeDamage(...)  ← 引擎转发到目标 Actor
        │
        ▼
AExplodingBarrel::TakeDamage(...)         ★ 我们重写的入口
        │
        ├─ Super::TakeDamage()            → 伤害修正、广播 OnTakeAnyDamage
        │
        ├─ if (bExploded) return;         → 需求"只能炸一次"
        ├─ bExploded = true;              → 防重入
        │
        ├─ BurningEffect->Activate();     → 需求"延迟期间播放粒子"
        ├─ BurningSound->Play();          → 需求"延迟期间播放音效"
        │
        └─ SetTimer(FuseDelay = 3.0s, bLoop = false)
                  │
                  │  ⏳ 3 秒后，FTimerManager 主动调用
                  ▼
AExplodingBarrel::Explode()
        │
        ├─ BurningEffect->Deactivate();   → 需求"爆炸时循环效果停止"
        ├─ BurningSound->Stop();
        │
        ├─ SpawnSystemAtLocation()        → 独立 ANiagaraActor，自生自灭
        ├─ PlaySoundAtLocation()          → fire-and-forget
        │
        └─ RadialForceComponent->FireImpulse()
                  │
                  │  遍历 Radius 内、ObjectTypesToAffect 匹配的物理体
                  │  bImpulseVelChange = true → 直接改速度，跳过除以质量
                  ▼
           周围物体被推开
```

## 三条贯穿本次作业的主线

### 主线一：意图与执行的分层

```text
跳跃：  Jump()（置标志） → CheckJumpInput()（判定） → DoJump()（改速度）
移动：  AddMovementInput()（累加） → CharacterMovementComponent（执行）
爆炸：  TakeDamage()（点火）  → FTimerManager（计时） → Explode()（执行）
```

这三个例子的结构是相同的，**接收意图的函数从来不直接产生结果。** 想清楚了这一点，就不会把 Montage 的播放塞进 `Jump()`，也不会想在 `TakeDamage` 里「等待 3 秒」。

### 主线二：生命周期决定存储形式

```text
需要持续控制、跟随、可关闭  →  组件（CreateDefaultSubobject + Activate/Play）
一次性、播完即弃、不怕宿主销毁  →  资产引用 + 静态函数生成
```

这条规律同时也决定了 `UPROPERTY` 说明符的选择：

```text
组件      →  VisibleAnywhere   （已创建，不该替换，但子属性要能配置）
资产引用  →  EditDefaultsOnly  （需要在蓝图里填进去）
配置参数  →  EditDefaultsOnly  （需要调整）
运行时状态 →  不加 UPROPERTY    （不序列化、不暴露）
```

**说明符选对了，在蓝图里配置的位置就是自然而然的**（见 7.2 节的那张表）。如果选错了，就会出现「面板上有一个修改了也没用的输入框」这样的症状。

### 主线三：静默失败的排查顺序

本次作业涉及的静默失败点如下：

| 现象 | 静默原因 |
| --- | --- |
| 手写的类所有 `UPROPERTY` 都不生效 | 缺 `UCLASS`/`GENERATED_BODY`，UHT 不生成反射代码 |
| 蓝图和 C++ 类没关系 | 蓝图父类是 `AActor`，先建蓝图后建类 |
| `TakeDamage` 从不被调用 | 签名写错，变成了一个新函数（没加 `override`） |
| 桶飘在空中不动 | 网格没有碰撞体，`SetSimulatePhysics` 失败 |
| 冲量没反应 | `ImpulseStrength` 太小 / `ObjectTypesToAffect` 不匹配 |
| 判空 `if` 恒真 | 复制粘贴后忘改变量名 |
| C++ 改了默认值但游戏里没变 | 蓝图记录了覆盖值 |
| 首次运行没有爆炸特效 | Niagara 脚本还在编译 |

**排查的原则是，先分段定位问题出在哪一端，再去检查细节。** 具体到这次作业，就是先用 `UE_LOG` 确认 `TakeDamage` 有没有被调用，这一行日志就能把排查范围缩小一半。

---

# 本次实际踩过的十四个坑

下面按照出现的顺序来整理。对每一条来说，记下「错误的认知」比记下「正确的写法」更有价值。

| # | 错误 | 暴露的认知盲区 |
| --- | --- | --- |
| 1 | 在 Rider 里手写 C++ 类，缺 `UCLASS`/`GENERATED_BODY` | 不清楚 UHT 和 UBT 的分工，以为"能编译"就等于"是 UE 类" |
| 2 | 先建蓝图后建 C++ 类，父类变成 `AActor` | 不理解蓝图子类的父类是创建时确定的 |
| 3 | 重写 `Jump()` 手动播 Montage | 没读透 `Jump()` 只是置标志位；把表现层塞进了输入层 |
| 4 | 只绑 `Started`，没绑 `Completed` → `StopJumping` | 不知道 `bPressedJump` 需要被清除 |
| 5 | 用 `ETriggerEvent::Triggered` 而非 `Started` | 让 C++ 正确性依赖于资产配置 |
| 6 | 组件用 `EditDefaultsOnly` | 混淆了"组件实例"和"资产引用" |
| 7 | `TObjectPtr<UDamageType>` 应为 `TSubclassOf<UDamageType>`（后来判断为不需要，删除） | 不清楚 DamageType 在 UE 里是当作**类**传递的 |
| 8 | `void TakeDamage()` 签名完全错误 | 不知道重写必须完全匹配签名，且没加 `override` 让编译器检查 |
| 9 | `FuseDelay` 没加 `UPROPERTY`；后来又想用 `VisibleAnywhere` | 把"当前值固定"误当成"该锁死"；不理解 `VisibleAnywhere` 对数值毫无价值 |
| 10 | `SetTimer` 漏写 `bInLoop` 参数 | 依赖默认值而非显式表达意图 |
| 11 | 加了没有需求依据的 `Destroy()` | 需求之外的自由发挥 |
| 12 | 判空判错对象：`if (BurningEffect)` 保护 `ExplosionSound` | 复制粘贴后忘改变量名，编译器抓不到 |
| 13 | `#include "NiagaraFunctionLibrary.h"` 写了两遍 | 手滑 |
| 14 | 资产配错两处：燃烧音、火焰特效 | 下拉框搜索时手快，没对照作业清单核验 |

**其中 3、6、8、9 属于概念性的错误**（不理解某个机制），**5、10、12 属于工程习惯上的问题**（代码现在能运行，但很脆弱），**1、2、14 属于流程上的问题**（顺序错了，或者没有核对）。

第二类问题最值得警惕，因为它们**不会立刻表现为 bug**，只有在别人修改了配置，或者代码被复用到新的场景时，才会暴露出来。

---

# 易错点速查表

| 症状 | 最可能的原因 | 检查位置 |
| --- | --- | --- |
| 编译报"找不到 Niagara 头文件"或 LNK2019 | 模块依赖没加 | `Build.cs` 的 `PublicDependencyModuleNames` |
| 所有 `UPROPERTY` 在蓝图里都看不到 | 类不是通过编辑器创建的，缺 `UCLASS`/`GENERATED_BODY` | 头文件 |
| 蓝图里找不到 C++ 类的属性 | 蓝图父类不对 | 蓝图"类设置 → 父类" |
| 空格键没反应 | `Input_Jump` 在蓝图里没赋值 / IMC 里没映射 / IMC 没注册 | 蓝图类默认值、`IMC_DefaultPlayer` |
| 跳跃动画不播 | 动画蓝图没配 / 自己又叠了 Montage 抢 Slot | 动画蓝图 |
| 短按和长按跳一样高 | 没绑 `Completed` → `StopJumping` | `SetupPlayerInputComponent` |
| 按住空格连续跳 | 用了 `Triggered` 且 IA 上没有 Pressed 触发器 | `ETriggerEvent` / `IA_Jump` |
| 桶飘在空中不动，无报错 | 静态网格资产没有碰撞体 | 网格资产的碰撞设置 |
| 桶被撞得滚动，但永远不炸 | `TakeDamage` 从没被调用 —— 弹丸端没有 `ApplyDamage` | `RogueProjectileMagic` 的命中回调 |
| `TakeDamage` 不被调用，但弹丸确实调了 `ApplyDamage` | 签名写错，变成了新函数 | 加 `override` 让编译器报错 |
| 桶一放进关卡就冒火/响声 | 组件 `bAutoActivate` 没关 | 构造函数 |
| 关卡里的箱子被看不见的力持续推走 | `RadialForceComponent` 的 `bAutoActivate` 没关 | 构造函数 |
| 引信声音播到一半就停 | 音效资产不是 Looping | MetaSound 资产 |
| 爆炸了但周围物体纹丝不动 | ①`ImpulseStrength` 太小 ②`bImpulseVelChange` 没开 ③目标 ObjectType 不在 `ObjectTypesToAffect` ④目标没开物理模拟 | 构造函数 / 目标物体 |
| 首次运行没有爆炸特效 | Niagara 脚本还在编译 | 重跑一次 |
| 忘填爆炸特效导致 crash | 资产引用没判空 | `Explode()` |
| 判空写了但还是 crash | 判空判错了对象（恒真的 `if`） | 逐字核对变量名 |
| 改了 C++ 默认值但游戏里没变 | 蓝图记录了覆盖值 | 蓝图面板属性右侧的黄色回退箭头 |
| 桶炸了一次又一次，无限循环 | `SetTimer` 的 `bInLoop` 传了 `true` | `TakeDamage` |
| 连续挨打起爆两次 | 缺 `bExploded` 守卫 | `TakeDamage` |

---

# 遗留待办

### ① 爆炸位置改用 `Hit.ImpactPoint`

目前爆炸总是从桶的**中心**发生。

```cpp
UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, ExplosionEffect, GetActorLocation());
```

如果弹丸打在桶的边缘，在视觉上会有轻微的错位。

`ApplyPointDamage` 传进来的 `DamageEvent`，它的实际类型是 `FPointDamageEvent`（`FDamageEvent` 的派生类），里面带有命中点、命中法线和被击中的具体组件。取出的方式如下：

```cpp
if (DamageEvent.IsOfType(FPointDamageEvent::ClassID))
{
    const FPointDamageEvent* PointEvent = static_cast<const FPointDamageEvent*>(&DamageEvent);
    FVector ImpactPoint = PointEvent->HitInfo.ImpactPoint;
    // 存起来，Explode 时使用
}
```

需要注意，这些数据要在 `TakeDamage` 里取出来，并保存为成员变量，因为 `Explode` 是 3 秒之后由定时器调用的，那时候 `DamageEvent` 早就已经不存在了。

这和第二章的待办①（法球爆炸的位置）是**同一个问题的两个实例**，也和「角色发射法球时要使用 Socket」属于同一类问题，效果都应该出现在准确的位置上，只是数据的来源不同：

| 场景 | 位置数据来源 | 为什么 |
| --- | --- | --- |
| 角色发射法球 | `GetSocketLocation()` | 位置由骨骼动画决定，随时在变 |
| 碰撞产生的爆炸 | `Hit.ImpactPoint` | 位置由物理查询决定 |
| 静态物体自身的效果 | `GetActorLocation()` | 位置就是自己 |

### ② `bExploded` 改名为 `bIsFused`

变量名应该描述它实际承载的状态（引信已点燃），而不是最终结果（已爆炸）。

### ③ 爆炸后的视觉痕迹

现在爆炸之后，桶仍然是一个完好的橙色油桶，只是周围的东西飞走了。可以考虑下面两种做法：

- 爆炸之后用 `SetMaterial` 换成焦黑的材质；
- 或者切换成一个破损的网格资产。

这比直接调用 `Destroy()` 更有说服力。

### ④ 连锁引爆

爆炸时使用 `UGameplayStatics::ApplyRadialDamage` 对周围造成伤害，附近的桶收到伤害之后，会各自点燃引信。

这个练习的价值在于，**它要求把伤害系统的两端都写一遍**，桶既是接收方（`TakeDamage`），又变成了施加方（`ApplyRadialDamage`）。同时还要处理「不要伤害自己」的问题，这和第二章的自伤问题属于同一类。

### ⑤ 拆除引信

现在 `FuseTimerHandle` 被保存成了成员变量，但从来没有被使用过。可以加上一个「引信燃烧期间，再受到某种伤害就会熄灭」的机制，用 `GetWorldTimerManager().ClearTimer(FuseTimerHandle)` 来取消定时器。

---

# 作业一完成检查清单

## 第一部分：跳跃

- [x] 读过 `ACharacter::Jump`、`CheckJumpInput`、`UCharacterMovementComponent::DoJump` 的源码
- [x] 创建 `IA_Jump`，值类型为 Digital (bool)
- [x] 在 `IMC_DefaultPlayer` 中映射到空格键
- [x] 头文件声明 `TObjectPtr<UInputAction> Input_Jump`，标 `EditDefaultsOnly`
- [x] 蓝图类默认值里给 `Input_Jump` 赋值为 `IA_Jump`
- [x] `ETriggerEvent::Started` 绑 `&ACharacter::Jump`
- [x] `ETriggerEvent::Completed` 绑 `&ACharacter::StopJumping`
- [x] **没有**自己重写 `Jump()` 或手动播放跳跃 Montage
- [x] 跳跃动画由动画蓝图自动播放
- [x] 调过 `JumpZVelocity` / `AirControl` 感受手感差异

## 第二部分：类结构

- [x] 通过**编辑器**创建 C++ 类，基类为 `AActor`
- [x] 类名 `AExplodingBarrel`，A 前缀 + PascalCase
- [x] 蓝图子类的父类确认为 `ExplodingBarrel`（不是 `AActor`）
- [x] 蓝图保持 `Is Data Only: True`
- [x] 头文件用前向声明，实际 include 在 cpp

## 第二部分：成员声明

- [x] 四个组件用 `VisibleAnywhere`
- [x] 两个一次性效果资产用 `EditDefaultsOnly`
- [x] `FuseDelay` 用 `EditDefaultsOnly`，默认 3.0f
- [x] `FTimerHandle` 和 `bExploded` **不加** `UPROPERTY`
- [x] 所有对象引用用 `TObjectPtr<>` 而非裸指针
- [x] `TakeDamage` 签名完全匹配基类，带 `virtual` 和 `override`

## 第二部分：构造函数

- [x] `PrimaryActorTick.bCanEverTick = false`
- [x] 静态网格组件设为 `RootComponent`
- [x] 其余三个组件 `SetupAttachment(RootComponent)`
- [x] 先 `SetCollisionProfileName("PhysicsActor")`，再 `SetSimulatePhysics(true)`
- [x] `BurningEffect`、`BurningSound`、`RadialForceComponent` 三者 `SetAutoActivate(false)`
- [x] `bImpulseVelChange = true`
- [x] `Radius` 和 `ImpulseStrength` 设了合理默认值

## 第二部分：逻辑

- [x] `Super::TakeDamage` 在守卫判断之前调用
- [x] `bExploded` 守卫实现"只能炸一次"
- [x] `bExploded = true` 在任何表现代码之前置位
- [x] 燃烧特效用 `Activate()`，燃烧音效用 `Play()`
- [x] `SetTimer` 显式传 `bInLoop = false`
- [x] `Explode` 里停止两个循环组件
- [x] 一次性特效用 `SpawnSystemAtLocation`，一次性音效用 `PlaySoundAtLocation`
- [x] 两个资产引用都判空
- [x] `FireImpulse()` 而非 `Activate()`

## 第二部分：资产与模块

- [x] `Build.cs` 中有 `"Niagara"` 模块依赖
- [x] `BarrelMeshComp` → `SM_OilBarrel`
- [x] `BurningEffectComp` → `NS_Flames`
- [x] `BurningSoundComp` → `MSS_Environmental_BarrelAftermath`（确认是 Looping）
- [x] `Explosion Effect` → `NS_Explosion`
- [x] `Explosion Sound` → `MSS_Environmental_BarrelExplode`
- [x] 没有在 C++ 里用 `ConstructorHelpers` 硬编码任何资产路径

## 运行验证

- [x] 空格键跳跃，动画正常
- [x] 法球击中桶 → 火焰起、燃烧声起
- [x] 3 秒后爆炸：火焰停、燃烧声停、爆炸特效和音效播放
- [x] 周围物理物体被推开
- [x] 连续击中同一个桶，不会重复起爆
- [x] 桶可以被撞得滚动（物理模拟正常）

---

# 术语表

| 术语 | 含义 |
| --- | --- |
| **`bPressedJump`** | `ACharacter` 的成员标志，表示"玩家想跳"，由 `Jump()` 置位、`StopJumping()` 清除 |
| **`CheckJumpInput`** | `ACharacter` 每帧调用的判定函数，读 `bPressedJump` 并决定是否真的起跳 |
| **`DoJump`** | `UCharacterMovementComponent` 的方法，真正修改 `Velocity.Z` 的地方 |
| **`JumpZVelocity`** | 起跳初速度，决定跳跃高度 |
| **`JumpMaxHoldTime`** | 长按跳更高的最长持续时间，为 0 时长按无效 |
| **`ETriggerEvent::Started`** | Enhanced Input 事件，输入开始激活的那一帧，只发一次 |
| **`ETriggerEvent::Completed`** | Enhanced Input 事件，输入结束时发出 |
| **`TakeDamage`** | `AActor` 的虚函数，伤害的**接收端**，由引擎在 `ApplyDamage` 后转发调用 |
| **`FDamageEvent`** | 伤害事件基类，`FPointDamageEvent` 和 `FRadialDamageEvent` 是其派生类 |
| **`URadialForceComponent`** | 径向力组件，有"持续施力"（Tick）和"一次性冲量"（`FireImpulse`）两条路径 |
| **`FireImpulse`** | 一次性遍历半径内物理体并施加冲量，与组件激活状态无关 |
| **`bImpulseVelChange`** | 为 true 时把 `ImpulseStrength` 当作速度变化量，跳过除以质量 |
| **`ObjectTypesToAffect`** | `URadialForceComponent` 的数组成员，控制影响哪些 Object Type |
| **`bAutoActivate`** | 组件是否在 BeginPlay 时自动激活，多数效果组件默认为 true |
| **`PrimaryActorTick.bCanEverTick`** | Actor 级 Tick 开关，事件驱动的 Actor 应设为 false |
| **`PhysicsActor`** | 引擎内置碰撞预设，Object Type 为 `PhysicsBody`，适用于物理模拟物体 |
| **静默失败** | 代码逻辑错误但既不报错也不崩溃，只是功能不工作 —— UE 物理与反射相关问题的常见形态 |
| **Is Data Only** | 蓝图属性，为 True 表示该蓝图只有默认值配置、没有蓝图脚本逻辑 |

---

# 参考资料

- [Epic Games：Character Movement Component](https://dev.epicgames.com/documentation/en-us/unreal-engine/movement-components-in-unreal-engine)
- [Epic Games：Enhanced Input](https://dev.epicgames.com/documentation/en-us/unreal-engine/enhanced-input-in-unreal-engine)
- [Epic Games：Gameplay Timers](https://dev.epicgames.com/documentation/unreal-engine/gameplay-timers-in-unreal-engine?lang=en-US)
- [Epic Games：Physics in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/physics-in-unreal-engine)
- [Epic Games：Collision in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/collision-in-unreal-engine)
- [Epic Games：Overview of Niagara Effects](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-niagara-effects-for-unreal-engine)
- [Epic Games：Properties（UPROPERTY 说明符）](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-uproperties)
- [Tom Looman：Unreal Engine 5 C++ Timers](https://tomlooman.com/unreal-engine-cpp-timers/)
- [Tom Looman：Unreal Engine C++ Complete Guide](https://tomlooman.com/unreal-engine-cpp-guide/)
