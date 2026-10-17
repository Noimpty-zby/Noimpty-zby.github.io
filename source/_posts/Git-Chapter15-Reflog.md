---
title: Git 第十五章：用 reflog 找回被 reset 和 rebase 丢掉的提交
date: 2026-10-17 17:14:00
description: Colt Steele《The Git & Github Bootcamp》reflog 那一章的复盘。reflog 保存在 .git/logs 目录里，HEAD 和每个分支各有一个文件，引用每变化一次，文件末尾就多一行，记下变化前后的提交号、时间和原因。git log 顺着 parent 列出项目的历史，git reflog 则按时间列出 HEAD 在这台电脑上先后指向过哪些提交，连切换分支也会记下来。HEAD@{n}、main@{n} 表示这个引用往前数第 n 次的位置，大括号里也可以写 yesterday、2.days.ago 这样的时间，它们都可以直接用在 git show、git diff、git checkout 和 git reset 里。连续 reset 了两次、或者 fixup 之后后悔了，都可以从分支的 reflog 里找到原来的位置，再用 git reset --hard 回去。reflog 只在本地，不会随着克隆和推送传给别人，删除分支时它的 reflog 也一起删除，而且默认只保留 90 天，已经不在当前分支上的记录只保留 30 天。
categories:
  - [课外, AI Infra, Git]
tags:
  - reflog
  - git reflog
  - 找回提交
  - 撤回 rebase
  - git gc
cover: /img/covers/Git-Chapter15-Reflog.svg
series: Git
privacy: protected
sitemap: false
private_section: 课外
---

前面几章已经好几次用到过 reflog。第二章说过，删错了分支也可以从 git reflog 里找回提交号；第五章的 `stash@{n}` 其实就是 refs/stash 的 reflog；第六章执行 reset 之后，也是靠 git reflog 看到被撤销的两个提交还在。不过那几次都只是顺带用了一下，这一章专门来讲 reflog，看看它保存在哪里、记下了什么，怎样按次数和按时间取出以前的位置，以及怎样用它撤回一次 reset 和一次 rebase。

上一章把 .git 目录走了一遍，其中的 logs 目录只提到了名字，并没有打开来看，而 reflog 就保存在这个目录里。

<!-- more -->

## 一、reflog 保存在 .git/logs 里

这一章用一个小项目 minicalc 来演示，它只有 README.md 和 ops.py 两个文件。ops.py 里是计算器的函数，前三个提交依次加上了加法和减法、乘法和除法：

```bash
git log --oneline
# f2b62ca 除法
# 2c2724c 乘法
# 748c2ea 加法和减法

find .git/logs -type f
# .git/logs/HEAD
# .git/logs/refs/heads/main
```

*代码 1：三个提交的时间依次是 10 月 15 日 20:00、20:30 和 10 月 16 日 21:00，第四节按时间查找时会用到。*

reflog 是 reference logs 的简称，意思是**引用日志**，也就是分支、HEAD 这些引用的变化记录。logs 里的文件是按照引用的名字来存放的。.git/logs/HEAD 记录 HEAD 的变化，.git/logs/refs/heads/main 记录 main 这个分支的变化，以后每新建一个分支，refs/heads 下面就会多出一个同名的文件。打开 main 的这个文件看一看：

```bash
cat .git/logs/refs/heads/main
# 0000000000000000000000000000000000000000 748c2ea3c905a42908de7c63320493765369d06d Noimpty-zby <45208586@qq.com> 1792065600 +0800	commit (initial): 加法和减法
# 748c2ea3c905a42908de7c63320493765369d06d 2c2724c81bb70fc36784742ee38a8472e16299e2 Noimpty-zby <45208586@qq.com> 1792067400 +0800	commit: 乘法
# 2c2724c81bb70fc36784742ee38a8472e16299e2 f2b62ca122529b5264cb4d67c42d24c55cd7f422 Noimpty-zby <45208586@qq.com> 1792155600 +0800	commit: 除法
```

*代码 2：每一行都比较长，要左右滚动才能看全。第一行开头的 40 个 0 表示在这之前 main 还不存在。*

每一行记录了 main 的一次变化，依次是变化之前的提交号、变化之后的提交号、执行操作的人和时间，最后是用制表符隔开的一段说明。时间的写法和上一章的提交对象一样，是从 1970 年开始计算的秒数，所以 1792065600 就是 10 月 15 日 20:00。说明里冒号前面的是操作的类型，后面是这次操作的内容，比如提交的时候写的就是提交信息。新的记录总是追加在文件的末尾，因此这个文件从上往下是从旧到新的顺序。

上一章代码 2 里的 .git/config 有一项 `logallrefupdates = true`，打开 reflog 的就是这一项。有了它，HEAD、本地分支和远程跟踪分支每变化一次，Git 都会在 logs 里对应的文件末尾追加一行。带工作区的仓库默认打开这一项，而裸仓库默认是关闭的，所以用 git init --bare 创建的仓库不会记录 reflog。

接下来新建一个 docs 分支，在上面给 README.md 写上用法，提交之后再切换回 main：

```bash
git switch -c docs
# Switched to a new branch 'docs'

git commit -am "README 写上用法"
# [docs a48468c] README 写上用法
#  1 file changed, 4 insertions(+)

git switch main
# Switched to branch 'main'
```

*代码 3：修改 README.md 的步骤省略。*

这时再看 logs 目录，就多出了 docs 自己的文件，而 HEAD 的文件末尾多了三行。cut -f2 只取出每一行制表符后面的说明，这是第五章看 refs/stash 时用过的写法：

```bash
find .git/logs -type f
# .git/logs/HEAD
# .git/logs/refs/heads/docs
# .git/logs/refs/heads/main

tail -n 3 .git/logs/HEAD | cut -f2
# checkout: moving from main to docs
# commit: README 写上用法
# checkout: moving from docs to main
```

*代码 4：tail -n 3 取出文件的最后三行。*

新增的三行里，中间一行是在 docs 上的提交，另外两行是切换分支，HEAD 先从 main 换到了 docs，然后又换回了 main。虽然这里用的是 git switch，但是 reflog 里记下的类型仍然是 checkout，两条命令切换分支时写下的说明是一样的。

而 main 的文件没有任何变化，因为这段时间里 main 一直指向 f2b62ca，变化的只有 HEAD。也就是说，分支的 reflog 只记录这个分支自己的移动，而 HEAD 的 reflog 除了记下每一次提交，还会记下每一次切换。所以想找回什么东西的时候，HEAD 的 reflog 是最全的。

## 二、git reflog 和 git log 有什么不同

直接读 logs 里的文件不太方便，平时都用 git reflog 来查看。它的完整写法是 `git reflog show <引用>`，如果不写引用，那么查看的就是 HEAD：

```bash
git reflog
# f2b62ca HEAD@{0}: checkout: moving from docs to main
# a48468c HEAD@{1}: commit: README 写上用法
# f2b62ca HEAD@{2}: checkout: moving from main to docs
# f2b62ca HEAD@{3}: commit: 除法
# 2c2724c HEAD@{4}: commit: 乘法
# 748c2ea HEAD@{5}: commit (initial): 加法和减法

git reflog show main
# f2b62ca main@{0}: commit: 除法
# 2c2724c main@{1}: commit: 乘法
# 748c2ea main@{2}: commit (initial): 加法和减法
```

*代码 5：git reflog 和 git reflog show HEAD 的输出完全相同。*

和文件里的顺序相反，git reflog 把最新的一行放在最上面。每一行依次是变化之后的提交号、这一行的名字和说明。HEAD@{0} 是 HEAD 现在的位置，HEAD@{1} 是 HEAD 上一次所在的位置，再往下就依次往前推。

把它和代码 1 的 git log 对比一下，可以发现两处不同。一是 a48468c 出现在了 reflog 里，但是不在 git log 里；二是 f2b62ca 在 reflog 里出现了三次。这是因为两条命令看的是两样不同的东西。git log 从当前的提交出发，顺着每个提交里记录的 parent 往回走，列出的是这条历史上的每一个提交，所以 docs 分支上的 a48468c 不会出现。git reflog 则不管提交之间的关系，它只是按照时间顺序，列出 HEAD 先后指向过哪些提交，同一个提交被指向过几次，就会出现几次。

所以 reflog 的行数也不一定比 git log 多。比如第七章克隆过的 octocat/Hello-World，克隆下来之后 git log 能看到三个提交，reflog 却只有一行：

```bash
git clone https://github.com/octocat/Hello-World
cd Hello-World

git log --oneline
# 7fd1a60 Merge pull request #6 from Spaceghost/patch-1
# 7629413 New line at end of file. --Signed off by Spaceghost
# 553c207 first commit

git reflog
# 7fd1a60 HEAD@{0}: clone: from https://github.com/octocat/Hello-World
```

*代码 6：git clone 的输出省略。*

这三个提交都是别人在 GitHub 上做的，而在这台电脑上，HEAD 只变化过一次，就是克隆的那一次。也就是说，git log 记录的是项目的历史，不管是谁提交的都会列出来；reflog 记录的则是这个仓库里 HEAD 的移动，只和在这台电脑上执行过的操作有关。

## 三、用 HEAD@{n} 指定以前的位置

reflog 每一行里的 HEAD@{n}、main@{n} 不只是一个序号，它们本身就是提交的名字，可以像分支名和提交号一样用在 git show、git diff、git checkout 这些命令里。写法是 `<引用>@{<n>}`，意思是这个引用往前数第 n 次的位置：

```bash
git show -s --oneline HEAD@{1}
# a48468c README 写上用法

git show -s --oneline main@{1}
# 2c2724c 乘法

git show -s --oneline @{1}
# 2c2724c 乘法
```

*代码 7：-s 让 git show 只显示提交本身，不显示改动。*

HEAD@{1} 和 main@{1} 指向的是两个不同的提交。HEAD 上一次的位置是在 docs 上提交的 a48468c，而 main 上一次的位置是乘法那个提交 2c2724c，因为 HEAD 的 reflog 和 main 的 reflog 是两本不同的记录。如果 @ 前面不写引用，那么表示的是当前所在的分支。现在在 main 上，所以 @{1} 和 main@{1} 相同，而不是 HEAD@{1}。

git diff 可以比较两个以前的位置。比如 main@{2} 和 main@{1} 分别是 main 在乘法这个提交之前和之后的位置，所以它们之间的差别就是乘法带来的改动：

```bash
git diff main@{2} main@{1}
# diff --git a/ops.py b/ops.py
# index 4c2d043..b7666fb 100644
# --- a/ops.py
# +++ b/ops.py
# @@ -4,3 +4,7 @@ def add(a, b):
#
#  def sub(a, b):
#      return a - b
# +
# +
# +def mul(a, b):
# +    return a * b
```

*代码 8：旧的位置写在前面，新的位置写在后面，增加的行前面就是加号。*

git checkout 也可以切换到以前的某个位置。因为 HEAD@{1} 表示的是一个提交，而不是一个分支，所以这时会进入第二章讲过的分离头指针状态：

```bash
git checkout HEAD@{1}
# Note: switching to 'HEAD@{1}'.
# ……（关于分离头指针的提示省略）
# HEAD is now at a48468c README 写上用法

git switch main
# Previous HEAD position was a48468c README 写上用法
# Switched to branch 'main'

git reflog -3
# f2b62ca HEAD@{0}: checkout: moving from a48468ca31980c3f4dca25e7befa2f895555a6cc to main
# a48468c HEAD@{1}: checkout: moving from main to HEAD@{1}
# f2b62ca HEAD@{2}: checkout: moving from docs to main
```

*代码 9：-3 只显示最新的三行。说明里记下的是命令里写的参数，所以第二行写的是 HEAD@{1}，而不是提交号。*

这两次切换同样写进了 HEAD 的 reflog，于是原来的每一行都往下挪了两位，代码 5 里的 HEAD@{2} 现在变成了 HEAD@{4}。现在的 HEAD@{1} 虽然碰巧还是 a48468c，但是它已经是另一行记录了。这和第五章的 `stash@{n}` 是同一个道理，n 表示的是往前数第几次，而 HEAD 每移动一次，旧记录的序号就都要加一。所以用 HEAD@{n} 之前，最好先执行一次 git reflog，看清楚当前的序号，而不是照搬之前记下的数字。

## 四、按时间查看以前的位置

除了按次数往前数，大括号里还可以写一个时间，表示这个引用在那个时刻指向哪里。因为 git reflog show 其实是 `git log -g --abbrev-commit --pretty=oneline` 的简写，所以它可以使用 git log 的所有选项。其中 -g 让 git log 沿着 reflog 一行一行地往前走，而不是顺着 parent 走。加上 `--date=iso`，就可以看到每一行记录的时间：

```bash
git reflog --date=iso
# f2b62ca HEAD@{2026-10-17 10:25:00 +0800}: checkout: moving from a48468ca31980c3f4dca25e7befa2f895555a6cc to main
# a48468c HEAD@{2026-10-17 10:20:00 +0800}: checkout: moving from main to HEAD@{1}
# f2b62ca HEAD@{2026-10-17 10:15:00 +0800}: checkout: moving from docs to main
# a48468c HEAD@{2026-10-17 10:10:00 +0800}: commit: README 写上用法
# f2b62ca HEAD@{2026-10-17 10:00:00 +0800}: checkout: moving from main to docs
# f2b62ca HEAD@{2026-10-16 21:00:00 +0800}: commit: 除法
# 2c2724c HEAD@{2026-10-15 20:30:00 +0800}: commit: 乘法
# 748c2ea HEAD@{2026-10-15 20:00:00 +0800}: commit (initial): 加法和减法
```

*代码 10：大括号里的序号换成了这一行的时间。如果写成 --date=relative，那么显示的就是 5 hours ago 这样的相对时间。*

假设现在是 10 月 17 日下午 3 点，那么 HEAD@{yesterday} 指的是 24 小时之前，也就是 10 月 16 日下午 3 点 HEAD 所在的位置。从代码 10 可以看出，那时最新的一条记录还是 10 月 15 日 20:30 的乘法，除法要到 10 月 16 日晚上 9 点才提交，所以 HEAD@{yesterday} 就是乘法这个提交。用 git diff 比较它和现在的 HEAD，就能看到从昨天到现在多了哪些改动：

```bash
git diff HEAD@{yesterday} HEAD
# diff --git a/ops.py b/ops.py
# index b7666fb..9e69890 100644
# --- a/ops.py
# +++ b/ops.py
# @@ -8,3 +8,7 @@ def sub(a, b):
#
#  def mul(a, b):
#      return a * b
# +
# +
# +def div(a, b):
# +    return a / b
```

*代码 11：如果把两个参数的顺序反过来，写成 git diff HEAD HEAD@{yesterday}，那么这四行前面就都变成减号。*

这里比较的是两个时刻 HEAD 所在的位置，所以 docs 上的 a48468c 虽然是今天提交的，但是现在的 HEAD 已经回到了 main 上，它带来的改动就不会出现在这里。git reflog show 后面同样可以加上一个时间，这样就会从那个时刻开始往前列出记录，而且每一行大括号里显示的也是时间：

```bash
git reflog show main@{yesterday}
# 2c2724c main@{Thu Oct 15 20:30:00 2026 +0800}: commit: 乘法
# 748c2ea main@{Thu Oct 15 20:00:00 2026 +0800}: commit (initial): 加法和减法
```

*代码 12：10 月 16 日下午 3 点之后的记录没有列出来。*

时间的写法比较自由，yesterday、2.days.ago、one.minute.ago、`1.week.ago` 都可以，其中的点是用来代替空格的。如果想直接写空格，或者写一个具体的日期和时间，那么要用引号把整个参数括起来，否则 Shell 会把它拆成几个参数。另外，大括号前面的 @ 不能省略，写成 HEAD{2.days.ago} 的话，Git 会把它当成一个不存在的名字，报 unknown revision 的错误：

```bash
git show -s --oneline 'HEAD@{5 hours ago}'
# f2b62ca 除法

git show -s --oneline 'HEAD@{2026-10-16 22:00}'
# f2b62ca 除法

git show -s --oneline HEAD{2.days.ago}
# fatal: ambiguous argument 'HEAD{2.days.ago}': unknown revision or path not in the working tree.
# Use '--' to separate paths from revisions, like this:
# 'git <command> [<revision>...] -- [<file>...]'
```

*代码 13：最后一条命令的退出码是 128。*

如果要查的时间比最早的一条记录还早，那么 Git 会先给出一个警告。这时 git show 会退回到最早的那一条记录，而 git reflog show 除了警告什么也不列出：

```bash
git show -s --oneline HEAD@{2.days.ago}
# warning: log for 'HEAD' only goes back to Thu, 15 Oct 2026 20:00:00 +0800
# 748c2ea 加法和减法

git reflog show HEAD@{2.days.ago}
# warning: log for 'HEAD' only goes back to Thu, 15 Oct 2026 20:00:00 +0800
```

*代码 14：两天之前是 10 月 15 日下午 3 点，比第一个提交还早了 5 个小时。*

需要注意的是，HEAD@{yesterday} 查的是昨天这个时候 HEAD 在本地指向哪里，而不是昨天做了哪些提交，这两者常常不一样。比如今天刚克隆下来的 Hello-World，代码 6 的三个提交都是很多年以前的，但是它的 reflog 是从今天克隆的时候才开始记录的，所以 HEAD@{yesterday} 只会得到一个警告。如果想找某段时间里做的提交，那么应该用 git log 的 `--since` 和 `--until`，手册里也专门提醒了这一点。

## 五、找回被 reset --hard 撤销的提交

下午 3 点半，打算把除法重新写一遍，于是想用 git reset --hard HEAD~1 撤掉除法这个提交。结果多按了一次回车，同样的命令执行了两次：

```bash
git reset --hard HEAD~1
# HEAD is now at 2c2724c 乘法

git reset --hard HEAD~1
# HEAD is now at 748c2ea 加法和减法

git log --oneline
# 748c2ea 加法和减法
```

*代码 15：第二次 reset 把乘法也撤掉了。*

第六章讲过，reset 会把移动之前的位置记在 ORIG_HEAD 里，拨错了可以用它拨回来。但是 ORIG_HEAD 只有一个，第二次 reset 的时候，它已经被改成了第二次移动之前的位置，所以现在用 ORIG_HEAD 只能回到乘法：

```bash
git show -s --oneline ORIG_HEAD
# 2c2724c 乘法
```

*代码 16：ORIG_HEAD 只记录最近一次 reset、rebase 或者合并之前的位置。*

这时就要用到 reflog 了。main 的 reflog 把两次 reset 都记了下来：

```bash
git reflog show main
# 748c2ea main@{0}: reset: moving to HEAD~1
# 2c2724c main@{1}: reset: moving to HEAD~1
# f2b62ca main@{2}: commit: 除法
# 2c2724c main@{3}: commit: 乘法
# 748c2ea main@{4}: commit (initial): 加法和减法
```

*代码 17：最上面两行是两次 reset，第三行是 reset 之前 main 的位置。*

main@{0} 是 main 现在的位置，main@{1} 是第一次 reset 之后的位置，也就是 ORIG_HEAD 记着的乘法，而 main@{2} 是两次 reset 之前的位置，也就是除法这个提交。

![两次 reset 之后的 main、ORIG_HEAD 和 main@{2}](/img/posts/git-reflog/reset-twice.svg)

*图 1：两次 reset 只是把 main 往回拨了两步，三个提交都还在仓库里。ORIG_HEAD 只能找到乘法，main 的 reflog 则记着每一步之前的位置。*

第六章说过，reset 撤销提交的时候只是移动了分支，提交本身还留在仓库里。所以只要把 main 移回 main@{2}，三个提交就全部回来了：

```bash
git reset --hard main@{2}
# HEAD is now at f2b62ca 除法

git log --oneline
# f2b62ca 除法
# 2c2724c 乘法
# 748c2ea 加法和减法
```

*代码 18：写成 git reset --hard f2b62ca 的效果完全相同。*

如果还记得提交号，那么直接写提交号也可以，reflog 的作用就是在不记得提交号的时候，帮忙把它找出来。这一次 reset 本身也会写进 reflog，成为 main@{0}，所以即使这次又拨错了，也同样可以再拨回去。不过 reflog 只记录引用的移动，并不会保存工作区里的文件，所以第六章说的那种情况，也就是 --hard 抹掉了还没有提交的改动，reflog 也没有办法找回来。

## 六、撤回一次交互式 rebase

下午 4 点，给除法加上了检查除数的代码，接着补上了测试，然后发现测试里把 div 拼成了 dvi，于是又提交了一次：

```bash
git log --oneline
# f74976d 修正测试里拼错的函数名
# 9db7669 补上除法的测试
# fe90721 除法检查除数是否为 0
# f2b62ca 除法
# 2c2724c 乘法
# 748c2ea 加法和减法
```

*代码 19：修改文件和提交的步骤省略。*

后两个提交都只是在修补第一个，所以用第十二章的交互式 rebase 把它们 fixup 进第一个提交。执行 git rebase -i HEAD~3 之后，在编辑器里把后两行的 pick 改成 fixup：

```text
pick fe90721 除法检查除数是否为 0
fixup 9db7669 补上除法的测试
fixup f74976d 修正测试里拼错的函数名
```

*代码 20：待办列表下面那些以 # 开头的说明省略。*

保存并关闭编辑器之后，三个提交就合并成了一个：

```bash
git rebase -i HEAD~3
# Successfully rebased and updated refs/heads/main.

git log --oneline
# 1d1f924 除法检查除数是否为 0
# f2b62ca 除法
# 2c2724c 乘法
# 748c2ea 加法和减法

git show --stat --oneline HEAD
# 1d1f924 除法检查除数是否为 0
#  ops.py      | 2 ++
#  test_ops.py | 6 ++++++
#  2 files changed, 8 insertions(+)
```

*代码 21：新的提交 1d1f924 包含了原来三个提交的全部改动，提交信息只保留了第一个提交的。*

但是做完之后又觉得，测试还是作为一个单独的提交更清楚，想回到 rebase 之前的样子。这时 git log 里已经看不到原来的三个提交了，不过 main 的 reflog 里还有：

```bash
git reflog show main -4
# 1d1f924 main@{0}: rebase (finish): refs/heads/main onto f2b62ca122529b5264cb4d67c42d24c55cd7f422
# f74976d main@{1}: commit: 修正测试里拼错的函数名
# 9db7669 main@{2}: commit: 补上除法的测试
# fe90721 main@{3}: commit: 除法检查除数是否为 0
```

*代码 22：整个 rebase 在 main 的 reflog 里只占了一行。*

整个 rebase 在 main 的 reflog 里只有一行，这是因为 rebase 进行的过程中，HEAD 处在分离状态，Git 是在分离的 HEAD 上逐个生成新提交的，直到最后一步才把 main 移到新的提交上。所以 main@{1} 就是 rebase 之前 main 的位置 f74976d，从它顺着 parent 往回走，就是原来的那三个提交。

![rebase 之后的 main@{0} 和 main@{1}](/img/posts/git-reflog/rebase-undo.svg)

*图 2：fixup 生成了新的提交 1d1f924，原来的三个提交仍然在仓库里，main@{1} 指着它们中的最后一个。rebase 过程中的中间结果 088de7e 没有画出来。*

HEAD 的 reflog 则把 rebase 的每一步都记了下来：

```bash
git reflog -6
# 1d1f924 HEAD@{0}: rebase (finish): returning to refs/heads/main
# 1d1f924 HEAD@{1}: rebase (fixup): 除法检查除数是否为 0
# 088de7e HEAD@{2}: rebase (fixup): # This is a combination of 2 commits.
# fe90721 HEAD@{3}: rebase (start): checkout HEAD~3
# f74976d HEAD@{4}: commit: 修正测试里拼错的函数名
# 9db7669 HEAD@{5}: commit: 补上除法的测试
```

*代码 23：从下往上读，就是 rebase 执行的顺序。*

rebase (start) 这一行的说明虽然写的是 checkout HEAD~3，但是 HEAD 实际移到的是 fe90721。这是因为待办列表的第一行是 pick，而且它前面没有任何改动，第十二章讲过，这样的提交会原样保留，所以 Git 直接从 fe90721 开始往后执行。接下来的两次 fixup 各生成了一个提交，第一次得到的 088de7e 只是中间结果，它的提交信息还是 Git 临时拼出来的 This is a combination of 2 commits，第二次 fixup 之后才得到最终的 1d1f924。

知道了 rebase 之前的位置，撤回的方法就和上一节一样：

```bash
git reset --hard main@{1}
# HEAD is now at f74976d 修正测试里拼错的函数名

git log --oneline
# f74976d 修正测试里拼错的函数名
# 9db7669 补上除法的测试
# fe90721 除法检查除数是否为 0
# f2b62ca 除法
# 2c2724c 乘法
# 748c2ea 加法和减法
```

*代码 24：三个提交的提交号和代码 19 完全相同，说明回来的就是原来的那三个提交。*

第十二章撤回 rebase 时用的是 git reset --hard ORIG_HEAD，这里用 ORIG_HEAD 同样可以。但是和上一节一样，ORIG_HEAD 只记着最近一次，如果 rebase 之后又执行过 reset 或者合并，它就已经被改掉了。而 reflog 会把每一次移动都保留下来，即使过了几天才发现问题，也可以从中找到 rebase 之前的位置。

## 七、reflog 只在本地，而且会过期

reflog 只记录本地仓库里引用的变化。代码 6 里克隆下来的仓库只有一行 reflog，说明 reflog 不会随着克隆传过来；反过来，git push 也只会把提交和分支推送出去，reflog 始终留在本地。下面把 minicalc 推送到一个代替 GitHub 的裸仓库上：

```bash
git remote add origin ../github/minicalc.git
git push -u origin main
# （推送的输出省略）

find .git/logs -type f
# .git/logs/HEAD
# .git/logs/refs/remotes/origin/main
# .git/logs/refs/heads/docs
# .git/logs/refs/heads/main

ls ../github/minicalc.git
# HEAD  branches  config  description  hooks  info  objects  refs
```

*代码 25：裸仓库是用 git init --bare 创建的。*

推送之后，本地多了远程跟踪分支 origin/main 的 reflog，而裸仓库里根本没有 logs 这个目录，因为第一节说过，裸仓库默认不记录 reflog。所以合作者在他们电脑上执行过的操作，不会出现在自己的 reflog 里，自己的 reflog 别人也看不到。如果一个提交从来没有推送过，又在本地被 reset 掉了，那么能找回它的就只有这台电脑上的 reflog。

删除分支的时候，这个分支自己的 reflog 也会一起被删除。docs 分支已经不打算合并了，删掉之后，logs 里 docs 的文件也就没有了，这时再执行 git reflog show docs 就会报错。不过 HEAD 的 reflog 里还记着在 docs 上做过的提交，第二章找回误删的分支，靠的就是这一行：

```bash
git branch -D docs
# Deleted branch docs (was a48468c).

ls .git/logs/refs/heads
# main

git reflog show docs
# fatal: ambiguous argument 'docs': unknown revision or path not in the working tree.
# Use '--' to separate paths from revisions, like this:
# 'git <command> [<revision>...] -- [<file>...]'

git reflog | grep README
# a48468c HEAD@{14}: commit: README 写上用法
```

*代码 26：如果想把分支找回来，那么执行 git branch docs a48468c 就可以了。*

另外，reflog 也不会永远保留下去。git gc 在清理仓库的时候，会顺带执行 git reflog expire，删掉过期的记录。默认情况下，90 天以前的记录会被删掉；如果一条记录的提交已经不在当前分支的历史上，比如被 reset 撤销的提交、rebase 之前的旧提交，那么 30 天以后就会被删掉。这两个期限分别由 gc.reflogExpire 和 gc.reflogExpireUnreachable 这两项配置决定。对于后一项，手册的解释是，这类记录通常来自 git commit --amend 和 git rebase，它们指向的是修改之前的旧提交，已经不属于项目现在的历史，所以过期得更早一些。

第六章和第十一章都说过，没有分支指向的提交仍然留在仓库里。git gc 在删除对象之前，除了分支和标签，也会检查 reflog 里有没有记着它，所以在 reflog 过期之前，这些提交都不会被删掉。一旦记录过期，这些提交就失去了最后一个引用，git gc 就会把它们从 objects 里删掉。下面用两个参数让清理立刻生效，看一看会发生什么：

```bash
git cat-file -t a48468c
# commit

git reflog expire --expire-unreachable=now --all
git gc --prune=now
# （git gc 的输出省略）

git cat-file -t a48468c
# fatal: Not a valid object name a48468c
```

*代码 27：这两条命令只是为了演示，平时不需要手动执行。--expire-unreachable=now 让不在当前分支上的记录立刻过期，--prune=now 则让 git gc 立刻删掉没有引用的对象，默认要等两周。*

docs 分支删掉之后，a48468c 只剩下 HEAD 的 reflog 还记着它。这条记录被清掉之后，git gc 就把这个提交删掉了，这时再想用第二章的方法找回 docs 分支，就已经找不到了。所以误操作之后最好尽快把提交找回来，不要等到一两个月以后。

## 小结

| 写法 | 作用和要点 |
| --- | --- |
| `.git/logs/` | reflog 所在的目录 |
| `reflog` | 查看 HEAD 的记录 |
| `reflog show` | 查看某个分支的记录 |
| `HEAD@{n}` | HEAD 往前第 n 次 |
| `main@{n}` | main 往前第 n 次 |
| `@{n}` | 当前分支往前第 n 次 |
| `@{yesterday}` | 24 小时前的位置 |
| `--date=iso` | 显示每条记录的时间 |
| `log -g` | 按记录列出提交 |
| `reset --hard` | 回到以前的位置 |
| `branch -D` | 分支的记录一起删除 |
| `gc` | 清理过期的记录 |

*表 1：命令都省略了开头的 git。git gc 清理时，reflog 默认保留 90 天，已经不在当前分支上的记录只保留 30 天。*

reflog 是 Git 给 HEAD 和每个分支记下的一份移动记录，保存在 .git/logs 里，引用每变化一次就追加一行。git log 顺着 parent 列出项目的历史，reflog 则按时间列出 HEAD 在这台电脑上先后去过哪里，所以被 reset 撤销的提交、rebase 之前的旧提交，虽然在 git log 里已经看不到了，但是在 reflog 里还能找到。HEAD@{n} 按次数、HEAD@{yesterday} 按时间取出以前的位置，再用 git reset --hard 移回去，就可以撤回一次误操作。不过 reflog 只在本地，删除分支时会跟着删除，过期之后还会被 git gc 清理掉，而且它从来不保存没有提交过的改动。所以要靠 reflog 找回东西，前提是改动已经提交过，并且发现得足够早。
