---
title: Linux 命令行第十六章：Shell 脚本、PATH 和位置参数 —— 放进 ~/bin 的脚本就是一条命令
date: 2026-10-25 17:42:00
description: Colt Steele《The Linux Command Line Bootcamp》第十六章的复盘。Shell 脚本是写着 Shell 命令的文本文件，第一行的 #!/bin/bash 告诉内核要用 bash 来运行它，不写这一行的话，脚本能不能运行、由哪个 Shell 运行，都要看是谁启动了它。想像 ls 一样只输入名字就能运行脚本，要满足两个条件，一是脚本所在的目录在 PATH 里，因为 bash 只会按照 PATH 的顺序去找命令，Ubuntu 默认的 ~/.profile 会在 ~/bin 存在时把它加到 PATH 的最前面；二是脚本要有 x 权限，而且因为 bash 要读取它的内容，所以还要有 r 权限。命令行上跟在脚本名字后面的词，会依次放进 $1、$2 这些位置参数里，$0 是脚本的路径，$# 是参数的个数。选项对 Shell 来说只是普通的参数，脚本可以用 case 语句按照 $1 的值选择要执行的命令。
categories:
  - [课外, AI Infra, Linux入门]
tags:
  - Shell 脚本
  - PATH
  - 位置参数
  - case
series: Linux 命令行
privacy: protected
sitemap: false
private_section: 课外
---

[第十三章](/2026/10/20/Linux-Command-Line-Chapter13/)用 hello.sh 演示过 x 权限，当时只是顺带提到，第一行的 `#!/bin/bash` 说明要用 bash 来解释这个文件。这一章就从这样一个脚本开始，把几条命令写进一个文件，再一步一步地把它变成一条和 `ls` 一样的命令。所谓 Shell 脚本，就是一个写着 Shell 命令的文本文件，bash 会从上往下一行一行地执行它。如果想在任何目录下只输入一个名字就能运行它，那么要解决三个问题，第一是 Shell 去哪里找这个名字，第二是这个文件有没有执行的权限，第三是系统怎样知道该用哪个程序来运行它。这三个问题分别对应第二到第五节的 PATH、x 权限和第一行的 `#!`。最后两节讲脚本怎样读取命令行上的参数，以及怎样用 `case` 处理 `-h` 这样的选项。

这一章的命令同样用的是 Ubuntu 22.04 自带的 bash 5.1。

<!-- more -->

## 一、第一个脚本

先用[第四章](/2026/09/19/Linux-Command-Line-Chapter4/)讲的 nano 在家目录里新建一个文件，名字就叫 hi，写入下面四行，然后保存并退出：

```bash
$ nano hi
$ cat hi
#!/bin/bash
# This is my first script
echo "Hello there, $USER!"
echo "Today is $(date)"
```

*代码 1：hi 的内容。*

第一行的 `#!/bin/bash` 叫作 shebang，它告诉系统这个文件要交给 /bin/bash 来运行，第五节会专门讲它。第二行以 `#` 开头，是一行注释，bash 执行脚本时会跳过 `#` 后面的内容，所以注释只是写给人看的，一般用来说明这个脚本是做什么的。后面两行才是要执行的命令，`$USER` 是[第十五章](/2026/10/22/Linux-Command-Line-Chapter15/)讲的环境变量，`$(date)` 是[第十章](/2026/10/04/Linux-Command-Line-Chapter10/)讲的命令替换，因为它们写在双引号里，所以照样会被替换。

写好以后，用 `bash` 来运行它：

```bash
$ bash hi
Hello there, zby!
Today is Sun Oct 25 18:03:45 CST 2026
```

*代码 2：bash 从上往下执行了 hi 里的两条 echo。*

这里运行的程序其实是 bash，hi 只是交给 bash 读取的一个参数，第十三章讲过，这种写法只需要 hi 有 r 权限就可以了。但是每次都要在前面写上 bash，而且还要写对 hi 所在的路径，这和 `ls` 这样的命令比起来还差得很远。下面三节就来解决这个问题，目标是在任何目录下直接输入 `hi` 就能运行它。

## 二、Shell 怎样找到一条命令

现在直接输入 `hi`，Shell 会说找不到这条命令：

```bash
$ hi
Command 'hi' not found, but can be installed with:
sudo snap install hi
$ echo $?
127
```

*代码 3：退出状态码 127 表示找不到命令。*

明明 hi 就在当前目录里，Shell 为什么找不到它呢？这是因为 Shell 并不会到当前目录里找命令。[第二章](/2026/09/05/Linux-Command-Line-Chapter2/)讲过，`type` 能看出一个名字属于别名、内建命令、函数还是外部程序。如果一个名字既不是别名，也不是函数和内建命令，那么 bash 就会到环境变量 PATH 列出的目录里，查找同名的可执行文件。PATH 的值是用冒号隔开的一串目录：

```bash
$ echo $PATH
/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/usr/lib/wsl/lib:/snap/bin
$ which ls
/usr/bin/ls
```

*代码 4：在 WSL 里，PATH 中还会有一串 /mnt/c 开头的 Windows 目录，这里把它们省略了。*

bash 会按照从左到右的顺序，在这些目录里逐个查找，在哪个目录里先找到，就运行哪一个，后面的目录也就不再查了。比如输入 `ls` 时，bash 在第五个目录 /usr/bin 里找到了 ls，于是运行的就是 /usr/bin/ls。`which` 用的也是这个顺序，所以它打印的正是 Shell 实际会运行的那个文件。要注意的是，这个查找是 Shell 自己完成的，并不是操作系统替它做的，`man bash` 的 COMMAND EXECUTION 一节描述的就是这个过程。如果找遍了所有的目录都没有，那么 bash 会报告找不到命令，退出状态码是 127。Ubuntu 在这时还会多查一步，看看有没有同名的软件包，所以代码 3 里多了一句提示，说 snap 商店里正好有一个叫 hi 的软件。

因为当前目录并不在 PATH 里，所以只写一个 hi，Shell 是不会到当前目录里去找的。这样设计也是出于安全的考虑，即使当前目录里放着一个叫 ls 的文件，输入 `ls` 时运行的也仍然是 /usr/bin/ls。如果确实要运行当前目录里的程序，那么就要像第十三章的 `./hello.sh` 那样写出路径。`man bash` 里说，命令的名字里只要含有斜杠，bash 就不再查找 PATH，而是直接运行这个路径上的文件。

要让 `hi` 能被找到，办法有两种，一种是把 hi 放进 PATH 里已有的某个目录，另一种是把 hi 所在的目录加进 PATH。前一种办法要往 /usr/local/bin 这样属于 root 的目录里写文件，不但需要 sudo，而且会影响到所有的用户，所以一个用户自己写的脚本，通常用的是后一种办法。

在起名字之前，最好先用 `type` 查一下这个名字有没有被占用：

```bash
$ type hi
bash: type: hi: not found
$ type test
test is a shell builtin
```

*代码 5：hi 还没有被占用，test 则是 Shell 的内建命令。*

因为 bash 要先查内建命令，查不到才会去 PATH 里找，所以如果把一个脚本命名为 test，那么输入 `test` 时运行的永远是内建的那个，这个脚本根本不会被执行。

## 三、把 ~/bin 加进 PATH

Ubuntu 已经为这件事做好了准备。第十五章讲过，登录 Shell 启动时会读取 ~/.profile，而这个文件的第 19 到 22 行是这样写的：

```bash
$ sed -n '19,22p' ~/.profile
# set PATH so it includes user's private bin if it exists
if [ -d "$HOME/bin" ] ; then
    PATH="$HOME/bin:$PATH"
fi
```

*代码 6：如果家目录里有 bin 这个目录，就把它加到 PATH 的最前面。*

`[ -d "$HOME/bin" ]` 用来检查 ~/bin 是不是一个已经存在的目录，如果是，那么下一行就把 `$HOME/bin` 和一个冒号接在原来的 PATH 前面。所以只要在家目录里建一个 bin 目录，再把 hi 移进去就可以了：

```bash
$ mkdir ~/bin
$ mv hi ~/bin/
$ hi
Command 'hi' not found, but can be installed with:
sudo snap install hi
$ source ~/.profile
$ echo $PATH
/home/zby/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/usr/lib/wsl/lib:/snap/bin
```

*代码 7：`source ~/.profile` 以后，PATH 的最前面多了 /home/zby/bin。*

刚建好 ~/bin 的时候，hi 仍然找不到。这是因为 ~/.profile 只在登录时读取一次，而当前的 Shell 登录的时候 ~/bin 还不存在，那段 if 的条件不成立，PATH 也就没有被修改。这和上一章修改 ~/.bashrc 以后的情况一样，要用 `source` 在当前的 Shell 里把 ~/.profile 重新执行一遍，这时条件成立了，/home/zby/bin 才被加进 PATH。要注意的是，加进 PATH 的是 /home/zby/bin 这个目录，而不是 hi 这个文件，所以以后放进 ~/bin 的其他脚本，也都能直接用名字来运行。

代码 6 里修改 PATH 的那一行并没有写 export，可是上一章的 5.2 节说过，要给其他程序使用的变量一定要导出，这两件事并不矛盾。因为 PATH 在登录的时候就已经是一个环境变量了，给一个已经导出的变量重新赋值，它的导出属性仍然保留着，所以用 `declare -p PATH` 查看，开头仍然是 `declare -x`。

图 1 画出了现在 bash 查找 hi 和 bash 这两个名字的过程。因为 /home/zby/bin 排在最前面，所以 hi 在第一个目录里就找到了。也正因为它排在最前面，如果在 ~/bin 里放一个和系统命令同名的脚本，那么运行的会是这个脚本，而不是系统里原来的那条命令。

![一张表，左边一列是 PATH 里的十一个目录，从上往下依次是 /home/zby/bin、/usr/local/sbin、/usr/local/bin、/usr/sbin、/usr/bin、/sbin、/bin、/usr/games、/usr/local/games、/usr/lib/wsl/lib、/snap/bin。右边两列分别是输入 hi 和输入 bash 时的查找结果：hi 在第一个目录 /home/zby/bin 里就找到了，后面的目录不再查找；bash 在前四个目录里都没有，在第五个目录 /usr/bin 里找到，/bin 里虽然也有 bash，但是不会查到那里。底部的注释说明 /bin 是指向 usr/bin 的链接，所以 /bin/bash 和 /usr/bin/bash 是同一个文件](/img/posts/linux-script/path-lookup.svg)

*图 1：bash 按照 PATH 的顺序查找，找到第一个就停下来。*

以后新打开的终端就不需要再 source 了。WSL 打开的终端是登录 Shell，启动时会读取 ~/.profile，而这时 ~/bin 已经存在，所以 PATH 里自然就有它。如果是在桌面版的 Ubuntu 上，那么终端一般不是登录 Shell，~/.profile 是在登录桌面的时候读取的，所以要注销以后重新登录一次才会生效。另外，如果终端里运行的是 zsh，那么它不会读取 ~/.profile，这时要自己在 ~/.zshrc 里写上 `export PATH="$HOME/bin:$PATH"`。还有一点，在同一个 Shell 里多次运行 `source ~/.profile`，PATH 的开头就会出现好几个 /home/zby/bin，不过这并不影响查找，重新打开一个终端就恢复了。

## 四、加上执行权限

现在 bash 已经能找到 hi 了，但是还不能运行它：

```bash
$ hi
bash: /home/zby/bin/hi: Permission denied
$ echo $?
126
$ ls -l ~/bin/hi
-rw-r--r-- 1 zby zby 89 Oct 25 18:03 /home/zby/bin/hi
```

*代码 8：bash 在 /home/zby/bin 里找到了 hi，但是它没有 x 权限。*

这次的报错和代码 3 不一样，错误信息里已经出现了 hi 的完整路径，说明在 PATH 里的查找已经成功了，失败的是运行这一步，所以退出状态码也从 127 变成了 126。原因和第十三章的 4.2 节一样，用 nano 新建的文件默认是没有 x 权限的，用[第十四章](/2026/10/21/Linux-Command-Line-Chapter14/)的 `chmod` 加上就可以了：

```bash
$ chmod a+x ~/bin/hi
$ ls -l ~/bin/hi
-rwxr-xr-x 1 zby zby 89 Oct 25 18:03 /home/zby/bin/hi
$ cd /tmp
$ hi
Hello there, zby!
Today is Sun Oct 25 18:04:06 CST 2026
$ which hi
/home/zby/bin/hi
```

*代码 9：加上 x 权限以后，在 /tmp 里也能直接运行 hi 了。*

到这里，hi 已经和 `ls` 一样，成了一条在任何目录下都能使用的命令。

`a+x` 会给属主、属组和其他人三组都加上 x 权限，但是这并不意味着其他用户也能运行 hi。第十三章的 5.4 节讲过，Ubuntu 上家目录的权限是 `rwxr-x---`，其他用户连 /home/zby 都进不去，自然也就运行不了里面的文件，而且他们的 PATH 里也没有 /home/zby/bin。所以对于只给自己用的脚本，写 `chmod u+x` 就够了。

## 五、第一行的 #!

再回到 hi 的第一行。`#!` 这两个字符读作 shebang，它们必须是文件最开头的两个字符，前面不能有空行或者空格。Shell 运行一个程序的时候，最后要通过系统调用 execve 请求内核来运行这个文件，而内核如果发现文件是以 `#!` 开头的，就会把这一行剩下的部分当作解释器的路径。`man 2 execve` 的 Interpreter scripts 一节写的是，这时内核实际运行的是 `interpreter [optional-arg] pathname arg...`，也就是依次写上解释器的路径、第一行里可选的一个参数、脚本本身的路径，以及原来的那些参数。

所以输入 `hi` 以后，内核运行的其实是 `/bin/bash /home/zby/bin/hi`，这和代码 2 里手动写 `bash hi` 是一回事，只不过用哪个程序来运行，已经写在文件里了。bash 读到第一行时，因为它是以 `#` 开头的，所以只把它当成一行注释跳过去。如果把 hi 的 r 权限去掉再运行一次，就能看出确实是内核启动了 /bin/bash：

```bash
$ chmod u-r ~/bin/hi
$ hi
/bin/bash: /home/zby/bin/hi: Permission denied
$ chmod u+r ~/bin/hi
```

*代码 10：报错的开头是 /bin/bash，而不是代码 8 里的 bash。*

代码 8 的报错来自终端里的 bash，那时它还没能把 hi 交给内核。而这一次内核已经按照第一行启动了一个新的 /bin/bash，这个 bash 要读取脚本的内容，可是 hi 已经没有 r 权限了，于是报错的就变成了 /bin/bash。由此可见，脚本和编译好的程序不同，运行一个脚本既需要 x 权限，也需要 r 权限。

第一行写的是 /bin/bash，可是在这台机器上运行 `which bash`，得到的却是 /usr/bin/bash：

```bash
$ which -a bash
/usr/bin/bash
/bin/bash
$ ls -ld /bin
lrwxrwxrwx 1 root root 7 Mar  9  2026 /bin -> usr/bin
```

*代码 11：`which -a` 会列出 PATH 里所有同名的文件。*

第二章提到过，/bin 是一个指向 usr/bin 的符号链接，所以 /bin/bash 和 /usr/bin/bash 其实是同一个文件。`which` 之所以打印 /usr/bin/bash，只是因为 PATH 里的 /usr/bin 排在 /bin 的前面，图 1 右边的那一列画的就是这个过程。所以第一行写成 `#!/bin/bash` 或者 `#!/usr/bin/bash` 都是可以的，习惯上写的是 `#!/bin/bash`，因为在 /bin 合并进 /usr/bin 之前，Linux 系统上的 bash 一直放在 /bin 里。另外还常见一种写法 `#!/usr/bin/env bash`，它让 env 按照 PATH 去查找 bash，适合 bash 不一定装在 /bin 下的系统。

### 5.1 不写第一行会怎样

那么第一行可不可以不写呢？下面的 hi2 就没有 shebang，它的第二行用了第十章的花括号展开：

```bash
$ cat ~/bin/hi2
echo "Hello there, $USER!"
echo {1..3}
$ chmod u+x ~/bin/hi2
$ hi2
Hello there, zby!
1 2 3
$ env hi2
Hello there, zby!
{1..3}
$ python3 -c 'import subprocess; subprocess.run(["hi2"])' 2>&1 | tail -n 1
OSError: [Errno 8] Exec format error: 'hi2'
```

*代码 12：同一个文件分别从 bash、env 和 Python 里运行，结果各不相同。Python 的报错有好几行，这里用 `tail` 只留下了最后一行。*

因为 hi2 的开头没有 `#!`，它又不是编译好的程序，所以内核不认识它的格式，会返回 Exec format error 这个错误。接下来会怎样，就取决于是谁在运行它了。`man bash` 里写的是，bash 遇到这个错误时，会假定这个文件是一个 Shell 脚本，自己启动一个子 Shell 来执行它，所以在终端里直接输入 `hi2` 是能正常运行的。`env` 遇到这个错误时，会改用 /bin/sh 来运行这个文件，而 Ubuntu 上的 /bin/sh 指向的是 dash，dash 不支持花括号展开，于是 `{1..3}` 被原样打印了出来。Python 则直接把这个错误报告了出来，Errno 8 就是内核返回的那个错误。所以不写第一行的脚本，能不能运行、由哪个 Shell 来运行，都要看是谁启动了它。写上 `#!/bin/bash` 以后，不管从哪里运行，内核都会把它交给 bash，结果也就一致了。

## 六、位置参数 $1、$2

那么 `ls -l /tmp` 里的 `-l` 和 /tmp 是怎样交给 `ls` 的呢？对于 Shell 脚本来说，命令行上跟在脚本名字后面的词，会依次放进 `$1`、`$2`、`$3` 这些变量里，它们叫作位置参数（positional parameters）。下面的 args 脚本会把前两个参数打印出来：

```bash
$ cat ~/bin/args
#!/bin/bash
echo "The first value is $1"
echo "The second value is $2"
$ chmod u+x ~/bin/args
$ args hello world
The first value is hello
The second value is world
$ args -l /tmp
The first value is -l
The second value is /tmp
```

*代码 13：`-l` 和 /tmp 一样，只是一个普通的参数。*

从第二条命令可以看出，Shell 并不区分选项和其他参数，`-l` 和 /tmp 一样，都只是命令行上的一个词。一个词算不算选项，是由程序自己决定的，`ls` 看到以减号开头的参数，就把它当作选项来处理，而 args 没有做这样的处理，所以 `-l` 就只是第一个参数。下一节会讲怎样在脚本里处理选项。

参数是按照 Shell 切分好的词来编号的，所以第十章讲的引号和展开在这里同样起作用：

```bash
$ args "hello world" again
The first value is hello world
The second value is again
$ args one
The first value is one
The second value is
$ args a b c
The first value is a
The second value is b
$ args $USER $((3*4))
The first value is zby
The second value is 12
```

*代码 14：引号里的空格不会把参数拆开，展开发生在脚本运行之前。*

用双引号括起来的 hello world 是一个参数，所以它整个成了 `$1`。如果参数不够，那么缺少的那个位置参数就是空的，它和不存在的变量一样，会被替换成空字符串。如果参数多了，那么多出来的参数仍然会传进脚本，只是 args 没有用到 `$3`，所以 c 没有被打印出来。最后一条命令说明，`$USER` 和 `$((3*4))` 在脚本运行之前就已经被 Shell 展开了，脚本收到的只是 zby 和 12。

除了 `$1`、`$2`，还有两个常用的特殊参数，`$0` 是脚本自己的名字，`$#` 是参数的个数。在 args 里再加上两行：

```bash
$ cat ~/bin/args
#!/bin/bash
echo "The script is $0"
echo "Number of arguments: $#"
echo "The first value is $1"
echo "The second value is $2"
$ args a b c
The script is /home/zby/bin/args
Number of arguments: 3
The first value is a
The second value is b
```

*代码 15：`$#` 统计的参数不包括 `$0`。*

`$0` 打印出来的是完整的路径 /home/zby/bin/args，这正好对应上一节说的，内核运行的是 `/bin/bash /home/zby/bin/args a b c`，于是 bash 把脚本的路径作为 `$0`，把后面的词依次作为 `$1`、`$2` 和 `$3`。图 2 把从输入命令到脚本拿到参数的几个步骤画在了一起。

![分三步画出运行 args hello world 的过程。第一步是在终端里输入 args hello world，因为名字里没有斜杠，Shell 按 PATH 查找，找到 /home/zby/bin/args 后交给内核运行。第二步是内核读到文件开头的 #!/bin/bash，实际运行的是 /bin/bash /home/zby/bin/args hello world，下面用括号标出 /bin/bash 是解释器，/home/zby/bin/args 是 $0，hello 是 $1，world 是 $2，参数的个数 $# 是 2。第三步是 bash 执行脚本里的四条 echo，输出依次是 The script is /home/zby/bin/args、Number of arguments: 2、The first value is hello、The second value is world](/img/posts/linux-script/shebang-args.svg)

*图 2：Shell 负责找到脚本，内核负责换成 bash 来运行，bash 负责给参数编号。*

## 七、用 case 处理选项

真正的命令一般都支持 `-h` 或者 `--help`，用来打印用法说明。要在脚本里做到这一点，就要根据 `$1` 的值执行不同的命令，这可以用 `case` 语句来实现。下面把 hi 改写一下：

```bash
$ cat ~/bin/hi
#!/bin/bash
# This is my first script
case $1 in
    -h | --help)
        echo "Usage: hi [-h | --help]"
        echo "Say hello and show today's date."
        ;;
    "")
        echo "Hello there, $USER!"
        echo "Today is $(date)"
        ;;
    *)
        echo "hi: invalid option '$1'"
        echo "Try 'hi --help' for more information."
        ;;
esac
```

*代码 16：hi 根据第一个参数选择执行哪一组命令。*

`case` 会拿 `$1` 的值从上往下依次和每个分支的模式比较，遇到第一个匹配的分支，就执行这个分支里的命令，一直执行到 `;;` 为止，然后跳到 `esac` 的后面，其余的分支都不再比较。`esac` 就是把 case 倒过来写，表示整个 `case` 语句到这里结束。每个模式的后面都要写一个右括号，如果同一个分支要匹配几种写法，那么可以用 `|` 把它们隔开，比如 `-h | --help`。

后两个模式也值得说一下。`""` 是空字符串，没有任何参数的时候 `$1` 是空的，所以会走这个分支，打印原来的问候。`*` 的意思和第十章的通配符一样，可以匹配任意的字符串，因为它放在最后，所以只有前面的模式都不匹配时才会轮到它，于是它就成了处理其他情况的默认分支。如果把 `*)` 放在第一个，那么不管参数是什么，都会先被它匹配上，后面的分支就永远执行不到了。

```bash
$ hi
Hello there, zby!
Today is Sun Oct 25 18:04:47 CST 2026
$ hi -h
Usage: hi [-h | --help]
Say hello and show today's date.
$ hi --help
Usage: hi [-h | --help]
Say hello and show today's date.
$ hi -x
hi: invalid option '-x'
Try 'hi --help' for more information.
$ ls -z
ls: invalid option -- 'z'
Try 'ls --help' for more information.
```

*代码 17：最后一条是 `ls` 遇到不认识的选项时的报错，hi 的报错模仿的就是它的格式。*

`case` 后面的 `$1` 不加双引号也没有问题，因为 bash 不会再拆分这里的展开结果。比如运行 `hi "a b"` 时，`$1` 仍然是完整的 a b，它会走 `*` 那个分支，打印出 hi: invalid option 'a b'。

另外，`;;` 和 `esac` 都不能漏写。如果漏写了第一个分支末尾的 `;;`，或者漏写了最后的 `esac`，那么 bash 读到这个 `case` 语句时就会报错，里面的命令一条都不会执行：

```bash
$ hi -h
/home/zby/bin/hi: line 7: syntax error near unexpected token `)'
/home/zby/bin/hi: line 7: `    "")'
$ hi -h
/home/zby/bin/hi: line 16: syntax error: unexpected end of file
```

*代码 18：第一次漏写的是第一个分支末尾的 `;;`，第二次漏写的是最后的 `esac`。*

漏写 `;;` 的时候，bash 以为 `""` 仍然是上一个分支里的一条命令，读到后面的右括号才发现不对，所以报错的位置是下一个模式所在的第 7 行。漏写 `esac` 的时候，bash 一直读到文件的末尾也没有等到 `case` 结束，所以报的是 unexpected end of file。

## 小结

| 写法 | 作用和要点 |
| --- | --- |
| `#!/bin/bash` | 第一行，指定解释器 |
| `#` | 注释 |
| `$PATH` | 找命令的目录，从左往右 |
| `type` | 起名前查有没有被占用 |
| `~/bin` | ~/.profile 把它加进 PATH |
| `source` | 在当前 Shell 里生效 |
| `chmod u+x` | 加上 x，脚本还要有 r |
| `$1`、`$2` | 第一、二个参数 |
| `$0`、`$#` | 脚本路径、参数个数 |
| `case` | 按模式选分支 |
| `;;`、`esac` | 结束分支、结束 case |

Shell 脚本是一个写着 Shell 命令的文本文件，用 `bash 文件名` 运行时只需要 r 权限。如果想像 `ls` 一样只输入名字就能运行它，那么首先要让 bash 找得到它，因为 bash 只会按照 PATH 的顺序到那几个目录里查找，并不会查当前目录。Ubuntu 默认的 ~/.profile 会在 ~/bin 存在时把它加到 PATH 的最前面，所以把脚本放进 ~/bin，再 `source ~/.profile` 或者重新打开终端就可以了。其次脚本要有 x 权限，而且因为 bash 要读取它的内容，所以还要有 r 权限。第一行的 `#!/bin/bash` 告诉内核要用 bash 来运行这个文件，不写这一行的话，结果就要看是谁启动了它。命令行上跟在脚本名字后面的词，会依次放进 `$1`、`$2` 这些位置参数，`$0` 是脚本的路径，`$#` 是参数的个数。选项对 Shell 来说只是普通的参数，脚本可以用 `case` 按照 `$1` 的值选择执行哪一组命令，每个分支以 `;;` 结束，整个语句以 `esac` 结束。
