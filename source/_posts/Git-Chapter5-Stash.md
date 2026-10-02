---
title: Git 第五章：stash 是一个不挂在分支上的提交
date: 2026-09-30 14:00:00
description: Colt Steele《The Git & Github Bootcamp》stash 那一章的复盘。改到一半时必须切换分支，手上的改动既不想提交，也不想丢掉，这时可以用 stash 把它们收起来，让工作区回到干净的 HEAD。收起来的东西并不神秘，它就是一个提交，只是没有挂在任何分支上。从这一点出发，就能推导出没有 add 过的新文件为什么不会被收起来、pop 和 apply 有什么区别、换一条分支取出来时为什么只带改动而不带历史，以及编号为什么会跟着变化。
categories:
  - [课外, AI Infra, Git]
tags:
  - stash
  - 工作区
  - reflog
cover: /img/covers/Git-Chapter5-Stash.svg
series: Git
privacy: protected
sitemap: false
private_section: 课外
---

第二章讲切换分支时，列过一张表。手上有没有提交的改动时，切换过去会不会把它们弄丢，决定了 Git 是否允许切换。但这两种结果其实都不理想：

- **被拦下**：目标分支上的那个文件和当前这边不一样，切换过去就必须覆盖掉手上的改动，于是 Git 会报出 `would be overwritten`，哪里也去不了。
- **被放行**：没有提交的改动不属于任何一个分支，所以会原样跟到目标分支上。本来只想回到 `master` 看一眼干净的代码，看到的却是一个混着半截改动的版本。

这两种情况需要的是同一样东西，那就是**先把手上的改动收起来，让工作区回到 HEAD 那个干净的状态，等办完别的事情之后，再把改动原样拿回来**。这就是 `git stash` 的作用。

stash 经常被翻译成「暂存」，但它和第一章讲的暂存区（也就是 `git add` 放进去的那个地方）并不是一回事。Pro Git 中文版把它翻译成「贮藏」，下面就直接写成 stash。

<!-- more -->

## 一、收起来，再拿回来

这里接着使用上一章的那两条分支，`feature` 把端口改成了 8080，而 `master` 把日志改成了 debug。现在位于 `feature` 上调整缓存，容量改到一半，需要先回 `master` 一趟：

```bash
git switch feature
sed -i 's/容量 = 256MB/容量 = 512MB/' config.txt

git switch master
# error: Your local changes to the following files would be overwritten by checkout:
# 	config.txt
# Please commit your changes or stash them before you switch branches.
# Aborting
```

*代码 1：config.txt 在两条分支上的内容不同，切换过去就会覆盖掉这处改动，退出码是 1。*

报错信息的最后一句已经给出了两条路，要么提交，要么使用 stash。由于这处改动还没有写完，不值得为它专门占用一个提交：

```bash
git stash
# Saved working directory and index state WIP on feature: 58e596c feature: 端口换成 8080

git status
# On branch feature
# nothing to commit, working tree clean

git switch master
# Switched to branch 'master'
```

*代码 2：改动被收走之后，工作区回到了 HEAD 的状态，切换也就被放行了。*

`WIP` 是 work in progress 的缩写，意思是进行中的工作，后面还记录着收起改动时位于哪一条分支，以及 HEAD 是哪一个提交。

在 `master` 上办完事情之后，回到 `feature`，再把改动拿回来：

```bash
git switch feature
git stash pop
# On branch feature
# Changes not staged for commit:
#   (use "git add <file>..." to update what will be committed)
#   (use "git restore <file>..." to discard changes in working directory)
# 	modified:   config.txt
#
# no changes added to commit (use "git add" and/or "git commit -a")
# Dropped refs/stash@{0} (d0a1d536cfeb67ffd014ac358437d1d28ede3f47)
```

*代码 3：改动回到了工作区。最后一行的意思是，收起来的那一份已经被删除了。*

日常的用法就是这三步，先执行 `stash`，再去别的地方处理事情，最后执行 `stash pop`。麻烦都出在细节上，比如收走了哪些东西、拿回来的时候发生了什么、收了不止一份时怎么区分。只要先弄清楚收起来的东西存放在哪里，这些问题就都很好回答了。

## 二、收到哪去了：一个不挂在分支上的提交

再收一次，这一回去 `.git` 目录里找找它：

```bash
git stash
git stash list
# stash@{0}: WIP on feature: 58e596c feature: 端口换成 8080

cat .git/refs/stash
# d0a1d536cfeb67ffd014ac358437d1d28ede3f47
```

*代码 4：`.git/refs/` 下面多出了一个名叫 stash 的文件，里面是一个 40 位的编号。*

第二章说过，`.git/refs/heads/` 下的每个文件就是一条分支，文件里记录着一个提交号。`refs/stash` 也是同一种文件，只是它不在 `heads/` 下面。它记录的这个编号是什么呢？可以问一问 Git：

```bash
git cat-file -p stash@{0}
# tree a3029c405f551ea74d69a4ef13ba6665f842f845
# parent 58e596c61979111e271c03cbee27ff82cd121e2d
# parent f3883158ec1ae81c6a27a391d191f72177f3b7df
# author Noimpty <noimpty@example.com> 1790685000 +0800
# committer Noimpty <noimpty@example.com> 1790685000 +0800
#
# WIP on feature: 58e596c feature: 端口换成 8080
```

*代码 5：有 tree、parent、作者和提交信息，这就是一个提交。*

**stash 收起来的东西，其实就是一个提交。** 它和第三章讲的合并提交一样，有两个父提交。第一个是 `58e596c`，也就是收起改动时 HEAD 所在的提交；第二个是 `f388315`，这是 Git 顺便为暂存区拍下的另一个提交。

```bash
git log --oneline --graph --all
# *   d0a1d53 WIP on feature: 58e596c feature: 端口换成 8080
# |\
# | * f388315 index on feature: 58e596c feature: 端口换成 8080
# |/
# * 58e596c feature: 端口换成 8080
# | * 0bcc629 master: 日志级别调成 debug
# |/
# * d7aecee 初始配置
```

*代码 6：`--all` 会把 `refs/stash` 也算进去，所以它出现在了图中。*

`git stash` 输出的那句 `Saved working directory and index state`，说的正是这两个提交。`index on feature` 记录的是暂存区的状态，`WIP on feature` 记录的是工作区的状态，而且这两个提交都是从 `58e596c` 上长出来的。

![stash 的两个提交和各个指针](/img/posts/git-stash/stash-commit.svg)

*图 1：`feature` 和 `master` 都没有移动。收起来的两个提交只挂在 `refs/stash` 上，从任何一条分支往回走都走不到它们。*

它和普通的提交只差一点，那就是**它不在任何分支上。**`git branch --contains stash@{0}` 什么都不会打印，不加 `--all` 的 `git log` 也看不到它。收起改动之后，工作区之所以是干净的，是因为 Git 把工作区和暂存区都恢复成了 HEAD 的样子，而这时改动已经安全地保存在那个提交里了。

执行 `pop` 取回改动之后，这一份就会被删除。当最后一份也被取走时，`.git/refs/stash` 这个文件也会随之消失。

## 三、收走了什么，没收走什么

现在在工作区里同时放上三样东西，一处已经执行过 `add` 的改动，一处还没有执行 `add` 的改动，以及一个从来没有被 Git 跟踪过的新文件。

```bash
sed -i 's/连接池 = 10/连接池 = 20/' config.txt
git add config.txt
sed -i 's/容量 = 256MB/容量 = 512MB/' config.txt
printf '# 部署说明\n先改 config.txt，再重启服务。\n' > README.md

git status -s
# MM config.txt
# ?? README.md
```

*代码 7：上一章出现过的那个 `MM`，再加上一个未跟踪的文件。*

```bash
git stash
git status -s
# ?? README.md

git switch master
git status -s
# ?? README.md
```

*代码 8：README.md 没有被收走，而且还跟着切换到了 master 上。*

**`git stash` 默认不会收起未跟踪的文件。** 这和上一章「diff 看不到新文件」是同一个道理，这个文件既不在暂存区里，也不在任何一个提交里，Git 手里并没有它，所以收起改动时也就不会处理它。它会继续留在工作区里，并且按照第二章讲的规则，跟着切换到了 `master` 上。

如果想把它也一起收起来，可以加上 `-u`（`--include-untracked`）。这时收起来的提交会多出第三个父提交，专门用来保存未跟踪的文件：

```bash
git stash -u
git status -s
# （什么都没有）

git cat-file -p stash@{0} | grep parent
# parent 58e596c61979111e271c03cbee27ff82cd121e2d
# parent 913bf98d40f555ef88803339649a9ebee82bb49a
# parent c897ee15d17d317d464ba1ca11405816ca529df6

git log -1 --format=%s stash@{0}^3
# untracked files on feature: 58e596c feature: 端口换成 8080
```

*代码 9：`^3` 指的是第三个父提交。如果还想收起被 `.gitignore` 忽略的文件，就要改用 `-a`。*

另一个细节出现在把改动拿回来的时候。回到代码 7 的状态，只用 `git stash` 收起改动，然后再执行 `pop`：

```bash
git stash pop
git status -s
#  M config.txt
# ?? README.md
```

*代码 10：原来是 `MM`，现在只剩下右边的一个 `M`。*

连接池的那处改动本来已经执行过 `add`，但拿回来之后却变成了未暂存的状态。这是因为 **`pop` 默认只会还原工作区的状态，并不处理暂存区**。暂存区的那一份明明保存在 `index on …` 那个提交里，如果想让它也恢复回来，就要加上 `--index`：

```bash
git stash pop --index
git status -s
# MM config.txt
# ?? README.md
```

*代码 11：两列 `M` 都恢复回来了。*

## 四、pop 和 apply：取出来之后留不留

取回改动有两条命令，手册对 `apply` 的说明只有一句话：

> Like pop, but do not remove the state from the stash list.

**这两条命令做的是同一件事，就是把收起来的改动放回当前的工作区，区别只在于事后要不要删除那一份。**`pop` 会删除，`apply` 不会删除；`pop` 执行成功时，就相当于先执行 `apply`，再执行 `drop`。

这两条命令都会把改动放到「当前所在的分支」上，这一点值得单独测试一下。如果改动是在 `feature` 上收起来的，拿到 `master` 上取出来，会发生什么呢？

```bash
# 在 feature 上把容量改成 512MB，git stash
git switch master
git stash apply
# Auto-merging config.txt
# On branch master
# Changes not staged for commit:
#   (use "git add <file>..." to update what will be committed)
#   (use "git restore <file>..." to discard changes in working directory)
# 	modified:   config.txt
#
# no changes added to commit (use "git add" and/or "git commit -a")

git stash list
# stash@{0}: WIP on feature: 58e596c feature: 端口换成 8080
```

*代码 12：改动被取出来了，而那一份仍然留在列表里。*

```diff
diff --git a/config.txt b/config.txt
index 2f3869a..c681876 100644
--- a/config.txt
+++ b/config.txt
@@ -10,7 +10,7 @@
 
 # 缓存
 开启 = 是
-容量 = 256MB
+容量 = 512MB
 过期 = 600
 
 # 邮件
```

*代码 13：这时 `git diff` 的输出。*

```bash
head -4 config.txt
# # 服务配置
# 端口 = 3000
# 超时 = 30
# 日志 = debug

git log --oneline -1
# 0bcc629 master: 日志级别调成 debug
```

*代码 14：端口仍然是 master 上的 3000，也没有产生新的提交。*

跟过来的只有容量那一行。`feature` 上那次「端口换成 8080」的提交并没有跟过来，这是因为**取出来的并不是 `feature` 分支，而是收起改动的那一刻，相对于当时 HEAD 的那一段改动**。Git 在这里做的是一次和第三章一样的三方合并，共同祖先是收起改动时的 HEAD（`58e596c`），一边是收起来的那一份，另一边是当前的工作区。只有「收起来的那一份相对于祖先改了什么」才会被带过来，而端口在祖先里就已经是 8080 了，所以并不算作改动。

![在 feature 上收、在 master 上取](/img/posts/git-stash/apply-elsewhere.svg)

*图 2：上面一行是收起改动时记录下来的那段改动，下面一行是把同一段改动放进 master 的工作区。*

既然是三方合并，就有可能发生冲突。这一回在 `feature` 上把日志改成 `warn` 并收起来，然后到日志已经是 `debug` 的 `master` 上执行 `pop`：

```bash
git stash pop
# Auto-merging config.txt
# CONFLICT (content): Merge conflict in config.txt
# On branch master
# Unmerged paths:
#   (use "git restore --staged <file>..." to unstage)
#   (use "git add <file>..." to mark resolution)
# 	both modified:   config.txt
#
# no changes added to commit (use "git add" and/or "git commit -a")
# The stash entry is kept in case you need it again.
```

*代码 15：退出码是 1。最后一句的意思是，这一份没有被删除。*

```text
# 服务配置
端口 = 3000
超时 = 30
<<<<<<< Updated upstream
日志 = debug
=======
日志 = warn
>>>>>>> Stashed changes
```

*代码 16：两边的标签换成了 `Updated upstream`（当前这一边）和 `Stashed changes`（收起来的那一份）。*

索引里也照样有第三章讲过的那三个槽：

```bash
git ls-files -u
# 100644 fc0ae28aef5b7cab0b78d0ed6435199c728d3cea 1	config.txt
# 100644 2f3869a319d9a8ac9c458efb5e1d03b9f5c6f1fb 2	config.txt
# 100644 843f84e6c91154df3ac49ec0dc2274856074f425 3	config.txt
```

*代码 17：1 号槽里的 `fc0ae28`，正是 `58e596c` 里的 config.txt，也就是上一章代码 15 中 feature 那一边的编号。*

由此可以印证上面说的那一点，共同祖先就是收起改动时的那个 HEAD。

**`pop` 遇到冲突时，并不会删除那一份**，因为它不知道冲突最终会怎样解决，所以留着以防万一。冲突解决之后，需要自己执行 `git stash drop`。解决完冲突的文件可以执行 `git add`，但这样它就会进入暂存区；如果只想让它变回普通的未暂存改动，可以使用 `git restore --staged config.txt`，也就是 `git status` 提示里的那一条命令。

如果取出改动时冲突太多，而又确实想在收起改动的那个位置上继续工作，还有一条路可走，那就是 `git stash branch <新分支名>`。它会从收起改动时的那个 HEAD（`58e596c`）拉出一条新分支，在新分支上取出改动，成功之后再删除那一份：

```bash
git stash branch log-level
# Switched to a new branch 'log-level'
# ……
# Dropped refs/stash@{0} (a89b078b52c1954d8aef9231516f47f1bd755ab9)

git log --oneline -1
# 58e596c feature: 端口换成 8080
```

*代码 18：改动回到了它当初产生的地方，共同祖先和当前是同一个提交，所以不会发生冲突。*

## 五、收了不止一份

stash 可以一直收下去。连续收两次的结果如下：

```bash
sed -i 's/容量 = 256MB/容量 = 512MB/' config.txt
git stash
sed -i 's/连接池 = 10/连接池 = 20/' config.txt
git stash

git stash list
# stash@{0}: WIP on feature: 58e596c feature: 端口换成 8080
# stash@{1}: WIP on feature: 58e596c feature: 端口换成 8080
```

*代码 19：两份的说明一字不差。*

在同一条分支、同一个 HEAD 上收起来的改动，默认的说明是一样的，过几天就分不清哪一份是哪一份了。所以最好在收起改动时写上说明：

```bash
git stash push -m "过期改成 300 试试"
git stash list
# stash@{0}: On feature: 过期改成 300 试试
# stash@{1}: WIP on feature: 58e596c feature: 端口换成 8080
# stash@{2}: WIP on feature: 58e596c feature: 端口换成 8080
```

*代码 20：`git stash push` 是 `git stash` 的完整写法。*

还有一种旧写法 `git stash save "说明"`，它的效果看起来一样，但手册已经把它标记为弃用了，原话是 `This option is deprecated in favour of git stash push`。两者的区别在于后面跟着的参数，`save` 会把所有参数拼接成说明，而 `push` 会把参数当成文件路径，只收起这几个文件。所以 `git stash save config.txt` 收走的是全部改动，说明叫作「config.txt」；而 `git stash push config.txt` 只收起 config.txt 这一个文件。

**`stash@{0}` 永远是最新的那一份**，越早收起的改动，编号就越大。每当新收起一份，旧的编号就会全部往后挪一格，所以代码 19 里的 `stash@{0}`，在代码 20 里变成了 `stash@{1}`。

如果想查看某一份里有什么内容，可以用 `git stash show -p stash@{1}` 打印它的改动（不加 `-p` 时，只会给出文件的统计信息）。如果想取出或者丢弃指定的某一份，就把编号接在 `apply`、`pop` 或 `drop` 的后面：

```bash
git stash drop stash@{1}
# Dropped stash@{1} (652f449ced33ef83b1db788984a2bcb42bc96226)

git stash list
# stash@{0}: On feature: 过期改成 300 试试
# stash@{1}: WIP on feature: 58e596c feature: 端口换成 8080
```

*代码 21：删除了中间那一份之后，原来的 `stash@{2}` 顶了上来，变成了 `stash@{1}`。*

编号之所以会变，是因为它从来都不是保存在某个地方的固定编号。Git 会为每个引用记录一本流水账（reflog），记下它先后指向过哪些提交。`stash@{n}` 就是这本账的写法，意思是「`refs/stash` 往前数第 n 次的值」。每收起一次改动，`refs/stash` 就会改为指向新的提交，账本 `.git/logs/refs/stash` 里也会多出一行：

```bash
cut -f2 .git/logs/refs/stash
# WIP on feature: 58e596c feature: 端口换成 8080
# On feature: 过期改成 300 试试
```

*代码 22：最后一行是最新的，也就是 `stash@{0}`，而 `drop` 就是从这里删除一行。*

所以在按照编号进行操作之前，最好先执行 `git stash list` 看一眼。上次记下的编号，只要中间收起或者删除过一次，就不再指向同一份内容了。

`git stash clear` 会把整个列表清空。它和 `drop` 一样，执行之前都不会询问确认，但 `drop` 至少会打印出被删除那一份的提交号。那个提交本身仍然保存在对象库里，执行 `git stash apply 652f449` 照样能把它取回来。而 `clear` 连提交号都不会打印，手册的原话是，清除掉的东西 `may be impossible to recover`。

## 小结

| 命令 | 它做的事 |
| --- | --- |
| `git stash`（`git stash push`） | 把暂存区和工作区各拍成一个提交，挂在 `refs/stash` 上，再把两处刷回 HEAD |
| `git stash -u` / `-a` | 连未跟踪的文件一起收 / 连被忽略的文件也收 |
| `git stash push -m "说明"` | 带着说明收；`save` 是已弃用的旧写法 |
| `git stash list` | 列出 `refs/stash` 的历次取值，`stash@{0}` 最新 |
| `git stash show -p [stash@{n}]` | 看某一份改了什么 |
| `git stash apply [stash@{n}]` | 把那一份的改动三方合并进当前工作区，那一份留着 |
| `git stash pop [stash@{n}]` | 同上，成功后删掉那一份；冲突时不删 |
| `pop` / `apply` 加 `--index` | 连暂存区一起还原 |
| `git stash drop [stash@{n}]` | 删掉一份，后面的编号往前补 |
| `git stash clear` | 全部删掉，基本找不回 |
| `git stash branch <名>` | 从收的时候那个提交拉一条新分支，在上面取出来 |

这一章的规则同样不需要死记。**stash 收起来的就是提交，只是它没有挂在任何分支上**。所以未跟踪的文件默认不会被收起，因为它本来就不在 Git 手里；所以取出改动是一次三方合并，在哪条分支上取出都可以，但带过去的只是那一段改动，而不是分支上的历史；所以取出时可能会发生冲突，而发生冲突时那一份会被保留下来；所以编号会发生变化，因为它是 `refs/stash` 的流水账，而不是一个固定的名字。

无论是收起改动还是把它拿回来，都还是在往前推进。下一章换一个方向，讲已经做过的事情，比如改坏了的文件、提交错了的提交，应该怎样往回退。`checkout`、`restore`、`reset` 和 `revert` 这四条命令都叫作撤销，但它们撤销的并不是同一样东西。
