---
title: UE5 C++ 第一章复盘：从零创建 ActionRoguelike 到可移动、可观察、带动画的第三人称角色
date: 2026-07-31 13:00:00
categories:
  - [课外, 游戏开发, UE5-Looman]
tags:
  - C++
  - Enhanced Input
  - ActionRoguelike
description: 完整梳理 ActionRoguelike 第一章的内容，包括创建项目、编写 C++ 角色、添加 Actor 组件、搭建第三人称相机、配置 Enhanced Input、实现相对于镜头的移动，以及配置动画蓝图，并解释每一步为什么要这样做。
cover: /img/covers/UE5-ActionRoguelike-Chapter1.svg
series: UE5 ActionRoguelike
privacy: protected
sitemap: false
private_section: 课外
---

# 前言

本文是 Tom Looman《UE5 C++》第一章 **Project Setup** 的完整复盘。

本章使用的开发环境如下：

- Unreal Engine `5.6.1`
- Rider
- Visual Studio 2022 Build Tools / MSVC 编译工具链
- 项目名称：`ActionRoguelike`
- 项目类型：Games、Blank、C++

这一章表面上只是把项目运行起来，但实际上已经搭建了一条完整的第三人称角色控制链路，具体包括下面这些步骤：

1. 创建 C++ 项目和测试地图。
2. 创建继承自 `ACharacter` 的角色类。
3. 创建它的蓝图子类并配置角色模型。
4. 使用 Spring Arm 和 Camera Component 组成第三人称相机。
5. 使用 Enhanced Input 将 WASD 和鼠标输入转换为 Input Action。
6. 将 Input Action 绑定到 C++ 成员函数。
7. 实现角色移动和镜头旋转。
8. 将固定世界坐标移动升级为相对于镜头方向的移动。
9. 给角色配置 Skeletal Mesh 和 Animation Blueprint。

完成之后的效果是：

- WASD 可以控制角色移动；
- 鼠标可以控制镜头上下、左右旋转；
- 角色始终沿镜头的水平朝向移动；
- 摄像机遇到障碍物会自动收缩，避免穿墙；
- Manny 模型可以根据角色的运动状态播放动画。

这篇文章不只记录写了哪些代码，还会重点解释下面几个问题：

- 为什么要写这段代码；
- C++、蓝图、输入资源、组件和动画之间是什么关系；
- 每个修改解决了什么问题；
- 本章出现过的报错和容易混淆的地方。

---

# 一、先建立整章的总体认识

在进入具体步骤之前，先认识一下本章里最重要的几条关系。

## 1. C++ 类、蓝图类和关卡实例

本章创建了三个不同层级的对象：

| 层级 | 本章中的对象 | 主要职责 |
| --- | --- | --- |
| C++ 类 | `ARogueCharacter` | 定义稳定的组件结构、输入绑定和移动逻辑 |
| 蓝图类 | `BP_playerCharacter` | 基于 C++ 类配置模型、动画、输入资源和组件默认参数 |
| 关卡实例 | 拖进地图中的 `BP_playerCharacter` | 真正存在于当前世界、可以被玩家控制的角色对象 |

可以把它们之间的关系理解为：

```text
ARogueCharacter：角色的程序设计图
BP_playerCharacter：在设计图基础上完成的角色模板
关卡中的角色：根据模板真正创建出来的对象
```

这里最容易混淆的一点是：

> 修改蓝图类默认值，不等于只修改关卡中的某一个对象。

例如 `Input_Move` 使用了 `EditDefaultsOnly`，所以它要在 `BP_playerCharacter` 的 **类默认值（Class Defaults）** 中配置。修改这个值，会改变该蓝图类今后创建的所有实例所使用的默认配置。

如果需要让不同的角色使用不同的输入资源，可以再创建不同的蓝图子类，而不是去修改关卡中的某一个实例。

## 2. 输入、角色、相机和动画的完整链路

本章最终形成的数据流可以概括为：

```text
键盘/鼠标
    ↓
IMC_DefaultPlayer（按键映射）
    ↓
IA_Move / IA_Look（输入行为）
    ↓
UEnhancedInputComponent::BindAction
    ↓
Move() / Look()（C++ 回调函数）
    ↓
移动：CharacterMovement → Capsule → Mesh
观察：ControlRotation → SpringArm → Camera
    ↓
Animation Blueprint 读取移动状态并输出动画姿势
```

这个顺序非常重要，因为后面学习攻击、冲刺、交互和技能输入时，仍然会反复用到类似的结构。

## 3. “拥有关系”和“空间挂接关系”不是一回事

本章先用 `CreateDefaultSubobject` 创建组件，再用 `SetupAttachment` 建立组件之间的层级。这两步解决的是两个不同的问题：

| 问题 | 对应代码 | 含义 |
| --- | --- | --- |
| 谁拥有这个组件？ | `CreateDefaultSubobject<>()` | 组件是当前角色默认拥有的子对象 |
| 组件在空间中跟随谁？ | `SetupAttachment()` | 建立 Scene Component 的父子变换关系 |

下面用相机组件的两行代码来举例：

```cpp
CameraComponent =
    CreateDefaultSubobject<UCameraComponent>(TEXT("CameraComp"));

CameraComponent->SetupAttachment(SpringArmComponent);
```

第一句的含义是：

> 当前正在构造的 `ARogueCharacter` 对象，拥有一个 `UCameraComponent` 子对象。

第二句的含义是：

> 在空间层级中，Camera Component 挂在 Spring Arm Component 的下面。

所以「角色拥有相机」和「相机挂在弹簧臂上」是两个同时成立的关系，但它们的含义并不相同。

---

# 二、创建 ActionRoguelike C++ 项目

## 1. 项目配置

创建项目时，选择的选项如下：

- Games
- Blank
- C++
- Desktop
- Maximum Quality
- 项目名：`ActionRoguelike`

选择 C++ 项目，意味着 Unreal 不只会创建 Content 资源目录，还会建立 C++ 模块、源码目录和编译规则。

项目创建好以后，几个常见目录的职责如下：

| 目录 | 作用 | 是否应手动管理 |
| --- | --- | --- |
| `Content` | 蓝图、模型、动画、材质、Input Action 等 `.uasset` 资源 | 主要通过 Content Browser 管理 |
| `Source` | C++ 头文件、源文件和 `.Build.cs` | 需要纳入版本控制 |
| `Config` | 项目和引擎配置文件 | 需要纳入版本控制 |
| `Binaries` | 编译后的二进制结果 | 通常可以重新生成 |
| `Intermediate` | Unreal Build Tool 的中间产物 | 通常可以重新生成 |
| `Saved` | 日志、自动保存、缓存等 | 通常不作为核心源码 |

### 为什么资源最好在 Content Browser 中移动？

Unreal 的资源之间保存的是资产引用。如果直接通过 Windows 文件管理器移动 `.uasset` 文件，引擎就没有机会更新这些引用，也来不及创建 Redirector，引用关系就可能因此断开。

所以模型、动画、蓝图等资源，最好都在 Unreal 的 Content Browser 中移动和重命名。

## 2. 创建并保存测试地图

把关卡保存到 `Content/ActionRoguelike/Maps` 目录下，名称为：

```text
P_OpenWorldTestMap
```

把地图单独放进 `Maps` 文件夹，可以避免它和角色、输入、模型等资源混在一起。

地图是角色和其他 Actor 实际运行的世界。C++ 类和蓝图类都只是模板，只有当它们的实例被创建到世界里时，才能和场景发生交互。

## 3. Rider、编译器和 Unreal Build Tool 分别做什么？

这三者并不是同一个东西，它们的分工如下：

| 工具 | 主要职责 |
| --- | --- |
| Rider | 编写代码、代码提示、跳转、调试和调用构建流程 |
| MSVC / Visual Studio Build Tools | 真正把 C++ 源码编译成机器代码 |
| Unreal Build Tool（UBT） | 读取模块规则、组织 Unreal 项目的编译过程 |

所以安装了 Rider，并不代表系统里已经有了完整的 C++ 编译器。Rider 更像是一个工作台，MSVC 才是真正执行编译的工具，而 UBT 负责告诉编译器，当前的 Unreal 模块应该怎样构建。

---

# 三、创建第一个角色 C++ 类

## 1. 为什么继承 Character？

在编辑器里依次点击下面的菜单：

```text
Tools → New C++ Class → Character
```

然后把新类命名为：

```text
RogueCharacter
```

Unreal 会按照命名规范，生成名为下面这样的类：

```cpp
ARogueCharacter
```

类名前面的 `A` 表示这个类型属于 Actor 体系，可以被放进世界里。

它的继承关系可以简化为：

```text
UObject
  └─ AActor
      └─ APawn
          └─ ACharacter
              └─ ARogueCharacter
```

继承链上的每一层，提供的能力各不相同：

| 类型 | 主要能力 |
| --- | --- |
| `UObject` | Unreal 对象、反射、垃圾回收等基础能力 |
| `AActor` | 可以存在于 World 中，拥有 Transform 和组件 |
| `APawn` | 可以被 Controller 控制 |
| `ACharacter` | 提供适合直立角色的胶囊体、网格体和角色移动组件 |
| `ARogueCharacter` | 当前项目自己的角色逻辑 |

之所以不直接继承 `AActor`，是因为第三人称角色还需要下面这些能力：

- 被 PlayerController 控制；
- 使用 Capsule 进行碰撞；
- 使用 Skeletal Mesh 显示角色；
- 使用 Character Movement 处理移动、重力、地面检测等。

而这些能力 `ACharacter` 都已经提供了，没有必要从零开始重新编写。

## 2. ACharacter 默认提供了什么？

创建 `BP_playerCharacter` 之后，可以看到角色已经自带了下面这些组件：

- `CapsuleComponent`
- `ArrowComponent`
- `Mesh`
- `CharacterMovementComponent`

它们的职责分别是：

| 组件 | 作用 |
| --- | --- |
| Capsule | 角色的主要碰撞体，同时通常也是 Root Component |
| Arrow | 在编辑器中显示 Actor 本地 `+X` 正方向 |
| Mesh | 显示角色的 Skeletal Mesh 和动画 |
| Character Movement | 处理角色移动、速度、重力、落地等 |

需要注意的是，蓝色的箭头是 `ArrowComponent`，并不是摄像机。

## 3. Public 和 Private 文件夹不是 public/private 关键字

Unreal 模块里经常能看到下面这两个文件夹：

```text
Source/ActionRoguelike/Public
Source/ActionRoguelike/Private
```

它们表达的是模块头文件在组织上的可见性：

- `Public` 中的头文件可以作为模块对外接口；
- `Private` 中的文件主要供模块内部使用。

而类定义里的下面这几个关键字：

```cpp
public:
protected:
private:
```

属于 C++ 本身的访问控制。两者解决的是不同的问题，不能混为一谈。

---

# 四、创建 BP_playerCharacter 蓝图子类

## 1. 为什么 C++ 角色上还要再创建蓝图？

基于 `ARogueCharacter` 创建一个蓝图子类，命名为：

```text
BP_playerCharacter
```

这里采用的是 Unreal 中很常见的一种分工方式：

| C++ | Blueprint |
| --- | --- |
| 组件结构 | 模型、动画和资源引用 |
| 输入绑定 | 可视化参数调整 |
| 移动、观察等核心逻辑 | 为不同角色制作不同默认配置 |
| 适合版本管理的稳定代码 | 适合快速迭代的内容配置 |

所以蓝图并不是脱离 C++ 的另一套角色，而是 `ARogueCharacter` 的子类。

## 2. 配置最初的角色 Mesh

一开始给 Mesh 配置的是 `TutorialTPP` 模型，并做了下面的调整：

```text
Location Z = -90
Rotation Z = -90°
```

### 为什么 Z 要设为 -90？

`ACharacter` 中 Capsule 的原点通常位于胶囊体的中心，而角色模型的原点一般在脚底附近。

如果 Mesh 保持在 `(0, 0, 0)`，人物的脚底就会位于胶囊体的中心，看起来就像悬在半空中。所以要把 Mesh 往下移动，让脚底接近胶囊体的底部。

### 为什么旋转 Z 最终是 -90°？

模型导入时的正面方向，不一定和 Unreal Actor 的本地 `+X` 方向一致。

调整旋转之后，人物的正面就和 Arrow Component 所指示的 `+X` 方向对齐了。这样以后使用前向向量移动时，就不容易出现「角色向前移动，模型却横着走或者倒着走」的现象。

这里调整的是 Mesh 相对于 Capsule 的局部变换，并没有旋转整个角色 Actor。

## 3. Auto Possess Player = Player 0

把角色设置为：

```text
Auto Possess Player = Player 0
```

`Possess` 可以理解为 Controller 获得了某个 Pawn 的控制权。

这项设置的作用是：

> 游戏开始以后，让本地第一个玩家的 PlayerController 自动控制这个角色实例。

但是它只解决了「谁控制谁」的问题，并不会自动实现 WASD 移动。

要让角色真正动起来，还需要完成下面几件事：

- 输入资源；
- 按键映射；
- Input Component 绑定；
- C++ 移动函数。

---

# 五、添加第三人称相机组件

## 1. 先在头文件中声明组件

在 `RogueCharacter.h` 中加入前向声明：

```cpp
class UCameraComponent;
class USpringArmComponent;
```

然后声明两个成员变量：

```cpp
UPROPERTY(VisibleAnywhere, Category = "Components")
TObjectPtr<USpringArmComponent> SpringArmComponent;

UPROPERTY(VisibleAnywhere, Category = "Components")
TObjectPtr<UCameraComponent> CameraComponent;
```

## 2. 为什么头文件中使用前向声明？

头文件目前只需要知道一件事：

> 存在名为 `UCameraComponent` 和 `USpringArmComponent` 的类型。

因为这里保存的是指针式的引用，编译器并不需要立即知道这些类完整的内部结构，所以可以先用前向声明。

等到真正调用这些类型的函数或者创建对象时，`.cpp` 文件才需要包含完整的头文件：

```cpp
#include "Camera/CameraComponent.h"
#include "GameFramework/SpringArmComponent.h"
```

这样做可以减少头文件之间不必要的依赖，从而避免因为修改某个头文件而引起大范围的重新编译。

## 3. TObjectPtr 是什么？

```cpp
TObjectPtr<UCameraComponent>
```

可以先把它理解为：

> 一种用来保存 Unreal `UObject` 引用的指针包装类型。

它和 `std::unique_ptr`、`std::shared_ptr` 采用的并不是同一套生命周期管理方式。

Camera Component 和 Spring Arm Component 都属于 Unreal 对象，它们由 Unreal 的对象系统和角色的组件生命周期来管理，不应该用普通的 `new` 和 `delete` 去手动管理。

## 4. UPROPERTY 的作用

```cpp
UPROPERTY(VisibleAnywhere, Category = "Components")
```

这一行里各部分的含义如下：

| 写法 | 作用 |
| --- | --- |
| `UPROPERTY` | 让 Unreal Header Tool 和反射系统识别这个成员 |
| `VisibleAnywhere` | 可以在编辑器中查看这个引用，但不能随意替换引用 |
| `Category="Components"` | 在 Details 面板中归入 Components 分类 |

`VisibleAnywhere` 限制的是 `CameraComponent` 这个成员引用本身，并不代表 Camera Component 内部的所有参数都不能调整。

## 5. 在构造函数中真正创建组件

仅仅在头文件里声明成员变量，并没有创建出真正的组件。

还需要在 `ARogueCharacter` 的构造函数中加入下面的代码：

```cpp
SpringArmComponent =
    CreateDefaultSubobject<USpringArmComponent>(TEXT("SpringArmComp"));
SpringArmComponent->SetupAttachment(RootComponent);

CameraComponent =
    CreateDefaultSubobject<UCameraComponent>(TEXT("CameraComp"));
CameraComponent->SetupAttachment(SpringArmComponent);
```

## 6. CreateDefaultSubobject 到底创建了谁的子对象？

以下面这句为例：

```cpp
CameraComponent =
    CreateDefaultSubobject<UCameraComponent>(TEXT("CameraComp"));
```

把它拆开来理解：

- `CreateDefaultSubobject<>()`：创建当前类默认拥有的子对象；
- `<UCameraComponent>`：创建出来的具体类型；
- `TEXT("CameraComp")`：该组件在 Unreal 对象系统中的名称；
- `CameraComponent =`：把创建结果保存到成员变量。

所以它创建的是：

> 一个类型为 `UCameraComponent`、由当前正在构造的 `ARogueCharacter` 对象所拥有的默认子对象。

这里的「默认」意味着，每一个 `ARogueCharacter` 以及它的蓝图子类的实例，都会默认带有这个组件。

这里的「子对象」既不是 C++ 继承中的「子类」，也不单单是指空间层级中的「子组件」，它首先表达的是对象之间的所有权。

## 7. SetupAttachment 建立空间层级

构造完成之后，核心的组件层级如下：

```text
CapsuleComponent（Root）
├─ Mesh
└─ SpringArmComponent
   └─ CameraComponent
```

`SetupAttachment` 建立的关系是：

- Spring Arm 的相对位置和旋转基于 Root Component；
- Camera 的相对位置和旋转基于 Spring Arm；
- Capsule 移动时，Spring Arm 和 Camera 会一起跟随。

「挂在根组件上」并不等于放到了胶囊体的表面上。如果相对位置为零，两个组件的原点就会重合。

## 8. 为什么要使用 Spring Arm？

如果直接把 Camera 固定在角色的后方，镜头就很容易穿过墙壁。

Spring Arm 相当于一根用来控制摄像机距离和碰撞的伸缩杆，它有下面这些特点：

- `Target Arm Length` 控制摄像机与角色之间的目标距离；
- 起点跟随角色；
- 遇到障碍物时自动缩短；
- 障碍物消失后恢复长度；
- 可以跟随 Controller 的观察旋转。

在 `BP_playerCharacter` 中做如下调整：

```text
Spring Arm Relative Location Z = 80
Target Arm Length = 300
```

把 Spring Arm 的起点抬高到人物上半身附近，比只移动 Camera 更合理，因为这样摄像机的观察起点和碰撞检测的起点会一起被抬高。

## 9. 测试 Spring Arm 碰撞

创建一个 Cube，把它放在角色和摄像机之间，并确认下面这些设置：

```text
Do Collision Test = 开启
Probe Channel = Camera
Probe Size = 12
Cube 对 Camera 通道的响应 = Block
```

当 Cube 挡住弹簧臂时，会发生下面这些事情：

- Spring Arm 检测到 Camera 通道上的阻挡；
- Camera 被拉近到障碍物前方；
- Cube 不会被推走；
- 角色也不会被 Spring Arm 推动。

可以看到，发生变化的是摄像机最终所在的位置，而不是障碍物的位置。

## 10. Details 面板不见了怎么办？

在关卡编辑器中，可以通过下面的菜单：

```text
Window → Details → Details 1
```

把 Details 面板重新打开。

如果整个布局都出现了异常，也可以尝试恢复默认布局：

```text
Window → Load Layout → Default Editor Layout
```

---

# 六、建立 Enhanced Input 输入资源

## 1. 为什么不直接在代码中判断 W、A、S、D？

Enhanced Input 把「物理按键」和「游戏行为」分开了。

例如：

```text
W 键不是“前进逻辑”
W 键只是被映射到 IA_Move 的一种输入来源
```

这样一来，以后就可以把下面这些输入：

- W 键；
- 手柄左摇杆；
- 其他平台的输入设备；

都映射到同一个 `IA_Move` 上，而 C++ 中的 `Move()` 并不需要知道输入来自哪种设备。

## 2. 创建 Input Action

在下面这个目录中：

```text
Content/ActionRoguelike/Input
```

创建两个 Input Action：

```text
IA_Move
IA_Look
```

它们的 Value Type 都设置为：

```text
Axis2D
```

这是因为它们都需要同时表示两个方向的值：

| Input Action | X | Y |
| --- | --- | --- |
| `IA_Move` | 前后 | 左右 |
| `IA_Look` | 水平观察 | 垂直观察 |

这里采用的是本章实际使用的轴约定。轴的含义并不是引擎固定不变的，而是由 Mapping Context 和 C++ 代码共同约定的。

## 3. 创建 Input Mapping Context

接着创建一个 Input Mapping Context：

```text
IMC_DefaultPlayer
```

Input Mapping Context 的职责是：

> 把具体设备的输入映射到 Input Action 上，并且在数据送到 Input Action 之前应用 Modifier。

本章的移动映射如下：

| 按键 | Modifier | 最终 Axis2D 值 | 含义 |
| --- | --- | --- | --- |
| W | 无 | `(1, 0)` | 向前 |
| S | Negate | `(-1, 0)` | 向后 |
| A | Negate + Swizzle | `(0, -1)` | 向左 |
| D | Swizzle | `(0, 1)` | 向右 |

鼠标的观察映射如下：

| 输入 | Modifier | 进入 IA_Look 的分量 |
| --- | --- | --- |
| Mouse X | 无 | X，水平观察 |
| Mouse Y | Swizzle + Negate | Y，垂直观察，并反转方向 |

## 4. Negate 和 Swizzle 分别解决什么问题？

键盘按键本质上只会输出一个一维的值，按下时通常是 `1`。

### Negate

`Negate` 会把数值取反：

```text
1 → -1
```

所以：

- W 是前进 `+1`；
- S 取反后是后退 `-1`。

### Swizzle Input Axis Values

按键默认产生的是 X 分量，而 `Swizzle` 可以调整分量的顺序，把原本的 X 放到 Y 上。

因此：

- D 经过 Swizzle 后进入 Y 正方向；
- A 经过 Swizzle 和 Negate 后进入 Y 负方向。

### Mouse Y 为什么还要 Negate？

一开始的方向是这样的：

- 鼠标向下移动，镜头向上；
- 鼠标向上移动，镜头向下。

给 Mouse Y 加上 `Negate` 之后，数值的符号就反转了，最终变成：

- 鼠标向上，镜头向上；
- 鼠标向下，镜头向下。

这只是观察方向上的输入习惯问题，并不会改变 Look 函数的职责。

## 5. 在 Project Settings 中启用默认 Mapping Context

设置的位置在：

```text
Project Settings
→ Engine
→ Enhanced Input
→ Default Mapping Contexts
```

在这里添加下面的配置：

```text
IMC_DefaultPlayer
Priority = 0
Add Immediately = 开启
Enable Default Mapping Contexts = 开启
```

这意味着项目启动时，会自动加入 `IMC_DefaultPlayer`。

所以在本章的这个阶段，不需要在 C++ 中再手动调用：

```cpp
AddMappingContext(...)
```

以后如果需要在战斗、载具、菜单等不同的输入模式之间切换，再考虑在运行时动态地添加和移除 Mapping Context。

---

# 七、让 C++ 模块能够使用 Enhanced Input

## 1. 为什么 include 会报错？

在代码中使用 Enhanced Input 的头文件时：

```cpp
#include "EnhancedInputComponent.h"
```

如果当前的游戏模块没有声明对 Enhanced Input 模块的依赖，Unreal Build Tool 就不知道应该把它加入当前模块的构建过程。

这时即使插件已经在项目里启用了，`#include` 仍然可能无法正常解析或者链接。

## 2. 修改的是 Build.cs，不是 CSS

在 `ActionRoguelike.Build.cs` 中加入下面的内容：

```csharp
PrivateDependencyModuleNames.AddRange(
    new string[]
    {
        "EnhancedInput"
    }
);
```

注意这个文件的扩展名是：

```text
.Build.cs
```

其中 `.cs` 表示这是一个 C# 文件，而不是网页的样式表 `.css`。

## 3. 为什么放进 PrivateDependencyModuleNames？

当前模块只在 `.cpp` 内部使用 Enhanced Input，并没有把 Enhanced Input 的类型作为本模块对外公开的 API 的一部分，所以把它放进私有依赖就可以了。

可以先这样区分这两种依赖：

| 依赖类型 | 大致含义 |
| --- | --- |
| Public Dependency | 当前模块的公共头文件对外暴露了该模块的类型 |
| Private Dependency | 主要由当前模块内部实现使用 |

## 4. 插件、模块依赖和 include 是三层不同设置

| 层级 | 解决的问题 |
| --- | --- |
| 启用 Enhanced Input 插件 | 项目是否使用该功能插件 |
| `.Build.cs` 添加模块依赖 | 当前 C++ 模块是否参与该模块的编译和链接 |
| `#include` 头文件 | 当前源文件是否能看到具体类型声明和定义 |

这三者缺少任何一个都不行。

另外，Rider 显示的灰色 `collection:` 等文字，通常只是参数名的 Inlay Hint，并不是实际的代码，不需要照着输入。

---

# 八、在 C++ 中为 Input Action 留出资源槽位

## 1. 声明 Input Action 成员

在 `RogueCharacter.h` 中加入下面的成员：

```cpp
UPROPERTY(EditDefaultsOnly, Category = "Input")
TObjectPtr<UInputAction> Input_Move;

UPROPERTY(EditDefaultsOnly, Category = "Input")
TObjectPtr<UInputAction> Input_Look;
```

并在头文件的前面加上前向声明：

```cpp
class UInputAction;
```

## 2. Input_Move 为什么会和 IA_Move 建立联系？

这两个名字看起来很相似，但 Unreal 并不会因为名字相似就自动把它们绑定在一起。

它们分别是：

| 名称 | 类型 | 所在位置 |
| --- | --- | --- |
| `Input_Move` | C++ 成员变量 | `ARogueCharacter` |
| `IA_Move` | Input Action 资产 | Content Browser |

声明完成之后，`Input_Move` 只是一个类型为 `UInputAction` 的空资源槽位。

真正建立两者之间关系的步骤是：

1. 编译 C++；
2. 打开 `BP_playerCharacter`；
3. 打开 **Class Defaults（类默认值）**；
4. 在 Input 分类中找到 `Input Move`；
5. 手动选择 `IA_Move`；
6. 将 `Input Look` 手动选择为 `IA_Look`。

蓝图保存以后，就保存下了这样的资产引用关系：

```text
BP_playerCharacter.Input_Move → IA_Move
BP_playerCharacter.Input_Look → IA_Look
```

到了运行时，`Input_Move` 这个指针才会指向所配置的 `IA_Move` 对象。

## 3. EditDefaultsOnly 到底限制了什么？

```cpp
UPROPERTY(EditDefaultsOnly, Category = "Input")
```

这个说明符表示该属性：

- 可以在类默认值中编辑；
- 不能针对关卡中的单个实例随意修改。

它确实会显示在 `BP_playerCharacter` 蓝图编辑器右侧的 Details 面板里，但需要切换到 **Class Defaults** 视图才能看到。

所以它的意思并不是「对象实例化之后就永远不能修改」，而是：

> 编辑器只允许在类或者蓝图模板的层面配置这个默认值，不会在关卡实例的 Details 面板中显示它。

相关的几个说明符可以这样对比：

| 说明符 | 蓝图类默认值 | 关卡单个实例 |
| --- | --- | --- |
| `EditDefaultsOnly` | 可修改 | 不可修改 |
| `EditInstanceOnly` | 不用于默认配置 | 可修改 |
| `EditAnywhere` | 可修改 | 可修改 |
| `VisibleAnywhere` | 只查看 | 只查看 |

本章选择 `EditDefaultsOnly` 的原因是：

> IA_Move 和 IA_Look 属于这个角色类型的设计配置，通常并不希望关卡中的每个角色实例都临时换成不同的输入资产。

如果确实需要让不同的角色拥有不同的输入，可以创建多个蓝图子类，让它们分别设置自己的类默认值。

---

# 九、将 Input Action 绑定到 C++ 函数

## 1. 声明输入处理函数

Move 函数的声明是：

```cpp
void Move(const FInputActionValue& InValue);
```

Look 函数的声明是：

```cpp
void Look(const FInputActionInstance& InValue);
```

这两个函数的参数类型并不完全相同，后面会解释原因。

## 2. 将普通 Input Component 转换为 Enhanced Input Component

在 `SetupPlayerInputComponent` 中写下：

```cpp
UEnhancedInputComponent* EnhancedInput =
    Cast<UEnhancedInputComponent>(PlayerInputComponent);
```

`PlayerInputComponent` 的静态类型是比较通用的 `UInputComponent*`。

由于当前项目使用的是 Enhanced Input，所以需要尝试把它转换成更具体的类型：

```cpp
UEnhancedInputComponent*
```

这里 `Cast` 的含义是：

> 检查这个已经存在的对象是否确实属于目标 Unreal 类型，如果是，就返回目标类型的指针，否则返回 `nullptr`。

它并不会创建一个新的 Input Component。

## 3. 绑定 Move

```cpp
EnhancedInput->BindAction(
    Input_Move,
    ETriggerEvent::Triggered,
    this,
    &ARogueCharacter::Move
);
```

各个参数的含义如下：

| 参数 | 含义 |
| --- | --- |
| `Input_Move` | 要监听哪个 Input Action |
| `ETriggerEvent::Triggered` | 该 Action 处于触发状态时执行 |
| `this` | 调用当前这个角色对象 |
| `&ARogueCharacter::Move` | 要调用的成员函数地址 |

最后一个参数并不是在这里立即调用 `Move()`。

它保存的是一个回调函数，意思是：

> 以后每当 `Input_Move` 触发时，Enhanced Input 再去调用当前角色的 `Move()`。

## 4. 绑定 Look

```cpp
EnhancedInput->BindAction(
    Input_Look,
    ETriggerEvent::Triggered,
    this,
    &ARogueCharacter::Look
);
```

C++ 是区分大小写的。如果函数的声明是：

```cpp
void Look(...);
```

那么绑定时也必须写成：

```cpp
&ARogueCharacter::Look
```

不能写成小写的 `look`。

## 5. 更稳妥的写法

课程的核心重点是理解 Cast 和 BindAction。在实际项目中，还可以进一步检查指针是否有效：

```cpp
if (UEnhancedInputComponent* EnhancedInput =
        Cast<UEnhancedInputComponent>(PlayerInputComponent))
{
    if (Input_Move)
    {
        EnhancedInput->BindAction(
            Input_Move,
            ETriggerEvent::Triggered,
            this,
            &ARogueCharacter::Move
        );
    }

    if (Input_Look)
    {
        EnhancedInput->BindAction(
            Input_Look,
            ETriggerEvent::Triggered,
            this,
            &ARogueCharacter::Look
        );
    }
}
```

这部分是在课程代码基础上做的安全性扩展，它可以：

- Cast 失败时避免解引用空指针；
- 蓝图忘记配置 Input Action 时避免绑定空资源。

---

# 十、第一版 Move：沿世界 X、Y 轴移动

最初版本的移动代码是：

```cpp
void ARogueCharacter::Move(const FInputActionValue& InValue)
{
    FVector2D InputValue = InValue.Get<FVector2D>();

    FVector MoveDirection(
        InputValue.X,
        InputValue.Y,
        0.0f
    );

    AddMovementInput(MoveDirection);
}
```

## 1. 从 Axis2D 取出 FVector2D

`IA_Move` 的 Value Type 是 `Axis2D`，所以在 C++ 中使用：

```cpp
FVector2D InputValue = InValue.Get<FVector2D>();
```

经过映射之后，得到的结果可能是：

| 输入 | `InputValue` |
| --- | --- |
| W | `(1, 0)` |
| S | `(-1, 0)` |
| D | `(0, 1)` |
| A | `(0, -1)` |

## 2. 为什么要转成 FVector？

`FVector2D` 只有两个分量：

```text
X, Y
```

而角色是在三维世界中移动的，`AddMovementInput` 接收的是三维的方向，所以要构造一个三维向量：

```cpp
FVector(
    InputValue.X,
    InputValue.Y,
    0.0f
);
```

`Z = 0` 表示当前的输入只负责水平方向的移动，不会通过 WASD 直接让角色向上飞。

## 3. AddMovementInput 不是直接移动坐标

```cpp
AddMovementInput(MoveDirection);
```

它提交的是一个「移动意图」，而不是直接修改坐标。

对于 `ACharacter` 来说，Character Movement Component 会接着处理下面这些内容：

- 最大速度；
- 加速度；
- 制动；
- 地面移动；
- 碰撞；
- 重力；
- 网络移动等。

所以它比直接使用 `SetActorLocation` 更符合 Character 的移动系统。

## 4. 第一版移动的问题

这个版本的代码使用的是固定的世界坐标：

```text
W 永远沿 World +X
D 永远沿 World +Y
```

所以即使摄像机转了方向，按 W 时角色仍然沿着世界的 +X 方向移动。

这个版本适合用来验证输入链路有没有打通，但不符合常见第三人称游戏中「按 W 就沿当前镜头的前方移动」的操作习惯。

---

# 十一、实现 Look：让鼠标改变观察方向

## 1. Look 函数

```cpp
void ARogueCharacter::Look(
    const FInputActionInstance& InValue
)
{
    FVector2D InputValue =
        InValue.GetValue().Get<FVector2D>();

    AddControllerPitchInput(InputValue.Y);
    AddControllerYawInput(InputValue.X);
}
```

## 2. Pitch 和 Yaw 分别是什么？

| 旋转 | 本章用途 |
| --- | --- |
| Pitch | 上下观察 |
| Yaw | 左右观察 |
| Roll | 侧向翻滚，本章没有主动使用 |

因此下面这一句：

```cpp
AddControllerPitchInput(InputValue.Y);
```

使用鼠标的 Y 值来改变上下的观察方向。

```cpp
AddControllerYawInput(InputValue.X);
```

上面这一句则使用鼠标的 X 值来改变左右的观察方向。

## 3. 为什么 Move 直接 Get，Look 却多一个 GetValue？

Move 函数的参数是：

```cpp
const FInputActionValue& InValue
```

它本身已经是一个输入值的容器，所以可以直接写：

```cpp
InValue.Get<FVector2D>()
```

而 Look 函数的参数是：

```cpp
const FInputActionInstance& InValue
```

`FInputActionInstance` 是一个更完整的运行时 Action 实例，除了当前的值以外，它还可以携带触发状态、持续时间等信息。

所以需要先把值取出来：

```cpp
InValue.GetValue()
```

得到 `FInputActionValue` 之后，再从中取出具体的值：

```cpp
.Get<FVector2D>()
```

它们的调用层级如下：

```text
FInputActionInstance
    └─ GetValue()
        └─ FInputActionValue
            └─ Get<FVector2D>()
```

所以这并不是说 Move 和 Look 在功能上必须使用不同的参数，而是老师在这里展示了 `BindAction` 支持的两种回调签名。

也可以把两者统一成同一种写法，只要头文件里的声明、源文件里的定义和绑定所需的签名保持一致就可以。

## 4. 为什么一开始只能左右转，不能上下转？

`AddControllerPitchInput` 和 `AddControllerYawInput` 修改的是 Controller 的这个属性：

```text
ControlRotation
```

它们并没有直接旋转 Camera Component。

左右旋转能看到效果，说明已经有某些对象在使用 Yaw；但是如果 Spring Arm 不读取 Controller 的 Pitch，镜头就不会随着 ControlRotation 的上下变化而抬头或者低头。

## 5. Use Pawn Control Rotation 的作用

在 Spring Arm 中勾选下面这个选项：

```text
Use Pawn Control Rotation
```

并继承对应的 Pitch 和 Yaw 之后，Spring Arm 就会采用 Pawn 的 Controller 所给出的观察旋转。

于是整条链路就变成了：

```text
鼠标移动
→ Look()
→ 修改 Controller 的 ControlRotation
→ Spring Arm 使用 ControlRotation
→ Camera 作为 Spring Arm 子组件一起旋转
```

最简单的理解方式是：

- `Look()` 修改“玩家想看向哪里”；
- `Use Pawn Control Rotation` 决定 Spring Arm 是否采用这个方向；
- Camera 因为挂在 Spring Arm 下，所以跟着移动和旋转。

`Inherit Pitch`、`Inherit Yaw` 和 `Inherit Roll` 则决定了 Spring Arm 要继承哪些旋转分量，本章主要依赖的是 Pitch 和 Yaw。

---

# 十二、将固定世界移动升级为镜头相对移动

## 1. 修改后的 Move

```cpp
void ARogueCharacter::Move(
    const FInputActionValue& InValue
)
{
    FVector2D InputValue =
        InValue.Get<FVector2D>();

    FRotator ControlRot =
        GetControlRotation();

    ControlRot.Pitch = 0.0f;

    // Forward / Back
    AddMovementInput(
        ControlRot.Vector(),
        InputValue.X
    );

    // Sideways
    FVector RightDirection =
        ControlRot.RotateVector(FVector::RightVector);

    AddMovementInput(
        RightDirection,
        InputValue.Y
    );
}
```

## 2. 修改前后的核心区别

### 修改前

```cpp
FVector MoveDirection(
    InputValue.X,
    InputValue.Y,
    0.0f
);

AddMovementInput(MoveDirection);
```

修改之前，输入值被直接当作世界坐标中的方向：

```text
W → World +X
D → World +Y
```

### 修改后

修改之后，先获取 Controller 的观察旋转，再计算出当前观察方向所对应的前方和右方：

```text
W → 镜头水平方向的前方
D → 镜头水平方向的右方
```

所以镜头转向之后，移动的方向也会随之改变。

## 3. GetControlRotation

```cpp
FRotator ControlRot = GetControlRotation();
```

这一句得到的是 Controller 当前的 Control Rotation，也就是当前玩家的观察方向。

`FRotator` 主要包含下面三个分量：

```text
Pitch, Yaw, Roll
```

## 4. 为什么要把 Pitch 设为 0？

```cpp
ControlRot.Pitch = 0.0f;
```

如果玩家抬起了头，Control Rotation 的前方向量就会包含一个向上的 Z 分量。

如果直接用这个完整的方向来移动，按 W 时就可能产生向上移动的倾向；而低头时，则可能朝着地面的方向移动。

第三人称的地面角色通常只需要镜头的水平朝向，所以要去掉 Pitch，只保留水平方向。

本章并没有主动产生 Roll，所以在实际计算中，主要用到的是 Yaw。

## 5. ControlRot.Vector()

```cpp
ControlRot.Vector()
```

这一句会把旋转转换成该旋转所指向的前方向量，也就是旋转之后的本地 `+X` 方向。

这就是当前镜头在水平面上的前方。

```cpp
AddMovementInput(
    ControlRot.Vector(),
    InputValue.X
);
```

这里用到了 `AddMovementInput` 的两个重要参数：

```text
WorldDirection：移动方向
ScaleValue：沿这个方向输入多少
```

所以：

- W 的 `InputValue.X = +1`，沿前方移动；
- S 的 `InputValue.X = -1`，沿前方的反方向移动。

## 6. 计算镜头右方向

```cpp
FVector RightDirection =
    ControlRot.RotateVector(FVector::RightVector);
```

`FVector::RightVector` 是 Unreal 中标准的右方向：

```cpp
FVector(0.0f, 1.0f, 0.0f)
```

它表示未旋转状态下的本地 `+Y` 方向。

`RotateVector` 会用 `ControlRot` 去旋转这个标准的右向量，从而得到当前观察方向所对应的右侧方向。

然后再沿着这个方向提交移动输入：

```cpp
AddMovementInput(
    RightDirection,
    InputValue.Y
);
```

所以：

- D 的 `InputValue.Y = +1`，沿右方向移动；
- A 的 `InputValue.Y = -1`，沿右方向的反方向移动。

## 7. 用一个例子理解镜头相对移动

当 Controller 的 Yaw 为 `0°` 时：

```text
前方 = World +X
右方 = World +Y
```

当镜头向右旋转大约 `90°` 之后：

```text
前方由 World +X 旋转到 World +Y
右方由 World +Y 旋转到 World -X
```

这时按下 W，角色就会沿着新的镜头前方移动，而不会继续沿着最初的世界 +X 方向移动。

## 8. FVector::RightVector 为什么报错？

代码中使用了：

```cpp
FVector::RightVector
```

如果 Rider 或者编译器无法识别它，就加入下面这个头文件：

```cpp
#include "Math/Vector.h"
```

原因是当前的源文件需要看到这个常量的正式声明。

这件事也说明了一个道理：

> 某个类型看起来能用，并不代表它的所有静态成员都已经通过间接包含稳定地暴露出来了。

显式地包含自己直接使用到的头文件，可以让依赖关系更清晰，也能避免将来其他头文件调整之后突然编译失败。

---

# 十三、配置 Manny Skeletal Mesh 和 Animation Blueprint

本章最后一节导入了角色和动画相关的资源，并在 `BP_playerCharacter` 的 Mesh 上做了如下配置：

```text
Animation Mode = Use Animation Blueprint
Anim Class = GideonManny
Skeletal Mesh Asset = SKM_Manny
```

配置完成之后，游戏中的 Manny 就不再只是一个静止的 T Pose，而是可以播放待机和移动的动画了。

## 1. Mesh Component 和 Skeletal Mesh Asset 的区别

| 名称 | 含义 |
| --- | --- |
| Mesh Component | 角色 Actor 上的组件，负责把网格体放进世界并显示 |
| Skeletal Mesh Asset | Content 中的骨骼网格资源，保存模型顶点、蒙皮和骨骼绑定 |

可以这样理解两者的关系：

```text
Mesh Component 是播放器
SKM_Manny 是被播放器加载的角色模型资源
```

## 2. Skeleton 是什么？

Skeleton 定义了骨骼的层级和名称，它是 Skeletal Mesh 和动画之间能够兼容的重要基础。

动画记录的是骨骼怎样变化，而 Skeletal Mesh 会根据骨骼的变化，带动蒙皮后的角色表面发生形变。

如果 Animation Blueprint 和 Skeletal Mesh 使用的骨架不兼容，就无法正确地驱动角色。

## 3. Animation Sequence 和 Animation Blueprint

| 类型 | 作用 |
| --- | --- |
| Animation Sequence | 一段具体动画，例如 Idle、Walk、Run |
| Animation Blueprint | 根据运行状态选择、混合并输出动画姿势 |

所以 Animation Blueprint 并不只是「一段动画」，而是控制动画运行的逻辑。

它通常会读取下面这些信息：

- 角色速度；
- 是否在空中；
- 移动方向；
- 其他角色状态；

然后根据这些信息，在 Idle、Walk、Run 等动画之间进行选择或者混合。

## 4. 为什么角色移动后动画会跟着变化？

这个过程并不是由 `Move()` 直接播放某个动画来完成的。

实际的链路是这样的：

```text
WASD
→ Move()
→ AddMovementInput()
→ CharacterMovement 改变角色速度
→ Animation Blueprint 读取速度和移动状态
→ 选择或混合 Idle / Walk / Run
→ 输出骨骼姿势
→ SKM_Manny 根据骨骼姿势显示最终动作
```

这体现了逻辑和表现的分离：

- C++ 移动系统负责“角色怎么移动”；
- Animation Blueprint 负责“移动时角色看起来怎样”。

---

# 十四、本章核心代码整理

下面的代码是根据本章内容整理出来的核心结构。它在保留课程重点的基础上，加入了空指针检查，方便以后继续扩展。

## 1. RogueCharacter.h

```cpp
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "RogueCharacter.generated.h"

class UCameraComponent;
class UEnhancedInputComponent;
class UInputAction;
class USpringArmComponent;
struct FInputActionInstance;
struct FInputActionValue;

UCLASS()
class ACTIONROGUELIKE_API ARogueCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    ARogueCharacter();

    virtual void SetupPlayerInputComponent(
        UInputComponent* PlayerInputComponent
    ) override;

protected:
    UPROPERTY(
        VisibleAnywhere,
        Category = "Components"
    )
    TObjectPtr<USpringArmComponent> SpringArmComponent;

    UPROPERTY(
        VisibleAnywhere,
        Category = "Components"
    )
    TObjectPtr<UCameraComponent> CameraComponent;

    UPROPERTY(
        EditDefaultsOnly,
        Category = "Input"
    )
    TObjectPtr<UInputAction> Input_Move;

    UPROPERTY(
        EditDefaultsOnly,
        Category = "Input"
    )
    TObjectPtr<UInputAction> Input_Look;

    void Move(const FInputActionValue& InValue);

    void Look(const FInputActionInstance& InValue);
};
```

## 2. RogueCharacter.cpp

```cpp
#include "RogueCharacter.h"

#include "Camera/CameraComponent.h"
#include "EnhancedInputComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "InputAction.h"
#include "InputActionValue.h"
#include "Math/Vector.h"

ARogueCharacter::ARogueCharacter()
{
    SpringArmComponent =
        CreateDefaultSubobject<USpringArmComponent>(
            TEXT("SpringArmComp")
        );
    SpringArmComponent->SetupAttachment(RootComponent);

    CameraComponent =
        CreateDefaultSubobject<UCameraComponent>(
            TEXT("CameraComp")
        );
    CameraComponent->SetupAttachment(SpringArmComponent);
}

void ARogueCharacter::SetupPlayerInputComponent(
    UInputComponent* PlayerInputComponent
)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);

    if (UEnhancedInputComponent* EnhancedInput =
            Cast<UEnhancedInputComponent>(
                PlayerInputComponent
            ))
    {
        if (Input_Move)
        {
            EnhancedInput->BindAction(
                Input_Move,
                ETriggerEvent::Triggered,
                this,
                &ARogueCharacter::Move
            );
        }

        if (Input_Look)
        {
            EnhancedInput->BindAction(
                Input_Look,
                ETriggerEvent::Triggered,
                this,
                &ARogueCharacter::Look
            );
        }
    }
}

void ARogueCharacter::Move(
    const FInputActionValue& InValue
)
{
    const FVector2D InputValue =
        InValue.Get<FVector2D>();

    FRotator ControlRot = GetControlRotation();
    ControlRot.Pitch = 0.0f;

    const FVector ForwardDirection =
        ControlRot.Vector();

    const FVector RightDirection =
        ControlRot.RotateVector(FVector::RightVector);

    AddMovementInput(
        ForwardDirection,
        InputValue.X
    );

    AddMovementInput(
        RightDirection,
        InputValue.Y
    );
}

void ARogueCharacter::Look(
    const FInputActionInstance& InValue
)
{
    const FVector2D InputValue =
        InValue.GetValue().Get<FVector2D>();

    AddControllerPitchInput(InputValue.Y);
    AddControllerYawInput(InputValue.X);
}
```

## 3. ActionRoguelike.Build.cs

核心的依赖中需要包含 Enhanced Input：

```csharp
PrivateDependencyModuleNames.AddRange(
    new string[]
    {
        "EnhancedInput"
    }
);
```

项目原本已有的 `Core`、`CoreUObject`、`Engine`、`InputCore` 等依赖都应该继续保留。这里展示的只是本章新增的关键部分，不要把原有的依赖删掉，只留下 `EnhancedInput`。

---

# 十五、每个模块之间的关系

## 1. 项目构建关系

| 模块/文件 | 与其他部分的关系 |
| --- | --- |
| `.uproject` | 描述项目和启用的插件 |
| `ActionRoguelike.Build.cs` | 描述游戏模块的编译依赖 |
| `.h` | 声明类的结构和接口 |
| `.cpp` | 实现构造、输入绑定、移动和观察逻辑 |
| UBT | 根据 Build.cs 组织编译 |
| MSVC | 执行实际 C++ 编译 |

## 2. 角色结构关系

| 对象 | 上层/拥有者 | 主要作用 |
| --- | --- | --- |
| `ARogueCharacter` | `ACharacter` 子类 | 角色核心代码 |
| `BP_playerCharacter` | `ARogueCharacter` 子类 | 角色资源和默认参数 |
| Capsule | Character 的 Root | 碰撞和主要空间位置 |
| Mesh | 挂在 Capsule 下 | 显示角色和动画 |
| Spring Arm | 挂在 Root 下 | 控制摄像机距离、旋转和碰撞 |
| Camera | 挂在 Spring Arm 下 | 输出玩家画面 |
| Character Movement | Character 拥有 | 消费移动输入并执行角色移动 |

## 3. 输入资源关系

| 对象 | 作用 | 本章实例 |
| --- | --- | --- |
| Input Action | 描述“要做什么”以及值的类型 | `IA_Move`、`IA_Look` |
| Mapping Context | 描述“哪个设备输入触发哪个 Action” | `IMC_DefaultPlayer` |
| Modifier | 在触发前修改输入值 | Negate、Swizzle |
| C++ UPROPERTY | 保存蓝图选择的 Action 资源引用 | `Input_Move`、`Input_Look` |
| BindAction | 将 Action 连接到 C++ 回调 | `Move()`、`Look()` |

## 4. 移动关系

```text
WASD
→ IMC_DefaultPlayer 产生 Axis2D
→ IA_Move
→ Input_Move 引用
→ BindAction
→ Move()
→ 根据 ControlRotation 计算前方/右方
→ AddMovementInput
→ CharacterMovement
→ Capsule 和角色整体移动
```

## 5. 镜头关系

```text
Mouse X / Mouse Y
→ IMC_DefaultPlayer 产生 Axis2D
→ IA_Look
→ Input_Look 引用
→ BindAction
→ Look()
→ AddControllerYawInput / AddControllerPitchInput
→ ControlRotation
→ Spring Arm 使用 Pawn Control Rotation
→ Camera 跟随 Spring Arm
```

## 6. 动画关系

```text
CharacterMovement 产生速度和运动状态
→ GideonManny Animation Blueprint 读取状态
→ 选择、混合动画
→ 输出骨骼姿势
→ SKM_Manny 显示最终动作
```

---

# 十六、本章出现的常见问题与结论

## 1. 声明了 CameraComponent，为什么编辑器里还没有相机？

因为下面这一句：

```cpp
TObjectPtr<UCameraComponent> CameraComponent;
```

只是声明了一个引用槽位。

真正把组件创建出来的是下面这一句：

```cpp
CreateDefaultSubobject<UCameraComponent>(...)
```

## 2. CreateDefaultSubobject 创建的是 UCameraComponent 吗？

是的，它创建的就是 `UCameraComponent`。

因为模板参数：

```cpp
<UCameraComponent>
```

已经明确指定了对象的类型。

它是当前的 `ARogueCharacter` 默认拥有的子对象，所以每一个角色实例都会拥有自己的 Camera Component。

## 3. SetupAttachment 会创建组件吗？

不会。`SetupAttachment` 并不负责创建组件。

它只是在已经存在的 Scene Component 之间，建立空间上的父子关系。

所以正确的顺序是先创建，再挂接：

```cpp
创建 Spring Arm
→ 将 Spring Arm 挂到 Root
→ 创建 Camera
→ 将 Camera 挂到 Spring Arm
```

## 4. Input_Move 会因为名字相似自动找到 IA_Move 吗？

不会，Unreal 不会根据名字的相似程度去建立关联。

真正的连接发生在 `BP_playerCharacter` 的 Class Defaults 中，需要手动完成下面的设置：

```text
Input Move = IA_Move
Input Look = IA_Look
```

## 5. EditDefaultsOnly 是不是实例化后就完全不能修改？

不是这样的。

它的意思是，这个值要在编辑器中从类默认值的层面去配置，而不允许在关卡中单个实例的面板里配置。

所以仍然可以修改 `BP_playerCharacter` 的类默认值，也可以再创建一个蓝图子类，让它使用另一组默认值。

## 6. Auto Possess Player 为什么不能自动实现移动？

因为 Possess 只是让 PlayerController 获得了角色的控制权。

要让角色真正移动起来，仍然需要完成下面这一整条链路：

```text
输入映射 → Action → BindAction → Move → AddMovementInput
```

## 7. 为什么启用了 Enhanced Input 插件，include 仍会报错？

因为启用插件和声明 C++ 模块依赖属于两个不同的层级。

除了启用插件以外，还需要在下面这个文件中：

```text
ActionRoguelike.Build.cs
```

添加对应的模块依赖：

```csharp
"EnhancedInput"
```

## 8. 为什么 Look 只左右转，不能上下转？

因为 Look 虽然已经修改了 Control Rotation，但 Spring Arm 并没有采用它的 Pitch。

只有开启下面这个选项：

```text
Use Pawn Control Rotation
```

并继承 Pitch 之后，镜头才会跟随上下方向的观察。

## 9. 为什么鼠标上下方向反了？

因为 Mouse Y 的符号和期望的操作习惯正好相反。

在 Mouse Y 的映射中加入：

```text
Negate
```

就可以把这个轴反转过来。

## 10. 为什么 FVector::RightVector 无法识别？

因为当前的源文件缺少这个常量的明确声明，只要加入下面这个头文件就可以了：

```cpp
#include "Math/Vector.h"
```

## 11. 为什么新 Move 要清除 Pitch？

因为移动只需要用到镜头的水平朝向。

如果不清除 Pitch，那么在抬头或者低头时，计算出来的前方向量就会包含 Z 分量，这不符合地面角色的移动要求。

## 12. 为什么不直接 SetActorLocation？

因为 `ACharacter` 已经拥有一套 Character Movement 系统。

使用 `AddMovementInput`，可以让这套系统统一处理碰撞、速度、加速度、重力和网络同步等问题；而直接修改位置，则会绕过很多 Character Movement 的逻辑。

## 13. 为什么配置了动画后角色不再是 T Pose？

因为这时的 Mesh 不再只是显示 Skeletal Mesh，而是由 Animation Blueprint 在每一帧输出骨骼的姿势。

如果没有有效的动画姿势，Skeletal Mesh 往往会保持参考姿势，也就是常见的 T Pose 或者 A Pose。

---

# 十七、第一章完成检查清单

## 项目与地图

- [x] 创建 Blank C++ 项目 `ActionRoguelike`
- [x] 使用 Rider 和 MSVC 编译工具链
- [x] 创建并保存 `P_OpenWorldTestMap`
- [x] 认识 Content、Source、Config 等项目目录

## 角色

- [x] 创建 `ARogueCharacter`
- [x] 理解 `AActor → APawn → ACharacter` 的继承关系
- [x] 创建 `BP_playerCharacter`
- [x] 调整 Mesh 的位置 `Z = -90`
- [x] 调整 Mesh 的旋转 `Z = -90°`
- [x] 让模型正面与 Actor 本地 `+X` 对齐
- [x] 设置 `Auto Possess Player = Player 0`

## 相机

- [x] 使用前向声明和 `TObjectPtr`
- [x] 创建 Spring Arm Component
- [x] 创建 Camera Component
- [x] 使用 `SetupAttachment` 建立层级
- [x] 调整 Spring Arm 高度 `Z = 80`
- [x] 调整 Target Arm Length `300`
- [x] 使用 Cube 测试 Camera 通道碰撞
- [x] 开启 Use Pawn Control Rotation

## Enhanced Input

- [x] 创建 `IA_Move`
- [x] 创建 `IA_Look`
- [x] 两个 Action 均使用 Axis2D
- [x] 创建 `IMC_DefaultPlayer`
- [x] 使用 Negate 和 Swizzle 配置 WASD
- [x] 配置 Mouse X 和 Mouse Y
- [x] 为 Mouse Y 添加 Negate
- [x] 在 Project Settings 中启用默认 Mapping Context
- [x] 在 Build.cs 中添加 `EnhancedInput` 模块依赖
- [x] 在蓝图 Class Defaults 中连接 `Input_Move` 和 `IA_Move`
- [x] 在蓝图 Class Defaults 中连接 `Input_Look` 和 `IA_Look`

## C++ 输入逻辑

- [x] Cast 为 `UEnhancedInputComponent`
- [x] 使用 `BindAction` 绑定 Move
- [x] 使用 `BindAction` 绑定 Look
- [x] 使用 `FInputActionValue` 读取移动输入
- [x] 使用 `FInputActionInstance` 读取观察输入
- [x] 使用 `AddMovementInput`
- [x] 使用 Pitch 和 Yaw 改变 Control Rotation
- [x] 将固定世界坐标移动升级为镜头相对移动

## 模型与动画

- [x] 导入角色和动画资源
- [x] Skeletal Mesh 设置为 `SKM_Manny`
- [x] Animation Mode 设置为 Use Animation Blueprint
- [x] Anim Class 设置为 `GideonManny`
- [x] 角色能够显示待机和移动动画

---

# 十八、第一章最值得记住的知识

第一章最重要的收获，并不是记住了某一行函数，而是建立起了 Unreal Gameplay Framework 的第一条完整链路。

## 1. C++ 定义能力，蓝图配置内容

`ARogueCharacter` 负责提供：

- 组件；
- 输入绑定；
- 移动和观察逻辑。

`BP_playerCharacter` 负责提供：

- 模型；
- 动画类；
- Input Action 资产引用；
- Spring Arm 参数。

所以两者并不是相互竞争的关系，而是相互配合的关系。

## 2. 输入系统进行了分层

本章并没有让 C++ 直接依赖 W、A、S、D 这几个按键，而是通过下面这条链路：

```text
物理按键 → Mapping Context → Input Action → C++ 回调
```

实现了两者之间的解耦。

这样一来，以后更换按键或者添加手柄支持时，主要修改的是输入资源，而不需要重写角色的移动逻辑。

## 3. Controller 的朝向不等于 Camera 的旋转

`Look()` 修改的是 Control Rotation。

至于 Spring Arm 是否跟随这个旋转，则由 `Use Pawn Control Rotation` 等设置来决定。

而 Camera 又通过组件之间的父子关系，跟随 Spring Arm 一起运动。

## 4. Character Movement 才是角色移动的执行者

`Move()` 只负责计算方向，并提交移动意图。

真正处理速度、碰撞和地面检测的，是 Character Movement Component。

## 5. 动画是运动状态的表现层

Move 函数并没有直接播放动画。

实际的过程是，Character Movement 改变角色的运动状态，Animation Blueprint 读取这些状态并输出骨骼姿势，最后由 Skeletal Mesh 把动作显示出来。

## 6. 模块依赖必须显式声明

在代码中使用一个 Unreal 模块时，通常需要同时关注下面三件事：

- 插件是否启用；
- `.Build.cs` 是否声明模块依赖；
- 当前源文件是否包含正确头文件。

## 7. 从“照着敲”走向“理解数据流”

本章的所有内容，最终可以概括成一段话：

> 玩家的输入先由 Enhanced Input 转换成行为和值，C++ 再根据这些值修改角色的移动意图或者 Controller 的观察方向，然后 Character Movement、Spring Arm、Camera、Mesh 和 Animation Blueprint 分别使用这些状态，最终形成一个可以控制、可以观察、可以播放动画的第三人称角色。

第一章的内容到这里就结束了。后面的战斗、交互、技能和 AI 系统，都会继续建立在这套角色、组件、输入和 Gameplay Framework 的基础之上。

---

# 参考资料

- [Epic Games：Enhanced Input](https://dev.epicgames.com/documentation/en-us/unreal-engine/enhanced-input-in-unreal-engine)
- [Epic Games：FInputActionValue::Get](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/EnhancedInput/FInputActionValue/Get/1?application_version=5.5)
- [Epic Games：FInputActionInstance](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/EnhancedInput/FInputActionInstance)
- [Epic Games：APawn::AddMovementInput](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/GameFramework/APawn/AddMovementInput)
- [Epic Games：USpringArmComponent::GetTargetRotation](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/GameFramework/USpringArmComponent/GetTargetRotation/1?application_version=5.3)
- [Epic Games：FVector::RightVector](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Core/Math/TVector/RightVector?application_version=5.5)
- [Epic Games：Animation Blueprints](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-blueprints-in-unreal-engine)
