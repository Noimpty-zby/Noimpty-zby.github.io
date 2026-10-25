---
title: Linux 命令行第十五章：环境变量、export 和 ~/.bashrc —— 子进程只继承导出的变量
date: 2026-10-22 23:00:00
description: Colt Steele《The Linux Command Line Bootcamp》第十五章的复盘。printenv 打印的是环境变量，也就是每个程序启动时从父进程那里得到的一组「名字=值」，在名字前面加上 $，Shell 会在运行命令之前把它替换成对应的值。直接用等号定义的是 Shell 变量，它只存在于当前的 Shell 里，用 export 导出以后才会成为环境变量，传给之后启动的子进程，但是子进程里的修改不会传回来。想让变量和别名在每个新的终端里都有效，就要把它们写进 ~/.bashrc，因为每个交互式的 bash 启动时都会读取这个文件，而写在里面的环境变量同样需要 export。Ubuntu 默认的 ~/.bashrc 还会读入 ~/.bash_aliases，所以自己的别名可以单独放在那个文件里。
categories:
  - [课外, AI Infra, Linux入门]
tags:
  - 环境变量
  - Shell
  - 配置文件
  - 别名
series: Linux 命令行
privacy: protected
sitemap: false
private_section: 课外
---

[第十四章](/2026/10/21/Linux-Command-Line-Chapter14/)讲 `su` 的时候提到过，不带减号的 `su` 只设置 HOME、SHELL、USER 和 LOGNAME 这几个环境变量，这一章就专门来讲变量。Shell 里的变量分成两种，一种是只属于当前这个 Shell 的 Shell 变量，另一种是会传给其他程序的环境变量，两者的区别要从进程的角度才能看清楚。前四节讲怎样查看和定义这两种变量，第五节讲 bash 的配置文件，也就是怎样让一个设置在每个新打开的终端里都有效，最后一节讲同样写在配置文件里的别名。

这一章的命令都在家目录里运行，用的是 Ubuntu 22.04 自带的 bash 5.1。

<!-- more -->

## 一、用 printenv 查看环境变量

每个程序在启动的时候，都会从启动它的那个程序那里得到一组字符串，`man bash` 把这组字符串叫作环境（environment）。其中的每一项都写成「名字=值」的形式，这就是环境变量。在终端里输入 `printenv`，它会把所有的环境变量一行一个地打印出来。因为环境变量通常有几十个，一屏显示不下，所以一般会用[第九章](/2026/10/02/Linux-Command-Line-Chapter9/)的管道把输出交给 `less`，写成 `printenv | less`，这样就可以一页一页地翻看了。

每一行里等号左边的是变量名，右边的是变量的值，这样的一对名字和值也叫键值对（key-value pair）。如果只关心其中的几个变量，那么可以用 `grep` 把它们挑出来，也可以直接把变量名写在 `printenv` 的后面：

```bash
$ printenv | grep -E '^(HOME|USER|LANG)='
HOME=/home/zby
LANG=C.UTF-8
USER=zby
$ printenv HOME
/home/zby
$ printenv USER LANG
zby
C.UTF-8
$ printenv nosuch
$ echo $?
1
```

*代码 1：写上变量名时，`printenv` 只打印变量的值；变量不存在时什么都不打印，退出状态码是 1。*

HOME 是当前用户的家目录，USER 是用户名，LANG 决定了程序用哪种语言和字符编码来显示信息。环境变量的名字习惯上都用大写字母。另一个常用的环境变量是 PATH，[第二章](/2026/09/05/Linux-Command-Line-Chapter2/)讲过，`which` 会到 PATH 列出的那几个目录里逐个查找命令，Shell 运行外部命令的时候也是按照这个顺序查找的。

## 二、用 $ 取出变量的值

如果想在命令里用到某个变量的值，那么要在变量名的前面加上 `$`：

```bash
$ echo $USER
zby
$ echo "$USER 的家目录是 $HOME"
zby 的家目录是 /home/zby
```

*代码 2：写在双引号里的 `$USER` 和 `$HOME` 同样会被替换。*

[第一章](/2026/08/25/Linux-Command-Line-Chapter1/)讲过，这个替换是 Shell 在运行 `echo` 之前完成的，所以 `echo` 收到的已经是 zby 和 /home/zby 这样的普通字符串。`man bash` 把这种替换叫作参数展开（parameter expansion），[第十章](/2026/10/04/Linux-Command-Line-Chapter10/)列出的展开顺序里，「变量展开」指的就是它。如果变量不存在，那么它会被替换成空字符串，比如 `echo $nosuch` 只会打印出一个空行。另外，写在单引号里的 `$USER` 不会被替换，这一点在第十章也讲过。

## 三、Shell 变量

除了系统已经设置好的环境变量，也可以自己定义变量，写法是把变量名、等号和值连在一起：

```bash
$ animal=cat
$ echo $animal
cat
$ animal = cat
Command 'animal' not found, did you mean:
  command 'animals' from deb animals (201207131226-2.1build1)
Try: sudo apt install <deb name>
```

*代码 3：等号的两边不能有空格。*

因为 Shell 是按照空格来切分一条命令的，所以 `animal = cat` 会被拆成 animal、= 和 cat 三个词。这时第一个词被当成了命令的名字，后面两个词被当成了它的参数，而系统里并没有叫作 animal 的命令，于是 Ubuntu 提示说，有一个名字相近的软件包叫 animals。

这样定义出来的变量叫作 Shell 变量，它只存在于当前这个 Shell 里，并不在环境变量当中，所以 `printenv` 找不到它：

```bash
$ printenv animal
$ echo $?
1
$ declare -p animal
declare -- animal="cat"
$ which printenv
/usr/bin/printenv
```

*代码 4：`declare -p` 会打印出一个变量的定义，`--` 表示这个变量没有任何特殊的属性。*

`printenv` 之所以看不到 animal，是因为 `printenv` 并不是 Shell 的一部分，而是 /usr/bin 下的一个独立的程序。Shell 运行它的时候，要先启动一个新的进程，这个新的进程叫作子进程，而启动它的 Shell 就是它的父进程。子进程只能从父进程那里拿到环境变量，Shell 变量是不会交给它的。

同样的道理，如果在当前的 Shell 里输入 `bash`，那么会启动一个新的 bash 作为子进程，这个新的 bash 里也没有 animal：

```bash
$ bash
$ echo $animal

$ exit
exit
$ echo $animal
cat
```

*代码 5：子进程 bash 里的 animal 是空的，`exit` 回到原来的 Shell 以后，animal 仍然是 cat。*

在子进程里输入 `exit` 会结束这个 bash，回到原来的 Shell。这时 animal 又能打印出来了，说明它一直都在，只是没有传给子进程。所以 Shell 变量有点像程序里的局部变量，只在定义它的那个 Shell 里有效。

## 四、用 export 导出为环境变量

如果想让子进程也能用到一个变量，那么要用 `export` 把它导出（export）。对于已经定义好的变量，写 `export animal` 就可以了；也可以写成 `export animal=cat`，这样定义和导出一步就完成了。

```bash
$ export animal
$ printenv animal
cat
$ declare -p animal
declare -x animal="cat"
```

*代码 6：导出以后，`printenv` 能找到 animal 了，`declare -p` 打印的属性也从 `--` 变成了 `-x`。*

`-x` 表示这个变量带有导出的属性。bash 在启动子进程的时候，会把所有带这个属性的变量复制一份，交给子进程作为它的环境，所以导出的变量也就成了环境变量。HOME、USER 这些变量之所以在每个 Shell 里都有，也是因为它们在登录的时候就已经是环境变量了，之后的每一个子进程都会从父进程那里继承一份。

复制只会从父进程到子进程，而且子进程拿到的是一份副本，所以在子进程里修改这个变量，只会改变子进程自己的那一份：

```bash
$ bash
$ echo $animal
cat
$ animal=dog
$ echo $animal
dog
$ exit
exit
$ echo $animal
cat
```

*代码 7：子进程里把 animal 改成了 dog，回到父进程以后，animal 仍然是 cat。*

图 1 把导出前后的两种情况放在了一起。这里的子进程指的是从当前这个 Shell 里启动的程序，而另外打开的终端窗口并不是当前 Shell 的子进程，它的环境是在登录的时候重新建立的，所以新的终端里不会有 animal。同样，关掉当前的终端以后，这个 Shell 里定义的变量不管有没有导出，都会跟着一起消失。如果不再需要一个变量，那么可以用 `unset animal` 把它删除。

![上半部分是 export 之前：父进程 bash 里有 HOME、USER 两个导出的变量和一个未导出的 animal=cat，启动子进程时只复制导出的变量，所以子进程里只有 HOME 和 USER，$animal 是空的；下半部分是 export animal 之后：三个变量都带有导出属性，子进程拿到了 animal=cat 的副本，子进程把它改成 animal=dog 以后，这个修改不会传回父进程，父进程里 echo $animal 仍然打印 cat](/img/posts/linux-env/env-inherit.svg)

*图 1：子进程只拿到父进程导出的变量，而且拿到的是一份副本。*

## 五、bash 的配置文件

既然在终端里定义的变量会随着终端一起消失，那么想让一个设置长期有效，就要把它写进配置文件。每当启动一个交互式的 bash，也就是一个在终端里等待用户输入命令的 bash，它都会先读取并执行两个配置文件，依次是 /etc/bash.bashrc 和 ~/.bashrc，这条规则写在 `man bash` 的 INVOCATION 一节里。因为这两个文件里的命令在每个新的 Shell 里都会重新执行一遍，所以写在里面的变量和别名在每个终端里都有。

这两个文件的区别在于作用的范围。先看一下 /etc 下的 bash.bashrc，以及新用户的 ~/.bashrc 所复制的模板 /etc/skel/.bashrc：

```bash
$ ls -l /etc/bash.bashrc /etc/skel/.bashrc
-rw-r--r-- 1 root root 2319 Jan  7  2022 /etc/bash.bashrc
-rw-r--r-- 1 root root 3771 Jan  7  2022 /etc/skel/.bashrc
```

*代码 8：两个文件的属主都是 root，其他人只有读权限。*

/etc/bash.bashrc 是整个系统共用的配置文件，这台机器上所有用户的 bash 都会读取它。它的属主是 root，所以修改它需要 sudo，而且改动会影响到每一个用户。~/.bashrc 则放在每个用户自己的家目录里，只对这个用户起作用。上一章用 `adduser` 新建 alice 的时候，`adduser` 把 /etc/skel 里的几个文件复制进了 alice 的家目录，~/.bashrc 就是其中之一，复制完以后它就归用户自己修改了。所以平时要改的是 ~/.bashrc，而不是 /etc/bash.bashrc。

### 5.1 在 ~/.bashrc 里定义变量

用[第四章](/2026/09/19/Linux-Command-Line-Chapter4/)讲的 nano 打开 ~/.bashrc，在文件的末尾加上下面这两行，然后保存并退出。第一行定义了一个普通的变量 color，第二行用 export 定义了一个环境变量 animal。

```bash
$ tail -n 3 ~/.bashrc

color=red
export animal=cat
$ echo $color $animal

$ source ~/.bashrc
$ echo $color $animal
red cat
```

*代码 9：刚改完 ~/.bashrc 的时候，当前的 Shell 里还没有这两个变量，`source` 以后才有。*

~/.bashrc 只在 bash 启动的时候读取一次，所以在文件被修改之前就已经启动的 Shell，包括当前的这个终端，都不知道文件里多了两行。`source ~/.bashrc` 会在当前的 Shell 里把这个文件重新执行一遍，于是这两个变量就有了。`source` 也可以简写成一个点，`. ~/.bashrc` 的效果完全一样。另一个办法是关掉终端，再打开一个新的，因为新的 Shell 在启动时会读到修改以后的 ~/.bashrc：

```bash
$ echo $color $animal
red cat
```

*代码 10：新打开的终端里，两个变量都有了。*

但是不能写成 `bash ~/.bashrc`。这样写会启动一个子进程来运行这个文件，文件里定义的变量都留在了子进程里，子进程一结束，它们也就没有了，当前的 Shell 什么也得不到。而且这样运行还会报一个错：

```bash
$ bash ~/.bashrc
/home/zby/.bashrc: line 8: return: can only `return' from a function or sourced script
```

*代码 11：用来运行文件的 bash 不是交互式的，于是走到了第 8 行的 return。*

~/.bashrc 开头的几行会检查当前的 Shell 是不是交互式的，如果不是，就用 return 提前结束，不再往下执行。可是 return 只能用在函数和被 source 的文件里，所以这里报了错，然后 bash 接着执行了文件里剩下的命令。

### 5.2 写在 ~/.bashrc 里的变量也要 export

color 和 animal 在每个新的终端里都有，看起来写不写 export 好像没有区别。但是用 `printenv` 检查一下就能发现，它们仍然是两种不同的变量：

```bash
$ printenv color
$ printenv animal
cat
$ bash -c 'echo "color=$color animal=$animal"'
color= animal=cat
```

*代码 12：`bash -c` 会启动一个 bash 来运行引号里的命令，这个 bash 不是交互式的，不读 ~/.bashrc。*

没有 export 的 color 仍然只是一个 Shell 变量。它之所以在每个终端里都有，是因为每个交互式的 bash 启动时都会执行一遍 `color=red`，自己重新定义了一次。而 `printenv`、`bash -c` 和 Shell 脚本这些从终端里启动的程序，只能从环境变量里拿到值，它们自己又不会去读 ~/.bashrc，所以都看不到 color。因此如果在 ~/.bashrc 里定义的变量要给其他程序使用，比如修改 PATH，那么前面一定要加上 export。

### 5.3 登录 Shell 和 ~/.profile

上面讲的是交互式 bash 的一般情况。如果 bash 是作为登录 Shell 启动的，比如 SSH 登录、上一章的 `su -`，以及 WSL 打开的终端，那么它读取的是另外一组文件，先读 /etc/profile，再读家目录里的 ~/.profile（如果家目录里有 ~/.bash_profile，那么读的是它，~/.profile 就不再被读取了）。不过在 Ubuntu 上，这两个文件里都有一段代码，会转而读入对应的 bashrc 文件，~/.profile 里的那一段是这样的：

```bash
$ sed -n '11,17p' ~/.profile
# if running bash
if [ -n "$BASH_VERSION" ]; then
    # include .bashrc if it exists
    if [ -f "$HOME/.bashrc" ]; then
        . "$HOME/.bashrc"
    fi
fi
```

*代码 13：如果正在运行的是 bash，并且 ~/.bashrc 存在，就用 `.` 读入它。*

所以不管是不是登录 Shell，~/.bashrc 最后都会被读到，图 2 画出了这几个文件的读取顺序。如果想知道当前的 Shell 是不是登录 Shell，那么可以运行 `shopt login_shell`，结果是 on 就表示是登录 Shell。

![三列对比 bash 启动时读取的文件。登录 Shell（WSL 的终端、SSH 登录、su -）先读 /etc/profile，它再读入 /etc/bash.bashrc；然后读 ~/.profile，它再读入 ~/.bashrc，~/.bashrc 又读入 ~/.bash_aliases。交互式的非登录 Shell（桌面终端、在终端里输入 bash）先读 /etc/bash.bashrc，再读 ~/.bashrc，后者读入 ~/.bash_aliases。非交互式的 Shell（bash -c、运行 Shell 脚本）不读这几个配置文件，只能拿到父进程导出的环境变量。/etc 下的文件属于 root，所有用户共用；家目录里的文件只对当前用户起作用](/img/posts/linux-env/bash-startup-files.svg)

*图 2：登录 Shell 和交互式的非登录 Shell 最后都会读到 ~/.bashrc，非交互式的 bash 则不读这些文件。*

还有一点要注意，这些都是 bash 的配置文件。如果终端里运行的是 zsh 之类的其他 Shell，那么它读的是自己的配置文件，比如 zsh 读的是 ~/.zshrc，写在 ~/.bashrc 里的设置对它不起作用。运行 `echo $0` 可以看到当前的 Shell 是哪一个。

## 六、别名

[第二章](/2026/09/05/Linux-Command-Line-Chapter2/)和[第十二章](/2026/10/19/Linux-Command-Line-Chapter12/)讲过，`ls` 和 `grep` 输出的颜色来自 Ubuntu 默认的 ~/.bashrc 里定义的别名（alias）。别名就是给一段命令起的一个短名字，输入这个名字时，Shell 会先把它替换成那段命令，然后再运行。不带参数的 `alias` 会列出当前所有的别名，后面写上名字时则只显示这几个：

```bash
$ alias ll la l
alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'
```

*代码 14：这三个别名也是 Ubuntu 默认的 ~/.bashrc 定义的。*

所以在 Ubuntu 上，`ll` 本来就可以直接使用，它相当于 `ls -alF`，其中的 `-F` 会在名字后面加上一个表示文件类型的符号，比如在目录后面加上 /，在可执行文件后面加上 *。定义别名的写法和定义变量很像，等号两边同样不能有空格，又因为 `ls -la` 中间有一个空格，所以要用引号把它括起来。比如把 ll 改成 `ls -la`：

```bash
$ alias ll='ls -la'
$ alias ll
alias ll='ls -la'
$ bash
$ alias ll
alias ll='ls -alF'
$ exit
exit
$ alias ll
alias ll='ls -la'
```

*代码 15：在子进程 bash 里，ll 又变回了 `ls -alF`。*

别名和 Shell 变量一样只属于当前的 Shell，而且别名没有导出的办法，所以不会传给子进程。代码 15 里的子进程 bash 之所以还有 ll，是因为它启动时读了 ~/.bashrc，重新定义了一遍默认的 `ls -alF`，刚才在终端里定义的 `ls -la` 并没有传过去。如果想删除一个别名，那么可以用 `unalias`，比如 `unalias ll`。

### 6.1 把别名放进 ~/.bash_aliases

想让别名一直有效，同样要把它写进配置文件。不过 Ubuntu 默认的 ~/.bashrc 里有一段注释，建议把自己添加的别名放进一个单独的文件 ~/.bash_aliases，而紧跟在注释后面的三行代码，会在这个文件存在的时候读入它：

```bash
$ sed -n '99,106p' ~/.bashrc
# Alias definitions.
# You may want to put all your additions into a separate file like
# ~/.bash_aliases, instead of adding them here directly.
# See /usr/share/doc/bash-doc/examples in the bash-doc package.

if [ -f ~/.bash_aliases ]; then
    . ~/.bash_aliases
fi
```

*代码 16：~/.bashrc 的第 99 到 106 行。*

也就是说，~/.bash_aliases 并不是 bash 本身规定的文件，bash 只认 ~/.bashrc，是这三行代码让 ~/.bash_aliases 起了作用。这个文件默认是不存在的，用[第八章](/2026/09/28/Linux-Command-Line-Chapter8/)的 `>>` 把别名追加进去时，它会被自动创建出来：

```bash
$ echo "alias ll='ls -la'" >> ~/.bash_aliases
$ cat ~/.bash_aliases
alias ll='ls -la'
```

*代码 17：外面用的是双引号，所以里面的单引号会原样写进文件。*

这时打开一个新的终端，ll 就已经是 `ls -la` 了：

```bash
$ alias ll
alias ll='ls -la'
```

*代码 18：新的终端里，ll 来自 ~/.bash_aliases。*

默认的 `alias ll='ls -alF'` 写在 ~/.bashrc 的第 91 行，而读入 ~/.bash_aliases 的代码在第 104 行。因为后定义的别名会覆盖先定义的同名别名，所以最后生效的是 ~/.bash_aliases 里的 `ls -la`。把自己的设置单独放在一个文件里还有一个好处，那就是 ~/.bashrc 可以保持原样，哪些设置是自己加的也一目了然。

[Git 第十六章](/2026/10/17/Git-Chapter16-Aliases/)也讲过别名，但那是 Git 自己的另一套机制。Git 的别名写在 ~/.gitconfig 里，只能用在 git 的后面，比如 `git s`；而 Shell 的别名写在 bash 的配置文件里，替换的是一条命令开头的第一个词。

## 小结

| 写法 | 作用和要点 |
| --- | --- |
| `printenv` | 列出环境变量 |
| `$HOME` | Shell 先替换再运行命令 |
| `animal=cat` | 等号两边不能有空格 |
| `export` | 导出为环境变量 |
| `declare -p` | `-x` 表示已导出 |
| `unset` | 删除变量 |
| `source` | 在当前 Shell 里执行 |
| `~/.bashrc` | 交互式 bash 都会读 |
| `alias` | 只在当前 Shell 有效 |
| `~/.bash_aliases` | 由 ~/.bashrc 读入 |

`printenv` 打印的环境变量，是每个程序启动时从父进程那里得到的一组「名字=值」，在变量名前面加上 `$`，Shell 就会在运行命令之前把它替换成对应的值。直接用等号定义的是 Shell 变量，它只存在于当前的 Shell 里，用 `export` 导出以后才会复制给之后启动的子进程，而子进程里的修改不会传回父进程。在终端里定义的变量和别名都会随着终端一起消失，所以要长期使用的设置应该写进 ~/.bashrc，因为每个交互式的 bash 启动时都会读取它，登录 Shell 也会通过 ~/.profile 读到它。写在 ~/.bashrc 里的变量如果要给其他程序使用，仍然需要 export。最后，Ubuntu 默认的 ~/.bashrc 还会读入 ~/.bash_aliases，所以自己的别名可以单独放在这个文件里。

下一章讲[怎样写一个 Shell 脚本，并且通过 PATH 把它变成一条命令](/2026/10/25/Linux-Command-Line-Chapter16/)。
