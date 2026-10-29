---
title: Go 第一章：从 Hello World 认识 package、import 和 main 函数
date: 2026-10-29 15:06:00
description: "Stephen Grider《Go: The Complete Developer's Guide》第一部分的复盘。新建项目先运行 go mod init，生成的 go.mod 把目录标记成一个模块，没有它 go build 就会报错。go run 编译完立刻运行，go build 只编译，go fmt 统一排版，go install 把程序装进 ~/go/bin，go get 给模块添加依赖，go test 运行测试。同一个目录里写着同一个 package 声明的 .go 文件合起来是一个包，名叫 main 的包是可执行包，go build 会把它编译成程序，其他名字的包是可复用包，go build 只检查它能不能通过编译，要用它就得在别的包里 import。可执行包里必须有一个没有参数、也没有返回值的 main 函数，程序从这里开始运行。import 让当前文件能用另一个包里首字母大写的名字，导入了却不用会导致编译失败。"
categories:
  - [课外, AI Infra, Go]
tags:
  - Go 模块
  - go 命令
  - 包
  - main 函数
series: Go
privacy: protected
sitemap: false
private_section: 课外
---

这门课用的是 Stephen Grider 在 Udemy 上的《Go: The Complete Developer's Guide (Golang)》。第一部分从一个 Hello World 程序开始，围绕它回答几个问题，比如项目目录要怎样初始化，go 命令有哪些常用的子命令，第一行的 `package main` 是什么意思，`import "fmt"` 做了什么，以及 `func main` 为什么必须叫 main。这一章按照这个顺序，先建项目，再认识 go 命令，最后把这个程序从上到下逐行拆开。

这一章用的是 Go 1.27.3，系统是 WSL 里的 Ubuntu 22.04。

<!-- more -->

## 一、用 go mod init 初始化项目

写代码之前，先建一个文件夹来存放这门课的代码，进入这个文件夹以后运行 `go mod init`。后面跟的 gostudy 是给这个项目起的名字，叫作**模块路径**（module path）：

```bash
$ mkdir code && cd code
$ go mod init gostudy
go: creating new go.mod: module gostudy
go: to add module requirements and sums:
	go mod tidy
$ cat go.mod
module gostudy

go 1.27.3
```

*代码 1：go.mod 里只有两行。*

这条命令生成了一个 go.mod 文件，它把当前目录标记成一个**模块**（module）的根目录。第一行是模块路径，以后这个模块里的包互相导入时，导入路径都要以 gostudy 开头，第五节会用到它。第二行是这个模块要求的 Go 版本，这里写的就是当前安装的 1.27.3。输出里提到的 `go mod tidy` 是用来整理依赖的，因为现在的项目还没有任何依赖，所以暂时不需要运行它。

那么为什么一定要有 go.mod 呢？如果在一个没有 go.mod 的目录里直接运行 `go build`，那么会得到下面这个错误：

```bash
$ go build
go: go.mod file not found in current directory or any parent directory; see 'go help modules'
```

*代码 2：go 命令会从当前目录开始逐级往上找 go.mod。*

不过像 `go run test.go`、`go build test.go` 这样直接写出文件名的用法，即使没有 go.mod 也能运行。这是因为 go 命令会把列出来的这几个文件临时当作一个包来编译，这个临时的包叫作 command-line-arguments，后面的编译错误第一行打印的就是这个名字。但是等到项目里有了好几个包，或者要用别人写的包，就离不开 go.mod 了，所以新建一个 Go 项目，第一步就是运行 `go mod init`。

## 二、第一个程序

在 code 目录里新建 test.go，内容如下：

```go
package main

import "fmt"

func main() {
	fmt.Println("Hello Go!")
}
```

*代码 3：test.go。*

这个文件可以分成三部分。第一行声明这个文件属于哪个包，第三行导入要用到的包，最后是 main 函数，它的函数体里只有一行，作用是打印 Hello Go! 并换行。下一节先看怎样运行它，后面几节再逐行解释它的含义。

## 三、go 命令的常用子命令

`go` 后面跟的第一个词叫作子命令，比如 `go mod init` 里的 `mod`。除了 mod 以外，课程里还介绍了六个最常用的子命令，下面逐个来看。

### 3.1 go run 和 go build

`go run` 先编译，然后立刻运行编译出来的程序：

```bash
$ go run test.go
Hello Go!
$ ls
go.mod  test.go
```

*代码 4：运行完以后，当前目录里并没有多出可执行文件。*

`go build` 只编译、不运行，它会在当前目录生成一个可执行文件。如果命令里写的是文件名，那么可执行文件以第一个源文件的名字命名，所以 test.go 编译出来的文件叫 test：

```bash
$ go build test.go
$ ls
go.mod  test  test.go
$ ./test
Hello Go!
```

*代码 5：用 `./test` 运行编译好的程序。*

这个 test 有 2.3 MB 左右，比源文件大得多，因为 Go 默认把程序用到的标准库和运行时都静态链接进了这一个文件。所以把它复制到另一台 Linux x86-64 的机器上，即使那台机器没有装 Go，也可以直接运行。

如果 `go build` 后面什么都不写，那么它编译的是当前目录里的整个包，生成的可执行文件以模块路径的最后一段命名，在这里就是 gostudy。`go run` 也可以这样用，写成 `go run .`，其中的 `.` 表示当前目录。写文件名和写 `.` 的区别在于，前者只编译列出来的那几个文件，后者编译整个目录，第四节会看到这个区别带来的影响。

### 3.2 go fmt

`go fmt` 按照 Go 统一的代码风格重新排版代码。比如把 test.go 故意写乱：

```go
package main
import "fmt"
func main() {
fmt.Println( "Hello Go!" )
    }
```

*代码 6：没有空行，缩进也不对。*

然后运行 `go fmt`：

```bash
$ go fmt
test.go
$ cat test.go
package main

import "fmt"

func main() {
	fmt.Println("Hello Go!")
}
$ go fmt
```

*代码 7：第二次运行时，文件已经符合格式，所以什么都没有输出。*

`go fmt` 会打印被它改过的文件名，如果文件本来就符合格式，那么它什么都不输出。这一次它在 package、import 和函数之间各加了一个空行，函数体改成用 Tab 缩进，还去掉了括号里多余的空格。因为所有 Go 代码都按照同一套规则排版，所以读别人的 Go 代码时，不需要去适应各种不同的缩进和空格习惯。

### 3.3 go install

`go install` 和 `go build` 一样会编译程序，但是它不把可执行文件放在当前目录，而是放进 GOBIN 指定的目录。如果没有设置 GOBIN，那么这个目录就是 GOPATH 下面的 bin，默认是 ~/go/bin：

```bash
$ go env GOBIN
/home/zby/go/bin
$ go install
$ which gostudy
/home/zby/go/bin/gostudy
$ gostudy
Hello Go!
```

*代码 8：安装好的程序以模块路径的最后一段命名。*

~/go/bin 加进 PATH 以后，在任何目录下输入 `gostudy` 都能运行它，这和 [Linux 第十六章](/2026/10/25/Linux-Command-Line-Chapter16/)把脚本放进 ~/bin 是同一个道理。

### 3.4 go get

`go get` 用来给当前模块添加依赖，也就是下载别人写好的模块，并把它记进 go.mod。比如添加 Go 官方教程里用过的 rsc.io/quote：

```bash
$ go get rsc.io/quote
go: downloading rsc.io/quote v1.5.2
go: downloading rsc.io/sampler v1.3.0
go: downloading golang.org/x/text v0.0.0-20170915032832-14c0d48ead0c
go: added golang.org/x/text v0.0.0-20170915032832-14c0d48ead0c
go: added rsc.io/quote v1.5.2
go: added rsc.io/sampler v1.3.0
$ cat go.mod
module gostudy

go 1.27.3

require (
	golang.org/x/text v0.0.0-20170915032832-14c0d48ead0c // indirect
	rsc.io/quote v1.5.2 // indirect
	rsc.io/sampler v1.3.0 // indirect
)
```

*代码 9：rsc.io/quote 依赖 rsc.io/sampler，后者又依赖 golang.org/x/text，所以一共下载了三个模块。*

运行以后，go.mod 里多了一段 require，记录了依赖的模块和它们的版本，目录里还多了一个 go.sum 文件，里面是每个依赖的校验和，用来确认以后下载到的内容和这一次完全一样。因为 test.go 还没有导入这个包，所以每一行后面都标着 `// indirect`，表示它们暂时不是被直接使用的依赖。另外，`go get` 只能在模块里面运行，如果在没有 go.mod 的目录里运行，那么它会报错，并提示安装程序要改用 `go install`。

### 3.5 go test

`go test` 用来运行测试。Go 的测试代码写在以 `_test.go` 结尾的文件里，而现在的项目里还没有这样的文件，所以它只打印一行：

```bash
$ go test
?   	gostudy	[no test files]
```

*代码 10：问号表示这个包没有测试可以运行。*

| 子命令 | 作用 |
| --- | --- |
| `go mod init 路径` | 新建 go.mod，把当前目录变成模块 |
| `go run 文件` 或 `go run .` | 编译并立刻运行 |
| `go build` | 编译，在当前目录生成可执行文件 |
| `go fmt` | 按统一风格重新排版 |
| `go install` | 编译，把可执行文件放进 ~/go/bin |
| `go get 模块` | 下载依赖，记进 go.mod |
| `go test` | 运行 `_test.go` 里的测试 |

*表 1：这一章用到的 go 子命令。*

## 四、package：代码包

现在回到 test.go 的第一行 `package main`。**包**（package）是 Go 组织代码的基本单位，同一个目录下的 .go 文件，开头都要写同一个 package 声明，它们合在一起就是一个包。因为同一个包里的代码是一个整体，所以一个文件可以直接调用同一个包里另一个文件定义的函数，不需要任何导入。

比如在 test.go 旁边再写一个 greeting.go，让 main 函数打印 greeting 函数的返回值：

```go
// greeting.go
package main

func greeting() string {
	return "Hello Go!"
}
```

```go
// test.go
package main

import "fmt"

func main() {
	fmt.Println(greeting())
}
```

*代码 11：两个文件都写着 package main，所以它们属于同一个包。*

这时如果还用 `go run test.go` 运行，就会出错，而 `go run .` 可以正常运行：

```bash
$ go run test.go
# command-line-arguments
./test.go:6:14: undefined: greeting
$ go run .
Hello Go!
```

*代码 12：第一条命令只编译了 test.go，所以找不到 greeting。*

原因就是第三节提到的那个区别，`go run test.go` 只编译列出来的 test.go，greeting.go 根本没有参与编译，而 `go run .` 编译的是整个目录，两个文件都在里面。所以一个包里有了多个文件以后，用 `go run .` 会更省事。反过来，一个目录里也只能有一个包，如果同一个目录里混进了一个写着 `package calculator` 的 calc.go，那么 `go build` 会报 `found packages calculator (calc.go) and main (greeting.go)` 这样的错误。

## 五、可执行包和可复用包

包按照用途可以分成两种。一种是**可执行包**（executable package），编译以后得到一个可以直接运行的程序；另一种是**可复用包**（reusable package），里面放的是可以给别的程序调用的函数，相当于其他语言里的库。Go 是通过包的名字来区分这两种包的，只有名字叫 main 的包才是可执行包，其他名字的包，比如 `package calculator` 或者 `package uploader`，都是可复用包。

`go build` 对这两种包的处理也不一样。对于 main 包，它会生成可执行文件；对于可复用包，它只检查这个包能不能通过编译，并不会生成任何文件。比如在 code 下面建一个 calculator 目录，里面放一个提供加法的包：

```go
// calculator/calculator.go
package calculator

func Add(a, b int) int {
	return a + b
}
```

```bash
$ go build ./calculator
$ ls calculator
calculator.go
$ go run ./calculator
package gostudy/calculator is not a main package
```

*代码 13：编译通过了，但是没有生成文件，也不能直接运行。*

可复用包要被别的包导入以后才能发挥作用。在 test.go 里导入它，导入路径是模块路径 gostudy 加上目录名 calculator：

```go
package main

import (
	"fmt"

	"gostudy/calculator"
)

func main() {
	fmt.Println(greeting())
	fmt.Println(calculator.Add(1, 2))
}
```

```bash
$ go run .
Hello Go!
3
```

*代码 14：导入多个包时用括号括起来，每行写一个。*

这里就用到了第一节 go.mod 里的模块路径。因为模块路径是 gostudy，所以模块里 calculator 目录下的包，导入路径就是 gostudy/calculator。标准库的包不在这个模块里，所以直接写 "fmt" 就可以了。

![可执行包和可复用包](/img/posts/go-hello-world/two-kinds-of-packages.svg)

*图 1：左边的 main 包编译成可执行文件，右边的 calculator 包被它导入，代码最后也编译进了同一个文件。*

## 六、func main：程序从这里开始

既然 main 包要编译成可以运行的程序，那么程序就需要一个开始执行的地方，这个地方就是 main 函数。所以 main 包里必须有一个名叫 main 的函数，程序运行时，Go 先初始化 main 包，然后调用 main 函数，等 main 函数返回，程序也就结束了。

如果 main 包里没有 main 函数，那么程序无法通过编译。Go 区分大小写，Main 和 main 是两个不同的名字，所以把函数改名为 Main 也会得到同样的错误：

```go
package main

import "fmt"

func Main() {
	fmt.Println("Hello Go!")
}
```

```bash
$ go build test.go
# command-line-arguments
runtime.main_main·f: function main is undeclared in the main package
```

*代码 15：错误信息的意思是 main 包里没有声明 main 函数。*

main 函数的写法也是固定的，它不能有参数，也不能有返回值，比如写成 `func main(name string)`，就会得到下面这个错误，写成 `func main() int` 也是一样：

```bash
$ go build test.go
# command-line-arguments
./test.go:5:6: func main must have no arguments and no return values
```

*代码 16：第 5 行第 6 列正好是 main 这个名字。*

这一点和 C/C++ 不一样。C/C++ 的 main 可以通过 argc、argv 接收命令行参数，也可以用 `return 0` 返回退出状态码，而 Go 程序要读取命令行参数，得用 os 包里的 `os.Args`，要设置退出状态码，就得调用 `os.Exit`。

## 七、import "fmt"

fmt 是 Go 标准库里的一个包，它提供格式化输入和输出的函数，作用和 C 语言的 printf、scanf 差不多，`Println` 就是其中之一。`import "fmt"` 的作用是让当前这个文件能够使用 fmt 包里的代码，导入以后，用「包名.名字」的形式来调用，比如 `fmt.Println`。如果不导入 fmt 就直接调用 `fmt.Println`，那么编译器会报 `undefined: fmt`。

import 只对写着它的那个文件有效。比如第四节的 greeting.go 如果也想打印东西，那么它要在自己的开头再写一次 `import "fmt"`，即使它和 test.go 属于同一个包也一样。

导入一个包以后，并不是包里所有的名字都能用，只有首字母大写的名字才能被别的包使用，这样的名字叫作**导出**（exported）的名字。所以 fmt 里的函数叫 Println，calculator 里的 Add 也要大写。如果写成小写的 `fmt.println`，那么编译器会找不到它，还会提示大写的那个名字：

```bash
$ go build test.go
# command-line-arguments
./test.go:6:6: undefined: fmt.println (but have Println)
```

*代码 17：小写开头的名字只能在它自己的包里使用。*

另外，导入了却没有用到的包，在 Go 里是一个编译错误。比如把 main 函数里的 `fmt.Println` 删掉，而 import 那一行还留着：

```bash
$ go build test.go
# command-line-arguments
./test.go:3:8: "fmt" imported and not used
```

*代码 18：第 3 行就是 `import "fmt"`。*

所以删掉一段代码以后，如果它用到的包已经没有别的地方在用了，那么要记得把对应的 import 也一起删掉。

## 八、func 的写法

最后看函数本身：

```go
func main() {

}
```

`func` 是关键字，告诉 Go 这里要声明一个函数；`main` 是函数的名字；小括号里写参数列表，因为 main 不能有参数，所以这里是空的；大括号里是函数体，也就是调用这个函数时要执行的代码。如果函数有参数和返回值，那么写法就像第五节的 `func Add(a, b int) int`，参数名写在类型前面，返回值的类型写在小括号后面。

这里有一个从 C/C++ 过来很容易踩到的地方，左大括号必须和 func 写在同一行。如果把它挪到下一行：

```go
func main()
{
	fmt.Println("Hello Go!")
}
```

```bash
$ go build test.go
# command-line-arguments
./test.go:6:1: syntax error: unexpected semicolon or newline before {
```

*代码 19：错误指向第 6 行单独的那个左大括号。*

之所以会这样，是因为 Go 的编译器会在行尾自动补上分号，`func main()` 这一行结束时就被补了一个分号，于是下一行单独的 `{` 就成了语法错误。这也是 Go 代码里看不到行尾分号的原因。这种错误连 `go fmt` 也修不了，因为 `go fmt` 要先把代码解析成功才能重新排版，遇到这个文件，它同样只会报出这个语法错误。

## 九、四个问题

这一部分的最后有四道小题，答案都在前面几节里：

1. Go 里的包有什么用？包把同一个目录下、用途相关的源文件组织成一个整体，同一个包里的文件可以直接使用彼此的代码，而别的包要通过 import 才能使用它。
2. 想让 Go 把一个包编译成可执行文件，这个包要叫什么名字？要叫 main，其他名字的包都是可复用包，`go build` 不会为它们生成文件。
3. 名叫 main 的包有什么必须满足的要求？包里必须定义一个名叫 main 的函数，它没有参数，也没有返回值，程序就从这个函数开始运行。
4. 为什么要写 import？因为一个文件默认只能使用自己这个包里的代码，要用另一个包（比如 fmt）里的函数，就要先用 import 导入它，然后通过「包名.名字」来调用。

## 小结

| 写法 | 作用和要点 |
| --- | --- |
| `go.mod` | 由 `go mod init` 生成，记录模块路径、Go 版本和依赖 |
| `package main` | 可执行包，编译成程序 |
| `package 其他名字` | 可复用包，要被导入才能用 |
| `import "fmt"` | 让当前文件能用 fmt 包，自己模块里的包写成「模块路径/目录名」 |
| `fmt.Println` | 首字母大写，所以是导出的名字 |
| `func main() {` | 没有参数和返回值，`{` 不能换行 |

*表 2：导入了却不用的包会导致编译失败。*

新建 Go 项目先运行 `go mod init`，生成的 go.mod 把目录变成一个模块，并记下模块路径，没有它 `go build` 就会报错。`go run` 编译完立刻运行，`go build` 只编译，`go fmt` 统一排版，`go install` 把程序装进 ~/go/bin，`go get` 给模块添加依赖，`go test` 运行测试。同一个目录里写着同一个 package 声明的文件合起来是一个包，名叫 main 的是可执行包，其他名字的是可复用包，`go build` 只检查后者能不能通过编译，要用它就得在别的包里 import。因为 `go run test.go` 只编译列出来的文件，所以包里有多个文件时要用 `go run .`。main 包里必须有一个没有参数、也没有返回值的 main 函数，程序从这里开始运行。import 让当前文件能使用另一个包里首字母大写的名字，导入了却不用会导致编译失败。另外，函数的左大括号要和 func 写在同一行，因为编译器会在行尾自动补分号。
