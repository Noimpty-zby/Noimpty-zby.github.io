---
title: Git 第四章：diff 永远只比两份快照
date: 2026-09-29 21:08:00
description: Colt Steele《The Git & Github Bootcamp》diff 那一章的复盘。git diff 的几种写法看上去各管一摊，其实都在回答同一个问题：拿哪两份文件来比。Git 存的是每一版的完整内容，改动是比较的那一刻现算出来的——所以 index 行里是两份文件的哈希而不是提交号，所以没 add 过的新文件哪种写法都看不见，所以比两条分支时，两个点和三个点会给出不一样的答案。
categories:
  - [课外, AI Infra, Git]
tags:
  - diff
  - 暂存区
  - 快照
cover: /img/covers/Git-Chapter4-Diff.svg
series: Git
privacy: protected
sitemap: false
private_section: 课外
---

改了一下午，回头已经说不清动过哪些地方。`git status` 能告诉你**哪些文件**变了——那是第一章的那张地图——但文件里**具体哪几行**变了，它不管。回答这个问题的是 `git diff`。

这一章的写法看上去有一串：不加参数的、加 `--staged` 的、加 `HEAD` 的、后面跟文件名的、跟两个分支名的、跟两个提交号的。分开背很容易混，因为它们的输出长得一模一样。能把它们串起来的是一件事：**Git 存的不是「改动」，是每一版文件的完整内容**。所谓改动，是敲下 `git diff` 的那一刻，Git 拿两份完整的文件现场比出来的。于是每一种写法都只在回答同一个问题——**拿哪两份来比。**

<!-- more -->

## 一、先把一段输出读懂

这一章换一份长一点的配置文件，18 行，已经提交过一次（`d7aecee 初始配置`）。在工作区里改两处：第 3 行后面插进一行，再把邮件服务器换掉。

```bash
sed -i '3a 重试 = 3' config.txt
sed -i 's/smtp.example.com/mail.example.com/' config.txt
git diff
```

```diff
diff --git a/config.txt b/config.txt
index 2559e6f..43a5fe0 100644
--- a/config.txt
+++ b/config.txt
@@ -1,6 +1,7 @@
 # 服务配置
 端口 = 3000
 超时 = 30
+重试 = 3
 日志 = info
 
 # 数据库
@@ -14,5 +15,5 @@
 过期 = 600
 
 # 邮件
-服务器 = smtp.example.com
+服务器 = mail.example.com
 发件人 = noreply@example.com
```

*代码 1：两处改动，输出分成了两块。*

输出比一屏长的时候，Git 会把它交给 `less` 翻页（屏幕最底下出现一个 `:`），按 `q` 退出；一屏装得下就直接打印出来。

**头四行说的是「谁和谁比」。**

- `diff --git a/config.txt b/config.txt`：这一段比的是 config.txt 的两个版本，前一份叫 a，后一份叫 b。`a/`、`b/` 只是给两边起的名字，磁盘上并没有叫 `a` 的目录。
- `index 2559e6f..43a5fe0 100644`：两份文件内容各自的哈希，加上文件类型。下一节专门说它。
- `--- a/config.txt` 和 `+++ b/config.txt`：给下面的正文定符号——**以 `-` 开头的行只在 a 里有，以 `+` 开头的行只在 b 里有**。这两行本身不表示删了什么、加了什么，只是一张图例。

**`@@` 开头的是块头（hunk header）**。一块就是一段连续的改动区域——上一章判定冲突，用的也是这个单位。

`@@ -1,6 +1,7 @@` 读作：这一块在 a 里从第 1 行开始、共 6 行，在 b 里从第 1 行开始、共 7 行。多出来的那一行，就是插进去的 `重试 = 3`。

第二块 `@@ -14,5 +15,5 @@` 的两个起始行号不一样了。同一行 `过期 = 600`，在 a 里是第 14 行，在 b 里是第 15 行——上面插进了一行，下面的内容整体往后挪了一格。所以块头必须给两套行号，a 一套、b 一套。

![a、b 两版文件与两个块头的行号对应](/img/posts/git-diff/hunk-header.svg)

*图 1：两块各自框住了 a、b 里的哪几行。a 的第 7 到 13 行离两处改动都太远，不在输出里。*

**块里的每一行，只看第一个字符：**

| 开头 | 含义 |
| --- | --- |
| 空格 | 上下文：两边都有、没动过的行 |
| `-` | 只在 a 里有 |
| `+` | 只在 b 里有 |

第一块只插了一行，却占了 6、7 行，是因为改动前后各带了 3 行上下文，让人看得出改动落在什么位置。离所有改动都超过 3 行的内容不打印。这个数可以用 `-U` 调，`git diff -U1` 就只带 1 行。某一边只有 1 行时，块头会省掉逗号和行数，写成 `@@ -1 +1,2 @@` 这样。

要注意的是，**diff 里没有「修改一行」这个动作。**`服务器` 那一行在输出里是一对：a 里的旧行记作 `-`，b 里的新行记作 `+`。`--stat` 也是这么数的：

```bash
git diff --stat
#  config.txt | 3 ++-
#  1 file changed, 2 insertions(+), 1 deletion(-)
```

*代码 2：插入一行、改掉一行，记作 2 行增加、1 行删除。上一章合并完打印的 `config.txt | 2 +-` 就是这个格式。*

改的要是代码，块头后面还会跟一段文字，比如改 C 文件时的 `@@ -11,6 +11,6 @@ int main(void)`。那是 Git 从这一块往上找到的最近一行以字母、下划线或 `$` 开头的行，方便看出改动落在哪个函数里。它只是按这条规则往上找，并不理解代码。

## 二、index 那一行：两份文件的指纹，不是提交号

`index 2559e6f..43a5fe0` 里的两个号，很容易当成提交号。拿 `git log` 里的号对一下：

```bash
git log --oneline
# d7aecee 初始配置

git rev-parse HEAD:config.txt
# 2559e6fc46f72d35b670bbce9c57265581188ab7
```

*代码 3：`HEAD:config.txt` 指「HEAD 那个提交里的 config.txt 这个文件」。*

提交是 `d7aecee`，而 `2559e6f` 是这个提交里 **config.txt 这份文件内容**的哈希。Git 里存文件内容的对象叫 blob，按号把它取出来，是一整份文件，不是一段改动：

```bash
git cat-file -t 2559e6f
# blob

git cat-file -p 2559e6f
# # 服务配置
# 端口 = 3000
# 超时 = 30
# 日志 = info
# ……（18 行都在）
```

*代码 4：`-t` 问类型，`-p` 打印内容。*

右边那个 `43a5fe0` 更能说明问题——它是工作区里那份文件的哈希，但仓库里根本没有这个对象：

```bash
git hash-object config.txt
# 43a5fe0ee78266ed7a0542fa0f54428cfeb095a3

git cat-file -t 43a5fe0
# fatal: Not a valid object name 43a5fe0
```

*代码 5：`hash-object` 只算哈希、不入库。这份内容还没 `add` 过，Git 手里没有它。*

**敲下 `git diff` 的那一刻，Git 才去读工作区的文件、算出它的号，再跟 a 那份逐行比**。没有任何地方存着一份「改动记录」等人来取——Git 存的一直是一份份完整的快照，改动是比出来的。这也是 diff 的写法能随意组合的原因：只要说得出两份快照在哪，就能比。

末尾的 `100644` 是文件类型，表示普通文件；可执行文件是 `100755`。只改了权限、没改内容时，diff 不出块，只报两行 `old mode 100644` / `new mode 100755`。

## 三、不加参数、`--staged`、`HEAD`：比的是哪两份

第一章说过，一次改动要经过三个地方：工作区、暂存区、仓库（HEAD 指着的那个提交）。同一个文件在这三处可以各是一个版本。`git diff` 的三种基本写法，就是在这三份里挑两份。

把第一章那个场景重新摆出来：从刚提交完的干净状态开始，改一处，`add`，再改一处。

```bash
sed -i 's/超时 = 30/超时 = 60/' config.txt
git add config.txt                              # 暂存区里是「超时 = 60」这一版
sed -i 's/日志 = info/日志 = debug/' config.txt  # 工作区又往前走了一步

git status -s
# MM config.txt
```

*代码 6：三个地方现在各是一个版本。*

不加参数的 `git diff`：

```diff
diff --git a/config.txt b/config.txt
index 0521d10..553b829 100644
--- a/config.txt
+++ b/config.txt
@@ -1,7 +1,7 @@
 # 服务配置
 端口 = 3000
 超时 = 60
-日志 = info
+日志 = debug
 
 # 数据库
 主机 = localhost
```

*代码 7：只有「日志」。a 是暂存区里那份，b 是工作区。*

`git diff --staged`：

```diff
diff --git a/config.txt b/config.txt
index 2559e6f..0521d10 100644
--- a/config.txt
+++ b/config.txt
@@ -1,6 +1,6 @@
 # 服务配置
 端口 = 3000
-超时 = 30
+超时 = 60
 日志 = info
 
 # 数据库
```

*代码 8：只有「超时」。a 是 HEAD 里那份，b 是暂存区。*

`git diff HEAD`：

```diff
diff --git a/config.txt b/config.txt
index 2559e6f..553b829 100644
--- a/config.txt
+++ b/config.txt
@@ -1,7 +1,7 @@
 # 服务配置
 端口 = 3000
-超时 = 30
-日志 = info
+超时 = 60
+日志 = debug
 
 # 数据库
 主机 = localhost
```

*代码 9：两处都在。a 是 HEAD，b 是工作区。*

三个 index 行首尾相接：`2559e6f → 0521d10 → 553b829`。前两条各走一段，`git diff HEAD` 一步跨过去。

![HEAD、暂存区、工作区三份文件与三条命令的对应](/img/posts/git-diff/three-areas.svg)

*图 2：箭头从 a 指向 b。每条命令都只取其中两份。*

- **`git diff`** 比的是**暂存区和工作区**，也就是「改了、但还没 `add` 的部分」。反过来说，一旦 `add`，这部分就从 `git diff` 里消失了——上一章 `git diff --check` 在 `add` 之后查不出冲突标记、必须加 `--cached`，原因就在这里。
- **`git diff --staged`** 比的是 **HEAD 和暂存区**，也就是「下一次 `commit` 会提交进去的内容」。`--cached` 和它是同一个选项，手册原话是 `--staged is a synonym of --cached`。提交之前最后看一眼，看的就是这个。
- **`git diff HEAD`** 比的是 **HEAD 和工作区**：不管暂没暂存，自上次提交以来改过的全算上。

`git status -s` 那两个 `M` 正好对着前两条：左边一列说暂存区相对 HEAD 有没有变（`--staged` 有没有输出），右边一列说工作区相对暂存区有没有变（`git diff` 有没有输出）。

## 四、新文件：哪种写法都看不见它

再往工作区里放一个从没 `add` 过的新文件：

```bash
printf '# 部署说明\n先改 config.txt，再重启服务。\n' > README.md

git status -s
# MM config.txt
# ?? README.md
```

*代码 10：`??` 表示未跟踪。*

这时再跑 `git diff HEAD`，输出和代码 9 一字不差，**没有 README.md**。「自上次提交以来的全部改动」里并不包括它。

道理和上一节是同一个：diff 只比 Git 手里的快照。未跟踪的文件不在暂存区、也不在任何提交里，图 2 的三个框里都没有它，哪一条命令都摸不到。`add` 之后它进了暂存区，`--staged` 和 `HEAD` 就都能看到了：

```diff
diff --git a/README.md b/README.md
new file mode 100644
index 0000000..8b995e6
--- /dev/null
+++ b/README.md
@@ -0,0 +1,2 @@
+# 部署说明
+先改 config.txt，再重启服务。
```

*代码 11：`git add README.md` 之后，`git diff --staged` 里 README.md 那一段。*

`0000000` 和 `/dev/null` 说的都是「a 这边没有这个文件」，`-0,0` 是 a 里零行。删掉一个文件时正好反过来：`deleted file mode`、`+++ /dev/null`，块头的 b 那一半是 `+0,0`。

想让新文件出现在不加参数的 `git diff` 里、又暂时不想暂存它的内容，可以用 `git add -N README.md`：它只在暂存区登记「有这么个文件」，内容留空，于是工作区那份整个算作新增。

## 五、只看一个文件

文件一多，输出会很长。任何一种写法后面都可以接文件名，只看这一个：

```bash
git diff HEAD config.txt
git diff --staged config.txt
```

*代码 12：文件名放在最后。*

有一种情况会卡住：文件名和分支名撞了。

```bash
git branch
#   feature
# * master

ls
# config.txt  feature

git diff feature
# fatal: ambiguous argument 'feature': both revision and filename
# Use '--' to separate paths from revisions, like this:
# 'git <command> [<revision>...] -- [<file>...]'
```

*代码 13：`feature` 既是分支又是文件，Git 不替你猜。退出码 128。*

报错里已经给了写法：用 `--` 隔开，**左边是提交或分支，右边是文件**。`git diff -- feature` 看的是 feature 这个文件，`git diff feature --` 是拿工作区和 feature 分支比。文件名前习惯性地加上 `--`，就不用操心撞名。它也有另一面：`--` 后面的名字 Git 不再核对存不存在，拼错了只会得到一片空白，退出码照样是 0；不加 `--` 时，拼错的名字会被当场拦下来报错。

## 六、比两个分支、两个提交

最后是和上一章接得上的场景：`feature` 改了端口，`master` 改了日志，两边各往前走了一步。

```bash
git log --oneline --graph --all
# * 0bcc629 master: 日志级别调成 debug
# | * 58e596c feature: 端口换成 8080
# |/
# * d7aecee 初始配置
```

*代码 14：和上一章第二节同一个形状。*

合并之前想知道两条分支差在哪，最直接的写法是把两个分支名交给 `git diff`：

```diff
diff --git a/config.txt b/config.txt
index 2f3869a..fc0ae28 100644
--- a/config.txt
+++ b/config.txt
@@ -1,7 +1,7 @@
 # 服务配置
-端口 = 3000
+端口 = 8080
 超时 = 30
-日志 = debug
+日志 = info
 
 # 数据库
 主机 = localhost
```

*代码 15：`git diff master feature`。a 是 master 的最新提交，b 是 feature 的最新提交。*

端口那两行是 feature 的改动，没问题。但**日志那两行是反的**：`-日志 = debug`、`+日志 = info`，看上去像是 feature 把日志从 debug 改回了 info——可 feature 从来没碰过日志。这是 master 自己那次改动，因为 master 站在 a 那一边，被反着显示了一遍。

这不是出错，是 diff 的本分：它只看两个端点，不管中间的历史。两个分支的最新提交里，日志一边是 debug、一边是 info，那就是一处不同。把两个分支名换个顺序，所有 `-` 和 `+` 会整个对调。

合并之前真正想问的，通常是「**feature 分出去以后自己改了什么**」。那就要换掉 a：不拿 master 的最新提交，拿两条分支的共同祖先——就是上一章三方合并里的那个祖先。写法是三个点：

```diff
diff --git a/config.txt b/config.txt
index 2559e6f..fc0ae28 100644
--- a/config.txt
+++ b/config.txt
@@ -1,5 +1,5 @@
 # 服务配置
-端口 = 3000
+端口 = 8080
 超时 = 30
 日志 = info
 
```

*代码 16：`git diff master...feature`，等于 `git diff $(git merge-base master feature) feature`。只剩 feature 自己的那一处。*

![两个点和三个点各自取哪两个提交](/img/posts/git-diff/two-vs-three-dots.svg)

*图 3：b 都是 feature 的最新提交。两个点的 a 是 master 的最新提交，三个点的 a 是共同祖先。*

那两个点呢？`git diff master..feature` 和中间用空格隔开完全一样，还是两个最新提交直接比。手册在这里特意提醒过一句：`"diff" is about comparing two endpoints, not ranges`——diff 比的是两个端点，不是一段区间，`..` 在这里只是个分隔符。以后在 `git log` 里还会见到 `..`，那里它表示区间，意思不一样。

比两个提交也是同一个写法，提交号从 `git log --oneline` 里抄：

```bash
git diff d7aecee 58e596c
```

*代码 17：前面的是 a、后面的是 b。先写旧的、后写新的，`-` 和 `+` 才符合直觉。*

输出和代码 16 一字不差——`d7aecee` 正是这两条分支的共同祖先，三个点做的事就是替你把它找出来。

## 小结

每种写法各拿哪两份：

| 写法 | a（`-` 那一边） | b（`+` 那一边） |
| --- | --- | --- |
| `git diff` | 暂存区 | 工作区 |
| `git diff --staged`（`--cached`） | HEAD | 暂存区 |
| `git diff HEAD` | HEAD | 工作区 |
| `git diff A B`（`A..B`） | 提交 A | 提交 B |
| `git diff A...B` | A、B 的共同祖先 | 提交 B |
| 以上任一条加 `-- <文件>` | 只看这个文件 | |

输出里每一行的意思：

| 行 | 意思 |
| --- | --- |
| `diff --git a/… b/…` | 这一段比的是哪个文件，前一份叫 a、后一份叫 b |
| `index 2559e6f..43a5fe0 100644` | 两份文件内容（blob）的哈希，不是提交号；`100644` 是普通文件 |
| `--- a/…` / `+++ b/…` | 图例：`-` 行属于 a，`+` 行属于 b；新建、删除时有一边是 `/dev/null` |
| `@@ -14,5 +15,5 @@` | 这一块在 a 里从第 14 行起共 5 行，在 b 里从第 15 行起共 5 行 |
| 空格 / `-` / `+` 开头 | 上下文（默认前后各 3 行）/ 只在 a 里 / 只在 b 里 |

这一章的写法再多，也不用一条条背。**Git 存的是快照，改动是比出来的**：所以 index 行里是两份文件的号；所以每种写法都只是在指定两份快照，a 在前、b 在后；所以没进过 Git 的新文件，谁也比不了它；所以比两条分支时，站在 a 那边的是谁，决定了输出里会不会混进对方的改动。

上一章留下的第二个缺口还在：被 `would be overwritten` 拦下的时候，手上那半截改动既不想提交、也不想扔掉。下一章讲 `stash`。
