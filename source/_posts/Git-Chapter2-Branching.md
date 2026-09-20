---
title: Git 第二章：分支是一个 41 字节的文件
date: 2026-09-20 12:44:00
description: Colt Steele《The Git & Github Bootcamp》分支那一章的复盘。branch / switch / checkout / -d / -D / -m 这几条命令背后其实只有一个模型——分支是一个记着提交号的文件，HEAD 是一个记着分支名的文件，切分支就是改写那一行。顺带纠正一个很容易记反的规则：改了文件没提交就切分支，Git 并不总是拦你。
categories:
  - [课外, AI Infra, Git]
tags:
  - 分支
  - HEAD
  - 引用与指针
cover: /img/covers/Git-Chapter2-Branching.svg
series: Git
privacy: protected
sitemap: false
private_section: 课外
---

多个人改同一个项目，如果所有人都往同一条线上提交，麻烦不在于「乱」，而在于**没法单独撤回**。修 bug 的提交和加功能的提交交替排在一条历史上，想把功能那部分拿掉，就得从一堆互相穿插的提交里择出来。分支解决的就是这件事：让每条工作线各走各的，回退的时候只动自己那条。

这一章的命令不多——`branch` / `switch` / `checkout`，加上 `-d` / `-D` / `-m` 三个参数。难点也不在命令，在于**「分支」这个词听起来像是一份代码的副本**。真按副本去理解，后面几乎每条规则都会记反：为什么建一百个分支不占空间、为什么切分支是瞬间的、为什么有时候改了文件能切过去、有时候又不能。

所以这一篇先把分支拆到文件层面看一眼。看过之后，上面那些规则不用背，能推出来。

<!-- more -->

## 一、分支到底是什么

课程里说分支是「从主干上引出来的一条线」。这个比喻画在白板上很好用，但它会让人以为分支是个重东西。实际打开 `.git` 看一眼：

```bash
git init demo && cd demo
echo "a" > f.txt && git add . && git commit -m "one"

ls .git/refs/heads/
# master

cat .git/refs/heads/master
# 9a2f86f27b271d52c04ac45b9a54040c5f8e1543

wc -c < .git/refs/heads/master
# 41
```

*代码 1：一个分支在磁盘上的全部内容。*

**一个分支就是 `.git/refs/heads/` 下的一个文件，里面写着一个 40 位的提交号，加一个换行，一共 41 字节。** 不多不少，没有别的东西。

这一条解释了后面一连串现象：

- **建分支是瞬间的，也几乎不占空间**——写一个 41 字节的文件能有多慢；
- **建一百个分支不会让仓库变大一百倍**——提交对象是共用的，分支只是记着从哪个提交看起；
- **删分支不会删掉提交**——删的只是那个文件，提交还躺在 `.git/objects` 里。

顺带一个容易忽略的细节：**空仓库里 `git branch` 什么都不输出**。

```bash
git init demo2 && cd demo2
git branch
# （没有任何输出，退出码 0）
```

*代码 2：还没有提交的时候，一个分支都列不出来。*

不是命令坏了。分支是「记着某个提交的文件」，一个提交都没有，自然没有东西可记。`master` 要等第一次 `commit` 之后才真正出现——在那之前它只是个将要被创建的名字。

## 二、HEAD：记着分支名的那一行

有了分支之后还缺一样东西：Git 得知道**现在是在哪条分支上工作**。这就是 `HEAD`。

它同样是个文件，而且更小：

```bash
cat .git/HEAD
# ref: refs/heads/master

git switch feature
cat .git/HEAD
# ref: refs/heads/feature
```

*代码 3：切分支时，`.git/HEAD` 这一行被改写了。*

所以整个模型是两层的：

- **分支**记着一个提交号；
- **HEAD** 记着一个分支名。

![HEAD 指向分支、分支指向提交的两层结构](/img/posts/git-branching/head-and-branch.svg)

*图 1：三样东西都是文件。`master` 和 `feature` 各记着一个提交号，`HEAD` 记着的是分支名而不是提交号 —— 所以在 `feature` 上再提交一次，只需要改写 `refs/heads/feature` 里的那一行，`HEAD` 一个字都不用动。*

「切换分支」在文件层面就是**改写 `.git/HEAD` 那一行，然后把工作区的文件刷成新分支指向的那个提交的样子**。前半步是改一个字符串，后半步才是真正花时间的部分。

这个结构还留了一个口子：HEAD 里存的不一定是 `ref: ...`，也可以直接是一个提交号。

```bash
git switch --detach HEAD
cat .git/HEAD
# 21d461219b84aec02bce153c03d3146c208b4f98

git symbolic-ref --short HEAD
# fatal: ref HEAD is not a symbolic ref
```

*代码 4：分离头指针——HEAD 越过分支，直接指住了一个提交。*

这就是**分离头指针（detached HEAD）**。这种状态下照样能改文件、能提交，但新提交没有任何分支记着它——一旦切走，那个提交号就只剩 `git reflog` 里还留着。查看历史上某个版本时会撞见这个状态，看完切回来就行；要在上面接着干活，得先 `git switch -c <名字>` 给它安一个分支。

## 三、git branch：看和建

```bash
git branch
#   feature
# * master
```

*代码 5：`*` 标的是 HEAD 当前指向的分支。*

加一个名字就是建分支：

```bash
git branch tmp

git rev-parse --short master
# 9a2f86f
git rev-parse --short tmp
# 9a2f86f

git symbolic-ref --short HEAD
# master
```

*代码 6：新分支建在当前提交上，但 HEAD 没有跟着走。*

两件事要分开记：

**第一，新分支建在 HEAD 当前所在的提交上。** 不是建在 `master` 上，是建在「你现在站的地方」。站在 `feature` 上执行 `git branch tmp`，`tmp` 就和 `feature` 指着同一个提交。

**第二，`git branch <名字>` 建完不会切过去。** 这是个纯粹的创建动作。想建完就过去，用 `git switch -c <名字>`——`-c` 是 create，一步顶两步。

## 四、切换：为什么 switch 和 checkout 是两条命令

`git switch <分支>` 和 `git checkout <分支>` 在切分支这件事上效果一样。既然一样，为什么要有两条？

答案在 Git 2.23 的发布说明里写得很直白：

> Two new commands "git switch" and "git restore" are introduced to split "checking out a branch to work on advancing its history" and "checking out paths out of the index and/or a tree-ish to work on advancing the current history" out of the single "git checkout" command.

**`checkout` 身兼两职**：给它一个分支名，它切分支；给它一个文件路径，它拿暂存区的内容把工作区那个文件盖回去。两件事共用一条命令，就留下了一个真实的坑：

```bash
echo "重要的未提交改动" >> f.txt

git checkout f.txt
# Updated 1 path from the index

tail -1 f.txt
# a
```

*代码 7：本想切分支，结果把改动盖掉了——提示只有一句 `Updated 1 path`。*

`f.txt` 不是分支名，于是 `checkout` 走了第二条路：用暂存区的版本覆盖工作区。刚才那行改动没了，没有确认，没有警告，退出码是 0。

换成 `switch`：

```bash
echo "又改一次" >> f.txt

git switch f.txt
# fatal: invalid reference: f.txt

tail -1 f.txt
# 又改一次
```

*代码 8：`switch` 只认分支，认不出来就停手。*

这就是拆开的价值：**`switch` 只做切分支，参数不是分支就报错退出**；覆盖文件那半边交给了 `git restore`。日常切分支用 `switch`，少一整类误伤。

有一点要说清楚：`git switch` 的 man 页到现在仍然标着 `THIS COMMAND IS EXPERIMENTAL. THE BEHAVIOR MAY CHANGE.`。它已经用了很多年，日常切分支是稳的，但看到别人的教程或脚本里写 `checkout`，那不是过时——`checkout` 不会消失，两条命令会长期并存。

## 五、删除：-d 和 -D 差在哪

```bash
git branch -d feature
# error: The branch 'feature' is not fully merged.
# If you are sure you want to delete it, run 'git branch -D feature'.
```

*代码 9：`-d` 会先检查这条分支的提交有没有被合并进别处。*

**`-d` 是带检查的删除，`-D` 是强制删除。** 差别就是这道检查：分支上有提交还没合并到别的地方，`-d` 会拦下来，因为删掉之后那些提交就没有任何分支记着了。

这道检查涉及「合并」，下一章才讲。但不必因此就一律用 `-D`——**日常应该默认用 `-d`，让它替你拦**；真确认要扔，报错信息本身已经把 `-D` 的命令写在那儿了，照着敲即可。反过来，习惯性用 `-D` 就等于把这道保险永久关掉。

还有一条限制：

```bash
git switch feature
git branch -D feature
# error: Cannot delete branch 'feature' checked out at '/tmp/demo'
```

*代码 10：不能删掉自己正站着的分支。*

从模型上看这是必然的：HEAD 记着分支名，把那个文件删了，HEAD 就指向一个不存在的东西。删分支之前先切走。

顺便：就算真的删错了，提交一般也还在。`git reflog` 记着 HEAD 每一次移动，能找回那个提交号，再 `git branch <名字> <提交号>` 把分支接回去。删的是 41 字节的指针，不是内容。

## 六、改名：-m

`-m` 有两种用法，区别值得记准：

```bash
# 一个参数：改当前分支的名字
git branch -m new-name

# 两个参数：改任意一条分支的名字，不用切过去
git symbolic-ref --short HEAD
# master
git branch -m feature feat-new
git branch --format='%(refname:short)'
# feat-new
# master
```

*代码 11：两参数形式在别的分支上照样能改名。*

**只有一个参数的时候，`-m` 改的是当前分支**，所以这种写法确实要求 HEAD 在那条分支上。但两个参数的形式写明了改谁，站在哪里都能执行。

## 七、切换被拒绝的时候，Git 在护什么

这一节是整章最容易记反的地方。

常见的记法是「改过的文件没提交就不能切分支，新建的文件可以」。这个总结用改动的**种类**来划线，但 Git 划的不是这条线。实际跑一遍：

```bash
# f.txt 在 master 和 feature 上内容相同
echo "改动未提交" >> f.txt

git switch feature
# Switched to branch 'feature'
# M	f.txt

tail -1 f.txt
# 改动未提交
```

*代码 12：改过的文件没提交，切换照样成功，改动跟着过来了。*

`M f.txt` 那行是 Git 在告诉你：这个修改被带到新分支来了。换一种情况：

```bash
# 这次 f.txt 在两个分支上内容不同
echo "master 上的未提交改动" >> f.txt

git switch feature
# error: Your local changes to the following files would be overwritten by checkout:
# 	f.txt
# Please commit your changes or stash them before you switch branches.
# Aborting
```

*代码 13：同样是「改过没提交」，这次被拦住了。*

新建的文件也一样有两种结果：

```bash
# draft.txt 在 feature 上不存在
echo "草稿" > draft.txt
git switch feature
# Switched to branch 'feature'   ← 文件跟着过来了

# other.txt 在 feature 上是被追踪的文件
echo "本地新建的 other.txt" > other.txt
git switch feature
# error: The following untracked working tree files would be overwritten by checkout:
# 	other.txt
# Please move or remove them before you switch branches.
# Aborting
```

*代码 14：新建的文件同样可能拦住切换。*

四种情况摆在一起，规则就出来了。**Git 拦不拦你，看的不是改动的种类，而是切过去之后会不会覆盖掉你还没提交的东西。**

| 情况 | 目标分支上那个文件 | 结果 |
| --- | --- | --- |
| 改了已追踪文件 | 内容相同 | 放行，改动跟着走 |
| 改了已追踪文件 | 内容不同 | 拦下（会覆盖改动） |
| 新建未追踪文件 | 不存在 | 放行，文件跟着走 |
| 新建未追踪文件 | 已被追踪 | 拦下（会覆盖新文件） |

两条报错信息其实已经把话说明白了，关键词都是 `would be overwritten`——「会被覆盖」。Git 不介意你带着未提交的改动换分支，它只是拒绝在这个过程中弄丢它们。

放行那两行还有个副作用值得知道：**未提交的改动不属于任何分支**。它躺在工作区，切到哪条分支就跟到哪条分支。在 `master` 上改了一半、切到 `feature`、在那儿提交了，这个改动就进了 `feature` 的历史。被拦下来的时候，`stash` 和先提交一次都是出路，但更值得先问一句：这半截改动本来打算放在哪条分支上。

## 小结

这一章的命令按「它动了哪个文件」重排一遍：

| 命令 | 它做的事 |
| --- | --- |
| `git branch` | 列出 `.git/refs/heads/` 下的分支，`*` 标出 HEAD 在哪 |
| `git branch <名>` | 在当前提交上写一个 41 字节的新文件，不切过去 |
| `git switch <名>` | 改写 `.git/HEAD` 那一行，再把工作区刷成对应提交 |
| `git switch -c <名>` | 上面两件事一步做完 |
| `git checkout <名>` | 同样能切；但参数是文件名时会改成覆盖文件 |
| `git branch -d <名>` | 删分支文件，先检查提交有没有被合并走 |
| `git branch -D <名>` | 跳过检查直接删；不能删 HEAD 正站着的那条 |
| `git branch -m <新>` | 改当前分支的名字（两个参数则改指定的那条） |

真正需要记住的只有开头那两行：**分支是记着提交号的文件，HEAD 是记着分支名的文件。** 这一章其余的规则都能从这里推出来——建分支为什么快、删分支为什么不丢提交、为什么不能删自己站着的那条、切换的时候 Git 到底在护什么。

还剩一个明显的缺口：分支分出去之后怎么合回来。两条分支各自改了同一个文件的同一行，Git 该听谁的？下一章讲合并和冲突。
