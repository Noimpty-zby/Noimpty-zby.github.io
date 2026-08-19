---
title: UE5 C++ 作业二复盘：黑洞引力与传送接力，深度理解时序控制与物理逻辑
date: 2026-08-15 20:00:00
categories:
  - [课外, UE5-Looman]
tags:
  - C++
  - ActionRoguelike
  - 定时器(Timer)
  - 物理引力(RadialForce)
  - 传送系统
  - 架构重构
description: ActionRoguelike 课程 Assignment 2 的深度复盘。通过重构弹丸基类建立继承体系，实现具备“引力吞噬”逻辑的黑洞弹和“两段式计时接力”的传送弹。重点探讨负值 RadialForce 的量级、多定时器句柄管理以及利用 Instigator 实现跨 Actor 逻辑通讯。
cover: /img/covers/UE5-ActionRoguelike-Assignment1.svg
series: UE5 ActionRoguelike
privacy: protected
sitemap: false
private_section: 课外
---

# 前言

这是我跟随 Tom Looman 学习 UE5 C++ 时，对 **Assignment 2** 的完整复盘。

如果说作业一练习的是“瞬间的事件”（如爆炸桶受到伤害立即起爆），那么作业二的核心就是 **“过程的控制”**。我们需要处理持续 5 秒的黑洞引力，以及分阶段进行的传送逻辑。

本次使用的开发环境：
- Unreal Engine `5.6.1`
- Rider 
- 项目名称：`ActionRoguelike`

---

## 目录

- [第一节：弹丸基类的重构逻辑](#第一节弹丸基类的重构逻辑)
- [第二节：黑洞弹——百万级负力的黑箱](#第二节黑洞弹——百万级负力的黑箱)
- [第三节：传送弹——FTimerHandle 的接力赛](#第三节传送弹——FTimerHandle的接力赛)
- [第四节：角色层实现与输入绑定](#第四节角色层实现与输入绑定)
- [知识链路总览](#知识链路总览)
- [本次实际踩过的十四个坑](#本次实际踩过的十四个坑)
- [易错点速查表](#易错点速查表)

---

# 第一节：弹丸基类的重构逻辑

## 1.1 为什么要重构？
在动手写黑洞之前，我发现魔法弹、黑洞、传送弹有 90% 的组件是重合的。如果每个类都去写一遍组件创建代码，会造成极大的维护压力。

**设计决策**：
- **基类 `ASProjectileBase`**：负责所有弹药共有的“物理外壳”（碰撞球）、“动力系统”（移动组件）和“表现外壳”（粒子/音效组件）。
- **具体类**：只负责特定的业务逻辑。

## 1.2 核心代码与深度分析

### SProjectileBase.h
```cpp
UCLASS(Abstract) // 设计决策：标记为抽象类，防止在编辑器中直接放置
class ACTIONROGUELIKE_API ASProjectileBase : public AActor
{
    GENERATED_BODY()

protected:
    // 使用 TObjectPtr 是 UE5 的标准，利于内存审计
    UPROPERTY(VisibleAnywhere, Category = "Components")
    TObjectPtr<USphereComponent> SphereComponent;

    UPROPERTY(VisibleAnywhere, Category = "Components")
    TObjectPtr<UProjectileMovementComponent> ProjectileMovementComponent;

    UPROPERTY(VisibleAnywhere, Category = "Components")
    TObjectPtr<UNiagaraComponent> LoopedNiagaraComponent;

public:
    ASProjectileBase();
};
```

### SProjectileBase.cpp
```cpp
ASProjectileBase::ASProjectileBase()
{
    // 1. 建立根组件：弹丸的所有逻辑都基于这个物理球
    SphereComponent = CreateDefaultSubobject<USphereComponent>(TEXT("SphereComp"));
    RootComponent = SphereComponent;
    
    // 2. 移动组件：负责抛射物轨迹计算
    ProjectileMovementComponent = CreateDefaultSubobject<UProjectileMovementComponent>(TEXT("ProjectileMoveComp"));
    ProjectileMovementComponent->InitialSpeed = 2000.f;
    ProjectileMovementComponent->ProjectileGravityScale = 0.0f; // 弹丸通常不收重力影响
}
```

---

# 第二节：黑洞弹——百万级负力的黑箱

黑洞的设计目标：像一个移动的“吸尘器”，吸入周围开启物理模拟的方块并销毁。

## 2.1 物理引力：`URadialForceComponent`
**分析**：我起初设置力为 `-2000`，方块纹丝不动。
**原因**：虚幻物理力的单位受质量影响。要克服重型方块的摩擦力，力必须达到**百万级**。

### 核心实现：
```cpp
ASBlackHoleProjectile::ASBlackHoleProjectile()
{
    // 1. 设置重叠：黑洞应穿透一切而非撞碎
    SphereComponent->SetCollisionResponseToAllChannels(ECR_Overlap);

    RadialForceComponent = CreateDefaultSubobject<URadialForceComponent>(TEXT("RadialForceComp"));
    RadialForceComponent->SetupAttachment(SphereComponent);
    
    RadialForceComponent->Radius = 750.f;
    RadialForceComponent->ForceStrength = -5000000.f; // 设计决策：负五百万保证吸引力足够

    // 2. 过滤：使用 ConvertToObjectType 将频道转为类型查询，排除 Pawn
    RadialForceComponent->RemoveObjectTypeToAffect(UEngineTypes::ConvertToObjectType(ECC_Pawn));
}
```

## 2.2 吞噬逻辑：销毁的边界
```cpp
void ASBlackHoleProjectile::OnSphereOverlap(...)
{
    // 逻辑拓展：必须检查 IsSimulatingPhysics，否则黑洞会吞掉地板
    if (OtherActor && OtherComp && OtherComp->IsSimulatingPhysics() && OtherActor != GetInstigator())
    {
        OtherActor->Destroy();
    }
}
```

---

# 第三节：传送弹——FTimerHandle 的接力赛

传送弹（Dash Projectile）是逻辑最复杂的部分。它不是一次性触发的，而是一个延时链。

## 3.1 时序控制设计
传送行为被拆解为三段，依靠 `FTimerHandle` 接力：

### 1. 爆炸准备（SDashProjectile.cpp）
```cpp
void ASDashProjectile::BeginPlay()
{
    Super::BeginPlay();
    // 0.2s 后引爆。设计决策：给玩家反应时间，观察飞行路径
    GetWorldTimerManager().SetTimer(TimerHandle_Explode, this, &ASDashProjectile::Explode, 0.2f);
}
```

### 2. 爆炸执行（停止运动）
```cpp
void ASDashProjectile::Explode()
{
    // 幂等性保护：防止撞墙和定时器重复触发爆炸
    GetWorldTimerManager().ClearTimer(TimerHandle_Explode);

    // 立即停止弹丸，使其“悬停”在空中展示特效
    ProjectileMovementComponent->StopMovementImmediately();
    
    // 播放爆炸特效
    UGameplayStatics::SpawnSystemAtLocation(this, ExplosionEffect, GetActorLocation());

    // 开启第二段计时：再等 0.2s 传送，给视觉留白
    GetWorldTimerManager().SetTimer(TimerHandle_Teleport, this, &ASDashProjectile::TeleportInstigator, 0.2f);
}
```

### 3. 正式传送（SDashProjectile.cpp）
```cpp
void ASDashProjectile::TeleportInstigator()
{
    AActor* MyInstigator = GetInstigator(); // 依靠 Instigator 找回发射者
    if (MyInstigator)
    {
        // 为什么用 TeleportTo？
        // 分析：它带碰撞检查。若终点在墙里，它会尝试寻找空位，防止玩家卡死。
        MyInstigator->TeleportTo(GetActorLocation(), MyInstigator->GetActorRotation());
    }
    Destroy();
}
```

---

# 第四节：角色层实现与输入绑定

在角色类中，我使用了 Enhanced Input 进行绑定。

## 4.1 发起者（Instigator）的传承
生成弹丸时，必须设置 `Instigator`，否则传送弹找不到“家”。

```cpp
void ASCharacter::DashAttack_Elapsed()
{
    FVector SpawnLoc = GetMesh()->GetSocketLocation(MuzzleSocketName);
    FRotator SpawnRot = GetControlRotation();

    FActorSpawnParameters Params;
    Params.Instigator = this; // 核心：告诉弹丸我是它的主人
    
    GetWorld()->SpawnActor<AActor>(DashProjectileClass, SpawnLoc, SpawnRot, Params);
}
```

---

# 本次实际踩过的十四个坑

| # | 错误现象 | 暴露的认知盲区 | 解决逻辑 |
| :--- | :--- | :--- | :--- |
| 1 | 黑洞引力设为 -2000 吸不动东西 | 忽略了质量与力（Force）的换算关系 | 将力提升至五百万量级 |
| 2 | 在 Overlap 里直接调用 `Destroy()` | 黑洞碰到第一个方块后“自毁”了 | 改为销毁 `OtherActor` |
| 3 | 传送弹撞墙后在同一位置炸两次 | 未在 Explode 入口 ClearTimer | 增加定时器清理逻辑保护幂等性 |
| 4 | 黑洞经过地板时地图出现大洞 | 没加 `IsSimulatingPhysics` 过滤 | 仅对动态物理物体执行销毁 |
| 5 | 传送后角色由于位置偏移卡在地下 | 使用了 SetActorLocation 强行改坐标 | 换用具备安全检查的 `TeleportTo` |
| 6 | 基类组件标为 `EditDefaultsOnly` | 导致在蓝图里无法指定 Niagara 资源 | 组件实例必须用 `VisibleAnywhere` |
| 7 | 传送后的爆炸特效播一瞬就消失 | 将特效设为了组件，随弹丸 Destroy 一起消失了 | 使用 `SpawnSystemAtLocation` 创建独立特效 |
| 8 | 弹丸飞出去没特效、没声音 | 忘记在派生类 BeginPlay 调用 `Super::BeginPlay` | 基类生命周期函数必须显式执行 |
| 9 | 传送瞬间视角乱跳 | 传送时传入了弹丸的 Rotation | 传送时保持 Instigator 原有的 Rotation |
| 10 | 黑洞吸走了玩家 | 忘记排除 `ECC_Pawn` 对象类型 | 使用 RemoveObjectTypeToAffect 过滤 |
| 11 | 黑洞的 Radius 设得太小 | 导致方块还没进入力场就被碰撞球销毁了 | 确保 Radius 大于 SphereRadius |
| 12 | 没加 `UFUNCTION()` 导致 AddDynamic 失败 | AddDynamic 依赖反射系统，必须显式标记 | 增加宏标记处理回调 |
| 13 | 弹丸直接穿墙而过不触发爆炸 | 传送弹碰撞响应设为了 Overlap | 传送弹需设为 Block 才能触发 Hit 事件 |
| 14 | 魔法弹、黑洞、传送弹代码大量重复 | 缺乏重构意识，在三个文件里写同样的组件 | 建立 ASProjectileBase 建立继承链 |

---

# 易错点速查表

| 症状 | 检查点 |
| :--- | :--- |
| **黑洞引力没反应** | 1. 检查力是否是负数 2. 数值是否达到百万级 |
| **传送弹不传送** | 1. 检查 Spawn 时的 `Instigator` 2. 检查 Timer 是否被意外 Clear |
| **技能按键没反应** | 1. 蓝图中是否给类引用赋值 2. IMC 是否注册了 IA |
| **物理方块被吸飞但没销毁** | 1. 碰撞球半径是否太小 2. Generate Overlap Events 是否勾选 |
| **编译报“无法解析的外部符号”** | 检查 Build.cs 是否添加了 `"Niagara"` 模块 |

---

# 结语

作业二通过对“时间”和“空间”的控制，展示了 UE C++ 架构的灵活性。**继承**让代码整洁，**定时器**让交互具备节奏感，而**物理过滤**则保证了世界的安全。

完成这份作业后，我不仅掌握了技能系统的底层实现，更理解了“逻辑分层”在大型项目中的重要性。下一步，向属性系统进发！
