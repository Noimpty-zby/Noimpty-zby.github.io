---
title: Linux 命令行第十二章：grep 和正则表达式 —— 按内容查找，打印的是整行
date: 2026-10-19 22:10:00
description: Colt Steele《The Linux Command Line Bootcamp》第十二章的复盘。grep 逐行读取文件，把含有匹配的整行打印出来，-w、-i、-n、-c、-m 和 -A、-B、-C 决定怎样匹配、打印哪些行，-r 可以在整个目录里递归查找。grep 的模式是正则表达式，点、^、$、方括号和 * 在默认的基本正则里就能用，?、+、花括号和竖线要加上 -E 才有特殊含义。-c 数的是行而不是次数，* 可以重复零次，{2,3} 中间要写逗号，模式要放进单引号，这几处是这一章最容易出错的地方。
categories:
  - [课外, AI Infra, Linux入门]
tags:
  - grep
  - 正则表达式
cover: /img/covers/Linux-Command-Line-Chapter12.svg
series: Linux 命令行
privacy: protected
sitemap: false
private_section: 课外
---

[上一章](/2026/10/04/Linux-Command-Line-Chapter11/)的 `find` 可以按照名字、类型、大小和时间查找文件，但是它不会打开文件去看里面写了什么。如果要找的是文件里的某一段内容，比如日志里所有报错的行，或者某个单词出现在哪些文件里，那么就要用到这一章的 `grep`。`grep` 会逐行读取文件，把含有指定内容的行打印出来。它接收的模式是一种叫作正则表达式（regular expression）的写法，除了普通的文字以外，还可以用 `.`、`^`、`*` 这样的符号表示「任意一个字符」「行的开头」「重复任意次」这类条件。

这一章的例子都在练习目录 ~/grep-lab 里运行。目录里有两个文本文件和一个 docs 目录，docs 目录要到第二节递归查找时才会用到。两个文本文件的内容如下：

```bash
$ cat words.txt
I wrote one word on the board.
The words were hard to read.
A sword is not a word.
Write down your password (keep it secret)
Word games are fun (sometimes)
we were away for a week
I think the grey cat is gray now.
What color is it?
The colour of the sky changes.
This book looks good.
Sooo good!
$ cat app.log
09:00:01 INFO  server started on port 8080
09:00:05 INFO  connected to database
09:12:30 WARN  slow query took 1200 ms
09:15:02 ERROR cannot read config.yaml
09:15:02 INFO  using default config
09:20:44 INFO  user alice logged in
09:31:10 ERROR payment service timeout
09:31:10 ERROR retry 1 failed
09:31:12 INFO  retry 2 succeeded
09:45:00 INFO  user bob logged in
09:58:37 WARN  disk usage at 91%
10:00:00 INFO  hourly report sent
```

*代码 1：words.txt 是 11 行英文句子，app.log 是一段 12 行的日志。*

<!-- more -->

## 一、grep 打印的是含有匹配的整行

`grep` 最基本的用法是 `grep 模式 文件`。下面在 words.txt 里查找 word：

```bash
$ grep word words.txt
I wrote one word on the board.
The words were hard to read.
A sword is not a word.
Write down your password (keep it secret)
```

*代码 2：这四行都含有 word 这四个字母，其中 words、sword 和 password 只是包含了它。*

从这个输出可以看出两点。第一，`grep` 打印的是整行，而不是只打印 word 这个词，只要一行里有一处能够匹配，这一行就会被完整地打印出来。第二，`grep` 只看这几个字符是不是连续出现，并不关心它们是不是一个完整的单词，所以 words、sword 和 password 里的 word 也算。另外，`grep` 默认区分大小写，第五行的 Word 是大写字母开头的，所以没有被找到。

在终端里运行这条命令时，每一行中的 word 都会显示成红色。这个颜色并不是 `grep` 本来就有的，而是因为 Ubuntu 默认的 ~/.bashrc 给 `grep` 设置了一个别名：

```bash
$ alias grep
alias grep='grep --color=auto'
```

*代码 3：输入 `grep` 时，实际运行的是 `grep --color=auto`。*

`--color=auto` 的意思是，如果 `grep` 的输出直接显示在终端上，就把匹配到的部分标上颜色；如果输出进了管道，或者被重定向到了文件里，就不加颜色。这样一来，后面的命令和文件里就不会混进控制颜色的字符。

### 1.1 -w 和 -i

如果只想找 word 这个单词本身，那么可以加上 `-w`。这时匹配到的内容前面必须是行首或者一个不属于单词的字符，后面也必须是行尾或者一个不属于单词的字符。`man grep` 里写着，属于单词的字符是字母、数字和下划线，所以空格和句号都可以作为单词的边界：

```bash
$ grep -w word words.txt
I wrote one word on the board.
A sword is not a word.
```

*代码 4：第三行的 sword 不算，但是同一行末尾的 word 后面是句号，所以这一行仍然被打印了出来。*

`-i` 让 `grep` 在匹配时不区分大小写。几个选项可以合在一起写，比如 `-iw` 就是同时使用 `-i` 和 `-w`：

```bash
$ grep -i word words.txt
I wrote one word on the board.
The words were hard to read.
A sword is not a word.
Write down your password (keep it secret)
Word games are fun (sometimes)
$ grep -iw word words.txt
I wrote one word on the board.
A sword is not a word.
Word games are fun (sometimes)
```

*代码 5：加上 `-i` 以后，大写字母开头的 Word games 也被找到了。*

### 1.2 -n、-c 和 -m

`-n` 会在每一行的前面加上它在文件里的行号，行号和内容之间用冒号隔开：

```bash
$ grep -n ERROR app.log
4:09:15:02 ERROR cannot read config.yaml
7:09:31:10 ERROR payment service timeout
8:09:31:10 ERROR retry 1 failed
```

*代码 6：app.log 的第 4、7、8 行含有 ERROR。*

`-c` 不打印内容，只打印匹配的行数。这里要注意，`-c` 数的是有多少行含有匹配，而不是模式一共出现了多少次。比如 words.txt 里的 word 一共出现了 5 次，但是其中有两次在同一行里，也就是第三行的 sword 和 word，所以 `-c` 的结果是 4。如果要数出现的次数，可以先用 `-o` 让 `grep` 只打印匹配到的部分，每一处匹配单独占一行，然后再交给[第七章](/2026/09/26/Linux-Command-Line-Chapter7/)的 `wc -l` 去数行数：

```bash
$ grep -c word words.txt
4
$ grep -o word words.txt
word
word
word
word
word
$ grep -o word words.txt | wc -l
5
```

*代码 7：`-c` 数出了 4 行，`-o` 打印出了 5 处匹配。*

`man grep` 对 `-c` 的说明也是 print a count of matching lines，也就是打印匹配的行数。

`-m` 后面跟一个数字，表示找到这么多个匹配的行以后，就停止读取这个文件。所以 `-m1` 只打印第一个匹配的行，如果只是想确认文件里有没有某个内容，那么用它就不需要把整个文件读完。和 `-c` 一样，`-m` 的数字也是按行计算的：

```bash
$ grep -m1 ERROR app.log
09:15:02 ERROR cannot read config.yaml
$ grep -m2 -n ERROR app.log
4:09:15:02 ERROR cannot read config.yaml
7:09:31:10 ERROR payment service timeout
$ grep -c -m2 ERROR app.log
2
```

*代码 8：`-m2` 找到第 4 行和第 7 行以后就停下了，所以第 8 行没有出现；和 `-c` 一起使用时，数出来的行数也不会超过 2。*

### 1.3 -A、-B 和 -C：带上前后几行

只看匹配的那一行，有时候并不能了解发生了什么。比如日志里的一条报错，往往要看它前后的几行才能弄清楚原因。`-A` 后面跟一个数字，表示在每个匹配行的后面（after）多打印几行；`-B` 表示在前面（before）多打印几行；`-C` 则是前后各打印同样的行数。数字可以直接写在选项后面，`-A2` 和 `-A 2` 是一样的：

```bash
$ grep -A2 cannot app.log
09:15:02 ERROR cannot read config.yaml
09:15:02 INFO  using default config
09:20:44 INFO  user alice logged in
```

*代码 9：匹配的是第 4 行，`-A2` 把它后面的第 5、6 行也打印了出来。*

如果有好几个匹配行，那么每一个匹配行都会带上自己前后的几行。这时打印出来的内容可能是不连续的几段，于是 `grep` 会在两段之间打印一行 `--`，把它们隔开：

```bash
$ grep -A1 ERROR app.log
09:15:02 ERROR cannot read config.yaml
09:15:02 INFO  using default config
--
09:31:10 ERROR payment service timeout
09:31:10 ERROR retry 1 failed
09:31:12 INFO  retry 2 succeeded
```

*代码 10：第 4 行带上了第 5 行，第 7、8 行带上了第 9 行，两段之间是 `--`。*

第 7 行和第 8 行都是匹配行，而第 7 行后面的那一行正好就是第 8 行，所以这两行在同一段里，第 8 行也不会被打印两次。同样的道理，如果两段正好首尾相接，那么它们也会连成一段：

```bash
$ grep -n -C1 ERROR app.log
3-09:12:30 WARN  slow query took 1200 ms
4:09:15:02 ERROR cannot read config.yaml
5-09:15:02 INFO  using default config
6-09:20:44 INFO  user alice logged in
7:09:31:10 ERROR payment service timeout
8:09:31:10 ERROR retry 1 failed
9-09:31:12 INFO  retry 2 succeeded
```

*代码 11：第 4 行带上的第 5 行和第 7 行带上的第 6 行正好挨着，所以中间没有 `--`。*

加上 `-n` 以后，匹配行的行号后面是冒号，补充的行的行号后面是减号，所以从输出里就能分清哪些行是真正匹配的。图 1 把 `-B1`、`-A1` 和 `-C1` 分别打印了哪些行画在了一起。

![app.log 的 12 行，第 4、7、8 行是 ERROR；右边三列用竖条标出 -B1、-A1、-C1 各自打印的行，前两列中间有 --，-C1 是连续的一整段](/img/posts/linux-grep/context-lines.svg)

*图 1：相邻的段会连在一起，不相邻的段之间用 `--` 隔开。*

## 二、-r：在目录里递归查找

`grep` 后面可以写好几个文件，这时它会在每一行的前面加上文件名，说明这一行来自哪个文件。但是如果写的是一个目录，`grep` 就会报错，因为它默认只读取文件：

```bash
$ grep gress docs/plan.txt docs/review.txt
docs/plan.txt:Track progress every Friday.
docs/review.txt:The first draft was too aggressive.
$ grep gress docs
grep: docs: Is a directory
```

*代码 12：在两个文件里查找时，每一行前面都有文件名。*

docs 目录的结构如下，其中 empty.txt 是一个空文件，old 是一个子目录：

```bash
$ find docs
docs
docs/empty.txt
docs/old
docs/old/2025.txt
docs/plan.txt
docs/review.txt
docs/README.md
```

*代码 13：docs 下一共有 5 个文件，其中 2025.txt 在子目录 old 里。*

加上 `-r` 以后，`grep` 会进入目录，逐层查找下面的每一个文件，子目录里的文件也不会漏掉：

```bash
$ grep -r gress docs
docs/old/2025.txt:Little progress in 2025.
docs/plan.txt:Track progress every Friday.
docs/review.txt:The first draft was too aggressive.
docs/README.md:See plan.txt for progress.
```

*代码 14：四个文件里有 gress，其中三个是 progress，一个是 aggressive。*

和上一章的 `find` 一样，`grep -r` 输出的顺序是文件在目录里实际存放的顺序，并没有按字母排序。如果 `-r` 后面没有写目录，那么 `grep` 会从当前目录开始查找，这时输出的路径前面没有 `./`；如果明确写出了 `.`，那么路径前面就会带上 `./`。下面的 `-l` 选项表示只打印含有匹配的文件名，每个文件只打印一次：

```bash
$ grep -rl gress
docs/old/2025.txt
docs/plan.txt
docs/review.txt
docs/README.md
$ grep -rn progress .
./docs/old/2025.txt:1:Little progress in 2025.
./docs/plan.txt:2:Track progress every Friday.
./docs/README.md:2:See plan.txt for progress.
```

*代码 15：当前目录下的 words.txt 和 app.log 里没有 gress，所以没有出现。`-n` 和文件名一起出现时，行号写在文件名和内容之间。*

## 三、正则表达式

到这里为止，模式都是普通的单词，每个字母只匹配它自己。实际上 `grep` 的模式是一个正则表达式，其中有一些符号带有特殊的含义。`grep` 默认使用的是基本正则表达式（basic regular expression），这一节介绍的 `.`、`^`、`$`、方括号和 `*` 都属于基本正则表达式，所以不需要加任何选项就能使用。这一节的模式都放在单引号里，原因在第五节解释。

### 3.1 点：任意一个字符

`.` 可以匹配任意一个字符。比如 `w...` 的意思是一个 w 后面再跟三个字符，而这三个字符可以是字母，也可以是数字、标点或者空格：

```bash
$ grep 'w...' words.txt
I wrote one word on the board.
The words were hard to read.
A sword is not a word.
Write down your password (keep it secret)
we were away for a week
$ grep -o 'w...' words.txt
wrot
word
word
were
word
word
wn y
word
we w
way 
week
```

*代码 16：`-o` 打印出了每一处匹配，其中 wn y 和 we w 的中间是空格，way 的后面也跟着一个空格。*

第七行的 now 后面只有一个句号，凑不够三个字符，所以这一行没有被找到。第五行虽然有 Word，但是它的 W 是大写的，所以也没有被找到。

因为 `.` 能匹配任意字符，所以如果要找的内容里本身就有点，比如句号，那么直接写 `.` 是不行的。这时要在点的前面加一个反斜杠，写成 `\.`，表示只匹配一个真正的点：

```bash
$ grep -c '.' words.txt
11
$ grep -c '\.' words.txt
6
```

*代码 17：每一行都至少有一个字符，所以 `.` 匹配了全部 11 行，而含有句号的只有 6 行。*

### 3.2 ^ 和 $：行首和行尾

`^` 表示行的开头，`$` 表示行的结尾。它们本身不匹配任何字符，只是要求匹配的位置必须在行首或者行尾：

```bash
$ grep '^I' words.txt
I wrote one word on the board.
I think the grey cat is gray now.
$ grep ')$' words.txt
Write down your password (keep it secret)
Word games are fun (sometimes)
```

*代码 18：第一条命令找出以大写字母 I 开头的行，第二条命令找出以右括号结尾的行。*

### 3.3 方括号：一组字符中的一个

方括号表示从一组字符里任选一个。比如 `gr[ae]y` 既可以匹配 gray，也可以匹配 grey。但是方括号整体只匹配一个字符，所以 `gr[ae]y` 并不能匹配 graey。

方括号里可以用减号表示一个范围，比如 `[a-e]` 和 `[abcde]` 相同，常见的写法还有 `[0-9]`、`[a-z]` 和 `[A-Z]`。如果方括号里的第一个字符是 `^`，那么意思就反过来了，表示除了这些字符以外的任意一个字符：

```bash
$ grep -o 'gr[ae]y' words.txt
grey
gray
$ grep -o 'gr[^e]y' words.txt
gray
$ grep '^[a-z]' words.txt
we were away for a week
```

*代码 19：`[^e]` 排除了 grey，`^[a-z]` 找出了唯一一行以小写字母开头的句子。*

`^` 在方括号的外面和里面意思完全不同。在方括号外面，它表示行首；在方括号里面的第一个位置，它表示「不是这些字符」。上面的最后一条命令里两种用法都出现了。另外，`[^e]` 虽然表示「不是 e」，但是它仍然要匹配一个字符，所以 `gr[^e]y` 不能匹配 gry。

### 3.4 星号：前一项重复任意次

`*` 表示它前面的那一项可以重复任意次，也包括零次。比如 `go*d` 里的 `o*` 可以是零个、一个或者好几个 o，所以 gd、god、good 都能匹配。这里的 `*` 和[第十章](/2026/10/04/Linux-Command-Line-Chapter10/)里通配符的 `*` 并不一样。通配符的 `*` 自己就能代表任意一串字符，而正则表达式里的 `*` 只是修饰前面那一项。如果要在正则表达式里表示任意一串字符，就要写成 `.*`，也就是任意一个字符重复任意次：

```bash
$ grep 'ERROR.*timeout' app.log
09:31:10 ERROR payment service timeout
```

*代码 20：找出 ERROR 之后某个位置又出现了 timeout 的行。*

「包括零次」这一点很容易被忽略。`x*` 可以匹配零个 x，也就是一个空的字符串，而任何一行里都能找到空字符串，所以下面这条命令会把 words.txt 的每一行都算进去，尽管文件里一个 x 都没有：

```bash
$ grep -c 'x*' words.txt
11
$ grep -c x words.txt
0
```

*代码 21：`x*` 匹配了全部 11 行。*

图 2 是这一节几个模式在终端里的样子，其中只有匹配到的那一段会被标上颜色。

![终端里的四组输出：w... 标出了 wrot、word、wn y、way 等片段，-w word 只标出独立的 word，gr[ae]y 标出 grey 和 gray，gr[^e]y 只标出 gray，x* 打印了每一行但没有标出任何字符](/img/posts/linux-grep/highlight.svg)

*图 2：`x*` 每一行都匹配到了，但是匹配到的是空字符串，所以没有任何字符被标出来。*

## 四、-E：扩展正则表达式

在基本正则表达式里，`?`、`+`、`{`、`}`、`|`、`(` 和 `)` 都只是普通的字符。如果给 `grep` 加上 `-E`，它就会改用扩展正则表达式（extended regular expression），这时这些符号才有特殊的含义。其中 `?` 表示前面那一项可有可无，也就是出现零次或者一次，所以 `colou?r` 既能匹配美式拼写的 color，也能匹配英式拼写的 colour：

```bash
$ grep 'colou?r' words.txt
$ grep -E 'colou?r' words.txt
What color is it?
The colour of the sky changes.
```

*代码 22：不加 `-E` 时，`grep` 找的是 colou?r 这七个字符，所以什么都没有找到。*

Ubuntu 上的 `grep` 是 GNU 版本，它在基本正则表达式里也能使用这些功能，只是要在符号前面加上反斜杠，比如 `'colou\?r'` 的效果就和 `-E 'colou?r'` 一样。

### 4.1 花括号：重复指定的次数

`{n}` 表示前面那一项正好重复 n 次，`{n,m}` 表示重复 n 到 m 次，两个数字之间用的是逗号。比如 `o{2}` 表示两个连续的 o：

```bash
$ grep -E 'o{2}' words.txt
This book looks good.
Sooo good!
$ grep -oE 'o{2}' words.txt
oo
oo
oo
oo
oo
$ grep -oE 'o{2,3}' words.txt
oo
oo
oo
ooo
oo
```

*代码 23：Sooo 里有三个 o，`o{2}` 只匹配了其中的两个，而 `o{2,3}` 把三个 o 都匹配上了。*

这里有两点要注意。第一，`grep` 是在一行里找能够匹配的片段，所以 `o{2}` 并不要求 o 正好连续出现两次。Sooo 里有三个 o，其中的前两个就能匹配，所以这一行也被打印了出来。第二，表示区间时中间要写逗号。如果写成 `o{2-3}`，那么 `grep` 并不会报错，而是把它当作普通的文字，去找 o{2-3} 这六个字符，结果自然什么都找不到：

```bash
$ grep -E 'o{2-3}' words.txt
$ grep -cE 'o{2,3}' words.txt
2
```

*代码 24：`o{2-3}` 没有报错，只是一行都没有匹配到。*

除了 `?` 和花括号，扩展正则表达式里还有两个常用的符号。`+` 和 `*` 类似，但是前面那一项至少要出现一次；`|` 表示「或」，它两边的模式只要有一个能够匹配就可以。比如要同时找出日志里的报错和警告，可以这样写：

```bash
$ grep -E 'ERROR|WARN' app.log
09:12:30 WARN  slow query took 1200 ms
09:15:02 ERROR cannot read config.yaml
09:31:10 ERROR payment service timeout
09:31:10 ERROR retry 1 failed
09:58:37 WARN  disk usage at 91%
```

*代码 25：含有 ERROR 或者 WARN 的行都被找了出来。*

## 五、模式要放进单引号

`grep` 的模式里经常出现 `*`、`?`、方括号、花括号、`$` 和括号，而这些符号对 Shell 也有特殊的含义。如果不加引号，Shell 就会在运行 `grep` 之前先处理它们，于是 `grep` 收到的就不是原来写下的模式了：

```bash
$ grep )$ words.txt
bash: syntax error near unexpected token `)'
$ grep -E a{2,3} words.txt
grep: a3: No such file or directory
$ echo grep -E a{2,3} words.txt
grep -E a2 a3 words.txt
```

*代码 26：第一条命令被 Shell 当成了语法错误，第二条命令被花括号展开改写了。*

第一条命令里，Shell 把右括号当成了语法的一部分，所以 `grep` 根本没有运行。第二条命令的问题更隐蔽。第十章讲过，花括号里有逗号时，Shell 会把它展开，所以 `a{2,3}` 变成了 a2 和 a3 两个参数。这时 `grep` 收到的模式是 a2，而 a3 和 words.txt 都被当成了要查找的文件，所以它报错说 a3 不存在。如果在命令前面加上 `echo`，就能看到 Shell 改写以后的命令。

`*`、`?` 和方括号也有同样的问题，如果当前目录里正好有能和它们匹配的文件名，它们就会被路径名展开换成这些文件名。第十章还说过，单引号里的内容不会发生任何展开，所以把模式放进单引号是最稳妥的写法。

## 六、和管道、find 一起使用

如果 `grep` 后面没有写文件，那么它会从标准输入读取内容。所以[第九章](/2026/10/02/Linux-Command-Line-Chapter9/)的管道可以把别的命令的输出交给 `grep`，只留下需要的行。比如在 `grep` 自己的手册里，找出所有含有 count 的行：

```bash
$ man grep | grep count
       -c, --count
              Suppress  normal output; instead print a count of matching lines
              below), count non-matching lines.
       -m NUM, --max-count=NUM
              --count option is also  used,  grep  does  not  output  a  count
       Large  repetition  counts  in the {n,m} construct may cause grep to use
```

*代码 27：终端宽度是 80 列时的结果。`man` 会按照终端的宽度排版，所以窗口宽度不同时，断行的位置和找到的行也会不同。*

这个结果也能说明 `grep` 一次只看一行。手册里对 `-c` 的说明一共有三行，但是只有含有 count 的那两行被留了下来，中间那一行因为没有 count，所以被丢掉了。如果想看完整的说明，那么可以加上 `-A`，把后面的几行一起打印出来。

管道交给 `grep` 的是文字，`grep` 也只在这些文字里查找。所以如果用管道把 `find` 的结果交给 `grep`，那么 `grep` 查找的是 `find` 打印出来的路径，而不是这些文件的内容：

```bash
$ find . -name '*.txt' | grep gress
$ find . -name '*.txt' | grep old
./docs/old/2025.txt
```

*代码 28：没有一个路径里含有 gress，而 2025.txt 的路径里有 old。*

如果要在 `find` 找到的文件里查找内容，就要像上一章那样使用 `-exec`，把路径作为参数交给 `grep`：

```bash
$ find . -name '*.txt' ! -empty -type f -exec grep -l gress '{}' ';'
./docs/old/2025.txt
./docs/plan.txt
./docs/review.txt
```

*代码 29：README.md 不是 .txt 文件，empty.txt 是空文件，所以它们都被 `find` 排除了。*

这条命令里，`find` 先找出所有不为空的 .txt 普通文件，然后对每一个文件执行一次 `grep -l gress`。`'{}'` 和 `';'` 加了引号，它们的作用和上一章的 `{}`、`\;` 相同。因为空文件里不可能有匹配，所以 `! -empty` 只是让 `find` 少执行几次 `grep`，去掉它结果也不会变。

但是这里的 `-l` 并不是可有可无的。用 `\;` 结尾时，`grep` 每次只收到一个文件，而 `grep` 只有在收到多个文件时，才会在每一行的前面加上文件名。所以如果去掉 `-l`，那么打印出来的行就看不出是哪个文件里的了。这时可以改用 `+` 结尾，让 `grep` 一次收到所有的文件，或者加上 `-H`，让 `grep` 无论收到几个文件都打印文件名：

```bash
$ find . -name '*.txt' -type f -exec grep gress {} \;
Little progress in 2025.
Track progress every Friday.
The first draft was too aggressive.
$ find . -name '*.txt' -type f -exec grep gress {} +
./docs/old/2025.txt:Little progress in 2025.
./docs/plan.txt:Track progress every Friday.
./docs/review.txt:The first draft was too aggressive.
```

*代码 30：用 `\;` 时每一行前面都没有文件名；用 `+` 时 `grep` 一次收到了全部的 .txt 文件，于是加上了文件名。*

## 小结

| 写法 | 作用和要点 |
| --- | --- |
| `grep` | 打印含有匹配的整行，默认区分大小写 |
| `-w` | 只匹配完整的单词 |
| `-i` | 不区分大小写 |
| `-n` | 在每一行前面加上行号 |
| `-c` | 数的是匹配的行数，不是次数 |
| `-m1` | 找到第一个匹配行就停止 |
| `-A2` | 带上匹配行后面的两行 |
| `-B2` | 带上匹配行前面的两行 |
| `-C2` | 前后各带上两行 |
| `-r` | 递归查找目录，`-l` 只打印文件名 |
| `.` | 任意一个字符，`\.` 才是真正的点 |
| `^` `$` | 行首和行尾 |
| `[ae]` | 一个 a 或者一个 e，`[^e]` 是除 e 以外的一个字符 |
| `*` | 前一项重复零次或多次，`.*` 是任意一串字符 |
| `-E` | 让 `?`、`+`、花括号和竖线有特殊含义 |

`grep` 做的事情可以概括成逐行读取、逐行判断。它把文件一行一行地读进来，判断这一行里有没有能和模式匹配的片段，如果有，就把整行打印出来。所以 `-c` 和 `-m` 都是按行计算的，`o{2}` 也会找出有三个 o 的行，而 `x*` 因为能匹配空字符串，会让每一行都被打印出来。模式本身是正则表达式，点、行首行尾、方括号和星号在默认的基本正则表达式里就能使用，`?`、`+`、花括号和竖线则要加上 `-E`。又因为这些符号对 Shell 也有意义，所以模式要放进单引号，这样才能保证 `grep` 收到的就是写下的那个模式。

下一章讲[文件的权限，也就是 `ls -l` 开头那十个字符的含义](/2026/10/20/Linux-Command-Line-Chapter13/)。
