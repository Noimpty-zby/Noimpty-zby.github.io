---
title: Git 第十四章：打开 .git 目录，看 Git 怎样保存每一次提交
date: 2026-10-15 22:30:00
description: Colt Steele《The Git & Github Bootcamp》Git 底层那一章的复盘。.git/config 是仓库自己的配置，用 --local 写进去的设置只对这个仓库生效，并且优先于全局配置。objects 目录里的每个对象都以 SHA-1 编号命名，编号是从「类型、字节数和内容」算出来的，所以同样的内容在任何地方都是同一个编号。blob 只保存文件的内容，不保存文件名；tree 对应一个目录，记录每一项的权限、类型、编号和名字；commit 记录根目录的 tree、上一个提交、作者、提交者和提交信息。refs 里的分支、标签和远程跟踪分支都是记着编号的文件，HEAD 记着当前的分支，克隆下来的仓库则把引用和对象分别打包进 packed-refs 和 pack 文件。再提交一次时，没有变化的文件和目录会直接复用原来的对象。
categories:
  - [课外, AI Infra, Git]
tags:
  - .git 目录
  - Git 对象
  - git cat-file
  - git hash-object
  - SHA-1
cover: /img/covers/Git-Chapter14-Internals.svg
series: Git
privacy: protected
sitemap: false
private_section: 课外
---

前面几章已经好几次打开过 .git 目录。第二章看到一个分支就是 refs/heads 下的一个文件，第四章用 git cat-file 取出过一份文件的内容，第七章在 .git/config 里找到了 git remote add 写下的地址，上一章又看到带注释的标签是一个单独的标签对象。不过这些都只是零散地看了几眼，这一章把 .git 目录完整地走一遍，看看 Git 到底把配置、分支和每一次提交存成了什么样子。

这一章用到的 git hash-object、git cat-file 这类命令属于 Git 的底层命令，平时提交、合并、推送的时候都用不到，所以这一章对日常使用的帮助不大，更多是为了了解 Git 的原理。但是看懂了 Git 怎样保存提交以后，前面很多规则就不需要死记了，比如为什么 amend 和 rebase 之后提交号一定会变，为什么第四章 diff 里 index 那一行写的是文件内容的编号。

<!-- more -->

## 一、.git 目录和配置文件

先在一个空仓库里看一看 git init 创建了哪些东西：

```bash
git init lab
# Initialized empty Git repository in ……/lab/.git/
cd lab

ls -F .git
# HEAD  branches/  config  description  hooks/  info/  objects/  refs/
```

*代码 1：-F 会在目录名的后面加上一个斜杠。*

这一章要讲的是其中的四样东西，分别是配置文件 config、存放所有内容的 objects 目录、存放分支和标签的 refs 目录，以及记录当前位置的 HEAD 文件。hooks 目录里是一些以 .sample 结尾的示例脚本，如果去掉这个后缀，Git 就会在提交、推送这类时刻自动运行对应的脚本，比如在提交之前先跑一遍检查。info 目录里的 exclude 文件和 .gitignore 的写法相同，区别在于它只在本地生效，不会被提交。剩下的 description 和 branches 平时基本用不到。执行过 add 和提交之后，这里还会多出 index、logs 和 COMMIT_EDITMSG，其中 index 就是暂存区，第四节会用到它。

.git/config 是这个仓库自己的配置文件。刚创建的仓库里只有 [core] 这一节，这几项都是 git init 自动写下的，一般不需要修改：

```bash
cat .git/config
# [core]
# 	repositoryformatversion = 0
# 	filemode = true
# 	bare = false
# 	logallrefupdates = true
```

*代码 2：bare = false 说明这是一个带工作区的普通仓库，前几章用 git init --bare 创建的裸仓库，这一项是 true。*

第一章配置名字和邮箱时用的是 `git config --global`，这些设置写在家目录的 ~/.gitconfig 里，对这台电脑上的所有仓库都生效。如果把 `--global` 换成 `--local`，那么设置就会写进当前仓库的 .git/config，只对这一个仓库生效。比如在公司的项目里想用工作邮箱提交，就可以这样设置：

```bash
git config --local user.name "zby"
git config --local user.email "zby@example.com"

cat .git/config
# [core]
# 	repositoryformatversion = 0
# 	filemode = true
# 	bare = false
# 	logallrefupdates = true
# [user]
# 	name = zby
# 	email = zby@example.com
```

*代码 3：两条 git config 都没有输出，.git/config 的末尾多了 [user] 这一节。*

这时 user.email 在两个文件里有两个不同的值。Git 读取配置的时候，仓库自己的配置优先于全局配置，所以在这个仓库里提交时，作者会是 zby <zby@example.com>。而全局配置并没有被改动，其他仓库照样使用原来的名字和邮箱。如果不确定一个设置项最终用的是哪个文件里的值，那么可以加上 `--show-origin`：

```bash
git config user.email
# zby@example.com

git config --global user.email
# 45208586@qq.com

git config --show-origin user.email
# file:.git/config	zby@example.com
```

*代码 4：不加 --global 或 --local 时，git config 读到的是最终生效的那个值。*

除了名字和邮箱，其他设置也可以只对一个仓库生效。比如 `git config --local color.ui false` 会在 .git/config 里加上 [color] 这一节，这样这个仓库里的命令输出默认都不带颜色。不再需要某个设置时，可以用 `--unset` 删掉一项，或者用 `--remove-section` 删掉一整节：

```bash
git config --local --remove-section user
```

*代码 5：删掉 [user] 这一节之后，这个仓库重新使用全局的名字和邮箱。*

## 二、对象的编号是怎样算出来的

Git 里的提交、文件内容和目录都有一个 40 位的十六进制编号，这个编号是用 **SHA-1** 这个哈希函数计算出来的。哈希函数可以把任意长度的内容变成一个固定长度的结果，SHA-1 的结果是 160 位的二进制数，写成十六进制正好是 40 位。同样的内容，算出来的编号永远相同；而内容哪怕只改动一个字节，编号也会变得完全不同。

git hash-object 可以让 Git 直接算出一个编号。它的参数是文件的路径，如果想算一段文字的编号，就要加上 `--stdin`，让它从标准输入读取内容：

```bash
echo 'hi' | git hash-object --stdin
# 45b983be36b73c0788dc9cbcb76cbb80fc7bb057

echo 'hi' > hi.txt
git hash-object hi.txt
# 45b983be36b73c0788dc9cbcb76cbb80fc7bb057

git hash-object hi
# fatal: could not open 'hi' for reading: No such file or directory
```

*代码 6：最后一条命令的退出码是 128。Git 把 hi 当成了文件名，而当前目录里没有这个文件。*

从管道传进去的 hi 和 hi.txt 这个文件的内容完全相同，所以两次得到的编号也完全相同。这个编号只取决于内容，和文件名、时间都没有关系，因此在任何一台电脑上算出来都是 45b983b。

不过，如果直接用 sha1sum 计算 hi 的哈希值，那么得到的却是另一个编号：

```bash
echo 'hi' | sha1sum
# 55ca6286e3e4f4fba5d0448333fa99fc5a404a73  -

printf 'blob 3\0hi\n' | sha1sum
# 45b983be36b73c0788dc9cbcb76cbb80fc7bb057  -
```

*代码 7：sha1sum 输出的最后一个减号，表示内容来自标准输入。*

这是因为 Git 在计算之前，会先在内容的前面加上一段头部，写明对象的类型和内容的字节数，再用一个空字符 `\0` 和内容隔开。echo 会在 hi 的后面加一个换行符，所以内容一共是 3 个字节，Git 实际计算的是 `blob 3\0hi\n` 这一串。用 printf 把这一串原样交给 sha1sum，得到的就是 git hash-object 算出的 45b983b。这里的 blob 就是第四章见过的、用来保存文件内容的那种对象。

Git 的存储其实是一个键值对数据库，键是编号，值是内容。拿着内容就能算出编号，拿着编号也能取回内容。因为编号是从内容本身算出来的，所以这种存储方式叫作**内容寻址**（content-addressable）。

## 三、objects 目录和 git cat-file

git hash-object 默认只计算编号，并不会把内容存进仓库。加上 `-w` 之后，内容才会写进 .git/objects 目录：

```bash
find .git/objects -type f

echo 'hi' | git hash-object -w --stdin
# 45b983be36b73c0788dc9cbcb76cbb80fc7bb057

find .git/objects -type f
# .git/objects/45/b983be36b73c0788dc9cbcb76cbb80fc7bb057
```

*代码 8：第一条 find 没有输出，说明刚创建的仓库里一个对象都没有。*

每个对象都是 objects 下面的一个文件，编号的前两位是目录名，剩下的 38 位是文件名。之所以把前两位拿出来做目录，是为了不让一个目录里堆积太多的文件。反过来，要按编号取出内容就用 git cat-file，`-t` 查看对象的类型，`-s` 查看内容的字节数，`-p` 打印内容：

```bash
git cat-file -t 45b983b
# blob

git cat-file -s 45b983b
# 3

git cat-file -p 45b983b
# hi

git cat-file -t 45b983c
# fatal: Not a valid object name 45b983c
```

*代码 9：编号可以只写前几位，只要仓库里没有别的对象以同样的几位开头。仓库里没有以 45b983c 开头的对象，所以最后一条命令报错，退出码是 128。*

objects 下的文件不能直接用 cat 查看，因为 Git 用 zlib 压缩过它们。用 Python 的 zlib 模块解压之后，可以看到文件里保存的正是上一节计算编号时用的那一串：

```bash
python3 -c 'import sys, zlib; print(zlib.decompress(open(sys.argv[1], "rb").read()))' .git/objects/45/b983be36b73c0788dc9cbcb76cbb80fc7bb057
# b'blob 3\x00hi\n'
```

*代码 10：\x00 就是那个空字符。*

所以 Git 保存一份内容的过程是这样的。先在内容的前面加上头部，算出编号，再把这一串压缩之后，存进以编号命名的文件。取出的时候，按编号找到这个文件，解压之后去掉头部，剩下的就是原来的内容。

## 四、blob：只保存文件的内容

下面换到一个小项目 pycalc 上。它是一个只会做加减法的 Python 计算器，一共有六个文件：

```text
pycalc
├── README.md
├── calc
│   ├── __init__.py
│   └── ops.py
├── run.sh
└── tests
    ├── __init__.py
    └── test_ops.py
```

*代码 11：run.sh 是运行测试的脚本，有可执行权限。两个 \_\_init\_\_.py 都是空文件，它们把 calc 和 tests 标记成 Python 的包。*

刚初始化的仓库里，objects 目录是空的。接着执行 git add，然后用 `git ls-files --stage` 看一看暂存区：

```bash
git init
find .git/objects -type f | wc -l
# 0

git add .
git ls-files --stage
# 100644 d818af479443b8d36db5fbaa930087145ff0a6ea 0	README.md
# 100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0	calc/__init__.py
# 100644 4c2d043433fc9034162263996307f6c2937e9888 0	calc/ops.py
# 100755 9af920c06484863da03effb6112ac87edcbdd2a6 0	run.sh
# 100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0	tests/__init__.py
# 100644 8f3031253e9270ae31976da616b74250d6e7d268 0	tests/test_ops.py

find .git/objects -type f | wc -l
# 5
```

*代码 12：git init 的输出省略。wc -l 统计的是 find 列出了几个文件，也就是仓库里有几个对象。*

暂存区保存在 .git/index 这个文件里，它是一个二进制文件，`git ls-files --stage` 把它的内容按行列了出来。每一行依次是文件的类型和权限、文件内容的编号、一个序号和文件的路径。第一列的 100644 表示普通文件，100755 表示可执行文件，第四章的 diff 里已经见过。序号平时都是 0，只有像第三章那样发生合并冲突时，同一个文件才会出现 1、2、3 三个版本。

从这里可以看出两件事。第一，git add 的时候，文件的内容就已经作为 blob 存进了 objects，并不是等到提交时才存。第二，六个文件只产生了 5 个对象，因为两个 \_\_init\_\_.py 都是空文件，内容相同，编号也就相同，都是 e69de29，所以 Git 只需要存一份。

e69de29 是空内容的编号，任何仓库里的空文件都是这个编号。这也说明 blob 里并没有文件名，calc/\_\_init\_\_.py 和 tests/\_\_init\_\_.py 的路径不同，存的却是同一个对象。文件名和路径现在记在暂存区里，提交之后则记在下一节的 tree 里。

## 五、tree：记录目录里有哪些东西

接下来提交，提交之后对象变成了 9 个：

```bash
git commit -m "加法和减法"
# [main (root-commit) 5f63edb] 加法和减法
#  6 files changed, 22 insertions(+)
#  ……（6 行 create mode 省略）

find .git/objects -type f | wc -l
# 9
```

*代码 13：root-commit 表示这是仓库里的第一个提交。*

提交的时候，Git 会按照暂存区里的路径，给每一个目录生成一个 **tree** 对象。pycalc 有根目录、calc 和 tests 三个目录，所以多出来的 4 个对象里，有 3 个是 tree，剩下的一个是提交本身。blob 只保存一个文件的内容，tree 则对应一个目录，记录这个目录里有哪些文件和子目录。`main^{tree}` 表示 main 指向的那个提交的根目录，用 cat-file 打印出来是这样的：

```bash
git cat-file -p main^{tree}
# 100644 blob d818af479443b8d36db5fbaa930087145ff0a6ea	README.md
# 040000 tree f40b3671df407e9a625f1124c3ce46b3b911029e	calc
# 100755 blob 9af920c06484863da03effb6112ac87edcbdd2a6	run.sh
# 040000 tree 82e9896b502054de25d136e6df9f499bfaedd803	tests
```

*代码 14：根目录的 tree，每一行对应目录里的一项。*

每一行依次是类型和权限、对象的类型、对象的编号和名字。文件对应的是 blob，权限和暂存区里的一样；子目录对应的是另一个 tree，权限一栏写的是 040000。文件名就记在这里，所以同一个 blob 可以在不同的 tree 里以不同的名字出现。比如给文件改名时，新的 tree 里只是换了一个名字，文件的内容并不需要重新保存。

根目录的 tree 里只有四行，因为 calc 和 tests 里的文件并不记在这里，而是记在它们各自的 tree 里。查看子目录时可以写 `main:calc`，意思是 main 那个提交里的 calc 这个路径，第四章的 `HEAD:config.txt` 也是这种写法：

```bash
git cat-file -p main:calc
# 100644 blob e69de29bb2d1d6434b8b29ae775ad8c2e48c5391	__init__.py
# 100644 blob 4c2d043433fc9034162263996307f6c2937e9888	ops.py
```

*代码 15：calc 目录的 tree，它的编号就是根目录里 calc 那一行的 f40b367。*

一层一层地打开 tree 比较麻烦，如果想一次看到所有的文件，那么可以用 git ls-tree 加上 `-r`，它会进入每一个子目录，列出全部的 blob：

```bash
git ls-tree -r main
# 100644 blob d818af479443b8d36db5fbaa930087145ff0a6ea	README.md
# 100644 blob e69de29bb2d1d6434b8b29ae775ad8c2e48c5391	calc/__init__.py
# 100644 blob 4c2d043433fc9034162263996307f6c2937e9888	calc/ops.py
# 100755 blob 9af920c06484863da03effb6112ac87edcbdd2a6	run.sh
# 100644 blob e69de29bb2d1d6434b8b29ae775ad8c2e48c5391	tests/__init__.py
# 100644 blob 8f3031253e9270ae31976da616b74250d6e7d268	tests/test_ops.py
```

*代码 16：-r 表示递归。列出来的内容和代码 12 的暂存区一一对应，只是少了序号那一列。*

## 六、commit：记下 tree 和上一个提交

最后一个对象就是提交本身：

```bash
git cat-file -t main
# commit

git cat-file -p main
# tree 1b27cd2a03537eb0f9172f2bab22a9b04dfe4dbc
# author Noimpty-zby <45208586@qq.com> 1792065600 +0800
# committer Noimpty-zby <45208586@qq.com> 1792065600 +0800
#
# 加法和减法
```

*代码 17：1792065600 是从 1970 年开始计算的秒数，也就是 2026 年 10 月 15 日 20:00，+0800 表示东八区。*

提交对象的内容并不多。第一行是根目录那个 tree 的编号，接着是作者（author）和提交者（committer）的名字、邮箱和时间，空一行之后是提交信息。作者是最初写下这些改动的人，提交者是生成这个提交的人，平时两者相同。第十一章 rebase 复制出来的提交，作者时间保留了原来的时间，提交时间则换成了执行 rebase 的时间。

这是仓库里的第一个提交，所以它没有 parent 这一行。从第二个提交开始，每个提交都会用 parent 记下上一个提交的编号，而第三章的合并提交则有两行 parent。

提交的编号也是按照第二节的方法算出来的，只是类型从 blob 换成了 commit：

```bash
git cat-file commit main | git hash-object -t commit --stdin
# 5f63edb021a593bbc08f5ee37745d62b5bf4d65c
```

*代码 18：git cat-file commit 输出提交对象原本的内容，-t commit 让 hash-object 按提交对象来计算编号。*

算出来的正是 5f63edb。因为提交号是从这些内容算出来的，所以其中任何一处改动都会得到一个新的编号。改一个字的提交信息，或者换一个提交时间，提交号都会不同，这就是第一章的 amend 一定会产生新提交的原因。又因为 tree 的编号代表了整个目录的内容，parent 的编号又代表了上一个提交，所以一个提交号实际上确定了这一刻全部的文件和之前全部的历史。第十一章 rebase 之后，后面的提交号也全都跟着变了，原因同样在这里，只要有一个提交被换掉，它后面每一个提交的 parent 都会改变。

## 七、refs 和 HEAD：给提交起名字

objects 里的对象都以编号命名，而分支、标签这些好记的名字，则放在 refs 目录里。现在 refs 里只有一个文件：

```bash
find .git/refs -type f
# .git/refs/heads/main

cat .git/refs/heads/main
# 5f63edb021a593bbc08f5ee37745d62b5bf4d65c

cat .git/HEAD
# ref: refs/heads/main
```

*代码 19：-type f 只列出文件，refs 下面空的 tags 目录不会显示。*

这就是第二章讲过的两层结构。refs/heads 下的每个文件是一个分支，里面记录着这个分支最新的那个提交的编号。HEAD 则记录着当前在哪个分支上，也就是 heads 里的哪一个文件。heads 和 HEAD 的名字很像，但它们是两样不同的东西，heads 目录里放的是所有的分支，而 HEAD 只有一个，表示现在所在的位置。

接下来给这个提交打一个带注释的标签，再推送到代替 GitHub 的裸仓库 github/pycalc.git 上，这时 refs 里就多出了两个文件：

```bash
git tag -a v0.1.0 -m "第一个版本"
git remote add origin ../github/pycalc.git
git push -u origin main --follow-tags
# （推送的输出省略）

find .git/refs -type f
# .git/refs/tags/v0.1.0
# .git/refs/heads/main
# .git/refs/remotes/origin/main

cat .git/refs/tags/v0.1.0
# 4227212b9370c5250aeabd68c7323bd1aa984b52

git cat-file -t v0.1.0
# tag

cat .git/refs/remotes/origin/main
# 5f63edb021a593bbc08f5ee37745d62b5bf4d65c
```

*代码 20：v0.1.0 的文件里记的是标签对象的编号 4227212，而不是提交号 5f63edb。*

tags 目录下的文件就是上一章的标签。轻量标签的文件里记的是提交号，带注释的标签记的则是标签对象的编号，所以 v0.1.0 的文件里是 4227212，cat-file -t 得到的类型是 tag。remotes 目录下是第七章讲过的远程跟踪分支，origin/main 记录着上一次和 origin 通信时，origin 上的 main 指向哪个提交。至于 origin 的地址，则和第七章看到的一样，写在 .git/config 的 [remote "origin"] 这一节里，refs 里只有这些编号。

HEAD 里的内容也不一定是分支名。切换到一个标签上时，就会进入分离头指针状态，这时 HEAD 里直接写着一个提交号：

```bash
git switch --detach v0.1.0
# HEAD is now at 5f63edb 加法和减法

cat .git/HEAD
# 5f63edb021a593bbc08f5ee37745d62b5bf4d65c

git switch main
# Switched to branch 'main'
# Your branch is up to date with 'origin/main'.

cat .git/HEAD
# ref: refs/heads/main
```

*代码 21：git checkout v0.1.0 的效果相同，只是会多打印一段关于分离头指针的提示。*

注意 HEAD 里写的是提交号 5f63edb，而不是 refs/tags/v0.1.0 里的标签对象 4227212。这是因为 HEAD 必须指向一个提交，所以 Git 会顺着标签对象找到它指向的那个提交，再把提交号写进 HEAD。

到这里，从 HEAD 到文件内容的整条链就完整了：

![从 HEAD 到 blob 的整条链](/img/posts/git-internals/commit-tree-blob.svg)

*图 1：pycalc 第一个提交里的 9 个对象，加上 HEAD 和 main 这两个文件。两个 \_\_init\_\_.py 指向同一个空的 blob e69de29。*

HEAD 记着分支名，分支文件记着提交号，提交记着根目录的 tree，tree 再一层一层地记着子目录的 tree 和文件的 blob。前面几章的命令大多是在读写这几样东西。比如 git commit 会写入新的 tree 和 commit（blob 在 add 的时候就已经写好了），然后改写分支文件里的提交号；git switch 则改写 HEAD，再按照目标提交的 tree 刷新工作区。

## 八、再提交一次：没有变化的文件不会再存一份

第四章说过，Git 保存的是每一个版本的完整快照。如果每次提交都把所有文件重新存一份，那么仓库很快就会变得很大，但实际上并不是这样。下面在 ops.py 的末尾加上乘法，其他五个文件都不改，然后再提交一次：

```python
def mul(a, b):
    return a * b
```

*代码 22：加在 ops.py 末尾的乘法函数。*

```bash
find .git/objects -type f | wc -l
# 10

git commit -am "ops.py 加上乘法"
# [main 78b8efb] ops.py 加上乘法
#  1 file changed, 4 insertions(+)

find .git/objects -type f | wc -l
# 14
```

*代码 23：提交之前有 10 个对象，比第一次提交之后多出的那一个，是 v0.1.0 的标签对象。*

这一次只多了 4 个对象。为了弄清楚多出来的是哪 4 个，可以先打开新的提交，再对比两个提交的根目录：

```bash
git cat-file -p HEAD
# tree ddb2626c08c60ab891c4870e68541fb63c2fa0b3
# parent 5f63edb021a593bbc08f5ee37745d62b5bf4d65c
# author Noimpty-zby <45208586@qq.com> 1792067400 +0800
# committer Noimpty-zby <45208586@qq.com> 1792067400 +0800
#
# ops.py 加上乘法

git cat-file -p HEAD^{tree}
# 100644 blob d818af479443b8d36db5fbaa930087145ff0a6ea	README.md
# 040000 tree 0f9c4b937b55fabb54fefb3aab97460430c8e51e	calc
# 100755 blob 9af920c06484863da03effb6112ac87edcbdd2a6	run.sh
# 040000 tree 82e9896b502054de25d136e6df9f499bfaedd803	tests

git cat-file -p HEAD~1^{tree}
# 100644 blob d818af479443b8d36db5fbaa930087145ff0a6ea	README.md
# 040000 tree f40b3671df407e9a625f1124c3ce46b3b911029e	calc
# 100755 blob 9af920c06484863da03effb6112ac87edcbdd2a6	run.sh
# 040000 tree 82e9896b502054de25d136e6df9f499bfaedd803	tests
```

*代码 24：HEAD~1 是 HEAD 的上一个提交。两个根目录只有 calc 那一行不同。*

新的提交有了 parent 这一行，指向第一个提交 5f63edb。两个根目录里，README.md、run.sh 和 tests 的编号完全相同，因为它们的内容没有变化，所以新的 tree 直接引用了原来的对象。只有 calc 那一行变了，这是因为 calc 目录里的 ops.py 变了。也就是说，新增的 4 个对象依次是 ops.py 的新 blob、calc 的新 tree、根目录的新 tree 和新的提交。

![第二次提交复用了没有变化的对象](/img/posts/git-internals/second-commit.svg)

*图 2：粉色的是第二次提交新增的 4 个对象，中间一行是两个提交共用的对象。tests 下面的两个 blob 没有画出来，它们同样是共用的。*

所以每一个提交都记录着全部文件的完整快照，但是没有变化的文件和目录在仓库里只存一份，新的提交只需要存下变化了的文件，再加上从这个文件到根目录这一路上的 tree。另外，ops.py 只加了几行，Git 存下的却是一份完整的新 blob，并没有只存这几行改动。这也是第四章说改动是比较出来的原因，因为仓库里本来就没有保存改动。

## 九、克隆下来的仓库

前面看到的 refs 和 objects，都是在本地一个一个提交出来的。如果是从 GitHub 克隆下来的仓库，它们看起来会不太一样。下面以第七章克隆过的 octocat/Hello-World 为例：

```bash
git clone https://github.com/octocat/Hello-World
cd Hello-World

find .git/refs -type f
# .git/refs/heads/master
# .git/refs/remotes/origin/HEAD

cat .git/packed-refs
# # pack-refs with: peeled fully-peeled sorted
# 7fd1a60b01f91b314f59955a4e4d4e80d8edf11d refs/remotes/origin/master
# b1b3f9723831141a31a1a7252a213e216ea76e56 refs/remotes/origin/octocat-patch-1
# b3cbd5bbd7e81436d2eee04537ea2b4c0cad4cdf refs/remotes/origin/test
```

*代码 25：git clone 的输出省略。refs/remotes/origin/HEAD 里写的是 ref: refs/remotes/origin/master，它记录着远程仓库的默认分支。*

Hello-World 有三个远程分支，但是 refs/remotes/origin 下面只有一个 HEAD 文件，三个远程跟踪分支都写在 .git/packed-refs 这一个文件里，每行是一个编号和一个名字。如果一个仓库有成百上千个引用，每个引用各占一个文件，既浪费空间又影响速度，所以 Git 会把它们打包进 packed-refs。克隆的时候，Git 直接把引用写成打包的形式，平时执行 git gc 时也会打包。上一章 React 的仓库有一百多个标签，克隆之后 .git/refs/tags 是空的，这些标签都在 packed-refs 里。因此要列出仓库里的引用，应该用 `git show-ref` 这类命令，而不是直接去翻 refs 目录：

```bash
git show-ref
# 7fd1a60b01f91b314f59955a4e4d4e80d8edf11d refs/heads/master
# 7fd1a60b01f91b314f59955a4e4d4e80d8edf11d refs/remotes/origin/HEAD
# 7fd1a60b01f91b314f59955a4e4d4e80d8edf11d refs/remotes/origin/master
# b1b3f9723831141a31a1a7252a213e216ea76e56 refs/remotes/origin/octocat-patch-1
# b3cbd5bbd7e81436d2eee04537ea2b4c0cad4cdf refs/remotes/origin/test
```

*代码 26：散放的文件和 packed-refs 里的引用都列了出来。*

objects 目录也是一样。Hello-World 的对象并没有一个一个地放在 objects 下面，而是打包成了 pack 目录里的一个 .pack 文件，旁边的 .idx 是它的索引，用来按编号快速找到对象在 .pack 里的位置：

```bash
find .git/objects -type f
# .git/objects/pack/pack-755faf4b60c7641d1fa9a33a32bf2843850c45a7.idx
# .git/objects/pack/pack-755faf4b60c7641d1fa9a33a32bf2843850c45a7.pack

git count-objects -v
# count: 0
# size: 0
# in-pack: 13
# packs: 1
# size-pack: 2
# prune-packable: 0
# garbage: 0
# size-garbage: 0

git cat-file -p HEAD^{tree}
# 100644 blob 980a0d5f19a64b4b30a87d4206aade58726b60e3	README
```

*代码 27：count 是散放的对象个数，in-pack 是打包的对象个数，size-pack 的单位是 KiB。*

打包的时候，Git 还可以把内容相近的对象存成和另一个对象的差异，所以仓库实际占用的空间，比每个版本都存完整的文件要小得多。不过这只是存储上的压缩，对象的编号和内容都没有变化，cat-file 照样能按编号取出完整的内容。

## 小结

| 写法 | 作用和要点 |
| --- | --- |
| `--local` | config 只改这个仓库 |
| `--show-origin` | 设置来自哪个文件 |
| `hash-object` | 算编号，`-w` 才存 |
| `--stdin` | 读标准输入 |
| `cat-file -t` | 查看对象的类型 |
| `cat-file -p` | 打印对象的内容 |
| `ls-files -s` | 列出暂存区 |
| `main^{tree}` | 提交的根目录 tree |
| `main:calc` | calc 目录的 tree |
| `ls-tree -r` | 递归列出所有文件 |
| `refs/` | 分支、标签等引用 |
| `HEAD` | 当前分支或提交号 |
| `packed-refs` | 打包在一起的引用 |
| `show-ref` | 列出所有引用 |

*表 1：命令都省略了开头的 git，refs/、HEAD 和 packed-refs 都在 .git 目录下。*

.git 目录里，config 保存这个仓库自己的配置，objects 保存所有的内容，refs 和 HEAD 则给这些内容起了好记的名字。objects 里的对象都以 SHA-1 编号命名，blob 保存文件的内容，tree 保存目录里每一项的名字和对应的对象，commit 保存根目录的 tree、上一个提交、作者和提交信息。因为编号是从内容算出来的，所以相同的内容只存一份，没有变化的文件在不同的提交之间共用同一个对象；而任何一处改动都会产生新的编号，并且一路影响到提交号。
