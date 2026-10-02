---
title: Git 第二章：分支是一个 41 字节的文件
date: 2026-09-20 12:44:00
description: Colt Steele《The Git & Github Bootcamp》分支那一章的复盘。branch、switch、checkout 以及 -d、-D、-m 这几条命令背后，其实只有一个模型。分支是一个记录着提交号的文件，HEAD 是一个记录着分支名的文件，切换分支就是改写其中的那一行。文章还说明了一条很容易记反的规则，那就是修改了文件但还没有提交时切换分支，Git 并不总是会阻止。
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

如果多个人修改同一个项目，而且所有人都往同一条线上提交，那么麻烦并不在于「乱」，而在于**无法单独撤回某一部分**。修复 bug 的提交和添加功能的提交交替排列在同一条历史上，如果想把功能那部分拿掉，就得从一堆相互穿插的提交里把它们挑出来。分支解决的正是这个问题，它让每一条工作线各自独立地前进，回退时也只需要处理自己的那一条。

这一章的命令并不多，只有 `branch`、`switch`、`checkout`，再加上 `-d`、`-D`、`-m` 三个参数。难点也不在命令本身，而在于「分支」这个词听起来像是一份代码的副本。如果真的按照副本来理解，后面几乎每一条规则都会记反，比如为什么创建一百个分支也不占空间、为什么切换分支是瞬间完成的、为什么有时候修改了文件还能切换过去，有时候却不能。

所以这一篇先把分支拆到文件的层面来看。看过之后，上面那些规则就不需要死记了，因为它们都能推导出来。

<!-- more -->

{% learning_experiment git %}

## 一、分支到底是什么

课程里说，分支是「从主干上引出来的一条线」。这个比喻画在白板上很好用，但是它会让人以为分支是一个很重的东西。实际打开 `.git` 目录看一下：

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

**一个分支就是 `.git/refs/heads/` 下的一个文件，文件里写着一个 40 位的提交号，再加上一个换行符，一共 41 个字节。** 不多不少，里面没有任何别的东西。

这一点可以解释后面的一连串现象：

- **创建分支是瞬间完成的，而且几乎不占空间**，因为写一个 41 字节的文件根本花不了多少时间；
- **创建一百个分支，也不会让仓库变大一百倍**，因为提交对象是共用的，分支只是记录了从哪一个提交开始看；
- **删除分支并不会删除提交**，因为删掉的只是那个文件，提交本身仍然保存在 `.git/objects` 里。

这里还有一个容易被忽略的细节，**在空仓库里执行 `git branch`，什么都不会输出**。

```bash
git init demo2 && cd demo2
git branch
# （没有任何输出，退出码 0）
```

*代码 2：在还没有任何提交的时候，一个分支都列不出来。*

这并不是命令出了问题。分支是「记录着某个提交的文件」，既然还没有任何提交，自然也就没有东西可以记录。`master` 要等到第一次 `commit` 之后才会真正出现，在那之前，它只是一个将要被创建的名字。

## 二、HEAD：记着分支名的那一行

有了分支之后，还缺少一样东西，那就是 Git 需要知道**当前是在哪一条分支上工作**，这就是 `HEAD` 的作用。

`HEAD` 同样是一个文件，而且比分支文件还要小：

```bash
cat .git/HEAD
# ref: refs/heads/master

git switch feature
cat .git/HEAD
# ref: refs/heads/feature
```

*代码 3：切换分支时，`.git/HEAD` 里的这一行被改写了。*

所以整个模型分为两层：

- **分支**记录着一个提交号；
- **HEAD** 记录着一个分支名。

![HEAD 指向分支、分支指向提交的两层结构](/img/posts/git-branching/head-and-branch.svg)

*图 1：这三样东西都是文件。`master` 和 `feature` 各自记录着一个提交号，而 `HEAD` 记录的是分支名，并不是提交号。所以在 `feature` 上再提交一次时，只需要改写 `refs/heads/feature` 里的那一行，`HEAD` 一个字都不用改动。*

「切换分支」在文件层面的含义，就是**改写 `.git/HEAD` 里的那一行，再把工作区里的文件更新成新分支所指向的那个提交的样子**。前半步只是修改一个字符串，后半步才是真正需要花时间的部分。

这个结构还留了一个口子，那就是 HEAD 里保存的内容不一定是 `ref: ...` 这种形式，也可以直接是一个提交号。

```bash
git switch --detach HEAD
cat .git/HEAD
# 21d461219b84aec02bce153c03d3146c208b4f98

git symbolic-ref --short HEAD
# fatal: ref HEAD is not a symbolic ref
```

*代码 4：分离头指针，也就是 HEAD 跳过分支，直接指向了一个提交。*

这种状态叫作**分离头指针（detached HEAD）**。在这种状态下，照样可以修改文件，也可以提交，但是新的提交并没有任何分支记录着它。一旦切换走，这个提交的编号就只剩下 `git reflog` 里还保留着了。查看历史上的某个版本时，就会遇到这种状态，看完之后切换回来就可以了。如果想在这个版本上继续工作，就要先执行 `git switch -c <名字>`，给它创建一个分支。

## 三、git branch：看和建

```bash
git branch
#   feature
# * master
```

*代码 5：`*` 标出的是 HEAD 当前指向的分支。*

在命令后面加上一个名字，就可以创建分支：

```bash
git branch tmp

git rev-parse --short master
# 9a2f86f
git rev-parse --short tmp
# 9a2f86f

git symbolic-ref --short HEAD
# master
```

*代码 6：新分支创建在当前的提交上，但 HEAD 并没有跟着移动过去。*

这里有两件事需要分开记住。

**第一，新分支创建在 HEAD 当前所在的提交上。** 它并不是创建在 `master` 上，而是创建在当前所在的位置。如果当前位于 `feature` 上，执行 `git branch tmp` 之后，`tmp` 和 `feature` 就会指向同一个提交。

**第二，`git branch <名字>` 创建完分支之后，并不会切换过去。** 这是一个单纯的创建操作。如果想在创建之后立即切换过去，可以使用 `git switch -c <名字>`，其中 `-c` 是 create 的意思，这样一步就能完成两件事。

## 四、切换：为什么 switch 和 checkout 是两条命令

在切换分支这件事上，`git switch <分支>` 和 `git checkout <分支>` 的效果是一样的。既然效果一样，为什么还要有两条命令呢？

答案在 Git 2.23 的发布说明里写得很直白：

> Two new commands "git switch" and "git restore" are introduced to split "checking out a branch to work on advancing its history" and "checking out paths out of the index and/or a tree-ish to work on advancing the current history" out of the single "git checkout" command.

也就是说，**`checkout` 一个人承担了两项工作**。如果给它一个分支名，它就切换分支；如果给它一个文件路径，它就会用暂存区里的内容覆盖工作区里的那个文件。两件事共用一条命令，就留下了一个真实存在的坑：

```bash
echo "重要的未提交改动" >> f.txt

git checkout f.txt
# Updated 1 path from the index

tail -1 f.txt
# a
```

*代码 7：本来想切换分支，结果却把改动覆盖掉了，而提示只有一句 `Updated 1 path`。*

由于 `f.txt` 并不是一个分支名，所以 `checkout` 执行了第二种操作，用暂存区里的版本覆盖了工作区里的文件。刚才添加的那一行改动就这样消失了，整个过程没有确认，没有警告，退出码也是 0。

如果换成 `switch`，结果是这样的：

```bash
echo "又改一次" >> f.txt

git switch f.txt
# fatal: invalid reference: f.txt

tail -1 f.txt
# 又改一次
```

*代码 8：`switch` 只认识分支，遇到认不出来的参数就会停下来。*

这就是把两项工作拆开的价值。**`switch` 只负责切换分支，如果参数不是分支名，它就会报错退出**，而覆盖文件的那一半功能则交给了 `git restore`。所以日常切换分支时使用 `switch`，可以避免一整类误操作。

需要说明的是，`git switch` 的 man 页到现在仍然标注着 `THIS COMMAND IS EXPERIMENTAL. THE BEHAVIOR MAY CHANGE.`。不过这条命令已经用了很多年，在日常切换分支时是稳定可靠的。如果看到别人的教程或者脚本里写的是 `checkout`，也不能说那是过时的写法，因为 `checkout` 并不会消失，这两条命令会长期并存。

## 五、删除：-d 和 -D 差在哪

```bash
git branch -d feature
# error: The branch 'feature' is not fully merged.
# If you are sure you want to delete it, run 'git branch -D feature'.
```

*代码 9：`-d` 会先检查这条分支上的提交有没有被合并到别处。*

**`-d` 是带有检查的删除，而 `-D` 是强制删除。** 两者的区别就在于这道检查。如果分支上有些提交还没有合并到别的地方，`-d` 就会阻止删除，因为一旦删掉这条分支，那些提交就没有任何分支记录着它们了。

这道检查涉及到「合并」，而合并要到下一章才会讲。但是并不能因此就一律使用 `-D`，**日常应该默认使用 `-d`，让它帮忙做这道检查**。如果确认真的要删除，报错信息里已经写好了使用 `-D` 的命令，照着输入就可以了。反过来说，如果习惯性地使用 `-D`，就相当于永久关掉了这道保险。

另外还有一条限制：

```bash
git switch feature
git branch -D feature
# error: Cannot delete branch 'feature' checked out at '/tmp/demo'
```

*代码 10：不能删除自己当前所在的分支。*

从模型上来看，这是必然的结果。因为 HEAD 记录着分支名，如果把那个分支文件删掉了，HEAD 就会指向一个不存在的东西。所以在删除分支之前，要先切换到别的分支上。

另外，即使真的删错了分支，提交一般也还在。`git reflog` 记录着 HEAD 的每一次移动，可以从中找回那个提交的编号，然后执行 `git branch <名字> <提交号>`，把分支重新创建出来。因为删掉的只是一个 41 字节的指针，而不是提交的内容。

## 六、改名：-m

`-m` 有两种用法，它们的区别需要记清楚：

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

*代码 11：使用两个参数的形式时，即使当前在别的分支上，照样可以改名。*

**当只有一个参数时，`-m` 修改的是当前分支的名字**，所以这种写法确实要求 HEAD 位于那条分支上。而使用两个参数的形式时，已经写明了要修改哪一条分支，所以无论当前在哪里都可以执行。

## 七、切换被拒绝的时候，Git 在护什么

这一节是整章里最容易记反的地方。

一种常见的说法是「修改过的文件如果没有提交，就不能切换分支，而新建的文件则可以」。这种说法是根据改动的**种类**来划分界线的，但 Git 划分的并不是这条线。实际运行一遍看看：

```bash
# f.txt 在 master 和 feature 上内容相同
echo "改动未提交" >> f.txt

git switch feature
# Switched to branch 'feature'
# M	f.txt

tail -1 f.txt
# 改动未提交
```

*代码 12：修改过的文件虽然没有提交，但切换照样成功了，而且改动也跟着带了过来。*

输出里的 `M f.txt` 这一行，是 Git 在提示这个修改被带到了新的分支上。下面换一种情况：

```bash
# 这次 f.txt 在两个分支上内容不同
echo "master 上的未提交改动" >> f.txt

git switch feature
# error: Your local changes to the following files would be overwritten by checkout:
# 	f.txt
# Please commit your changes or stash them before you switch branches.
# Aborting
```

*代码 13：同样是修改过但没有提交，这一次却被拦住了。*

新建的文件也同样会有两种结果：

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

*代码 14：新建的文件同样有可能阻止切换。*

把这四种情况放在一起，规则就清楚了。**Git 是否阻止切换，看的并不是改动的种类，而是切换过去之后，会不会覆盖掉还没有提交的内容。**

| 情况 | 目标分支上那个文件 | 结果 |
| --- | --- | --- |
| 改了已追踪文件 | 内容相同 | 放行，改动跟着走 |
| 改了已追踪文件 | 内容不同 | 拦下（会覆盖改动） |
| 新建未追踪文件 | 不存在 | 放行，文件跟着走 |
| 新建未追踪文件 | 已被追踪 | 拦下（会覆盖新文件） |

其实两条报错信息已经把意思说得很明白了，它们的关键词都是 `would be overwritten`，也就是「会被覆盖」。Git 并不介意带着没有提交的改动切换分支，它只是拒绝在切换的过程中弄丢这些改动。

被放行的那两种情况还有一个副作用值得了解，那就是**没有提交的改动并不属于任何一个分支**。它们留在工作区里，切换到哪个分支，就会跟到哪个分支。如果在 `master` 上改了一半，然后切换到 `feature`，并在那里提交了，这个改动就进入了 `feature` 的历史。当切换被阻止时，可以用 `stash` 暂存，也可以先提交一次，但更值得先想一想的是，这一半的改动原本打算放在哪一条分支上。

## 小结

把这一章的命令，按照「它改动了哪个文件」重新排列一遍：

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

真正需要记住的，只有开头那两句话，**分支是记录着提交号的文件，而 HEAD 是记录着分支名的文件**。这一章里其余的规则都可以由此推导出来，包括创建分支为什么快、删除分支为什么不会丢失提交、为什么不能删除自己当前所在的分支，以及切换分支时 Git 到底在保护什么。

不过这里还留着一个明显的缺口，那就是分支分出去之后，要怎样再合并回来。如果两条分支各自修改了同一个文件的同一行，Git 应该以哪一边为准呢？下一章讲合并和冲突。
