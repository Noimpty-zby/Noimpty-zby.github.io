---
title: Git 第五章：stash 是一个不挂在分支上的提交
date: 2026-09-30 14:00:00
description: Colt Steele《The Git & Github Bootcamp》stash 那一章的复盘。改到一半必须换分支，手上的东西既不想提交也不想扔，stash 把它们收起来，让工作区回到干净的 HEAD。收起来的东西并不神秘：它就是一个提交，只是没挂在任何分支上。从这一点出发，没 add 过的新文件为什么不收、pop 和 apply 差在哪、换一条分支取出来为什么只带改动不带历史、编号为什么会跟着变，都能推出来。
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

第二章讲切换分支时列过一张表：手上有没提交的改动，切过去会不会把它弄丢，决定了 Git 放不放行。两种结果其实都不理想：

- **被拦下**：目标分支上那个文件和这边不一样，切过去就得覆盖掉你的改动，于是报 `would be overwritten`，哪也去不了。
- **被放行**：没提交的改动不属于任何分支，会原样跟到目标分支上。本想回 `master` 看一眼干净的代码，看到的却是混着半截改动的版本。

两种情况要的是同一样东西：**先把手上的改动收起来，让工作区回到 HEAD 那个干净的样子，办完别的事再原样拿回来**。这就是 `git stash`。

stash 常被译成「暂存」，但它和第一章的暂存区（`git add` 放进去的那个地方）不是一回事。Pro Git 中文版把它译作「贮藏」，下面直接写 stash。

<!-- more -->

## 一、收起来，再拿回来

接着上一章那两条分支：`feature` 把端口改成了 8080，`master` 把日志改成了 debug。现在站在 `feature` 上调缓存，容量改到一半，需要先回 `master` 一趟：

```bash
git switch feature
sed -i 's/容量 = 256MB/容量 = 512MB/' config.txt

git switch master
# error: Your local changes to the following files would be overwritten by checkout:
# 	config.txt
# Please commit your changes or stash them before you switch branches.
# Aborting
```

*代码 1：config.txt 在两条分支上内容不同，切过去就会盖掉这处改动。退出码 1。*

报错的最后一句已经给了两条路：提交，或者 stash。这处改动还没写完，不值得占一个提交：

```bash
git stash
# Saved working directory and index state WIP on feature: 58e596c feature: 端口换成 8080

git status
# On branch feature
# nothing to commit, working tree clean

git switch master
# Switched to branch 'master'
```

*代码 2：改动被收走，工作区回到 HEAD，切换放行。*

`WIP` 是 work in progress（进行中的工作），后面记着收的时候站在哪条分支、HEAD 是哪个提交。

在 `master` 上办完事，回到 `feature`，把改动拿回来：

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

*代码 3：改动回到工作区。最后一行是说，收着的那一份已经删掉了。*

日常用法就这三步：`stash`、去别处、`stash pop`。麻烦都出在细节上——收走了哪些东西，拿回来的时候发生了什么，收了不止一份时怎么分。先看清收起来的东西存在了哪里，这些问题就都好答了。

## 二、收到哪去了：一个不挂在分支上的提交

再收一次，这回去 `.git` 里找它：

```bash
git stash
git stash list
# stash@{0}: WIP on feature: 58e596c feature: 端口换成 8080

cat .git/refs/stash
# d0a1d536cfeb67ffd014ac358437d1d28ede3f47
```

*代码 4：`.git/refs/` 下多了一个叫 stash 的文件，里面是一个 40 位的号。*

第二章说过，`.git/refs/heads/` 下的每个文件就是一条分支，里面记着一个提交号。`refs/stash` 是同一种文件，只是不在 `heads/` 下面。它记着的这个号是什么，问一下 Git：

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

*代码 5：tree、parent、作者、提交信息——这就是一个提交。*

**stash 收起来的东西就是一个提交**。和第三章的合并提交一样，它有两个 parent：第一个 `58e596c` 是收的时候 HEAD 所在的提交，第二个 `f388315` 是 Git 顺手给暂存区拍下的另一个提交。

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

*代码 6：`--all` 会把 `refs/stash` 也算进去，所以它出现在了图里。*

`git stash` 那句 `Saved working directory and index state`，说的正是这两个提交：`index on feature` 记着暂存区的样子，`WIP on feature` 记着工作区的样子，两个都长在 `58e596c` 上。

![stash 的两个提交和各个指针](/img/posts/git-stash/stash-commit.svg)

*图 1：`feature` 和 `master` 都没有动。收起来的两个提交只挂在 `refs/stash` 上，从哪条分支往回走都走不到它们。*

它和普通提交只差一点：**不在任何分支上。**`git branch --contains stash@{0}` 什么都不打印，`git log` 不加 `--all` 也看不到它。收完之后工作区之所以干净，是因为 Git 把工作区和暂存区都刷回了 HEAD——改动此时已经安全地存进那个提交里了。

`pop` 取回之后会删掉这一份。最后一份也被取走时，`.git/refs/stash` 这个文件跟着消失。

## 三、收走了什么，没收走什么

在工作区里同时摆上三样东西：一处已经 `add` 的改动、一处还没 `add` 的改动、一个从没被 Git 跟踪过的新文件。

```bash
sed -i 's/连接池 = 10/连接池 = 20/' config.txt
git add config.txt
sed -i 's/容量 = 256MB/容量 = 512MB/' config.txt
printf '# 部署说明\n先改 config.txt，再重启服务。\n' > README.md

git status -s
# MM config.txt
# ?? README.md
```

*代码 7：上一章那个 `MM`，外加一个未跟踪的文件。*

```bash
git stash
git status -s
# ?? README.md

git switch master
git status -s
# ?? README.md
```

*代码 8：README.md 没被收走，还跟着切到了 master。*

**未跟踪的文件，`git stash` 默认不收**。道理和上一章「新文件 diff 看不见」是同一个：它不在暂存区，也不在任何提交里，Git 手里没有它，收的时候也就不管它。它继续躺在工作区，按第二章的规则跟着切到了 `master`。

想连它一起收，加 `-u`（`--include-untracked`）。这时收起来的提交会多出第三个 parent，专门装未跟踪的文件：

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

*代码 9：`^3` 指第三个 parent。被 `.gitignore` 忽略的文件还要换成 `-a` 才会收。*

另一个细节在拿回来的时候。回到代码 7 的状态，只用 `git stash` 收，再 `pop`：

```bash
git stash pop
git status -s
#  M config.txt
# ?? README.md
```

*代码 10：原来是 `MM`，现在只剩右边一个 `M`。*

连接池那处改动本来已经 `add` 过，拿回来之后变成了未暂存。**`pop` 默认只还原工作区的样子，暂存区不管**。暂存区那一份明明存在 `index on …` 那个提交里，要让它也回来，得加 `--index`：

```bash
git stash pop --index
git status -s
# MM config.txt
# ?? README.md
```

*代码 11：两列 `M` 都回来了。*

## 四、pop 和 apply：取出来之后留不留

取回改动有两条命令，手册对 `apply` 只写了一句：

> Like pop, but do not remove the state from the stash list.

**两条命令做的是同一件事——把收着的改动放回当前工作区，差别只在事后那一份删不删。**`pop` 删，`apply` 不删；`pop` 成功时就等于 `apply` 之后再 `drop`。

它们都是往「当前所在的分支」上放。这一点值得单独试一下：在 `feature` 上收的，拿到 `master` 上取出来会怎样？

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

*代码 12：取出来了，那一份还在列表里。*

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

*代码 13：这时的 `git diff`。*

```bash
head -4 config.txt
# # 服务配置
# 端口 = 3000
# 超时 = 30
# 日志 = debug

git log --oneline -1
# 0bcc629 master: 日志级别调成 debug
```

*代码 14：端口还是 master 的 3000，也没有产生新提交。*

跟过来的只有容量那一行。`feature` 上那次「端口换成 8080」没有跟过来，因为**取出来的不是 `feature` 分支，而是收起来那一刻、相对当时 HEAD 的那段改动**。Git 做的是一次第三章那样的三方合并：共同祖先是收的时候的 HEAD（`58e596c`），一边是收起来的那一份，一边是当前的工作区。只有「收起来的那份相对祖先改了什么」会被带过来，而端口 8080 在祖先里就已经是 8080 了，不算改动。

![在 feature 上收、在 master 上取](/img/posts/git-stash/apply-elsewhere.svg)

*图 2：上面一行是收的时候记下的那段改动，下面一行是把同一段改动放到 master 的工作区里。*

既然是三方合并，就可能冲突。这回在 `feature` 上把日志改成 `warn` 收起来，再到日志已经是 `debug` 的 `master` 上 `pop`：

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

*代码 15：退出码 1。最后一句：这一份没删。*

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

*代码 16：两边的标签换成了 `Updated upstream`（当前这边）和 `Stashed changes`（收起来的那份）。*

索引里也照样挂着第三章那三个槽：

```bash
git ls-files -u
# 100644 fc0ae28aef5b7cab0b78d0ed6435199c728d3cea 1	config.txt
# 100644 2f3869a319d9a8ac9c458efb5e1d03b9f5c6f1fb 2	config.txt
# 100644 843f84e6c91154df3ac49ec0dc2274856074f425 3	config.txt
```

*代码 17：1 号槽的 `fc0ae28` 正是 `58e596c` 里的 config.txt——上一章代码 15 里 feature 那一边的号。*

共同祖先就是收的时候的那个 HEAD，上面那段话在这里得到了印证。

**`pop` 遇到冲突时不删那一份**：它不知道你会怎么解，留着以防万一。解完之后要自己 `git stash drop`。冲突的文件解完可以 `git add`，但那样它会进暂存区；只想让它变回普通的未暂存改动，用 `git restore --staged config.txt`，也就是 `git status` 提示里的那一条。

如果取出来冲突太多，又确实想在收的那个位置接着干，还有一条路：`git stash branch <新分支名>`。它从收的时候那个 HEAD（`58e596c`）拉出一条新分支，在上面把改动取出来，成功后删掉那一份：

```bash
git stash branch log-level
# Switched to a new branch 'log-level'
# ……
# Dropped refs/stash@{0} (a89b078b52c1954d8aef9231516f47f1bd755ab9)

git log --oneline -1
# 58e596c feature: 端口换成 8080
```

*代码 18：改动回到它当初长出来的地方，祖先和当前是同一个提交，不会冲突。*

## 五、收了不止一份

stash 可以一直收下去。连收两次：

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

在同一条分支、同一个 HEAD 上收的，默认说明就是一样的，过几天谁也分不清哪份是哪份。收的时候写上说明：

```bash
git stash push -m "过期改成 300 试试"
git stash list
# stash@{0}: On feature: 过期改成 300 试试
# stash@{1}: WIP on feature: 58e596c feature: 端口换成 8080
# stash@{2}: WIP on feature: 58e596c feature: 端口换成 8080
```

*代码 20：`git stash push` 是 `git stash` 的完整写法。*

还有一个旧写法 `git stash save "说明"`，效果看上去一样，但手册已经把它标成弃用：`This option is deprecated in favour of git stash push`。两者的区别在后面跟的参数上：`save` 把所有参数拼成说明，`push` 把参数当成文件路径、只收这几个文件。于是 `git stash save config.txt` 收走的是全部改动、说明叫「config.txt」，而 `git stash push config.txt` 只收 config.txt 这一个文件。

**`stash@{0}` 永远是最新的那一份**，越早收的编号越大。每新收一份，旧的全部往后挪一格：代码 19 里的 `stash@{0}`，在代码 20 里成了 `stash@{1}`。

要看某一份里是什么，`git stash show -p stash@{1}` 打印它的改动（不加 `-p` 只给文件统计）。要取出或丢掉指定的一份，把编号接在 `apply`、`pop`、`drop` 后面：

```bash
git stash drop stash@{1}
# Dropped stash@{1} (652f449ced33ef83b1db788984a2bcb42bc96226)

git stash list
# stash@{0}: On feature: 过期改成 300 试试
# stash@{1}: WIP on feature: 58e596c feature: 端口换成 8080
```

*代码 21：删了中间那份，原来的 `stash@{2}` 顶上来成了 `stash@{1}`。*

编号会变，是因为它从来不是存在某处的固定编号。Git 会给每个引用记一本流水账（reflog），记下它先后指过哪些提交。`stash@{n}` 就是这本账的写法，意思是「`refs/stash` 往前数第 n 次的值」。每收一次，`refs/stash` 改指新的提交，账本 `.git/logs/refs/stash` 里就多一行：

```bash
cut -f2 .git/logs/refs/stash
# WIP on feature: 58e596c feature: 端口换成 8080
# On feature: 过期改成 300 试试
```

*代码 22：最后一行是最新的，也就是 `stash@{0}`。`drop` 就是从这里删掉一行。*

所以按编号操作之前，先 `git stash list` 看一眼。上次记下的编号，中间只要收过或删过一次，就不再指着同一份了。

`git stash clear` 把整个列表清空。它和 `drop` 一样不问确认，但 `drop` 至少会打印被删那一份的提交号：那个提交本身还在对象库里，`git stash apply 652f449` 照样能把它取回来。`clear` 连号都不打印，手册的原话是清掉的东西 `may be impossible to recover`。

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

这一章的规则同样不用背。**stash 收起来的就是提交，只是不挂在任何分支上**：所以未跟踪的文件默认不收，它本来就不在 Git 手里；所以取出来是一次三方合并，在哪条分支上取都行，但带过去的只是那段改动，不是分支上的历史；所以会冲突，冲突时那一份留着；所以编号会变，它是 `refs/stash` 的流水账，不是一个固定的名字。

收起来、再拿回来，都还是在往前走。下一章换个方向：已经做了的事——改坏的文件、提错的提交——怎么往回退。`checkout`、`restore`、`reset`、`revert` 四条命令都叫撤销，撤的却不是同一样东西。
