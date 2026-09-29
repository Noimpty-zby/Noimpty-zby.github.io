---
title: Linux 命令行第八章：重定向 —— 命令运行之前，文件已经打开了
date: 2026-09-28 22:38:00
description: Colt Steele《The Linux Command Line Bootcamp》第八章的复盘。>、>>、<、2>、2>&1 和 &> 把命令的标准输入、标准输出、标准错误接到文件上。它们都由 Shell 在命令运行之前、从左往右处理完：所以 > 会先清空文件（sort f > f 得到空文件），< 打开失败时命令根本不会运行，2>&1 要写在 > 的后面。
categories:
  - [课外, AI Infra, Linux入门]
tags:
  - 重定向
  - 文件描述符
  - Shell
cover: /img/covers/Linux-Command-Line-Chapter8.svg
series: Linux 命令行
privacy: protected
sitemap: false
private_section: 课外
---

[第七章](/2026/09/26/Linux-Command-Line-Chapter7/) 的八条命令，结果全都打印在屏幕上。这一章讲重定向（redirection）：把命令的输出写进文件，或者让命令从文件里读输入，命令本身一个字都不用改。

几种写法背后是同一件事：**重定向是 Shell 做的，而且在命令运行之前就做完了。** Shell 先照着 `>`、`<` 把文件打开、接好，再启动命令；命令只管往几个固定的编号里读写，并不知道编号背后是屏幕还是文件。这一章最容易出错的三处都由此而来：`>` 为什么连命令都没跑就把文件清空了，`cat < 文件` 和 `cat 文件` 差在哪，以及 `2>&1` 为什么要写在后面。

<!-- more -->

## 一、三条标准流：0、1、2

每条命令启动时，手里已经有三条打开好的通道，用编号区分：

| 编号 | 名字 | 用途 | 默认接到 |
| --- | --- | --- | --- |
| 0 | 标准输入（stdin） | 命令从这里读输入 | 键盘 |
| 1 | 标准输出（stdout） | 正常的结果写到这里 | 屏幕 |
| 2 | 标准错误（stderr） | 报错写到这里 | 屏幕 |

这些编号叫文件描述符（file descriptor），下面简称 0 号、1 号、2 号。在 Linux 上可以直接看到它们接在哪儿：

```bash
$ ls -l /proc/self/fd
total 0
lrwx------ 1 zby zby 64 Sep 29 19:00 0 -> /dev/pts/2
lrwx------ 1 zby zby 64 Sep 29 19:00 1 -> /dev/pts/2
lrwx------ 1 zby zby 64 Sep 29 19:00 2 -> /dev/pts/2
lr-x------ 1 zby zby 64 Sep 29 19:00 3 -> /proc/3227/fd
```

*代码 1：`/proc/self/fd` 列出的是当前这条命令（也就是 `ls` 自己）打开的文件。*

`/dev/pts/2` 是当前这个终端窗口，0、1、2 都接在它上面：键盘敲的字从这里进来，结果和报错从这里显示出去。最后一行的 3 是 `ls` 为了读这个目录自己打开的，和重定向无关。

标准输出和标准错误默认都显示在屏幕上，看不出区别。把输出重定向到文件之后，分成两条的用意就出来了：

```bash
$ cat a.txt missing.txt b.txt > out.txt
cat: missing.txt: No such file or directory
$ cat out.txt
this is a
this is b
```

*代码 2：正常的结果进了文件，报错仍然显示在屏幕上。*

结果被收进了文件，报错没有跟进去，照样打在屏幕上：既不会混进结果里，也不会被漏看。

![默认时 0 号接键盘、1 号和 2 号接屏幕；重定向之后分别接到 in.txt、out.txt、err.txt](/img/posts/linux-redirection/streams.svg)

*图 1：重定向改的是编号背后接着的东西，命令本身不变。*

用同一个办法可以看到，命令开始运行时，这些编号已经改接好了：

```bash
$ ls -l /proc/self/fd > fds.txt 2> err.txt
$ cat fds.txt
total 0
lrwx------ 1 zby zby 64 Sep 29 19:00 0 -> /dev/pts/2
l-wx------ 1 zby zby 64 Sep 29 19:00 1 -> /home/zby/demo/fds.txt
l-wx------ 1 zby zby 64 Sep 29 19:00 2 -> /home/zby/demo/err.txt
lr-x------ 1 zby zby 64 Sep 29 19:00 3 -> /proc/3230/fd
```

*代码 3：`ls` 看到的 1 号和 2 号，已经是两个文件了。*

## 二、> 和 >>：把输出写进文件

```bash
$ date > now.txt
$ cat now.txt
Tue Sep 29 18:59:37 CST 2026
```

*代码 4：`date` 的结果没有出现在屏幕上，而是写进了 now.txt。*

`>` 把 1 号接到文件上：文件不存在就新建，已经存在就**先清空**再写。所以同一条 `> now.txt` 执行几次，文件里都只有最后一次的结果。想往末尾追加、保留原有内容，用 `>>`：

```bash
date >> now.txt      # 每执行一次，now.txt 多一行
```

配合 `echo`，可以一步建出一个带内容的文件：`echo 'hello redirection' > hello.txt`。

### 2.1 清空发生在命令运行之前

「先清空再写」的这个「先」，比看上去还要早：Shell 在启动命令之前就把文件打开并清空了。命令能不能运行、跑得对不对，都不影响这一步。

```bash
$ echo 'important data' > notes.txt
$ dtae > notes.txt
bash: dtae: command not found
$ wc -c notes.txt
0 notes.txt
```

*代码 5：命令名打错了，什么命令也没运行，文件照样被清空。*

最容易踩的是想「原地」处理一个文件：

```bash
$ sort fruits.txt > fruits.txt
$ wc -c fruits.txt
0 fruits.txt
```

*代码 6：排序没排成，文件先没了。*

先后顺序是这样的：Shell 先把 fruits.txt 清空、接到 `sort` 的 1 号上，然后 `sort` 才开始读 fruits.txt，读到的已经是一个空文件。换成 `cat fruits.txt > fruits.txt` 也一样，而且不报任何错。

稳妥的做法是先写到另一个文件，确认无误再换回来：

```bash
sort fruits.txt > fruits.sorted && mv fruits.sorted fruits.txt
```

*代码 7：`&&` 表示前一条成功了才执行后一条。*

同一个目录里的 `mv` 只是换个名字（见[第五章](/2026/09/19/Linux-Command-Line-Chapter5/)）。`sort` 自己也提供了 `-o` 选项，`sort -o fruits.txt fruits.txt` 允许输出文件和输入文件是同一个。

## 三、<：从文件读输入

`<` 把 0 号接到文件上：

```bash
$ cat < t.txt
one
two
three
```

*代码 8：和 `cat t.txt` 的结果一模一样。*

结果相同，不同的是**文件由谁打开**：

- `cat t.txt`：`t.txt` 作为参数交给 `cat`，由 `cat` 自己去打开。
- `cat < t.txt`：Shell 打开 `t.txt`，接到 `cat` 的 0 号上。`cat` 没有收到任何参数，就去读标准输入 —— 它并不知道读的是哪个文件。

有两个地方能看出这个区别。一是命令拿不到文件名：

```bash
$ wc -l t.txt
3 t.txt
$ wc -l < t.txt
3
```

*代码 9：第二种写法，`wc` 不知道文件叫什么，就只输出一个数字。*

二是文件打不开时，报错的是谁：

```bash
$ cat missing.txt
cat: missing.txt: No such file or directory
$ cat < missing.txt
bash: missing.txt: No such file or directory
```

*代码 10：前一个是 `cat` 在报错；后一个是 bash —— 打开失败，`cat` 根本没有运行。*

输入和输出可以写在同一条命令里：

```bash
cat < a.txt > copy.txt
```

效果相当于把 a.txt 复制一份到 copy.txt（copy.txt 原有的内容会先被清空）。

## 四、2>：把报错单独存下来

标准错误是 2 号，重定向写成 `2>`：

```bash
$ cat missing.txt 2> err.txt
$ cat err.txt
cat: missing.txt: No such file or directory
```

*代码 11：第一条命令执行时屏幕上什么也没有，报错进了 err.txt。*

要点是**数字写在 `>` 前面，并且紧挨着，中间没有空格**。位置或空格一变，意思就完全不同，而且 Shell 不会报语法错误。下面三种都接在 `cat missing.txt` 后面：

| 写法 | Shell 的理解 |
| --- | --- |
| `2> err.txt` | 2 号接到 err.txt |
| `>2 err.txt` | 1 号接到一个名叫 `2` 的文件；`err.txt` 成了 `cat` 要读的第二个文件 |
| `2 > err.txt` | `2` 成了 `cat` 要读的文件；1 号接到 err.txt |

后两种写法，报错都照样打在屏幕上，第二种还会在目录里留下一个名叫 `2` 的文件。

同样的道理，`>` 其实是省略了 1 的 `1>`，`<` 是省略了 0 的 `0<`。追加报错用 `2>>`。

不想看的报错可以扔进 `/dev/null`。它是一个特殊的文件，写进去的东西直接丢弃：

```bash
cat missing.txt 2>/dev/null     # 什么也不显示
```

## 五、输出和报错写进同一个文件

### 5.1 文件名写两次：两段互相覆盖

直觉的写法是让两个编号都指向同一个文件：

```bash
$ cat a.txt missing.txt b.txt > all.txt 2> all.txt
$ cat all.txt
cat: missithis is b
 such file or directory
```

*代码 12：`this is a` 不见了，报错被截成了两段。*

`> all.txt` 和 `2> all.txt` 是两次独立的打开。每一次打开都自己记着「下一个字节写在哪」，1 号和 2 号互相不知道对方写过什么，各自从文件开头写起：

![三次写入依次发生：1 号写 this is a，2 号从第 0 字节写报错把它盖掉，1 号再从第 10 字节写 this is b](/img/posts/linux-redirection/clobber.svg)

*图 2：两个写入位置各算各的，后写的盖掉先写的。*

### 5.2 2>&1：让 2 号跟着 1 号

正确的写法是只打开一次，让 2 号共用 1 号那一份：

```bash
$ cat a.txt missing.txt b.txt > all.txt 2>&1
$ cat all.txt
this is a
cat: missing.txt: No such file or directory
this is b
```

*代码 13：三段按发生的先后排好，一段不少。*

`2>&1` 读作「让 2 号接到 1 号**此刻**接着的地方」。`&` 表示后面的 `1` 是编号，不是文件名 —— 写成 `2>1`，报错会进一个名叫 `1` 的文件。这样 1 号和 2 号用的是同一次打开，共享同一个写入位置，谁先写谁在前，不会互相覆盖。

### 5.3 顺序：从左往右

把 `2>&1` 挪到前面，结果就变了：

```bash
$ cat a.txt missing.txt b.txt 2>&1 > all.txt
cat: missing.txt: No such file or directory
$ cat all.txt
this is a
this is b
```

*代码 14：报错又回到了屏幕上。*

Shell 按从左往右的顺序处理重定向。`2>&1` 在前面时，1 号还接着屏幕，2 号跟过去的就是屏幕；接下来的 `> all.txt` 只改 1 号，已经接好的 2 号不会跟着变。`2>&1` 是照当时的样子复制一份，不是从此和 1 号绑在一起。

![两种顺序下，1 号和 2 号每一步分别接在哪](/img/posts/linux-redirection/order.svg)

*图 3：`> all.txt 2>&1` 先改 1 号，再让 2 号跟上；反过来写，2 号跟上的是屏幕。*

### 5.4 &>：bash 的简写

bash 提供了一个简写：`命令 &> all.txt` 等同于 `命令 > all.txt 2>&1`，追加写成 `&>>`。

这个简写不是所有 Shell 都认。Ubuntu、Debian 上的 `sh` 其实是另一个 Shell（dash），它把 `&` 理解成「把命令放到后台运行」，`> all.txt` 则成了单独的一次清空 —— 结果输出和报错照常打在屏幕上，all.txt 是空的。要交给 `sh` 运行的命令，写成 `> all.txt 2>&1` 最稳妥。

## 小结

| 想做的事 | 写法 | 要点 |
| --- | --- | --- |
| 输出写进文件 | `命令 > 文件` | 先清空，而且在命令运行前就清空了；`sort f > f` 得到空文件 |
| 输出追加到末尾 | `命令 >> 文件` | 原有内容保留 |
| 从文件读输入 | `命令 < 文件` | 文件由 Shell 打开，命令拿不到文件名 |
| 报错写进文件 | `命令 2> 文件` | 数字紧贴在 `>` 前；`>2` 是写进一个名叫 `2` 的文件 |
| 丢掉报错 | `命令 2>/dev/null` | 写进去的内容直接丢弃 |
| 输出和报错进同一个文件 | `命令 > 文件 2>&1` | 别把文件名写两次；`2>&1` 要写在 `>` 后面 |
| 同上的简写 | `命令 &> 文件` | bash 的写法，`sh`（dash）不认 |

这一章的符号都很短，要记住的只有一件事：**重定向由 Shell 在命令运行之前、从左往右处理完。** 所以 `>` 在命令还没开始时就清空了文件；`<` 打开的文件，命令并不知道它叫什么；`2>&1` 复制的是 1 号当时的去处，要等 `>` 改完 1 号之后再写。
