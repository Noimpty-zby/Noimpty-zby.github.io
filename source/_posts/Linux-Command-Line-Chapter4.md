---
title: Linux 命令行第四章：nano —— 屏幕最下面那两行就是全部说明书
date: 2026-09-19 14:46:00
description: Colt Steele《The Linux Command Line Bootcamp》第四章的复盘。nano 的快捷键不需要死记，因为它们一直印在屏幕最下面的两行上，这是它和 vim 最根本的区别。不过「按 ^S 保存」这件事背后，还有三个更值得弄清楚的问题，分别是 ^O 到底在问什么、文件从哪一刻起才真正存在，以及为什么那两行提示里至今都没有 ^S。
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

[第三章](/2026/09/05/Linux-Command-Line-Chapter3/) 讲到怎样创建一个文件，这一章接着讲怎样往文件里写内容。

课程把编辑器安排在 `cp`、`mv`、`rm` 这些文件操作之前，这是有道理的。服务器上没有记事本，需要修改一行配置的时候，手里只有一个终端。所以在那种场合下，编辑器并不是一个更方便的选择，而是唯一的办法。

nano 的命令少到几乎不需要记，所以这一篇不列快捷键表，只讲三件真正需要想清楚的事情，分别是它的界面为什么是这个样子、保存用的三个键各自做了什么，以及一个文件从哪一刻起才真正存在。下面引用的界面和提示语都取自 nano 6.2。

<!-- more -->

## 一、为什么第一个编辑器是 nano 而不是 vim

课程后面会讲 vim，但第一个介绍的是 nano，原因只有一个，那就是**它没有模式**。

打开 nano 之后，直接敲键盘，字就会出现在屏幕上，用起来和记事本一样。而打开 vim 之后，如果敲下 `hello`，屏幕上并不会出现 `hello`，因为这五个键在普通模式下是五条移动和编辑命令。这个区别听起来不大，实际上却决定了第一次使用时能不能顺利用起来。

nano 的定位在它自己的帮助页（`^G`）里写得很明白。它是 UW Pico 的复刻版，而 Pico 是 pine 邮件客户端里的那个编辑器，从一开始的设计目标就是「不需要学习」。

所以 nano 和 vim 之间并不是「简单」和「高级」的关系，而是两种不同的取舍。nano 把所有功能都摆在屏幕上，代价是所有快捷键都要按住 Ctrl；vim 把功能藏在不同的模式里，换来的是双手不需要离开主键区。先学 nano，是因为修改一行配置这样的小事，不应该先花两个小时去学一个编辑器。

## 二、屏幕分成四块，最下面两块是给你看的

这是使用 nano 时最应该先看懂的内容。帮助页里的原文是这样的：

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

*图 1：四个区域里只有一个是文件本身，另外三个一直在提示当前的状态和可以按的键。*

真实的屏幕是下面这个样子（执行 `nano List.txt`，输入一行文字，再按 `^S`）：

```
  GNU nano 6.2                      work/List.txt
buy milk

                                [ Wrote 1 line ]
^G Help      ^O Write Out ^W Where Is  ^K Cut       ^T Execute   ^C Location
^X Exit      ^R Read File ^\ Replace   ^U Paste     ^J Justify   ^/ Go To Line
```

*代码 2：中间的空行省略了。*

这里有三点值得单独记住。

**第一，标题栏末尾的那个 `*`，是唯一能看出文件有没有保存的地方。** 修改内容之后，标题栏会变成 `work/List.txt *`，按下 `^S` 之后，星号就会消失。（这是因为 Ubuntu 的 `/etc/nanorc` 里开启了 `set stateflags`，所以标记才是这个样子，在别的发行版上可能会显示成 `Modified`。）

**第二，状态行的信息是一次性的。** 「写入了几行」「出现了什么错误」这些信息都显示在倒数第三行，但是**只要再按一个键，它就会被清除**。所以出现错误时，要当场看清楚。

**第三，最下面的那两行并不是装饰，而是说明书。** 这就是 nano 全部的设计思路，它把所有功能都摆在明面上。如果忘了怎么退出，低头看一眼就能看到 `^X Exit`；如果忘了怎么搜索，就看 `^W Where Is`。所以使用 nano 的正确方式就是不去背快捷键。

## 三、`^` 和 `M-` 是哪两个键

帮助页里的原文如下：

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

关键在于 **depending on your keyboard setup** 这半句话。Meta 是一个逻辑上的修饰键，它具体对应哪个物理按键，取决于键盘和终端，而不取决于操作系统。更有用的是后半句的意思，**Esc 可以代替这两个修饰键**。如果通过 SSH 登录到别人的机器上，或者 Alt 键被终端软件自己占用了，又或者使用的客户端不支持 Alt 键，用 `Esc` 的方法总是能行得通。

## 四、从建文件夹到开始编辑

一个最简单的完整流程如下：

```bash
mkdir ToDoList
cd ToDoList
touch List.txt
nano List.txt
```

*代码 4：一共四步，中间那个 `cd` 不能省略。*

`mkdir` 只负责创建目录，**并不会自动进入这个目录**。如果少了 `cd` 这一步，`touch List.txt` 里的 `List.txt` 就是一条相对路径，它的起点仍然是原来的工作目录。这样创建出来的文件会和 `ToDoList/` 并排放在一起，而不是放在它的里面。如果不想切换目录，也可以把路径写完整：

```bash
mkdir ToDoList
touch ToDoList/List.txt
nano ToDoList/List.txt
```

*代码 5：等价的写法。*

在 nano 里，路径还有一个特别隐蔽的地方，那就是**路径写错时，它不会当场阻止你**。

```bash
nano nope/List.txt      # nope 这个目录并不存在
```

*代码 6：往一个不存在的目录里写文件。*

这时 nano 会照常打开，也可以正常输入内容，一切看起来都很正常，直到按下 `^S` 的时候：

```
         [ Error writing nope/List.txt: No such file or directory ]
```

*代码 7：直到这时，状态行才会报错。*

也就是说，路径写错的后果要等到写完内容之后才会出现，而这条错误信息一闪就没了。这正是上一节说「状态行要当场看」的实际意义。

（另外，如果 `nano` 后面跟的是一个目录，它会直接拒绝打开，状态行会显示 `[ "ToDoList" is a directory ]`，然后打开一个空的 `New Buffer`。）

## 五、保存有三条路，其中两条会写盘

`^S`、`^O` 和 `^X` 做的是三件不同的事情。

![^S、^O、^X 三条保存路线各自做了什么](/img/posts/linux-nano/save-paths.svg)

*图 2：`^X` 并不是「保存并退出」，它只是在退出之前替你问一句。*

### 5.1 `^S`：写回当前文件名，不问任何问题

```
                                [ Wrote 1 line ]
```

*代码 8：状态行的回应，同时标题栏的 `*` 消失。*

这里有一个例外。**如果这个缓冲区还没有名字**（比如直接执行不带参数的 `nano`），`^S` 就会转而询问文件名，这时标题栏显示的是 `New Buffer`。

### 5.2 `^O`：它问的是「写到哪个文件」

按下 `^O` 之后，屏幕最下面会变成这样：

```
File Name to Write: work/List.txt
^G Help             M-D DOS Format      M-A Append          M-B Backup File
^C Cancel           M-M Mac Format      M-P Prepend         ^T Browse
```

*代码 9：`^O` 的提示语和副选项，文件名是**预先填好的**。*

这个功能叫作 Write Out，意思是把内容写到哪里去。因为文件名已经预先填好了，所以直接按回车的效果和 `^S` 一样。只有把文件名改掉，它才会变成「另存为」，而且 nano 6.2 还会再确认一次：

```
Save file under DIFFERENT NAME?
 Y Yes
 N No           ^C Cancel
```

*代码 10：只有修改了文件名，才会出现这个二次确认。*

选择 `Y` 之后，新的内容会写进新文件，原文件一个字节都不会改变。但是**标题栏也会随之换成新的文件名**，也就是说，从这一刻起，正在编辑的已经是新文件了，之后再按 `^S`，内容也会写进新文件。有时候本来只想备份一份，结果后面的所有修改都没有写进原文件，原因就在这里。

副选项那两行是 `^O` 特有的功能。`M-A` 表示追加到文件末尾，`M-P` 表示插入到文件开头，`M-B` 表示在写入之前先保留一份备份，`M-D` 表示保存成 CRLF 换行的 DOS 格式。

### 5.3 `^X`：它自己不写盘

`^X` 的意思是退出（Exit）。如果没有修改过内容，就直接退出；如果有修改，它会先问一句：

```
Save modified buffer?
 Y Yes
 N No           ^C Cancel
```

*代码 11：三个选项。*

选择 `Y` 会转到 `^O` 那条路径上，询问要保存的文件名；选择 `N` 会丢弃所有修改，磁盘上的内容不会有任何变化；选择 `^C` 则会回到编辑状态。所以**把 `^X` 当成「保存并退出」来用是很危险的**，如果手快连续按下 `^X` 和 `N`，这次的编辑就全部白做了。

## 六、为什么那两行提示里至今没有 `^S`

回头再看代码 2 的最后两行，可以发现 `^O Write Out` 在里面，而 `^S` 却不在。但是 `^S` 明明是可以用的。

这是因为 `^S` 在终端里原本有另一个身份，它表示 **XOFF，也就是暂停输出**。这个设定至今仍然存在，`stty -a` 输出里的 `ixon` 默认是开启的。在 shell 里按下 `^S`，屏幕就会卡住不动，要按 `^Q` 才能恢复。所以早期的 nano 干脆忽略这个按键，它自带的 `NEWS` 文件里写着「Nano now ignores XOFF (^S) to stop accidental lock-ups」。直到 2017 年 11 月发布的 2.9.0 版本，这个做法才改变：

```
2017.11.18 - GNU nano 2.9.0 "Eta" ... makes ^Q and ^S do something
             useful by default (^Q starts a backward search, and ^S
             saves the current file)
```

*代码 12：摘自 `/usr/share/doc/nano/NEWS.gz`。*

也就是说，**用 `^S` 保存是一个只有八年历史的新习惯**，在 nano 版本低于 2.9 的机器上，按下 `^S` 什么也不会发生。这个结论正好和第二节相呼应。在自己的机器上可以随手按 `^S`，但是到了别人的机器上，最好先低头看看那两行提示，因为它们显示的永远是当前这个版本中真正有效的按键。

## 七、文件是从哪一刻开始存在的

执行 `nano ShoppingList.txt` 时，它**不会**像 `touch` 那样立即创建一个空文件。如果打开一个不存在的文件，什么都不修改就按 `^X` 退出，目录里仍然是空的。这两条命令对「文件不存在」这种情况的处理方式完全相反：

| | 目标不存在时 | 什么时候碰磁盘 |
| --- | --- | --- |
| `touch a.txt` | 立刻建一个空文件 | 敲下回车的那一刻 |
| `nano a.txt` | 只在内存里开一个空缓冲区，状态行提示 `[ New File ]` | **你按下 `^S` / `^O` 的那一刻** |

![打开、输入、保存三步里，内存和磁盘各自的状态](/img/posts/linux-nano/buffer-vs-disk.svg)

*图 3：在按下保存之前，写下的内容一个字节都不在磁盘上。*

由这条规则还可以推出另一个结论。当终端被强行关闭时（比如 SSH 断线，或者窗口被直接关掉），nano 会收到 `SIGHUP` 信号，这时它会把还没来得及保存的缓冲区抢救出来，存到 `<原名>.save` 文件里：

```bash
ls -A
# ShoppingList.txt.save
```

*代码 13：原来的文件名 `ShoppingList.txt` 始终没有出现过。*

所以**断线之后，先看看有没有 `.save` 文件**，不要急着重新写。内容其实还在，只是换了一个名字。

## 八、查找与替换：两个键进的是同一个框

`^W` 的意思是 Where Is，也就是查找：

```
Search:
^G Help         M-C Case Sens   M-B Backwards   ^P Older        ^T Go To Line
^C Cancel       M-R Reg.exp.    ^R Replace      ^N Newer
```

*代码 14：`^W` 的提示和副选项。*

`^\` 的意思是 Replace，也就是替换。按下它之后，提示语会变成 `Search (to replace):`，副选项里对应的位置也会变成 `^R No Replace`。**这两个键其实是同一个输入框的两个入口，进入之后还可以用 `^R` 来回切换。**

| 键 | 作用 |
| --- | --- |
| `M-C` | Case Sens，**开启**区分大小写 |
| `M-R` | Reg.exp.，把输入当正则 |
| `M-B` | Backwards，往回搜 |
| `^P` / `^N` | 翻搜索历史 |

需要注意 `M-C` 那一行的说法，**它的作用是「开启」区分大小写，这意味着默认情况下是不区分大小写的**。这个默认值真的会带来问题：

```
文件内容：      Apple / banana / apple pie
^\ 搜 apple，替换成 kiwi，按 A 全部替换
结果：          kiwi / banana / kiwi pie
```

*代码 15：`Apple` 也被替换掉了，而且变成了小写的 `kiwi`。*

这里同时发生了两件事。一方面，搜索不区分大小写，所以 `Apple` 也被匹配到了；另一方面，替换时会照搬输入的字符串，并不会保留原来的大小写。如果用这个功能批量修改标识符，很容易一次就改出两个 bug。解决办法有两种，一是先按 `M-C` 开启区分大小写，二是逐个确认替换（提示语是 `Replace this instance?`，按 `A` 表示从当前位置开始全部替换）。

## 九、其余几个常用键

剪切和粘贴并不是 `^C` 和 `^V`，看一眼代码 2 就能知道，它们分别是 `^K Cut` 和 `^U Paste`，而 `^C` 在 nano 里的作用是 `Location`，也就是报告光标的位置。这是因为在终端里，`^C` 一直用来发送中断信号，`^V` 和 `^Z` 也各有各的传统用途，所以终端程序一般都不会占用这几个键。

`^K` 有一个不太直观但很好用的特点，那就是**连续按下时，剪切的内容会累积起来**。在 `one / two / three` 上连续按两次 `^K`，剪下来的是 `one` 和 `two` 合在一起的一整块内容，按 `^U` 时会把它们一起粘贴回去。

| 键 | 作用 |
| --- | --- |
| `M-U` / `M-E` | 撤销 / 重做 |
| `M-A`（或 `^6`） | 从光标处开始选中，再配合 `^K` 剪选中的部分 |
| `^/` | 跳到指定行，提示是 `Enter line number, column number:` |
| `^C` | 报告位置，例如 `[ line 1399/2001 (69%), col 1/10 (10%) ]` |

`M-U` 还有一个细节，**如果一直撤销到内容和磁盘上的文件一致，标题栏的 `*` 就会自动消失**，同时状态行提示 `[ Nothing to undo ]`。这说明 nano 比较的是文件的内容，而不是修改过几次。

行号也可以直接在命令行上指定：

```
Usage: nano [OPTIONS] [[+LINE[,COLUMN]] FILE]...
```

*代码 16：`nano +1399 List.txt` 会打开文件并跳到第 1399 行，逗号后面还可以跟上列号。如果行号超过了文件的长度，也不会报错，光标会停在文件末尾。*

`^R` 的作用是插入另一个文件的内容，提示语是 `File to insert [from ./]:`。它的两个副选项比主功能更实用。`M-F` 会把那个文件打开成**另一个缓冲区**，而不是插入到当前文件里；`^X` 则会**把一条命令的输出直接插入到光标所在的位置**，写 README 时需要贴上目录结构，用它就很方便。

## 十、两个容易被忽略的行为

**第一，保存时 nano 会自动补上一个换行符。** 打开一个末尾没有换行符的文件，什么都不修改就按 `^S` 保存，文件的大小会从 19 字节变成 20 字节，末尾多出一个 `0a`。在 Unix 环境里，这是「正确」的做法，因为 POSIX 对文本文件的定义就要求每一行都以换行符结尾，`nano --help` 里也写着可以用 `-L` / `--nonewlines` 关闭这个行为。之所以需要知道这一点，是因为 `git diff` 里那句 `\ No newline at end of file` 说的就是这件事。如果用 nano 打开别人的文件看了一眼，又保存了一次，diff 里就会多出一处谁都没有写过的修改。

**第二，编辑时会留下锁文件。** Debian 和 Ubuntu 的 `/etc/nanorc` 里开启了 `set locking`，所以在编辑 `f.txt` 时，同一个目录下会多出一个 `.f.txt.swp` 文件。这时如果在另一个终端里打开同一个文件，nano 会阻止你：

```
File work/f.txt is being edited by zby (with nano 6.2, PID 20285); open anyway?
 Y Yes
 N No           ^C Cancel
```

*代码 17：提示里甚至写明了是谁、用的哪个版本、PID 是多少。正常退出之后，`.swp` 文件会被自动删除。*

所以看到目录里出现了 `.xxx.swp` 这样的文件，不必惊慌。它通常意味着某个地方还有一个没有退出的编辑器，或者上一次编辑器是被强制结束的。

另外，在 Debian 和 Ubuntu 上，`git commit` 默认打开的编辑器也是 nano（`/usr/bin/editor` 通过 alternatives 机制指向它），这也是应该先学会 nano 的又一个理由。

## 十一、`~/.nanorc`：值得先写进去的几行

nano 的配置文件是 `~/.nanorc`，每行写一条配置，每一条都能在 `nano --help` 列出的长选项里找到对应的项。修改之后不需要重启任何东西，下次打开 nano 时就会生效。

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

按照「它在回答哪个问题」把这一章的内容重新排列一遍：

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

这一章真正的收获并不在快捷键表上，而在于下面两件事。

**第一件事是，说明书就印在屏幕上。** nano 把它能做的事情都写在了最下面两行里，这不仅仅是对新手友好，更意味着在任何一台陌生的机器上，都不需要事先知道这个版本支持哪些功能。上一章讲 `file` 时说过，名字可能会骗人，但文件开头的那几个字节不会，这里也是同样的思路。与其依赖记忆里的知识，不如依赖眼前这台机器自己给出的事实。`^S` 的那段历史正好是一个反面的例子，因为记忆会过时，而屏幕上的提示不会。

**第二件事是，缓冲区和文件是两样不同的东西。** 在 nano 里输入的每一个字，在按下保存之前都只存在于内存中。所以打开一个不存在的文件并不会创建它；编辑到一半时终端断开，内容会被保存成 `.save` 文件；另存为之后，正在编辑的已经是另一个文件。这三件看起来毫不相关的事情，其实都是从这一条推出来的。以后学习 vim 的 `.swp` 文件、学习重定向、学习进程被结束时会发生什么，都会一再回到这个问题上。

下一章回到文件本身，讲[复制、移动和删除](/2026/09/19/Linux-Command-Line-Chapter5/)。
