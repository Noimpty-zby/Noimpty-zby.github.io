---
title: Git 第四章：diff 永远只比两份快照
date: 2026-09-29 21:08:00
description: Colt Steele《The Git & Github Bootcamp》diff 那一章的复盘。git diff 的几种写法看起来各管一件事，其实都在回答同一个问题，那就是拿哪两份文件来比较。Git 保存的是每一个版本的完整内容，改动是在比较的那一刻临时计算出来的。所以 index 那一行里是两份文件的哈希，而不是提交号；没有 add 过的新文件，用哪种写法都看不到；比较两条分支时，两个点和三个点也会给出不一样的答案。
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

修改了一下午的代码，回过头来已经说不清楚动过哪些地方了。`git status` 能告诉你**哪些文件**发生了变化，这就是第一章讲的那张地图，但文件里**具体是哪几行**发生了变化，它并不负责回答。回答这个问题的是 `git diff`。

这一章的写法看起来有一大串，有不加参数的，有加 `--staged` 的，有加 `HEAD` 的，有后面跟文件名的，有跟两个分支名的，还有跟两个提交号的。如果分开来背，很容易弄混，因为它们的输出看起来一模一样。能把它们串联起来的是一件事，那就是 **Git 保存的并不是「改动」，而是每一个版本的文件的完整内容**。所谓改动，是在敲下 `git diff` 的那一刻，Git 拿两份完整的文件临时比较出来的。因此每一种写法其实都在回答同一个问题，那就是**拿哪两份内容来比较**。

<!-- more -->

## 一、先把一段输出读懂

这一章换用一份稍长一些的配置文件，一共 18 行，并且已经提交过一次（`d7aecee 初始配置`）。在工作区里修改两处地方，一处是在第 3 行后面插入一行，另一处是把邮件服务器换掉。

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

*代码 1：两处改动，输出也分成了两块。*

当输出的内容比一屏还长时，Git 会把它交给 `less` 来翻页（这时屏幕最下面会出现一个 `:`），按 `q` 就可以退出；如果一屏能显示得下，它就会直接打印出来。

**开头的四行说明的是「哪两份内容在比较」。**

- `diff --git a/config.txt b/config.txt` 表示这一段比较的是 config.txt 的两个版本，前一份叫作 a，后一份叫作 b。`a/` 和 `b/` 只是给两边起的名字，磁盘上并没有叫作 `a` 的目录。
- `index 2559e6f..43a5fe0 100644` 是两份文件内容各自的哈希值，再加上文件的类型，下一节会专门讲它。
- `--- a/config.txt` 和 `+++ b/config.txt` 规定了下面正文所用的符号，**以 `-` 开头的行只在 a 里有，以 `+` 开头的行只在 b 里有**。这两行本身并不表示删除了什么、增加了什么，它们只是一张图例。

**以 `@@` 开头的行是块头（hunk header）。** 一个块就是一段连续的改动区域，上一章判断冲突时，用的也是这个单位。

`@@ -1,6 +1,7 @@` 的读法是，这一块在 a 里从第 1 行开始，一共 6 行；在 b 里从第 1 行开始，一共 7 行。多出来的那一行，就是插入的 `重试 = 3`。

第二块的块头是 `@@ -14,5 +15,5 @@`，这一次两个起始行号不一样了。同样是 `过期 = 600` 这一行，在 a 里是第 14 行，在 b 里却是第 15 行，这是因为上面插入了一行，下面的内容就整体往后移了一格。所以块头必须给出两套行号，a 一套，b 一套。

![a、b 两版文件与两个块头的行号对应](/img/posts/git-diff/hunk-header.svg)

*图 1：两个块各自框住了 a 和 b 里的哪几行。a 的第 7 到第 13 行离两处改动都太远，所以不在输出里。*

**块里的每一行，只需要看第一个字符：**

| 开头 | 含义 |
| --- | --- |
| 空格 | 上下文：两边都有、没动过的行 |
| `-` | 只在 a 里有 |
| `+` | 只在 b 里有 |

第一块明明只插入了一行，却占了 6 行和 7 行，这是因为改动的前后各带了 3 行上下文，好让人看出改动落在什么位置。离所有改动都超过 3 行的内容不会被打印出来。这个行数可以用 `-U` 来调整，比如 `git diff -U1` 就只带 1 行上下文。如果某一边只有 1 行，块头会省略逗号和行数，写成 `@@ -1 +1,2 @@` 这样的形式。

需要注意的是，**diff 里并没有「修改一行」这个动作。** `服务器` 那一行在输出里是成对出现的，a 里的旧行记作 `-`，b 里的新行记作 `+`。`--stat` 也是按照这种方式来统计的：

```bash
git diff --stat
#  config.txt | 3 ++-
#  1 file changed, 2 insertions(+), 1 deletion(-)
```

*代码 2：插入一行、修改一行，被记作增加了 2 行、删除了 1 行。上一章合并完成后打印的 `config.txt | 2 +-`，用的就是这种格式。*

如果修改的是代码，块头后面还会跟着一段文字，比如修改 C 文件时，会出现 `@@ -11,6 +11,6 @@ int main(void)` 这样的块头。那是 Git 从这一块往上找到的最近一行以字母、下划线或者 `$` 开头的内容，方便看出改动落在哪个函数里。不过它只是按照这条规则往上查找，并不真正理解代码。

## 二、index 那一行：两份文件的指纹，不是提交号

`index 2559e6f..43a5fe0` 里的两个编号，很容易被当成提交号。拿 `git log` 里的编号对照一下：

```bash
git log --oneline
# d7aecee 初始配置

git rev-parse HEAD:config.txt
# 2559e6fc46f72d35b670bbce9c57265581188ab7
```

*代码 3：`HEAD:config.txt` 指的是「HEAD 那个提交里的 config.txt 这个文件」。*

提交号是 `d7aecee`，而 `2559e6f` 是这个提交里 **config.txt 这份文件内容**的哈希值。在 Git 里，保存文件内容的对象叫作 blob，按照编号把它取出来，得到的是一整份文件，而不是一段改动：

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

*代码 4：`-t` 用来查询类型，`-p` 用来打印内容。*

右边的那个 `43a5fe0` 更能说明问题。它是工作区里那份文件的哈希值，但仓库里根本没有这个对象：

```bash
git hash-object config.txt
# 43a5fe0ee78266ed7a0542fa0f54428cfeb095a3

git cat-file -t 43a5fe0
# fatal: Not a valid object name 43a5fe0
```

*代码 5：`hash-object` 只计算哈希值，并不把内容存入仓库。这份内容还没有执行过 `add`，所以 Git 手里并没有它。*

**也就是说，在敲下 `git diff` 的那一刻，Git 才去读取工作区里的文件，计算出它的编号，然后再和 a 那一份逐行比较。** 并没有任何地方保存着一份「改动记录」，等着人来取用。Git 保存的一直都是一份一份完整的快照，改动是比较出来的。这也正是 diff 的各种写法可以随意组合的原因，只要能说清楚两份快照在哪里，就可以拿来比较。

末尾的 `100644` 表示文件的类型，指的是普通文件；可执行文件则是 `100755`。如果只修改了权限而没有修改内容，diff 就不会输出块，只会报告两行，即 `old mode 100644` 和 `new mode 100755`。

## 三、不加参数、`--staged`、`HEAD`：比的是哪两份

第一章说过，一次改动需要经过三个地方，分别是工作区、暂存区和仓库（也就是 HEAD 所指向的那个提交）。同一个文件在这三个地方，可以各自是一个不同的版本。`git diff` 的三种基本写法，就是在这三份内容里挑出两份来比较。

下面把第一章的那个场景重新摆出来。从刚刚提交完的干净状态开始，先修改一处，执行 `add`，然后再修改一处。

```bash
sed -i 's/超时 = 30/超时 = 60/' config.txt
git add config.txt                              # 暂存区里是「超时 = 60」这一版
sed -i 's/日志 = info/日志 = debug/' config.txt  # 工作区又往前走了一步

git status -s
# MM config.txt
```

*代码 6：现在三个地方各自是一个不同的版本。*

不加参数的 `git diff` 输出如下：

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

*代码 7：只有「日志」这一处。a 是暂存区里的那一份，b 是工作区。*

`git diff --staged` 的输出如下：

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

*代码 8：只有「超时」这一处。a 是 HEAD 里的那一份，b 是暂存区。*

`git diff HEAD` 的输出如下：

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

*代码 9：两处改动都在。a 是 HEAD，b 是工作区。*

这三个 index 行首尾相接，依次是 `2559e6f → 0521d10 → 553b829`。前两条命令各自比较了其中一段，而 `git diff HEAD` 一步就跨过了整个范围。

![HEAD、暂存区、工作区三份文件与三条命令的对应](/img/posts/git-diff/three-areas.svg)

*图 2：箭头从 a 指向 b，每条命令都只取其中的两份内容。*

- **`git diff`** 比较的是**暂存区和工作区**，也就是「修改了、但还没有执行 `add` 的部分」。反过来说，一旦执行了 `add`，这部分改动就会从 `git diff` 的输出中消失。上一章说 `git diff --check` 在执行 `add` 之后就查不出冲突标记了，必须加上 `--cached`，原因就在这里。
- **`git diff --staged`** 比较的是 **HEAD 和暂存区**，也就是「下一次 `commit` 会提交进去的内容」。`--cached` 和它是同一个选项，手册的原话是 `--staged is a synonym of --cached`。在提交之前最后检查一遍，看的就是这个。
- **`git diff HEAD`** 比较的是 **HEAD 和工作区**，无论有没有暂存，只要是自上次提交以来修改过的内容，全都会算上。

`git status -s` 输出中的那两个 `M`，正好对应前两条命令。左边一列表示暂存区相对于 HEAD 有没有变化（也就是 `--staged` 有没有输出），右边一列表示工作区相对于暂存区有没有变化（也就是 `git diff` 有没有输出）。

## 四、新文件：哪种写法都看不见它

接下来再往工作区里放一个从来没有执行过 `add` 的新文件：

```bash
printf '# 部署说明\n先改 config.txt，再重启服务。\n' > README.md

git status -s
# MM config.txt
# ?? README.md
```

*代码 10：`??` 表示未跟踪。*

这时再运行 `git diff HEAD`，输出和代码 9 一字不差，**并没有 README.md**。也就是说，「自上次提交以来的全部改动」里并不包括这个新文件。

这里的道理和上一节是一样的，diff 只比较 Git 手里的快照。未跟踪的文件既不在暂存区里，也不在任何一个提交里，图 2 的三个框中都没有它，所以哪一条命令都碰不到它。执行 `add` 之后，它就进入了暂存区，于是 `--staged` 和 `HEAD` 就都能看到它了：

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

*代码 11：执行 `git add README.md` 之后，`git diff --staged` 输出中 README.md 的那一段。*

`0000000` 和 `/dev/null` 表达的都是「a 这一边没有这个文件」，`-0,0` 表示 a 里有零行。删除一个文件时，情况正好相反，输出里会出现 `deleted file mode` 和 `+++ /dev/null`，块头里 b 的那一半是 `+0,0`。

如果想让新文件出现在不加参数的 `git diff` 里，又暂时不想暂存它的内容，可以使用 `git add -N README.md`。它只会在暂存区里登记「有这么一个文件」，但内容是空的，于是工作区里的那一份就会整个被算作新增的内容。

## 五、只看一个文件

当文件比较多时，输出会很长。任何一种写法的后面都可以接上文件名，这样就只查看这一个文件：

```bash
git diff HEAD config.txt
git diff --staged config.txt
```

*代码 12：文件名放在最后面。*

不过有一种情况会出问题，那就是文件名和分支名重名了。

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

*代码 13：`feature` 既是一个分支，又是一个文件，Git 不会替你去猜，退出码是 128。*

报错信息里已经给出了正确的写法，那就是用 `--` 把两者隔开，**左边写提交或者分支，右边写文件**。`git diff -- feature` 查看的是 feature 这个文件，而 `git diff feature --` 则是拿工作区和 feature 分支进行比较。如果习惯在文件名前面加上 `--`，就不用担心重名的问题了。不过这种写法也有另一面，`--` 后面的名字 Git 不会再核对它是否存在，如果拼错了，只会得到一片空白，而且退出码照样是 0；而如果不加 `--`，拼错的名字会被当场拦下来并报错。

## 六、比两个分支、两个提交

最后是一个和上一章联系紧密的场景。`feature` 修改了端口，`master` 修改了日志，两边各自往前提交了一步。

```bash
git log --oneline --graph --all
# * 0bcc629 master: 日志级别调成 debug
# | * 58e596c feature: 端口换成 8080
# |/
# * d7aecee 初始配置
```

*代码 14：和上一章第二节是同样的形状。*

在合并之前，如果想知道两条分支有哪些差别，最直接的写法是把两个分支名交给 `git diff`：

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

*代码 15：`git diff master feature`，a 是 master 的最新提交，b 是 feature 的最新提交。*

端口那两行是 feature 的改动，这没有问题。但是**日志那两行是反过来的**，输出显示的是 `-日志 = debug` 和 `+日志 = info`，看起来好像是 feature 把日志从 debug 改回了 info，可是 feature 从来没有修改过日志。这其实是 master 自己的那次改动，因为 master 站在 a 那一边，所以被反过来显示了一遍。

这并不是出了错，而是 diff 本来就是这样工作的。它只看两个端点，并不关心中间的历史。在两个分支的最新提交里，日志一边是 debug、一边是 info，那么这就算作一处不同。如果把两个分支名的顺序调换一下，所有的 `-` 和 `+` 都会整个对调过来。

在合并之前，真正想问的问题通常是「**feature 分出去以后，自己修改了什么**」。要回答这个问题，就需要换掉 a，不再拿 master 的最新提交，而是拿两条分支的共同祖先来比较，这个祖先就是上一章三方合并里的那个祖先。写法是使用三个点：

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

*代码 16：`git diff master...feature`，它等价于 `git diff $(git merge-base master feature) feature`，输出里只剩下 feature 自己的那一处改动。*

![两个点和三个点各自取哪两个提交](/img/posts/git-diff/two-vs-three-dots.svg)

*图 3：两种写法中，b 都是 feature 的最新提交。用两个点时，a 是 master 的最新提交；用三个点时，a 是共同祖先。*

那么两个点又是什么意思呢？`git diff master..feature` 和中间用空格隔开的写法完全一样，仍然是拿两个最新提交直接比较。手册在这里特意提醒过一句，`"diff" is about comparing two endpoints, not ranges`，意思是 diff 比较的是两个端点，而不是一段区间，所以 `..` 在这里只是一个分隔符。以后在 `git log` 里还会见到 `..`，在那里它表示的是一段区间，意思并不一样。

比较两个提交也用同样的写法，提交号可以从 `git log --oneline` 的输出中复制：

```bash
git diff d7aecee 58e596c
```

*代码 17：前面的是 a，后面的是 b。先写旧的、后写新的，`-` 和 `+` 的含义才符合直觉。*

这条命令的输出和代码 16 一字不差，因为 `d7aecee` 正是这两条分支的共同祖先，而三个点所做的事情，就是自动把这个祖先找出来。

## 小结

各种写法分别比较的是哪两份内容：

| 写法 | a（`-` 那一边） | b（`+` 那一边） |
| --- | --- | --- |
| `git diff` | 暂存区 | 工作区 |
| `git diff --staged`（`--cached`） | HEAD | 暂存区 |
| `git diff HEAD` | HEAD | 工作区 |
| `git diff A B`（`A..B`） | 提交 A | 提交 B |
| `git diff A...B` | A、B 的共同祖先 | 提交 B |
| 以上任一条加 `-- <文件>` | 只看这个文件 | |

输出中每一行的含义：

| 行 | 意思 |
| --- | --- |
| `diff --git a/… b/…` | 这一段比的是哪个文件，前一份叫 a、后一份叫 b |
| `index 2559e6f..43a5fe0 100644` | 两份文件内容（blob）的哈希，不是提交号；`100644` 是普通文件 |
| `--- a/…` / `+++ b/…` | 图例：`-` 行属于 a，`+` 行属于 b；新建、删除时有一边是 `/dev/null` |
| `@@ -14,5 +15,5 @@` | 这一块在 a 里从第 14 行起共 5 行，在 b 里从第 15 行起共 5 行 |
| 空格 / `-` / `+` 开头 | 上下文（默认前后各 3 行）/ 只在 a 里 / 只在 b 里 |

这一章的写法虽然很多，但并不需要一条一条地背下来。**Git 保存的是快照，而改动是比较出来的**。所以 index 那一行里写的是两份文件的编号；所以每一种写法都只是在指定两份快照，a 在前、b 在后；所以从来没有进入过 Git 的新文件，谁也无法拿它来比较；所以在比较两条分支时，站在 a 那一边的是谁，决定了输出里会不会混进对方的改动。

上一章留下的第二个缺口还没有解决，那就是被 `would be overwritten` 拦下时，手上那一半的改动既不想提交，也不想丢掉。下一章讲 `stash`。
