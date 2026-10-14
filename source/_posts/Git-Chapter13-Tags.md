---
title: Git 第十三章：用 git tag 给提交打上版本号
date: 2026-10-14 21:37:00
description: Colt Steele《The Git & Github Bootcamp》标签那一章的复盘。标签是固定在某一个提交上的名字，最常见的用法是标记发布的版本，版本号通常按照语义化版本的约定写成「主版本.次版本.修订号」。git tag -l 按模式查找标签，git checkout 一个标签会进入分离头指针状态，git diff 可以比较两个版本。轻量标签只是一个记着提交号的文件，带注释的标签则多了一个标签对象，记录打标签的人、时间和说明，所以发布版本时更推荐用它。git tag -f 把已有的标签移到另一个提交上，-d 删除标签，这两种修改都只适合还没有推送的标签。git push 默认不推送标签，要用 git push origin 加标签名、--tags 或者 --follow-tags。
categories:
  - [课外, AI Infra, Git]
tags:
  - git tag
  - 标签
  - 语义化版本
  - 带注释的标签
  - 推送标签
cover: /img/covers/Git-Chapter13-Tags.svg
series: Git
privacy: protected
sitemap: false
private_section: 课外
---

到目前为止，要指明某一个提交，要么写提交号，要么写分支名。提交号是一串没有规律的字符，很难记住。分支名虽然好记，但是每提交一次，分支就会往前移动一次，所以过一段时间再看，它指向的已经不是原来那个提交了。如果想给某一个提交起一个好记、而且以后也不会变的名字，那么就要用**标签（tag）**。

标签最常见的用法是标记发布的版本，比如说明「1.0.0 版就是这个提交」。这一章先介绍版本号的写法，然后在 React 的仓库里看看已有的标签怎样查找和使用，最后在一个小仓库里创建、修改、删除和推送标签。

<!-- more -->

## 一、版本号的写法

标签的名字可以随便起，但是用来标记版本时，大多数项目都遵守**语义化版本**（Semantic Versioning）的约定。版本号由三个数字组成，写成「主版本.次版本.修订号」，比如 1.4.2 的主版本是 1，次版本是 4，修订号是 2。每发布一个新版本时要增加哪一个数字，取决于这次发布包含了什么样的改动：

| 这次发布包含的改动 | 1.4.2 之后的版本号 |
| --- | --- |
| 只修正了错误，原来的用法没有变 | 1.4.3 |
| 增加了新功能，原来的用法照样能用 | 1.5.0 |
| 原来的某种用法不能再用了 | 2.0.0 |

*表 1：增加次版本号时修订号归零，增加主版本号时次版本号和修订号都归零。*

修订号（patch）只用来发布向后兼容的错误修正。判断的标准是改动的类型，而不是改动的大小，所以即使只加了一个很小的新功能，也要增加次版本号。次版本号（minor）用来发布向后兼容的新功能，也就是说，按照 1.4.2 的用法写好的代码，换成 1.5.0 之后不需要任何修改。主版本号（major）则意味着有不兼容的改动，只要有一处原来的用法不能再用，就必须增加主版本号。因此从 1.x 升级到 2.0.0 时，使用它的代码可能需要跟着修改。

第一个正式版本是 1.0.0，在这之前，0.y.z 的版本表示项目还在开发初期，任何东西都可能变。另外，正式版本之前还可以发布预发布版本，写法是在版本号后面加一个连字符，比如 2.0.0-alpha.0 和 2.0.0-rc.1。它们排在 2.0.0 之前，表示这个版本还不稳定。

在 Git 里给版本打标签时，名字前面通常还会加一个 v，比如 v1.4.2。语义化版本的规范里专门说明了这一点，v1.4.2 是标签的名字，而版本号本身仍然是 1.4.2。

## 二、查看已有的标签

下面用 React 的仓库来演示怎样查看标签。React 的完整历史有 1 GB 多，这里只是为了看标签，所以克隆时加上了 `--filter=blob:none`。这个选项让 Git 先不下载文件的内容，等到用得着的时候再自动下载，而查看标签的这些命令照常可以使用：

```bash
git clone --filter=blob:none https://github.com/facebook/react
cd react
```

`git tag` 会按名字列出仓库里所有的标签。React 的标签很多，到 2026 年 10 月为止一共有 176 个：

```bash
git tag | wc -l
# 176
```

*代码 1：git tag 的输出里每个标签占一行，wc -l 统计的是行数。*

一下子列出一百多个标签，很难从中找到想要的那个，所以通常会加上 `-l`（`--list`）和一个模式，只列出名字符合这个模式的标签：

```bash
git tag -l "v17*"
# v17.0.0
# v17.0.1
# v17.0.2
```

*代码 2：名字以 v17 开头的标签一共有三个。*

`*` 表示任意多个任意字符，所以 `v17*` 能匹配所有以 v17 开头的名字。它和 Shell 的通配符写法相同，但是这里是由 Git 拿模式去和标签名比较，而不是由 Shell 去和文件名比较。所以模式要放在引号里，防止 Shell 抢先把它展开。如果不加引号，zsh 会直接报错：

```bash
git tag -l v17*
# zsh: no matches found: v17*
```

*代码 3：退出码是 1。zsh 在当前目录里找不到以 v17 开头的文件，于是拒绝执行这条命令，git 根本没有运行。*

bash 在找不到匹配的文件时，会把 `v17*` 原样交给 git，所以不加引号碰巧也能得到正确的结果。但是如果当前目录里恰好有一个 v17-notes.md，那么 git 收到的参数就变成了这个文件名，结果一个标签都列不出来，而且也不会报错。所以无论用哪一种 Shell，模式都应该加上引号。

列表的顺序也要留意。`git tag` 是按照名字逐个字符比较来排序的，而不是按照版本号的大小。比如想知道 React 16 的最后一个版本是哪一个：

```bash
git tag -l "v16.*" | tail -3
# v16.9.0
# v16.9.0-alpha.0
# v16.9.0-rc.0

git tag -l --sort=v:refname "v16.*" | tail -3
# v16.13.0
# v16.13.1
# v16.14.0
```

*代码 4：tail -3 只取最后三行。默认的顺序里，排在最后的是 v16.9.0 的两个预发布版本。*

v16.14.0 的第五个字符是 1，而 v16.9.0 的第五个字符是 9，所以按字符比较时，v16.14.0 反而排在 v16.9.0 的前面。`--sort=v:refname` 让 Git 把名字里的数字当作版本号来比较，这样排在最后的才是真正最新的 v16.14.0。如果写成 `--sort=-v:refname`，那么顺序会反过来，最新的版本排在最前面。

标签可以用在任何需要写提交号的地方。比如用第四章的 git diff 比较两个版本，或者用第八章的两个点的写法，列出两个版本之间的提交：

```bash
git diff --stat v17.0.1 v17.0.2
#  packages/scheduler/src/Scheduler.js                | 10 +--
#  packages/scheduler/src/SchedulerFeatureFlags.js    |  2 +-
#  packages/scheduler/src/SchedulerProfiling.js       | 51 --------------
#  .../src/__tests__/SchedulerProfiling-test.js       | 81 +++++-----------------
#  4 files changed, 23 insertions(+), 121 deletions(-)

git log --oneline v17.0.1..v17.0.2
# 12adaffef Remove scheduler sampling profiler shared array buffer (#20840)
# b2bbee7ba Disable (unstable) scheduler sampling profiler for OSS builds (#20832)
# 8cc6ff248 fix: use SharedArrayBuffer only when cross-origin isolation is enabled (#20831)
```

*代码 5：去掉 --stat 就能看到逐行的差异。*

v17.0.2 是 v17.0.1 之后的一个修订版本，两者之间只有三个提交，改动的文件也都在 scheduler 这个包里。React 的更新日志里，17.0.2 只有一条说明，内容是去掉一个没有用到的依赖，从而消除浏览器关于 SharedArrayBuffer 跨源隔离的警告，对应的正是这三个提交。这次修正没有改变任何用法，所以只增加了修订号。

想要查看某个版本的完整代码时，可以用 checkout 切换到这个标签上：

```bash
git checkout v17.0.2
# （先下载 v17.0.2 这个版本的文件内容，几行进度省略）
# Note: switching to 'v17.0.2'.
#
# （中间的提示和第六章代码 2 相同，省略）
#
# HEAD is now at 12adaffef Remove scheduler sampling profiler shared array buffer (#20840)

git status
# HEAD detached at v17.0.2
# nothing to commit, working tree clean
```

*代码 6：status 说明 HEAD 是在 v17.0.2 这个位置分离出来的。*

这时工作区里就是 v17.0.2 发布时的代码。和 checkout 一个提交号一样，这时也进入了第六章讲过的分离头指针状态，HEAD 直接记录着 12adaffef 这个提交。因为标签不会随着新的提交往前移动，所以 HEAD 没法像停在分支上那样「停在标签上」。在这个状态下也可以提交，但是新的提交不属于任何分支，切换走之后就只剩下 reflog 还记着它们。如果想在某个版本的基础上继续修改，比如给 React 17 再修正一个错误，那么要先从这个标签新建一条分支：

```bash
git switch -c fix-17 v17.0.2
# Switched to a new branch 'fix-17'
```

*代码 7：`git checkout -b fix-17 v17.0.2` 的效果完全相同。*

## 三、轻量标签

下面换到一个小仓库 todo 上，自己来打标签。仓库里只有一个记录待办事项的脚本 todo.sh，最早的版本是这样的：

```bash
#!/bin/sh
case "$1" in
  add)  echo "$2" > todo.txt ;;
  list) cat -n todo.txt ;;
esac
```

*代码 8：`./todo.sh add 买牛奶` 把一条待办写进 todo.txt，`./todo.sh list` 带着行号列出所有待办。*

这个版本有一个错误，`>` 每次都会先清空 todo.txt 再写入，所以它只能记住最后一条待办。第二个提交把它改成了追加内容的 `>>`，第三个提交又加上了写着用法的 README.md：

```bash
git log --oneline
# e64ec5b (HEAD -> main) README 写上用法
# c0564ed 修正 add 会覆盖之前的事项
# ebb720e todo.sh 能 add 和 list
```

*代码 9：第一个提交是 1.0.0，修正了错误之后，现在的版本是 1.0.1。*

如果 `git tag` 后面只写一个名字，那么标签会打在 HEAD 所在的提交上：

```bash
git tag v1.0.1

git log --oneline
# e64ec5b (HEAD -> main, tag: v1.0.1) README 写上用法
# c0564ed 修正 add 会覆盖之前的事项
# ebb720e todo.sh 能 add 和 list
```

*代码 10：打标签成功时没有任何输出。git log 在提交号后面的括号里标出了标签。*

这样打出来的标签叫作**轻量标签（lightweight tag）**。它和第二章看过的分支一样，只是 .git 目录里的一个文件，文件的内容就是提交号：

```bash
cat .git/refs/tags/v1.0.1
# e64ec5b84c4ff3134c3c9401cdb363fa984d708b

git show --stat v1.0.1
# commit e64ec5b84c4ff3134c3c9401cdb363fa984d708b (HEAD -> main, tag: v1.0.1)
# Author: Noimpty-zby <45208586@qq.com>
# Date:   Wed Oct 14 10:30:00 2026 +0800
#
#     README 写上用法
#
#  README.md | 4 ++++
#  1 file changed, 4 insertions(+)
```

*代码 11：git show 一个轻量标签，看到的就是它指向的那个提交。--stat 表示只显示改动的统计。*

分支和标签的区别在于，每次提交时，Git 都会更新 HEAD 所在的那个分支文件，让分支跟着往前移动，但是不会去更新标签文件，所以 v1.0.1 会一直指向 e64ec5b。另外，轻量标签除了这个名字以外，什么信息都没有记录。git show 显示的作者和时间都属于提交本身，至于这个标签是谁在什么时候、为什么打的，从它身上是看不出来的。

## 四、给以前的提交打标签

第一个提交 ebb720e 是 1.0.0，它也应该打上标签。在名字后面写上提交号，就能给以前的提交打标签。假设复制提交号的时候复制错了一行，写成了第二个提交的 c0564ed：

```bash
git tag v1.0.0 c0564ed

git log --oneline
# e64ec5b (HEAD -> main, tag: v1.0.1) README 写上用法
# c0564ed (tag: v1.0.0) 修正 add 会覆盖之前的事项
# ebb720e todo.sh 能 add 和 list
```

*代码 12：v1.0.0 打在了第二个提交上。*

这时改成正确的提交号再打一次，Git 会拒绝，因为同名的标签已经存在了。如果确实要用新的标签替换旧的，那么要加上 `-f`（`--force`）：

```bash
git tag v1.0.0 ebb720e
# fatal: tag 'v1.0.0' already exists

git tag -f v1.0.0 ebb720e
# Updated tag 'v1.0.0' (was c0564ed)

git log --oneline
# e64ec5b (HEAD -> main, tag: v1.0.1) README 写上用法
# c0564ed 修正 add 会覆盖之前的事项
# ebb720e (tag: v1.0.0) todo.sh 能 add 和 list
```

*代码 13：第一条命令的退出码是 128。替换之后，括号里的 was 说明了这个标签原来指向哪里。*

`-f` 的作用是把一个已经存在的标签名移到另一个提交上，所以它后面写的仍然是原来的名字，也就是说，它并不能给标签改名。Git 没有给标签改名的命令，如果打错的是名字，那么要用正确的名字在同一个提交上重新打一个标签，再把写错的那个删掉。删除标签的方法在第六节。

## 五、带注释的标签

接下来给 todo.sh 增加一个 done 命令，`./todo.sh done 2` 会删掉第 2 条待办。原来的 add 和 list 照样能用，所以这是一个次版本，提交之后应该打 v1.1.0。这一次加上 `-a`（`--annotate`），Git 会像提交时一样打开编辑器：

```text

#
# Write a message for tag:
#   v1.1.0
# Lines starting with '#' will be ignored.
```

*代码 14：`git tag -a v1.1.0` 打开的编辑器。第一行是空的，留给这个标签的说明。*

在第一行写上「新增 done 命令，可以删掉已经做完的事项」，存盘退出，标签就打好了。这种标签叫作**带注释的标签（annotated tag）**，用 git show 可以看到它多记录了哪些信息：

```bash
git show v1.1.0
# tag v1.1.0
# Tagger: Noimpty-zby <45208586@qq.com>
# Date:   Wed Oct 14 11:05:00 2026 +0800
#
# 新增 done 命令，可以删掉已经做完的事项
#
# commit a6db516a0d6b77bbe77dfef330d7abfc0e6362f7 (HEAD -> main, tag: v1.1.0)
# Author: Noimpty-zby <45208586@qq.com>
# Date:   Wed Oct 14 11:00:00 2026 +0800
#
#     新增 done 命令
#
# diff --git a/README.md b/README.md
# index 26e7e83..23afd2f 100644
# --- a/README.md
# +++ b/README.md
# @@ -2,3 +2,4 @@
#
#  ./todo.sh add 买牛奶    添加一条待办
#  ./todo.sh list          列出所有待办
# +./todo.sh done 2        删掉第 2 条
# diff --git a/todo.sh b/todo.sh
# index 2be26dd..0248233 100755
# --- a/todo.sh
# +++ b/todo.sh
# @@ -2,4 +2,5 @@
#  case "$1" in
#    add)  echo "$2" >> todo.txt ;;
#    list) cat -n todo.txt ;;
# +  done) sed -i "${2}d" todo.txt ;;
#  esac
```

*代码 15：前面五行是标签自己的信息，后面才是它指向的提交和这个提交的改动。*

开头的 Tagger 和 Date 记录了打标签的人和时间，接着是刚才写的说明。注意标签的时间是 11:05，而提交的时间是 11:00，两者是分开记录的。这些信息存放在哪里，可以用第四章的 git cat-file 来查看：

```bash
git cat-file -t v1.0.1
# commit

git cat-file -t v1.1.0
# tag

git cat-file -p v1.1.0
# object a6db516a0d6b77bbe77dfef330d7abfc0e6362f7
# type commit
# tag v1.1.0
# tagger Noimpty-zby <45208586@qq.com> 1791947100 +0800
#
# 新增 done 命令，可以删掉已经做完的事项

cat .git/refs/tags/v1.1.0
# fd49d234ca658404356321ea96e72cad7097ee38
```

*代码 16：tagger 那一行的 1791947100 是从 1970 年开始计算的秒数，也就是 11:05 这个时间。*

轻量标签 v1.0.1 直接指向提交，所以 cat-file -t 得到的类型是 commit。而 v1.1.0 指向的是一个新的**标签对象**，它的类型是 tag。标签对象和提交对象一样存放在 .git/objects 里，内容依次是它指向的对象（object 那一行）、这个对象的类型、标签名、打标签的人和时间，最后是说明。所以 refs/tags/v1.1.0 这个文件里记的是标签对象的编号 fd49d23，而不是提交号 a6db516。

![轻量标签和带注释的标签](/img/posts/git-tags/lightweight-vs-annotated.svg)

*图 1：两种标签在 .git/refs/tags/ 下都是一个文件。轻量标签的文件里是提交号，带注释的标签的文件里是标签对象的编号，标签对象再指向提交。*

如果说明比较短，那么可以像 git commit 一样用 `-m` 直接写在命令里，这样就不会打开编辑器。下面再给 todo.sh 做一个改动，把 add 改名为 new。改名之后，原来的 `./todo.sh add` 就不能用了，这是一个不兼容的改动，所以下一个版本是 2.0.0：

```bash
git tag -a v2.0.0 -m "add 改名为 new，原来的 add 不能再用"

git log --oneline
# 46540c2 (HEAD -> main, tag: v2.0.0) add 改名为 new
# a6db516 (tag: v1.1.0) 新增 done 命令
# e64ec5b (tag: v1.0.1) README 写上用法
# c0564ed 修正 add 会覆盖之前的事项
# ebb720e (tag: v1.0.0) todo.sh 能 add 和 list
```

*代码 17：git log 里只显示标签指向哪个提交，看不出两种标签的区别。*

git tag 的手册建议，发布版本时用带注释的标签，而轻量标签留给私人的或者临时的标记。因为带注释的标签记录了谁在什么时候发布了这个版本，而且有些命令默认会忽略轻量标签，比如第七节要用到的 `git push --follow-tags`。不过并不是所有项目都遵守这条建议。在 React 的仓库里用 git cat-file -t 检查一下就会发现，v17.0.1 是带注释的标签，v17.0.0 和 v17.0.2 却都是轻量标签。

## 六、删除标签

既然发布版本推荐用带注释的标签，那么前面的 v1.0.0 和 v1.0.1 也可以换成带注释的标签。`-d`（`--delete`）用来删除标签：

```bash
git tag -d v1.0.1
# Deleted tag 'v1.0.1' (was e64ec5b)

git tag -a v1.0.1 e64ec5b -m "修正 add 会覆盖之前的事项"
```

*代码 18：删除之后，用 -a 在同一个提交上重新打一个带注释的标签。*

删除标签删掉的只是这个名字，它指向的提交不受任何影响。另外，删除和重新打标签这两步，也可以用 `-f` 合成一步：

```bash
git tag -a -f v1.0.0 ebb720e -m "第一个版本"
# Updated tag 'v1.0.0' (was ebb720e)

git tag -n
# v1.0.0          第一个版本
# v1.0.1          修正 add 会覆盖之前的事项
# v1.1.0          新增 done 命令，可以删掉已经做完的事项
# v2.0.0          add 改名为 new，原来的 add 不能再用
```

*代码 19：git tag -n 在每个标签后面显示说明的第一行。如果是轻量标签，那么显示的是它指向的提交的提交信息。*

和这一章前面的操作一样，-d 只会影响本地仓库。如果标签已经推送出去了，那么远程仓库里的那一个还要另外删除，方法在下一节。

## 七、推送标签

和前几章一样，下面用本地的裸仓库 `github/todo.git` 代替 GitHub 上的仓库。先添加远程仓库，然后推送 main：

```bash
git remote add origin ../github/todo.git

git push -u origin main
# Enumerating objects: 16, done.
# Counting objects: 100% (16/16), done.
# Delta compression using up to 32 threads
# Compressing objects: 100% (14/14), done.
# Writing objects: 100% (16/16), 1.54 KiB | 791.00 KiB/s, done.
# Total 16 (delta 3), reused 0 (delta 0), pack-reused 0
# To ../github/todo.git
#  * [new branch]      main -> main
# Branch 'main' set up to track remote branch 'main' from 'origin'.

git ls-remote --tags origin
```

*代码 20：git ls-remote 列出远程仓库里的引用，加上 --tags 就只列出标签。这里没有任何输出。*

git push 只推送了 main，五个提交都已经到了远程仓库，但是标签一个都没有跟过去。这是因为 git push 默认只推送分支，标签要另外推送。推送一个标签时，把标签名写在远程仓库的名字后面：

```bash
git push origin v1.0.0
# Enumerating objects: 1, done.
# Counting objects: 100% (1/1), done.
# Writing objects: 100% (1/1), 177 bytes | 177.00 KiB/s, done.
# Total 1 (delta 0), reused 0 (delta 0), pack-reused 0
# To ../github/todo.git
#  * [new tag]         v1.0.0 -> v1.0.0
```

*代码 21：只上传了一个对象，也就是 v1.0.0 的标签对象，因为它指向的提交已经随着 main 推送过了。*

如果想把本地的标签全部推送出去，那么就用 `--tags`：

```bash
git push --tags
# Enumerating objects: 3, done.
# Counting objects: 100% (3/3), done.
# Delta compression using up to 32 threads
# Compressing objects: 100% (3/3), done.
# Writing objects: 100% (3/3), 574 bytes | 574.00 KiB/s, done.
# Total 3 (delta 0), reused 0 (delta 0), pack-reused 0
# To ../github/todo.git
#  * [new tag]         v1.0.1 -> v1.0.1
#  * [new tag]         v1.1.0 -> v1.1.0
#  * [new tag]         v2.0.0 -> v2.0.0
```

*代码 22：远程仓库已经有的 v1.0.0 没有再推送一次。*

需要注意的是，`--tags` 会把 refs/tags 下的所有标签都推送出去，私人的临时标记也包括在内。2.0.0 发布之后，又发现 README 里写的还是 `./todo.sh add`。修正 README 只是修正错误，所以提交之后应该发布 2.0.1。这一次用 `--follow-tags` 推送：

```bash
git tag -a v2.0.1 -m "README 里的用法改成 new"

git push --follow-tags
# Enumerating objects: 6, done.
# Counting objects: 100% (6/6), done.
# Delta compression using up to 32 threads
# Compressing objects: 100% (4/4), done.
# Writing objects: 100% (4/4), 572 bytes | 572.00 KiB/s, done.
# Total 4 (delta 0), reused 0 (delta 0), pack-reused 0
# To ../github/todo.git
#    46540c2..537e484  main -> main
#  * [new tag]         v2.0.1 -> v2.0.1
```

*代码 23：一次推送了 main 上的新提交和 v2.0.1。*

`--follow-tags` 会照常推送分支，同时把远程仓库还没有的带注释的标签一起推送出去，前提是这些标签指向的提交在这次推送的分支上。因为它只推送带注释的标签，所以私人的轻量标签可以放心地留在本地。

删除远程仓库里的标签要用 `git push origin --delete v2.0.1` 这样的写法，本地的 git tag -d 不会影响远程仓库。

## 八、已经推送的标签不要再改

修正 README 之后，还有另一种做法，就是不发布新的版本，而是用 -f 把 v2.0.0 移到修正后的提交上。下面在这个仓库里试一下这种做法。假设合作者已经把 `github/todo.git` 克隆到了 partner 目录，手里有全部的标签。这时在本地移动 v2.0.0，再推送：

```bash
git tag -a -f v2.0.0 -m "改了 README 之后重新打"
# Updated tag 'v2.0.0' (was 0a72b96)

git push origin v2.0.0
# To ../github/todo.git
#  ! [rejected]        v2.0.0 -> v2.0.0 (already exists)
# error: failed to push some refs to '../github/todo.git'
# hint: Updates were rejected because the tag already exists in the remote.
```

*代码 24：退出码是 1。was 后面的 0a72b96 是原来那个标签对象的编号。*

远程仓库已经有 v2.0.0 了，所以 Git 拒绝用推送来修改它。和第十一章的分支一样，加上 `-f` 就能强制覆盖：

```bash
git push -f origin v2.0.0
# Enumerating objects: 1, done.
# Counting objects: 100% (1/1), done.
# Writing objects: 100% (1/1), 196 bytes | 196.00 KiB/s, done.
# Total 1 (delta 0), reused 0 (delta 0), pack-reused 0
# To ../github/todo.git
#  + 0a72b96...a6875db v2.0.0 -> v2.0.0 (forced update)
```

*代码 25：远程仓库里的 v2.0.0 换成了新的标签对象 a6875db。*

远程仓库是改过来了，但是合作者那边并不会跟着改：

```bash
cd ../partner

git fetch

git pull
# Already up to date.

git log --oneline -1 v2.0.0
# 46540c2 (tag: v2.0.0) add 改名为 new

git fetch origin tag v2.0.0
# remote: Enumerating objects: 1, done.
# remote: Counting objects: 100% (1/1), done.
# remote: Total 1 (delta 0), reused 0 (delta 0), pack-reused 0
# Unpacking objects: 100% (1/1), 176 bytes | 176.00 KiB/s, done.
# From ……/github/todo
#  ! [rejected]        v2.0.0     -> v2.0.0  (would clobber existing tag)
```

*代码 26：最后一条命令的退出码是 1。合作者手里的 v2.0.0 仍然指向 46540c2。*

git fetch 和 git pull 都不会更新本地已经有的标签，而且不会给出任何提示。即使明确要求获取 v2.0.0，Git 也会以 would clobber existing tag（会覆盖已有的标签）为理由拒绝。Git 这样设计，是因为标签代表的是发布出去的版本，大家需要能够相信，同一个标签名指向的就是同一份代码。结果同一个 v2.0.0 在两个人手里指向了两个不同的提交，而且谁都没有收到提醒。

git tag 的手册对这种情况的建议很直接，如果打错的标签已经推送出去了，那么就换一个新的名字。这正是上一节发布 v2.0.1 的做法。所以 -f 和 -d 只用来修改还没有推送的标签，已经发布的版本有问题时，就修正之后发布下一个版本。

## 小结

| 写法 | 作用和要点 |
| --- | --- |
| `git tag` | 列出所有标签，按名字逐个字符排序 |
| `git tag -l "v17*"` | 按模式列出标签，模式要加引号 |
| `--sort=v:refname` | 按版本号排序，前面加减号是倒序 |
| `git checkout v17.0.2` | 分离头指针状态，修改前先建分支 |
| `git diff v1 v2` | 比较两个版本，标签可以代替提交号 |
| `git tag v1.0.1` | 在 HEAD 上打轻量标签 |
| `git tag v1.0.0 ebb720e` | 给以前的提交打标签 |
| `git tag -a v1.1.0` | 打带注释的标签，`-m` 直接写说明 |
| `-f` | 移动已有的标签，只在推送前使用 |
| `-d` | 删除本地的标签，提交不受影响 |
| `git tag -n` | 列出标签和说明的第一行 |
| `git push origin v1.0.0` | 推送一个标签，默认不推送标签 |
| `--tags` | 推送所有标签，包括轻量标签 |
| `--follow-tags` | 推送分支时带上带注释的标签 |

标签是一个不会移动的名字，最常见的用法是标记发布的版本，版本号则按照改动的类型来增加。轻量标签只记录了提交号，带注释的标签多了一个标签对象，记录了打标签的人、时间和说明，所以发布版本时更推荐用它。标签不会随着 git push 自动推送，而一旦推送出去，别人手里的标签也不会再跟着更新，所以发布之后发现问题时，不要移动原来的标签，而是修正之后发布一个新的版本。
