---
title: Git 第六章：checkout 挪 HEAD，reset 挪分支，revert 只往前加
date: 2026-09-30 19:23:00
description: Colt Steele《The Git & Github Bootcamp》撤销那一章的复盘。checkout、restore、reset、revert 都被叫作「撤销」，但它们撤销的是四样不同的东西。checkout 让 HEAD 离开分支，单独去查看一个旧的提交；restore 只修改文件，不碰任何指针；reset 把分支本身往回拨；revert 则一个指针都不往回拨，而是新建一个提交，把某一次改动反过来做一遍。只要分清楚每条命令改动的是哪一层，哪条命令会丢失内容、丢失之后还能不能找回来，也就清楚了。
categories:
  - [课外, AI Infra, Git]
tags:
  - 撤销
  - HEAD
  - reset
  - revert
cover: /img/covers/Git-Chapter6-Undoing.svg
series: Git
privacy: protected
sitemap: false
private_section: 课外
---

改错了想往回退的时候，Git 提供了一串命令，分别是 `checkout`、`restore`、`reset` 和 `revert`。它们都被叫作「撤销」，名字也彼此相像，所以很容易被当成同一件事的几种不同写法。但实际上，它们撤销的是四样不同的东西。

前几章积累下来的模型，正好够用来理解它们。第二章讲过，**分支是记录着提交号的文件，而 HEAD 是记录着分支名的文件**；第一章讲过，一个文件在**暂存区**和**工作区**里还各有一份。这样数下来，一共有四层，分别是分支、HEAD、暂存区和工作区。对于这一章的每一条命令，都只需要回答一个问题，那就是**它改动了哪几层**。

<!-- more -->

这一章使用一条只有 `master` 分支的历史，其中的四个提交各自修改了 config.txt 里的一行：

```bash
git log --oneline
# 17322e7 邮件服务器换成 mail
# fa7fbb9 缓存容量加到 512MB
# 1d33476 超时调成 60
# d7aecee 初始配置

cat .git/HEAD
# ref: refs/heads/master
cat .git/refs/heads/master
# 17322e7b13d0f653a035e909f0de105c242f2bc6
```

*代码 1：HEAD 记录着 master，而 master 记录着最新的那个提交。*

## 一、`git checkout <提交>`：HEAD 离开分支

假设想看看两个提交之前，文件是什么样子的：

```bash
git checkout HEAD~2
# Note: switching to 'HEAD~2'.
#
# You are in 'detached HEAD' state. You can look around, make experimental
# changes and commit them, and you can discard any commits you make in this
# state without impacting any branches by switching back to a branch.
#
# If you want to create a new branch to retain commits you create, you may
# do so (now or later) by using -c with the switch command. Example:
#
#   git switch -c <new-branch-name>
#
# Or undo this operation with:
#
#   git switch -
#
# Turn off this advice by setting config variable advice.detachedHead to false
#
# HEAD is now at 1d33476 超时调成 60
```

*代码 2：输出了一大段提示，最后一行才是结果。*

`HEAD~2` 的意思是「从 HEAD 往回数两个」。`HEAD~1`（也可以写成 `HEAD~`）表示上一个提交，`HEAD~2` 表示上一个提交的上一个提交。直接写提交号也是可以的，`git checkout 1d33476` 的效果完全相同。

这条命令改动了什么呢？还是看那两个文件：

```bash
cat .git/HEAD
# 1d33476cc4aad627a15551f476d157f2ccb61fed
cat .git/refs/heads/master
# 17322e7b13d0f653a035e909f0de105c242f2bc6
```

*代码 3：HEAD 里的内容不再是 `ref: refs/heads/master`，而是直接写着一个提交号，而 master 没有变化。*

**这就是 detached HEAD，也就是分离的 HEAD。** 平时 HEAD 记录的是分支名，再由分支去找到提交；而现在 HEAD 越过了分支，直接记录着一个提交号。`master` 那个文件一个字都没有变，只是工作区和暂存区被更新成了 `1d33476` 那个版本，其中超时是 60，而容量和邮件服务器仍然是最初的值。

![平时的 HEAD 与分离的 HEAD](/img/posts/git-undoing/detached-head.svg)

*图 1：左边是平时的情况，HEAD 指向 master，master 再指向提交；右边是执行 `git checkout HEAD~2` 之后的情况，HEAD 直接指向 1d33476，而 master 仍然停在原处。*

这时 `git log` 的输出可能会让人吃一惊：

```bash
git log --oneline
# 1d33476 超时调成 60
# d7aecee 初始配置
```

*代码 4：后面的两个提交不见了。*

其实它们并没有被删除。`git log` 默认是从 HEAD 开始往回查找的，而 HEAD 现在位于 `1d33476`，往回查找当然找不到比它更新的提交。如果换成 `git log --oneline --all`，从所有的引用出发查找，四个提交就都在了。

在这种状态下，可以随意修改，甚至可以提交。但是需要想清楚，提交会落在哪里：

```bash
sed -i 's/日志 = info/日志 = warn/' config.txt
git commit -qam "试试 warn 级别"

git switch master
# Warning: you are leaving 1 commit behind, not connected to
# any of your branches:
#
#   6c12704 试试 warn 级别
#
# If you want to keep it by creating a new branch, this may be a good time
# to do so with:
#
#  git branch <new-branch-name> 6c12704
#
# Switched to branch 'master'
```

*代码 5：新的提交只有 HEAD 指向它，一旦 HEAD 离开，就再也没有东西指向它了。*

在分离状态下产生的新提交，只有 HEAD 记录着它。切换回分支之后，HEAD 改为记录 `master`，这个提交就变成了从任何一条分支出发都走不到的提交。它的处境和上一章 stash 的提交一样，只是连 `refs/stash` 这样的一个引用都没有。如果想把它保留下来，可以趁着提交号还显示在屏幕上，执行 `git branch <名字> 6c12704`，给它挂上一条分支。更稳妥的做法是在提交之前就执行 `git switch -c <名字>`，代码 2 那段提示里建议的也是这种做法。

回去的写法有两种。`git switch master` 会直接回到 master；而 `git switch -` 会回到切换过来之前的位置，这和 `cd -` 是一个意思，如果是从 master 切换过来的，就会回到 master：

```bash
git switch -
# Previous HEAD position was 1d33476 超时调成 60
# Switched to branch 'master'
```

*代码 6：`-` 指的是上一个位置。*

反过来，`switch` 并不愿意直接把 HEAD 分离出去：

```bash
git switch 1d33476
# fatal: a branch is expected, got commit '1d33476'
```

*代码 7：退出码是 128。如果真的想进入分离状态，就要明确地写出来，也就是 `git switch --detach 1d33476`。*

第二章说过，`switch` 是从 `checkout` 中拆分出来、专门负责切换分支的命令。它要求的参数是分支名，如果给它一个提交号，它就会拒绝执行，所以不会一不小心进入分离状态。而 `checkout` 则会接受任何参数。

还有一点需要注意，`HEAD` 必须写成大写。在 Linux 上，如果把它写成小写：

```bash
git checkout head~1
# error: pathspec 'head~1' did not match any file(s) known to git
```

*代码 8：`head~1` 并不是任何一个提交，所以 checkout 转而把它当成了文件名，退出码是 1。*

在 Windows 和 macOS 默认的那种不区分大小写的文件系统上，小写的 `head` 有时候碰巧能对应上 `.git/HEAD` 这个文件，从而蒙混过去，但是换到 Linux 服务器上就不行了。所以一律写成大写。

## 二、只改文件：`restore`，以及带文件名的 `checkout`

上一节里，`checkout` 后面跟着的是提交。如果后面跟着的是文件名，它做的就是完全不同的另一件事，第二章代码 7 那个坑就出在这里。这一节介绍的命令都只修改文件，**一律不碰 HEAD 和分支**。

先把上一章那个三份内容各不相同的场景摆出来。把日志改成 debug 并执行 `add`，然后在工作区里再把端口改成 8080。

```bash
sed -i 's/日志 = info/日志 = debug/' config.txt
git add config.txt
sed -i 's/端口 = 3000/端口 = 8080/' config.txt

git status -s
# MM config.txt
```

*代码 9：HEAD、暂存区和工作区又各自是一份不同的内容。*

**`git restore <文件>` 会用暂存区里的那一份覆盖工作区。**

```bash
git restore config.txt

git status -s
# M  config.txt

head -4 config.txt
# # 服务配置
# 端口 = 3000
# 超时 = 60
# 日志 = debug
```

*代码 10：端口退回到了 3000，而已经执行过 add 的日志没有变化。右边那一列的 M 消失了，左边那一列的还在。*

它恢复到的是「上一次执行 `add` 时的样子」，而不是「上一次提交时的样子」。如果文件没有执行过 `add`，这两者是相同的，所以平时很难察觉到区别。`git checkout -- config.txt` 是它的旧写法，效果完全一样。

**`git checkout HEAD <文件>` 会用 HEAD 里的那一份，同时覆盖暂存区和工作区。**

```bash
git checkout HEAD config.txt
# Updated 1 path from 0f85ea2

git status -s
# （什么都没有）
```

*代码 11：日志和端口都回到了最后一次提交时的样子。`0f85ea2` 是 HEAD 那个提交的目录树。*

多写了一个 `HEAD` 之后，内容的来源就从暂存区换成了提交，所以暂存区也会被一起覆盖掉。**因此 `git checkout -- 文件` 和 `git checkout HEAD 文件` 并不是一回事。** 如果文件没有执行过 `add`，两者的结果碰巧相同；但如果执行过 `add`，前者会保留已经暂存的那部分改动，而后者会把它一起清除掉。后者如果用 `restore` 来写，就是 `git restore --source=HEAD --staged --worktree config.txt`，简写为 `git restore -s HEAD -SW config.txt`。

**`git restore --staged <文件>` 会用 HEAD 里的那一份覆盖暂存区，而工作区保持不变**。这就是所谓的「撤销 add」：

```bash
git restore --staged config.txt

git status -s
#  M config.txt
```

*代码 12：日志的那处改动从左边一列回到了右边一列，两处改动都还保留在工作区里。*

`--staged` 前面的两个短横线不能省略。如果写成 `git restore staged config.txt`，`staged` 就会被当成一个文件名：

```bash
git restore staged config.txt
# error: pathspec 'staged' did not match any file(s) known to git
```

*代码 13：退出码是 1。`git status` 在「Changes to be committed」下面一直写着正确的形式，即 `use "git restore --staged <file>..." to unstage`。*

**`git restore --source <提交> <文件>` 会从任意一个提交里取出这个文件，并且只放进工作区。**

```bash
git restore --source HEAD~2 config.txt

cat .git/HEAD
# ref: refs/heads/master
git status -s
#  M config.txt
```

*代码 14：HEAD 仍然记录着 master，而 master 仍然指向 17322e7。*

```diff
diff --git a/config.txt b/config.txt
index 026ae59..0521d10 100644
--- a/config.txt
+++ b/config.txt
@@ -10,9 +10,9 @@
 
 # 缓存
 开启 = 是
-容量 = 512MB
+容量 = 256MB
 过期 = 600
 
 # 邮件
-服务器 = mail.example.com
+服务器 = smtp.example.com
 发件人 = noreply@example.com
```

*代码 15：这时执行 `git diff` 的结果，可以看到文件的内容回到了 1d33476 那个时候。*

文件的内容和上一节执行 `git checkout HEAD~2` 时看到的一样，区别在于这一次**哪一个指针都没有移动**。HEAD 没有离开 master，分支上也一个提交都没有少，工作区里只是多了一处还没有提交的修改，而这处修改的内容恰好是一份旧的文件。如果想让这次回退生效，就像对待普通的改动一样，执行 `add` 和 `commit` 即可。

![restore 各种写法的来源和去向](/img/posts/git-undoing/restore-sources.svg)

*图 2：在不写 `--source` 的情况下，如果只修改工作区，内容就从暂存区里取；如果加上了 `--staged`，内容就从 HEAD 里取。*

这一节的命令还有一个共同点，那就是**被覆盖掉的内容如果从来没有执行过 `add`，就再也找不回来了**，因为 Git 手里从来没有过那一份内容。`restore` 执行完之后不会打印任何信息，既没有确认，也没有回收站。

## 三、`git reset`：把分支往回拨

回到干净的 `17322e7` 状态。这一回要撤销的不是文件，而是最近的两个提交：

```bash
git reset HEAD~2
# Unstaged changes after reset:
# M	config.txt

cat .git/HEAD
# ref: refs/heads/master
cat .git/refs/heads/master
# 1d33476cc4aad627a15551f476d157f2ccb61fed

git log --oneline
# 1d33476 超时调成 60
# d7aecee 初始配置
```

*代码 16：HEAD 仍然记录着 master，但是 master 里的编号被改写了。*

把它和第一节对照一下，区别就很明显了。**`checkout <提交>` 修改的是 `.git/HEAD`，它让 HEAD 离开了分支；而 `reset` 修改的是分支文件本身，HEAD 仍然记录着分支名，所以会跟着分支一起回到 `1d33476`。** 手册对 `reset` 的描述是 `updating your branch, moving the tip in order to add or remove commits from the branch`。

`reset` 的三种写法都会把分支往回拨，它们的区别在于暂存区和工作区要不要跟着一起回去。下面都从 `17322e7` 开始，执行 `git reset <选项> HEAD~2`：

| 选项 | 暂存区 | 工作区 | 那两个提交的改动留在 |
| --- | --- | --- | --- |
| `--soft` | 不动 | 不动 | 暂存区（左列 `M`） |
| `--mixed`（默认） | 跟着回去 | 不动 | 工作区（右列 `M`） |
| `--hard` | 跟着回去 | 跟着回去 | 哪里都没有 |

- **`--soft`** 只会把分支往回拨。那两个提交带来的改动（容量 512MB 和邮件服务器）原封不动地留在暂存区里，相当于「回到了两次提交之前，而所有改动都已经执行过 `add`」。如果这时再执行一次 `commit`，就会把这两个提交合并成一个。
- **`--mixed`** 会让暂存区也跟着回去，但工作区保持不变。改动仍然保留在文件里，只是变回了没有执行过 `add` 的状态。不写选项时使用的就是它，所以 `git reset HEAD~1` 是一种常用的写法，意思是「撤销最后一次提交，但保留改动，以便接着修改」。
- **`--hard`** 会让三层全部回去，文件的内容也会回到 `1d33476` 时的样子，也就是容量是 256MB，邮件服务器是 smtp。

那么被撤销的两个提交去哪里了呢？和第一节的情况一样，它们并没有被删除，只是不再有分支指向它们了：

```bash
git cat-file -t 17322e7
# commit

git reflog
# 1d33476 HEAD@{0}: reset: moving to HEAD~2
# 17322e7 HEAD@{1}: commit: 邮件服务器换成 mail
# fa7fbb9 HEAD@{2}: commit: 缓存容量加到 512MB
# 1d33476 HEAD@{3}: commit: 超时调成 60
# d7aecee HEAD@{4}: commit (initial): 初始配置
```

*代码 17：reflog 记录着 HEAD 每一次指向过哪里，上一章的 `stash@{n}` 用的就是这种流水账。*

`reset` 还会顺便把往回拨之前的位置记录到 `.git/ORIG_HEAD` 里。所以如果拨错了，再拨回来就可以了：

```bash
git reset --hard ORIG_HEAD
# HEAD is now at 17322e7 邮件服务器换成 mail
```

*代码 18：四个提交全部回来了。*

但是 **`--hard` 有一样东西是真的找不回来的，那就是执行的那一刻还没有提交的改动。** 假如在执行 reset 之前，工作区里还有一处没有提交的「日志 = debug」，`--hard` 就会把它连同那两个提交的内容一起抹掉。之后即使用 `ORIG_HEAD` 拨回来，回来的也只有提交，那一行仍然是 `日志 = info`。提交过的内容进入过对象库，有 reflog 作为保障；而没有提交的改动从来没有进入过 Git，和上一节被 `restore` 覆盖掉的内容一样，在任何地方都没有保留。

所以在执行 `--hard` 之前，最好先用 `git status` 看一眼。如果有还没有提交的内容，就先用 `stash` 把它收起来。

## 四、`git revert`：新造一个提交，把那次改动反着做一遍

`reset` 和 `revert` 经常被放在一起比较，因为它们都能「撤销一个提交」。但是它们撤销的方式完全不同。`git help git` 里对三条名字相近的命令各有一句话的说明，其中关于这两条命令的是：

> git-revert(1) is about making a new commit that reverts the changes made by other commits.
>
> git-reset(1) is about updating your branch, moving the tip in order to add or remove commits from the branch.

仍然从 `17322e7` 出发，这一回撤销第二个提交，也就是「超时调成 60」：

```bash
git revert 1d33476
```

*代码 19：要撤销哪个提交，就写上哪个提交的编号。*

和第三章三方合并成功时一样，Git 会先打开编辑器，提交信息已经写好了：

```text
Revert "超时调成 60"

This reverts commit 1d33476cc4aad627a15551f476d157f2ccb61fed.

# Please enter the commit message for your changes. Lines starting
# with '#' will be ignored, and an empty message aborts the commit.
#
# On branch master
# Changes to be committed:
#       modified:   config.txt
#
```

*代码 20：保存并退出之后，提交才会真正生成。如果加上 `--no-edit`，就会直接使用这句默认的提交信息。*

```bash
# （存盘退出之后）
# [master b018bcc] Revert "超时调成 60"
#  1 file changed, 1 insertion(+), 1 deletion(-)

git log --oneline
# b018bcc Revert "超时调成 60"
# 17322e7 邮件服务器换成 mail
# fa7fbb9 缓存容量加到 512MB
# 1d33476 超时调成 60
# d7aecee 初始配置
```

*代码 21：历史记录一个都没有少，反而多了一个。*

再来看看文件的内容：

```bash
grep -E '^(超时|容量|服务器)' config.txt
# 超时 = 30
# 容量 = 512MB
# 服务器 = mail.example.com
```

*代码 22：只有超时回到了 30，而后面两个提交的改动都还在。*

**revert 撤销的是「那一个提交带来的改动」，而不是「回到那个提交的时候」。** `1d33476` 所做的事情是把超时从 30 改成 60，所以 revert 就新建一个提交，把 60 改回 30，其他的一概不管。用 `git show HEAD` 看得最清楚，新提交的 diff 正好是 `1d33476` 的 diff 上下颠倒过来的样子：

```diff
@@ -1,6 +1,6 @@
 # 服务配置
 端口 = 3000
-超时 = 60
+超时 = 30
 日志 = info
 
 # 数据库
```

*代码 23：`git show HEAD` 输出中的改动部分。*

同样是写 `1d33476` 这个编号，两条命令的结果却相差很远：

![reset 和 revert 对同一个提交号做的事](/img/posts/git-undoing/reset-vs-revert.svg)

*图 3：`git reset --hard 1d33476` 会让分支和文件都回到 1d33476 那个时候，后面两个提交也就离开了分支；而 `git revert 1d33476` 会在最后接上一个新的提交，只抵消 1d33476 的那一处改动。*

在计算反向的改动时，revert 使用的仍然是第三章的三方合并，所以它同样可能发生冲突。在 `17322e7` 上再提交一次「日志级别调成 debug」，然后撤销同一个提交：

```bash
git revert --no-edit 1d33476
# Auto-merging config.txt
# CONFLICT (content): Merge conflict in config.txt
# error: could not revert 1d33476... 超时调成 60
# hint: After resolving the conflicts, mark them with
# hint: "git add/rm <pathspec>", then run
# hint: "git revert --continue".
# hint: You can instead skip this commit with "git revert --skip".
# hint: To abort and get back to the state before "git revert",
# hint: run "git revert --abort".
```

*代码 24：退出码是 1。*

```text
# 服务配置
端口 = 3000
<<<<<<< HEAD
超时 = 60
日志 = debug
=======
超时 = 30
日志 = info
>>>>>>> parent of 1d33476 (超时调成 60)
```

*代码 25：超时在第 3 行，日志在第 4 行，两处改动紧挨在一起。*

第三章说过，冲突的单位是一段连续的区域。要撤销的超时那一行，和后来修改过的日志那一行紧挨在一起，所以 Git 无法判断这一段最终应该是什么样子。另一边的标签 `parent of 1d33476` 也说明了 revert 的算法，它把 `1d33476` 当作共同祖先，再把「从 `1d33476` 退回到它的父提交」的这段改动合并到当前的 HEAD 中。解决办法和第三章一样，先修改好文件，然后执行 `git add` 和 `git revert --continue`；如果不想撤销了，就执行 `git revert --abort`。这一章的四个提交修改的行彼此之间隔得比较远，所以前面那次 revert 才没有发生冲突。

**那么什么时候用 reset，什么时候用 revert 呢？** 这要看这几个提交有没有离开过这台机器。

`reset` 改写了历史，分支上少了提交。如果这些提交只存在于本地、没有其他人见过，这样做完全没有问题。但是一旦推送过，其他人手里就已经有了这些提交。如果把分支往回拨之后再推送，远程仓库会拒绝：

```bash
git reset --hard HEAD~1
git push origin master
#  ! [rejected]        master -> master (non-fast-forward)
# error: failed to push some refs to '……'
# hint: Updates were rejected because the tip of your current branch is behind
# hint: its remote counterpart. Integrate the remote changes (e.g.
# hint: 'git pull ...') before pushing again.
```

*代码 26：退出码是 1。*

`non-fast-forward` 就是第三章说的「不能快进」。也就是说，从本地的分支出发，已经走不到远程分支上的那些提交了，如果直接改写远程的分支，就会把它们丢掉。当然，可以使用 `--force` 强行推送，但这样一来，其他人本地的历史就和远程仓库对不上了。而 `revert` 没有这个问题，它只是在后面多接上一个提交，对所有人来说都是一次普通的快进。**所以对于只存在于本地、还没有推送过的提交，可以用 `reset` 收拾干净；而对于已经推送过、其他人可能正在使用的提交，应该使用 `revert`。**

## 小结

| 命令 | 挪了哪个指针 | 盖掉了哪几份 | 可能丢掉 |
| --- | --- | --- | --- |
| `checkout <提交>` | HEAD（改记提交号） | 暂存区、工作区 ← 该提交 | 分离时的新提交 |
| `restore <文件>` | 无 | 工作区 ← 暂存区 | 没 add 的改动 |
| `restore --staged <文件>` | 无 | 暂存区 ← HEAD | 无 |
| `checkout HEAD <文件>` | 无 | 暂存区、工作区 ← HEAD | 这个文件的全部改动 |
| `restore -s <提交> <文件>` | 无 | 工作区 ← 该提交 | 没 add 的改动 |
| `reset --soft <提交>` | 分支（HEAD 跟着） | 无 | 无 |
| `reset <提交>` | 分支（HEAD 跟着） | 暂存区 ← 该提交 | 无 |
| `reset --hard <提交>` | 分支（HEAD 跟着） | 暂存区、工作区 ← 该提交 | 没提交的改动 |
| `revert <提交>` | 分支往前多一个提交 | 暂存区、工作区随之更新 | 无 |

*表中省略了开头的 `git`，`← X` 表示用 X 那一份覆盖。被 `reset` 拨走的提交可以通过 reflog 找回来。*

概括起来就是，**checkout 移动 HEAD，reset 移动分支，revert 只往前增加提交，而 restore 只修改文件**。这些规则都可以顺着前几章的模型推导出来。因为分支是记录着提交号的文件，所以被 reset 撤销的提交其实还在，reflog 和 `ORIG_HEAD` 都能把它们找回来；因为 HEAD 可以不记录分支名，而是直接记录提交号，所以才会有分离状态，也才会有切换走之后无人认领的提交；因为 revert 是一次三方合并，所以它可能会发生冲突。

唯一不在这套模型里的，是那些从来没有执行过 `add`、也从来没有提交过的改动。Git 手里从来没有过它们，所以也没有任何一条命令能把它们找回来。
