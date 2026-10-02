---
title: Git 第三章：合并要看三个版本，冲突只看一段区域
date: 2026-09-21 09:30:00
description: Colt Steele《The Git & Github Bootcamp》合并那一章的复盘。git merge 只有一条命令，却有两种完全不同的处理方式，快进只是改写一个 41 字节的文件，而三方合并才是真正在计算内容。文章还说明了两件最容易记反的事情，一是冲突的判定单位并不是文件，而是一段连续的改动；二是从 add 到 commit，Git 自始至终都不会检查冲突标记有没有删干净。
categories:
  - [课外, AI Infra, Git]
tags:
  - 合并
  - 冲突
  - 三方合并
cover: /img/covers/Git-Chapter3-Merging.svg
series: Git
privacy: protected
sitemap: false
private_section: 课外
---

把分支分出去，是为了让各条工作线各自独立地进行，但分出去的东西最终还是要合并回来。这一章只有一条命令：

```bash
git merge <分支名>
```

难的并不是这条命令本身，而是它的**两种处理方式**。同样是一句 `git merge feature`，有时候它一声不响就完成了，有时候它会创建一个新的提交，有时候它又会直接停下来，把文件改得面目全非。这三种结果并不是随机出现的，而是取决于两条分支的历史是什么形状。

上一章的结论是，分支是一个记录着提交号的文件，而 HEAD 是一个记录着分支名的文件。这一章会继续使用这个模型，**合并的两种处理方式，区别就在于那个分支文件能不能直接改写**。

<!-- more -->

## 一、快进：什么都没算，只是改写了那个文件

先看最简单的情况。从 `master` 分出 `feature` 之后，只有 `feature` 继续往前提交，而 `master` 一步都没有动。

在合并之前，需要先确认一件事，**合并是有方向的**。`git merge` 会把别的分支合并进**当前分支**，所以要先切换到接收合并的那一边。

```bash
git switch master

git rev-list --all --count
# 2
cat .git/refs/heads/master
# 18f9e7f1416950268c11dd18e87993e172d1ba77
cat .git/refs/heads/feature
# 505a06e35b2680f5e27a8fbc0b1fd71b7e6a3e25
```

*代码 1：合并之前，仓库里一共有两个提交，两条分支各自记录着其中一个。*

```bash
git merge feature
# Updating 18f9e7f..505a06e
# Fast-forward
#  config.txt | 2 +-
#  1 file changed, 1 insertion(+), 1 deletion(-)
```

*代码 2：`Fast-forward`，也就是快进。*

再看一下合并之后仓库里发生了什么变化：

```bash
git rev-list --all --count
# 2        ← 还是 2，没有产生任何新提交

cat .git/refs/heads/master
# 505a06e35b2680f5e27a8fbc0b1fd71b7e6a3e25
cat .git/refs/heads/feature
# 505a06e35b2680f5e27a8fbc0b1fd71b7e6a3e25
```

*代码 3：提交的总数一个都没有增加，`master` 文件里的那个 40 位数字被换成了 `feature` 的提交号。*

**快进其实什么都没有合并。** `feature` 上的那些提交本来就保存在 `.git/objects` 里，只是原先从 `master` 出发，没有一条路能走到它们。Git 发现 `master` 指向的提交正好是 `feature` 的祖先，中间没有任何分叉，于是就把 `master` 那个 41 字节的文件改写成 `feature` 的提交号，再把工作区刷新一下，整个过程就结束了。

`Updating 18f9e7f..505a06e` 这一行说的正是这件事，它表达的并不是「合并了什么」，而是「指针从哪里移动到了哪里」。

所以「把 `feature` 上的提交传到 `master` 上」这种说法，用在快进上是反过来的。**提交本身并没有移动，移动的是分支。** 现在两条分支指向同一个提交，在两边执行 `git log` 看到的也是同一段历史。

如果再合并一次，结果是这样的：

```bash
git merge feature
# Already up to date.
```

*代码 4：`master` 已经能够走到 `feature` 了，所以没有可以移动的余地。*

快进的代价是，从历史记录上看不出这条分支曾经存在过。所有的提交排成一条直线，`feature` 上的那几次提交，和直接在 `master` 上提交的没有任何区别。如果想把这条分支保留在历史记录里，可以使用 `--no-ff`，强制创建一个合并提交：

```bash
git merge --no-ff feature --no-edit
# Merge made by the 'ort' strategy.
#  config.txt | 2 +-
#  1 file changed, 1 insertion(+), 1 deletion(-)

git log --oneline --graph
# *   8094795 Merge branch 'feature'
# |\
# | * 505a06e feature: 端口换成 8080
# |/
# * 18f9e7f 初始配置
```

*代码 5：本来可以快进，但 `--no-ff` 让历史照样先分叉、再合拢。*

## 二、算不动了的时候：Git 去找共同祖先

真正需要「合并」的，是另一种形状，那就是**两边都各自往前提交过**。

```bash
# 共同的起点
cat config.txt
# # 服务配置
# 端口 = 3000
# 超时 = 30
# 日志 = info

# feature 改第 2 行
git switch -c feature
sed -i 's/端口 = 3000/端口 = 8080/' config.txt
git commit -am "feature: 端口换成 8080"

# master 改第 4 行
git switch master
sed -i 's/日志 = info/日志 = debug/' config.txt
git commit -am "master: 日志级别调成 debug"
```

*代码 6：两条分支各自提交过一次，修改的是同一个文件里的不同行。*

这时 `master` 已经不再是 `feature` 的祖先了，所以不能简单地改写那个分支文件。如果直接改写，就等于把 `master` 自己的那次提交丢掉了。于是 Git 采用了另一种处理方式：

```bash
git merge-base master feature
# 18f9e7f...        ← 两条线最后一次重合的地方

git merge feature
# Auto-merging config.txt
# Merge made by the 'ort' strategy.
#  config.txt | 2 +-
#  1 file changed, 1 insertion(+), 1 deletion(-)
```

*代码 7：`merge-base` 可以找出共同祖先；`ort` 是 Git 现在默认使用的合并策略的名字。*

**这就是「三方合并」中的三方，分别是共同祖先、HEAD 这一边的现状，以及对方那一边的现状。** Git 并不是把两个文件放在一起，看哪一边对、哪一边错，因为那样根本无法判断。它的做法是拿两边分别和祖先比较，得出两份改动清单，一份是「这一边修改了第 2 行」，另一份是「那一边修改了第 4 行」，然后把这两份清单都应用到祖先上。

![共同祖先、两边现状、合并结果四份文件的对照](/img/posts/git-merging/three-way.svg)

*图 1：三份输入，一份输出。两边改动的不是同一个地方，所以两份改动都能保留下来，结果里的 `端口 = 8080` 和 `日志 = debug` 谁也没有覆盖谁。*

这一次合并的产物是一个**新的提交**，而且它和普通的提交在结构上有一个区别：

```bash
git cat-file -p HEAD | head -3
# tree 365e15daf4d42c49530ff01689ab2cc107eb82d7
# parent 2e0fc5ae6431367a11f8fb37e022b483d1ca86fc
# parent 505a06e35b2680f5e27a8fbc0b1fd71b7e6a3e25
```

*代码 8：两个 `parent`。*

普通的提交只有一个父提交，而合并提交有两个。**第一个父提交是合并之前的 HEAD，第二个父提交是被合并进来的那条分支。** 两段历史就是在这里连接起来的，`git log --graph` 画出的那个先分叉、再合拢的形状，表示的正是这两个父提交。

而另一边则完全没有被改动：

```bash
git rev-parse feature
# 505a06e35b2680f5e27a8fbc0b1fd71b7e6a3e25      ← 和合并前一模一样
```

*代码 9：`git merge` 是单向的，`feature` 一步都没有移动。*

`feature` 仍然停在原来的位置上，切换过去看到的仍然是它自己的那个版本。如果想让两边都同步，就要再切换到 `feature` 上合并一次，而这一次合并会是快进。

其实代码 7 里的那几行输出，并不是在敲完命令之后立刻出现的。合并计算完成、需要写提交信息的时候，**Git 会先打开编辑器**，里面已经填好了默认的提交信息：

```text
Merge branch 'feature'
# Please enter a commit message to explain why this merge is necessary,
# especially if it merges an updated upstream into a topic branch.
#
# Lines starting with '#' will be ignored, and an empty message aborts
# the commit.
```

*代码 10：三方合并成功之后弹出的编辑器，保存并退出之后，合并提交才真正生成。*

如果不想每次都经过这一步，可以用 `git merge feature -m "..."` 事先给出提交信息，或者加上 `--no-edit`，直接使用默认的那句信息。

## 三、冲突的单位不是文件，是一段连续的区域

上一节的两边修改的是同一个文件，却顺利地合并了。那么冲突到底在什么时候才会发生呢？

一种常见的说法是「两边修改了同一个文件，就会发生冲突」。如果按照这种说法，代码 6 那次合并就应该发生冲突，但实际上并没有。下面换一组改动再试一次，这一次让 `master` 修改第 3 行，也就是只往前挪了一行：

```bash
# feature 还是改第 2 行：端口 = 8080
# master 这次改第 3 行：超时 = 60
git merge feature
# Auto-merging config.txt
# CONFLICT (content): Merge conflict in config.txt
# Automatic merge failed; fix conflicts and then commit the result.
```

*代码 11：仍然是同一个文件，两边仍然各自修改了一行，但这一次发生了冲突。*

两次合并唯一的区别，就在于 `master` 修改的那一行和 `feature` 修改的那一行之间的距离。把两处改动之间的间隔逐渐拉开，测试的结果如下：

| 两处改动之间隔着几行没动过的内容 | 结果 |
| --- | --- |
| 0 行（挨着） | 冲突 |
| 1 行 | 干净合并 |
| 2 行 | 干净合并 |
| 3 行 | 干净合并 |

**Git 比较的并不是文件，而是一块一块连续的改动区域。** 两边相对于祖先所做的改动，只要中间是隔开的，就是两处互不相干的修改，可以各自保留；而一旦两处改动紧挨在一起，Git 就没有依据来判断这一段连续的内容最终应该是什么样子，于是只能把决定权交给使用者。

这一点在冲突块的内容里看得最清楚：

```text
# 服务配置
<<<<<<< HEAD
端口 = 3000
超时 = 60
=======
端口 = 8080
超时 = 30
>>>>>>> feature
日志 = info
```

*代码 12：冲突块里出现了两边都没有修改过的行。*

`端口 = 3000` 这一行，`master` 根本没有改动过，但它照样被卷进了冲突块，这是因为**冲突是按区域整块交出来的，而不是按行**。两边各自完整的一段内容都摆在那里，让人对照着查看。

另外，还要把冲突标记本身认清楚。`<<<<<<<`、`=======` 和 `>>>>>>>` 都是**七个字符**。VS Code 在这几行上方显示的 `(Current Change)` 和 `(Incoming Change)` 并不在文件里，那是编辑器自己添加的按钮。

## 四、冲突发生时，Git 停在哪儿

代码 11 的那三行输出显示完之后，命令就结束了，退出码是 1。**这时不会打开任何编辑器**，上一节那个已经填好提交信息的编辑器，只有在合并成功时才会出现。发生冲突时，Git 把话说完，就把终端交还了，接下来不会再自动发生任何事情。

在这个停下来的状态里，有三个地方各自留下了痕迹。

**第一个地方是工作区里的文件**，文件里被写进了代码 12 那样的冲突标记。

**第二个地方是 `git status` 的输出**：

```bash
git status
# On branch master
# You have unmerged paths.
#   (fix conflicts and run "git commit")
#   (use "git merge --abort" to abort the merge)
#
# Unmerged paths:
#   (use "git add <file>..." to mark resolution)
# 	both modified:   config.txt
#
# no changes added to commit (use "git add" and/or "git commit -a")
```

*代码 13：`Unmerged paths` 是冲突状态下特有的一栏，`both modified` 说明两边都修改过这个文件。*

**第三个地方是索引。** 索引平时是看不到的，但它才是真正阻止提交的东西：

```bash
git ls-files -u
# 100644 291e1ec... 1	config.txt
# 100644 92df3e8... 2	config.txt
# 100644 8c13359... 3	config.txt
```

*代码 14：同一个路径，在索引里同时有三条记录。*

平时一个文件在索引里只占一个位置，而发生冲突时，它占了三个位置。编号 1、2、3 分别对应**共同祖先、HEAD 这一边，以及被合并进来的那一边**，也就是第二节说的那三方，它们被原封不动地保存了下来：

```bash
git cat-file -p :1:config.txt    # 共同祖先
# # 服务配置
# 端口 = 3000
# 超时 = 30
# 日志 = info

git cat-file -p :2:config.txt    # HEAD 这边
# # 服务配置
# 端口 = 3000
# 超时 = 60
# 日志 = info

git cat-file -p :3:config.txt    # feature 那边
# # 服务配置
# 端口 = 8080
# 超时 = 30
# 日志 = info
```

*代码 15：三个槽里各自保存着一份完整的文件，而不只是有冲突的那几行。*

![工作区的冲突标记与索引里三个槽的关系](/img/posts/git-merging/index-stages.svg)

*图 2：文件里的那些尖括号是给人看的草稿，而索引里的这三个槽才是 Git 认可的状态（图中每个槽只摘录了有分歧的两行，实际保存的是整份文件）。`git add` 所做的事情，就是把这三个槽合并成一个。*

只要这三个槽还在，就无法提交：

```bash
git commit -m "解决冲突"
# error: Committing is not possible because you have unmerged files.
# hint: Fix them up in the work tree, and then use 'git add/rm <file>'
# hint: as appropriate to mark resolution and make a commit.
# fatal: Exiting because of an unresolved conflict.
# U	config.txt
```

*代码 16：退出码是 128，什么都没有提交。*

此外，`.git` 目录里还多出了一个 `MERGE_HEAD` 文件，它记录着正在合并的是哪一个提交：

```bash
cat .git/MERGE_HEAD
# 505a06e35b2680f5e27a8fbc0b1fd71b7e6a3e25
git rev-parse feature
# 505a06e35b2680f5e27a8fbc0b1fd71b7e6a3e25
```

*代码 17：有了这个文件，接下来的那次 `git commit` 才知道要写入两个父提交。*

还有一类冲突**根本不带冲突标记**，那就是一边修改了某个文件，而另一边把它删除了：

```bash
git merge feature
# CONFLICT (modify/delete): f.txt deleted in feature and modified in HEAD.
# Version HEAD of f.txt left in tree.
# Automatic merge failed; fix conflicts and then commit the result.
```

*代码 18：在内容层面上无法合并，所以 Git 只能把问题原样摆出来。*

这时文件里是干干净净的，内容就是 HEAD 那一边的原文。需要决定的并不是内容的取舍，而是这个文件应不应该保留。如果要保留，就执行 `git add f.txt`；如果不保留，就执行 `git rm f.txt`。所以**看到 `CONFLICT` 时，不要直接去文件里找尖括号**，应该先看括号里写的冲突类型，只有 `content` 类型的冲突才会带有标记。

## 五、`git add` 的意思是「就按这一版算」，不是「改对了」

解决冲突的步骤本身很简单，就是打开文件，决定这段区域最终是什么样子，删掉冲突标记，然后执行 `git add` 和 `git commit`。

值得单独拿出来说的，是中间那一步到底做了什么。**`git add` 的作用是把索引里的那三个槽合并成一个**，它声明的是「这个文件已经处理完了，就按工作区现在的样子来算」。至于工作区现在是什么样子，Git 并不会检查：

```bash
# 标记原样留着，一个字没删
git add config.txt
# （没有任何输出，退出码 0）

git commit -m "解决冲突"
# [master ca80baa] 解决冲突

git show HEAD:config.txt
# # 服务配置
# <<<<<<< HEAD
# 端口 = 3000
# 超时 = 60
# =======
# 端口 = 8080
# 超时 = 30
# >>>>>>> feature
# 日志 = info
```

*代码 19：那些七个字符的冲突标记原封不动地进入了历史记录，整个过程没有任何警告。*

`git merge --continue` 的处理方式也是一样的，同样不会做检查。**从 `add` 到 `commit`，没有任何一步会替使用者确认冲突标记有没有删干净。** 这是这一章里最容易出错的地方。如果解决冲突解决到一半被打断了，回来之后接着把命令敲完，冲突标记就会跟着一起被提交进去。

Git 自带的检查工具是 `git diff --check`：

```bash
git diff --check
# config.txt:2: leftover conflict marker
# config.txt:5: leftover conflict marker
# config.txt:8: leftover conflict marker
```

*代码 20：退出码是 2，三行冲突标记的位置都被指了出来。*

不过它有一个需要注意的地方。不加参数的 `git diff`，比较的是**工作区和索引**。一个文件一旦执行过 `add`，这两边就一致了，所以检查的结果会是一片干净：

```bash
git add config.txt
git diff --check
# （没有输出，退出码 0）

git diff --cached --check
# config.txt:2: leftover conflict marker
# config.txt:5: leftover conflict marker
# config.txt:8: leftover conflict marker
```

*代码 21：执行 `add` 之后，要加上 `--cached` 才能检查出来。*

所以**如果要在提交之前的最后一刻做检查，就要写成 `git diff --cached --check`**，它检查的是即将被提交的那份内容。

## 六、反悔：`git merge --abort`

如果冲突出现之后，发现这次合并现在还不应该做，并不需要一行一行地手动恢复：

```bash
git merge --abort

cat config.txt
# # 服务配置
# 端口 = 3000
# 超时 = 60
# 日志 = info      ← 标记没了，回到 master 自己那一版

git status -sb
# ## master

ls .git/ | grep MERGE
# （什么都没有了）
```

*代码 22：工作区、索引和 `MERGE_HEAD` 一起回到了执行 `git merge` 之前的状态。*

还有一种情况，就是合并根本没能开始：

```bash
echo "本地没提交的改动" >> config.txt
git merge feature
# error: Your local changes to the following files would be overwritten by merge:
# 	config.txt
# Please commit your changes or stash them before you merge.
# Aborting
```

*代码 23：退出码是 128，文件一个字都没有改动。*

`would be overwritten` 这种说法，在上一章切换分支时已经见过一次了。**两者的判断标准是同一条，就是会不会弄丢还没有提交的内容。** Git 并不在意手上有没有正在进行的工作，它只是拒绝在自己操作的过程中把这些工作冲掉。

## 七、把祖先那一栏调出来：`diff3`

默认的冲突块只会显示两边的内容，但是真正需要做判断的时候，往往缺少的是第三份内容，也就是这一段**原本**是什么样子。

```bash
git config merge.conflictStyle diff3
```

*代码 24：改用 `diff3` 风格。*

同一个冲突，现在显示成了这个样子：

```text
# 服务配置
<<<<<<< HEAD
端口 = 3000
超时 = 60
||||||| 18f9e7f
端口 = 3000
超时 = 30
=======
端口 = 8080
超时 = 30
>>>>>>> feature
日志 = info
```

*代码 25：`|||||||` 和 `=======` 之间多出来的内容，就是共同祖先的那个版本。*

多了这一栏以后，代码 12 留下的那个疑问马上就有了答案。祖先的内容是 `端口 = 3000 / 超时 = 30`，对照着一比较就能知道，HEAD 这一边只修改了超时，而 feature 那一边只修改了端口，所以两处修改都保留下来就是正确的答案。如果没有这一栏，就只能去猜测哪一边改动过哪一行。

## 小结

这一章只有一条命令，但是它背后有两条完全不同的处理路径：

| 情况 | Git 做的事 |
| --- | --- |
| 当前分支是对方的祖先 | 快进：改写那 41 字节的文件，不产生新提交 |
| 两边各自走过 | 三方合并：对照共同祖先算出两份改动，生成一个有两个父的提交 |
| 两份改动挨在一起 | 冲突：写进标记、索引留三个槽，退出码 1 后交还终端 |

冲突状态下用到的几条命令：

| 命令 | 它做的事 |
| --- | --- |
| `git status` | 冲突中多一栏 `Unmerged paths`，标出 `both modified` |
| `git ls-files -u` | 列出索引里那三个槽（祖先 / HEAD / 对方） |
| `git add <文件>` | 三个槽塌成一个，声明「按这一版算」——不检查内容 |
| `git diff --cached --check` | 提交前查残留的冲突标记，这是唯一的一道自觉 |
| `git merge --abort` | 整个合并丢掉，回到 `merge` 之前 |
| `git merge --no-ff` | 能快进也强行造一个合并提交，把这条分支的存在留在历史里 |
| `merge.conflictStyle diff3` | 冲突块里多显示一栏共同祖先 |

把上一章的模型继续往下推，这一章的规则也都不需要死记。**分支是记录着提交号的文件**，所以在能够直接改写这个文件时，就叫作快进，只有在改写会丢失内容时，才需要真正地合并。**合并计算的是三个版本**，所以冲突时索引里会有三个槽，所以 `diff3` 能把第三份内容调出来，也所以 Git 能处理「两边改动的不是同一个地方」，却处理不了「两边改动的是同一段区域」。

剩下的两个缺口，都和「先看清楚再动手」有关。一个是在合并之前，想知道两条分支到底有哪些差别；另一个是在被 `would be overwritten` 拦下时，想先把手上那一半的改动放到一边。下一章先讲 `diff`。
