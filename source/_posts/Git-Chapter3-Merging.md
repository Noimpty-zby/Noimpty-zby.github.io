---
title: Git 第三章：合并要看三个版本，冲突只看一段区域
date: 2026-09-21 09:30:00
description: Colt Steele《The Git & Github Bootcamp》合并那一章的复盘。git merge 只有一条命令，却有两种完全不同的走法——快进只是改写一个 41 字节的文件，三方合并才真的在算内容。顺带把两件最容易记反的事钉死：冲突的判定单位不是文件而是一段连续的改动，以及从 add 到 commit，Git 全程不检查冲突标记有没有删干净。
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

分支分出去是为了各干各的，但分出去的东西终归要合回来。这一章的命令只有一条：

```bash
git merge <分支名>
```

难的不是这条命令，是它的**两种走法**。同样一句 `git merge feature`，有时候一声不响就完事了，有时候会造出一个新提交，有时候直接停下来把文件改得面目全非。这三种结果不是随机的，取决于两条分支的历史长成什么形状。

上一章的结论是：分支是一个记着提交号的文件，HEAD 是一个记着分支名的文件。这一章接着用这个模型——**合并的两种走法，差别就在于那个文件能不能直接改写。**

<!-- more -->

## 一、快进：什么都没算，只是改写了那个文件

先看最简单的情况：从 `master` 分出 `feature`，之后只有 `feature` 往前走，`master` 一步没动。

合并前先确认一件事，**合并是有方向的**：`git merge` 把别人合进**当前分支**，所以要先站到接收的那一边。

```bash
git switch master

git rev-list --all --count
# 2
cat .git/refs/heads/master
# 18f9e7f1416950268c11dd18e87993e172d1ba77
cat .git/refs/heads/feature
# 505a06e35b2680f5e27a8fbc0b1fd71b7e6a3e25
```

*代码 1：合并前，仓库里一共两个提交，两条分支各记着一个。*

```bash
git merge feature
# Updating 18f9e7f..505a06e
# Fast-forward
#  config.txt | 2 +-
#  1 file changed, 1 insertion(+), 1 deletion(-)
```

*代码 2：`Fast-forward` —— 快进。*

看一眼合并之后仓库里发生了什么变化：

```bash
git rev-list --all --count
# 2        ← 还是 2，没有产生任何新提交

cat .git/refs/heads/master
# 505a06e35b2680f5e27a8fbc0b1fd71b7e6a3e25
cat .git/refs/heads/feature
# 505a06e35b2680f5e27a8fbc0b1fd71b7e6a3e25
```

*代码 3：提交总数一个没多，`master` 那个文件里的 40 位数字被换成了 `feature` 的。*

**快进什么都没合。** `feature` 上那些提交本来就在 `.git/objects` 里躺着，`master` 只是原先没有一条路能走到它们。Git 发现 `master` 指的提交正好是 `feature` 的祖先——中间没有任何分岔——于是把 `master` 那个 41 字节的文件重写成 `feature` 的提交号，工作区刷新一下，结束。

`Updating 18f9e7f..505a06e` 这行说的就是这件事：不是「合并了什么」，是「那个指针从哪挪到了哪」。

所以「把 `feature` 上的提交传到 `master`」这个说法在快进这里是反的：**提交没有动，动的是分支。** 两条分支现在指着同一个提交，`git log` 在两边看到的是同一段历史。

再合一次：

```bash
git merge feature
# Already up to date.
```

*代码 4：`master` 已经能走到 `feature` 了，没有可挪的余地。*

快进的代价是历史上看不出这条分支存在过——提交排成一条直线，`feature` 上那几次提交和直接在 `master` 上敲出来的没有区别。想把它留在历史里，用 `--no-ff` 强制造一个合并提交：

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

*代码 5：本来能快进，`--no-ff` 让它照样分叉再合拢。*

## 二、算不动了的时候：Git 去找共同祖先

真正需要「合」的是另一种形状：**两边都往前走过。**

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

*代码 6：两条分支各自提交过一次，改的是同一个文件的不同行。*

这时 `master` 已经不是 `feature` 的祖先了，那个文件没法一改了之——直接改写就等于把 `master` 自己那次提交扔掉。Git 走另一条路：

```bash
git merge-base master feature
# 18f9e7f...        ← 两条线最后一次重合的地方

git merge feature
# Auto-merging config.txt
# Merge made by the 'ort' strategy.
#  config.txt | 2 +-
#  1 file changed, 1 insertion(+), 1 deletion(-)
```

*代码 7：`merge-base` 找出共同祖先；`ort` 是 Git 现在默认的合并策略的名字。*

**这就是「三方合并」里的三方：共同祖先、HEAD 这边的现状、对方的现状。** Git 不是把两个文件对着看谁对谁错——那样根本判断不出来。它拿两边分别和祖先比，得出「这边把第 2 行改了」和「那边把第 4 行改了」两份改动清单，然后把两份清单都应用到祖先上。

![共同祖先、两边现状、合并结果四份文件的对照](/img/posts/git-merging/three-way.svg)

*图 1：三份输入，一份输出。两边动的不是同一处，所以两份改动都能收下 —— 结果里的 `端口 = 8080` 和 `日志 = debug`，谁也没覆盖谁。*

这次的产物是一个**新提交**，而且它和普通提交有个结构上的区别：

```bash
git cat-file -p HEAD | head -3
# tree 365e15daf4d42c49530ff01689ab2cc107eb82d7
# parent 2e0fc5ae6431367a11f8fb37e022b483d1ca86fc
# parent 505a06e35b2680f5e27a8fbc0b1fd71b7e6a3e25
```

*代码 8：两个 `parent`。*

普通提交只有一个父，合并提交有两个：**第一个是合并前的 HEAD，第二个是被合进来的那条分支。** 两段历史就是在这里接上的，`git log --graph` 那个分叉再合拢的形状画的正是这两个 parent。

另一边完全没被碰过：

```bash
git rev-parse feature
# 505a06e35b2680f5e27a8fbc0b1fd71b7e6a3e25      ← 和合并前一模一样
```

*代码 9：`git merge` 是单向的，`feature` 一步没动。*

`feature` 还停在原地，切过去看还是它自己那一版。想让两边都跟上，得再站到 `feature` 上合一次——这次会是快进。

代码 7 那几行输出其实不是敲完命令立刻出现的。合并算完、要写提交信息的时候，**Git 会先打开编辑器**，里面已经填好了默认信息：

```text
Merge branch 'feature'
# Please enter a commit message to explain why this merge is necessary,
# especially if it merges an updated upstream into a topic branch.
#
# Lines starting with '#' will be ignored, and an empty message aborts
# the commit.
```

*代码 10：三方合并成功后弹出的编辑器。存盘退出，合并提交才真正落下。*

不想每次都过这一道，`git merge feature -m "..."` 事先给好信息，或者 `--no-edit` 直接收下默认的那句。

## 三、冲突的单位不是文件，是一段连续的区域

上一节两边改的是同一个文件，却干净地合上了。那冲突到底什么时候发生？

常见的说法是「两边改了同一个文件就会冲突」。按这个说法，代码 6 那次就该冲突——它没有。换一组改动再试，这次让 `master` 改第 3 行，只挪一行：

```bash
# feature 还是改第 2 行：端口 = 8080
# master 这次改第 3 行：超时 = 60
git merge feature
# Auto-merging config.txt
# CONFLICT (content): Merge conflict in config.txt
# Automatic merge failed; fix conflicts and then commit the result.
```

*代码 11：同一个文件，仍然是两边各改一行，这次冲突了。*

两次的唯一区别是 `master` 改的那一行离 `feature` 改的那一行远了一格还是近了一格。把间隔拉开测一遍：

| 两处改动之间隔着几行没动过的内容 | 结果 |
| --- | --- |
| 0 行（挨着） | 冲突 |
| 1 行 | 干净合并 |
| 2 行 | 干净合并 |
| 3 行 | 干净合并 |

**Git 比的不是文件，是一块块连续的改动区域。**两边各自相对祖先的改动，只要中间隔得开，就是两处互不相干的修改，各收各的；一旦贴到一起，Git 没有依据判断这段连续的内容最终该长什么样，于是把决定权交出来。

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

*代码 12：冲突块里出现了两边都没改过的行。*

`端口 = 3000` 这一行 `master` 根本没动，它照样被卷进了冲突块——因为**冲突是按区域整块交出来的，不是按行**。两边各自完整的一段摆在那里，让人对着看。

顺带把标记本身认准：`<<<<<<<`、`=======`、`>>>>>>>` 都是**七个字符**。VS Code 在这几行上显示的 `(Current Change)` / `(Incoming Change)` 不在文件里，那是编辑器自己贴的按钮。

## 四、冲突发生时，Git 停在哪儿

代码 11 那三行输出之后，命令就结束了，退出码是 1。**没有任何编辑器被打开**——上一节那个填好信息的编辑器，只在合并成功时才出现。冲突的时候 Git 把话说完就把终端还给你了，接下来什么都不会自己发生。

停下来的这个状态，三个地方各留了一份痕迹。

**一是工作区的文件**，被写进了代码 12 那样的标记。

**二是 `git status`**：

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

*代码 13：`Unmerged paths` 是冲突态独有的一栏，`both modified` 说明两边都改过它。*

**三是索引**。这一份平时看不见，但它才是真正卡住提交的东西：

```bash
git ls-files -u
# 100644 291e1ec... 1	config.txt
# 100644 92df3e8... 2	config.txt
# 100644 8c13359... 3	config.txt
```

*代码 14：同一个路径，索引里同时挂着三条记录。*

平时一个文件在索引里只占一个位置。冲突的时候它占了三个，编号 1、2、3 分别是**共同祖先、HEAD 这边、被合进来的那边**——就是第二节那三方，原封不动地存了下来：

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

*代码 15：三个槽里各是一份完整的文件，不是「有冲突的那几行」。*

![工作区的冲突标记与索引里三个槽的关系](/img/posts/git-merging/index-stages.svg)

*图 2：文件里那堆尖括号是给人看的草稿，索引里这三个槽才是 Git 认的状态（图上每个槽只摘了有分歧的两行，实际存的是整份文件）。`git add` 做的事情是把三个槽塌成一个。*

只要这三个槽还在，提交就走不通：

```bash
git commit -m "解决冲突"
# error: Committing is not possible because you have unmerged files.
# hint: Fix them up in the work tree, and then use 'git add/rm <file>'
# hint: as appropriate to mark resolution and make a commit.
# fatal: Exiting because of an unresolved conflict.
# U	config.txt
```

*代码 16：退出码 128，什么都没提交。*

`.git` 目录里还多了一个 `MERGE_HEAD`，记着正在合的是哪个提交：

```bash
cat .git/MERGE_HEAD
# 505a06e35b2680f5e27a8fbc0b1fd71b7e6a3e25
git rev-parse feature
# 505a06e35b2680f5e27a8fbc0b1fd71b7e6a3e25
```

*代码 17：有它在，接下来那次 `git commit` 才知道要写两个 parent。*

还有一类冲突**根本不带标记**——一边改了文件，另一边把它删了：

```bash
git merge feature
# CONFLICT (modify/delete): f.txt deleted in feature and modified in HEAD.
# Version HEAD of f.txt left in tree.
# Automatic merge failed; fix conflicts and then commit the result.
```

*代码 18：内容层面无从合起，Git 只能把问题原样摆出来。*

这时文件里干干净净，是 HEAD 那一版的原文。要决定的不是内容取舍，而是这个文件该不该留：留就 `git add f.txt`，不留就 `git rm f.txt`。所以**看到 `CONFLICT` 不要直接去文件里找尖括号**，先看括号里的类型——`content` 才有标记。

## 五、`git add` 的意思是「就按这一版算」，不是「改对了」

解决冲突的步骤本身很短：打开文件，决定这段区域最终长什么样，删掉标记，`git add`，`git commit`。

值得单独拎出来的是中间那一步到底做了什么。**`git add` 的作用是把索引里那三个槽塌成一个**——它声明的是「这个文件处理完了，按工作区现在这样算」。至于工作区现在是什么样，Git 不看：

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

*代码 19：七个尖括号原封不动进了历史，全程零警告。*

`git merge --continue` 走的是同一条路，也一样不查。**从 `add` 到 `commit`，没有任何一步会替你确认标记删干净了。** 这是这一章最容易栽的地方——冲突解到一半被打断，回来接着敲完命令，标记就跟着提交进去了。

自带的检查工具是 `git diff --check`：

```bash
git diff --check
# config.txt:2: leftover conflict marker
# config.txt:5: leftover conflict marker
# config.txt:8: leftover conflict marker
```

*代码 20：退出码 2，三行标记的位置都点了出来。*

但它有个要注意的地方：`git diff` 不加参数比的是**工作区和索引**。文件一旦 `add` 过，这两边就一致了，检查结果变成一片干净：

```bash
git add config.txt
git diff --check
# （没有输出，退出码 0）

git diff --cached --check
# config.txt:2: leftover conflict marker
# config.txt:5: leftover conflict marker
# config.txt:8: leftover conflict marker
```

*代码 21：`add` 之后要用 `--cached` 才查得到。*

所以**要在提交前的最后一刻查，就得写 `git diff --cached --check`**——查的是「即将被提交的那份内容」。

## 六、反悔：`git merge --abort`

冲突摊开之后发现这个合并现在不该做，不用一行行往回删：

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

*代码 22：工作区、索引、`MERGE_HEAD` 一起回到 `git merge` 之前。*

还有一种情况是合并压根没能开始：

```bash
echo "本地没提交的改动" >> config.txt
git merge feature
# error: Your local changes to the following files would be overwritten by merge:
# 	config.txt
# Please commit your changes or stash them before you merge.
# Aborting
```

*代码 23：退出码 128，文件一个字没动。*

`would be overwritten` 这个措辞，上一章切分支时见过一次。**判断标准是同一条：会不会弄丢你还没提交的东西。** Git 不在乎你手上有没有活，只拒绝在自己动手的过程中把它冲掉。

## 七、把祖先那一栏调出来：`diff3`

默认的冲突块只给两边，但真正要判断的时候，缺的常常是第三份：这一段**原本**是什么样。

```bash
git config merge.conflictStyle diff3
```

*代码 24：改用 `diff3` 风格。*

同一个冲突，现在长这样：

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

*代码 25：`|||||||` 到 `=======` 之间多出来的，是共同祖先那一版。*

多了这一栏，代码 12 里那个疑问当场就有答案了：祖先是 `端口 = 3000 / 超时 = 30`，对着一比就知道 HEAD 这边只改了超时、feature 那边只改了端口，两个都留下就是答案。没有这一栏，只能靠猜哪边动过哪一行。

## 小结

这一章只有一条命令，但它背后是两条完全不同的路径：

| 情况 | Git 做的事 |
| --- | --- |
| 当前分支是对方的祖先 | 快进：改写那 41 字节的文件，不产生新提交 |
| 两边各自走过 | 三方合并：对照共同祖先算出两份改动，生成一个有两个父的提交 |
| 两份改动挨在一起 | 冲突：写进标记、索引留三个槽，退出码 1 后交还终端 |

冲突态里的几条命令：

| 命令 | 它做的事 |
| --- | --- |
| `git status` | 冲突中多一栏 `Unmerged paths`，标出 `both modified` |
| `git ls-files -u` | 列出索引里那三个槽（祖先 / HEAD / 对方） |
| `git add <文件>` | 三个槽塌成一个，声明「按这一版算」——不检查内容 |
| `git diff --cached --check` | 提交前查残留的冲突标记，这是唯一的一道自觉 |
| `git merge --abort` | 整个合并丢掉，回到 `merge` 之前 |
| `git merge --no-ff` | 能快进也强行造一个合并提交，把这条分支的存在留在历史里 |
| `merge.conflictStyle diff3` | 冲突块里多显示一栏共同祖先 |

把上一章那个模型接着往下推，这一章的规则也都不用背：**分支是记着提交号的文件**，所以能直接改写那个文件的时候叫快进，改写会丢东西的时候才需要真的合；**合并算的是三个版本**，所以冲突时索引里躺着三个槽，所以 `diff3` 能把第三份调出来，所以 Git 处理得了「两边改的不是同一处」而处理不了「两边改的是同一段」。

剩下的两个缺口都和「先看清楚再动手」有关：合之前想知道两条分支到底差在哪，被 `would be overwritten` 拦下时想把手里的半截改动先放一边。下一章讲 `diff` 和 `stash`。
