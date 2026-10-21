---
title: Linux 命令行第十三章：文件权限 —— 三组 rwx 只看一组，目录没有 x 就进不去
date: 2026-10-20 21:28:00
description: Colt Steele《The Linux Command Line Bootcamp》第十三章的复盘。Linux 上的每个文件都记录着一个属主和一个属组，ls -l 开头的十个字符里，第一个字符是文件类型，后面九个字符分成属主、属组和其他人三组，每组用 r、w、x 表示能不能读、写和执行。系统会根据用户的身份从三组里只挑出一组来检查，所以属主自己也会被第一组挡住。r、w、x 用在目录上时含义和用在文件上不一样，目录的 x 决定能不能进入目录、访问里面的文件，而能不能删除一个文件，要看它所在目录的 w。
categories:
  - [课外, AI Infra, Linux入门]
tags:
  - 权限
  - 用户和组
  - chmod
cover: /img/covers/Linux-Command-Line-Chapter13.svg
series: Linux 命令行
privacy: protected
sitemap: false
private_section: 课外
---

前面几章用到的文件基本上都在家目录里，属于当前登录的用户，所以读和写都没有遇到过阻碍。但是 Linux 是一个多用户的系统，同一台机器上可以有很多个账户，系统自己也有 root 等一批账户。如果用普通账户去打开属于 root 的文件，比如用 nano 编辑 /etc/passwd，那么 nano 会在底部提示这个文件不可写，可是用 `cat` 却能正常地把内容打印出来。决定这些行为的，就是文件的权限（permission）。

[第三章](/2026/09/05/Linux-Command-Line-Chapter3/)介绍过 `ls -l` 输出的八个部分，这一章细讲其中的类型和权限，以及属主、属组这两列。例子都在练习目录 ~/perm-lab 里运行，目录里有两个文件、一个目录和一个符号链接：

```bash
$ ls -l
total 12
drwxr-xr-x 2 zby zby 4096 Oct 20 20:36 docs
-rw-r--r-- 1 zby zby   37 Oct 20 20:33 hello.sh
-rw-r--r-- 1 zby zby   18 Oct 20 20:31 notes.txt
lrwxrwxrwx 1 zby zby    9 Oct 20 20:40 todo -> notes.txt
$ cat notes.txt
buy milk
call mom
$ cat hello.sh
#!/bin/bash
echo "hello from script"
$ ls docs
a.txt  b.txt
```

*代码 1：docs 目录里有 a.txt 和 b.txt 两个文件，todo 是指向 notes.txt 的符号链接。*

<!-- more -->

## 一、用户和组

`whoami` 会打印当前的用户名，`id` 则打印得更详细一些：

```bash
$ whoami
zby
$ id
uid=1000(zby) gid=1000(zby) groups=1000(zby),4(adm),24(cdrom),27(sudo),30(dip),46(plugdev)
```

*代码 2：zby 的用户号是 1000，主组是 zby，另外还属于 adm、sudo 等五个组。*

系统内部是用数字来区分用户和组的，uid 是用户号，gid 是组号，括号里的名字只是为了方便人看。组（group）是一批用户的集合，一个用户可以同时属于好几个组。Ubuntu 在创建用户的时候，会同时创建一个和用户同名的组，作为这个用户的主组，所以 zby 既是一个用户名，也是一个组名。

每个文件都记录着一个属主（owner）和一个属组（group），它们就是 `ls -l` 输出的第三列和第四列，而第二列是第三章讲过的硬链接数。代码 1 里这两列都是 zby，前一个 zby 是用户，后一个 zby 是那个同名的组。系统目录里的文件则大多属于 root，比如记录所有账户的 /etc/passwd，和记录密码哈希值的 /etc/shadow：

```bash
$ ls -l /etc/passwd /etc/shadow
-rw-r--r-- 1 root root   1538 Oct  3 18:44 /etc/passwd
-rw-r----- 1 root shadow  886 Sep 25 15:39 /etc/shadow
```

*代码 3：两个文件的属主都是 root，/etc/shadow 的属组是 shadow。*

## 二、第一个字符：文件类型

`ls -l` 每一行开头的十个字符里，第一个字符表示文件的类型。代码 1 里已经出现了其中的三种：

- `-` 表示普通文件（regular file），比如文本文件、图片和程序
- `d` 表示目录（directory）
- `l` 表示符号链接（symbolic link），名字后面的 `->` 标出了它指向哪里

另外还有两种类型，在 /dev 目录下可以看到：

```bash
$ ls -l /dev/null /dev/sda
crw-rw-rw- 1 root root 1, 3 Oct 21 14:21 /dev/null
brw-rw---- 1 root disk 8, 0 Oct 21 14:21 /dev/sda
```

*代码 4：/dev/null 是字符设备文件，/dev/sda 是块设备文件。*

`c` 表示字符设备文件（character special file），`b` 表示块设备文件（block special file）。这两种文件里并没有存放数据，它们各自代表一个设备，读写这个文件，实际上就是在和设备打交道。字符设备按照字节的顺序一个一个地读写，比如终端和[第八章](/2026/09/28/Linux-Command-Line-Chapter8/)用过的 /dev/null；块设备则以固定大小的数据块为单位读写，并且可以直接跳到任意位置，比如硬盘 /dev/sda。所以 block 说的是这个设备的读写方式，并不是说这个文件本身是一个数据块。因为设备文件没有大小，所以原来显示大小的那一列，换成了两个用逗号隔开的设备号。

除了这五种以外，还有 `p`（命名管道）和 `s`（套接字）两种类型，它们是程序之间传递数据用的，平时很少需要直接接触。

## 三、九个字符分成三组

后面的九个字符每三个一组，从左到右分别对应属主、属组和其他人（others，课程里也叫 world）。每一组里的三个位置是固定的，依次是 r、w、x：

- r（read）表示读
- w（write）表示写
- x（execute）表示执行

某一位上是字母，就表示有这项权限；是 `-`，就表示没有。比如 notes.txt 的 `rw-r--r--`，拆开来就是属主 `rw-`，可以读，也可以写；属组 `r--`，只能读；其他人也是 `r--`，同样只能读。课程里举的例子 `-rw-rw-r--` 则表示属主和属组都可以读写，其他人只能读。

![上半部分把 -rw-r--r-- 拆成类型和三组，并和属主、属组两列用颜色对应起来；下半部分是三个判断：是属主就只看第一组，在属组里就只看第二组，其余的人看第三组](/img/posts/linux-permissions/permission-bits.svg)

*图 1：九个字符分成三组，但是对于一个具体的用户，只有其中一组起作用。*

这三组权限并不会叠加起来使用。当一个用户访问文件时，系统先看他是不是这个文件的属主，如果是，就只检查第一组；如果不是属主，但是在文件的属组里，那么就只检查第二组；如果两者都不是，才检查第三组。也就是说，对于任何一个用户，九个字符里真正起作用的只有三个。

### 3.1 同样的权限，不同的结果

/etc/shadow 和 /var/log 下的系统日志 syslog.1 权限完全相同，都是 `rw-r-----`，但是 zby 读取它们的结果并不一样：

```bash
$ ls -l /etc/shadow /var/log/syslog.1
-rw-r----- 1 root   shadow     886 Sep 25 15:39 /etc/shadow
-rw-r----- 1 syslog adm    1609313 Oct 19 20:54 /var/log/syslog.1
$ wc -l /etc/shadow
wc: /etc/shadow: Permission denied
$ wc -l /var/log/syslog.1
13786 /var/log/syslog.1
```

*代码 5：zby 读不了 /etc/shadow，却能读 syslog.1。*

zby 不是这两个文件的属主，所以第一组 `rw-` 和他无关。syslog.1 的属组是 adm，代码 2 显示 zby 在 adm 组里，于是系统检查第二组 `r--`，允许读取。/etc/shadow 的属组是 shadow，zby 不在这个组里，所以系统检查的是第三组 `---`，拒绝了读取。Ubuntu 的文档（/usr/share/doc/base-passwd/users-and-groups.txt）对 adm 组的说明是 Members of this group can read many log files in /var/log，也就是说，把用户加进 adm 组，就是为了让他能够查看 /var/log 里的日志。

### 3.2 属主也会被第一组挡住

只检查一组的规则，对属主自己同样有效。做这个实验需要先修改文件的权限，所以这里先介绍 `chmod` 最简单的一种写法。`chmod u-r notes.txt` 的意思是去掉属主的读权限，其中 u 表示属主（user），g 表示属组（group），o 表示其他人（others），a 表示所有人（all）；`-` 表示去掉，`+` 表示加上；最后的字母就是要去掉或者加上的权限。

```bash
$ chmod u-r notes.txt
$ ls -l notes.txt
--w-r--r-- 1 zby zby 18 Oct 20 20:31 notes.txt
$ cat notes.txt
cat: notes.txt: Permission denied
$ cat todo
cat: todo: Permission denied
$ chmod u+r notes.txt
```

*代码 6：其他人都能读 notes.txt，属主 zby 自己反而读不了，最后一条命令把读权限加了回来。*

去掉属主的读权限以后，属组和其他人仍然是 `r--`。但是 zby 是 notes.txt 的属主，所以系统只检查第一组 `-w-`，于是拒绝了读取，并不会因为其他人可以读，就也让属主读。通过符号链接 todo 去读，结果也是一样的。这是因为符号链接自己的权限永远显示成 `rwxrwxrwx`，它并不起作用，系统检查的是链接指向的那个文件的权限。

## 四、文件的 r、w 和 x

对于普通文件来说，r 表示可以读取文件的内容，比如用 `cat`、`less` 查看，或者用 `cp` 复制一份；w 表示可以修改文件的内容；x 表示可以把这个文件当作程序来运行。

### 4.1 没有 w

开头提到的 /etc/passwd 就是一个只有 root 才能修改的文件。它的权限是 `rw-r--r--`，zby 属于其他人，只有 r 没有 w，所以 nano 能够打开它，但是会在底部提示文件不可写。如果在这种情况下修改内容，再按 `^S` 保存，那么 nano 会报告写入失败：

```
[ File '/etc/passwd' is unwritable ]
[ Error writing /etc/passwd: Permission denied ]
```

*代码 7：第一行是 nano 打开文件时的提示，第二行是按下 `^S` 以后的提示。*

这时可以按 `^X` 退出，再对 Save modified buffer? 回答 N，放弃这次的修改。在练习目录里也可以试一下，先用 `a-w` 去掉所有人的写权限，再往 notes.txt 里追加一行：

```bash
$ chmod a-w notes.txt
$ ls -l notes.txt
-r--r--r-- 1 zby zby 18 Oct 20 20:31 notes.txt
$ echo "buy eggs" >> notes.txt
bash: notes.txt: Permission denied
$ cat notes.txt
buy milk
call mom
```

*代码 8：三组都去掉了 w，追加失败，文件的内容没有变化。*

报错信息的开头是 bash 而不是 echo，这是因为打开文件准备追加的是 Shell。[第八章](/2026/09/28/Linux-Command-Line-Chapter8/)讲过，重定向是 Shell 在运行命令之前完成的，所以 `echo` 还没有开始运行，Shell 就已经失败了。

### 4.2 x：作为程序运行

hello.sh 是一个 Shell 脚本，第一行的 `#!/bin/bash` 说明要用 /bin/bash 来解释它。新建的文件默认没有 x 权限，所以这时还不能直接运行它：

```bash
$ ./hello.sh
bash: ./hello.sh: Permission denied
$ bash hello.sh
hello from script
$ chmod u+x hello.sh
$ ls -l hello.sh
-rwxr--r-- 1 zby zby 37 Oct 20 20:33 hello.sh
$ ./hello.sh
hello from script
```

*代码 9：给属主加上 x 以后，hello.sh 就可以直接运行了。*

`./hello.sh` 的意思是把当前目录下的 hello.sh 当作程序来运行，这需要 x 权限。而 `bash hello.sh` 运行的程序是 bash，hello.sh 只是交给 bash 读取的一个参数，所以只要有 r 权限就可以了。

## 五、目录的 r、w 和 x

[第五章](/2026/09/19/Linux-Command-Line-Chapter5/)讲过，目录的内容是一张从名字到 inode 号的对照表。从这一点出发，目录的三种权限就比较好理解了。r 表示可以读这张表，也就是列出目录里有哪些名字；w 表示可以修改这张表，也就是在目录里新建、删除文件，或者给文件改名；x 表示可以通过这张表找到名字对应的文件，进入这个目录和访问里面的文件都需要它。`man chmod` 在介绍 x 时写的是 execute (or search for directories)，所以对于目录来说，x 的意思是搜索，而不是执行。

下面的例子要查看 docs 目录本身的权限，所以用的是 `ls -ld`，其中 `-d` 表示列出目录本身，而不是列出目录里的内容。

### 5.1 只有 r，没有 x

```bash
$ chmod u-x docs
$ ls -ld docs
drw-r-xr-x 2 zby zby 4096 Oct 20 20:36 docs
$ ls docs
ls: cannot access 'docs/b.txt': Permission denied
ls: cannot access 'docs/a.txt': Permission denied
a.txt  b.txt
$ ls -l docs
ls: cannot access 'docs/b.txt': Permission denied
ls: cannot access 'docs/a.txt': Permission denied
total 0
-????????? ? ? ? ?            ? a.txt
-????????? ? ? ? ?            ? b.txt
$ cd docs
bash: cd: docs: Permission denied
$ cat docs/a.txt
cat: docs/a.txt: Permission denied
$ chmod u+x docs
```

*代码 10：去掉属主的 x 以后，docs 里的名字还能列出来，但是除此之外什么都做不了。*

因为有 r，所以 `ls` 能读出 a.txt 和 b.txt 这两个名字。但是在 Ubuntu 默认的终端里，`ls` 其实是 `ls --color=auto` 的别名，这和第十二章里的 `grep` 是一样的。它要根据每个文件的类型和权限来选择颜色，于是会去读取每个文件的信息，而这一步需要 x，所以先报了两行错，然后才打印出名字。`ls -l` 失败的原因也一样，它只拿到了名字，所以其余各列都显示成了问号。`cd docs` 和 `cat docs/a.txt` 都要通过 docs 找到里面的东西，因此也都失败了。

### 5.2 只有 x，没有 r

```bash
$ chmod u-rw docs
$ ls -ld docs
d--xr-xr-x 2 zby zby 4096 Oct 20 20:36 docs
$ ls docs
ls: cannot open directory 'docs': Permission denied
$ cat docs/a.txt
plan A
$ cd docs
$ ls
ls: cannot open directory '.': Permission denied
$ cd ..
$ chmod u+rw docs
```

*代码 11：没有 r，就列不出 docs 里有什么；但是有 x，只要知道名字，就能读取里面的文件，也能进入这个目录。*

这时 docs 里有哪些文件是看不到的，但是如果事先知道 a.txt 这个名字，仍然可以直接访问它。也就是说，x 让系统可以按照名字在对照表里查找，r 则允许把整张表读出来，这是两件不同的事情。图 2 把属主的三位取不同组合时，各个操作能不能成功都列了出来。

![表格的六列是属主的三位取 r--、rw-、--x、r-x、-wx、rwx，五行是列出名字、查看详情、进入目录、读取里面的文件、新建删除改名；没有 x 的两列只能列出名字，有 x 的四列都能进入和读取文件，只有 -wx 和 rwx 能新建、删除和改名](/img/posts/linux-permissions/directory-rwx.svg)

*图 2：没有 x 时只能列出名字；新建、删除和改名需要 w 和 x 同时存在。*

### 5.3 w：新建、删除和改名

这里有一个很容易想当然的地方。notes.txt 在代码 8 里已经去掉了所有人的 w，但是它所在的 perm-lab 目录是可写的，这时删除 notes.txt：

```bash
$ rm notes.txt
rm: remove write-protected regular file 'notes.txt'? y
$ ls
docs  hello.sh  todo
```

*代码 12：`rm` 先确认了一次，回答 y 以后，只读的 notes.txt 就被删掉了。*

删除一个文件，修改的是它所在目录的那张对照表，也就是把一条记录从表里去掉，文件自己的内容并没有被写入，所以系统检查的是目录的 w，而不是文件的 w。`rm` 发现文件没有 w 权限时会先问一句，但是这只是 `rm` 自己的提醒，如果加上[第五章](/2026/09/19/Linux-Command-Line-Chapter5/)的 `-f`，它就不会再问了。

反过来，如果目录没有 w，那么目录里就不能新建文件，已有的文件也不能删除和改名，但是这些文件的内容仍然可以修改：

```bash
$ chmod u-w docs
$ ls -ld docs
dr-xr-xr-x 2 zby zby 4096 Oct 20 20:36 docs
$ touch docs/c.txt
touch: cannot touch 'docs/c.txt': Permission denied
$ rm docs/b.txt
rm: cannot remove 'docs/b.txt': Permission denied
$ mv docs/a.txt docs/plan.txt
mv: cannot move 'docs/a.txt' to 'docs/plan.txt': Permission denied
$ echo "plan B2" >> docs/b.txt
$ cat docs/b.txt
plan B
plan B2
$ chmod u+w docs
```

*代码 13：docs 去掉 w 以后，新建、删除和改名都失败了，但是 b.txt 的内容仍然可以追加。*

另外，目录的 w 必须和 x 一起才能起作用。只有 w 没有 x 的目录，系统无法按名字在里面查找，所以也就没有办法新建和删除，图 2 里 `rw-` 那一列就是这种情况。

### 5.4 家目录的权限

最后回到用户之间的问题。两个普通用户的家目录都在 /home 下面，那么他们能不能看到对方的文件，取决于家目录本身的权限：

```bash
$ ls -ld /home/zby /root
drwxr-x--- 18 zby  zby  4096 Oct 21 14:21 /home/zby
drwx------  4 root root 4096 Sep 25 15:40 /root
$ ls /root
ls: cannot open directory '/root': Permission denied
```

*代码 14：root 的家目录对其他人完全关闭，/home/zby 对其他人也是 `---`。*

/home/zby 的其他人一组是 `---`，所以同一台机器上的其他普通用户，既不能进入 zby 的家目录，也不能读取里面的文件。不过这是 Ubuntu 21.04 才改成的默认值，/usr/share/doc/adduser/changelog.gz 里的记录是 Enable private home directories by default。在这之前，新建用户的家目录是 `rwxr-xr-x`，其他用户可以进入并且读取里面的文件，但是不能修改，也不能在里面新建和删除。所以在比较旧的系统上，两个用户之间可以互相查看对方的文件，却不能编辑。

## 小结

| 写法 | 作用和要点 |
| --- | --- |
| `whoami` | 打印当前的用户名 |
| `id` | 打印用户号、主组和所属的全部组 |
| 第三、四列 | `ls -l` 里的属主和属组 |
| `-` `d` `l` | 普通文件、目录、符号链接 |
| `c` `b` | 字符设备文件、块设备文件 |
| 三组权限 | `rw-r--r--` 依次是属主、属组、其他人 |
| 只看一组 | 属主看第一组，组员看第二组，其余的人看第三组 |
| 文件的 rwx | 读内容、改内容、作为程序运行 |
| 目录的 r | 列出里面的名字 |
| 目录的 x | 进入目录，按名字访问里面的文件 |
| 目录的 w | 新建、删除、改名，要和 x 一起才有用 |
| `chmod u-w` | u、g、o、a 选择改哪一组，`+` 加上，`-` 去掉 |

`ls -l` 开头的十个字符，第一个是文件类型，后面九个是三组权限。权限检查的过程可以概括成两步，先根据用户的身份挑出一组，再看这一组里有没有需要的那个字母。因为只挑一组，所以属主自己被第一组挡住时，即使其他人能读，属主也读不了，而权限相同的两个文件，也可能因为属组不同，让同一个用户得到不同的结果。对于目录，r、w、x 分别对应读取名字表、修改名字表和按名字查找，所以没有 x 的目录几乎什么都做不了，而能不能删除一个文件，看的是它所在目录的 w，而不是文件自己的 w。
