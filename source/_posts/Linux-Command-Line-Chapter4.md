---
title: Linux 命令行第四章：nano —— 屏幕最下面那两行就是全部说明书
date: 2026-09-19 14:46:00
description: Colt Steele《The Linux Command Line Bootcamp》第四章的复盘。nano 的快捷键不需要背，因为它们一直印在屏幕最下面两行上——这是它和 vim 最根本的区别。但「按 ^S 保存」这件事底下藏着三个更值得搞清楚的问题：^O 到底在问什么、文件什么时候才真的落到磁盘、以及为什么那两行提示里至今没有 ^S。本章所有结论都在 nano 6.2 上实际敲过一遍。
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

[第三章](/2026/09/05/Linux-Command-Line-Chapter3/) 结束在「怎么造一个文件」，这一章就是接着往里写东西。

顺便认个错：第三章最后我写的是「下一章开始是复制、移动、删除，以及通配符」——猜错了，课程在这里先插了一章编辑器。插得有道理：`cp` / `mv` / `rm` 是搬运文件，而到了真的要改一行配置的时候，服务器上没有记事本可用，你手里只有一个终端。**编辑器不是「会更方便」，是在那种场合下唯一的出路。**

这一篇的主角是 `nano`。它的命令少到几乎不用记——但正因为少，我在笔记里写下的那几条反而每一条都留了个尾巴：保存到底保到哪去了、`^O` 在问什么、以及这个文件是从哪一刻起真正存在的。这一篇把这些尾巴一个个揪出来，**下面每一条结论都在这台机器的 nano 6.2 上实际敲过一遍**，屏幕上的原话直接抄过来。

<!-- more -->

## 一、为什么第一个编辑器是 nano 而不是 vim

课程后面是要讲 vim 的（[课程覆盖](/extra/ai-infra/linux/intro/) 里列着）。但第一个拿出来的是 nano，原因只有一个：

**nano 没有模式。** 打开它，敲键盘，字就上去了——和记事本一样。vim 打开之后你敲 `hello`，屏幕上不会出现 `hello`，因为那五个键在普通模式下是五条移动和编辑命令。这个区别听起来小，实际上决定了「第一次用能不能用成」。

nano 的帮助文本（`^G`）第一句话就把自己交代清楚了：

```
The nano editor is designed to emulate the functionality and ease-of-use
of the UW Pico text editor.
```

*代码 1：`^G` 帮助页开头。nano 是 Pico 的自由软件复刻，而 Pico 是 pine 邮件客户端里那个编辑器——它的设计目标从第一天起就是「不用学」。*

所以它俩不是「简单的」和「高级的」关系，是两种取舍：nano 把所有能力都摊在屏幕上，代价是快捷键全都要按住 Ctrl；vim 把能力藏进模式里，换来手不离开主键区。先学 nano 是因为**改一行配置这件事，不该先花两小时学编辑器**。

## 二、屏幕分成四块，最下面两块是给你看的

这是 nano 最该先看懂的东西。同样是帮助页里的原话：

```
There are four main sections of the editor.  The top line shows the program
version, the current filename being edited, and whether or not the file has
been modified.  Next is the main editor window showing the file being
edited.  The status line is the third line from the bottom and shows
important messages.  The bottom two lines show the most commonly used
shortcuts in the editor.
```

*代码 2：nano 自己对自己的界面说明。*

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

*代码 3：nano 6.2 的实际界面，中间的空行省略了。*

三个值得单独记的点：

**第一，标题栏末尾那个 `*` 是唯一能看出「存没存」的地方。** 改了字之后标题栏会变成 `work/List.txt *`，按下 `^S` 之后那个星号消失。养成瞄一眼右上角的习惯，比事后发现白改了强。（顺带一提，Ubuntu 的 `/etc/nanorc` 里开了 `set stateflags`，这个标记才是这个样子；别的发行版上可能显示成 `Modified`。）

**第二，状态行是一次性的。** 「写了几行」「报了什么错」都出现在倒数第三行，而且**按下一个键它就被清掉了**。所以报错的时候要当场看，错过了就只能重来一次。

**第三，最下面那两行不是装饰，是说明书。** 这就是 nano 的整个设计哲学：能力全摊在明面上。忘了怎么退出就低头看 `^X Exit`，忘了怎么搜就看 `^W Where Is`。**用 nano 的正确姿势是不背快捷键。**

## 三、`^` 和 `M-` 到底是哪两个键

笔记里我写的是「`^` 为 ctrl，`M` 为 meta key，在 Windows 系统上是 Alt 键」。前半句对，**后半句要改**——它和 Windows 没关系。帮助页里的原文是：

```
Shortcuts are written as follows: Control-key sequences are notated with
a '^' and can be entered either by using the Ctrl key or pressing the Esc
key twice.  Meta-key sequences are notated with 'M-' and can be entered
using either the Alt, Cmd, or Esc key, depending on your keyboard setup.
```

*代码 4：`^G` 帮助页里关于这两个符号的说明。*

拆成一张表：

| 写法 | 怎么按 | 备选 |
| --- | --- | --- |
| `^X` | 按住 Ctrl 再按 X | **连按两下 Esc**，再按 X |
| `M-U` | 按住 Alt 再按 U（Mac 上是 Cmd 或 Option） | **按一下 Esc 松开**，再按 U |

关键在那句 **depending on your keyboard setup**：Meta 是一个逻辑上的修饰键，具体落在哪个物理键上取决于你的键盘和终端，不取决于操作系统。真正有用的是后半句——**Esc 可以顶替这两个修饰键**。SSH 到别人的机器上、Alt 被终端软件自己吃掉、或者用的是某个不认 Alt 的客户端时，`Esc` 这条路永远通。这也是为什么手册要特意写它。

## 四、笔记里那四步，第二步就跑偏了

笔记里模拟编辑过程的四步是这么写的：

1. 创建一个文件夹：`mkdir ToDoList`
2. 在这个文件夹中创建一个新文件：`touch List.txt`
3. 开始编辑：`nano List.txt`

**这里有个实打实的错：少了一步 `cd ToDoList`。** 照着敲出来的结果是这样的：

```bash
mkdir ToDoList
touch List.txt
ls -F
# List.txt  ToDoList/
ls -A ToDoList
# （空的）
```

*代码 5：照笔记原样敲一遍的真实输出。`-F` 让目录名后面带一个 `/`。*

`List.txt` 和 `ToDoList/` 是**并排的两个东西**，文件根本没进文件夹。原因在 [第三章](/2026/09/05/Linux-Command-Line-Chapter3/) 已经写过了——`touch List.txt` 里的 `List.txt` 是相对路径，起点是当前工作目录，而 `mkdir` 并不会把你带进它刚建的目录里。

两种改法：

```bash
# 改法一：先走进去
mkdir ToDoList && cd ToDoList && touch List.txt

# 改法二：不走进去，把路径写全
mkdir ToDoList
touch ToDoList/List.txt
nano ToDoList/List.txt
```

*代码 6：`mkdir` 不会顺手 `cd`，这是两条独立的命令。*

顺着这个错还能牵出一个更隐蔽的坑：**路径写错的时候，nano 不会当场拦住你。**

```bash
nano nope/List.txt      # nope 这个目录并不存在
```

*代码 7：往一个不存在的目录里写文件。*

nano 照常打开，让你敲字，一切正常——直到你按下 `^S`：

```
         [ Error writing nope/List.txt: No such file or directory ]
```

*代码 8：状态行在这时候才报错。*

也就是说，**路径打错的代价是在你写完之后才结算的**。这也是上一节「状态行要当场看」的现实意义：这句话闪一下就没了，没看见的话再按个 `^X`、手快选了 `N`，刚写的东西就真没了。

（另外，`nano` 后面跟一个目录会直接被拒绝：状态行写 `[ "ToDoList" is a directory ]`，然后给你一个空的 `New Buffer`。）

## 五、保存有三条路，其中两条会写盘

笔记里把保存记成了两条并列的快捷键：`^S`（最直接）和 `^O`（会提示要不要改名称）。实际上这三个键干的是三件不同的事。

![^S、^O、^X 三条保存路线各自做了什么](/img/posts/linux-nano/save-paths.svg)

*图 2：`^X` 不是「保存并退出」，它只是在退出前替你问一句。*

### 5.1 `^S`：写回当前文件名，不问任何问题

```
                                [ Wrote 1 line ]
```

*代码 9：`^S` 之后状态行的回应，同时标题栏的 `*` 消失。*

一个例外：**如果这个缓冲区还没有名字**（比如直接敲 `nano` 不带参数），`^S` 会退回去问你名字——标题栏这时显示的是 `New Buffer`。

### 5.2 `^O`：它问的是「写到哪个文件」，不是「要不要改名」

这是笔记里第二个要改的表述。按下 `^O`，屏幕最下面变成：

```
File Name to Write: work/List.txt
^G Help             M-D DOS Format      M-A Append          M-B Backup File
^C Cancel           M-M Mac Format      M-P Prepend         ^T Browse
```

*代码 10：`^O` 的提示语和它的副选项，名字是**预填好的**。*

它的名字叫 Write Out——**输出到哪里**。名字已经替你填好，所以直接回车就等于 `^S`。只有在你把它改掉的时候，它才变成「另存为」，而 nano 6.2 会再拦你一道：

```
Save file under DIFFERENT NAME?
 Y Yes
 N No           ^C Cancel
```

*代码 11：改了名字才会出现的二次确认。*

选 `Y` 之后实测的结果是：

```bash
ls -l
# -rw-r--r-- 1 zby zby 16 Copy.txt      ← 新内容写到了这里
# -rw-r--r-- 1 zby zby 12 List.txt      ← 原文件一个字节都没动
```

*代码 12：另存为之后两个文件各自的样子。*

而且**标题栏会跟着换成 `work/Copy.txt`**——从这一刻起，你编辑的是新文件，再按 `^S` 也是写进 `Copy.txt`。这个细节很容易吃亏：本来只想备份一份，结果后面所有修改都离开了原文件。

副选项那两行也值得看一眼，都是 `^O` 独有的能力：`M-A` 追加到文件末尾、`M-P` 插到文件开头、`M-B` 写之前先留一份备份、`M-D` 存成 CRLF 换行的 DOS 格式。

### 5.3 `^X`：它自己不写盘

`^X` 是 Exit。没改动就直接退出；有改动才会拦一句：

```
Save modified buffer?
 Y Yes
 N No           ^C Cancel
```

*代码 13：`^X` 的三个选项。*

`Y` 会转去走 `^O` 那条路（问你文件名），`N` 是丢掉所有修改、磁盘上什么都不变，`^C` 是「我按错了，回去接着编辑」。**把 `^X` 当成「保存并退出」来用是危险的**——手快连按 `^X`、`N` 就是一次白干。

## 六、为什么那两行提示里至今没有 `^S`

回头看代码 3 的最后两行：`^O Write Out` 在，`^S` 不在。但 `^S` 明明能用。这不是漏了，是有来历的。

`^S` 在终端里原本有另一个身份：**XOFF，暂停输出**。这台机器上现在也还是这样：

```bash
stty -a | tr ';' '\n' | grep -E "ixon|ixoff"
# ixon -ixoff
```

*代码 14：`ixon` 是开着的——在 shell 里按 `^S`，屏幕会卡住不动，`^Q` 才恢复。这不是死机。*

所以早年的 nano 干脆无视这个键。它自带的 `NEWS` 里两条记录把整件事讲清楚了：

```
2000s，1.1.x：  Nano now ignores XOFF (^S) to stop accidental lock-ups.

2017.11.18 - GNU nano 2.9.0 "Eta" ... makes ^Q and ^S do something
             useful by default (^Q starts a backward search, and ^S
             saves the current file)
```

*代码 15：摘自 `/usr/share/doc/nano/NEWS.gz`。*

也就是说，**`^S` 保存这件事是 2017 年 11 月（nano 2.9.0）才有的**。笔记里「`^S` 最直接」这句话在自己的机器上没问题，但要加一句限定：**在老机器上不一定成立**——凡是 nano 版本低于 2.9 的地方，这个键什么也不干。这台机器上没法验证别的版本，但年份摆在那里：2017 年 11 月之前定版的长期支持系统，装的基本都在这条线以下。

所以结论很简单，也正好呼应第二节：**自己机器上随便按 `^S`，到了别人的机器上，先低头看那两行提示里写了什么。** 它们显示的永远是这个版本真实生效的键。

## 七、文件是从哪一刻开始存在的

笔记里有一句写得很对，值得再往下钉一层：`nano ShoppingList.txt` **不会**像 `touch` 那样立刻创建一个空文件。

实测：打开一个不存在的文件，什么都不改直接 `^X`，目录里干干净净——`ls -A` 什么都没有。而 `touch` 只要敲下去，文件立刻就在了。这两条命令对「不存在」的处理方式完全相反：

| | 目标不存在时 | 什么时候碰磁盘 |
| --- | --- | --- |
| `touch a.txt` | 立刻建一个空文件 | 敲下回车的那一刻 |
| `nano a.txt` | 只在内存里开一个空缓冲区，状态行提示 `[ New File ]` | **你按下 `^S` / `^O` 的那一刻** |

![打开、输入、保存三步里，内存和磁盘各自的状态](/img/posts/linux-nano/buffer-vs-disk.svg)

*图 3：在你按下保存之前，你写的东西一个字节都不在磁盘上。*

这就引出了 `.save`，**这一条是我测的时候自己撞出来的**：我用 `tmux` 直接把跑着 nano 的那个终端杀掉，缓冲区里有还没保存的 `milk`。目录里出现了这个：

```bash
ls -A
# ShoppingList.txt.save
```

*代码 16：终端被杀之后留下的东西。注意原名 `ShoppingList.txt` 始终没有出现过。*

nano 收到 `SIGHUP`（终端没了）时会把缓冲区抢救到 `<原名>.save`。所以——**SSH 断线之后，先去看一眼有没有 `.save` 文件**，别急着重写。内容在，只是换了个名字。

## 八、查找与替换：两个键进的是同一个框

`^W` 是 Where Is（笔记里记的「查找」），按下去屏幕最下面是这样：

```
Search:
^G Help         M-C Case Sens   M-B Backwards   ^P Older        ^T Go To Line
^C Cancel       M-R Reg.exp.    ^R Replace      ^N Newer
```

*代码 17：`^W` 的提示和副选项。*

`^\` 是 Replace，提示语变成 `Search (to replace):`，副选项里对应的那个位置则变成 `^R No Replace`。**所以它俩其实是同一个输入框的两个入口，进去之后还能用 `^R` 来回切。** 顺带把副选项认全：

| 键 | 作用 |
| --- | --- |
| `M-C` | Case Sens，**开启**区分大小写 |
| `M-R` | Reg.exp.，把输入当正则 |
| `M-B` | Backwards，往回搜 |
| `^P` / `^N` | 翻搜索历史（Ubuntu 的 `/etc/nanorc` 开了 `set historylog`，历史能跨会话保留） |

注意 `M-C` 那一行的措辞——**它是「开启」，意味着默认是不区分大小写的**。这是个会真的咬人的默认值，实测一次：

```
文件内容：      Apple / banana / apple pie
^\ 搜 apple，替换成 kiwi，然后按 A（全部替换）
结果：          kiwi / banana / kiwi pie
```

*代码 18：`Apple` 也被换掉了，而且换成的是小写的 `kiwi`。*

**两件事同时发生了**：搜索不区分大小写，所以 `Apple` 命中了；而替换是照抄你写的那个字符串，所以大写没有被保留。改代码的时候用它批量改标识符，很容易一次改出两个 bug。要么先 `M-C` 打开大小写敏感，要么逐个确认。

逐个确认的提示长这样：

```
Replace this instance?
 Y Yes           A All
 N No           ^C Cancel
```

*代码 19：`A` 是从当前位置开始全部替换。*

## 九、剪切粘贴不是 `^C` / `^V`

看一眼代码 3 那两行就明白了：`^K Cut`、`^U Paste`，而 `^C` 在 nano 里是 `Location`（报告光标在第几行第几列）。终端里 `^C` 历来是「发中断信号」，`^V`、`^Z` 也各有各的老用途，所以终端程序普遍不敢占用它们。

`^K` 有个不太直觉但很好用的性质：**连按是累积的**。

```
原文：one / two / three
^K ^K            → 剪掉 one 和 two（两行进同一个剪切板）
光标下移一行，^U → three / one / two
```

*代码 20：实测。两次 `^K` 剪下来的是一整块，不是只剩最后一行。*

剩下几个常用的：

| 键 | 作用 |
| --- | --- |
| `M-U` / `M-E` | 撤销 / 重做 |
| `M-A`（或 `^6`） | 从光标处开始选中（Mark），再配合 `^K` 剪选中的部分 |
| `^/` | 跳到指定行，提示语是 `Enter line number, column number:` |
| `^C` | 报告位置，比如 `[ line 1399/2001 (69%), col 1/10 (10%), char 12873/18893 (68%) ]` |

`M-U` 还有个细节：**一路撤销到和磁盘上一致时，标题栏的 `*` 会自己消失**，状态行提示 `[ Nothing to undo ]`。nano 比较的是内容，不是「你改过几次」。

## 十、定位与插入：命令行上的两个参数

笔记最后一行是 `nano +1399 List.ext`——**`.ext` 是笔误，应该是 `List.txt`**。这条本身是对的，官方用法比笔记里写的还多一点：

```
Usage: nano [OPTIONS] [[+LINE[,COLUMN]] FILE]...

To place the cursor on a specific line of a file, put the line number with
a '+' before the filename.  The column number can be added after a comma.
```

*代码 21：`nano --help` 的开头。逗号后面还能跟列号，比如 `nano +1399,20 List.txt`。*

实测 `nano +1399 big.txt`（2000 行的文件），按 `^C` 报位置：

```
       [ line 1399/2001 (69%), col  1/10 ( 10%), char 12873/18893 (68%) ]
```

*代码 22：光标准确落在 1399 行，而且这一行被放在了屏幕中间，不是顶端。*

行号超过文件长度不会报错——拿同一条命令去开一个只有 5 行的文件，光标停在末尾：

```
           [ line  6/6 (100%), col  1/ 1 (100%), char 35/35 (100%) ]
```

*代码 23：停在最后，不会越界。*

（两处的总行数都比 `wc -l` 数出来的多 1 —— 2000 行的文件它报 2001，5 行的报 6。因为文件末尾那个换行之后，nano 认为还有一个空行在那儿。这和第十一节是同一件事的两面。）

`^R` 是笔记里那条「插入另一个文件中的内容」，提示语是：

```
File to insert [from ./]:
^G Help                   M-F New Buffer            ^X Execute Command
^C Cancel                 M-N No Conversion         ^T Browse
```

*代码 24：`^R` 的提示和副选项。*

`M-F` 和 `^X` 这两个副选项笔记里没提，但都很实用：`M-F` 把那个文件开成**另一个缓冲区**（而不是插进当前文件），`^X` 则是**把一条命令的输出直接插进来**。试了一下 `^R` `^X` 然后敲 `ls -1 /usr/share/nano/*.nanorc | head -3`：

```
/usr/share/nano/asm.nanorc
/usr/share/nano/autoconf.nanorc
/usr/share/nano/awk.nanorc
header
```

*代码 25：命令的输出插在了光标位置，原有的 `header` 被顶到了下面。写 README 贴目录结构的时候很省事。*

## 十一、保存时 nano 会悄悄加一个换行

这一条笔记里没有，但它会在 Git 里露头，所以单独记一笔。找一个末尾没有换行的文件：

```bash
printf 'no trailing newline' > n.txt
wc -c < n.txt        # 19
nano n.txt           # 什么都不改，直接 ^S
wc -c < n.txt        # 20
xxd n.txt | tail -1  # ...696e 650a   ← 末尾多了一个 0a
```

*代码 26：一个字都没改，文件大了 1 字节。*

`0a` 就是 `\n`。**只要用 nano 存过，文件末尾一定有换行。** 这在 Unix 世界里其实是「正确」的行为（POSIX 对文本文件的定义就要求每行以换行结尾），`nano --help` 里也明写着可以关掉它：

```
 -L             --nonewlines            Don't add an automatic newline
```

*代码 27：想保持原样就加 `-L`。*

为什么要在意：`git diff` 里那句 `\ No newline at end of file` 说的就是这件事。用 nano 打开别人的文件随便看一眼再存一次，diff 里就会多出一行谁都没写过的改动。

## 十二、`~/.nanorc`：值得先写进去的几行

nano 的配置文件是 `~/.nanorc`，一行一条，全都能在 `nano --help` 的长选项里找到对应。这台机器上还没有这个文件，下面这几行是打算加的：

```bash
set linenumbers     # 左边显示行号（对应 -l）
set tabstospaces    # Tab 存成空格（对应 -E），改 YAML 时能救命
set constantshow    # 状态行常驻显示光标位置（对应 -c）
set softwrap        # 长行折行显示，而不是横向滚动（对应 -S）
set autoindent      # 回车后保持上一行的缩进（对应 -i）
set positionlog     # 记住上次关掉时光标停在哪（对应 -P）
```

*代码 28：`~/.nanorc`。改完不用重启什么东西，下次打开 nano 就生效。*

另外有两条是 **Ubuntu 的 `/etc/nanorc` 已经替你开好的**，容易误以为是 nano 本身的行为：

```bash
set historylog   # 搜索历史跨会话保留（^P / ^N 翻的就是它）
set locking      # vim 风格的锁文件
set stateflags   # 标题栏上那个 * 就是它
include "/usr/share/nano/*.nanorc"   # 42 个语法高亮定义
```

*代码 29：`/etc/nanorc` 里去掉注释之后的全部内容。*

`set locking` 的效果实测是这样的：编辑 `f.txt` 时，同目录下会多出一个 `.f.txt.swp`；这时候在另一个终端再打开同一个文件，它会拦住你：

```
File work/f.txt is being edited by zby (with nano 6.2, PID 20285); open anyway?
 Y Yes
 N No           ^C Cancel
```

*代码 30：连是谁、用哪个版本、PID 多少都告诉你了。正常退出后 `.swp` 会自动删掉。*

看到目录里冒出 `.xxx.swp` 不要慌，也别急着删——它多半意味着**某个地方还开着一个没退出的编辑器**，或者上次是被强杀的。

## 十三、和 Git 那门课接上：`git commit` 打开的是谁

[Git 第零章](/2026/09/05/Git-Chapter0-Command-Line/) 那边留过一个尾巴：`git commit` 不带 `-m` 的时候会弹出一个编辑器。弹的是哪一个，正好由这一章的东西决定。实测一遍（`git var GIT_EDITOR` 能直接把答案打出来）：

| 环境 | `git var GIT_EDITOR` |
| --- | --- |
| 什么都不设 | `editor` |
| `EDITOR=ed` | `ed` |
| `VISUAL=vis EDITOR=ed` | `vis` |
| `core.editor=vim` + 上面两个都设了 | `vim` |
| `GIT_EDITOR=ge` + 以上全都设了 | `ge` |

*代码 31：表里越靠下的优先级越高，连起来就是 `GIT_EDITOR` > `core.editor` > `VISUAL` > `EDITOR` > 系统默认。*

最后那个 `editor` 是 Debian / Ubuntu 的一层间接：

```bash
ls -l /usr/bin/editor
# /usr/bin/editor -> /etc/alternatives/editor
update-alternatives --query editor | grep ^Value
# Value: /bin/nano
```

*代码 32：一台什么都没配的 Ubuntu 上，`git commit` 打开的就是 nano。*

**所以「不会退出 vim」这个经典笑话，在 Ubuntu 上其实不太会发生，你会先撞上 nano。** 至于这台机器，`~/.gitconfig` 里已经写了 `core.editor = vim`，所以它开的是 vim——查一下自己的机器用 `git config --show-origin --get core.editor`，能连是哪个文件设的一起告诉你。

## 小结

按「它在回答哪个问题」重排一遍：

| 问题 | 键 / 命令 | 这一章新学到的 |
| --- | --- | --- |
| 快捷键怎么记 | 最下面两行 | 不用记。`^` 是 Ctrl（或两下 Esc），`M-` 是 Alt/Cmd（或一下 Esc） |
| 怎么保存 | `^S` | 2017 年（nano 2.9.0）才有的，更老的版本上没有 |
| 存到哪去 | `^O` | 问的是「写到哪个文件」，改名 = 另存为，标题栏会跟着换 |
| 怎么退出 | `^X` | 它自己不写盘，只是替你问一句 |
| 存没存 | 标题栏的 `*` | 撤销回原样，`*` 也会自己消失 |
| 出错了吗 | 状态行 | 一次性的，按下一个键就没了 |
| 找和换 | `^W` / `^\` | 同一个框两个入口；**默认不区分大小写** |
| 剪贴 | `^K` / `^U` | 连按 `^K` 是累积成一块 |
| 跳到某行 | `nano +N f` / `^/` | 还能 `+行,列`；超出范围就停在末尾 |
| 插别的东西 | `^R` | 再按 `^X` 可以插一条命令的输出 |

这一章真正的收获其实不在快捷键表上，而是两件事。

**第一件是「说明书就在屏幕上」。** nano 把它能做的都写在最下面两行里，这不只是对新手友好——它意味着**你在任何一台陌生机器上都不需要预先知道这个版本支持什么**。上一章讲 `file` 的时候说过「名字会撒谎，开头那几个字节不会」；这里是同一种思路：别依赖记忆里的知识，依赖眼前这台机器自己给出的事实。`^S` 那段历史正是这条的反例教材——记忆会过期，屏幕不会。

**第二件是「缓冲区和文件是两个东西」。** 你在 nano 里敲的每一个字，在按下保存之前都只活在内存里。打开不存在的文件不会创建它，改了一半终端断了会变成 `.save`，另存为之后你编辑的已经是另一个文件了——这三件看起来不相干的事，全都是这一条的推论。后面学 vim 的 `.swp`、学重定向、学进程被杀掉时会发生什么，还会反复回到同一个位置上。

下一章大概率就轮到 `cp` / `mv` / `rm` 和通配符了——这次不敢打包票。
