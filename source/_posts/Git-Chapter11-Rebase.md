---
title: Git 第十一章：rebase 把分支上的提交重新接到 main 的最后
date: 2026-10-11 21:09:00
description: Colt Steele《The Git & Github Bootcamp》rebase 那一章的复盘。功能分支每合并一次 main，历史里就多一个合并提交；git rebase main 则把分支上独有的提交逐个复制到 main 最新的提交后面，历史变成一条直线，之后再合并进 main 就是快进。复制出来的提交换了父提交和提交时间，所以提交号也变了，原来的提交仍然留在仓库里，ORIG_HEAD 记着它们。rebase 遇到冲突时，HEAD 一侧是 main 的版本，解决之后用 git add 标记，再执行 git rebase --continue。因为 rebase 会换掉提交，所以别人手里已经有的提交不要 rebase，否则推送要强制覆盖，合作者那边还会出现两份相同的提交。git pull --rebase 只 rebase 还没有推送的本地提交，是最常用、也最安全的一种用法。
categories:
  - [课外, AI Infra, Git]
tags:
  - rebase
  - 变基
  - 合并提交
  - 冲突
  - force push
cover: /img/covers/Git-Chapter11-Rebase.svg
series: Git
privacy: protected
sitemap: false
private_section: 课外
---

上一章的功能分支工作流里，每当 main 上有了别人的新提交，就要在自己的分支上合并一次 main，目的是让冲突在自己的分支上解决。这种做法很稳妥，但是分支存在的时间越长，合并 main 的次数就越多，而每合并一次，历史里就多一个合并提交。这些合并提交本身并没有做什么新的工作，它们只是记录了「这时候同步了一次 main」，可是 git log 里却到处都是它们。

**rebase** 是同步的另一种做法。它不生成合并提交，而是把分支上的提交重新接到 main 的最后，于是历史变成了一条直线。代价是这些提交会被换成新的提交，所以 rebase 有一条一定要遵守的规矩，那就是别人手里已经有的提交不要 rebase。这一章先比较 merge 和 rebase 的结果，再看 rebase 遇到冲突时怎样处理，然后看违反这条规矩会发生什么，最后回到第八章留下的 `git pull --rebase`。

<!-- more -->

## 一、每同步一次 main，就多一个合并提交

远程的 main 上已经有两个提交。本地新建了一条 rebase-notes 分支，提交了「rebase 的笔记」。在这期间，main 上先后合进了别人的两个提交，分别是「补上 SSH 的笔记」和「补上 Pages 的笔记」。为了让例子简单一些，下面直接在本地的 main 上提交来代表这两个提交，不再经过远程仓库。

按照上一章的做法，main 上每多一个提交，就在 rebase-notes 上合并一次 main：

```bash
git switch rebase-notes
git merge main
# （编辑器里已经填好了 Merge branch 'main' into rebase-notes，存盘退出）
# Merge made by the 'ort' strategy.
#  ssh.md | 3 +++
#  1 file changed, 3 insertions(+)
#  create mode 100644 ssh.md

git commit -am "补上 rebase 的冲突"
# [rebase-notes 4b7385a] 补上 rebase 的冲突
#  1 file changed, 2 insertions(+)

git merge main
# （编辑器里已经填好了 Merge branch 'main' into rebase-notes，存盘退出）
# Merge made by the 'ort' strategy.
#  pages.md | 3 +++
#  1 file changed, 3 insertions(+)
#  create mode 100644 pages.md
```

*代码 1：第一次合并之后，rebase-notes 上又提交了一次，main 上也多了「补上 Pages 的笔记」，于是再合并一次。*

```bash
git log --oneline --graph
# *   ef80711 (HEAD -> rebase-notes) Merge branch 'main' into rebase-notes
# |\
# | * 7f22180 (main) 补上 Pages 的笔记
# * | 4b7385a 补上 rebase 的冲突
# * | fbae2d7 Merge branch 'main' into rebase-notes
# |\|
# | * 05f3930 补上 SSH 的笔记
# * | 9201e00 rebase 的笔记
# |/
# * 67f3f36 (origin/main, origin/HEAD) 补上第十章
# * e40485f 第一篇笔记
```

*代码 2：rebase-notes 上有四个提交，其中两个是合并提交。*

rebase-notes 上真正写了笔记的提交只有 9201e00 和 4b7385a 两个，另外两个都是同步 main 时留下的合并提交。如果 main 变得更频繁，或者这条分支存在的时间更长，那么合并提交的数量很快就会超过真正的提交。等到 rebase-notes 最后合并进 main 的时候，这些合并提交也会一起进入 main 的历史。

## 二、`git rebase main`：把提交接到 main 的最后

现在回到两次合并之前，换一种做法。rebase-notes 上同样有「rebase 的笔记」和「补上 rebase 的冲突」两个提交，main 上也同样多了两个提交，只是这一次 rebase-notes 没有合并过 main：

```bash
git switch rebase-notes
git log --oneline --graph --all
# * 7f22180 (main) 补上 Pages 的笔记
# * 05f3930 补上 SSH 的笔记
# | * 0108cb1 (HEAD -> rebase-notes) 补上 rebase 的冲突
# | * 9201e00 rebase 的笔记
# |/
# * 67f3f36 (origin/main, origin/HEAD) 补上第十章
# * e40485f 第一篇笔记
```

*代码 3：两条分支从 67f3f36 分开，各有两个提交。「补上 rebase 的冲突」的提交号和代码 2 里不同，因为这一次它的父提交是 9201e00，而不是合并提交 fbae2d7。*

这时在 rebase-notes 上执行 `git rebase main`：

```bash
git rebase main
# Successfully rebased and updated refs/heads/rebase-notes.

git log --oneline --graph --all
# * cebe45e (HEAD -> rebase-notes) 补上 rebase 的冲突
# * 68bf5ee rebase 的笔记
# * 7f22180 (main) 补上 Pages 的笔记
# * 05f3930 补上 SSH 的笔记
# * 67f3f36 (origin/main, origin/HEAD) 补上第十章
# * e40485f 第一篇笔记
```

*代码 4：rebase-notes 的两个提交到了 main 的后面，整个历史变成了一条直线。*

rebase 的中文译名是**变基**。这里的基指的是分支分出去的那个提交，rebase-notes 原来是从 67f3f36 分出去的，rebase 之后，它就像是从 main 最新的 7f22180 分出去的一样。手册把这个过程分成了三步。第一步是找出要搬的提交：

> All changes made by commits in the current branch but that are not in `<upstream>` are saved to a temporary area. This is the same set of commits that would be shown by `git log <upstream>..HEAD`

这里的 `<upstream>` 就是命令里写的 main。也就是说，rebase 先找出在 rebase-notes 上、但是不在 main 上的提交，也就是 9201e00 和 0108cb1。第二步，把当前分支移到 main 所在的提交上，手册说这一步的效果和 `git reset --hard main` 完全一样。第三步，把第一步找出来的提交按原来的顺序，一个一个重新应用到当前分支上。所以 rebase 之后，rebase-notes 上的两个提交接在了 7f22180 的后面。

![merge 和 rebase 的结果对比](/img/posts/git-rebase/merge-vs-rebase.svg)

*图 1：同样是同步 main，merge 留下了两个合并提交，rebase 则把两个提交复制到了 main 的后面。原来的两个提交没有被删除，只是 rebase-notes 不再指向它们。*

## 三、rebase 换掉了提交

仔细看代码 4 的提交号，「rebase 的笔记」从 9201e00 变成了 68bf5ee，「补上 rebase 的冲突」从 0108cb1 变成了 cebe45e。原来的提交并没有消失，rebase 和第六章的 reset 一样，会把移动之前的位置记在 ORIG_HEAD 里：

```bash
git log --oneline ORIG_HEAD
# 0108cb1 补上 rebase 的冲突
# 9201e00 rebase 的笔记
# 67f3f36 (origin/main, origin/HEAD) 补上第十章
# e40485f 第一篇笔记
```

*代码 5：从 ORIG_HEAD 往回看，仍然是 rebase 之前的那两个提交。*

既然两组提交的内容一样，为什么提交号会不同呢？把父提交和两种时间都打印出来比较一下：

```bash
git log -2 --format='%h 父提交 %p 作者时间 %ad 提交时间 %cd' --date=format:%H:%M ORIG_HEAD
# 0108cb1 父提交 9201e00 作者时间 10:06 提交时间 10:06
# 9201e00 父提交 67f3f36 作者时间 10:03 提交时间 10:03

git log -2 --format='%h 父提交 %p 作者时间 %ad 提交时间 %cd' --date=format:%H:%M HEAD
# cebe45e 父提交 68bf5ee 作者时间 10:06 提交时间 10:08
# 68bf5ee 父提交 7f22180 作者时间 10:03 提交时间 10:08
```

*代码 6：`%p` 是父提交，`%ad` 是作者时间，`%cd` 是提交时间。*

第五章用 `git cat-file -p` 看过提交对象的内容，里面除了目录树和提交信息，还记录着父提交、作者和提交者，以及各自的时间。提交号就是根据这些内容计算出来的，只要其中有一项不同，提交号就不同。rebase 复制出来的 68bf5ee，父提交从 67f3f36 变成了 7f22180。作者时间保留了原来的 10:03，因为这个改动确实是那时候写的；但是提交时间变成了执行 rebase 的 10:08，因为这个新提交是在 10:08 才生成的。父提交变了，提交时间也变了，提交号自然就变了。cebe45e 的父提交又是新的 68bf5ee，所以它的提交号也跟着变了。

所以 rebase 并不是把原来的提交搬了过去，而是照着原来的提交复制了一组新的提交，再让分支指向新的这一组。这和第一章讲的 `git commit --amend` 是同一个道理，提交对象一旦生成就不能修改，所谓的修改都是生成新的提交来替换。旧的提交还留在仓库里，只是没有分支再指向它们。如果对 rebase 的结果不满意，那么可以像第六章那样执行 `git reset --hard ORIG_HEAD`，让分支回到 rebase 之前。

确认没有问题以后，就可以把 rebase-notes 合并进 main 了：

```bash
git switch main
git merge rebase-notes
# Updating 7f22180..cebe45e
# Fast-forward
#  rebase.md | 5 +++++
#  1 file changed, 5 insertions(+)
#  create mode 100644 rebase.md

git log --oneline --graph
# * cebe45e (HEAD -> main, rebase-notes) 补上 rebase 的冲突
# * 68bf5ee rebase 的笔记
# * 7f22180 补上 Pages 的笔记
# * 05f3930 补上 SSH 的笔记
# * 67f3f36 (origin/main, origin/HEAD) 补上第十章
# * e40485f 第一篇笔记
```

*代码 7：rebase-notes 已经接在 main 的最后，所以合并只需要快进。switch 的输出省略。*

和上一章先合并 main 再合并分支的结果相比，main 的历史里没有任何合并提交，每一个提交都是真正的改动。

## 四、合并过 main 的分支也能 rebase

如果一条分支已经像代码 2 那样合并过好几次 main，还能再 rebase 吗？在代码 2 的 rebase-notes 上执行同样的命令：

```bash
git rebase main
# Successfully rebased and updated refs/heads/rebase-notes.

git log --oneline --graph
# * e14e428 (HEAD -> rebase-notes) 补上 rebase 的冲突
# * 8c2ae48 rebase 的笔记
# * 7f22180 (main) 补上 Pages 的笔记
# * 05f3930 补上 SSH 的笔记
# * 67f3f36 (origin/main, origin/HEAD) 补上第十章
# * e40485f 第一篇笔记
```

*代码 8：两个合并提交都不见了，只剩下两个真正的提交，接在 main 的后面。*

按照第一步的规则，代码 2 里在 rebase-notes 上、但是不在 main 上的提交有四个，其中两个是合并提交。手册在 `--rebase-merges` 选项下面说明了默认的处理方式：

> By default, a rebase will simply drop merge commits from the todo list, and put the rebased commits into a single, linear branch.

也就是说，rebase 默认会丢掉合并提交，只复制普通的提交。这样做并不会丢失内容，因为合并提交带进来的是 main 上的改动，而 rebase 之后，这些改动本来就在新的基里面。所以 rebase 有两种用法。一种是不合并 main，需要同步的时候直接 rebase；另一种是平时照常合并 main，等到分支做完、准备合并进 main 之前，再 rebase 一次，把合并提交清理掉。

## 五、rebase 时的冲突

和 merge 一样，rebase 也会遇到冲突。下面新建一条 readme 分支，把 README.md 第 3 行改成「Git 第十、十一章：功能分支、fork 和 rebase」并提交。而 main 上也有一个提交，把同一行改成了「Git 第十章：功能分支、pull request 和 fork」：

```bash
git switch readme
git log --oneline --graph --all -4
# * 2dbc435 (main) README 补上 pull request
# | * 0366b98 (HEAD -> readme) README 加上第十一章
# |/
# * cebe45e (rebase-notes) 补上 rebase 的冲突
# * 68bf5ee rebase 的笔记

git rebase main
# Auto-merging README.md
# CONFLICT (content): Merge conflict in README.md
# error: could not apply 0366b98... README 加上第十一章
# hint: Resolve all conflicts manually, mark them as resolved with
# hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
# hint: You can instead skip this commit: run "git rebase --skip".
# hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
# Could not apply 0366b98... README 加上第十一章
```

*代码 9：退出码是 1。rebase 在应用 0366b98 时停了下来。*

提示里已经给出了三条路，解决冲突以后执行 `--continue`，跳过这个提交执行 `--skip`，放弃整个 rebase 执行 `--abort`。先看看 status 怎么说：

```bash
git status
# interactive rebase in progress; onto 2dbc435
# Last command done (1 command done):
#    pick 0366b98 README 加上第十一章
# No commands remaining.
# You are currently rebasing branch 'readme' on '2dbc435'.
#   (fix conflicts and then run "git rebase --continue")
#   (use "git rebase --skip" to skip this patch)
#   (use "git rebase --abort" to check out the original branch)
#
# Unmerged paths:
#   (use "git restore --staged <file>..." to unstage)
#   (use "git add <file>..." to mark resolution)
# 	both modified:   README.md
#
# no changes added to commit (use "git add" and/or "git commit -a")
```

*代码 10：命令里没有写 `-i`，status 的第一行却写着 interactive rebase。*

status 列出了已经执行的命令 `pick 0366b98`，以及还剩下几条没有执行。这说明 rebase 在内部是按照一张命令列表逐条处理提交的，每个要复制的提交对应一条 pick。第一行之所以写着 interactive rebase，是因为 git 2.34 的 rebase 默认就用这一套机制来执行。下一章的交互式 rebase，会把这张列表直接打开给人编辑。

再看冲突的文件：

```bash
cat README.md
# # 学习笔记
#
# <<<<<<< HEAD
# Git 第十章：功能分支、pull request 和 fork
# =======
# Git 第十、十一章：功能分支、fork 和 rebase
# >>>>>>> 0366b98 (README 加上第十一章)
```

*代码 11：HEAD 一侧是 main 上的版本，另一侧是 readme 上正在复制的那个提交。*

这里很容易看反。如果是在 readme 上执行 `git merge main`，那么 HEAD 一侧是 readme 自己的版本；但是在 rebase 时，HEAD 一侧却是 main 的版本。原因就在第二节说的第二步。rebase 先把分支移到了 main 所在的提交上，然后才开始复制提交，所以冲突发生时，HEAD 是已经接好的那部分，也就是 main。正在复制的 readme 的提交，反而成了另一侧。手册里专门说明了这一点：

> Because of this, when a merge conflict happens, the side reported as ours is the so-far rebased series, starting with `<upstream>`, and theirs is the working branch. In other words, the sides are swapped.

解决的办法和合并时一样。把这一行改成「Git 第十、十一章：功能分支、pull request、fork 和 rebase」，删掉冲突标记，然后用 git add 标记冲突已经解决。不同的地方在于最后一步，这里不是 git commit，而是 `git rebase --continue`：

```bash
git add README.md
git rebase --continue
# （编辑器里是原来的提交信息 README 加上第十一章，存盘退出）
# [detached HEAD 96d7a2f] README 加上第十一章
#  1 file changed, 1 insertion(+), 1 deletion(-)
# Successfully rebased and updated refs/heads/readme.
```

*代码 12：continue 会先打开编辑器，让人确认这个提交的提交信息，然后生成新的提交并继续往下复制。*

输出里的 detached HEAD 说明，rebase 的过程中 HEAD 一直处在第六章讲过的分离头指针状态。Git 在这个状态下逐个生成新提交，全部完成以后，才让 readme 指向最后一个新提交。这个例子只需要复制一个提交，所以只停了一次。如果分支上有好几个提交都和 main 冲突，那么 rebase 会在每一个冲突的提交上停一次，每次都要解决、add，然后 continue。如果中途发现情况不对，那么随时可以执行 `git rebase --abort`，分支和工作区都会回到 rebase 之前的样子。

## 六、不要 rebase 别人手里已有的提交

前面几节 rebase 的都是只在本地的提交。现在看看如果一条分支已经推送出去，而且合作者已经在上面工作了，再 rebase 会发生什么。下面仍然用裸仓库 `github/notes.git` 代替 GitHub，partner 目录扮演合作者。先在本地新建 rule-notes 分支，提交之后推送：

```bash
git switch -c rule-notes
git add rule.md
git commit -m "rebase 的规矩"
# [rule-notes 977fd7a] rebase 的规矩
#  1 file changed, 3 insertions(+)
#  create mode 100644 rule.md

git push -u origin rule-notes
```

*代码 13：推送的输出省略。*

合作者 fetch 之后切换到 rule-notes，在上面又提交了一次，还没有推送：

```bash
git switch rule-notes
# Branch 'rule-notes' set up to track remote branch 'rule-notes' from 'origin'.
# Switched to a new branch 'rule-notes'

git commit -am "补一个例子"
# [rule-notes 5fa2366] 补一个例子
#  1 file changed, 2 insertions(+)
```

*代码 14：这是合作者那一边，5fa2366 的父提交是 977fd7a。*

与此同时，本地的 main 上多了一个提交「补上 Gist 的笔记」，并且已经推送了。于是本地把 rule-notes 也 rebase 到 main 上，然后推送：

```bash
git rebase main
# Successfully rebased and updated refs/heads/rule-notes.

git push
# To ……/github/notes.git
#  ! [rejected]        rule-notes -> rule-notes (non-fast-forward)
# error: failed to push some refs to '……/github/notes.git'
# hint: Updates were rejected because the tip of your current branch is behind
# hint: its remote counterpart. Integrate the remote changes (e.g.
# hint: 'git pull ...') before pushing again.
# hint: See the 'Note about fast-forwards' in 'git push --help' for details.
```

*代码 15：退出码是 1。推送被拒绝了，原因是 non-fast-forward。*

rebase 之后，本地的 rule-notes 指向新复制出来的提交，而远程的 rule-notes 仍然指向 977fd7a。977fd7a 并不在新提交的历史里，如果让远程直接改指新提交，977fd7a 就会从远程的这条分支上消失，所以 Git 拒绝了这次推送。提示里建议先 pull，但是在 rebase 之后，这个建议恰恰不能照做。因为 pull 会把旧的 977fd7a 合并回来，rebase 就白做了，而且同一个改动还会在历史里出现两次。

如果确定要用新的提交替换远程的旧提交，那么就要强制推送：

```bash
git push --force-with-lease
# （打包和发送对象的几行，这里省略）
# To ……/github/notes.git
#  + 977fd7a...ee364f0 rule-notes -> rule-notes (forced update)
```

*代码 16：开头的加号和最后的 forced update 都表示这是一次强制更新，两个提交号之间是三个点，而不是快进时的两个点。*

强制推送有 `--force`（简写 `-f`）和 `--force-with-lease` 两种写法。`-f` 不管远程是什么情况，直接覆盖；而 `--force-with-lease` 会先检查远程的分支是否还在本地 origin/rule-notes 记录的位置。如果在本地上一次 fetch 之后，又有人往这条分支上推送了提交，那么它会拒绝推送，并且报告 `stale info`。这样就不会悄悄覆盖掉别人的提交。不过它比较的只是本地的那份记录，如果先 fetch 再推送，记录就已经是最新的了，它也就拦不住了。

本地的推送成功了，麻烦却留给了合作者。合作者照常执行 git pull：

```bash
git pull
# （接收对象的几行，这里省略）
# From ……/github/notes
#  + 977fd7a...ee364f0 rule-notes -> origin/rule-notes  (forced update)
#    96d7a2f..ece30c3  main       -> origin/main
# Auto-merging rule.md
# CONFLICT (add/add): Merge conflict in rule.md
# Automatic merge failed; fix conflicts and then commit the result.

cat rule.md
# # rebase 的规矩
#
# 不要 rebase 已经推送的提交
# <<<<<<< HEAD
#
# 例子：合作者已经在这条分支上提交了
# =======
# >>>>>>> ee364f044576cfce4367c776ae01956e52f4b1a0
```

*代码 17：合作者自己的改动和远程的新提交发生了冲突，冲突类型是 add/add。合作者的 pull.rebase 配置为 false。*

合作者明明只是在 rule.md 末尾加了两行，却遇到了冲突。这是因为在 Git 看来，合作者的 rule-notes 和新的 origin/rule-notes 是两条从 96d7a2f 分开的分支，两边都新建了 rule.md，内容又不一样，所以就成了 add/add 冲突。合作者保留自己的版本，add 之后提交，再看历史：

```bash
git log --oneline --graph -8
# *   83fc320 (HEAD -> rule-notes) Merge branch 'rule-notes' of ……/github/notes into rule-notes
# |\
# | * ee364f0 (origin/rule-notes) rebase 的规矩
# | * ece30c3 (origin/main, origin/HEAD) 补上 Gist 的笔记
# * | 5fa2366 补一个例子
# * | 977fd7a rebase 的规矩
# |/
# * 96d7a2f (main) README 加上第十一章
# * 2dbc435 README 补上 pull request
# * cebe45e 补上 rebase 的冲突
```

*代码 18：「rebase 的规矩」出现了两次，一次是旧的 977fd7a，一次是复制出来的 ee364f0。合并提交的信息里带着仓库的路径，所以 83fc320 只在这个实验的路径下成立。*

![合作者的历史里出现两份相同的提交](/img/posts/git-rebase/rewritten-shared-branch.svg)

*图 2：本地 rebase 换掉了 977fd7a，可是合作者的 5fa2366 是接在 977fd7a 上的，pull 之后两份「rebase 的规矩」都进了合作者的历史。*

如果合作者把这个结果推送上去，那么两份相同的提交就会一直留在这条分支的历史里。要想清理干净，合作者只能手动整理自己的历史。手册在 RECOVERING FROM UPSTREAM REBASE 一节的开头是这样说的：

> Rebasing (or any other form of rewriting) a branch that others have based work on is a bad idea: anyone downstream of it is forced to manually fix their history.

所以这条规矩可以说得更具体一些。rebase 只用在只有自己手里才有的提交上，比如还没有推送的提交，或者推送了、但是只有自己在用的功能分支。main 这类大家共用的分支，以及别人已经在上面工作的分支，都不要 rebase。如果一定要 rebase 一条已经推送过的分支，那么就要用 `--force-with-lease` 推送，并且提前告诉用这条分支的人。

## 七、`git pull --rebase`

第八章讲 pull 的时候留了一个问题。本地的 main 和远程的 main 都有新提交时，git 2.34 要求先用 `pull.rebase` 说明怎样合并，当时选择的是合并。现在可以看看另一种选择了。本地的 main 上提交了一次，合作者也往远程的 main 推送了「补上 stash 的笔记」：

```bash
git commit -am "补上 PR 的合并方式"
# [main a674676] 补上 PR 的合并方式
#  1 file changed, 2 insertions(+)

git pull --rebase
# （接收对象的几行，这里省略）
# From ……/github/notes
#    ece30c3..ca6d024  main       -> origin/main
# Successfully rebased and updated refs/heads/main.

git log --oneline --graph -4
# * e04c1b3 (HEAD -> main) 补上 PR 的合并方式
# * ca6d024 (origin/main, origin/HEAD) 补上 stash 的笔记
# * ece30c3 补上 Gist 的笔记
# * 96d7a2f (readme) README 加上第十一章
```

*代码 19：本地的提交从 a674676 变成了 e04c1b3，接在合作者的提交后面，没有生成合并提交。*

`git pull --rebase` 先执行 fetch，然后把本地分支 rebase 到它的上游 origin/main 上。如果用 `git pull` 合并，这里就会多出一个 `Merge branch 'main' of ……` 的合并提交，而它记录的只是「两个人碰巧同时提交了」这件事。用 rebase 则可以避免这种合并提交。

这样做并不违反上一节的规矩，因为被 rebase 的 a674676 还没有推送，只在本地才有，别人手里并没有它。如果想让不带参数的 pull 默认这样做，可以按照第八章代码 15 的提示执行 `git config pull.rebase true`。

## 小结

| 写法 | 作用和要点 |
| --- | --- |
| `git rebase main` | 把当前分支上、但是不在 main 上的提交，逐个复制到 main 的最后 |
| `git log main..HEAD` | 列出 rebase 要复制的那些提交，合并提交默认会被丢掉 |
| `ORIG_HEAD` | 记录 rebase 之前分支的位置，`git reset --hard ORIG_HEAD` 可以撤回 |
| 冲突里的 HEAD | rebase 时 HEAD 一侧是 main 的版本，和 merge 时正好相反 |
| `--continue` | git rebase 的选项，解决冲突并 add 之后继续，会先打开编辑器确认提交信息 |
| `--skip` | 跳过当前这个提交，它的改动不会出现在结果里 |
| `--abort` | 放弃整个 rebase，分支和工作区回到 rebase 之前 |
| `--force-with-lease` | git push 的选项，rebase 过的分支要用它强制推送；远程在上次 fetch 之后被别人更新过就拒绝 |
| `git pull --rebase` | fetch 之后把还没推送的本地提交 rebase 到上游上，不生成合并提交 |

merge 和 rebase 都能把 main 上的改动同步到功能分支上，区别在于怎样对待已有的提交。merge 不改动任何已有的提交，只是在最后多加一个合并提交，所以历史里会有分叉和合并提交。rebase 则照着分支上的提交复制出一组新的提交，接在 main 的最后，所以历史是一条直线，但是原来的提交被换掉了。正因为提交会被换掉，rebase 只适合用在只有自己手里才有的提交上。rebase 还有一种交互式的用法，可以在复制提交的同时修改、合并或者删除提交，这是下一章的内容。
