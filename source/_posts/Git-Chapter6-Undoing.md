---
title: Git 第六章：checkout 挪 HEAD，reset 挪分支，revert 只往前加
date: 2026-09-30 19:23:00
description: Colt Steele《The Git & Github Bootcamp》撤销那一章的复盘。checkout、restore、reset、revert 都被叫作「撤销」，撤的却是四样不同的东西：checkout 让 HEAD 离开分支，单独去看一个旧提交；restore 只改文件，不碰任何指针；reset 把分支本身往回拨；revert 一个都不往回拨，而是新造一个提交，把某一次改动反着做一遍。分清每条命令动的是哪一层，哪条会丢东西、丢了还能不能找回来，也就清楚了。
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

改错了想往回退，Git 给了一串命令：`checkout`、`restore`、`reset`、`revert`。它们都被叫作「撤销」，名字还彼此相像，很容易当成同一件事的几种写法。其实它们撤的是四样不同的东西。

前几章攒下的模型正好够用。第二章：**分支是记着提交号的文件，HEAD 是记着分支名的文件**。第一章：一个文件在**暂存区**和**工作区**里还各有一份。这样数下来一共四层：分支、HEAD、暂存区、工作区。这一章的每条命令，都只需要回答一个问题：**它动了哪几层。**

<!-- more -->

这一章用一条只有 `master` 的历史，四个提交各改 config.txt 里的一行：

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

*代码 1：HEAD 记着 master，master 记着最新的提交。*

## 一、`git checkout <提交>`：HEAD 离开分支

想看看两个提交之前文件是什么样：

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

*代码 2：一大段提示，最后一行才是结果。*

`HEAD~2` 读作「从 HEAD 往回数两个」：`HEAD~1`（也可以写成 `HEAD~`）是上一个提交，`HEAD~2` 是上一个的上一个。直接写提交号也行，`git checkout 1d33476` 效果相同。

这条命令动了什么，还是看那两个文件：

```bash
cat .git/HEAD
# 1d33476cc4aad627a15551f476d157f2ccb61fed
cat .git/refs/heads/master
# 17322e7b13d0f653a035e909f0de105c242f2bc6
```

*代码 3：HEAD 里不再是 `ref: refs/heads/master`，而是直接写着一个提交号。master 没变。*

**这就是 detached HEAD（分离的 HEAD）**：平时 HEAD 记的是分支名，由分支再去找提交；现在 HEAD 越过分支，直接记着一个提交号。`master` 那个文件一个字没变，只是工作区和暂存区被刷成了 `1d33476` 那一版——超时是 60，容量和邮件服务器还是最初的值。

![平时的 HEAD 与分离的 HEAD](/img/posts/git-undoing/detached-head.svg)

*图 1：左边 HEAD → master → 提交；右边 `git checkout HEAD~2` 之后，HEAD 直接指着 1d33476，master 还在原处。*

这时候 `git log` 的输出会让人一惊：

```bash
git log --oneline
# 1d33476 超时调成 60
# d7aecee 初始配置
```

*代码 4：后面两个提交不见了。*

它们没有被删。`git log` 默认从 HEAD 往回走，HEAD 现在站在 `1d33476`，往回走当然走不到比它新的提交。换成 `git log --oneline --all` 从所有引用出发，四个提交都在。

在这个状态下可以随便改，甚至可以提交。但要想清楚提交落在了哪里：

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

*代码 5：新提交只有 HEAD 指着。HEAD 一走，就没有东西指着它了。*

分离状态下的新提交，只有 HEAD 记着它。切回分支后 HEAD 改记 `master`，这个提交就成了哪条分支都走不到的提交——处境和上一章 stash 的提交一样，只是连 `refs/stash` 这样一个引用都没有。想留住它，趁号还在屏幕上，`git branch <名字> 6c12704` 给它挂一条分支。更稳妥的做法是在提交之前就 `git switch -c <名字>`，代码 2 那段提示里建议的也是这个。

回去的写法有两个。`git switch master` 是直接回到 master；`git switch -` 是回到切过来之前的位置，和 `cd -` 一个意思，从 master 过来的就回 master：

```bash
git switch -
# Previous HEAD position was 1d33476 超时调成 60
# Switched to branch 'master'
```

*代码 6：`-` 指上一个位置。*

反过来，`switch` 不肯直接把 HEAD 分离出去：

```bash
git switch 1d33476
# fatal: a branch is expected, got commit '1d33476'
```

*代码 7：退出码 128。真要分离得明说：`git switch --detach 1d33476`。*

第二章说过，`switch` 是从 `checkout` 里拆出来专管切分支的。它要的是分支名，给它提交号就拒绝，于是不会一不小心掉进分离状态。`checkout` 则来者不拒。

还有一处：`HEAD` 必须大写。在 Linux 上写成小写，

```bash
git checkout head~1
# error: pathspec 'head~1' did not match any file(s) known to git
```

*代码 8：`head~1` 不是任何提交，checkout 转而把它当成了文件名。退出码 1。*

在 Windows、macOS 默认那种不分大小写的文件系统上，小写的 `head` 有时能碰巧对上 `.git/HEAD` 这个文件而蒙混过去，换到 Linux 服务器上就不灵了。一律写大写。

## 二、只改文件：`restore`，以及带文件名的 `checkout`

上一节 `checkout` 后面跟的是提交。后面跟的是文件名时，它干的是完全另一件事——第二章代码 7 那个坑就出在这里。这一节的命令都只动文件，**HEAD 和分支一律不碰**。

先摆出上一章那个三份各不相同的场景：日志改成 debug 并 `add`，然后在工作区再把端口改成 8080。

```bash
sed -i 's/日志 = info/日志 = debug/' config.txt
git add config.txt
sed -i 's/端口 = 3000/端口 = 8080/' config.txt

git status -s
# MM config.txt
```

*代码 9：HEAD、暂存区、工作区又各是一份。*

**`git restore <文件>`：用暂存区那份盖掉工作区。**

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

*代码 10：端口退回 3000，已经 add 过的日志没动。右边那列 M 没了，左边的还在。*

它回到的是「上一次 `add` 时的样子」，不是「上一次提交时的样子」。文件没 `add` 过的时候两者相同，所以平时很难察觉。`git checkout -- config.txt` 是它的旧写法，效果完全一样。

**`git checkout HEAD <文件>`：用 HEAD 那份同时盖掉暂存区和工作区。**

```bash
git checkout HEAD config.txt
# Updated 1 path from 0f85ea2

git status -s
# （什么都没有）
```

*代码 11：日志和端口都回到了最后一次提交的样子。`0f85ea2` 是 HEAD 那个提交的目录树。*

多了一个 `HEAD`，来源就从暂存区换成了提交，暂存区也被一起盖掉。**所以 `git checkout -- 文件` 和 `git checkout HEAD 文件` 不是一回事**：文件没 `add` 过时两者碰巧结果相同；`add` 过之后，前者保留暂存的那部分，后者连它一起清掉。后者用 `restore` 写是 `git restore --source=HEAD --staged --worktree config.txt`，简写 `git restore -s HEAD -SW config.txt`。

**`git restore --staged <文件>`：用 HEAD 那份盖掉暂存区，工作区不动**。这就是「撤销 add」：

```bash
git restore --staged config.txt

git status -s
#  M config.txt
```

*代码 12：日志那处改动从左列回到了右列，两处改动都还在工作区里。*

`--staged` 前面的两个短横不能省。写成 `git restore staged config.txt`，`staged` 会被当成一个文件名：

```bash
git restore staged config.txt
# error: pathspec 'staged' did not match any file(s) known to git
```

*代码 13：退出码 1。`git status` 在「Changes to be committed」下面一直写着正确的形式：`use "git restore --staged <file>..." to unstage`。*

**`git restore --source <提交> <文件>`：从任意一个提交里取出这个文件，只放进工作区。**

```bash
git restore --source HEAD~2 config.txt

cat .git/HEAD
# ref: refs/heads/master
git status -s
#  M config.txt
```

*代码 14：HEAD 还记着 master，master 还指着 17322e7。*

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

*代码 15：这时的 `git diff`：文件内容回到了 1d33476 那时。*

文件内容和上一节 `git checkout HEAD~2` 看到的一样，区别在于这次**哪个指针都没动**：HEAD 没离开 master，分支上一个提交也没少，工作区里只是多了一处未提交的修改，内容恰好是一份旧文件。想让这次回退生效，就像普通改动一样 `add`、`commit`。

![restore 各种写法的来源和去向](/img/posts/git-undoing/restore-sources.svg)

*图 2：不写 `--source` 时，只改工作区就从暂存区取，加了 `--staged` 就从 HEAD 取。*

这一节的命令还有一个共同点：**被盖掉的内容如果从没 `add` 过，就再也找不回来**。Git 手里从来没有过那份内容。`restore` 执行完不打印任何东西，没有确认，也没有回收站。

## 三、`git reset`：把分支往回拨

回到干净的 `17322e7`。这回要撤的不是文件，而是最近两个提交：

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

*代码 16：HEAD 还记着 master，但 master 里的号被改写了。*

和第一节一对照，区别就出来了：**`checkout <提交>` 改的是 `.git/HEAD`，让 HEAD 离开分支；`reset` 改的是分支文件本身，HEAD 仍然记着分支名，跟着一起回到了 `1d33476`**。手册对它的描述是 `updating your branch, moving the tip in order to add or remove commits from the branch`。

三种写法都会把分支拨回去，区别在于暂存区和工作区要不要跟着回去。都从 `17322e7` 执行 `git reset <选项> HEAD~2`：

| 选项 | 暂存区 | 工作区 | 那两个提交的改动留在 |
| --- | --- | --- | --- |
| `--soft` | 不动 | 不动 | 暂存区（左列 `M`） |
| `--mixed`（默认） | 跟着回去 | 不动 | 工作区（右列 `M`） |
| `--hard` | 跟着回去 | 跟着回去 | 哪里都没有 |

- **`--soft`** 只拨分支。那两个提交带来的改动（容量 512MB、邮件服务器）原封不动地待在暂存区里，相当于「回到两次提交之前，东西都已经 `add` 好了」。这时再 `commit` 一次，就把两个提交合成了一个。
- **`--mixed`** 让暂存区也跟着回去，工作区不动。改动还在文件里，只是变回了没 `add` 的状态。不写选项就是它，所以 `git reset HEAD~1` 是「撤掉最后一次提交，改动留着接着改」的常用写法。
- **`--hard`** 三层全部回去。文件内容也回到 `1d33476`：容量是 256MB，邮件服务器是 smtp。

撤掉的两个提交去哪了？和第一节一样，没被删，只是没有分支再指着它们：

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

*代码 17：reflog 记着 HEAD 每一次指向过哪里——上一章 `stash@{n}` 用的就是这种流水账。*

`reset` 还会顺手把拨之前的位置记进 `.git/ORIG_HEAD`。拨错了，拨回来就行：

```bash
git reset --hard ORIG_HEAD
# HEAD is now at 17322e7 邮件服务器换成 mail
```

*代码 18：四个提交全部回来。*

但 **`--hard` 有一样东西是真的找不回来：执行那一刻还没提交的改动**。假如 reset 之前工作区里还有一处没提交的「日志 = debug」，`--hard` 会把它和那两个提交的内容一起抹掉；之后用 `ORIG_HEAD` 拨回来，回来的只有提交，那一行还是 `日志 = info`。提交进过对象库，有 reflog 兜底；没提交的改动从没进过 Git，和上一节被 `restore` 盖掉的一样，哪里都没有留着它。

所以 `--hard` 之前先 `git status` 看一眼。有没提交的东西，先 `stash`。

## 四、`git revert`：新造一个提交，把那次改动反着做一遍

`reset` 和 `revert` 常被放在一起比，因为它们都能「撤销一个提交」。但撤的方式完全不同。`git help git` 里对三条名字相近的命令各有一句话，其中这两句是：

> git-revert(1) is about making a new commit that reverts the changes made by other commits.
>
> git-reset(1) is about updating your branch, moving the tip in order to add or remove commits from the branch.

还是从 `17322e7` 出发，这回 revert 第二个提交「超时调成 60」：

```bash
git revert 1d33476
```

*代码 19：要撤哪个提交，就写哪个提交的号。*

和第三章三方合并成功时一样，Git 会先打开编辑器，信息已经写好：

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

*代码 20：存盘退出，提交才落下。加 `--no-edit` 就直接用这句。*

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

*代码 21：历史一个没少，多了一个。*

再看文件：

```bash
grep -E '^(超时|容量|服务器)' config.txt
# 超时 = 30
# 容量 = 512MB
# 服务器 = mail.example.com
```

*代码 22：只有超时回到了 30，后面两个提交的改动都还在。*

**revert 撤的是「那一个提交带来的改动」，不是「回到那个提交的时候」。**`1d33476` 做的事是把超时从 30 改成 60，revert 就新造一个提交把 60 改回 30，别的一概不管。`git show HEAD` 看得最清楚，新提交的 diff 正好是 `1d33476` 的 diff 上下颠倒：

```diff
@@ -1,6 +1,6 @@
 # 服务配置
 端口 = 3000
-超时 = 60
+超时 = 30
 日志 = info
 
 # 数据库
```

*代码 23：`git show HEAD` 的改动部分。*

同样写 `1d33476` 这个号，两条命令的结果差得很远：

![reset 和 revert 对同一个提交号做的事](/img/posts/git-undoing/reset-vs-revert.svg)

*图 3：`git reset --hard 1d33476` 让分支和文件都回到 1d33476 那时，后两个提交离开了分支；`git revert 1d33476` 在最后接上一个新提交，只抵消 1d33476 那一处。*

算反向改动时，revert 用的仍然是第三章的三方合并，所以它也会冲突。在 `17322e7` 上再提交一次「日志级别调成 debug」，然后 revert 同一个提交：

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

*代码 24：退出码 1。*

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

*代码 25：超时在第 3 行，日志在第 4 行，两处改动挨在一起。*

第三章说过，冲突的单位是一段连续的区域：要撤的超时那一行，和后来改过的日志那一行紧挨着，Git 判断不了这一段最终该是什么样。另一边的标签 `parent of 1d33476` 也说出了 revert 的算法：拿 `1d33476` 当共同祖先，把「从它退回到它的父提交」这段改动合进当前的 HEAD。解法和第三章一样，改好文件、`git add`、`git revert --continue`；不想撤了就 `git revert --abort`。这一章的四个提交改的行彼此隔得开，前面那次 revert 才没有撞上。

**什么时候用 reset，什么时候用 revert**？看这几个提交有没有离开过这台机器。

`reset` 改写了历史：分支上少了提交。如果它们只在本地、没人见过，这完全没问题。可一旦推送过，别人手里已经有了它们。把分支拨回去再推，远端会拒绝：

```bash
git reset --hard HEAD~1
git push origin master
#  ! [rejected]        master -> master (non-fast-forward)
# error: failed to push some refs to '……'
# hint: Updates were rejected because the tip of your current branch is behind
# hint: its remote counterpart. Integrate the remote changes (e.g.
# hint: 'git pull ...') before pushing again.
```

*代码 26：退出码 1。*

`non-fast-forward` 就是第三章的「不能快进」：远端分支上的提交，从你这边的分支已经走不到了，直接改写远端的分支就会把它们丢掉。硬推（`--force`）过去当然可以，但其他人本地的历史就和远端对不上了。`revert` 没有这个问题，它只在后面多接一个提交，对所有人都是一次普通的快进。**只在本地、还没推送的，用 `reset` 收拾干净；已经推送、别人可能在用的，用 `revert`。**

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

*表里省掉了开头的 `git`，`← X` 是用 X 那一份盖掉。`reset` 拨走的提交能从 reflog 找回来。*

**checkout 挪 HEAD，reset 挪分支，revert 只往前加，restore 只动文件**。这些规则都是顺着前几章的模型推出来的：分支是记着提交号的文件，所以 reset 撤掉的提交其实还在，reflog 和 `ORIG_HEAD` 都能把它们找回来；HEAD 可以不记分支名、直接记提交号，所以才有分离状态，才有切走之后没人认领的提交；revert 是一次三方合并，所以它会冲突。

唯一不在这套模型里的，是从没 `add` 过、也从没提交过的改动。Git 手里从来没有它们，也就没有任何一条命令能把它们找回来。
