---
title: Linux 命令行第四章：nano —— 屏幕最下面那两行就是全部说明书
date: 2026-09-19 14:46:00
description: Colt Steele《The Linux Command Line Bootcamp》第四章的复盘。nano 的快捷键不需要背，因为它们一直印在屏幕最下面两行上——这是它和 vim 最根本的区别。但「按 ^S 保存」这件事底下还藏着三个更值得搞清楚的问题：^O 到底在问什么、文件从哪一刻起真正存在、以及为什么那两行提示里至今没有 ^S。
categories:
  - [课外, AI Infra, Linux入门]
tags:
  - nano
  - 文本编辑器
  - 文件系统操作
cover: /img/covers/Linux-Command-Line-Chapter4.svg
series: Linux 命令行
privacy: protected
sitemap: false
private_section: 课外
---

[第三章](/2026/09/05/Linux-Command-Line-Chapter3/) 结束在「怎么造一个文件」，这一章接着往里写东西。

课程把编辑器排在 `cp` / `mv` / `rm` 这些文件操作之前，是有道理的：服务器上没有记事本，改一行配置的时候，手里只有一个终端。**编辑器不是「会更方便」，是在那种场合下唯一的出路。**

nano 的命令少到几乎不用记，所以这一篇不列快捷键表，只讲三件真正需要想清楚的事：它的界面为什么长这样、保存的三个键各自在做什么、以及一个文件从哪一刻起真正存在。下面的界面和提示语都取自 nano 6.2。

<!-- more -->

## 一、为什么第一个编辑器是 nano 而不是 vim

课程后面会讲 vim。第一个拿出来的是 nano，原因只有一个：**它没有模式。**

打开它，敲键盘，字就上去了，和记事本一样。vim 打开之后你敲 `hello`，屏幕上不会出现 `hello`，因为那五个键在普通模式下是五条移动和编辑命令。这个区别听起来小，实际上决定了「第一次用能不能用成」。

nano 的定位它自己在帮助页（`^G`）里就写明了：它是 UW Pico 的复刻，而 Pico 是 pine 邮件客户端里那个编辑器——设计目标从第一天起就是「不用学」。

所以 nano 和 vim 不是「简单的」和「高级的」关系，而是两种取舍：nano 把所有能力都摊在屏幕上，代价是快捷键全都要按住 Ctrl；vim 把能力藏进模式里，换来手不离开主键区。先学 nano，是因为**改一行配置这件事，不该先花两小时学编辑器**。

## 二、屏幕分成四块，最下面两块是给你看的

这是 nano 最该先看懂的东西。帮助页里的原话：

```
There are four main sections of the editor.  The top line shows the program
version, the current filename being edited, and whether or not the file has
been modified.  Next is the main editor window showing the file being
edited.  The status line is the third line from the bottom and shows
important messages.  The bottom two lines show the most commonly used
shortcuts in the editor.
```

*代码 1：nano 对自己界面的说明。*

![nano 界面的四个区域：标题栏、编辑窗口、状态行、两行快捷键](/img/posts/linux-nano/nano-screen.svg)

*图 1：四块里只有一块是你的文件，另外三块一直在告诉你「现在是什么状态、能按什么键」。*

真实的屏幕长这样（`nano List.txt`，敲了一行字再按 `^S`）：

```
  GNU nano 6.2                      work/List.txt
buy milk

                                [ Wrote 1 line ]
^G Help      ^O Write Out ^W Where Is  ^K Cut       ^T Execute   ^C Location
^X Exit      ^R Read File ^\ Replace   ^U Paste     ^J Justify   ^/ Go To Line
```

*代码 2：中间的空行省略了。*

三个值得单独记的点：

**第一，标题栏末尾那个 `*` 是唯一能看出「存没存」的地方。** 改了字之后标题栏会变成 `work/List.txt *`，按下 `^S` 之后星号消失。（Ubuntu 的 `/etc/nanorc` 里开了 `set stateflags`，标记才是这个样子；别的发行版上可能显示成 `Modified`。）

**第二，状态行是一次性的。** 「写了几行」「报了什么错」都出现在倒数第三行，而**按下一个键它就会被清掉**。所以报错的时候要当场看。

**第三，最下面那两行不是装饰，是说明书。** 这就是 nano 的整个设计哲学：能力全摊在明面上。忘了怎么退出就低头看 `^X Exit`，忘了怎么搜就看 `^W Where Is`。**用 nano 的正确姿势是不背快捷键。**

## 三、`^` 和 `M-` 是哪两个键

帮助页的原文：

```
Shortcuts are written as follows: Control-key sequences are notated with
a '^' and can be entered either by using the Ctrl key or pressing the Esc
key twice.  Meta-key sequences are notated with 'M-' and can be entered
using either the Alt, Cmd, or Esc key, depending on your keyboard setup.
```

*代码 3：两个符号的读法。*

| 写法 | 怎么按 | 备选 |
| --- | --- | --- |
| `^X` | 按住 Ctrl 再按 X | **连按两下 Esc**，再按 X |
| `M-U` | 按住 Alt 再按 U（Mac 上是 Cmd 或 Option） | **按一下 Esc 松开**，再按 U |

关键是那句 **depending on your keyboard setup**：Meta 是一个逻辑上的修饰键，落在哪个物理键上取决于键盘和终端，而不是操作系统。更有用的是后半句——**Esc 可以顶替这两个修饰键**。SSH 到别人的机器上、Alt 被终端软件自己吃掉、或者用了某个不认 Alt 的客户端时，`Esc` 这条路永远通。

## 四、从建文件夹到开始编辑

一个最小的完整流程：

```bash
mkdir ToDoList
cd ToDoList
touch List.txt
nano List.txt
```

*代码 4：四步，中间那个 `cd` 不能省。*

`mkdir` 只负责建目录，**它不会把你带进去**。少了 `cd` 的话，`touch List.txt` 里的 `List.txt` 是一条相对路径，起点仍是原来的工作目录，文件会和 `ToDoList/` 并排躺着，而不是躺在它里面。不想切换目录就把路径写全：

```bash
mkdir ToDoList
touch ToDoList/List.txt
nano ToDoList/List.txt
```

*代码 5：等价的写法。*

路径这件事在 nano 上有个格外隐蔽的地方：**打错了它不会当场拦住你。**

```bash
nano nope/List.txt      # nope 这个目录并不存在
```

*代码 6：往一个不存在的目录里写文件。*

nano 照常打开、让你敲字、一切正常，直到按下 `^S`：

```
         [ Error writing nope/List.txt: No such file or directory ]
```

*代码 7：状态行到这时候才报错。*

**路径打错的代价是在你写完之后才结算的**，而这句话闪一下就没了。这就是上一节「状态行要当场看」的现实意义。

（另外，`nano` 后面跟一个目录会被直接拒绝：状态行写 `[ "ToDoList" is a directory ]`，然后给你一个空的 `New Buffer`。）

## 五、保存有三条路，其中两条会写盘

`^S`、`^O`、`^X` 干的是三件不同的事。

![^S、^O、^X 三条保存路线各自做了什么](/img/posts/linux-nano/save-paths.svg)

*图 2：`^X` 不是「保存并退出」，它只是在退出前替你问一句。*

### 5.1 `^S`：写回当前文件名，不问任何问题

```
                                [ Wrote 1 line ]
```

*代码 8：状态行的回应，同时标题栏的 `*` 消失。*

一个例外：**如果这个缓冲区还没有名字**（比如直接敲 `nano` 不带参数），`^S` 会退回去问名字——标题栏这时显示的是 `New Buffer`。

### 5.2 `^O`：它问的是「写到哪个文件」

按下 `^O`，屏幕最下面变成：

```
File Name to Write: work/List.txt
^G Help             M-D DOS Format      M-A Append          M-B Backup File
^C Cancel           M-M Mac Format      M-P Prepend         ^T Browse
```

*代码 9：`^O` 的提示语和副选项，文件名是**预填好的**。*

它的名字叫 Write Out——**输出到哪里**。名字已经替你填好，直接回车就等于 `^S`。只有把它改掉，它才变成「另存为」，而 nano 6.2 会再拦一道：

```
Save file under DIFFERENT NAME?
 Y Yes
 N No           ^C Cancel
```

*代码 10：改了名字才会出现的二次确认。*

选 `Y` 之后，新内容写进新文件，原文件一个字节都不动；**标题栏也会跟着换成新名字**——从这一刻起你编辑的是新文件，再按 `^S` 也是写进它。本来只想备份一份，结果后面所有修改都离开了原文件，就是这么发生的。

副选项那两行是 `^O` 独有的能力：`M-A` 追加到文件末尾、`M-P` 插到文件开头、`M-B` 写之前先留一份备份、`M-D` 存成 CRLF 换行的 DOS 格式。

### 5.3 `^X`：它自己不写盘

`^X` 是 Exit。没改动就直接退出，有改动才会拦一句：

```
Save modified buffer?
 Y Yes
 N No           ^C Cancel
```

*代码 11：三个选项。*

`Y` 会转去走 `^O` 那条路（问你文件名），`N` 是丢掉所有修改、磁盘上什么都不变，`^C` 是回去接着编辑。**把 `^X` 当成「保存并退出」来用是危险的**——手快连按 `^X`、`N`，这次编辑就白做了。

## 六、为什么那两行提示里至今没有 `^S`

回头看代码 2 的最后两行：`^O Write Out` 在，`^S` 不在。但 `^S` 明明能用。

因为 `^S` 在终端里原本有另一个身份：**XOFF，暂停输出**。这个设定至今还在——`stty -a` 里的 `ixon` 默认是开着的，在 shell 里按 `^S`，屏幕会卡住不动，`^Q` 才恢复。所以早年的 nano 干脆无视这个键，它自带的 `NEWS` 里写着「Nano now ignores XOFF (^S) to stop accidental lock-ups」。直到 2017 年 11 月的 2.9.0 才改口：

```
2017.11.18 - GNU nano 2.9.0 "Eta" ... makes ^Q and ^S do something
             useful by default (^Q starts a backward search, and ^S
             saves the current file)
```

*代码 12：摘自 `/usr/share/doc/nano/NEWS.gz`。*

也就是说，**`^S` 存盘是个只有八年历史的新习惯**，凡是 nano 版本低于 2.9 的机器上它什么也不干。结论正好呼应第二节：自己机器上随便按 `^S`，到了别人的机器上，先低头看那两行提示——它们显示的永远是这个版本真实生效的键。

## 七、文件是从哪一刻开始存在的

`nano ShoppingList.txt` **不会**像 `touch` 那样立刻创建一个空文件。打开一个不存在的文件、什么都不改直接 `^X`，目录里仍然是空的。这两条命令对「不存在」的处理方式完全相反：

| | 目标不存在时 | 什么时候碰磁盘 |
| --- | --- | --- |
| `touch a.txt` | 立刻建一个空文件 | 敲下回车的那一刻 |
| `nano a.txt` | 只在内存里开一个空缓冲区，状态行提示 `[ New File ]` | **你按下 `^S` / `^O` 的那一刻** |

![打开、输入、保存三步里，内存和磁盘各自的状态](/img/posts/linux-nano/buffer-vs-disk.svg)

*图 3：在你按下保存之前，你写的东西一个字节都不在磁盘上。*

这条规则还有一个推论：终端被强行关掉时（SSH 断线、窗口被叉掉），nano 收到 `SIGHUP`，会把来不及保存的缓冲区抢救到 `<原名>.save`：

```bash
ls -A
# ShoppingList.txt.save
```

*代码 13：原名 `ShoppingList.txt` 始终没有出现过。*

所以**断线之后先看一眼有没有 `.save` 文件**，别急着重写。内容在，只是换了个名字。

## 八、查找与替换：两个键进的是同一个框

`^W` 是 Where Is：

```
Search:
^G Help         M-C Case Sens   M-B Backwards   ^P Older        ^T Go To Line
^C Cancel       M-R Reg.exp.    ^R Replace      ^N Newer
```

*代码 14：`^W` 的提示和副选项。*

`^\` 是 Replace，提示语变成 `Search (to replace):`，副选项里对应的位置则变成 `^R No Replace`。**它俩其实是同一个输入框的两个入口，进去之后还能用 `^R` 来回切。**

| 键 | 作用 |
| --- | --- |
| `M-C` | Case Sens，**开启**区分大小写 |
| `M-R` | Reg.exp.，把输入当正则 |
| `M-B` | Backwards，往回搜 |
| `^P` / `^N` | 翻搜索历史 |

注意 `M-C` 那一行的措辞——**它是「开启」，意味着默认不区分大小写**。这是个会真的咬人的默认值：

```
文件内容：      Apple / banana / apple pie
^\ 搜 apple，替换成 kiwi，按 A 全部替换
结果：          kiwi / banana / kiwi pie
```

*代码 15：`Apple` 也被换掉了，而且换成了小写的 `kiwi`。*

两件事同时发生：搜索不区分大小写，所以 `Apple` 命中了；而替换是照抄你写的那个字符串，大小写不会被保留。拿它批量改标识符，很容易一次改出两个 bug。要么先按 `M-C` 打开大小写敏感，要么逐个确认（提示是 `Replace this instance?`，`A` 表示从当前位置起全部替换）。

## 九、其余几个常用键

剪切粘贴不是 `^C` / `^V`——看一眼代码 2 就知道，是 `^K Cut` 和 `^U Paste`，而 `^C` 在 nano 里是 `Location`（报告光标位置）。终端里 `^C` 历来是发中断信号，`^V`、`^Z` 也各有各的老用途，所以终端程序普遍不敢占用它们。

`^K` 有个不直觉但好用的性质：**连按是累积的**。在 `one / two / three` 上连按两次 `^K`，剪下来的是 `one` 和 `two` 合起来的一整块，`^U` 会把它们一起贴回去。

| 键 | 作用 |
| --- | --- |
| `M-U` / `M-E` | 撤销 / 重做 |
| `M-A`（或 `^6`） | 从光标处开始选中，再配合 `^K` 剪选中的部分 |
| `^/` | 跳到指定行，提示是 `Enter line number, column number:` |
| `^C` | 报告位置，例如 `[ line 1399/2001 (69%), col 1/10 (10%) ]` |

`M-U` 还有个细节：**一路撤销到和磁盘上一致时，标题栏的 `*` 会自己消失**，状态行提示 `[ Nothing to undo ]`。nano 比较的是内容，不是「你改过几次」。

行号也可以在命令行上直接给：

```
Usage: nano [OPTIONS] [[+LINE[,COLUMN]] FILE]...
```

*代码 16：`nano +1399 List.txt` 打开并跳到 1399 行，逗号后面还能跟列号。行号超过文件长度不报错，光标停在末尾。*

`^R` 是「插入另一个文件的内容」，提示是 `File to insert [from ./]:`。它的两个副选项比主功能更实用：`M-F` 把那个文件开成**另一个缓冲区**而不是插进来，`^X` 则是**把一条命令的输出直接插到光标位置**——写 README 贴目录结构的时候很省事。

## 十、两个容易被忽略的行为

**保存时 nano 会补一个换行。** 拿一个末尾没有换行的文件，什么都不改直接 `^S`，它会从 19 字节变成 20 字节，末尾多出一个 `0a`。这在 Unix 世界里是「正确」的行为（POSIX 对文本文件的定义就要求每行以换行结尾），`nano --help` 里也写着可以关掉：`-L` / `--nonewlines`。之所以要知道它：`git diff` 里那句 `\ No newline at end of file` 说的就是这件事——用 nano 打开别人的文件看一眼再存一次，diff 里会多出一行谁都没写过的改动。

**编辑时会留下锁文件。** Debian / Ubuntu 的 `/etc/nanorc` 开了 `set locking`，编辑 `f.txt` 时同目录下会多出一个 `.f.txt.swp`。这时在另一个终端打开同一个文件，它会拦住你：

```
File work/f.txt is being edited by zby (with nano 6.2, PID 20285); open anyway?
 Y Yes
 N No           ^C Cancel
```

*代码 17：连是谁、哪个版本、PID 多少都告诉你。正常退出后 `.swp` 会自动删掉。*

看到目录里冒出 `.xxx.swp` 不用慌，它多半意味着某个地方还开着一个没退出的编辑器，或者上次是被强杀的。

顺带一提，Debian / Ubuntu 上 `git commit` 默认打开的也是 nano（`/usr/bin/editor` 经 alternatives 指向它）——这是先学会它的又一个理由。

## 十一、`~/.nanorc`：值得先写进去的几行

nano 的配置文件是 `~/.nanorc`，一行一条，每一条都能在 `nano --help` 的长选项里找到对应。改完不用重启什么，下次打开就生效。

```bash
set linenumbers     # 左边显示行号（对应 -l）
set tabstospaces    # Tab 存成空格（对应 -E），改 YAML 时能救命
set constantshow    # 状态行常驻显示光标位置（对应 -c）
set softwrap        # 长行折行显示，而不是横向滚动（对应 -S）
set autoindent      # 回车后保持上一行的缩进（对应 -i）
set positionlog     # 记住上次关掉时光标停在哪（对应 -P）
```

*代码 18：一份够用的起步配置。*

## 小结

按「它在回答哪个问题」重排一遍：

| 问题 | 键 / 命令 | 要点 |
| --- | --- | --- |
| 快捷键怎么记 | 最下面两行 | 不用记。`^` 是 Ctrl（或两下 Esc），`M-` 是 Alt/Cmd（或一下 Esc） |
| 怎么保存 | `^S` | 2.9.0（2017-11）才有的，更老的版本上没有 |
| 存到哪去 | `^O` | 问的是「写到哪个文件」，改名 = 另存为，标题栏会跟着换 |
| 怎么退出 | `^X` | 它自己不写盘，只是替你问一句 |
| 存没存 | 标题栏的 `*` | 撤销回原样，`*` 也会自己消失 |
| 出错了吗 | 状态行 | 一次性的，按下一个键就没了 |
| 找和换 | `^W` / `^\` | 同一个框两个入口；**默认不区分大小写** |
| 剪贴 | `^K` / `^U` | 连按 `^K` 是累积成一块 |
| 跳到某行 | `nano +N f` / `^/` | 还能 `+行,列`；超出范围就停在末尾 |
| 插别的东西 | `^R` | 再按 `^X` 可以插一条命令的输出 |

这一章真正的收获不在快捷键表上，而是两件事。

**第一件是「说明书就在屏幕上」。** nano 把它能做的都写在最下面两行里，这不只是对新手友好——它意味着**你在任何一台陌生机器上都不需要预先知道这个版本支持什么**。上一章讲 `file` 时说过「名字会撒谎，开头那几个字节不会」，这里是同一种思路：别依赖记忆里的知识，依赖眼前这台机器自己给出的事实。`^S` 那段历史正是反例教材——记忆会过期，屏幕不会。

**第二件是「缓冲区和文件是两个东西」。** 在 nano 里敲的每一个字，在按下保存之前都只活在内存里。打开不存在的文件不会创建它，改到一半终端断了会变成 `.save`，另存为之后编辑的已经是另一个文件——这三件看起来不相干的事，全都是这一条的推论。后面学 vim 的 `.swp`、学重定向、学进程被杀掉时会发生什么，还会反复回到同一个位置上。

下一章回到文件本身：[复制、移动和删除](/2026/09/19/Linux-Command-Line-Chapter5/)。
