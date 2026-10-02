---
title: Linux 命令行第八章：重定向 —— 命令运行之前，文件已经打开了
date: 2026-09-28 22:38:00
description: Colt Steele《The Linux Command Line Bootcamp》第八章的复盘。>、>>、<、2>、2>&1 和 &> 可以把命令的标准输入、标准输出和标准错误接到文件上。这些重定向都由 Shell 在命令运行之前、按照从左往右的顺序处理完毕。所以 > 会先清空文件（sort f > f 会得到一个空文件），< 打开文件失败时命令根本不会运行，2>&1 也要写在 > 的后面。
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

[第七章](/2026/09/26/Linux-Command-Line-Chapter7/) 介绍的八条命令，结果全都打印在屏幕上。这一章讲的是重定向（redirection），也就是把命令的输出写进文件，或者让命令从文件里读取输入，而命令本身一个字都不需要修改。

这几种写法背后其实是同一件事，**重定向是由 Shell 完成的，而且在命令运行之前就已经完成了**。Shell 会先按照 `>`、`<` 这些符号把文件打开、连接好，然后再启动命令。命令只管往几个固定的编号里读写数据，并不知道这些编号背后连接的是屏幕还是文件。这一章里最容易出错的三个地方，都是由此而来的，分别是 `>` 为什么在命令还没运行时就清空了文件，`cat < 文件` 和 `cat 文件` 有什么区别，以及 `2>&1` 为什么要写在后面。

<!-- more -->

## 一、三条标准流：0、1、2

每条命令在启动时，手里都已经有三条打开好的通道，它们用编号来区分：

| 编号 | 名字 | 用途 | 默认接到 |
| --- | --- | --- | --- |
| 0 | 标准输入（stdin） | 命令从这里读输入 | 键盘 |
| 1 | 标准输出（stdout） | 正常的结果写到这里 | 屏幕 |
| 2 | 标准错误（stderr） | 报错写到这里 | 屏幕 |

这些编号叫作文件描述符（file descriptor），下面简称为 0 号、1 号和 2 号。在 Linux 上，可以直接看到它们分别连接到了哪里：

```bash
$ ls -l /proc/self/fd
total 0
lrwx------ 1 zby zby 64 Sep 29 19:00 0 -> /dev/pts/2
lrwx------ 1 zby zby 64 Sep 29 19:00 1 -> /dev/pts/2
lrwx------ 1 zby zby 64 Sep 29 19:00 2 -> /dev/pts/2
lr-x------ 1 zby zby 64 Sep 29 19:00 3 -> /proc/3227/fd
```

*代码 1：`/proc/self/fd` 列出的是当前这条命令（也就是 `ls` 自己）打开的文件。*

`/dev/pts/2` 就是当前这个终端窗口，0 号、1 号和 2 号都连接在它上面。键盘输入的字从这里进来，命令的结果和报错也从这里显示出去。最后一行的 3 号，是 `ls` 为了读取这个目录而自己打开的，和重定向无关。

标准输出和标准错误默认都显示在屏幕上，所以平时看不出它们的区别。但是把输出重定向到文件之后，分成两条通道的用意就显现出来了：

```bash
$ cat a.txt missing.txt b.txt > out.txt
cat: missing.txt: No such file or directory
$ cat out.txt
this is a
this is b
```

*代码 2：正常的结果写进了文件，报错仍然显示在屏幕上。*

可以看到，结果被保存进了文件，而报错并没有跟着进去，仍然显示在屏幕上。这样一来，报错既不会混进结果里，也不会被漏看。

![默认时 0 号接键盘、1 号和 2 号接屏幕；重定向之后分别接到 in.txt、out.txt、err.txt](/img/posts/linux-redirection/streams.svg)

*图 1：重定向改变的是编号背后连接的东西，命令本身并没有改变。*

用同样的方法还可以看到，在命令开始运行时，这些编号就已经改接好了：

```bash
$ ls -l /proc/self/fd > fds.txt 2> err.txt
$ cat fds.txt
total 0
lrwx------ 1 zby zby 64 Sep 29 19:00 0 -> /dev/pts/2
l-wx------ 1 zby zby 64 Sep 29 19:00 1 -> /home/zby/demo/fds.txt
l-wx------ 1 zby zby 64 Sep 29 19:00 2 -> /home/zby/demo/err.txt
lr-x------ 1 zby zby 64 Sep 29 19:00 3 -> /proc/3230/fd
```

*代码 3：`ls` 看到的 1 号和 2 号，已经变成了两个文件。*

## 二、> 和 >>：把输出写进文件

```bash
$ date > now.txt
$ cat now.txt
Tue Sep 29 18:59:37 CST 2026
```

*代码 4：`date` 的结果没有显示在屏幕上，而是写进了 now.txt。*

`>` 会把 1 号连接到文件上。如果文件不存在，就新建一个；如果文件已经存在，就**先把它清空**，然后再写入。所以同一条 `> now.txt` 无论执行几次，文件里都只会留下最后一次的结果。如果想把内容追加到文件末尾，保留原有的内容，就要使用 `>>`：

```bash
date >> now.txt      # 每执行一次，now.txt 多一行
```

配合 `echo` 使用，还可以一步创建出一个带有内容的文件，比如 `echo 'hello redirection' > hello.txt`。

### 2.1 清空发生在命令运行之前

「先清空再写入」中的这个「先」，比看上去还要早。Shell 在启动命令之前，就已经把文件打开并清空了，所以无论命令能不能运行、运行得对不对，都不会影响这一步。

```bash
$ echo 'important data' > notes.txt
$ dtae > notes.txt
bash: dtae: command not found
$ wc -c notes.txt
0 notes.txt
```

*代码 5：命令名打错了，什么命令都没有运行，文件却照样被清空了。*

最容易出问题的情况，是想「原地」处理一个文件：

```bash
$ sort fruits.txt > fruits.txt
$ wc -c fruits.txt
0 fruits.txt
```

*代码 6：排序没有完成，文件却先被清空了。*

这里的先后顺序是这样的。Shell 先把 fruits.txt 清空，并把它连接到 `sort` 的 1 号上，然后 `sort` 才开始读取 fruits.txt，而这时读到的已经是一个空文件了。换成 `cat fruits.txt > fruits.txt` 也是一样的结果，而且不会报任何错误。

稳妥的做法是先把结果写到另一个文件里，确认无误之后再替换回来：

```bash
sort fruits.txt > fruits.sorted && mv fruits.sorted fruits.txt
```

*代码 7：`&&` 表示只有前一条命令成功了，才会执行后一条命令。*

在同一个目录里执行 `mv`，只是给文件换了一个名字（见[第五章](/2026/09/19/Linux-Command-Line-Chapter5/)）。另外，`sort` 自己也提供了 `-o` 选项，`sort -o fruits.txt fruits.txt` 允许输出文件和输入文件是同一个。

## 三、<：从文件读输入

`<` 会把 0 号连接到文件上：

```bash
$ cat < t.txt
one
two
three
```

*代码 8：结果和 `cat t.txt` 完全一样。*

两种写法的结果相同，不同之处在于**文件是由谁打开的**：

- 执行 `cat t.txt` 时，`t.txt` 作为参数交给 `cat`，由 `cat` 自己去打开它。
- 执行 `cat < t.txt` 时，由 Shell 打开 `t.txt`，并把它连接到 `cat` 的 0 号上。由于 `cat` 没有收到任何参数，它就会去读取标准输入，但它并不知道自己读的是哪个文件。

有两个地方可以看出这个区别。第一，命令拿不到文件名：

```bash
$ wc -l t.txt
3 t.txt
$ wc -l < t.txt
3
```

*代码 9：在第二种写法中，`wc` 不知道文件叫什么名字，所以只输出了一个数字。*

第二，文件打不开时，报错的是不同的程序：

```bash
$ cat missing.txt
cat: missing.txt: No such file or directory
$ cat < missing.txt
bash: missing.txt: No such file or directory
```

*代码 10：前一个是 `cat` 在报错；后一个是 bash 在报错，因为文件打开失败，所以 `cat` 根本没有运行。*

输入重定向和输出重定向也可以写在同一条命令里：

```bash
cat < a.txt > copy.txt
```

它的效果相当于把 a.txt 复制一份到 copy.txt（copy.txt 里原有的内容会先被清空）。

## 四、2>：把报错单独存下来

标准错误是 2 号，所以对它的重定向要写成 `2>`：

```bash
$ cat missing.txt 2> err.txt
$ cat err.txt
cat: missing.txt: No such file or directory
```

*代码 11：执行第一条命令时，屏幕上什么都没有显示，因为报错写进了 err.txt。*

这里的要点是，**数字要写在 `>` 的前面，并且紧挨着它，中间不能有空格**。如果位置或者空格变了，意思就会完全不同，而且 Shell 并不会报语法错误。下面三种写法都接在 `cat missing.txt` 的后面：

| 写法 | Shell 的理解 |
| --- | --- |
| `2> err.txt` | 2 号接到 err.txt |
| `>2 err.txt` | 1 号接到一个名叫 `2` 的文件；`err.txt` 成了 `cat` 要读的第二个文件 |
| `2 > err.txt` | `2` 成了 `cat` 要读的文件；1 号接到 err.txt |

后两种写法的报错仍然会显示在屏幕上，而且第二种写法还会在目录里留下一个名叫 `2` 的文件。

同样的道理，`>` 其实是省略了 1 的 `1>`，而 `<` 是省略了 0 的 `0<`。如果要追加报错，就写成 `2>>`。

如果不想看到某些报错，可以把它们丢进 `/dev/null`。这是一个特殊的文件，写进去的内容会被直接丢弃：

```bash
cat missing.txt 2>/dev/null     # 什么也不显示
```

## 五、输出和报错写进同一个文件

### 5.1 文件名写两次：两段互相覆盖

直觉上的写法，是让两个编号都指向同一个文件：

```bash
$ cat a.txt missing.txt b.txt > all.txt 2> all.txt
$ cat all.txt
cat: missithis is b
 such file or directory
```

*代码 12：`this is a` 不见了，报错也被截成了两段。*

`> all.txt` 和 `2> all.txt` 是两次独立的打开操作。每一次打开都会自己记录「下一个字节要写在哪里」，而 1 号和 2 号并不知道对方写过什么，所以它们都是从文件的开头开始写的：

![三次写入依次发生：1 号写 this is a，2 号从第 0 字节写报错把它盖掉，1 号再从第 10 字节写 this is b](/img/posts/linux-redirection/clobber.svg)

*图 2：两个写入位置各自计算，后写入的内容覆盖了先写入的内容。*

### 5.2 2>&1：让 2 号跟着 1 号

正确的写法是只打开一次文件，让 2 号共用 1 号的那一份：

```bash
$ cat a.txt missing.txt b.txt > all.txt 2>&1
$ cat all.txt
this is a
cat: missing.txt: No such file or directory
this is b
```

*代码 13：三段内容按照发生的先后顺序排列，一段都没有少。*

`2>&1` 的意思是「让 2 号连接到 1 号**此刻**所连接的地方」。其中的 `&` 表示后面的 `1` 是一个编号，而不是文件名。如果写成 `2>1`，报错就会写进一个名叫 `1` 的文件里。这样写以后，1 号和 2 号使用的是同一次打开，共享同一个写入位置，谁先写入，谁的内容就排在前面，因此不会相互覆盖。

### 5.3 顺序：从左往右

如果把 `2>&1` 挪到前面，结果就不一样了：

```bash
$ cat a.txt missing.txt b.txt 2>&1 > all.txt
cat: missing.txt: No such file or directory
$ cat all.txt
this is a
this is b
```

*代码 14：报错又回到了屏幕上。*

这是因为 Shell 是按照从左往右的顺序处理重定向的。当 `2>&1` 写在前面时，1 号还连接着屏幕，所以 2 号跟过去的也是屏幕。接下来的 `> all.txt` 只修改了 1 号，已经连接好的 2 号并不会跟着改变。也就是说，`2>&1` 只是按照当时的状态复制了一份，并不是从此就和 1 号绑定在一起。

![两种顺序下，1 号和 2 号每一步分别接在哪](/img/posts/linux-redirection/order.svg)

*图 3：写成 `> all.txt 2>&1` 时，先修改 1 号，再让 2 号跟上；如果反过来写，2 号跟上的就是屏幕。*

### 5.4 &>：bash 的简写

bash 提供了一种简写，`命令 &> all.txt` 等同于 `命令 > all.txt 2>&1`，追加时写成 `&>>`。

不过并不是所有的 Shell 都认识这种简写。在 Ubuntu 和 Debian 上，`sh` 其实是另一个 Shell，叫作 dash。它会把 `&` 理解成「把命令放到后台运行」，而 `> all.txt` 则变成了一次单独的清空操作。结果就是输出和报错照常显示在屏幕上，而 all.txt 是一个空文件。所以对于要交给 `sh` 运行的命令，写成 `> all.txt 2>&1` 最为稳妥。

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

这一章的符号都很短，需要记住的只有一件事，那就是**重定向由 Shell 在命令运行之前、按照从左往右的顺序处理完毕**。所以 `>` 在命令还没有开始运行时就已经清空了文件；用 `<` 打开的文件，命令并不知道它的名字；而 `2>&1` 复制的是 1 号当时所连接的地方，所以要等 `>` 修改完 1 号之后再写。
