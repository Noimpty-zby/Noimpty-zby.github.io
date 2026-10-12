---
title: Git 第十二章：用 git rebase -i 整理还没推送的提交
date: 2026-10-12 21:22:00
description: Colt Steele《The Git & Github Bootcamp》交互式 rebase 那一章的复盘。git rebase -i HEAD~5 会把最近的 5 个提交按从旧到新的顺序列在编辑器里，HEAD~5 本身并不在列表中。每一行前面的命令决定这个提交怎样处理，pick 原样保留，reword 修改提交信息，edit 停下来修改提交的内容，squash 和 fixup 把这个提交并进上一行的提交，drop 删掉这个提交带来的改动。列表里第一个被改动的提交和它后面的提交都会换成新的提交号，排在它前面的提交则保持不变，所以交互式 rebase 和上一章一样，只用来整理还没有推送的提交。
categories:
  - [课外, AI Infra, Git]
tags:
  - rebase
  - 交互式 rebase
  - reword
  - fixup
  - squash
cover: /img/covers/Git-Chapter12-Interactive-Rebase.svg
series: Git
privacy: protected
sitemap: false
private_section: 课外
---

上一章的 rebase 把分支上的提交复制到 main 的后面，复制的时候，每一个提交都原样保留。但是在实际写代码的时候，分支上的提交往往不那么整齐。有的提交只改了一个错字，有的提交信息写错了，还有的只是为了临时调试才加进去的。如果这些提交原样合并进 main，那么以后翻看历史的人，就要在一堆零碎的提交里寻找真正的改动。

`git rebase -i` 是 rebase 的交互式用法，`-i` 是 `--interactive` 的缩写。它会先把要处理的提交列在编辑器里，让人逐个决定每一个提交怎样处理，可以原样保留，也可以修改提交信息、合并进别的提交，或者干脆删掉。这一章用一组故意写得很乱的提交，把这几种处理方式都试一遍。

<!-- more -->

## 一、`git rebase -i HEAD~5`：列出最近的 5 个提交

main 上有两个提交。从 main 新建一条 rebase-i 分支之后，上面先后提交了五次：

```bash
git log --oneline
# 1904d9b (HEAD -> rebase-i) fixup 和 drop
# f4dea5d pik 和 reword
# f4154c8 临时调试
# 0b61a0a 改个错字
# e1ee1ed 交互式 rebase 的笔记
# f79c075 (main) 补上第十一章
# d755640 第一篇笔记

ls
# README.md  debug.txt  rebase-i.md  rebase.md
```

*代码 1：最新的提交在最上面。debug.txt 是「临时调试」那个提交新建的文件。*

这五个提交里有三处想要整理。e1ee1ed 新建的 rebase-i.md 里把 rebase 拼成了 rebsae，紧接着的 0b61a0a 只是改正这个错字，所以它应该并进 e1ee1ed。f4154c8 新建的 debug.txt 是临时调试用的，不应该留在历史里。f4dea5d 的提交信息把 pick 写成了 pik，需要改正。要处理的提交里最早的是 e1ee1ed，它在 git log 里是从上往下数的第 5 个，所以执行 `git rebase -i HEAD~5`，Git 会打开编辑器：

```text
pick e1ee1ed 交互式 rebase 的笔记
pick 0b61a0a 改个错字
pick f4154c8 临时调试
pick f4dea5d pik 和 reword
pick 1904d9b fixup 和 drop

# Rebase f79c075..1904d9b onto f79c075 (5 commands)
#
# Commands:
# p, pick <commit> = use commit
# r, reword <commit> = use commit, but edit the commit message
# e, edit <commit> = use commit, but stop for amending
# s, squash <commit> = use commit, but meld into previous commit
# f, fixup [-C | -c] <commit> = like "squash" but keep only the previous
#                    commit's log message, unless -C is used, in which case
#                    keep only this commit's message; -c is same as -C but
#                    opens the editor
# x, exec <command> = run command (the rest of the line) using shell
# b, break = stop here (continue rebase later with 'git rebase --continue')
# d, drop <commit> = remove commit
# l, label <label> = label current HEAD with a name
# t, reset <label> = reset HEAD to a label
# m, merge [-C <commit> | -c <commit>] <label> [# <oneline>]
# .       create a merge commit using the original merge commit's
# .       message (or the oneline, if no original merge commit was
# .       specified); use -c <commit> to reword the commit message
#
# These lines can be re-ordered; they are executed from top to bottom.
#
# If you remove a line here THAT COMMIT WILL BE LOST.
#
# However, if you remove everything, the rebase will be aborted.
#
```

*代码 2：这个文件叫 git-rebase-todo，也就是上一章 git status 里提到的那张命令列表。*

`HEAD~5` 表示从 HEAD 往回数 5 个提交，也就是 f79c075。注释的第一行 `Rebase f79c075..1904d9b onto f79c075` 说明了这次 rebase 做的事，把 f79c075 之后的提交重新复制到 f79c075 上。所以交互式 rebase 也是一次 rebase，只是新的基和原来的基是同一个提交。列表里只有 f79c075 之后的 5 个提交，f79c075 本身并不在里面，因为它是基，不会被复制。

这张列表有一个很容易看错的地方，它的顺序和 git log 正好相反。git log 把最新的提交放在最上面，而这里第一行是最早的 e1ee1ed，最后一行才是最新的 1904d9b。注释里也写明了，列表是从上往下执行的，rebase 先复制第一行，再复制第二行，所以最早的提交当然要排在最前面。

每一行的格式是「命令 提交号 提交信息」。所有行默认都是 pick，如果一行都不改就存盘退出，那么每个提交都原样复制，提交号也都不会变。注释里列出的命令中，这一章用到的是前五个和 drop：

- pick：原样保留这个提交。
- reword：保留这个提交的改动，但是要修改提交信息。
- edit：保留这个提交，然后停下来，让人修改这个提交。
- squash：把这个提交并进上一行的提交，两个提交信息都交给人重新编辑。
- fixup：也是并进上一行的提交，但是只保留上一行的提交信息，这个提交的信息直接丢掉。
- drop：删掉这个提交，它带来的改动不会出现在结果里。

另外，删掉一整行的效果和 drop 一样，而调换两行的位置，就是调换这两个提交的顺序。

## 二、fixup、drop 和 reword 一次改完

按照前面的计划，把第 2 行改成 fixup，第 3 行改成 drop，第 4 行改成 reword，最后一行保持 pick：

```text
pick e1ee1ed 交互式 rebase 的笔记
fixup 0b61a0a 改个错字
drop f4154c8 临时调试
reword f4dea5d pik 和 reword
pick 1904d9b fixup 和 drop
```

*代码 3：只改每一行开头的命令，后面的提交号和提交信息不用动。注释可以保留，Git 会忽略它们。*

存盘退出之后，rebase 开始从上往下执行。执行到 reword 那一行时，Git 会再打开一次编辑器，里面是这个提交原来的提交信息：

```text
pik 和 reword

# Please enter the commit message for your changes. Lines starting
# with '#' will be ignored, and an empty message aborts the commit.
#
# Date:      Mon Oct 12 10:06:00 2026 +0800
#
# interactive rebase in progress; onto f79c075
# Last commands done (4 commands done):
#    drop f4154c8 临时调试
#    reword f4dea5d pik 和 reword
# Next command to do (1 remaining command):
#    pick 1904d9b fixup 和 drop
# （后面几行注释省略）
```

*代码 4：注释里列出了已经执行的命令和接下来的命令。*

把第一行的 pik 改成 pick，存盘退出，rebase 就会继续往下执行：

```bash
git rebase -i HEAD~5
# [detached HEAD 4b03475] pick 和 reword
#  Date: Mon Oct 12 10:06:00 2026 +0800
#  1 file changed, 3 insertions(+)
# Successfully rebased and updated refs/heads/rebase-i.
```

*代码 5：两次编辑器关闭之后，终端里留下的输出。中间那三行是 reword 生成新提交时打印的。*

```bash
git log --oneline
# fc76d7a (HEAD -> rebase-i) fixup 和 drop
# 4b03475 pick 和 reword
# 39e1f26 交互式 rebase 的笔记
# f79c075 (main) 补上第十一章
# d755640 第一篇笔记

ls
# README.md  rebase-i.md  rebase.md

cat rebase-i.md
# # 交互式 rebase
#
# git rebase -i HEAD~3 列出最近的 3 个提交
#
# pick：保留这个提交
# reword：保留这个提交，但是修改提交信息
# fixup：并进上一个提交，丢掉自己的提交信息
# drop：删掉这个提交
```

*代码 6：五个提交变成了三个，debug.txt 不见了，rebase-i.md 里的错字也已经改正了。*

![交互式 rebase 前后的提交对照](/img/posts/git-interactive-rebase/todo-to-result.svg)

*图 1：列表里的五行变成了三个新提交。0b61a0a 并进了上一行的 e1ee1ed，f4154c8 被删掉，f4dea5d 只换了提交信息。*

逐个来看这三个命令的效果。fixup 把「改个错字」并进了上一行的「交互式 rebase 的笔记」，生成的 39e1f26 里，rebase-i.md 一开始就是正确的拼写，提交信息则只保留了上一行的「交互式 rebase 的笔记」。drop 删掉了「临时调试」这个提交带来的改动，它带来的改动就是新建 debug.txt，所以 debug.txt 从工作区里消失了。需要注意的是，drop 删掉的是这个提交带来的改动，而不是某个文件的全部内容。如果这个提交只是给一个已有的文件加了一行，那么 drop 之后，只有这一行会消失，文件本身和其他提交写进去的内容都还在。reword 则只改了提交信息，4b03475 的改动和原来的 f4dea5d 完全相同。

再看提交号。三个新提交的提交号全都变了，原因和上一章一样，交互式 rebase 也是在复制提交。第一行的 e1ee1ed 虽然写的是 pick，但是因为第二行的 fixup 要并进它，它的内容变了，所以也要换成新的提交。而 main 上的 f79c075 不在列表里，所以没有变。更一般地说，列表里排在第一个改动之前的 pick 会原样保留，提交号不变；从第一个改动开始，后面的每一个提交都会换成新的提交号。

和上一章一样，rebase 之前的位置记在 ORIG_HEAD 里。如果对结果不满意，执行 `git reset --hard ORIG_HEAD` 就能让分支回到那五个旧提交上。

## 三、edit：停下来修改提交

reword 只能改提交信息，如果想改的是一个提交的内容，就要用 edit。比如「pick 和 reword」这个提交本来应该顺便把 README.md 里的进度改成第十二章，但是当时漏掉了。它是倒数第二个提交，所以执行 `git rebase -i HEAD~2`，把第一行的 pick 改成 edit：

```bash
git rebase -i HEAD~2
# （在编辑器里把 pick 4b03475 改成 edit 4b03475，存盘退出）
# Stopped at 4b03475...  pick 和 reword
# You can amend the commit now, with
#
#   git commit --amend
#
# Once you are satisfied with your changes, run
#
#   git rebase --continue
```

*代码 7：rebase 停在了 4b03475 上，后面的 fc76d7a 还没有执行。*

```bash
git status
# interactive rebase in progress; onto 39e1f26
# Last command done (1 command done):
#    edit 4b03475 pick 和 reword
# Next command to do (1 remaining command):
#    pick fc76d7a fixup 和 drop
#   (use "git rebase --edit-todo" to view and edit)
# You are currently editing a commit while rebasing branch 'rebase-i' on '39e1f26'.
#   (use "git commit --amend" to amend the current commit)
#   (use "git rebase --continue" once you are satisfied with your changes)
#
# nothing to commit, working tree clean
```

*代码 8：status 说明当前正在修改一个提交，还剩一条 pick 没有执行。*

这时 HEAD 就是要修改的那个提交，工作区里的文件也是那个提交时的样子。修改的办法是第一章讲过的 `git commit --amend`，它会用暂存区里的内容生成一个新的提交，替换掉 HEAD 上的这一个。把 README.md 第 3 行改成「Git 第十一、十二章：rebase 和交互式 rebase」，然后：

```bash
git add README.md
git commit --amend --no-edit
# [detached HEAD ba4350a] pick 和 reword
#  Date: Mon Oct 12 10:06:00 2026 +0800
#  2 files changed, 4 insertions(+), 1 deletion(-)

git rebase --continue
# Successfully rebased and updated refs/heads/rebase-i.

git log --oneline
# 9ba0487 (HEAD -> rebase-i) fixup 和 drop
# ba4350a pick 和 reword
# 39e1f26 交互式 rebase 的笔记
# f79c075 (main) 补上第十一章
# d755640 第一篇笔记

git show --stat --format=%s HEAD~1
# pick 和 reword
#
#  README.md   | 2 +-
#  rebase-i.md | 3 +++
#  2 files changed, 4 insertions(+), 1 deletion(-)
```

*代码 9：`--no-edit` 表示沿用原来的提交信息。修改之后，这个提交同时改了 README.md 和 rebase-i.md。*

continue 之后，rebase 接着执行剩下的 pick，把「fixup 和 drop」复制到修改过的 ba4350a 后面。这一次列表里只有两个提交，所以 39e1f26 没有受到影响，只有 4b03475 和它后面的 fc76d7a 换成了新的提交号。

## 四、squash：合并提交，重新写提交信息

fixup 合并提交时直接丢掉了后一个提交的信息，如果两个提交信息都有用，或者想给合并后的提交重新写一个信息，那么就用 squash。现在想把最后两个提交合成一个，于是执行 `git rebase -i HEAD~3`，把第 3 行「fixup 和 drop」前面的 pick 改成 squash。存盘退出之后，Git 会打开编辑器，里面是两个提交的信息：

```text
# This is a combination of 2 commits.
# This is the 1st commit message:

pick 和 reword

# This is the commit message #2:

fixup 和 drop

# Please enter the commit message for your changes. Lines starting
# with '#' will be ignored, and an empty message aborts the commit.
# （后面几行注释省略）
```

*代码 10：以 # 开头的行都会被忽略，所以如果什么都不改，新提交的信息就是这两段提交信息。*

把这几行换成一个新的提交信息「交互式 rebase 的几个命令」，存盘退出：

```bash
git rebase -i HEAD~3
# [detached HEAD a5cc4c3] 交互式 rebase 的几个命令
#  Date: Mon Oct 12 10:06:00 2026 +0800
#  2 files changed, 6 insertions(+), 1 deletion(-)
# Successfully rebased and updated refs/heads/rebase-i.

git log --oneline
# a5cc4c3 (HEAD -> rebase-i) 交互式 rebase 的几个命令
# 39e1f26 交互式 rebase 的笔记
# f79c075 (main) 补上第十一章
# d755640 第一篇笔记
```

*代码 11：列表里的第 1 行是 pick 39e1f26，它排在改动之前，所以提交号没有变。*

squash 和 fixup 都是并进上一行的提交，所以它们不能写在第一行。如果第一行就是 squash，rebase 会报错 `cannot 'squash' without a previous commit`，这时可以用 `git rebase --edit-todo` 改正列表再 continue，或者直接 `git rebase --abort`。

## 五、整理出错了怎么办

drop 删掉的是一个提交带来的改动，如果后面的提交是在这个改动的基础上写的，就会出问题。回到最初那五个提交，这一次把第一行的「交互式 rebase 的笔记」改成 drop：

```bash
git rebase -i HEAD~5
# （在编辑器里把第一行改成 drop e1ee1ed，存盘退出）
# CONFLICT (modify/delete): rebase-i.md deleted in HEAD and modified in 0b61a0a (改个错字).  Version 0b61a0a (改个错字) of rebase-i.md left in tree.
# error: could not apply 0b61a0a... 改个错字
# hint: Resolve all conflicts manually, mark them as resolved with
# hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
# hint: You can instead skip this commit: run "git rebase --skip".
# hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
# Could not apply 0b61a0a... 改个错字
```

*代码 12：退出码是 1。冲突的类型是 modify/delete，一边删除了文件，另一边修改了它。*

e1ee1ed 新建了 rebase-i.md，而下一行的 0b61a0a 修改的正是这个文件。drop 了 e1ee1ed 之后，rebase-i.md 就从来没有被创建过，于是 0b61a0a 的修改无处可落，Git 只好停下来让人决定。这种冲突和上一章的冲突一样，可以解决之后 add 再 continue。但是这里的问题出在列表本身，所以更合适的做法是放弃这一次 rebase：

```bash
git rebase --abort

git log --oneline -3
# 1904d9b (HEAD -> rebase-i) fixup 和 drop
# f4dea5d pik 和 reword
# f4154c8 临时调试
```

*代码 13：abort 之后，分支回到了 rebase 之前的 1904d9b，就像什么都没有发生过一样。*

所以出了问题时有两条退路。rebase 还没有结束的时候，用 `git rebase --abort` 放弃；已经结束了才发现不对，就用 `git reset --hard ORIG_HEAD` 回到 rebase 之前。不过 ORIG_HEAD 只记录最近一次 rebase、reset 或者合并之前的位置，所以发现问题之后要尽快撤回，不要先去执行别的命令。

## 六、只整理还没推送的提交

交互式 rebase 会把第一个改动之后的提交全部换成新的提交，这一点和上一章的 rebase 完全一样。所以上一章的规矩在这里同样适用，只能整理还没有推送、或者只有自己在用的提交。如果整理的是已经推送的提交，那么推送时同样会因为 non-fast-forward 被拒绝，强制推送之后，别人手里的旧提交也会和新提交同时出现。

比较常见的用法是在推送之前整理一遍。功能分支上的提交写完以后，先用 `git rebase -i` 把改错字、临时调试这类提交清理掉，再推送或者开 pull request。这样别人看到的历史里，每一个提交都是一个完整的改动。另外，HEAD~N 往回数到哪里也要留意。如果 N 数多了，列表里出现了已经推送的提交，那么只要这些行保持 pick，并且排在第一个改动之前，它们就不会被换掉。

## 小结

| 写法 | 作用和要点 |
| --- | --- |
| `git rebase -i HEAD~N` | 列出最近的 N 个提交，HEAD~N 本身是基，不在列表里 |
| 列表的顺序 | 从旧到新，和 git log 相反，从上往下执行 |
| pick | 原样保留，排在第一个改动之前的提交号不变 |
| reword | 保留改动，执行到这一行时打开编辑器修改提交信息 |
| edit | 复制完这个提交就停下，用 `git commit --amend` 修改，改完再执行 continue |
| squash | 并进上一行的提交，两个提交信息都交给编辑器重新写 |
| fixup | 并进上一行的提交，只保留上一行的提交信息 |
| drop | 删掉这个提交带来的改动，删掉整行也一样 |
| `--abort` | git rebase 的选项，rebase 进行到一半时放弃，回到开始之前 |
| `ORIG_HEAD` | rebase 已经结束之后，用 `git reset --hard ORIG_HEAD` 撤回 |

交互式 rebase 把 rebase 内部的那张命令列表交给人来编辑，每一行对应一个要复制的提交，每一个命令决定这个提交怎样复制。pick 原样复制，reword 和 edit 复制的同时修改，squash 和 fixup 把两个提交复制成一个，drop 则跳过不复制。因为结果是一组新的提交，所以它和上一章的 rebase 一样，只适合整理还没有推送的提交。
