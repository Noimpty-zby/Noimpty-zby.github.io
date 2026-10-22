---
title: Linux 命令行第十四章：chmod、sudo、su 和 chown —— 属主自己能改权限，改属主要靠 root
date: 2026-10-21 23:05:00
description: Colt Steele《The Linux Command Line Bootcamp》第十四章的复盘。chmod 有符号和数字两种写法，符号写法用 u、g、o、a 选择改哪一组，用加号、减号和等号表示加上、去掉和设为；数字写法把 r、w、x 记作 4、2、1 相加，每一组正好得到一个八进制数字。修改权限是属主自己就能做的事，但是修改属主、读取 root 的文件、新建用户和组，都需要 root 的权限。Ubuntu 锁住了 root 的密码，所以日常用 sudo 以 root 的身份运行单条命令，用 su 切换到另一个用户。把用户加进一个组以后，要重新登录才会生效。
categories:
  - [课外, AI Infra, Linux入门]
tags:
  - 权限
  - chmod
  - sudo
  - 用户和组
cover: /img/covers/Linux-Command-Line-Chapter14.svg
series: Linux 命令行
privacy: protected
sitemap: false
private_section: 课外
---

[第十三章](/2026/10/20/Linux-Command-Line-Chapter13/)讲了怎样读懂 `ls -l` 开头的十个字符，这一章讲怎样修改它们。修改权限的命令是 `chmod`，名字来自 change mode，因为这九个权限位在系统里叫作文件的模式（mode）。`chmod` 是属主自己就能运行的命令，但是把文件交给另一个用户、新建用户和组这类操作，普通用户是做不到的，需要 root 的权限。所以这一章的前半部分讲 `chmod` 的两种写法，后半部分讲 `sudo`、`su`、`chown`，以及组的管理。

例子仍然在练习目录 ~/perm-lab 里运行，目录里现在有两个文件和一个目录：

```bash
$ ls -l
total 12
drwxr-xr-x 2 zby zby 4096 Oct 21 22:36 docs
-rwxr--r-- 1 zby zby   37 Oct 21 22:33 hello.sh
-rw-r--r-- 1 zby zby   18 Oct 21 22:31 notes.txt
```

*代码 1：hello.sh 是上一章加过 x 的脚本，notes.txt 是一个普通的文本文件。*

<!-- more -->

## 一、chmod 的符号写法

上一章为了做实验，已经用过 `chmod u-r` 和 `chmod a-w` 这样的写法。这种写法由三部分组成，依次是改哪几组、怎么改和改哪几个权限：

- 第一部分是改哪几组，u 表示属主（user），g 表示属组（group），o 表示其他人（others），a 表示所有人（all），相当于同时写了 u、g、o
- 第二部分是怎么改，`+` 表示加上，`-` 表示去掉，`=` 表示设为
- 第三部分是改哪几个权限，可以是 r、w、x 中的一个或者几个

比如 `chmod g+w notes.txt` 的意思是给 notes.txt 的属组加上 w，`chmod o-r notes.txt` 则是去掉其他人的 r：

```bash
$ chmod g+w notes.txt
$ ls -l notes.txt
-rw-rw-r-- 1 zby zby 18 Oct 21 22:31 notes.txt
$ chmod o-r notes.txt
$ ls -l notes.txt
-rw-rw---- 1 zby zby 18 Oct 21 22:31 notes.txt
```

*代码 2：每条命令只改动了一位，其余八位保持原样。*

第一部分和第三部分都可以同时写好几个字母，比如 `go+x` 表示给属组和其他人都加上 x。如果要对不同的组做不同的修改，那么可以用逗号把几段写法连起来，例如 `g-x,o-rx` 表示去掉属组的 x，同时去掉其他人的 r 和 x：

```bash
$ chmod go+x hello.sh
$ ls -l hello.sh
-rwxr-xr-x 1 zby zby 37 Oct 21 22:33 hello.sh
$ chmod g-x,o-rx hello.sh
$ ls -l hello.sh
-rwxr----- 1 zby zby 37 Oct 21 22:33 hello.sh
```

*代码 3：第一条命令改了两组，第二条命令用逗号连起两段写法。*

逗号的前后不能有空格。如果写成 `chmod g-x, o-rx hello.sh`，那么 Shell 会把 `g-x,` 和 `o-rx` 拆成两个参数，`chmod` 把前一个当作模式，发现结尾多了一个逗号，于是报告 invalid mode: ‘g-x,’，什么都没有修改。

### 1.1 等号

`+` 和 `-` 只改动写出来的那几位，没有写到的位保持原样。`=` 则不一样，它把指定的组设为恰好这几个权限，所以这一组里没有写出来的权限都会被去掉，而没有指定的组仍然不受影响：

```bash
$ chmod g=r notes.txt
$ ls -l notes.txt
-rw-r----- 1 zby zby 18 Oct 21 22:31 notes.txt
$ chmod a=r notes.txt
$ ls -l notes.txt
-r--r--r-- 1 zby zby 18 Oct 21 22:31 notes.txt
$ chmod u=rw,go=r notes.txt
$ ls -l notes.txt
-rw-r--r-- 1 zby zby 18 Oct 21 22:31 notes.txt
```

*代码 4：`g=r` 去掉了属组的 w，属主和其他人两组没有变化；`a=r` 把三组都设成了只读。*

第一条命令执行之前，notes.txt 的属组是 `rw-`，`g=r` 把它设成了 `r--`，效果相当于去掉了 w。属主的 `rw-` 和其他人的 `---` 因为没有被指定，所以都保持不变。最后一条命令用 `u=rw,go=r` 把三组一次设定好，notes.txt 就又回到了 `rw-r--r--`。如果等号后面什么都不写，比如 `chmod o= notes.txt`，那么其他人的三个权限会全部被去掉。图 1 把三种符号放在一起做了对比。

![上半部分把 chmod g+w notes.txt 里的 g、+、w 分别连到三张卡片，列出改哪几组（u 属主、g 属组、o 其他人、a 所有人）、怎么改（+ 加上、- 去掉、= 设为）和改哪几个权限（r 读、w 写、x 执行）；下半部分从 rw-rw---- 出发，g+x 得到 rw-rwx---，g-w 得到 rw-r-----，g=x 得到 rw---x---，变化的位用粉色标出](/img/posts/linux-chmod/chmod-symbolic.svg)

*图 1：`+` 和 `-` 只动写出来的那一位，`=` 会把这一组里没写的位也去掉。*

## 二、chmod 的数字写法

另一种写法是用三个数字表示三组权限。每一组里的 r、w、x 分别记作 4、2、1，有这项权限就把对应的数加上，没有就不加，加起来的和就是这一组的数字。比如 `rwx` 是 4+2+1=7，`r-x` 是 4+0+1=5，`r--` 是 4，一个权限都没有的 `---` 则是 0，所以 `rwxr-xr-x` 写成数字就是 755。

这里的 4、2、1 其实就是二进制数里的三个位。每一组的三个权限正好对应三个二进制位，有权限的位记作 1，没有的记作 0，这样得到一个三位的二进制数，它的取值范围是 0 到 7，正好是一个八进制数字。八个数字和权限的对应关系如下：

| 数字 | 二进制 | 权限 |
| --- | --- | --- |
| 0 | 000 | `---` |
| 1 | 001 | `--x` |
| 2 | 010 | `-w-` |
| 3 | 011 | `-wx` |
| 4 | 100 | `r--` |
| 5 | 101 | `r-x` |
| 6 | 110 | `rw-` |
| 7 | 111 | `rwx` |

三组各用一个数字表示，从左到右依次是属主、属组和其他人，所以 `chmod` 的数字写法总是三个数字：

```bash
$ chmod 755 hello.sh
$ ls -l hello.sh
-rwxr-xr-x 1 zby zby 37 Oct 21 22:33 hello.sh
$ chmod 600 notes.txt
$ ls -l notes.txt
-rw------- 1 zby zby 18 Oct 21 22:31 notes.txt
$ stat -c '%a %A %n' notes.txt hello.sh docs
600 -rw------- notes.txt
755 -rwxr-xr-x hello.sh
755 drwxr-xr-x docs
```

*代码 5：`stat -c` 按指定的格式打印文件的信息，`%a` 是数字形式的权限，`%A` 是 `ls -l` 里的那种形式，`%n` 是文件名。*

![左边把 755 拆成三个数字，7 等于 4+2+1，对应二进制 111 和 rwx；两个 5 都等于 4+0+1，对应 101 和 r-x，合起来是 rwxr-xr-x；右边列出常见的 644、755、600、700 和它们的用途](/img/posts/linux-chmod/chmod-octal.svg)

*图 2：每个数字管一组，4、2、1 分别对应 r、w、x。*

数字写法每次都会把九位全部重新设定一遍，`chmod 755` 和 `chmod u=rwx,go=rx` 的效果完全一样。所以如果只想在原来的基础上改动一位，比如给属组加上 w，那么符号写法更方便，因为它不需要知道其余八位现在是什么；而如果想把权限设成一个确定的值，那么数字写法更简短。常见的取值有 644、755、600 和 700 几种，644 是普通文件，属主可以读写，其他人只能读；755 多了三个 x，常用在脚本和目录上；600 和 700 则只有属主自己能访问。

600 常用在不能让别人看到的文件上，比如 [Git 第七章](/2026/10/06/Git-Chapter7-GitHub/)用 `ssh-keygen` 生成的 SSH 私钥。`ssh-keygen` 生成的私钥默认就是 600，如果把它改成 644，那么 SSH 会拒绝使用这把私钥。下面的 `-N ''` 表示不设口令，`-f` 指定文件名，而 `ssh-keygen -y` 会读取私钥，打印出对应的公钥：

```bash
$ ssh-keygen -q -t ed25519 -N '' -f demo_key
$ ls -l demo_key demo_key.pub
-rw------- 1 zby zby 399 Oct 21 22:52 demo_key
-rw-r--r-- 1 zby zby  93 Oct 21 22:52 demo_key.pub
$ chmod 644 demo_key
$ ssh-keygen -y -f demo_key
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
Permissions 0644 for 'demo_key' are too open.
It is required that your private key files are NOT accessible by others.
This private key will be ignored.
Load key "demo_key": bad permissions
```

*代码 6：私钥的属组和其他人有了 r 以后，SSH 不再使用它。*

报错里的 0644 前面多了一个 0，这是因为数字写法最多可以有四位，第一位表示几种特殊的权限，平时都是 0，所以通常省略不写。把私钥改回 `chmod 600 demo_key` 以后，`ssh-keygen -y` 就能正常打印出公钥了。

## 三、root 和 sudo

前两节的命令都是 zby 对自己的文件运行的。如果对属于 root 的文件运行 `chmod`，那么即使只是给其他人加上读权限，也会被拒绝：

```bash
$ chmod o+r /etc/shadow
chmod: changing permissions of '/etc/shadow': Operation not permitted
```

*代码 7：只有文件的属主和 root 能够修改文件的权限。*

root 是系统里的超级用户，它的用户号是 0。上一章介绍的那套权限检查对 root 基本不起作用，root 可以读写系统里的任何文件，也可以修改任何文件的权限和属主。Ubuntu 在安装时不会给 root 设置密码，root 的密码一直处于锁定状态，所以没有办法用密码登录 root：

```bash
$ sudo passwd -S root
root L 03/09/2026 0 99999 7 -1
```

*代码 8：第二列的 L 表示密码被锁定（locked），后面的日期是上一次修改密码的时间。*

不过 root 这个账户本身仍然存在，需要 root 的权限时，可以使用 `sudo`。在一条命令的前面加上 sudo，这条命令就会以 root 的身份运行：

```bash
$ wc -l /etc/shadow
wc: /etc/shadow: Permission denied
$ sudo wc -l /etc/shadow
[sudo] password for zby:
29 /etc/shadow
$ sudo whoami
root
```

*代码 9：加上 sudo 以后，`wc` 能读取 /etc/shadow 了；`whoami` 打印的用户名是 root。*

`sudo` 要求输入的是当前用户 zby 自己的密码，而不是 root 的密码。输入的时候屏幕上不会出现任何字符，连星号也没有，输完直接回车就可以了。验证通过以后，在同一个终端里 15 分钟之内再使用 sudo，就不会再问密码，所以第二条 `sudo whoami` 没有要求输入密码。15 分钟是 Ubuntu 的默认设置，用 `sudo sudo -V` 以 root 的身份查看 sudo 的各项设置，其中就有 Authentication timestamp timeout: 15.0 minutes 这一行。

### 3.1 谁可以用 sudo

并不是每个用户都能使用 sudo。哪些用户可以用 sudo 运行哪些命令，写在 /etc/sudoers 这个文件里，Ubuntu 默认的规则是下面这一行：

```bash
$ sudo grep '^%sudo' /etc/sudoers
%sudo	ALL=(ALL:ALL) ALL
```

*代码 10：/etc/sudoers 本身也只有 root 能读，所以这里也要加 sudo。*

开头的 `%sudo` 表示 sudo 这个组里的所有用户，`ALL=` 表示在任何一台主机上，括号里的 `ALL:ALL` 表示可以以任何用户和任何组的身份运行，最后的 ALL 表示可以运行任何命令。上一章的代码 2 显示 zby 在 sudo 组里，所以 zby 可以用 sudo 运行任何命令。`sudo -l` 会列出当前用户能用 sudo 运行哪些命令：

```bash
$ sudo -l
Matching Defaults entries for zby on Noimpty:
    env_reset, mail_badpass, secure_path=/usr/local/sbin\:/usr/local/bin\:/usr/sbin\:/usr/bin\:/sbin\:/bin\:/snap/bin,
    use_pty

User zby may run the following commands on Noimpty:
    (ALL : ALL) ALL
```

*代码 11：Noimpty 是这台机器的主机名，最后一行就是从 `%sudo` 那条规则来的。*

### 3.2 sudo apt update

使用 sudo 最常见的场景是安装和更新软件。`apt update` 用来更新软件包的列表，它要把下载的列表写进 /var/lib/apt/lists，开始之前还要先锁住这个目录，而这个目录属于 root，所以普通用户直接运行会失败：

```bash
$ apt update
Reading package lists... Done
E: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)
E: Unable to lock directory /var/lib/apt/lists/
W: Problem unlinking the file /var/cache/apt/pkgcache.bin - RemoveCaches (13: Permission denied)
W: Problem unlinking the file /var/cache/apt/srcpkgcache.bin - RemoveCaches (13: Permission denied)
```

*代码 12：apt 打不开锁文件，于是停了下来。*

所以更新软件包列表的命令要写成 `sudo apt update`，安装软件用的 `sudo apt install` 也是同样的道理。因为 sudo 之后的命令不再受权限的限制，路径写错一个字符就可能改坏系统文件，所以只在确实需要 root 的时候才加 sudo。

## 四、用 su 切换用户

`sudo` 每次只以 root 的身份运行一条命令。如果想以另一个用户的身份连续运行多条命令，那么可以用 `su` 切换到那个用户。为了演示，先用 `sudo adduser alice` 新建一个用户 alice：

```bash
$ sudo adduser alice
Adding user `alice' ...
Adding new group `alice' (1001) ...
Adding new user `alice' (1001) with group `alice' ...
Creating home directory `/home/alice' ...
Copying files from `/etc/skel' ...
New password:
Retype new password:
passwd: password updated successfully
Changing the user information for alice
Enter the new value, or press ENTER for the default
	Full Name []:
	Room Number []:
	Work Phone []:
	Home Phone []:
	Other []:
Is the information correct? [Y/n]
```

*代码 13：adduser 依次新建了组、用户和家目录，再要求设置密码和填写几项个人信息。*

adduser 先建了一个和用户同名的组 alice，再建了用户 alice，两者的编号都是 1001。接着它创建了家目录 /home/alice，并且把 /etc/skel 里的几个 Shell 配置文件复制了进去。最后要给 alice 设置密码，全名、房间号、电话这几项可以直接回车留空，最后一个问题回车就表示确认。

### 4.1 带减号的 su

`su - alice` 会切换到 alice，输入 `exit` 就回到原来的用户：

```bash
$ su - alice
Password:
$ whoami
alice
$ pwd
/home/alice
$ sudo whoami
[sudo] password for alice:
alice is not in the sudoers file.  This incident will be reported.
$ exit
logout
$ whoami
zby
```

*代码 14：切换到 alice 以后，当前目录变成了 alice 的家目录。这里省略了登录时打印的欢迎信息。*

`su` 要求输入的是目标用户 alice 的密码，这一点和 sudo 不同，sudo 问的是当前用户自己的密码。切换过去以后，`whoami` 打印出 alice，当前目录也变成了 /home/alice。alice 不在 sudo 组里，所以 alice 运行 sudo 时，sudo 先验证了 alice 的密码，然后拒绝了这次请求。提示里的 This incident will be reported 是说这次请求会被记进系统日志，在 `journalctl` 里可以看到一条 alice : user NOT in sudoers 的记录。输入 `exit` 退出以后，就回到了原来 zby 的 Shell，当前目录也还是 ~/perm-lab。

### 4.2 不带减号的 su

`su` 和用户名之间的减号也可以不写，但是两种写法的效果不一样：

```bash
$ su alice
Password:
$ whoami
alice
$ pwd
/home/zby/perm-lab
$ echo $HOME
/home/alice
$ exit
exit
```

*代码 15：不带减号时，用户换成了 alice，当前目录却没有变。*

`man su` 里的说明是，为了和旧版本兼容，`su` 默认不改变当前目录，环境变量也只设置 HOME、SHELL、USER 和 LOGNAME 这几个，其余的都沿用原来用户的。所以在代码 15 里，`$HOME` 已经是 alice 的家目录，但是当前目录仍然是 zby 的 ~/perm-lab，两个用户的设置混在了一起。加上减号以后（也可以写成 `-l` 或者 `--login`），`su` 会像真正登录一样启动一个登录 Shell，它会清空原来的环境变量，重新设置 HOME、PATH 等变量，再进入目标用户的家目录。`man su` 建议总是以登录的方式切换，以免两个用户的环境混在一起产生问题，并且推荐写成完整的 `--login`，而不是简写的减号。退出时的提示也能看出这个区别，登录 Shell 退出时打印的是 logout，普通的 Shell 打印的是 exit。

不写用户名的时候，`su` 切换的是 root。但是 Ubuntu 上 root 的密码是锁定的，所以 `su` 和 `su -` 都切换不到 root，在 Ubuntu 上需要 root 的权限时，用的总是 sudo。

## 五、用 chown 修改属主和属组

`chown` 的名字来自 change owner，它用来修改文件的属主。和 `chmod` 不同，修改属主只有 root 能做，即使是文件的属主自己，也不能把文件交给别人：

```bash
$ chown alice notes.txt
chown: changing ownership of 'notes.txt': Operation not permitted
$ sudo chown alice notes.txt
$ ls -l notes.txt
-rw-r--r-- 1 alice zby 18 Oct 21 22:31 notes.txt
$ cat notes.txt
buy milk
call mom
$ echo "buy eggs" >> notes.txt
bash: notes.txt: Permission denied
$ chown zby notes.txt
chown: changing ownership of 'notes.txt': Operation not permitted
$ sudo chown zby notes.txt
```

*代码 16：加上 sudo 才能把 notes.txt 交给 alice，交出去以后也要靠 sudo 才能改回来。*

notes.txt 的属主变成 alice 以后，属组仍然是 zby。这时 zby 已经不是属主了，但是 zby 在 zby 这个组里，所以系统检查的是第二组 `r--`，zby 可以读取 notes.txt，却不能再往里面写入。而且 zby 也没有办法自己把文件要回来，最后还是用 sudo 改回了 zby。

如果只想修改属组，那么在冒号后面写上组名，冒号前面空着就可以了。修改属组的规则比修改属主宽松，属主自己就可以把文件的属组改成自己所在的任意一个组，不需要 sudo，但是改成自己不在的组仍然会被拒绝：

```bash
$ chown :adm notes.txt
$ ls -l notes.txt
-rw-r--r-- 1 zby adm 18 Oct 21 22:31 notes.txt
$ chown :shadow notes.txt
chown: changing group of 'notes.txt': Operation not permitted
$ chgrp zby notes.txt
$ ls -l notes.txt
-rw-r--r-- 1 zby zby 18 Oct 21 22:31 notes.txt
```

*代码 17：zby 在 adm 组里，所以能把属组改成 adm；zby 不在 shadow 组里，所以改不成 shadow。*

`chgrp` 是专门修改属组的命令，`chgrp zby notes.txt` 和 `chown :zby notes.txt` 的效果相同。冒号的前后都写上的时候，比如 `chown alice:devs hello.sh`，属主和属组就会一起修改，下一节建好 devs 组以后会用到这种写法。

## 六、组

### 6.1 groups 和 /etc/group

`groups` 打印的是一个用户所在的组，不写用户名时，打印的就是当前用户所在的组，而不是系统里的所有组。系统里的所有组都记录在 /etc/group 这个文件里，每行一个组：

```bash
$ groups
zby adm cdrom sudo dip plugdev
$ groups root
root : root
$ wc -l /etc/group
59 /etc/group
$ tail -3 /etc/group
zby:x:1000:
docker:x:118:
plocate:x:119:
$ grep -E '^(sudo|adm|shadow):' /etc/group
adm:x:4:syslog,zby
sudo:x:27:zby
shadow:x:42:
```

*代码 18：这台机器上一共有 59 个组，zby 只在其中的 6 个里面。*

/etc/group 的每一行用冒号分成四段，依次是组名、密码占位符 x、组号，以及组里的成员。adm 组的成员是 syslog 和 zby，所以 zby 能读 /var/log 下的日志，这是上一章 3.1 节的情况。zby 这一行的成员是空的，这是因为成员这一段只记录把它当作附加组的用户，而每个用户的主组记在 /etc/passwd 里，zby 的主组 zby 就是这样记录的，所以这里不再重复写一遍。

### 6.2 新建组和加入组

新建组的命令是 `addgroup`，把一个已有的用户加进一个已有的组，用的仍然是 `adduser`，只不过要写两个参数，前一个是用户名，后一个是组名。第四节用 `adduser` 新建 alice 时只写了一个参数，两种用法要分清楚：

```bash
$ sudo addgroup devs
Adding group `devs' (GID 1002) ...
Done.
$ sudo adduser alice devs
Adding user `alice' to group `devs' ...
Adding user alice to group devs
Done.
$ sudo adduser zby devs
Adding user `zby' to group `devs' ...
Adding user zby to group devs
Done.
$ tail -3 /etc/group
plocate:x:119:
alice:x:1001:
devs:x:1002:alice,zby
```

*代码 19：新建的 devs 组号是 1002，alice 和 zby 都成了它的成员。*

/etc/group 的最后两行是新加的。alice 这一行是第四节 `adduser alice` 建的那个同名组，它是 alice 的主组，所以和 zby 那一行一样，成员一段是空的；devs 是 alice 和 zby 的附加组，两个人的名字都写在成员里。

### 6.3 重新登录才生效

zby 已经加进了 devs 组，但是这时把文件的属组改成 devs，仍然会被拒绝：

```bash
$ groups
zby adm cdrom sudo dip plugdev
$ groups zby
zby : zby adm cdrom sudo dip plugdev devs
$ chown :devs notes.txt
chown: changing group of 'notes.txt': Operation not permitted
```

*代码 20：`groups zby` 里已经有 devs，`groups` 里还没有。*

`groups --help` 里的说明是 for the current process (which may differ if the groups database has changed)，也就是说，不写用户名时，`groups` 打印的是当前进程所在的组，它可能和组数据库里的记录不一样。一个进程属于哪些组，是在登录的时候确定的，之后由它启动的程序都沿用这份名单，所以修改 /etc/group 不会影响已经在运行的 Shell。`groups zby` 读的是刚刚改过的 /etc/group，而当前这个 Shell 在 zby 加入 devs 之前就已经启动了，所以 `chown` 检查的时候，zby 并不在 devs 组里。

想让新的组生效，最简单的办法是退出登录，再重新登录一次。如果不想重新登录，那么可以用 `sg` 以指定的组运行一条命令，或者用 `newgrp devs` 启动一个以 devs 为组的新 Shell：

```bash
$ sg devs -c "id -nG"
devs adm cdrom sudo dip plugdev zby
$ sg devs -c "chown :devs notes.txt"
$ ls -l notes.txt
-rw-r--r-- 1 zby devs 18 Oct 21 22:31 notes.txt
$ sudo chown alice:devs hello.sh
$ ls -l
total 12
drwxr-xr-x 2 zby   zby  4096 Oct 21 22:36 docs
-rwxr--r-- 1 alice devs   37 Oct 21 22:33 hello.sh
-rw-r--r-- 1 zby   devs   18 Oct 21 22:31 notes.txt
```

*代码 21：`sg` 运行的命令带着 devs 组，所以 `chown` 成功了；最后一条命令同时修改了 hello.sh 的属主和属组。*

`id -nG` 打印的第一个组是当前的主组，在 `sg devs` 运行的命令里，排在第一位的变成了 devs，原来的主组 zby 挪到了最后。

### 6.4 删除用户和组

练习用的用户和组用完以后，可以用 `deluser` 和 `delgroup` 删除，`deluser` 加上 `--remove-home` 会把用户的家目录一起删除。删除之前先把两个文件还给 zby，然后删除 alice：

```bash
$ sudo chown zby:zby notes.txt hello.sh
$ sudo deluser --remove-home alice
Looking for files to backup/remove ...
Removing files ...
Removing user `alice' ...
Warning: group `alice' has no more members.
userdel: user alice is currently used by process 14225
/usr/sbin/deluser: `/sbin/userdel alice' returned error code 8. Exiting.
```

*代码 22：家目录已经删掉了，删除用户这一步却失败了。*

报错说 alice 还有一个进程在运行。用 `journalctl` 查看这个进程号，可以看到它是 `su alice` 打开会话时为 alice 启动的 systemd 用户管理器。系统会在 alice 的会话结束大约 10 秒以后才停掉它，而上面的命令是在退出 alice 的 Shell 之后马上运行的，所以 userdel 拒绝删除一个还有进程在运行的用户。这时 deluser 已经删掉了家目录，用户本身却还在，等这个进程退出以后，再运行一次 `deluser` 就可以了：

```bash
$ sudo deluser alice
Removing user `alice' ...
Warning: group `alice' has no more members.
Done.
$ sudo delgroup devs
Removing group `devs' ...
Done.
```

*代码 23：alice 的主组 alice 在删除用户时一起被删掉了，devs 则要用 `delgroup` 单独删除。*

## 小结

| 写法 | 作用和要点 |
| --- | --- |
| `chmod g+w` | 给属组加上 w |
| `chmod g=r` | 属组恰好是 `r--` |
| `chmod 755` | 即 `rwxr-xr-x` |
| `stat -c %a` | 数字形式的权限 |
| `sudo 命令` | 以 root 身份运行 |
| `sudo -l` | 能用 sudo 做什么 |
| `su - alice` | 以登录方式切换 |
| `chown alice` | 改属主，要 root |
| `chown :adm` | 只改属组 |
| `groups` | 当前进程的组 |
| `addgroup` | 新建组 |

`chmod` 的两种写法改的是同一组权限位。符号写法按组加上、去掉或者设定几个权限，适合在原来的基础上做小的修改；数字写法把每组的 r、w、x 当作 4、2、1 相加，一次设定全部九位。修改权限是属主自己就能做的事，但是修改属主、读取 root 的文件、新建用户和组，都要用到 root 的权限。Ubuntu 锁住了 root 的密码，所以需要 root 的权限时用 sudo，它输入的是自己的密码，而且只有 sudo 组里的用户才能使用。`su` 用来切换到另一个用户，输入的是那个用户的密码，加上减号才会像真正登录一样换掉当前目录和环境变量。最后，一个进程属于哪些组是在登录时确定的，所以把用户加进一个组以后，要重新登录才会生效。
