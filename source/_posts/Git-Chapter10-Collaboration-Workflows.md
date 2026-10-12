---
title: Git 第十章：功能分支、pull request 和 fork
date: 2026-10-11 16:48:00
description: Colt Steele《The Git & Github Bootcamp》协作工作流那一章的复盘。如果所有人都在 main 上提交，那么每次推送之前都要先把别人的提交拉下来，没写完的改动也会直接进入 main。功能分支工作流让每个功能在自己的分支上完成，做完以后再合并进 main，在 GitHub 上通常先开一个 pull request，审阅通过之后再合并。合并之前可以先把 main 合进功能分支，让冲突在功能分支上解决，但是要合并的是 fetch 之后的 origin/main，而不是本地那条可能已经过时的 main。没有推送权限的项目要先 fork 到自己的账号下，再添加一个叫 upstream 的远程来同步原仓库的更新，最后从 fork 向原仓库提 pull request。
categories:
  - [课外, AI Infra, Git]
tags:
  - GitHub
  - 工作流
  - 功能分支
  - pull request
  - fork
cover: /img/covers/Git-Chapter10-Collaboration-Workflows.svg
series: Git
privacy: protected
sitemap: false
private_section: 课外
---

上一章把别人加成了合作者，于是几个人可以往同一个仓库推送。第八章模拟的其实就是这种情况。合作者先推送了，本地的推送就会被拒绝，只好先 pull 下来，有冲突还要先解决冲突。只有两个人、偶尔推送一次的时候，这样做还能应付。但是如果人一多，大家又都在同一条 main 上提交，那么每个人都会不停地被别人的提交打断。

所以多人合作的时候，需要先约定好怎样使用分支，这种约定就叫作**工作流**（workflow）。这一章先看所有人都在 main 上提交会遇到什么问题，再看功能分支工作流是怎样解决这些问题的，以及 GitHub 上的 pull request 在其中起什么作用。最后一节讲 fork，它解决的是另一种情况，也就是想给一个自己没有推送权限的项目贡献代码。

<!-- more -->

## 一、所有人都在 main 上提交

最简单的合作方式是每个人都 clone 同一个仓库，都在 main 上提交，写完就推送到远程的 main。这种做法叫作集中式工作流（centralized workflow），它不需要任何分支操作，所以刚开始合作时很容易采用这种做法。

它的问题在于所有人共用一条分支。第一个问题是推送经常被拒绝。只要有人先推送了，其他人的 main 就落后于远程，推送就会像第八章代码 9 那样被拒绝。这时必须先 pull，如果两边改了同一行，还要像第八章代码 20 那样先解决冲突，然后才能继续推送。第二个问题是没写完的改动也会进入 main。一个功能往往要提交好几次才能完成。如果中间的每一次提交都推送到 main 上，那么别人 pull 下来的就是一个做了一半的功能，甚至是跑不起来的代码。如果为了避免这种情况，干脆等功能全部做完再推送，那么本地就会积攒很多提交，推送之前要处理的冲突也会更多。第三个问题是没有地方让别人先看一看。改动一推送就已经在 main 上了，即使别人发现了问题，也只能在 main 上再提交一次去修正。

## 二、功能分支工作流

功能分支工作流（feature branch workflow）的约定是，每做一个功能，就从 main 新建一条分支。这个功能的所有提交都放在这条分支上，main 上只放已经完成的功能。这些分支同样推送到远程仓库，所以别人可以看到这个功能做到了哪一步，但是只要它还没有合并进 main，就不会影响 main。

下面仍然用本地的裸仓库 `github/notes.git` 代替 GitHub 上的仓库，notes 目录是自己的克隆，partner 目录扮演合作者。远程的 main 上已经有两个提交。现在本地要写一篇关于工作流的笔记，于是先新建一条 workflow 分支：

```bash
git switch -c workflow
# Switched to a new branch 'workflow'

git add workflow.md
git commit -m "功能分支的笔记"
# [workflow 4e5bfda] 功能分支的笔记
#  1 file changed, 3 insertions(+)
#  create mode 100644 workflow.md

git push -u origin workflow
# （打包和发送对象的几行，这里省略）
# To ……/github/notes.git
#  * [new branch]      workflow -> workflow
# Branch 'workflow' set up to track remote branch 'workflow' from 'origin'.
```

*代码 1：第一次推送新分支时加上 `-u`，以后在这条分支上就可以直接 push 和 pull 了。地址里的长路径用 …… 代替。*

与此同时，合作者也新建了一条 fork-notes 分支，写了 fork.md，还把 README.md 第 3 行改成了「Git 第八章：fetch 和 pull；第十章：fork」：

```bash
git switch -c fork-notes
git add fork.md README.md
git commit -m "fork 的笔记"
# [fork-notes b65b1bb] fork 的笔记
#  2 files changed, 4 insertions(+), 1 deletion(-)
#  create mode 100644 fork.md

git push -u origin fork-notes
```

*代码 2：合作者那一边的操作，push 的输出省略。*

回到本地，fetch 一次，看看合作者的提交到了哪里：

```bash
git fetch
# （接收对象的几行，这里省略）
# From ……/github/notes
#  * [new branch]      fork-notes -> origin/fork-notes

git status
# On branch workflow
# Your branch is up to date with 'origin/workflow'.
#
# nothing to commit, working tree clean

git log --oneline --graph --all
# * b65b1bb (origin/fork-notes) fork 的笔记
# | * 4e5bfda (HEAD -> workflow, origin/workflow) 功能分支的笔记
# |/
# * aa155e5 (origin/main, origin/HEAD, main) 补上第八章
# * fa5573c 第一篇笔记
```

*代码 3：合作者的提交只让本地多了一条 origin/fork-notes，workflow 分支和工作区都没有变化。*

和集中式工作流相比，这里最大的区别是合作者的推送没有打断本地的工作。因为两个人推送的是不同的分支，所以谁先推送都不会让对方的推送被拒绝。fetch 拿到的提交也只是记在 origin/fork-notes 上，本地的 workflow 和工作区里的文件都没有变化。如果想看看合作者写了什么，可以用第八章的办法切换到 fork-notes；如果不关心，那么完全可以不理它，继续在 workflow 上提交。

## 三、做完的功能合并进 main

合作者的 fork 笔记先写完了，于是要把 fork-notes 合并进 main。最直接的做法就是在本地合并，然后推送：

```bash
git switch main
# Switched to branch 'main'
# Your branch is up to date with 'origin/main'.

git pull
# （接收对象的几行，这里省略）
# From ……/github/notes
#  * [new branch]      workflow   -> origin/workflow
# Already up to date.

git merge fork-notes
# Updating aa155e5..b65b1bb
# Fast-forward
#  README.md | 2 +-
#  fork.md   | 3 +++
#  2 files changed, 4 insertions(+), 1 deletion(-)
#  create mode 100644 fork.md

git push
# Total 0 (delta 0), reused 0 (delta 0), pack-reused 0
# To ……/github/notes.git
#    aa155e5..b65b1bb  main -> main
```

*代码 4：这是合作者那一边的操作。合并之前先 pull，保证本地的 main 和远程一致。*

合并之前先执行一次 pull，是为了确认本地的 main 已经是最新的。这一次远程的 main 并没有新提交，所以 pull 只顺带拿到了 origin/workflow。因为 main 在 fork-notes 分出去之后没有动过，所以这次合并是第三章讲的快进。推送时的 `Total 0` 说明这次没有发送任何对象。因为 b65b1bb 和它的文件在推送 fork-notes 的时候已经送到远程了，所以这一次只是把远程的 main 挪到了 b65b1bb。

## 四、pull request：先审阅，再合并

代码 4 的合并是合作者一个人决定的，合并之前没有人看过这些改动。在 GitHub 上，更常见的做法是先开一个 **pull request**（常简称为 PR），请别人审阅之后再合并。pull request 是 GitHub 网站提供的功能，并不是 Git 的命令。它的意思是请求把一条分支合并进另一条分支，GitHub 的文档是这样描述的：

> A pull request proposes merging code changes from one branch into another.

以 workflow 为例，开 pull request 的步骤是这样的。先把 workflow 推送到 GitHub，这时仓库首页的文件列表上方会出现一条黄色的提示，点击里面的 Compare & pull request 按钮。在新页面上，base 选择要合并进去的分支 main，compare 选择做出改动的分支 workflow，再填写标题和说明，最后点击 Create pull request。

pull request 的页面上有几个标签页。Conversation 里是说明、评论和整个过程的时间线，Commits 列出这条分支上的提交。Files changed 显示和 base 相比的 diff，审阅的人可以在 diff 的某一行上直接写评论。如果审阅的人提出了修改意见，那么作者只需要在本地的 workflow 上继续提交，然后推送就可以了。因为 pull request 关联的是 workflow 这条分支，而不是某几个提交，所以新推送的提交会自动出现在这个 pull request 里。

审阅通过之后，有写权限的人就可以点击页面底部的 Merge pull request。这个按钮旁边的下拉菜单里有三种合并方式：

- Create a merge commit 是默认的方式。文档里写着它使用 `--no-ff` 选项，也就是说即使能够快进，也一定会生成一个合并提交。这个合并提交的信息由 GitHub 生成，第一行是 `Merge pull request #<编号> from <用户名>/<分支>`，空一行之后是 pull request 的标题。
- Squash and merge 把这条分支上的所有提交压成一个提交，再放到 main 上。
- Rebase and merge 把分支上的提交逐个接到 main 的后面，不生成合并提交。rebase 是下一章的内容。

合并以后，页面上还会提供一个删除这条分支的按钮，因为这个功能已经进了 main，分支就不再需要了。合并是在 GitHub 上完成的，本地并不知道，所以还要回到本地执行 `git switch main` 和 `git pull`，把合并后的 main 拿下来。

## 五、先在分支上合并 main，再把分支合进 main

现在轮到 workflow 了。本地在 workflow 上又提交了一次，把 README.md 第 3 行改成了「Git 第八章：fetch 和 pull；第十章：功能分支」。这一行合作者也改过，而且合作者的改动已经进了 main，所以 workflow 和 main 合并时一定会发生冲突。

冲突应该在哪里解决呢？比较稳妥的顺序是先在 workflow 上合并 main，再在 main 上合并 workflow。第一步的作用是同步，把 main 上别人的改动拿到自己的分支上来。如果有冲突，那么冲突就在 workflow 上解决，解决完还可以慢慢检查、运行测试，就算改坏了也不会影响 main。第二步的作用是交付，这时 workflow 已经包含了 main 上的所有提交，所以只要这期间 main 没有再变，合并就不会再有冲突。

先按照字面的意思，在 workflow 上合并 main：

```bash
git commit -am "README 加上第十章"
# [workflow e5b9b6a] README 加上第十章
#  1 file changed, 1 insertion(+), 1 deletion(-)

git merge main
# Already up to date.
```

*代码 5：合作者的改动明明已经进了 main，merge 却说已经是最新的。*

Git 说已经是最新的，是因为本地的 main 确实没有新东西。合作者的合并发生在 partner 和远程仓库里，而本地的 main 从克隆以后就没有动过，仍然停在 aa155e5，这个提交早就包含在 workflow 里了。也就是说，这里合并的是一条过时的 main。fetch 一次就能看清楚：

```bash
git fetch
# From ……/github/notes
#    aa155e5..b65b1bb  main       -> origin/main

git log --oneline --graph --all
# * e5b9b6a (HEAD -> workflow) README 加上第十章
# * 4e5bfda (origin/workflow) 功能分支的笔记
# | * b65b1bb (origin/main, origin/fork-notes, origin/HEAD) fork 的笔记
# |/
# * aa155e5 (main) 补上第八章
# * fa5573c 第一篇笔记
```

*代码 6：origin/main 已经到了 b65b1bb，本地的 main 还在 aa155e5。*

所以在分支上合并 main 时，要合并的其实是远程的 main。一种写法是先 `git switch main` 再 `git pull`，把本地的 main 更新到最新，然后切回 workflow 合并 main。另一种写法更简单，fetch 之后直接合并 origin/main：

```bash
git merge origin/main
# Auto-merging README.md
# CONFLICT (content): Merge conflict in README.md
# Automatic merge failed; fix conflicts and then commit the result.

cat README.md
# # 学习笔记
#
# <<<<<<< HEAD
# Git 第八章：fetch 和 pull；第十章：功能分支
# =======
# Git 第八章：fetch 和 pull；第十章：fork
# >>>>>>> origin/main
```

*代码 7：冲突发生在 workflow 上，main 不受影响。HEAD 一侧是 workflow 的版本，origin/main 一侧是合作者的版本。*

把这一行改成「Git 第八章：fetch 和 pull；第十章：功能分支和 fork」，删掉冲突标记，然后和第三章一样 add 再 commit：

```bash
git add README.md
git commit
# （编辑器里已经填好了 Merge remote-tracking branch 'origin/main' into workflow，存盘退出）
# [workflow 1c29ab7] Merge remote-tracking branch 'origin/main' into workflow

git log --oneline --graph
# *   1c29ab7 (HEAD -> workflow) Merge remote-tracking branch 'origin/main' into workflow
# |\
# | * b65b1bb (origin/main, origin/fork-notes, origin/HEAD) fork 的笔记
# * | e5b9b6a README 加上第十章
# * | 4e5bfda (origin/workflow) 功能分支的笔记
# |/
# * aa155e5 (main) 补上第八章
# * fa5573c 第一篇笔记

git push
# （打包和发送对象的几行，这里省略）
# To ……/github/notes.git
#    4e5bfda..1c29ab7  workflow -> workflow
```

*代码 8：合并的是远程跟踪分支，所以默认的提交信息写的是 remote-tracking branch。推送之后，远程的 workflow 也包含了 main 上的所有提交。*

第二步是在 main 上合并 workflow：

```bash
git switch main
# Switched to branch 'main'
# Your branch is behind 'origin/main' by 1 commit, and can be fast-forwarded.
#   (use "git pull" to update your local branch)

git pull
# Updating aa155e5..b65b1bb
# Fast-forward
#  README.md | 2 +-
#  fork.md   | 3 +++
#  2 files changed, 4 insertions(+), 1 deletion(-)
#  create mode 100644 fork.md

git merge workflow
# Updating b65b1bb..1c29ab7
# Fast-forward
#  README.md   | 2 +-
#  workflow.md | 3 +++
#  2 files changed, 4 insertions(+), 1 deletion(-)
#  create mode 100644 workflow.md

git push
# Total 0 (delta 0), reused 0 (delta 0), pack-reused 0
# To ……/github/notes.git
#    b65b1bb..1c29ab7  main -> main
```

*代码 9：pull 把本地的 main 快进到 b65b1bb，合并 workflow 又快进到 1c29ab7，两步都没有冲突。*

![先在分支上合并 main，再把分支合进 main](/img/posts/git-workflows/sync-then-deliver.svg)

*图 1：第二步之所以能够快进，是因为第一步之后，main 上的 b65b1bb 已经是 1c29ab7 的父提交之一。*

在 main 上合并 workflow 时，main 在 workflow 合并 origin/main 之后没有再变过，所以这一步直接快进，连冲突都不可能出现。如果在这期间 main 上又合进了别的功能，那么这一步就不再是快进，而是一次三方合并。不过即使有冲突，也只剩下这段时间新出现的那一点。如果这一步是在 GitHub 上点 Merge pull request 完成的，那么因为用了 `--no-ff`，main 上还会多一个合并提交，但同样不会有冲突。

GitHub 的 pull request 页面也是按照这个顺序设计的。如果 base 分支有了新提交，而两边又没有冲突，页面上就会出现一个 Update branch 按钮。它做的就是代码 7 和代码 8 这件事，把 base 分支合并进 compare 分支。如果两边有冲突，Merge pull request 按钮会变成不能点击的状态。简单的冲突，也就是两边改了同一行这种，可以点击 Resolve conflicts 在网页上解决。文档特别提醒，这样做同样是把整个 base 分支合并进 compare 分支。比较复杂的冲突就只能像上面那样，在本地合并、解决之后再推送，pull request 会自动更新。

## 六、fork：没有推送权限的时候

功能分支工作流有一个前提，那就是所有人都能往同一个仓库推送，也就是都是第九章所说的合作者。但是在开源项目里，项目的维护者不可能把每一个想贡献代码的人都加成合作者。没有推送权限的人推送到这个仓库，会被 GitHub 拒绝，报错里写着 `Permission to <拥有者>/<仓库> denied to <用户名>`。

这时就需要 **fork**。fork 的意思是把别人的仓库复制一份，作为一个新的仓库放到自己的账号下面。原来的那个仓库叫作 upstream 仓库，GitHub 会一直记着这两个仓库之间的联系。文档里是这样定义的：

> A fork is a copy of a repository that you own, connected to the original repository, called the upstream repository.

fork 出来的仓库属于自己，所以可以在里面随意新建分支、提交和推送。改好以后，再从这个仓库向原仓库提一个 pull request，请维护者合并。在 GitHub 上 fork 的步骤是，打开原仓库的页面，点击右上角的 Fork，选择放到哪个账号下面，仓库名默认和原仓库相同，最后点击 Create fork。页面上还有一个 Copy the main branch only 的选项，勾选它就只复制默认分支，不勾选就复制所有分支。

需要注意的是，fork 是在 GitHub 服务器上完成的复制，它只是在自己的账号下多了一个仓库，本地电脑上什么都没有。所以接下来还是要 clone，只不过 clone 的是自己的 fork，而不是原仓库。

### 克隆自己的 fork，再记下原仓库

下面换一个例子。维护者 maintainer 有一个 Git 速查表仓库 cheatsheet，用本地的裸仓库 `github/maintainer/cheatsheet.git` 来代替。在 GitHub 上点 Fork，会在自己的账号下得到一份副本，这里用 `git clone --bare` 复制一个裸仓库 `github/noimpty/cheatsheet.git` 来代替这一步：

```bash
git clone --bare github/maintainer/cheatsheet.git github/noimpty/cheatsheet.git
# Cloning into bare repository 'github/noimpty/cheatsheet.git'...
# done.
```

*代码 10：这一步模拟的是 GitHub 上的 Fork 按钮，真正使用 GitHub 时不需要执行这条命令。*

接着把自己的 fork 克隆到本地：

```bash
git clone github/noimpty/cheatsheet.git cheatsheet
cd cheatsheet
git remote -v
# origin	……/github/noimpty/cheatsheet.git (fetch)
# origin	……/github/noimpty/cheatsheet.git (push)

git remote add upstream ../github/maintainer/cheatsheet.git
git remote -v
# origin	……/github/noimpty/cheatsheet.git (fetch)
# origin	……/github/noimpty/cheatsheet.git (push)
# upstream	../github/maintainer/cheatsheet.git (fetch)
# upstream	../github/maintainer/cheatsheet.git (push)
```

*代码 11：origin 是 clone 时自动记下的，指向自己的 fork；upstream 是手动添加的，指向原仓库。*

clone 只记下了 origin，也就是自己的 fork。原仓库以后还会有新的提交，但是 GitHub 并不会自动把它们同步到 fork 里，所以要用第七章的 `git remote add` 再添加一个远程，指向原仓库。这个远程按照惯例叫作 upstream，GitHub 的文档也是这样写的。

这里的 upstream 只是一个远程仓库的名字，和第七章所说的上游并不是一回事。第七章的上游是一条分支的配置，记录的是这条分支和哪一条远程分支配成一对。添加 upstream 这个远程以后，本地 main 的上游仍然是 origin/main。

![fork 之后的三个仓库](/img/posts/git-workflows/fork-remotes.svg)

*图 2：本地仓库同时连着两个远程，origin 能读能写，upstream 只能读。改动要回到原仓库，只能经过 pull request。*

### 原仓库有了新提交

维护者往原仓库的 main 推送了一个新提交「补上 stash」。这时如果在本地执行 git pull，会发现什么也没有拿到：

```bash
git pull
# Already up to date.
```

*代码 12：不带参数的 pull 拉取的是上游，也就是 origin/main，而自己的 fork 并没有变。*

第八章讲过，不带参数的 pull 依靠的是上游配置。main 的上游是 origin 上的 main，也就是自己的 fork，而维护者的新提交只在原仓库里，fork 并不会自动跟着更新，所以 pull 拿不到这个提交。要拿到它，就要明确地从 upstream 拉取：

```bash
git fetch upstream
# （接收对象的几行，这里省略）
# From ../github/maintainer/cheatsheet
#  * [new branch]      main       -> upstream/main

git status
# On branch main
# Your branch is up to date with 'origin/main'.
#
# nothing to commit, working tree clean

git log --oneline --graph --all
# * b8e2f18 (upstream/main) 补上 stash
# * 813a61a (HEAD -> main, origin/main, origin/HEAD) 速查表初稿
```

*代码 13：第一次从 upstream 拉取，本地新建了 upstream/main 这条远程跟踪分支。status 仍然只和 origin/main 比较，所以它说已经是最新的。*

fetch upstream 的规则和第八章完全一样，只是远程跟踪分支的名字变成了 `upstream/` 开头。拿到提交以后，再把 upstream/main 合并进本地的 main，然后推送到自己的 fork：

```bash
git merge upstream/main
# Updating 813a61a..b8e2f18
# Fast-forward
#  cheatsheet.md | 1 +
#  1 file changed, 1 insertion(+)

git push
# （打包和发送对象的几行，这里省略）
# To ……/github/noimpty/cheatsheet.git
#    813a61a..b8e2f18  main -> main
```

*代码 14：本地的 main 上没有自己的提交，所以合并是快进。不带参数的 push 按照 main 的上游配置推送到 origin，也就是自己的 fork。*

fetch 和 merge 这两步也可以合成一条 `git pull upstream main`，意思是从 upstream 拉取 main，再合并进当前分支。另外，GitHub 上 fork 的页面里有一个 Sync fork 按钮，点击 Update branch 可以直接在 GitHub 上把原仓库的提交同步到 fork 里。这样做之后，本地再执行普通的 git pull 就能拿到这些提交了。

### 从 fork 提 pull request

要贡献代码时，最好不要直接在 main 上提交，而是新建一条分支。这样 main 就一直保持和原仓库相同，同步时总是快进，而自己的改动都在单独的分支上：

```bash
git switch -c rebase-entry
git commit -am "补上 rebase"
# [rebase-entry bb3dc68] 补上 rebase
#  1 file changed, 1 insertion(+)

git push -u origin rebase-entry
# （打包和发送对象的几行，这里省略）
# To ……/github/noimpty/cheatsheet.git
#  * [new branch]      rebase-entry -> rebase-entry
# Branch 'rebase-entry' set up to track remote branch 'rebase-entry' from 'origin'.
```

*代码 15：新分支推送到的是 origin，也就是自己的 fork。*

接下来打开原仓库的页面，点击 Compare & pull request，然后在新建 pull request 的页面上点击 compare across forks，这样才能选择别的仓库里的分支。base 一侧选原仓库 maintainer/cheatsheet 的 main，head fork 选自己的 fork，compare 选 rebase-entry 分支。填好标题和说明之后，下面还有一个 Allow edits from maintainers 的选项，勾选它表示允许原仓库的维护者直接往这条分支上推送修改。最后点击 Create pull request。

之后的流程和第四节一样，维护者审阅、提意见，自己在 rebase-entry 上继续提交并推送到 fork，pull request 会自动更新。维护者合并以后，原仓库的 main 上就有了这个提交，再像上一小节那样从 upstream 同步一次，本地和 fork 的 main 也就都有了。

## 小结

| 写法或位置 | 作用和要点 |
| --- | --- |
| 集中式工作流 | 所有人都在 main 上提交，推送常被拒绝，没写完的改动也会进入 main |
| 功能分支工作流 | 每个功能一条分支，做完再合并进 main，别人的推送不会打断自己 |
| Compare & pull request | 推送分支之后在 GitHub 上开 pull request，base 选 main，compare 选功能分支 |
| Merge pull request | 默认用 `--no-ff` 生成合并提交，另外两种是 Squash and merge 和 Rebase and merge |
| `git merge origin/main` | 在功能分支上合并远程的 main，冲突在分支上解决；只合并本地的 main 可能是过时的 |
| Update branch | pull request 页面上的按钮，把 base 分支合并进 compare 分支 |
| Fork | 把别人的仓库复制到自己的账号下，在 GitHub 服务器上完成 |
| `git remote add upstream <地址>` | 记下原仓库，upstream 只是远程的名字，不是第七章的上游 |
| `git pull upstream main` | 从原仓库拉取 main 并合并，之后再 push 到自己的 fork |
| compare across forks | 从自己 fork 里的分支向原仓库提 pull request |

这一章的几种做法，都是在决定提交先放在哪里，等到什么时候再进入 main。功能分支让没写完的提交留在自己的分支上，pull request 让这些提交在进入 main 之前先给别人看一遍。fork 则让没有推送权限的人也有了一个自己的仓库，可以存放提交。同步的方向总是先把 main 合进自己的分支，这样冲突在自己的分支上解决，最后合进 main 的时候就不会再有冲突了。每次同步都会多出一个合并提交，下一章的 rebase 是同步的另一种做法，它不生成合并提交，但是有一条必须遵守的规矩。
