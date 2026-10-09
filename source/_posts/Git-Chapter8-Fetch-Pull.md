---
title: Git 第八章：fetch 只更新 origin/*，pull 还要再合并一次
date: 2026-10-09 22:00:00
description: Colt Steele《The Git & Github Bootcamp》fetch 与 pull 那一章的复盘。origin/main 这样的远程跟踪分支保存在本地的 .git 里，记录的是上一次和远程仓库通信时远程分支的位置，所以只有 fetch、pull 和 push 才会移动它。git fetch 把远程的新提交拿进本地仓库，只更新 origin/*，本地分支和工作区都不会变；git pull 在 fetch 之后再做一次合并，如果两边都有新提交，git 2.34 会要求先用 pull.rebase 说明怎样合并。不带参数的 git pull 依靠的是上游配置，并不会去找远程同名的分支。
categories:
  - [课外, AI Infra, Git]
tags:
  - GitHub
  - fetch
  - pull
  - 远程跟踪分支
  - 上游
cover: /img/covers/Git-Chapter8-Fetch-Pull.svg
series: Git
privacy: protected
sitemap: false
private_section: 课外
---

上一章讲的都是从本地到远程的方向，`git push` 用本地的分支去更新 GitHub 上的分支。但是一个仓库往往不止一个人在推送。如果合作者在这期间往 GitHub 上推送了新的提交，本地仓库并不会自动知道，这时就需要反方向的操作，把远程的新提交拿到本地来。这一章的 `git fetch` 和 `git pull` 就是做这件事的两条命令。

这两条命令的区别在于拿到提交之后做到哪一步。`fetch` 只把提交拿进本地仓库，并且更新 `origin/main` 这样的记录；而 `pull` 在 fetch 之后还要再做一次合并，所以本地的分支和工作区里的文件都会跟着改变。要讲清楚这个区别，先要弄明白 `origin/main` 到底是什么。

<!-- more -->

## 一、远程跟踪分支：本地对远程的一份记录

和上一章一样，下面用一个本地的裸仓库 `github/notes.git` 来代替 GitHub 上的仓库。这个仓库里已经有两个提交，另外还有一条 draft 分支。先把它克隆下来：

```bash
git clone github/notes.git notes
# Cloning into 'notes'...
# done.

cd notes
git branch
# * main

git branch -r
#   origin/HEAD -> origin/main
#   origin/draft
#   origin/main
```

*代码 1：`git branch` 只列出本地分支，`-r` 列出远程跟踪分支，`-a` 则把两种都列出来。*

克隆之后，本地分支只有 main 一条，而 `git branch -r` 列出了三条以 `origin/` 开头的分支。上一章介绍过，它们叫作**远程跟踪分支**（remote-tracking branch），每一条对应远程仓库里的一条分支，记录的是那条分支在上一次通信时所处的位置。其中 `origin/HEAD -> origin/main` 这一行表示远程仓库的默认分支是 main。

这些分支的名字里虽然带着 origin，但是它们并不保存在 GitHub 上，而是保存在本地的 `.git` 里：

```bash
cat .git/packed-refs
# # pack-refs with: peeled fully-peeled sorted
# 73366ceae5a8141a103b7cd332345d8615854a56 refs/remotes/origin/draft
# 8c565ad4ee538e8c0c580e5e44bfc8e6df0ce9da refs/remotes/origin/main
```

*代码 2：克隆时，Git 把远程跟踪分支打包写进了 packed-refs 这个文件，每一行是一个提交号和一个名字。*

上一章推送之后，`origin/main` 是 `.git/refs/remotes/origin/` 目录下的一个单独的文件。克隆时 Git 把它们合在一个文件里保存，两种保存方式记录的内容是一样的。既然远程跟踪分支只是本地的一条记录，那么 GitHub 上发生变化时它并不会跟着变。只有在和远程仓库通信的时候，也就是执行 fetch、pull 或者 push 的时候，它才会被更新。

在 README.md 末尾加上第八章的小标题，然后在 main 上提交一次，就能看到本地分支和远程跟踪分支分开了：

```bash
git commit -am "开始写第八章"
# [main 67f2ea7] 开始写第八章
#  1 file changed, 4 insertions(+)

git status
# On branch main
# Your branch is ahead of 'origin/main' by 1 commit.
#   (use "git push" to publish your local commits)
#
# nothing to commit, working tree clean

git log --oneline --graph --all
# * 67f2ea7 (HEAD -> main) 开始写第八章
# | * 73366ce (origin/draft) 草稿：fetch 和 pull
# |/
# * 8c565ad (origin/main, origin/HEAD) 补上第七章
# * 8db4435 第一篇笔记
```

*代码 3：提交只移动了 main，origin/main 仍然停在 8c565ad。*

提交移动的是 HEAD 所在的本地分支 main。origin/main 记录的是远程的 main，而远程仓库并没有收到这个提交，所以它留在原地。`git status` 所说的领先 1 个提交，就是拿 main 和 origin/main 比较得出的。

远程跟踪分支也不能直接切换过去：

```bash
git switch origin/main
# fatal: a branch is expected, got remote branch 'origin/main'
```

*代码 4：退出码是 128。switch 只接受本地分支。*

## 二、在远程的另一条分支上工作

本地没有 draft 分支，但是 origin/draft 已经记下了远程的 draft 在哪里。如果只是想看看 draft 上的文件，可以用 checkout 切换到 origin/draft：

```bash
git checkout origin/draft
# Note: switching to 'origin/draft'.
#
# You are in 'detached HEAD' state. You can look around, make experimental
# changes and commit them, and you can discard any commits you make in this
# state without impacting any branches by switching back to a branch.
# （中间几行提示和第六章代码 2 相同，这里省略）
# HEAD is now at 73366ce 草稿：fetch 和 pull
```

*代码 5：checkout 接受任何能找到提交的名字，这时 HEAD 直接记录着 73366ce 这个提交。*

这就是第六章讲过的分离头指针状态。工作区里已经是 draft 上的文件了，照样可以修改和提交，但是新的提交不属于任何一条分支：

```bash
git commit -am "在 origin/draft 上提交"
# [detached HEAD 1d2747b] 在 origin/draft 上提交
#  1 file changed, 1 insertion(+)

git log --oneline --graph --all
# * 1d2747b (HEAD) 在 origin/draft 上提交
# * 73366ce (origin/draft) 草稿：fetch 和 pull
# | * 67f2ea7 (main) 开始写第八章
# |/
# * 8c565ad (origin/main, origin/HEAD) 补上第七章
# * 8db4435 第一篇笔记
```

*代码 6：新提交 1d2747b 只有 HEAD 记着它，origin/draft 没有跟着往前走。*

origin/draft 不会跟着提交移动，原因和上一节一样，它只在和远程通信时更新。所以切换回 main 的时候，Git 会警告 `you are leaving 1 commit behind, not connected to any of your branches`，1d2747b 从此就没有分支能找到了。

如果真的想在 draft 上工作，应该切换到不带 `origin/` 的 draft。回到 main 之后执行：

```bash
git switch draft
# Branch 'draft' set up to track remote branch 'draft' from 'origin'.
# Switched to a new branch 'draft'

git status
# On branch draft
# Your branch is up to date with 'origin/draft'.
#
# nothing to commit, working tree clean
```

*代码 7：本地新建了一条 draft，它从 origin/draft 所在的 73366ce 开始，并且把 origin/draft 设为上游。*

本地明明没有 draft 这条分支，switch 却没有报错，这是因为它会去远程跟踪分支里找同名的分支。手册里对 `--guess` 选项的说明是这样的：

> If `<branch>` is not found but there does exist a tracking branch in exactly one remote (call it `<remote>`) with a matching name, treat as equivalent to `git switch -c <branch> --track <remote>/<branch>`

也就是说，如果本地没有这个名字的分支，而恰好有一个远程仓库里有同名的分支，那么 switch 就会照着 origin/draft 新建一条本地的 draft，同时设置好上游。这个行为是默认打开的，`git checkout draft` 的效果也完全一样。需要注意的是参数要写 draft，如果写成 origin/draft，switch 会像代码 4 那样报错，而 checkout 则会进入分离头指针状态。

## 三、合作者推送了新的提交

为了模拟合作者，再从 `github/notes.git` 克隆一份到 partner 目录，把它当作合作者的电脑。合作者在 main 上新建了 ssh.md 并推送，接着又新建了一条 review 分支，也推送了上去：

```bash
cd ../partner
git add ssh.md
git commit -m "补上 SSH 的笔记"
git push
git switch -c review
git add review.md
git commit -m "审读第七章"
git push -u origin review
```

*代码 8：合作者那一边的操作，输出省略。*

回到本地的 notes 仓库，切换回 main，再看看 status 怎么说：

```bash
git status
# On branch main
# Your branch is ahead of 'origin/main' by 1 commit.
#   (use "git push" to publish your local commits)
#
# nothing to commit, working tree clean

git push
# To ……/github/notes.git
#  ! [rejected]        main -> main (fetch first)
# error: failed to push some refs to '……/github/notes.git'
# hint: Updates were rejected because the remote contains work that you do
# hint: not have locally. This is usually caused by another repository pushing
# hint: to the same ref. You may want to first integrate the remote changes
# hint: (e.g., 'git pull ...') before pushing again.
# hint: See the 'Note about fast-forwards' in 'git push --help' for details.
```

*代码 9：status 仍然说领先 1 个提交，push 却被拒绝了，退出码是 1。地址里的长路径用 …… 代替。*

status 说领先 1 个提交，这个判断其实已经过时了。上一章说过，git status 不会联网，它比较的是本地的 main 和本地的 origin/main。远程的 main 已经被合作者推到了新的提交上，但是本地的 origin/main 仍然停在 8c565ad，所以 status 看不出远程有了新东西。push 则要真正连接远程仓库，Git 这时才发现远程的 main 上有一个本地没有的提交，于是拒绝了这次推送。括号里的 `fetch first` 已经说明了下一步该做什么，也就是先把远程的提交拿下来。

到这里可以把几个区域之间的命令放在一起看一看。前几章的 add 和 commit 把改动从工作区送进暂存区，再送进本地仓库；上一章的 push 把本地仓库里的提交送到远程仓库。反方向的命令有两条，它们的区别就在于拿回来的提交送到哪里为止。

![工作区、暂存区、本地仓库、远程仓库之间的命令](/img/posts/git-fetch-pull/fetch-pull-flow.svg)

*图 1：fetch 只走到本地仓库，更新的是 `origin/*`；pull 一直走到工作区，因为它在 fetch 之后还会做一次合并。*

## 四、`git fetch`：只更新 `origin/*`

```bash
git fetch
# remote: Enumerating objects: 7, done.
# remote: Counting objects: 100% (7/7), done.
# remote: Compressing objects: 100% (5/5), done.
# remote: Total 6 (delta 0), reused 0 (delta 0), pack-reused 0
# Unpacking objects: 100% (6/6), 653 bytes | 217.00 KiB/s, done.
# From ……/github/notes
#    8c565ad..7169997  main       -> origin/main
#  * [new branch]      review     -> origin/review
```

*代码 10：不带参数时，fetch 会从当前分支的上游所在的远程仓库拉取，没有上游就用 origin。*

前面几行是在接收对象，6 个对象是合作者的两个提交、它们各自的目录树，以及新建的 ssh.md 和 review.md。从 From 开始的几行才是结果。每一行箭头左边是远程仓库里的分支，右边是本地记录它的远程跟踪分支。第一行说的是 origin/main 从 8c565ad 挪到了 7169997；第二行的 `[new branch]` 表示远程多了一条 review 分支，于是本地新建了一条 origin/review。可见 fetch 对已经存在的远程跟踪分支只是移动它的位置，只有远程新出现的分支，才会让本地多出一条远程跟踪分支。

```bash
git status
# On branch main
# Your branch and 'origin/main' have diverged,
# and have 1 and 1 different commits each, respectively.
#   (use "git pull" to merge the remote branch into yours)
#
# nothing to commit, working tree clean

ls
# README.md

git log --oneline --graph main origin/main
# * 7169997 (origin/main, origin/HEAD) 补上 SSH 的笔记
# | * 67f2ea7 (HEAD -> main) 开始写第八章
# |/
# * 8c565ad 补上第七章
# * 8db4435 第一篇笔记
```

*代码 11：status 的说法变成了分叉，两边各有 1 个对方没有的提交，但是工作区里仍然没有 ssh.md。*

fetch 之后，origin/main 指向了合作者的 7169997，status 这才看出两边已经分叉了。main 仍然停在 67f2ea7，工作区里也没有 ssh.md，因为 fetch 不会碰本地分支和工作区。正因为如此，任何时候执行 fetch 都是安全的，它不会打乱手上正在做的修改。

![fetch 之前、fetch 之后和 pull 之后](/img/posts/git-fetch-pull/fetch-then-merge.svg)

*图 2：前两行的区别只在 origin/main 和 7169997 上。第三行是下一节 pull 之后的样子，合并提交 0480eef 让 main 同时包含了两边的提交。*

拿回来的提交在合并之前就可以查看：

```bash
git log --oneline main..origin/main
# 7169997 (origin/main, origin/HEAD) 补上 SSH 的笔记

git show --stat origin/main
# commit 7169997232dbdbfc89b7d094577cc97e539236b0 (origin/main, origin/HEAD)
# Author: teammate <teammate@example.com>
# Date:   Fri Oct 9 10:06:00 2026 +0800
#
#     补上 SSH 的笔记
#
#  ssh.md | 3 +++
#  1 file changed, 3 insertions(+)
```

*代码 12：`main..origin/main` 列出的是在 origin/main 上、但是不在 main 上的提交，也就是这次 fetch 拿到、还没有合并进来的提交。*

如果想直接看文件，也可以像上一节那样执行 `git checkout origin/main`，看完再 `git switch main` 回来。

fetch 也可以只拿一条分支，写法是 `git fetch <远程> <分支>`。合作者接着又往 review 和 draft 上各推送了一个提交：

```bash
git fetch origin review
# （接收对象的几行，这里省略）
# From ……/github/notes
#  * branch            review     -> FETCH_HEAD
#    40f0372..4e79d9d  review     -> origin/review
```

*代码 13：只更新了 origin/review，draft 上的新提交这一次没有拿下来。*

第一行里的 FETCH_HEAD 是 `.git` 里的一个文件，它记录着这一次 fetch 拿到了什么，下一节的 pull 就会用到它。第二行说明 origin/review 也跟着更新了。draft 上虽然也有新提交，但是这一次只拿了 review，所以本地的 origin/draft 没有变。

## 五、`git pull`：fetch 之后再合并

手册对 pull 的说明是这样的：

> More precisely, git pull runs git fetch with the given parameters and then depending on configuration options or command line flags, will call either git rebase or git merge to reconcile diverging branches.

也就是说，pull 分成两步，先用同样的参数执行一次 fetch，再根据配置调用 rebase 或者 merge，把拿到的提交合并进当前分支。这一章只讲 merge 这一种。合并的时候，会遇到下面三种情况。

### 本地没有新提交：快进

先看 draft。代码 13 没有拿 draft 上的新提交，所以切换过去时，status 仍然说一致：

```bash
git switch draft
# Switched to branch 'draft'
# Your branch is up to date with 'origin/draft'.

git pull
# （接收对象的几行，这里省略）
# From ……/github/notes
#    73366ce..b1e8a68  draft      -> origin/draft
# Updating 73366ce..b1e8a68
# Fast-forward
#  draft.md | 1 +
#  1 file changed, 1 insertion(+)
```

*代码 14：From 开头的两行是 fetch 的输出，Updating 开头的几行是合并的输出。*

pull 先执行 fetch，把 origin/draft 从 73366ce 挪到了 b1e8a68，然后把它合并进本地的 draft。本地的 draft 上没有自己的新提交，所以合并只需要把 draft 往前挪，这就是第三章讲的快进，输出也和第三章一样。

### 两边都有新提交：先说明怎样合并

main 就不一样了，本地和远程各有一个对方没有的提交：

```bash
git switch main
git pull
# hint: You have divergent branches and need to specify how to reconcile them.
# hint: You can do so by running one of the following commands sometime before
# hint: your next pull:
# hint:
# hint:   git config pull.rebase false  # merge (the default strategy)
# hint:   git config pull.rebase true   # rebase
# hint:   git config pull.ff only       # fast-forward only
# hint:
# hint: You can replace "git config" with "git config --global" to set a default
# hint: preference for all repositories. You can also pass --rebase, --no-rebase,
# hint: or --ff-only on the command line to override the configured default per
# hint: invocation.
# fatal: Need to specify how to reconcile divergent branches.
```

*代码 15：退出码是 128。git switch main 的输出和代码 11 里 status 的前几行相同，这里省略。*

在 git 2.34.1 上，如果两边已经分叉，而仓库里又没有配置过合并的方式，pull 就会拒绝执行。手册的开头也写着这一条：

> If the current branch and the remote have diverged, the user needs to specify how to reconcile the divergent branches with --rebase or --no-rebase (or the corresponding configuration option in pull.rebase).

提示里列出了三种配置。`pull.rebase false` 表示用合并，也就是这一章说的 fetch 加 merge；`pull.rebase true` 表示用变基，要等讲到 rebase 时再看；`pull.ff only` 表示只允许快进，分叉时直接报错，留给人自己处理。上一小节 draft 那样的快进不受这个限制，没有配置也能直接完成。这里选择合并：

```bash
git config pull.rebase false
git pull
```

*代码 16：这样配置只对当前仓库生效。如果加上 `--global`，以后所有的仓库都会这样合并。*

和第三章的三方合并一样，Git 会先打开编辑器，默认的提交信息已经写好了：

```text
Merge branch 'main' of ……/github/notes
# Please enter a commit message to explain why this merge is necessary,
# especially if it merges an updated upstream into a topic branch.
#
# Lines starting with '#' will be ignored, and an empty message aborts
# the commit.
```

*代码 17：提交信息里写着合并的是哪个远程仓库的哪一条分支。如果远程是 GitHub，`of` 后面就是 GitHub 上的仓库地址。*

```bash
# （存盘退出之后）
# Merge made by the 'ort' strategy.
#  ssh.md | 3 +++
#  1 file changed, 3 insertions(+)
#  create mode 100644 ssh.md

ls
# README.md  ssh.md

git log --oneline --graph
# *   0480eef (HEAD -> main) Merge branch 'main' of ……/github/notes
# |\
# | * 7169997 (origin/main, origin/HEAD) 补上 SSH 的笔记
# * | 67f2ea7 开始写第八章
# |/
# * 8c565ad 补上第七章
# * 8db4435 第一篇笔记

git status
# On branch main
# Your branch is ahead of 'origin/main' by 2 commits.
#   (use "git push" to publish your local commits)
#
# nothing to commit, working tree clean
```

*代码 18：ssh.md 出现在了工作区里。领先的 2 个提交是本地的 67f2ea7 和合并提交 0480eef。*

这一次 pull 没有打印 From 那几行，因为代码 10 已经把 7169997 拿下来了，fetch 这一步没有拿到新的东西。合并之后，main 指向 0480eef，它有两个父提交，一个是本地的 67f2ea7，另一个是合作者的 7169997，图 2 的第三行画的就是这个时刻。origin/main 仍然停在 7169997，因为远程仓库还不知道这次合并。现在再推送就不会被拒绝了：

```bash
git push
# （打包和发送对象的几行，这里省略）
# To ……/github/notes.git
#    7169997..0480eef  main -> main
```

*代码 19：远程的 main 从 7169997 快进到了 0480eef，因为 0480eef 的父提交里就有 7169997。*

### 两边改了同一行：冲突

合作者先执行 git pull，把 0480eef 快进下来，然后把 README.md 的第 3 行改成「Git 第七章：remote、push 和 SSH」并推送。与此同时，本地把同一行改成了「Git 第七、八章：remote、push、fetch 和 pull」并提交：

```bash
git commit -am "README 写到第八章"
# [main 4379b48] README 写到第八章
#  1 file changed, 1 insertion(+), 1 deletion(-)

git pull
# （接收对象的几行，这里省略）
# From ……/github/notes
#    0480eef..28cb0da  main       -> origin/main
# Auto-merging README.md
# CONFLICT (content): Merge conflict in README.md
# Automatic merge failed; fix conflicts and then commit the result.
```

*代码 20：fetch 这一步成功了，合并这一步发生了冲突，退出码是 1。*

```bash
git status
# On branch main
# Your branch and 'origin/main' have diverged,
# and have 1 and 1 different commits each, respectively.
#   (use "git pull" to merge the remote branch into yours)
#
# You have unmerged paths.
#   (fix conflicts and run "git commit")
#   (use "git merge --abort" to abort the merge)
#
# Unmerged paths:
#   (use "git add <file>..." to mark resolution)
# 	both modified:   README.md
#
# no changes added to commit (use "git add" and/or "git commit -a")

cat README.md
# # 学习笔记
#
# <<<<<<< HEAD
# Git 第七、八章：remote、push、fetch 和 pull
# =======
# Git 第七章：remote、push 和 SSH
# >>>>>>> 28cb0da68ec21dc209038d8d5f6a919d8a5a80fe
#
# （后面几行没有冲突，这里省略）
```

*代码 21：冲突标记和第三章一样，只是 `>>>>>>>` 后面写的是提交号，因为 pull 合并的是 fetch 拿到的那个提交，而不是一条本地分支。*

解决冲突的办法和第三章完全一样。把这几行改成想要的样子，比如合成「Git 第七、八章：remote、push、SSH、fetch 和 pull」一行，并且删掉冲突标记，然后再 add 和 commit：

```bash
git add README.md
git commit
# （编辑器里已经填好了 Merge branch 'main' of ……/github/notes，存盘退出）
# [main 0580ec3] Merge branch 'main' of ……/github/notes

git push
# （打包和发送对象的几行，这里省略）
# To ……/github/notes.git
#    28cb0da..0580ec3  main -> main
```

*代码 22：add 表示冲突已经解决，commit 生成合并提交，最后再 push。*

和第三章不同的是最后多了一步 push。合并提交只在本地，远程仓库并不知道这次合并，所以要再推送一次，合作者下一次 pull 的时候才能拿到。如果冲突解决到一半，想放弃这次合并，可以按照 status 的提示执行 `git merge --abort`。这时 main 和工作区会回到 pull 之前的样子，但是 fetch 拿下来的 28cb0da 仍然记在 origin/main 上，因为撤销的只是合并这一步。

## 六、不带参数的 `git pull` 依靠上游

前面的 pull 都没有带参数，Git 是怎样知道应该拉取哪个远程仓库的哪一条分支的呢？手册里写的是：

> Default values for `<repository>` and `<branch>` are read from the "remote" and "merge" configuration for the current branch as set by git-branch(1) --track.

这里说的 remote 和 merge，就是上一章 `-u` 写进 `.git/config` 的那两行，也就是上游。clone 给 main 设置了上游，代码 7 的 switch 给 draft 设置了上游，所以前面的 pull 都不需要参数。如果一条分支没有上游会怎样呢？下面新建一条 fetch-notes 分支，提交之后推送，但是推送时没有加 `-u`：

```bash
git switch -c fetch-notes
git add fetch.md
git commit -m "fetch 的笔记"
# [fetch-notes 62632b8] fetch 的笔记
#  1 file changed, 3 insertions(+)
#  create mode 100644 fetch.md

git push origin fetch-notes
# （打包和发送对象的几行，这里省略）
# To ……/github/notes.git
#  * [new branch]      fetch-notes -> fetch-notes

git pull
# There is no tracking information for the current branch.
# Please specify which branch you want to merge with.
# See git-pull(1) for details.
#
#     git pull <remote> <branch>
#
# If you wish to set tracking information for this branch you can do so with:
#
#     git branch --set-upstream-to=origin/<branch> fetch-notes
#
```

*代码 23：退出码是 1。远程明明有一条同名的 fetch-notes，pull 也不会自己去找。*

switch 和 pull 在这一点上的做法不同。代码 7 的 switch 会去找同名的远程分支，但是 pull 不会，它只看上游配置。fetch-notes 没有上游，所以即使远程有同名的分支，pull 也不知道该拉取哪一条。解决办法有两种，一种是在命令里写明远程和分支，另一种是用上一章的 `git branch -u` 设置上游：

```bash
git pull origin fetch-notes
# From ……/github/notes
#  * branch            fetch-notes -> FETCH_HEAD
# Already up to date.

git branch -u origin/fetch-notes
# Branch 'fetch-notes' set up to track remote branch 'fetch-notes' from 'origin'.

git pull
# Already up to date.

git branch -vv
#   draft       b1e8a68 [origin/draft] 草稿：想清楚了
# * fetch-notes 62632b8 [origin/fetch-notes] fetch 的笔记
#   main        0580ec3 [origin/main] Merge branch 'main' of ……/github/notes
```

*代码 24：`git branch -vv` 在每条分支后面的方括号里列出它的上游。报错信息里的 `--set-upstream-to` 就是 `-u` 的完整写法。*

带参数的写法有一点需要注意。`git pull origin main` 的意思是把远程的 main 合并进当前所在的分支，而不是合并进本地的 main，手册的第一句话就是 `Incorporates changes from a remote repository into the current branch`。所以如果当时在 fetch-notes 上执行 `git pull origin main`，远程 main 上的提交就会被合并进 fetch-notes。带参数执行 pull 之前，最好先确认一下当前在哪条分支上。

## 小结

| 写法 | 作用和要点 |
| --- | --- |
| `git branch -r` | 列出远程跟踪分支，`-a` 连同本地分支一起列出 |
| `origin/main` | 远程跟踪分支，保存在本地的 .git 里，记录上一次通信时远程 main 的位置，只有 fetch、pull、push 会移动它 |
| `git switch <分支>` | 本地没有这条分支、远程有同名分支时，照着 `origin/<分支>` 新建并设置上游 |
| `git checkout origin/<分支>` | 进入分离头指针状态，可以查看文件，新的提交不属于任何分支 |
| `git fetch` | 把远程的新提交拿进本地仓库，只更新 `origin/*`，本地分支和工作区不变 |
| `git fetch <远程> <分支>` | 只拿一条分支，同时更新 `origin/<分支>` 和 FETCH_HEAD |
| `git log main..origin/main` | 列出 fetch 拿到、还没有合并进 main 的提交 |
| `git pull` | 先 fetch，再把上游合并进当前分支；落后时快进，分叉时要先配置 pull.rebase |
| `git config pull.rebase false` | 分叉时用合并，加 `--global` 对所有仓库生效 |
| `git merge --abort` | 放弃 pull 时发生冲突的那次合并，`origin/*` 仍然保持 fetch 之后的位置 |
| `git pull origin main` | 把远程的 main 合并进当前所在的分支，不一定是本地的 main，也不需要上游 |
| `git branch -vv` | 列出每条本地分支的上游 |

*表中的 `<远程>` 通常是 origin。*

这一章的命令都可以用 `origin/*` 这组记录串起来。因为 `origin/*` 保存在本地，所以 git status 不联网也能比较，但是它说的永远是上一次通信时的情况。fetch 只负责更新这组记录，不碰本地分支和工作区，所以随时都可以放心执行。pull 在 fetch 之后再做一次合并，所以它和第三章的合并一样，可能快进，可能生成合并提交，也可能发生冲突。两边都有新提交时，除了合并，还可以用变基把本地的提交接到远程提交的后面，`pull.rebase true` 就是这种做法，等讲到 rebase 的时候再回来看。
