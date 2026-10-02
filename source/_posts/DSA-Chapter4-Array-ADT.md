---
title: 数据结构第四章：数组 ADT 怎么挪、怎么找、怎么两头夹
date: 2026-10-02 17:08:00
description: Abdul Bari《Mastering Data Structures & Algorithms using C and C++》数组 ADT 这一章的复盘。表示只有一块内存加 size、length 两个数，length 一个数身兼三职；操作有二十来个，花钱的地方却只有两处 —— 插入删除要「挪」，查找要「扫」。插入从后往前挪、删除从前往后挪，方向由空位在哪决定；二分查找画成一棵树就看出为什么是 log n；反转、负数归左、两数之和都是两个指针从两头往中间走；并交差在有序时都是归并的变形。几处最容易写漏的边界（有序插入的 i >= 0、负数归左的内层 i < j、查表时的负下标）都在 AddressSanitizer 下实测过 —— 它们不开 ASan 时大多照样输出正确答案。
categories:
  - [课内, DSA]
tags:
  - 数组
  - ADT
  - 二分查找
  - 双指针
  - 复杂度分析
cover: /img/covers/DSA-Chapter4-Array-ADT.svg
series: 数据结构与算法
privacy: protected
sitemap: false
private_section: 课内
---

上一章只讲了数组本身 —— 怎么排、怎么长、地址怎么算，数组上的操作留到了这一章。

第一章说过，ADT 就是**数据的表示 + 能对它做的操作**。这一章就把「数组」当成一个 ADT 填满：表示只有一块内存加两个整数，操作有二十来个 —— 插入、删除、查找、反转、合并、并交差，外加几道常见的练习题。

二十来个操作看着很散，花钱的地方其实只有两处：

- **挪**。数组要求元素挨着放，中间插一个、删一个，后面的就得全体动一格。插入删除贵，全贵在这里。
- **扫**。不知道要找的东西在哪，就只能从头看到尾。

而**有序**是这一章反复出现的那张牌：数组排好序之后，查找从扫一遍降到 log n，并交差从两层循环降到一遍，找重复、找缺失、找两数之和都从「拿每一个去跟所有的比」变成「两个指针各走一遍」。这张牌也不是白来的，它是插入时多挪的那几格换来的（2.4 节）。

<!-- more -->

## 一、ADT 本体：一块内存，两个数

### 1.1 size 和 length

```c
struct Array {
    int *A;       // 数据在堆上
    int size;     // 容量：最多放几个
    int length;   // 长度：现在放了几个
};

struct Array Create(int size) {
    struct Array arr = { malloc(size * sizeof(int)), size, 0 };
    return arr;
}
```

*代码 1：和第一章代码 4 是同一个结构体，这一章把它的操作补齐。*

两个数管的是两件事。`size` 是这块内存有多大，开出来就不变 —— 要变只能照上一章 2.4 节那样换一块。`length` 是现在用了多少，每次插入、删除都在变。两者始终满足 `0 <= length <= size`。

![一块内存，两个数](/img/posts/dsa-array-adt/adt-layout.svg)

*图 1：下标 0 到 5 是数组的内容，6 到 9 只是「还有地方」。*

**`length` 这一个数身兼三职**：它是现在有几个元素，是下一个空位的下标，也是合法下标的上界。三件事恰好是同一个数，所以后面的 Append 才能只写一行。

### 1.2 Display 和 Append

```c
void Display(const struct Array *arr) {
    for (int i = 0; i < arr->length; i++) printf("%d ", arr->A[i]);
    printf("\n");
}

int Append(struct Array *arr, int x) {
    if (arr->length == arr->size) return 0;     // 满了
    arr->A[arr->length++] = x;
    return 1;
}
```

*代码 2：要改数组的函数传指针，只读的加 `const`。*

Display 是 O(n)。Append 是 O(1)，一个元素都不用挪，空位就在 `A[length]` 那里等着。

「满了」那一行不能省。`length == size` 时再写 `A[length]`，就是上一章 4.3 节那种越界写 —— 不报错，直接改掉堆上紧挨着的那块数据。满了还想往里放，只能扩容（上一章 2.4、2.5 节）。

### 1.3 Get 和 Set：边界看 length，不看 size

```c
int Get(const struct Array *arr, int index, int *out) {
    if (index < 0 || index >= arr->length) return 0;
    *out = arr->A[index];
    return 1;
}

int Set(struct Array *arr, int index, int x) {
    if (index < 0 || index >= arr->length) return 0;
    arr->A[index] = x;
    return 1;
}
```

*代码 3：返回值只表示成功与否，取到的值从 `out` 带出来。*

两个都是 O(1)，靠的就是上一章那条地址公式。要紧的只有边界：**上界是 `length`，不是 `size`。**

图 1 那个状态，是从 `{2, 4, 5, 6, 8, 10, 12}` 里删掉 6 得到的。删除只是把后面的往前挪一格、再把 `length` 减一，并不会去擦最后那一格 —— 所以 `A[6]` 里还躺着一个 12：

```
2 4 5 8 10 12
按 size 检查: index 6 < size 10 通过, 读到 12
按 length 检查: Get(6) 返回 0
```

按 `size` 检查，读出来的是一个已经删掉的值，而且什么错都不报。

Get 没有写成「下标非法就返回 -1」，因为 -1 本身可能就是数组里存的值，调用方分不清是出错了还是真读到了 -1。后面的查找函数可以用 -1 表示「没找到」，是因为它返回的是下标，下标不会是负数。

## 二、插入与删除：代价全在「挪」

### 2.1 Insert：从后往前挪

```c
int Insert(struct Array *arr, int index, int x) {
    if (index < 0 || index > arr->length) return 0;   // 可以等于 length：插在末尾
    if (arr->length == arr->size) return 0;
    for (int i = arr->length; i > index; i--)         // 从后往前挪
        arr->A[i] = arr->A[i - 1];
    arr->A[index] = x;
    arr->length++;
    return 1;
}
```

*代码 4：插入。*

`index` 允许等于 `length` —— 那就是插在末尾，循环一次都不进，和 Append 一样。

![挪的方向，由空位在哪决定](/img/posts/dsa-array-adt/insert-delete.svg)

*图 2：插入时空位从末尾往左走，删除时空位从被删的位置往右走。*

挪的方向不能反。空位一开始在末尾 `A[length]`，每一步把左边的邻居搬进空位，空位就往左走一格，一直走到 `index`。如果从前往后挪，第一步就把 `A[2]` 盖掉了，后面每一步抄的都是同一个值：

```
从前往后挪的 Insert(1,99)  1 99 2 2 2 2
从后往前挪的 Insert(1,99)  1 99 2 3 4 5
```

### 2.2 Delete：从前往后挪

```c
int Delete(struct Array *arr, int index) {
    if (index < 0 || index >= arr->length) return 0;  // 不能等于 length
    for (int i = index; i < arr->length - 1; i++)     // 从前往后挪
        arr->A[i] = arr->A[i + 1];
    arr->length--;
    return 1;
}
```

*代码 5：删除。*

删除正好反过来：空位一开始就在被删的 `A[index]`，要把右边的邻居一个个搬进来，所以从前往后。`i` 走到 `length - 2` 为止（`i + 1` 最多到 `length - 1`），最后 `length` 减一。反着挪的结果同样是一个值被抄了好几遍：

```
从后往前挪的 Delete(1)  1 5 5 5
从前往后挪的 Delete(1)  1 3 4 5
```

插入和删除其实是同一条规则：**永远往空位里搬，空位在哪头，就从哪头开始。**

两个函数对 `index` 的要求也差一点：插入有 `length + 1` 个位置可选（包括末尾），删除只有 `length` 个（末尾之后没有东西可删）。

### 2.3 挪多少次

插在 `index` 要挪 `length - index` 次，删 `index` 要挪 `length - 1 - index` 次：

| 位置 | Insert 挪几次 | Delete 挪几次 |
| --- | --- | --- |
| 最前面（index = 0） | n | n − 1 |
| 正中间 | 约 n/2 | 约 n/2 |
| 最后面 | 0（就是 Append） | 0 |

每个位置各试一次取平均，n = 10 000 时实测插入平均挪 5000.0 次、删除平均挪 4999.5 次，正好是 n/2 和 (n − 1)/2。所以插入和删除都是**最好 O(1)、最坏和平均 O(n)**。

第一章说数组「查得快、插得慢」，「插得慢」的全部内容就在这张表里：慢的不是插入这个动作本身，是「挨着放」这条规矩要求后面的元素全体让一格。链表放弃的正是这条规矩。

### 2.4 往有序数组里插

数组如果是有序的，插入的位置就不能随便给了 —— 只能插在「前面都不比它大、后面都比它大」的地方。找位置和挪动可以并成一个循环：从末尾往前看，比 x 大的就往后挪一格，碰到不比 x 大的就停，x 放进刚空出来的那一格。

```c
int InsertSorted(struct Array *arr, int x) {
    if (arr->length == arr->size) return 0;
    int i = arr->length - 1;
    while (i >= 0 && arr->A[i] > x) {        // i >= 0 必须写在前面
        arr->A[i + 1] = arr->A[i];
        i--;
    }
    arr->A[i + 1] = x;
    arr->length++;
    return 1;
}
```

*代码 6：有序插入。排序那一章的插入排序，就是把这一步做 n 次。*

```
InsertSorted(7)    2 4 6 7 8 10
InsertSorted(1)    1 2 4 6 7 8 10
InsertSorted(11)   1 2 4 6 7 8 10 11
```

`i >= 0` 要写在 `&&` 左边。x 比所有元素都小时（上面插 1 那次），`i` 会一路减到 -1，全靠短路求值才没去读 `A[-1]`。把这个条件漏掉，AddressSanitizer 当场就报：

```
ERROR: AddressSanitizer: heap-buffer-overflow
READ of size 4 ... is located 4 bytes to the left of 40-byte region
```

可不开 ASan 时，同一个程序输出 `1 2 4 6 8 10`，完全正确 —— `A[-1]` 碰巧是 0，比 1 小，循环就停了。这种越界在测试里很难被发现。

这一节也是开头那句「有序是插入时付的钱」的出处：无序数组里新元素可以直接 Append，O(1)；要保持有序，每插一个都得挪到它该在的位置，O(n)。

## 三、查找

### 3.1 线性查找

```c
int LinearSearch(const struct Array *arr, int key) {
    for (int i = 0; i < arr->length; i++)
        if (arr->A[i] == key) return i;
    return -1;
}
```

*代码 7：线性查找（也叫顺序查找）。*

最好 1 次（第一个就是），最坏 n 次（在最后一个，或者根本不在）。实测平均比较次数：

| n | 找得到（平均） | 找不到 |
| --- | --- | --- |
| 10 | 5.5 | 10 |
| 100 | 50.5 | 100 |
| 1 000 | 500.5 | 1 000 |
| 10 000 | 5 000.5 | 10 000 |

找得到时正好是 (n + 1)/2：每个位置被查的机会一样，平均就要看一半。平均和最坏都是 O(n)。

### 3.2 查过的往前挪

如果同一个 key 会被反复查，可以让它每次被找到后往前挪，下一次就能早点碰到。两种挪法：

```c
int SearchTranspose(struct Array *arr, int key) {      // 换位法
    for (int i = 0; i < arr->length; i++)
        if (arr->A[i] == key) {
            if (i == 0) return 0;
            swap(&arr->A[i], &arr->A[i - 1]);          // 和前一个交换
            return i - 1;
        }
    return -1;
}

int SearchMoveToFront(struct Array *arr, int key) {    // 移到最前
    for (int i = 0; i < arr->length; i++)
        if (arr->A[i] == key) {
            swap(&arr->A[i], &arr->A[0]);              // 直接和 A[0] 交换
            return 0;
        }
    return -1;
}
```

*代码 8：换位法（transposition）和移到最前（move to front）。*

在 `{8, 3, 9, 15, 6, 10, 7, 2, 12, 4}` 里连续查 4 五次，每次的比较次数：

| 第几次查 4 | 换位法 | 移到最前 |
| --- | --- | --- |
| 1 | 10 | 10 |
| 2 | 9 | 1 |
| 3 | 8 | 1 |
| 4 | 7 | 1 |
| 5 | 6 | 1 |

移到最前一步到位，换位法每查一次只前进一格。但「移到最前」是用交换实现的（不是把前面的整体后挪，那样就成了 O(n) 的插入），原来排第一的 8 被换到了最后一格：

```
换位法 5 次后: 8 3 9 15 4 6 10 7 2 12
移到最前后:    4 3 9 15 6 10 7 2 12 8
```

要是 8 也常被查，这一下就亏了。换位法慢，但每次只动相邻的两个，不会把别的常用元素一下子踢到末尾。两种办法都只适用于无序数组 —— 有序数组里随手一换，顺序就乱了。

### 3.3 二分查找

前提：数组**有序**，下面都按从小到大。

每次看区间正中间那个：等于 key 就找到了；比 key 小，key 只可能在右半边；比 key 大，只可能在左半边。每看一次，区间砍掉一半。

```c
int BinarySearch(const struct Array *arr, int key) {
    int low = 0, high = arr->length - 1;
    while (low <= high) {
        int mid = low + (high - low) / 2;
        if (arr->A[mid] == key) return mid;
        if (arr->A[mid] < key) low = mid + 1;
        else                   high = mid - 1;
    }
    return -1;
}
```

*代码 9：二分查找，循环版。*

短短几行，有三处细节：

- **循环条件是 `low <= high`。** `low == high` 时区间里还剩一个元素没看过；只有 `low > high` 才说明区间空了，key 不在数组里。
- **`low = mid + 1`、`high = mid - 1` 都要跳过 mid**，mid 已经比过了。写成 `low = mid`，在 `{1, 3}` 里找 5 就停不下来：`mid` 永远是 0，`low` 永远被赋回 0，实测转了 100 万轮还是 `low=0 high=1`。
- **mid 写成 `low + (high - low) / 2`，不写 `(low + high) / 2`。** 两者数学上相等，但 `low + high` 可能超出 int 的范围（有符号溢出在 C 里是未定义行为，实际多半回绕成负数）：

```
low = 1500000000, high = 2000000000
(low+high)/2     = -397483648
low+(high-low)/2 = 1750000000
```

下标要上十亿才会撞上 —— 4 字节的 int 数组那就是 4 GB 以上，平时遇不到。但后一种写法不花任何代价。

二分查找也可以写成递归：

```c
int RBinSearch(const int A[], int low, int high, int key) {
    if (low > high) return -1;
    int mid = low + (high - low) / 2;
    if (A[mid] == key) return mid;
    if (A[mid] < key) return RBinSearch(A, mid + 1, high, key);
    return RBinSearch(A, low, mid - 1, key);
}
```

*代码 10：二分查找，递归版。*

两个递归调用都是这一层做的最后一件事 —— 第二章 3.1 节意义上的尾递归。照 3.2 节的规则，把传下去的实参抄成循环变量的更新（`mid + 1` 成了 `low`，`mid - 1` 成了 `high`），得到的就是代码 9。

区别只在空间：递归版同时压着的帧数等于查的轮数。下一节会看到，100 万个元素也只有 20 轮，所以这里用递归无妨 —— 和第二章那些深度为 n 的递归不是一回事。

### 3.4 为什么是 log n：把查找画成一棵树

拿 15 个有序的数来看。第一轮一定查下标 7（27）；第二轮要么查 3、要么查 11；第三轮是 1、5、9、13 之一；第四轮是剩下的 8 个。把「每一轮可能查到哪」画出来，就是一棵树：

![15 个数，最多查 4 轮](/img/posts/dsa-array-adt/binary-search-tree.svg)

*图 3：粉色是找 18 的路线，27 → 15 → 21 → 18，查了 4 轮。*

15 个数逐个查一遍，实测的轮数分布正好是这棵树每层的节点数：

| 几轮找到 | 有几个数 |
| --- | --- |
| 1 | 1 |
| 2 | 2 |
| 3 | 4 |
| 4 | 8 |

第 k 层最多 $2^{k-1}$ 个节点，n 个元素的树最多 $\lfloor \log_2 n \rfloor + 1$ 层，这就是最坏的轮数。找不到的数会落进叶子下面的空档里，15 个数有 16 个空档，实测每一个都是 4 轮。

平均轮数是 (1×1 + 2×2 + 3×4 + 4×8) / 15 = 49/15 ≈ 3.27，比最坏只少不到 1 轮 —— 一半的元素都在最底层。规模放大了看：

| n | 找得到（平均） | 最坏 | log₂n |
| --- | --- | --- | --- |
| 15 | 3.27 | 4 | 3.91 |
| 1 000 | 8.99 | 10 | 9.97 |
| 1 000 000 | 18.95 | 20 | 19.93 |

（这里数的是「轮」：每轮看一次 `A[mid]`，最多比两次。最坏那一列找得到、找不到都一样。）

最好 O(1)（第一轮就中），平均和最坏都是 **O(log n)**。100 万个数，线性查找平均要比 50 万次，二分查找不超过 20 轮。这是有序换来的第一样东西。

## 四、扫一遍就够的操作

### 4.1 Max、Min、Sum、Avg

```c
int Max(const struct Array *arr) {
    int max = arr->A[0];                    // 从第一个元素开始，不从 0 开始
    for (int i = 1; i < arr->length; i++)
        if (arr->A[i] > max) max = arr->A[i];
    return max;
}

int Sum(const struct Array *arr) {
    int s = 0;
    for (int i = 0; i < arr->length; i++) s += arr->A[i];
    return s;
}

double Avg(const struct Array *arr) {
    return (double)Sum(arr) / arr->length;
}
```

*代码 11：Min 和 Max 对称，不再重复。几个函数都假定 `length >= 1`。*

全是 O(n)。有两个地方容易写错：

- **max 的初值取 `A[0]`，不取 0。** 取 0 的话，全是负数的 `{-5, -3, -8}` 会得出 0 —— 一个数组里根本没有的数。取 `A[0]` 得 -3。
- **平均值要先转成浮点再除。** `Sum / length` 两边都是 int，C 做的是整数除法，小数部分直接扔掉：

```
Sum = 41, length = 6
Sum / length          = 6
(double)Sum / length  = 6.833333
```

Sum 也能写成递归：

```c
int RSum(const int A[], int n) {          // 前 n 个的和
    if (n == 0) return 0;
    return RSum(A, n - 1) + A[n - 1];
}
```

*代码 12：求和，递归版。*

结果一样是 41。但它不是尾递归 —— 调用回来之后还要加 `A[n - 1]`，n 层帧得同时压着，空间 O(n)；循环版只要 O(1)。

### 4.2 IsSorted

```c
int IsSorted(const struct Array *arr) {
    for (int i = 0; i < arr->length - 1; i++)
        if (arr->A[i] > arr->A[i + 1]) return 0;
    return 1;
}
```

*代码 13：判断是否有序。*

只比相邻的两个就够了：每一对相邻的都不下降，整个就不下降。碰到第一对反序的直接返回，最好 O(1)；真的有序时要比完 n − 1 对，O(n)。循环上界是 `length - 1`，`A[i + 1]` 才不会越界。

### 4.3 一遍扫描，同时找最大和最小

```c
int min = A[0], max = A[0];
for (int i = 1; i < n; i++) {
    if (A[i] < min)      min = A[i];
    else if (A[i] > max) max = A[i];
}
```

*代码 14：一遍找出最大和最小。*

`else if` 能省比较：`A[i]` 比当前最小值还小，就不可能比当前最大值还大。n = 1000 时实测：

| 数组 | 比较次数 |
| --- | --- |
| 递减 | 999 |
| 随机 | 1 993 |
| 递增 | 1 998 |

分开扫两遍是固定的 2(n − 1) = 1998 次。省得最多的是递减数组（每个元素都是新的最小值，第二个比较全省了），随机数组几乎没省。一遍扫描真正省下的是**少走一遍内存**，比较次数在一般情况下仍然是 2n 左右。

## 五、两个指针，从两头往中间

### 5.1 反转

方法一，借一个数组 B：倒着抄过去，再抄回来。

```c
void Reverse1(struct Array *arr) {
    int *B = malloc(arr->length * sizeof(int));
    for (int i = arr->length - 1, j = 0; i >= 0; i--, j++)
        B[j] = arr->A[i];
    for (int i = 0; i < arr->length; i++)
        arr->A[i] = B[i];
    free(B);
}
```

方法二，原地交换：i 从左、j 从右，对称位置两两交换，碰头就停。

```c
void swap(int *x, int *y) { int t = *x; *x = *y; *y = t; }

void Reverse2(struct Array *arr) {
    for (int i = 0, j = arr->length - 1; i < j; i++, j--)
        swap(&arr->A[i], &arr->A[j]);
}
```

*代码 15：反转的两种写法。*

![两个指针，从两头往中间走](/img/posts/dsa-array-adt/two-pointers.svg)

*图 4：上半是反转，下半是 5.3 节的负数归左。弧线上的数字是第几次交换。*

时间都是 O(n)，差别在空间：方法一要一个和原数组一样大的 B，额外空间 O(n)；方法二只多一个交换用的临时变量，O(1)。

### 5.2 左移与循环左移

```c
void LeftShift(struct Array *arr) {
    for (int i = 0; i < arr->length - 1; i++)
        arr->A[i] = arr->A[i + 1];
    arr->A[arr->length - 1] = 0;           // 最后一格补 0
}

void LeftRotate(struct Array *arr) {
    int first = arr->A[0];                 // 先把第一个存起来
    for (int i = 0; i < arr->length - 1; i++)
        arr->A[i] = arr->A[i + 1];
    arr->A[arr->length - 1] = first;       // 再放到最后
}
```

*代码 16：左移和循环左移。*

```
原数组      2 4 6 8 10
LeftShift   4 6 8 10 0
LeftRotate  4 6 8 10 2
```

LeftShift 的循环和 `Delete(0)` 一模一样，区别只是 `length` 不变、末尾补 0。LeftRotate 多一步：`A[0]` 被覆盖之前先存进 `first`。右移和循环右移是对称的，从后往前挪即可。

循环左移 k 位，调用 k 次 LeftRotate 是 O(nk)。用三次反转能做到 O(n)：先反转前 k 个，再反转剩下的，最后整个反转。

```c
void ReverseRange(int A[], int i, int j) {
    for (; i < j; i++, j--) swap(&A[i], &A[j]);
}

void RotateLeftK(struct Array *arr, int k) {
    int n = arr->length;
    k %= n;
    ReverseRange(arr->A, 0, k - 1);        // 反转前 k 个
    ReverseRange(arr->A, k, n - 1);        // 反转后 n - k 个
    ReverseRange(arr->A, 0, n - 1);        // 整个反转
}
```

*代码 17：循环左移 k 位。*

```
1 2 3 4 5 6 7     要左移 2 位
2 1 3 4 5 6 7     反转前 2 个
2 1 7 6 5 4 3     反转后 5 个
3 4 5 6 7 1 2     整个反转
```

要的结果是把「前 k 个 | 后 n − k 个」换成「后 n − k 个 | 前 k 个」。整体反转能把两段的位置对调，但每段内部也跟着倒了过来 —— 所以先把两段各自倒一次，整体反转时正好倒回去。实测数组元素的写入次数（两种做法的结果逐个比对过，完全一致）：

| n | k | 逐次左移 | 三次反转 |
| --- | --- | --- | --- |
| 10 | 3 | 30 | 18 |
| 10 000 | 3 000 | 30 000 000 | 20 000 |
| 100 000 | 30 000 | 3 000 000 000 | 200 000 |

### 5.3 负数放左边，其余放右边

数组里有正有负，要把负数都移到左边、其余的都移到右边，不要求保持原来的先后。

还是两个指针从两头往中间走：i 从左往右找第一个**不该在左边**的（非负数），j 从右往左找第一个**不该在右边**的（负数），两个都找到了就交换，然后接着找，直到碰头。

```c
void Rearrange(struct Array *arr) {
    int i = 0, j = arr->length - 1;
    while (i < j) {
        while (i < j && arr->A[i] < 0)  i++;
        while (i < j && arr->A[j] >= 0) j--;
        if (i < j) swap(&arr->A[i], &arr->A[j]);
    }
}
```

*代码 18：负数归左。*

```
前  -6 3 -8 10 5 -7 -9 12 -4 2
后  -6 -4 -8 -9 -7 5 10 12 3 2
```

10 个元素换了 3 次（图 4 下半）。i 只往右、j 只往左，两人加起来一共走 n 步左右，O(n)，原地完成。0 算「其余」，归右边。

内层两个 while 里的 `i < j` 是这段代码最容易漏的地方。去掉它们、只在外层判断，普通的数组照样能得出正确结果；但**全是负数**时 i 会一路走出数组右端，**全是非负数**时 j 会一路走到 `A[-1]` 甚至更前面：

```
全负 {-3,-1,-4,-1,-5}  ASan: heap-buffer-overflow，0 bytes to the right of 20-byte region
全正 {3,1,4,1,5}       ASan: heap-buffer-overflow，4 bytes to the left of 20-byte region
```

不开 ASan 时，全负那组输出 `-3 -1 -4 -1 -5`，看起来完全正常（i 在数组外面碰到一个非负的值就停了）；全正那组直接 `Segmentation fault`。**同一个 bug，一组悄无声息，一组当场崩溃，取决于数组外面碰巧放着什么。**

## 六、归并与集合运算

### 6.1 归并两个有序数组

```c
struct Array Merge(const struct Array *a, const struct Array *b) {
    struct Array c = Create(a->length + b->length);
    int i = 0, j = 0, k = 0;
    while (i < a->length && j < b->length) {
        if (a->A[i] < b->A[j]) c.A[k++] = a->A[i++];
        else                   c.A[k++] = b->A[j++];
    }
    while (i < a->length) c.A[k++] = a->A[i++];     // a 剩下的
    while (j < b->length) c.A[k++] = b->A[j++];     // b 剩下的
    c.length = k;
    return c;
}
```

*代码 19：归并。*

i、j 各管一个输入，k 管输出。每一步比一次、放一个，谁小谁前进。m + n 个元素每个放一次，**O(m + n)**。

![归并：三个指针，各走各的](/img/posts/dsa-array-adt/merge.svg)

*图 5：C 里每个数的颜色是它的出处，琥珀色的 25 是最后照抄过去的尾巴。*

```
A      3 8 16 20 25
B      4 10 12 22 23
Merge  3 4 8 10 12 16 20 22 23 25
```

第一个 while 退出时，一定有一边已经走完；另一边剩下的都比 C 里已有的大，而且本身有序，整段照抄就行。后面两个 while 只会进一个，但哪一个会进取决于数据，所以两个都得写。漏掉它们：

```
不接尾巴  3 4 8 10 12 16 20 22 23
此时 i=4 j=5
```

A 的 25 没进去。

### 6.2 并、交、差：无序时两层循环

集合运算有个前提：每个数组内部没有重复元素（它们是集合）。

**无序**的时候，只能拿一个数组里的每个元素，到另一个数组里线性查一遍：

```c
struct Array UnionUnsorted(const struct Array *a, const struct Array *b) {
    struct Array c = Create(a->length + b->length);
    for (int i = 0; i < a->length; i++)
        c.A[c.length++] = a->A[i];                  // a 全部照抄
    for (int j = 0; j < b->length; j++)
        if (LinearSearch(a, b->A[j]) == -1)         // b 里 a 没有的
            c.A[c.length++] = b->A[j];
    return c;
}
```

*代码 20：无序数组求并集。交集是「a 里 b 也有的」，差集 a − b 是「a 里 b 没有的」，写法一样。*

b 的每个元素在 a 里查一次 O(m)，总共 **O(mn)**，两边一样大就是 O(n²)。

### 6.3 并、交、差：有序时都是归并的变形

**有序**的时候，三种运算都套 Merge 的骨架：两个指针各走各的，每次看 `A[i]` 和 `B[j]` 谁小。比如并集，就是在 Merge 的循环里多分出一个「相等」：

```c
while (i < a->length && j < b->length) {
    if      (a->A[i] < b->A[j]) c.A[k++] = a->A[i++];
    else if (a->A[i] > b->A[j]) c.A[k++] = b->A[j++];
    else { c.A[k++] = a->A[i++]; j++; }         // 相等：只留一份，两边都前进
}
// 尾巴：两边都接
```

*代码 21：有序数组求并集的主循环。*

四种运算的区别只在三处取舍：

| 运算 | 小的那个 | 相等时 | 尾巴 |
| --- | --- | --- | --- |
| 归并 | 留下 | 两个都留 | 两边都接 |
| 并 A ∪ B | 留下 | 留一份 | 两边都接 |
| 交 A ∩ B | 扔掉 | 留一份 | 都不接 |
| 差 A − B | A 的留下，B 的扔掉 | 扔掉 | 只接 A 的 |

交集为什么能把小的那个扔掉：另一边当前那个已经比它大，后面的只会更大，它在另一边不可能存在。差集 A − B 里，A 那边小的同理在 B 里不存在，所以留下；B 那边小的和 A 无关，扔掉。

```
A      3 4 5 6 10
B      2 4 5 7 12
A ∪ B  2 3 4 5 6 7 10 12
A ∩ B  4 5
A − B  3 6 10
B − A  2 7 12
```

求并集时的元素比较次数，两边各 n 个、一半重叠：

| 每边元素数 n | 无序 | 有序 |
| --- | --- | --- |
| 100 | 7 399 | 250 |
| 1 000 | 752 168 | 2 500 |
| 10 000 | 75 022 210 | 25 000 |

无序是 n² 级的：b 里查不到的那一半，每个都要在 a 里比满 n 次；查得到的那一半平均比 n/2 次，合起来约 0.75n²。有序是 n 级的，**O(m + n)**。这是有序换来的第二样东西。

## 七、几道练习

### 7.1 找缺失的数

**缺一个，并且知道范围是 1 到 n**：求和。1 到 n 的和是 $\frac{n(n+1)}{2}$，减去实际的和，差就是缺的那个。

```c
int sum = 0;
for (int i = 0; i < len; i++) sum += A[i];
int missing = n * (n + 1) / 2 - sum;
```

*代码 22：求和法。*

`{1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12}`，n = 12：78 − 71 = 7。这个办法其实不要求有序，只要求知道范围、而且只缺一个。

**有序，起点不一定是 1**：看 `A[i] - i`。一串连续的数，值和下标同步加一，两者的差不变；中间缺了一个，后面的值就多跳了一格，差也跟着大了 1。

```c
int diff = A[0] - 0;
for (int i = 0; i < len; i++)
    if (A[i] - i != diff) {
        printf("缺 %d\n", i + diff);
        break;
    }
```

*代码 23：差值法，缺一个。*

```
A[i]      6 7 8 9 10 11 13 14 15 16 17
A[i] - i  6 6 6 6 6  6  7  7  7  7  7
缺 12
```

i = 6 时差值变成 7，缺的是 i + diff = 6 + 6 = 12。

**有序，缺好几个**：差值跳了几，中间就缺几个。每报一个，diff 加一，直到追上当前的差值。

```c
int diff = A[0] - 0;
for (int i = 0; i < len; i++)
    while (A[i] - i > diff) {          // 差值跳了几，就缺几个
        printf("缺 %d\n", i + diff);
        diff++;
    }
```

*代码 24：差值法，缺好几个。*

![找缺失：A[i] − i 一跳，就缺了](/img/posts/dsa-array-adt/missing.svg)

*图 6：上半是差值法，下半是查表法。*

```
A[i]      6 7 8 9 11 12 15 16 17 18 19
A[i] - i  6 6 6 6 7  7  9  9  9  9  9
缺 10
缺 13
缺 14
```

一遍扫描，O(n)（严格说是 O(n + 缺的个数)，打印也要时间）。

**无序**：开一张表 H，下标是值，`H[v]` 记 v 出现了几次。

```c
int *H = calloc(high + 1, sizeof(int));     // 全部初始化为 0
for (int i = 0; i < len; i++) H[A[i]]++;
for (int v = low; v <= high; v++)
    if (H[v] == 0) printf("缺 %d\n", v);
```

*代码 25：查表法。*

`{3, 7, 4, 9, 12, 6, 1, 11, 2, 10}`，范围 1 到 12，输出缺 5、缺 8。

这张表就是最简单的哈希表：哈希函数是值本身，值是几就放在第几格（直接寻址）。时间 O(n + 最大值)，代价在空间 —— **表的长度跟着最大值走，不跟着元素个数走。** 10 个数里只要有一个是 100 万，表就得开 100 万格。

### 7.2 找重复的数

**有序**：重复的元素一定挨在一起。看到 `A[i] == A[i + 1]`，就用 j 往后数这一段有多长：

```c
for (int i = 0; i < n - 1; i++)
    if (A[i] == A[i + 1]) {
        int j = i + 1;
        while (j < n && A[j] == A[i]) j++;
        printf("%d 出现 %d 次\n", A[i], j - i);
        i = j - 1;                          // 跳过这一段
    }
```

*代码 26：有序数组找重复并计数。*

```
A = 3 6 8 8 10 12 15 15 15 20
8 出现 2 次
15 出现 3 次
```

j 停下时，下标 i 到 j − 1 这一段都是同一个值，个数是 j − i。最后那句 `i = j - 1` 不能少（再加上 for 的 `i++`，下一轮正好从 j 开始）。少了它，i 只前进一格，同一段会从第二个元素起再被数一遍：

```
8 出现 2 次
15 出现 3 次
15 出现 2 次
```

另一种常见写法是用一个 `lastDuplicate` 记住上一次打印过的值，避免重复打印。它的麻烦在初值：设成 0 的话，数组里正好有重复的 0 就会漏掉 —— `{0, 0, 1, 2, 2, 2, 5}` 只打出了 2。任何初值都可能恰好是数组里的值；直接跳过整段，就用不着这个变量。

**无序，查表**：和找缺失一样开一张 H，扫完之后 `H[v] > 1` 的就是重复的，`H[v]` 就是次数，O(n + 最大值)：

```
A = 8 3 6 4 6 5 6 8 2 7
6 出现 3 次
8 出现 2 次
```

**无序，不开表**：两层循环，对每个 `A[i]` 往后数有几个相同的。数过的改成 -1，免得后面再数一遍：

```c
for (int i = 0; i < n - 1; i++) {
    if (A[i] == -1) continue;               // 已经数过了
    int count = 1;
    for (int j = i + 1; j < n; j++)
        if (A[j] == A[i]) { count++; A[j] = -1; }
    if (count > 1) printf("%d 出现 %d 次\n", A[i], count);
}
```

*代码 27：无序数组找重复，O(n²)。*

同一组数据比较了 35 次（两两比较是 n(n − 1)/2 = 45 次，被标成 -1 的那几轮省掉了）。这个写法有两个前提：它**会改掉原数组**，跑完变成 `8 3 6 4 -1 5 -1 -1 2 7`；数组里也**不能本来就有 -1** —— `{-1, 3, -1, 5}` 里的两个 -1 会被当成「已经数过」直接跳过，什么都打不出来。

### 7.3 两数之和等于 k

找出数组里所有和为 k 的两个元素，元素互不相同。

**无序，两层循环**：每一对都试一遍。

```c
for (int i = 0; i < n - 1; i++)
    for (int j = i + 1; j < n; j++)
        if (A[i] + A[j] == k) printf("%d + %d = %d\n", A[i], A[j], k);
```

*代码 28：两两去试，O(n²)。*

j 从 i + 1 开始，每一对只试一次，10 个数试 45 对：

```
A = 6 3 8 10 16 7 5 2 9 14,  k = 10
3 + 7 = 10
8 + 2 = 10
```

**无序，查表**：扫到 `A[i]` 时，它需要的搭档是 `k - A[i]`；只要搭档之前出现过，就配上了。

```c
int *H = calloc(max + 1, sizeof(int));
for (int i = 0; i < n; i++) {
    int need = k - A[i];
    if (need >= 0 && need <= max && H[need] > 0)    // 先查范围，再查表
        printf("%d + %d = %d\n", need, A[i], k);
    H[A[i]]++;                                      // 查完再登记自己
}
```

*代码 29：查表，O(n)，外加开表的 O(最大值)。*

两处顺序都有讲究。

**先查再登记。** 反过来的话，k = 10 时一个单独的 5 会先把 `H[5]` 记上，再去查 `H[10 - 5]`，自己和自己配成了一对。按上面的顺序，在 `{5, 1, 2}` 里找和为 10 的，什么都不会打出来。

**先查范围再查表。** `need` 可能是负数：`A[i]` = 16 时 `need` = 10 − 16 = −6，`H[-6]` 就是越界读。在 ASan 下：

```
i=4 A[i]=16 下标 k-A[i]=-6
ERROR: AddressSanitizer: heap-buffer-overflow
```

不开 ASan，同一个程序照常打出那两对 —— `H[-6]` 碰巧是 0。和 2.4 节、5.3 节是同一回事：**越界读出了正确答案，不等于没有越界。**

**有序，两头夹**：i 从最小的开始，j 从最大的开始。

```c
int i = 0, j = n - 1;
while (i < j) {
    int s = A[i] + A[j];
    if (s == k)     { printf("%d + %d = %d\n", A[i], A[j], k); i++; j--; }
    else if (s < k) i++;                    // 嫌小：换一个大点的 A[i]
    else            j--;                    // 嫌大：换一个小点的 A[j]
}
```

*代码 30：两头夹，O(n)，不要额外空间。*

```
A = 1 3 4 5 6 8 9 10 12 14,  k = 10
1 + 9 = 10
4 + 6 = 10
（走了 7 步）
```

它为什么一对都不会漏，看图 7：

![两头夹为什么不会漏掉](/img/posts/dsa-array-adt/pair-sum-grid.svg)

*图 7：所有组合的和排成一张表，每一步都划掉一整行或一整列。*

把所有 (i, j) 的和排成一张表：往下 `A[i]` 变大，往右 `A[j]` 变大，所以每一行从左到右递增、每一列从上到下递增。站在 (i, j) 上：

- **和 > k**：这一列再往下，`A[i]` 只会更大，和全都 > k —— 整列不可能有答案，`j--`。
- **和 < k**：这一行再往左，`A[j]` 只会更小，和全都 < k —— 整行不可能有答案，`i++`。
- **和 = k**：记下来。元素互不相同，这一行、这一列都不会再有第二个等于 k 的，`i++`、`j--` 一起走。

每一步至少划掉一行或一列，j − i 每步至少缩小 1，所以最多 n − 1 步就把整张表划完。45 个组合只看了 7 个，其余的是「看都不用看就知道不可能」。这是有序换来的第三样东西。

## 小结

| 操作 | 一句话 |
| --- | --- |
| 表示 | 一块内存 + size + length；length 同时是个数、下一个空位、下标上界 |
| Append | O(1)，空位就在 `A[length]` |
| Get / Set | O(1)；边界看 length，size 以内也可能是删剩的旧值 |
| Insert / Delete | O(n)；永远往空位里搬，插入从后往前、删除从前往后 |
| 有序插入 | 找位置和挪动并成一个循环，`i >= 0` 写在 `&&` 左边 |
| 线性查找 | 平均 (n + 1)/2 次；换位法慢慢挪，移到最前一步到位但会踢走原来的第一个 |
| 二分查找 | 有序才能用；最多 ⌊log₂n⌋ + 1 轮，100 万个数 20 轮 |
| Max / Avg | 初值取 `A[0]`；平均值先转浮点再除 |
| 反转 | 两头往中间换，O(n) 时间、O(1) 空间 |
| 循环左移 k 位 | 三次反转，O(n) |
| 负数归左 | 两头夹；内层循环也要带 `i < j` |
| 归并 | 三个指针，O(m + n)；收尾的两个 while 都要写 |
| 并 / 交 / 差 | 无序 O(mn)；有序是归并的变形，O(m + n) |
| 找缺失 | 有序看 `A[i] - i` 的跳变；无序开表，表长跟着最大值走 |
| 找重复 | 有序数一段、跳一段（`i = j - 1`）；无序开表，或者 O(n²) 标 -1 |
| 两数之和 | 无序开表 O(n)，先查再登记、先查范围；有序两头夹，每步划掉一行或一列 |

如果只留一条：**数组上花钱的只有两件事，挪和扫。** 挪是「挨着放」的代价，躲不掉；扫是「不知道在哪」的代价，有序能把它降下来 —— 查找从 n 降到 log n，并交差从 mn 降到 m + n，两数之和从两两去试变成两头一夹。而有序本身是插入时付的钱：每插一个都得挪到它该在的位置，再也不能随手 Append。这笔账划不划算，取决于查得多还是插得多。
