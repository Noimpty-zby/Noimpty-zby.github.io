---
title: Linux 命令行第十一章：locate、find 和 xargs —— 一个查数据库，一个逐个目录去找
date: 2026-10-04 21:40:00
description: Colt Steele《The Linux Command Line Bootcamp》第十一章的复盘。locate 在一个每天更新一次的数据库里查找路径，速度很快，但是看不到刚新建的文件；find 逐个目录现场查找，可以按名字、类型、大小和时间组合条件，还能用 -exec 对找到的文件执行命令。文件的三个时间戳、-size 和 -mtime 的取整规则，以及 xargs 遇到空输入和带空格的文件名时的表现，是这一章最容易出错的地方。
categories:
  - [课外, AI Infra, Linux入门]
tags:
  - find
  - locate
  - xargs
  - 时间戳
cover: /img/covers/Linux-Command-Line-Chapter11.svg
series: Linux 命令行
privacy: protected
sitemap: false
private_section: 课外
---

前面几章操作的都是知道位置的文件，在命令后面直接写上路径就可以了。但是如果只记得文件名的一部分，或者只知道要找的是这几天改过的日志，就需要先把文件找出来。这一章介绍两条查找文件的命令。`locate` 在一个事先建好的数据库里查找，速度很快，但是数据库里的内容不一定是最新的；`find` 会逐个目录现场查找，所以结果是准确的，而且可以按照类型、大小、时间等条件筛选，还能对找到的文件执行别的命令。最后介绍的 `xargs`，作用是把标准输入转换成命令的参数。

这一章的例子都在家目录下的练习目录 ~/lab 里运行。为了演示按时间查找，其中几个文件用 `touch -d` 把修改时间调到了几分钟、几小时或者几天以前。

<!-- more -->

## 一、locate：在数据库里查找

`locate` 的参数是一个模式。它会在数据库里找出路径中包含这个模式的所有文件和目录，然后打印出它们的完整路径。因为查的是数据库，所以当前目录在哪里并不影响结果：

```bash
$ cd /
$ locate notes
/home/zby/lab/notes.txt
```

*代码 1：在根目录下运行，照样找到了家目录里的 notes.txt。*

这里的 notes 并不是一个路径，而是要在路径里查找的一段文字。只要完整的路径里包含这段文字，这一条就会被列出来，目录也不例外。比如路径里包含 lab 的条目一共有 16 条，也就是 lab 目录本身，再加上它下面的 15 个文件和子目录。`-c` 选项只打印匹配到的数量，`-l` 选项则限制最多打印几条：

```bash
$ locate -c lab
16
$ locate -l 3 lab
/home/zby/lab/.hidden.txt
/home/zby/lab/README.md
/home/zby/lab/Report.TXT
```

*代码 2：`-c` 是 count 的缩写，`-l` 是 limit 的缩写。*

`locate` 默认区分大小写，如果加上 `-i`，就不再区分了：

```bash
$ locate report
$ locate -i report
/home/zby/lab/Report.TXT
```

*代码 3：第一条命令什么都没有找到，因为文件名里的 R 是大写的。*

如果模式里含有 `*`、`?` 或者方括号，`locate` 就不再按包含关系查找，而是用这个模式去匹配整条路径。这时模式一定要加上引号，否则[第十章](/2026/10/04/Linux-Command-Line-Chapter10/)讲的路径名展开会先在当前目录里把它展开。另外，因为模式要匹配的是整条路径，而路径都是以 `/` 开头的，所以 `'notes*'` 什么也找不到，要写成 `'*notes*'` 才行：

```bash
$ locate '*.TXT'
/home/zby/lab/Report.TXT
$ locate 'notes*'
```

*代码 4：`*.TXT` 能够匹配，是因为开头的 `*` 匹配了 /home/zby/lab/ 这一段。*

### 1.1 数据库不是实时更新的

`locate` 查的数据库是由 `updatedb` 这条命令生成的。Ubuntu 的 plocate 软件包会安装一个每天运行一次的定时任务来执行 `updatedb`，所以在两次更新之间，数据库里记录的仍然是上一次更新时的样子。下面先新建一个文件，再删掉一个文件，然后分别用 `locate` 去查：

```bash
$ cd ~/lab
$ touch new.txt
$ rm todo.txt
$ locate new.txt
$ locate todo
/home/zby/lab/todo.txt
$ locate -e todo
```

*代码 5：刚新建的 new.txt 查不到，已经删掉的 todo.txt 却还在结果里。*

`-e` 选项会在打印之前检查每一个结果是否还存在，所以它可以去掉已经删除的文件。但是对于数据库里本来就没有的文件，`-e` 也没有办法把它找出来。如果要让 `locate` 看到最新的情况，就要手动执行一次 `updatedb`。因为数据库保存在 /var/lib/plocate 下面，而且 `updatedb` 要读取整个系统的目录，所以它需要用 `sudo` 来运行：

```bash
$ sudo updatedb
$ locate new.txt
/home/zby/lab/new.txt
$ locate todo
```

*代码 6：重建数据库以后，两个结果都和实际情况一致了。*

另外，/etc/updatedb.conf 里列出了一些不收录的目录，比如 /tmp，所以放在 /tmp 下的文件用 `locate` 是查不到的。如果系统提示找不到 `locate` 这条命令，可以先用 `sudo apt install plocate` 安装。

![左边是磁盘上的目录，updatedb 把它记进数据库，locate 查数据库，find 直接读目录；下面的表格对比了 new.txt 和 todo.txt 的查找结果](/img/posts/linux-find/locate-vs-find.svg)

*图 1：`locate` 只能看到上一次 `updatedb` 时的目录，`find` 每次都会现场读取。*

## 二、find：逐个目录去找

`find` 不使用数据库，而是从给定的目录开始，逐层读取下面的每一个目录，所以它找到的总是当前的实际情况。如果不加任何参数，`find` 会从当前目录开始，把下面所有的文件和目录都列出来：

```bash
$ find
.
./Report.TXT
./docs
./docs/guide.md
./empty.txt
./logs
./logs/old.log
./logs/sat.log
./logs/app.log
./logs/big.log
./.hidden.txt
./notes.txt
./photos
./photos/cat.jpg
./todo.txt
./backup
./README.md
```

*代码 7：输出里有当前目录 `.` 本身，也有以点开头的 .hidden.txt。*

和第十章的 `*` 不同，`find` 不会跳过隐藏文件。它输出的顺序是文件在目录里实际存放的顺序，并没有按字母排序。如果要从别的目录开始查找，就把目录写在 `find` 的后面，而且可以同时写好几个：

```bash
$ find docs logs
docs
docs/guide.md
logs
logs/old.log
logs/sat.log
logs/app.log
logs/big.log
```

*代码 8：从 docs 和 logs 两个目录分别开始查找。*

### 2.1 按类型和名字查找

`-type f` 只找普通文件，`-type d` 只找目录。`-name` 按文件名匹配，模式的写法和第十章的通配符一样，而 `-iname` 在匹配时不区分大小写。几个条件写在一起时，表示要同时满足：

```bash
$ find . -type d
.
./docs
./logs
./photos
./backup
$ find . -type f -name '*.txt'
./empty.txt
./.hidden.txt
./notes.txt
./todo.txt
$ find . -iname '*.txt'
./Report.TXT
./empty.txt
./.hidden.txt
./notes.txt
./todo.txt
```

*代码 9：`-iname` 比 `-name` 多找到了扩展名是大写 .TXT 的 Report.TXT。*

### 2.2 -name 的模式要加引号

`-name` 后面的 `*.txt` 是要交给 `find` 去匹配的，但是如果不加引号，Shell 会先在当前目录里把它展开。当前目录里有三个 .txt 文件，所以 `find` 收到的是 `-name empty.txt notes.txt todo.txt`，于是报错。如果当前目录里正好只有一个文件能匹配，情况会更麻烦，因为这时命令不会报错，但是结果是错的：

```bash
$ find . -name *.txt
find: paths must precede expression: `notes.txt'
find: possible unquoted pattern after predicate `-name'?
$ find . -name *.md
./README.md
$ find . -name '*.md'
./docs/guide.md
./README.md
```

*代码 10：当前目录里只有 README.md 一个 .md 文件，没加引号的 `*.md` 被展开成了 README.md，于是 docs 里的 guide.md 被漏掉了。*

### 2.3 按大小查找

`-size` 按文件的大小查找。数字前面的 `+` 表示大于，`-` 表示小于；数字后面的单位可以是 `c`（字节）、`k`、`M` 或者 `G`。如果不写单位，那么默认的单位是 512 字节的块，这一点很容易被忽略。

```bash
$ find . -size +1M
./logs/big.log
$ find . -size +500k
./logs/big.log
./photos/cat.jpg
```

*代码 11：big.log 的大小是 2M，cat.jpg 是 600k。*

这里有一个反直觉的地方。`find` 在比较之前，会先把文件的大小按照单位向上取整。比如 cat.jpg 只有 600k，换算成 M 以后不到 1M，但是向上取整得到的是 1。所以 `-size -1M` 的意思其实是向上取整以后小于 1M，也就是只剩下大小为 0 的文件，而 `-size 1M` 会匹配所有不超过 1M 的非空文件：

```bash
$ find . -type f -size -1M
./empty.txt
$ find . -type f -size 1M
./Report.TXT
./docs/guide.md
./logs/old.log
./logs/sat.log
./logs/app.log
./.hidden.txt
./notes.txt
./photos/cat.jpg
./todo.txt
./README.md
```

*代码 12：不到 1M 的文件都被算成了正好 1M，`man find` 里也专门提醒过 `-size -1M` 和 `-size -1048576c` 并不相同。*

所以如果要找比较小的文件，就应该换一个更小的单位，比如 `-size -100k`，或者直接用字节作单位。另外，目录本身也有大小（通常是 4096 字节），所以按大小查找时最好加上 `-type f`。

### 2.4 按属主和是否为空查找

`-user 用户名` 查找属主是某个用户的文件，属主就是[第三章](/2026/09/05/Linux-Command-Line-Chapter3/)里 `ls -l` 输出的第三列。练习目录里所有文件的属主都是 zby，所以 `find . -user zby` 找到的和 `find` 一样，都是 17 项。`-empty` 查找空文件和空目录：

```bash
$ find . -empty
./empty.txt
./backup
```

*代码 13：empty.txt 是一个 0 字节的文件，backup 是一个空目录。*

## 三、三个时间戳

第三章介绍过，每个文件都记录着三个时间。atime（access time）是最近一次读取文件内容的时间，可以用 `ls -lu` 查看；mtime（modify time）是最近一次修改文件内容的时间，`ls -l` 默认显示的就是它；ctime（change time）是文件的属性最近一次发生变化的时间，可以用 `ls -lc` 查看。如果想一次看到全部的时间，可以使用 `stat`：

```bash
$ stat notes.txt
  File: notes.txt
  Size: 23              Blocks: 8          IO Block: 4096   regular file
Device: 830h/2096d      Inode: 122209      Links: 1
Access: (0644/-rw-r--r--)  Uid: ( 1000/     zby)   Gid: ( 1000/     zby)
Access: 2026-10-04 21:41:51.730822715 +0800
Modify: 2026-10-04 21:41:51.730822715 +0800
Change: 2026-10-04 21:51:51.725760267 +0800
 Birth: 2026-10-04 21:51:51.718280736 +0800
$ ls -l notes.txt
-rw-r--r-- 1 zby zby 23 Oct  4 21:41 notes.txt
$ ls -lc notes.txt
-rw-r--r-- 1 zby zby 23 Oct  4 21:51 notes.txt
```

*代码 14：Access、Modify、Change 分别是 atime、mtime 和 ctime，最后一行的 Birth 是文件的创建时间。*

这里的 Modify 比 Change 早了 10 分钟，这是因为 notes.txt 的修改时间是用 `touch -d` 往前调过的。`touch` 可以把 atime 和 mtime 改成任意的时间，但是 ctime 只能由系统设置成当前的时间，而且 `touch` 修改时间这个动作本身，也会让 ctime 更新。所以 ctime 是没有办法往前调的。

ctime 很容易被误认为是创建时间（creation time），但是它的 c 指的是 change。文件的内容、权限、属主、名字，只要有一项发生了变化，ctime 就会更新。在比较新的内核和文件系统上，`stat` 会在最后一行另外显示真正的创建时间 Birth。下面这张图是对同一个文件依次执行六条命令，每执行一条就用 `stat` 读一次三个时间的结果：

![六条命令和三个时间戳的对照表，追加内容改 mtime 和 ctime，chmod 和 mv 只改 ctime，第一次 cat 改 atime，第二次 cat 什么都不改，touch 三个都改](/img/posts/linux-find/timestamps.svg)

*图 2：修改内容时 mtime 和 ctime 一起变化，只修改属性时只有 ctime 变化。*

图 2 里第二次 `cat` 没有更新 atime，这也和直觉不太一样。`man mount` 里写着，从 Linux 2.6.30 开始，内核默认采用 relatime 规则，也就是只有当 atime 早于 mtime 或 ctime，或者 atime 已经是一天以前的时间时，读取文件才会更新 atime。这样设计是为了减少磁盘写入，因为如果每读一次文件都要更新 atime，那么每一次读取都会附带一次写操作。所以 atime 只能大致说明一个文件最近有没有被读过，并不是精确的最后读取时间。

## 四、按时间查找

`find` 可以按这三个时间查找。`-mmin`、`-cmin`、`-amin` 以分钟为单位，`-mtime`、`-ctime`、`-atime` 以天为单位。后面的数字表示从那个时间到现在经过了多久，前面加 `-` 表示不到这么久，也就是最近这段时间以内，加 `+` 表示超过这么久，也就是更早以前：

```bash
$ date +%T
21:52:00
$ find . -type f -mmin -30
./notes.txt
$ find . -type f -mmin -60
./notes.txt
./todo.txt
$ find . -type f -mmin +60
./Report.TXT
./docs/guide.md
./empty.txt
./logs/old.log
./logs/sat.log
./logs/app.log
./logs/big.log
./.hidden.txt
./photos/cat.jpg
./README.md
```

*代码 15：notes.txt 是 10 分钟前修改的，todo.txt 是 45 分钟前，其余的文件都在一个小时以前。*

如果数字前面什么都不加，那么表示的是正好经过了这么久，这种写法用得比较少。另外，按 ctime 查找时，结果和按 mtime 查找完全不一样：

```bash
$ find . -type f -cmin -30 | wc -l
12
```

*代码 16：12 个文件全部是 30 分钟以内改过属性的。*

这是因为 ctime 不能往前调，所以练习目录里这 12 个文件的 ctime，都停在了几分钟前练习目录刚建好的时候。

### 4.1 -mtime 会舍掉小数

按天查找时还有一个取整的问题。`find` 会先算出从修改时间到现在经过了几个 24 小时，把小数部分直接舍掉，然后再和后面的数字比较。练习目录里的 sat.log 是 30 小时前修改的，30 除以 24 等于 1.25，舍掉小数以后是 1，所以它算 `-mtime 1`，但是不算 `-mtime +1`：

```bash
$ find . -type f -mtime 0 | wc -l
10
$ find . -type f -mtime 1
./logs/sat.log
$ find . -type f -mtime +1
./logs/old.log
$ find . -type f -mtime +0
./logs/old.log
./logs/sat.log
```

*代码 17：old.log 是 3 天前修改的，只有它满足 `-mtime +1`。*

`man find` 里也写着，要满足 `-atime +1`，文件至少要在两天以前被访问过。所以如果要找超过一天没有修改过的文件，应该写 `-mtime +0`。

![数轴上标出 10 个文件、sat.log 和 old.log 的修改时间，下面四行分别是 -mtime 0、1、+1、+0 能匹配的范围](/img/posts/linux-find/mtime-rounding.svg)

*图 3：`-mtime` 比较的是舍掉小数以后的天数。*

## 五、组合条件：与、或、非

前面几条命令已经用到了「与」。多个条件写在一起时，`find` 默认要求它们同时满足，所以 `-name '*.md' -type f` 和 `-name '*.md' -and -type f` 是一样的。「或」要写成 `-or`，「非」要写成 `-not`：

```bash
$ find . -name '*.md' -or -name '*.log'
./docs/guide.md
./logs/old.log
./logs/sat.log
./logs/app.log
./logs/big.log
./README.md
$ find . -type f -not -name '*.txt'
./Report.TXT
./docs/guide.md
./logs/old.log
./logs/sat.log
./logs/app.log
./logs/big.log
./photos/cat.jpg
./README.md
```

*代码 18：第一条找出名字以 .md 或者 .log 结尾的文件，第二条找出名字不以 .txt 结尾的普通文件。*

`-not` 也可以写成 `!`。[第六章](/2026/09/26/Linux-Command-Line-Chapter6/)介绍过，`!` 在 bash 里会触发历史展开，但是当 `!` 后面跟着空格时，bash 不会去展开它，所以 `find . -type f ! -name '*.txt'` 可以直接运行，结果和上面的第二条命令相同。

## 六、-exec：对找到的文件执行命令

找到文件以后，往往还要接着处理它们，比如查看详细信息或者删除。[第九章](/2026/10/02/Linux-Command-Line-Chapter9/)说过，`ls`、`rm` 这类命令只看参数，不读标准输入，所以用管道把 `find` 的结果交给它们是行不通的。`find` 自己提供了一个 `-exec` 选项，它会对找到的每一个文件执行一次后面的命令：

```bash
$ find . -name '*.md' -exec ls -l {} \;
-rw-r--r-- 1 zby zby 8 Oct  4 19:51 ./docs/guide.md
-rw-r--r-- 1 zby zby 6 Oct  4 19:51 ./README.md
```

*代码 19：`find` 对找到的两个文件各执行了一次 `ls -l`。*

`-exec` 后面一直到 `\;` 为止都是要执行的命令，其中的 `{}` 会被替换成找到的文件的路径。分号前面的反斜杠不能省略，因为分号在 Shell 里是分隔两条命令的符号，第九章的 `date +%T; sleep 3` 用的就是它。如果不加反斜杠，那么分号会被 Shell 拿走，`find` 根本收不到它：

```bash
$ find . -name '*.md' -exec ls -l {} ;
find: missing argument to `-exec'
```

*代码 20：`find` 没有收到分号，于是认为 `-exec` 后面的命令还没有写完。*

写成 `'{}' ';'` 也是可以的，因为引号同样能让分号原样交给 `find`。至于 `{}`，在 bash 里不加引号也没有问题，因为第十章说过，花括号里既没有逗号、也不是序列的时候，花括号展开不会发生。

### 6.1 `\;` 和 `+`

用 `\;` 结尾时，每找到一个文件就执行一次命令。如果把结尾换成 `+`，`find` 就会把找到的路径攒在一起，一次交给命令：

```bash
$ find . -name '*.txt' -exec echo {} \;
./empty.txt
./.hidden.txt
./notes.txt
./todo.txt
$ find . -name '*.txt' -exec echo {} +
./empty.txt ./.hidden.txt ./notes.txt ./todo.txt
```

*代码 21：用 `\;` 时 `echo` 执行了四次，每次打印一个路径；用 `+` 时只执行了一次，四个路径在同一行。*

如果文件很多，那么用 `+` 可以少启动很多次命令。但是并不是所有命令都能一次接收多个文件，遇到这样的命令就只能用 `\;`。如果要用 `-exec rm {} \;` 删除文件，最好先把 `rm` 换成 `ls` 或者 `echo` 运行一遍，确认找到的文件是对的。

### 6.2 -or 和 -exec 一起用时要加括号

`-exec` 和 `-or` 写在一起时，结果很可能和预想的不一样：

```bash
$ find . -name '*.md' -or -name '*.jpg' -exec ls -l {} \;
-rw-r--r-- 1 zby zby 614400 Oct  4 19:51 ./photos/cat.jpg
$ find . \( -name '*.md' -or -name '*.jpg' \) -exec ls -l {} \;
-rw-r--r-- 1 zby zby 8 Oct  4 19:51 ./docs/guide.md
-rw-r--r-- 1 zby zby 614400 Oct  4 19:51 ./photos/cat.jpg
-rw-r--r-- 1 zby zby 6 Oct  4 19:51 ./README.md
```

*代码 22：第一条命令只对 cat.jpg 执行了 `ls -l`，两个 .md 文件被漏掉了。*

这是因为在 `find` 的条件里，「与」比「或」先结合，而 `-exec` 和前面的条件之间也是一个省略掉的「与」。所以第一条命令实际的意思是，名字以 .md 结尾，或者「名字以 .jpg 结尾并且执行 `ls -l`」。.md 文件满足了「或」的左边，后面的 `-exec` 就不会再执行了。而且只要条件里出现了 `-exec`，`find` 就不会再自动打印找到的路径，所以这两个 .md 文件在屏幕上一点痕迹都没有留下。如果要让 `-exec` 对两种文件都生效，就要用括号把「或」括起来。括号在 Shell 里也有特殊含义，所以要像分号一样在前面加上反斜杠。

## 七、xargs：把标准输入变成参数

第九章里的 `echo /usr/bin | ls` 列出的仍然是当前目录，因为 `ls` 不读标准输入。`xargs` 正好用来解决这个问题。它会从标准输入读取内容，按照空格和换行把内容拆成一个个单词，然后把这些单词作为参数加在后面那条命令的末尾，再执行这条命令：

```bash
$ echo /usr/bin | ls
README.md   backup  empty.txt  notes.txt  todo.txt
Report.TXT  docs    logs       photos
$ echo /usr/bin | xargs ls -d
/usr/bin
```

*代码 23：`xargs` 把读到的 /usr/bin 加在了 `ls -d` 的后面，实际执行的是 `ls -d /usr/bin`。*

所以 `find` 的结果也可以通过管道和 `xargs` 交给别的命令：

```bash
$ find . -name '*.log' | xargs ls -l
-rw-r--r-- 1 zby zby       8 Oct  4 19:51 ./logs/app.log
-rw-r--r-- 1 zby zby 2097152 Oct  4 19:51 ./logs/big.log
-rw-r--r-- 1 zby zby       4 Oct  1 21:51 ./logs/old.log
-rw-r--r-- 1 zby zby       9 Oct  3 15:51 ./logs/sat.log
```

*代码 24：四个路径一次交给了 `ls -l`，所以输出是 `ls` 排过序的。*

### 7.1 xargs 和 -exec 并不完全一样

`find . -empty | xargs ls` 和 `find . -empty -exec ls {} \;` 看起来做的是同一件事，但是输出并不相同：

```bash
$ find . -empty -exec ls {} \;
./empty.txt
$ find . -empty | xargs ls
./empty.txt

./backup:
```

*代码 25：`-exec` 执行了两次 `ls`，而 `xargs` 只执行了一次。*

用 `-exec ... \;` 时，`find` 分别执行了 `ls ./empty.txt` 和 `ls ./backup`，因为 backup 是空目录，所以第二次什么都没有输出。`xargs` 则把两个路径一起交给了 `ls`，而 `ls` 收到多个参数时，会在每个目录的内容前面打印一行目录名，所以多出了 `./backup:` 这一行。

`xargs` 会尽量少地执行命令，但是也不一定只执行一次。如果参数太多，超过了一条命令行能容纳的长度，`xargs` 就会把它们分成几批：

```bash
$ find /usr -type f 2>/dev/null | wc -l
44188
$ find /usr -type f 2>/dev/null | xargs echo | wc -l
19
$ find /usr -type f -exec echo {} + 2>/dev/null | wc -l
19
```

*代码 26：/usr 下的 44188 个文件被分成了 19 批，`echo` 每执行一次打印一行。`2>/dev/null` 丢掉的是一个没有读取权限的目录引起的报错。*

`-exec ... +` 也是一样的，它同样会在参数太多的时候分批执行。

### 7.2 空的输入和带空格的文件名

`xargs` 有两个比 `-exec` 多出来的坑。第一个是输入为空的情况。如果 `find` 一个文件都没有找到，那么 `-exec` 后面的命令一次都不会执行，但是 GNU 的 `xargs` 仍然会把命令执行一次，只是不带任何参数：

```bash
$ find . -name '*.png' -exec ls {} \;
$ find . -name '*.png' | xargs ls
README.md   backup  empty.txt  notes.txt  todo.txt
Report.TXT  docs    logs       photos
$ find . -name '*.png' | xargs -r ls
```

*代码 27：一个 .png 文件都没有，`xargs ls` 却列出了当前目录，加上 `-r` 以后就不会执行了。*

第二个是文件名里带空格的情况。`xargs` 按空格拆分单词，所以一个带空格的文件名会被拆成好几个参数：

```bash
$ touch 'my notes.txt'
$ find . -name '*notes*' | xargs ls -l
ls: cannot access './my': No such file or directory
-rw-r--r-- 1 zby zby 23 Oct  4 21:41 ./notes.txt
-rw-r--r-- 1 zby zby 23 Oct  4 21:41 notes.txt
$ find . -name '*notes*' -print0 | xargs -0 ls -l
-rw-r--r-- 1 zby zby  0 Oct  4 21:53 './my notes.txt'
-rw-r--r-- 1 zby zby 23 Oct  4 21:41  ./notes.txt
```

*代码 28：./my notes.txt 被拆成了 ./my 和 notes.txt，而当前目录里恰好有 notes.txt，于是它被列出了两次。*

解决的办法是让 `find` 用 `-print0` 输出，路径之间不再用换行分隔，而是用一个空字符（NUL）分隔，同时让 `xargs` 用 `-0` 按空字符拆分。因为文件名里不可能出现空字符，所以这样拆分是不会出错的。`-exec` 没有这个问题，因为 `find` 会把每个路径作为一个完整的参数直接交给命令，中间不需要再拆分一次。

所以如果只是对 `find` 找到的文件执行一条命令，用 `-exec` 更省事；如果中间还要经过别的命令处理，比如先用管道过滤一遍，再交给最后的命令，那么就用 `xargs`，并且记得加上 `-r`、`-print0` 和 `-0`。

## 小结

| 写法 | 作用和要点 |
| --- | --- |
| `locate` | 按名字快速查找。查的是数据库，新文件要等 `sudo updatedb` 以后才查得到 |
| `locate -e` | 去掉已经删除的结果，但是找不出数据库里没有的文件 |
| `-name` | 按名字查找，模式要加引号；`-iname` 不区分大小写 |
| `-type f` | 只找普通文件，`-type d` 只找目录 |
| `-size +1M` | 按大小查找。先向上取整，所以 `-size -1M` 只剩空文件 |
| `-mtime +1` | 按时间查找。`-` 是以内，`+` 是以前；按天算时舍掉小数 |
| `-or` `-not` | 组合条件。和 `-exec` 一起用时，要用 `\(` 和 `\)` 括起来 |
| `-exec` | 对找到的文件执行命令。`\;` 每个文件执行一次，`+` 攒在一起执行 |
| `xargs` | 把标准输入变成参数。空输入要加 `-r`，带空格的名字要用 `-print0` 和 `-0` |

`locate` 和 `find` 的区别在于数据从哪里来。`locate` 查的是 `updatedb` 生成的数据库，所以速度很快，但是只能看到上一次更新时的样子；`find` 每次都现场读取目录，所以结果总是准确的，只是要多花一些时间把目录走一遍。`find` 的条件看上去很多，其实只有名字、类型、大小、属主和时间这几类，其中大小和时间都要先取整再比较，这一点最容易出错。找到文件以后，`-exec` 和 `xargs` 都能把路径交给别的命令，区别在于路径是怎样变成参数的。`-exec` 把每个路径直接作为一个完整的参数交出去，而 `xargs` 要先从标准输入里把路径拆出来，所以它遇到空输入和带空格的文件名时，需要加上对应的选项才能得到正确的结果。
