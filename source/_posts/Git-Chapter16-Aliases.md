---
title: Git 第十六章：在 ~/.gitconfig 里给常用命令起别名
date: 2026-10-17 17:42:00
description: Colt Steele《The Git & Github Bootcamp》最后一章的复盘。git config --global 写进家目录的 ~/.gitconfig，对当前用户的所有仓库生效；Git 按系统级、全局、仓库的顺序读配置，同一项以最后读到的为准。在 ~/.gitconfig 的 [alias] 一节里写上 s = status，git s 就等于 git status，后面的参数会原样接在展开的命令后面。也可以用 git config --global alias.b branch 添加别名，值有好几个词时要加引号，否则 git config 只会存下第一个词，而且不报错。别名不能覆盖 Git 已有的命令，以感叹号开头的别名会交给 Shell 执行。GitAlias 仓库收集了三百多个别名，用 include.path 引入时，它和自己的 [alias] 谁写在后面，重名的别名就用谁的。
categories:
  - [课外, AI Infra, Git]
tags:
  - git config
  - .gitconfig
  - alias
  - 别名
  - GitAlias
cover: /img/covers/Git-Chapter16-Aliases.svg
series: Git
privacy: protected
sitemap: false
private_section: 课外
---

第十四章打开 .git/config 时提到过，`git config --global` 的设置写在家目录的 ~/.gitconfig 里，对这台电脑上的所有仓库都生效，而 `--local` 写进仓库自己的 .git/config，并且优先于全局的设置。这一章是这门课的最后一章，回到 ~/.gitconfig 这个文件，看看它和仓库的配置是怎样一起起作用的，然后在里面给常用的命令起一些简短的**别名**（alias），比如让 git s 等于 git status。

<!-- more -->

## 一、全局配置文件 ~/.gitconfig

这一章接着用上一章的 minicalc。到目前为止，全局配置里只有第一章设置的名字和邮箱，以及第七章设置的默认分支名：

```bash
cat ~/.gitconfig
# [user]
# 	name = Noimpty-zby
# 	email = 45208586@qq.com
# [init]
# 	defaultBranch = main
```

*代码 1：git config --global 写下的内容。*

它的格式和 .git/config 完全一样，方括号里是节的名字，下面每一行是「名字 = 值」，所以 user.name 就是 [user] 这一节里的 name。这个文件可以直接用编辑器打开修改，也可以执行 `git config --global --edit`，让 Git 用配置好的编辑器打开它。

在 minicalc 里执行 `git config --list`，可以列出这个仓库里所有生效的配置。加上 `--show-scope`，每一项前面还会标出它来自哪一层：

```bash
git config --list --show-scope
# global	user.name=Noimpty-zby
# global	user.email=45208586@qq.com
# global	init.defaultbranch=main
# local	core.repositoryformatversion=0
# local	core.filemode=true
# local	core.bare=false
# local	core.logallrefupdates=true
# local	remote.origin.url=../github/minicalc.git
# local	remote.origin.fetch=+refs/heads/*:refs/remotes/origin/*
# local	branch.main.remote=origin
# local	branch.main.merge=refs/heads/main
```

*代码 2：配置项的名字不区分大小写，所以列出来的 defaultBranch 变成了小写。第十四章用过的 --show-origin 显示的则是具体的文件路径。*

global 的几项来自 ~/.gitconfig，local 的几项来自 .git/config，其中 remote 和 branch 开头的四项，是上一章推送到裸仓库时，git remote add 和 git push -u 写下的。除了这两层，Git 还会读一个系统级的配置文件 /etc/gitconfig，它对这台电脑上的所有用户都生效，用 `--system` 读写。不过这个文件不一定存在，比如这台电脑上就没有：

```bash
git config --system --list
# fatal: unable to read config file '/etc/gitconfig': No such file or directory
```

*代码 3：退出码是 128。*

Git 读配置的顺序是系统级、全局、仓库，如果同一项在几个文件里都有，那么以最后读到的值为准。手册里的原话是 with last value found taking precedence over values read earlier。第十四章的仓库邮箱能覆盖全局邮箱，就是因为 .git/config 是最后读的。也就是说，全局配置适合放对所有仓库都一样的设置，而个别仓库需要不同的值时，再用 `--local` 单独覆盖。

## 二、在 [alias] 一节里定义别名

别名也是写在配置文件里的。用编辑器打开 ~/.gitconfig，在末尾加上一个 [alias] 节：

```ini
[alias]
	s = status
	l = log
```

*代码 4：等号左边是别名，右边是它代表的命令，命令前面不写 git。*

保存之后，git s 就等于 git status，git l 就等于 git log：

```bash
git s
# On branch main
# Your branch is up to date with 'origin/main'.
#
# nothing to commit, working tree clean

git l --oneline -3
# f74976d 修正测试里拼错的函数名
# 9db7669 补上除法的测试
# fe90721 除法检查除数是否为 0
```

*代码 5：git l 后面的 --oneline -3 原样传给了 git log。*

Git 遇到一个不认识的子命令时，会先去配置里找有没有同名的别名。如果找到了，那么就把这个名字换成别名的值，后面的参数原样接在后面，所以 git l --oneline -3 执行的就是 git log --oneline -3。因为这两行写在 ~/.gitconfig 里，所以这台电脑上的每个仓库都可以这样用。如果忘了某个别名代表什么，那么可以用 git help 查看：

```bash
git help s
# 's' is aliased to 'status'
```

*代码 6：对别名执行 git help，只会显示它展开之后的命令，而不会打开手册。*

## 三、用 git config 添加和删除别名

不打开编辑器也可以添加别名，别名在配置里的名字是 alias 加上一个点和别名本身，所以用 git config 设置 alias.b 就可以了：

```bash
git config --global alias.b branch

cat ~/.gitconfig
# [user]
# 	name = Noimpty-zby
# 	email = 45208586@qq.com
# [init]
# 	defaultBranch = main
# [alias]
# 	s = status
# 	l = log
# 	b = branch

git b -v
# * main f74976d 修正测试里拼错的函数名
```

*代码 7：因为文件里已经有了 [alias] 这一节，所以 git config 把新的一行加在了这一节的末尾。*

想看看已经定义了哪些别名，可以用 `--get-regexp` 列出名字能匹配 alias 的所有配置项：

```bash
git config --global --get-regexp alias
# alias.s status
# alias.l log
# alias.b branch
```

*代码 8：--get-regexp 的参数是一个正则表达式，这里只要名字里含有 alias 就会列出来。*

如果别名代表的命令有好几个词，比如想让 git lg 等于 git log --oneline --graph，那么整个值要用引号括起来。不加引号的话，Shell 会把它们拆成几个独立的参数，而 git config 设置一项时只接受名字和值，第三个参数会被当成另一种用途的匹配条件。这时 git config 并不会报错，存下来的值却只有第一个词：

```bash
git config --global alias.lg log --oneline

git config --global --get alias.lg
# log
```

*代码 9：两条命令的退出码都是 0。--get 读出 alias.lg 的值，只有 log。*

这时执行 git lg 得到的是完整格式的 git log，而不是一行一个提交。如果再多一个词，写成 log --oneline --graph，那么 git config 收到的参数就太多了，它会直接打印出用法说明并退出，退出码是 129。所以带空格的值一定要加引号：

```bash
git config --global alias.lg 'log --oneline --graph'

git lg -3
# * f74976d 修正测试里拼错的函数名
# * 9db7669 补上除法的测试
# * fe90721 除法检查除数是否为 0
```

*代码 10：重新设置 alias.lg，新的值替换了原来的 log。*

和其他配置一样，不加 `--global` 时，别名会写进当前仓库的 .git/config，只在这个仓库里有效：

```bash
git config alias.ls ls-files

tail -n 2 .git/config
# [alias]
# 	ls = ls-files

git ls
# README.md
# ops.py
# test_ops.py

cd ..
git ls
# git: 'ls' is not a git command. See 'git --help'.
#
# The most similar command is
# 	lg
```

*代码 11：git ls-files 列出暂存区里的文件。离开 minicalc 之后，git ls 就不存在了，Git 只是在已有的命令和别名里找了一个最像的。*

不再需要的别名，用 `--unset` 删掉就可以了。删除之后再执行这个别名，Git 会把它当成一个写错的命令：

```bash
git config --global --unset alias.b

git b
# git: 'b' is not a git command. See 'git --help'.
#
# The most similar commands are
# 	bisect
# 	branch
# 	l
# 	s
```

*代码 12：退出码是 1。git config --unset alias.ls 同样可以删掉代码 11 里那个仓库自己的别名。*

## 四、别名不能覆盖已有的命令

既然参数可以写在别名里，那么能不能让 git status 默认就使用第五、六章用过的简短格式呢？那时写的 `-s` 就是 `--short` 的简写。试一下就会发现不行。下面先改动一下 README.md，再把 status 本身定义成别名：

```bash
git config --global alias.status 'status --short'

git status
# On branch main
# Your branch is up to date with 'origin/main'.
#
# Changes not staged for commit:
#   (use "git add <file>..." to update what will be committed)
#   (use "git restore <file>..." to discard changes in working directory)
# 	modified:   README.md
#
# no changes added to commit (use "git add" and/or "git commit -a")
```

*代码 13：git config 没有报错，但 git status 的输出仍然是完整的格式。*

这是因为 Git 只有在遇到不认识的子命令时才去找别名，而 status 是 Git 自己的命令，所以这个别名永远不会被用到。手册的解释是，为了避免混乱，也为了不影响脚本，和已有命令同名的别名会被忽略。比如别人写的脚本里调用了 git status，如果它的行为会随着每个人的配置改变，那么脚本解析输出时就会出错。所以想要一个带参数的 status，就要换一个新的名字：

```bash
git config --global --unset alias.status
git config --global alias.st 'status --short'

git st
#  M README.md
```

*代码 14：M 在第二列，表示 README.md 在工作区里改动过，还没有暂存。*

另外，如果别名的值以感叹号开头，那么 Git 不会把它当成 Git 的子命令，而是把整个值交给 Shell 执行，这样别名里就可以用管道组合好几条命令。需要注意的是，这种别名是在仓库的根目录下执行的，而不一定是当前所在的目录。下一节的 GitAlias 里就有不少这样的别名。

## 五、GitAlias 收集的现成别名

笔记里提到的 [GitAlias/gitalias](https://github.com/GitAlias/gitalias) 是一个专门收集别名的仓库。它的全部内容都在 gitalias.txt 这一个文件里，写法和 ~/.gitconfig 一样，截至 2026 年 8 月的版本有 1840 行，一共定义了 325 个别名。最常用的命令都有一两个字母的短别名，比如 s = status、l = log、b = branch，和前面自己写的一样。

使用的方法是把这个文件下载下来，再在 ~/.gitconfig 里用 include.path 引入它。它的安装说明里给出的就是这两条命令，这里把文件存成家目录下的 .gitalias：

```bash
curl https://raw.githubusercontent.com/GitAlias/gitalias/main/gitalias.txt -o ~/.gitalias
git config --global include.path '~/.gitalias'

cat ~/.gitconfig
# [user]
# 	name = Noimpty-zby
# 	email = 45208586@qq.com
# [init]
# 	defaultBranch = main
# [alias]
# 	s = status
# 	l = log
# 	lg = log --oneline --graph
# 	st = status --short
# [include]
# 	path = ~/.gitalias

git config --get-regexp '^alias\.' | wc -l
# 329
```

*代码 15：curl 的输出省略。路径加上引号，文件里写下的就是 ~/.gitalias，由 Git 自己展开成家目录。329 是 gitalias.txt 的 325 个别名加上自己定义的 4 个。*

Git 读到 [include] 时，会在这个位置把 path 指向的文件读进来，效果就和把文件的内容粘贴在这里一样。不过这时执行 git lg，得到的又是完整格式的 log：

```bash
git lg -3
# * commit f74976d527980b39e35972ee915e87880410d155
# | Author: Noimpty-zby <45208586@qq.com>
# | Date:   Sat Oct 17 16:08:00 2026 +0800
# |
# |     修正测试里拼错的函数名
# |
# ……（另外两个提交省略）

git config --get-all --show-origin alias.lg
# file:……/.gitconfig	log --oneline --graph
# file:……/.gitalias	log --graph
```

*代码 16：……是家目录的路径。--get-all 列出 alias.lg 的所有值，按读取的顺序排列。*

原因是 gitalias.txt 里也定义了 lg，值是 log --graph。git config --global 把 [include] 加在了文件的末尾，所以 gitalias.txt 是在自己的 [alias] 之后才读入的。按照第一节的规则，同一项以最后读到的为准，于是自己的 lg 就被它覆盖了。gitalias.txt 开头的说明也提到了这一点，想改掉其中某些别名时，自己的定义要写在后面。

解决的方法是执行 `git config --global --edit`，把 [include] 这两行挪到 [alias] 的前面：

```bash
cat ~/.gitconfig
# [user]
# 	name = Noimpty-zby
# 	email = 45208586@qq.com
# [init]
# 	defaultBranch = main
# [include]
# 	path = ~/.gitalias
# [alias]
# 	s = status
# 	l = log
# 	lg = log --oneline --graph
# 	st = status --short

git lg -3
# * f74976d 修正测试里拼错的函数名
# * 9db7669 补上除法的测试
# * fe90721 除法检查除数是否为 0
```

*代码 17：现在 gitalias.txt 先读入，自己的 lg 后读入，所以 git lg 又恢复了一行一个提交。*

![Git 读取配置的顺序](/img/posts/git-aliases/config-order.svg)

*图 1：三层配置文件从左到右依次读入，[include] 引入的文件在它所在的位置读入。*

gitalias.txt 里有很多别名对应的正是前几章的命令。gitalias.txt 自己就定义了一个叫 aliases 的别名，用来列出所有别名，用它可以挑几个出来看看：

```bash
git aliases | grep -E '^(cm|lo|uncommit|rbc) '
# cm = commit --message
# lo = log --oneline
# rbc = rebase --continue
# uncommit = reset --soft HEAD~1

git help aliases
# 'aliases' is aliased to '!git config --get-regexp '^alias\.' | cut -c 7- | sed 's/ / = /''
```

*代码 18：uncommit 就是第六章撤销最后一次提交、但保留改动的写法，rbc 是第十一章解决冲突之后继续 rebase 的命令。*

aliases 的值以感叹号开头，所以它是交给 Shell 执行的。它先用 git config --get-regexp 列出所有的别名，再用 cut 去掉每行开头「alias.」这 6 个字符，最后用 sed 把第一个空格换成「 = 」。

325 个别名一下子是记不住的。比较实际的用法是先浏览一遍，把自己经常输入的那几条记下来；如果不想引入整个文件，那么也可以只把需要的几行抄进自己的 [alias] 里，gitalias.txt 开头的说明里也建议了这种用法。

## 小结

| 写法 | 作用和要点 |
| --- | --- |
| `~/.gitconfig` | 当前用户的全局配置 |
| `--global` | 读写全局配置 |
| `--show-scope` | 标出每项来自哪层 |
| `--edit` | 用编辑器打开 |
| `[alias]` | 定义别名的一节 |
| `alias.b` | 名为 b 的别名 |
| `--get-regexp` | 按名字查找配置 |
| `--unset` | 删除一项配置 |
| `help s` | 查看别名的内容 |
| `!` | 值交给 Shell 执行 |
| `include.path` | 引入另一个文件 |

*表 1：除了 help s 省略了开头的 git，其余的选项都用在 git config 后面。读配置的顺序是系统级、全局、仓库，同一项以最后读到的为准。*

~/.gitconfig 保存的是当前用户的全局配置，它和系统级的 /etc/gitconfig、仓库的 .git/config 按顺序一起读入，后读到的值会覆盖先读到的。别名写在 [alias] 一节里，Git 遇到不认识的子命令时就去这里查找，把别名换成它代表的命令，再接上后面的参数。添加别名时，带空格的值要加引号，和已有命令同名的别名不会生效。GitAlias 提供了现成的别名合集，用 include.path 引入时，要注意它和自己的 [alias] 谁在后面。

到这里，《The Git & Github Bootcamp》这门课就全部学完了。从第一章的工作区、暂存区和仓库开始，中间经过分支和合并、撤销、远程协作和 rebase，最后在第十四、十五章打开 .git 目录，可以看到前面这些命令读写的其实只有对象、引用和 reflog 这几样东西，而这一章的配置文件则决定了这些命令默认怎样执行。
