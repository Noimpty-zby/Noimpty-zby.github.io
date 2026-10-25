---
title: Linux 命令行第十七章：cron 和 crontab —— 写好时间表，命令到点自己运行
date: 2026-10-25 19:41:00
description: Colt Steele《The Linux Command Line Bootcamp》最后一章的复盘。cron 是一个一直在后台运行的守护进程，它每分钟检查一次每个用户的 crontab，到了规定的时间，就把那一行的命令交给 /bin/sh 执行。crontab 保存在普通用户进不去的 /var/spool/cron/crontabs 里，所以要用 crontab -e 编辑，第一次运行时它会先让用户选择编辑器，保存退出以后再检查语法，没有错误才会安装。每一行的前五个字段依次是分钟、小时、日、月和星期，* 表示任意值，逗号隔开的列表、短横线连接的范围和斜杠后面的步长可以组合使用。比如 30 * * * * 是每小时的第 30 分钟各运行一次，一天一共 24 次，如果只想每天运行一次，那么小时也要写成具体的值。cron 执行命令时的环境和终端里很不一样，它不读 ~/.profile 和 ~/.bashrc，所以 ~/bin 不在 PATH 里，也没有 USER 这个变量；命令的输出如果不重定向到文件里，就会被丢掉；命令里的百分号还要写成 \%。
categories:
  - [课外, AI Infra, Linux入门]
tags:
  - cron
  - crontab
  - 定时任务
series: Linux 命令行
privacy: protected
sitemap: false
private_section: 课外
---

[第十六章](/2026/10/25/Linux-Command-Line-Chapter16/)把几条命令写进了脚本 hi，又把它放进 ~/bin，于是在任何目录下输入 `hi` 都能运行它。不过到目前为止，每一条命令都还要在终端里亲手输入才会执行。如果有些事情需要定期去做，比如每天晚上备份一次文件，或者每个月清理一次日志，那么就可以把它交给 **cron**。cron 是一个一直在后台运行的程序，它会按照用户写好的时间表，在规定的时间自动执行规定的命令，这张时间表就叫作 **crontab**（cron table）。这一章是这门课的最后一章，先看 cron 是怎样运行的，再用 `crontab -e` 编辑时间表，然后讲五个时间字段的写法，最后让任务真正跑起来，看看 cron 执行命令时的环境和终端里有什么不同。

这一章用的是 Ubuntu 22.04 自带的 cron，它是 Debian 维护的 Vixie cron，版本号是 3.0pl1。

<!-- more -->

## 一、cron 和 crontab

cron 不需要手动启动。系统启动的时候，systemd 就会把它作为一个服务运行起来，此后它一直待在后台，不和任何终端相连，这样的程序叫作**守护进程**（daemon）。用下面两条命令可以确认它正在运行：

```bash
$ systemctl is-active cron
active
$ pgrep -a cron
205 /usr/sbin/cron -f -P
```

*代码 1：`pgrep -a` 按名字查找进程，打印出进程号和完整的命令行。*

`systemctl is-active` 打印出 active，说明 cron 这个服务正在运行，`pgrep` 也找到了它的进程，运行的程序是 /usr/sbin/cron。这台机器是 WSL，因为 /etc/wsl.conf 里开启了 systemd，所以 cron 会随着 WSL 一起启动。如果 WSL 没有开启 systemd，那么 cron 默认是不会运行的，这时要先用 `sudo service cron start` 启动它，否则后面写的任务一个也不会执行。

cron 每分钟醒来一次，检查所有用户的 crontab，看看这一分钟有没有要执行的命令。每个用户都有一张自己的 crontab，里面的命令以这个用户的身份执行。这些 crontab 保存在 /var/spool/cron/crontabs 目录里，文件名就是用户名，但是普通用户不能直接查看这个目录：

```bash
$ crontab -l
no crontab for zby
$ ls /var/spool/cron/crontabs
ls: cannot open directory '/var/spool/cron/crontabs': Permission denied
$ ls -ld /var/spool/cron/crontabs
drwx-wx--T 2 root crontab 4096 Oct 25 20:01 /var/spool/cron/crontabs
$ ls -l /usr/bin/crontab
-rwxr-sr-x 1 root crontab 39568 Mar 23  2022 /usr/bin/crontab
```

*代码 2：`crontab -l` 列出当前用户的 crontab，zby 现在还没有。*

[第十三章](/2026/10/20/Linux-Command-Line-Chapter13/)讲过，列出一个目录里的文件需要这个目录的 r 权限。这个目录属于 root 用户和 crontab 组，zby 既不是 root，也不在 crontab 组里，所以只能按其他人的权限来算，而其他人的三位里一项权限也没有（最后的 T 是另一个特殊的标志，这里不用管它）。那么 `crontab` 命令又是怎样把文件写进去的呢？/usr/bin/crontab 属组那三位里的 s 表示，任何人运行它的时候，进程都会带上 crontab 组的身份，而 crontab 组对这个目录有 w 和 x 权限。`man crontab` 里说，这样设计是为了保证只有允许使用 cron 的用户才能添加任务，而且写进这个目录的 crontab 一定没有语法错误。所以平时并不需要去找这个文件，查看自己的 crontab 用 `crontab -l`，修改用 `crontab -e`。

## 二、用 crontab -e 编辑

`-e` 是 edit 的意思。第一次运行 `crontab -e` 时，它会先让用户选择用哪个编辑器：

```bash
$ crontab -e
no crontab for zby - using an empty one

Select an editor.  To change later, run 'select-editor'.
  1. /bin/nano        <---- easiest
  2. /usr/bin/vim.basic
  3. /usr/bin/vim.tiny
  4. /bin/ed

Choose 1-4 [1]: 1
```

*代码 3：直接按回车也是选 1，也就是 nano。*

这里选 1，用[第四章](/2026/09/19/Linux-Command-Line-Chapter4/)讲的 nano 来编辑。这个选择会保存在家目录的 ~/.selected_editor 里，所以下次运行 `crontab -e` 时就不再询问了，以后想换成 vim 的话，可以按照提示运行 `select-editor` 重新选择。另外，如果设置了[第十五章](/2026/10/22/Linux-Command-Line-Chapter15/)讲的环境变量 VISUAL 或者 EDITOR，那么 `crontab -e` 会直接使用它们指定的编辑器，也就不会出现这个菜单。

选好以后，nano 打开的并不是 /var/spool/cron/crontabs 里的那个文件，而是 /tmp 下的一个临时副本，标题栏里显示的路径是 /tmp/crontab.1rTPh2/crontab。因为 zby 还没有 crontab，所以副本里只有 Ubuntu 预先准备好的 23 行注释，最后几行是这样的：

```
# For example, you can run a backup of all your user accounts
# at 5 a.m every week with:
# 0 5 * * 1 tar -zcf /var/backups/home.tgz /home/
# 
# For more information see the manual pages of crontab(5) and cron(8)
# 
# m h  dom mon dow   command
```

*代码 4：以 `#` 开头的行都是注释，最后一行标出了每一列的含义。*

最后一行里的 m、h、dom、mon、dow 依次是分钟（minute）、小时（hour）、日（day of month）、月（month）和星期（day of week），下一节会逐个讲。要执行的任务就写在这些注释的下面，一行写一个。

写完以后按 Ctrl+X 退出 nano，回答 Y 保存，再按回车确认文件名。这时 `crontab` 会先检查一遍语法，没有问题才把它安装到 /var/spool/cron/crontabs 里，屏幕上会打印一行 crontab: installing new crontab。所以 `crontab -e` 并不只是打开一个文件让人编辑，退出编辑器以后的检查和安装才是它真正要做的事。安装的时候，`crontab` 会顺带更新那个目录的修改时间，而 cron 每分钟都会检查这个时间，发现变了就重新读入 crontab，所以不需要重启 cron，新写的任务从下一分钟起就会生效。

如果什么都没有改就退出了，那么 `crontab` 会打印 No modification made，也不会安装任何东西。如果某一行写错了，比如分钟写成了 60，那么它会拒绝安装，并且问要不要回到编辑器里重新修改：

```bash
$ crontab -e
no crontab for zby - using an empty one
crontab: installing new crontab
"/tmp/crontab.bKddUA/crontab":23: bad minute
errors in crontab file, can't install.
Do you want to retry the same edit? (y/n) n
crontab: edits left in /tmp/crontab.bKddUA/crontab
$ crontab -l
no crontab for zby
```

*代码 5：新加的一行是 `60 * * * * date`，而分钟只能是 0 到 59。*

第三行虽然说的是 installing new crontab，但是紧接着的检查没有通过，所以这份 crontab 并没有装上，`crontab -l` 仍然说没有。如果回答 y，那么 nano 会重新打开刚才那份内容，改正以后再保存就可以了；回答 n 则放弃这次修改，刚才写的内容留在最后一行提示的那个临时文件里。

## 三、五个时间字段

crontab 里的每一行任务由六个部分组成。前五个是时间字段，字段之间用空格或者 Tab 隔开，剩下的部分就是要执行的命令。每个时间字段能取的值如下：

| 字段 | 取值范围 |
| --- | --- |
| 分钟 | 0 到 59 |
| 小时 | 0 到 23 |
| 日 | 1 到 31 |
| 月 | 1 到 12，也可以写 jan、feb |
| 星期 | 0 到 7，也可以写 sun、mon |

*表 1：取值范围来自 `man 5 crontab`，英文缩写取前三个字母，大小写都可以。*

小时用的是 24 小时制，所以晚上 11 点要写成 23。星期这个字段里的 1 到 6 依次是星期一到星期六，星期日写成 0 或者 7 都可以。超出范围的值都会被 `crontab` 拒绝，比如星期写成 8，它会报 bad day-of-week，小时写成 24，它会报 bad hour。

cron 每分钟检查的时候，会拿当前的时间和这五个字段逐个比较，所有字段都对得上，才执行这一行的命令。字段写成 `*`，表示这个字段取任何值都可以。图 1 拆开了一个例子：

![上面一行把一条 crontab 拆成六个色块，依次是 30、9、*、*、1-5 和 date >> ~/cron.log。每个色块下面有一张卡片，写着字段的名字、取值范围和在这一行里的意思：30 是分钟，范围 0 到 59，表示第 30 分；9 是小时，范围 0 到 23，表示 9 点；第一个 * 是日，范围 1 到 31，表示每一天；第二个 * 是月，范围 1 到 12，表示每个月；1-5 是星期，范围 0 到 7，表示周一到周五；最后的命令是这一行剩下的部分，由 /bin/sh 执行。底部写着合起来就是在周一到周五的每天 9:30，运行一次 date >> ~/cron.log](/img/posts/linux-cron/crontab-fields.svg)

*图 1：`30 9 * * 1-5 date >> ~/cron.log` 表示周一到周五的 9:30 各运行一次。*

因为日和月这两个字段都是 `*`，所以真正起作用的只有分钟、小时和星期。命令 `date >> ~/cron.log` 会把当前的时间追加到 ~/cron.log 的末尾，第五节会真的运行一条类似的任务。命令这一部分会原样交给 /bin/sh 执行，所以[第八章](/2026/09/28/Linux-Command-Line-Chapter8/)的重定向、[第九章](/2026/10/02/Linux-Command-Line-Chapter9/)的管道都可以写在里面。

这里有一个很容易想当然的地方，`30 * * * * command` 看上去像是每天到了 30 分运行一次，其实并不是。因为小时字段是 `*`，表示每一个小时都可以，所以这一行会在 0:30、1:30、2:30……一直到 23:30 各运行一次，一天一共 24 次。如果只想每天运行一次，那么小时也要写成具体的值，比如 `30 9 * * *` 就是每天的 9:30。也就是说，`*` 写在哪个字段，就表示那个字段的每一个值都要运行一遍。

## 四、列表、范围和步长

除了具体的数字和 `*`，每个字段还可以写成下面三种形式：

- 用逗号隔开的几个值叫作**列表**，比如小时写成 `8,12,18`，就是 8 点、12 点和 18 点。
- 用短横线连接的两个值叫作**范围**，两端都包括在内，比如小时写成 `9-17`，就是 9 点到 17 点的每一个小时。
- 在 `*` 或者范围后面加上斜杠和一个数字，叫作**步长**，表示每隔几个值取一个，比如小时写成 `*/6`，就是 0 点、6 点、12 点和 18 点。

图 2 把几种写法放在同一天里比较，每个点代表一次运行：

![一张时间轴图，横轴是一天的 0 点到 24 点，一共五行。第一行 30 * * * *，每小时的第 30 分各有一个点，共 24 次；第二行 30 9 * * *，只在 9:30 有一个点，共 1 次；第三行 0 8,12,18 * * * 是列表，在 8 点、12 点和 18 点整各有一个点，共 3 次；第四行 0 9-17 * * * 是范围，从 9 点到 17 点每个整点一个点，共 9 次；第五行 0 */6 * * * 是步长，在 0 点、6 点、12 点和 18 点各有一个点，共 4 次](/img/posts/linux-cron/cron-timeline.svg)

*图 2：五行的日、月、星期都是 `*`，只有分钟和小时不同。*

这三种写法还可以组合起来。列表里的每一项都可以是一个范围，比如 `0-4,8-12`；范围后面也可以加步长，比如分钟写成 `1-59/2`，表示从 1 开始每隔 2 分钟取一个，也就是 1、3、5……59 这些奇数分钟。`*` 其实就是从最小值到最大值的范围，所以 `*/5` 在分钟字段里就是 0、5、10……55。

步长是从范围的起点开始数的，到了范围的终点就停下，并不会接着跨到下一个小时去数。所以只有能整除 60 的步长，在分钟字段里才是均匀的「每隔几分钟」。比如 `*/7` 取的是 0、7、14……56 这几分钟，从 56 分到下一个小时的 0 分只隔了 4 分钟。

日和星期这两个字段之间还有一条特殊的规则。如果这两个字段都写了具体的值，那么只要其中一个对得上，cron 就会运行这一行，而不是两个都要对得上。`man 5 crontab` 里举的例子是 `30 4 1,15 * 5`，它会在每个月的 1 号和 15 号的 4:30 运行，另外每个星期五的 4:30 也会运行。所以如果想表达「既是 13 号又是星期五」这样的条件，单靠这两个字段是写不出来的，要在命令里自己判断日期。

最后，前五个字段还可以整体换成一个以 `@` 开头的词。比如 `@daily` 等于 `0 0 * * *`，也就是每天 0 点运行一次，`@hourly`、`@weekly`、`@monthly` 的意思也都和名字一样。另外 `@reboot` 表示在 cron 启动的时候运行一次，因为 cron 是随系统启动的，所以通常也就是开机的时候。

## 五、让任务真的跑起来

前面的例子都要等到特定的时刻才会运行，不方便马上看到结果。为了快一点看到效果，下面在 crontab 的末尾写两行任务，第一行每分钟运行一次，第二行每 2 分钟运行一次：

```bash
* * * * * date >> ~/every.log
*/2 * * * * date >> ~/two.log
```

*代码 6：用 `crontab -e` 加在注释的下面。*

保存退出以后等几分钟，两个文件里就有了内容：

```bash
$ cat ~/every.log
Sun Oct 25 19:56:02 CST 2026
Sun Oct 25 19:57:03 CST 2026
Sun Oct 25 19:58:02 CST 2026
Sun Oct 25 19:59:02 CST 2026
Sun Oct 25 20:00:03 CST 2026
$ cat ~/two.log
Sun Oct 25 19:56:02 CST 2026
Sun Oct 25 19:58:02 CST 2026
Sun Oct 25 20:00:03 CST 2026
```

*代码 7：crontab 是在 19:55:34 安装的。*

crontab 是在 19:55 安装的，所以第一次运行发生在下一分钟的 19:56。之后 every.log 每分钟多一行，而 two.log 只在 56、58、00 这些偶数分钟各多一行，因为 `*/2` 是从 0 开始每隔 2 取一个值。另外可以看到，每次运行的时间并不是正好在第 0 秒，而是晚了两三秒，所以 cron 能保证的精度只到分钟，不能用它安排精确到秒的任务。

cron 每启动一条命令，都会在系统日志里记一行。[第十三章](/2026/10/20/Linux-Command-Line-Chapter13/)提到过，zby 在 adm 组里，所以可以读取 /var/log/syslog：

```bash
$ grep -a CRON /var/log/syslog | tail -2
Oct 25 20:00:03 Noimpty CRON[10462]: (zby) CMD (date >> ~/two.log)
Oct 25 20:00:03 Noimpty CRON[10461]: (zby) CMD (date >> ~/every.log)
```

*代码 8：括号里的 zby 是运行这条命令的用户，CMD 后面是这一行的命令部分。*

`grep` 加上 `-a` 是因为这台机器的 syslog 里，在上一次 WSL 关闭和这一次启动之间留下了一段空字节，`grep` 看到它就会把整个文件当作二进制文件，只打印一句 binary file matches，而 `-a` 让它照常按文本处理。

如果一个任务到了时间却好像没有运行，那么可以先到这里查一下。有 CMD 这一行，说明 cron 确实启动了这条命令，问题就出在命令本身；如果连这一行也没有，那么就要回头检查时间字段是不是写错了，或者 cron 是不是在运行。

## 六、cron 里的环境

在终端里能正常运行的命令，写进 crontab 以后常常会出问题，原因是 cron 执行命令时的环境和终端里很不一样。下面这一行把 cron 里的环境变量全部写进一个文件：

```bash
* * * * * env > ~/cron-env.txt
```

*代码 9：`env` 不带参数时和 `printenv` 一样，打印所有的环境变量。*

一分钟以后查看这个文件：

```bash
$ cat ~/cron-env.txt
HOME=/home/zby
LOGNAME=zby
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin
LANG=C.UTF-8
SHELL=/bin/sh
PWD=/home/zby
```

*代码 10：cron 运行命令的时候，环境变量一共只有这 6 个。*

终端里的 `printenv` 会打印出几十个变量，而这里一共只有 6 个。HOME 和 LOGNAME 是 cron 按照 /etc/passwd 里 zby 那一行设置的，所以命令里的 `~` 照样会展开成 /home/zby，命令也是在家目录里执行的。SHELL 是 /bin/sh，在 Ubuntu 上它是 dash，而不是 bash，所以 `{1..3}` 这类 bash 才有的写法在这里不能用。PATH 和 /etc/environment 里写的一样，`man 5 crontab` 里说 Debian 的 cron 会读取这个文件。

这些变量之所以这么少，是因为 cron 执行命令时不会启动登录 Shell，也不会启动交互式的 bash，所以第十五章讲的 ~/.profile 和 ~/.bashrc 一个都不会读。在 ~/.bashrc 里定义的别名和变量在这里都不存在，~/.profile 加进 PATH 的 ~/bin 也不在这里。于是，直接把第十六章的 hi 写进 crontab 就会出问题：

```bash
* * * * * hi >> ~/hi.log 2>&1
* * * * * /home/zby/bin/hi >> ~/hi.log 2>&1
```

*代码 11：第一行只写名字，第二行写出完整的路径。*

```bash
$ cat ~/hi.log
/bin/sh: 1: hi: not found
Hello there, !
Today is Sun Oct 25 19:47:03 CST 2026
```

*代码 12：两行同时在 19:47 运行，`2>&1` 把错误信息也写进了文件。*

第一行在 PATH 里找不到 hi，报错的是 /bin/sh，后面的 1 是出错的行号。第二行写出了完整的路径，所以 /bin/sh 不需要查找 PATH，hi 正常地运行了。可是第一句问候里的名字是空的，这是因为终端里的 USER 是登录的时候就设置好的环境变量，而 cron 只设置了 LOGNAME，没有设置 USER，所以 hi 里的 `$USER` 展开以后就成了空字符串。因此写进 crontab 的命令和脚本，用到的程序最好都写完整的路径，也不要依赖 ~/.bashrc 里的设置。

另一种办法是在 crontab 的开头给变量赋值，写法和 Shell 里一样，比如：

```bash
PATH=/home/zby/bin:/usr/bin:/bin
* * * * * hi >> ~/hi.log 2>&1
```

*代码 13：赋值只对写在它下面的任务起作用。*

这样 `hi` 就能找到了。不过要注意，crontab 里的赋值不会展开变量，写成 `PATH=$HOME/bin:$PATH` 的话，PATH 的值就是这一串字符本身，`$HOME` 和 `$PATH` 都不会被替换。

除了环境，命令的输出也和在终端里不一样。cron 启动的命令没有终端可以显示，如果没有重定向，那么输出会被 cron 用邮件发给 crontab 的主人。可是这台机器上没有安装发送邮件的程序，所以输出直接被丢掉了，系统日志里会记下一行：

```bash
$ crontab -l | tail -1
* * * * * echo hello
$ grep -a CRON /var/log/syslog | tail -2
Oct 25 20:01:03 Noimpty CRON[10724]: (zby) CMD (echo hello)
Oct 25 20:01:03 Noimpty CRON[10723]: (CRON) info (No MTA installed, discarding output)
```

*代码 14：MTA 是 mail transfer agent，也就是负责发送邮件的程序。*

所以 crontab 里的命令一般都要像代码 11 那样，用 `>>` 把输出追加到文件里，再加上 `2>&1` 把错误信息也写进去。否则任务出了错，屏幕上和文件里都看不到任何提示。

最后还有一个容易踩到的地方，就是百分号。在 crontab 的命令部分里，`%` 有特殊的含义，cron 会把第一个 `%` 换成换行，后面的内容当作这条命令的标准输入。所以想在日志里只记录时和分，写成下面第一行是不行的：

```bash
* * * * * date +%H:%M >> ~/time.log
* * * * * date +\%H:\%M >> ~/time.log
```

*代码 15：第二行在每个 `%` 前面加了反斜杠。*

第一行实际执行的命令只有 `date +`，系统日志里记下的就是 `(zby) CMD (date +)`，后面的 `H:M >> ~/time.log` 变成了 `date` 的标准输入，连重定向也一起失效了，所以 time.log 根本不会出现，`date +` 打印的那一个空行也和 `echo hello` 一样被丢掉了。第二行在每个 `%` 前面加了反斜杠，cron 就会把它当作普通的字符，time.log 里每分钟多出一行 19:47、19:48 这样的时间。

## 七、查看、备份和删除

`crontab -l` 会打印出当前的整张 crontab，包括开头那 23 行注释。除了 `crontab -e`，`crontab` 后面直接跟一个文件名，也能把这个文件安装成当前用户的 crontab，不过它会整个替换掉原来的内容。

删除用的是 `crontab -r`，它会把整张 crontab 一起删掉，而且不做任何确认。键盘上 r 和 e 挨在一起，想输入 `crontab -e` 时按错一个键，所有的任务就都没有了。加上 `-i` 以后，它会先问一句再删。所以比较稳妥的做法是先用 `crontab -l` 把内容保存到一个文件里，万一删错了，还可以用这个文件装回来：

```bash
$ crontab -l > ~/crontab.bak
$ crontab -i -r
crontab: really delete zby's crontab? (y/n) y
$ crontab -l
no crontab for zby
$ crontab ~/crontab.bak
$ crontab -l | tail -2
* * * * * date >> ~/every.log
*/2 * * * * date >> ~/two.log
```

*代码 16：`crontab -l` 的输出重定向到 ~/crontab.bak，删掉以后再用 `crontab ~/crontab.bak` 装回来。*

平时如果只想去掉其中一个任务，那么也应该用 `crontab -e` 删掉那一行，而不是用 `crontab -r`。前面测试用的两个任务每分钟都会往文件里写一行，不再需要的时候要记得删掉，否则它们会一直运行下去。

## 小结

| 写法 | 作用和要点 |
| --- | --- |
| `crontab -e` | 编辑，检查语法后安装 |
| `crontab -l` | 打印当前的 crontab |
| `crontab -r` | 整张删除，不确认 |
| `crontab 文件` | 用文件替换 crontab |
| `*` | 任意值 |
| `8,12,18` | 列表 |
| `9-17` | 范围，两端都包括 |
| `*/5` | 步长，从起点开始数 |
| `@daily` | 每天 0 点运行一次 |
| `\%` | 命令里的百分号 |
| `>> 文件 2>&1` | 保存输出和错误 |

*表 2：五个时间字段依次是分钟、小时、日、月和星期。日和星期都写了具体的值时，两者有一个对得上就会运行。*

cron 是一个随系统启动、一直在后台运行的守护进程，它每分钟检查一次所有用户的 crontab，到点就把那一行的命令交给 /bin/sh 执行。crontab 保存在普通用户不能直接访问的目录里，所以要用 `crontab -e` 编辑，它会先检查语法，没有错误才安装，安装以后不需要重启 cron。每一行的前五个字段依次是分钟、小时、日、月和星期，`*` 表示任意值，逗号、短横线和斜杠分别表示列表、范围和步长。哪个字段写成 `*`，就表示那个字段的每一个值都要运行一遍，所以 `30 * * * *` 一天会运行 24 次。cron 执行命令时不读 ~/.profile 和 ~/.bashrc，PATH 里没有 ~/bin，也没有 USER 变量，所以命令和脚本最好写完整的路径；没有重定向的输出会被丢掉，所以要用 `>>` 和 `2>&1` 把输出写进文件；命令里的 `%` 要写成 `\%`。

到这里，《The Linux Command Line Bootcamp》这门课就全部学完了。从第一章分清终端、Shell 和内核开始，先学会查看手册、在目录树里移动和增删文件，然后是 nano、快捷键、查看文本的工具、重定向和管道、展开和引号、`find` 和 `grep`，接着是权限、用户和环境变量，最后两章把命令写进脚本，再交给 cron 按时运行。回头看，其中很多章讲的其实是同一件事，就是一条命令在真正运行之前，Shell 替它做了哪些准备，比如展开通配符、打开重定向的文件、按照 PATH 找到程序，以及把环境变量交给它。cron 里遇到的那几个问题，大多也出在这些准备和终端里不一样，所以弄清楚了这一点，就能明白同一条命令为什么在终端里能运行，写进 crontab 以后却不行。
