---
title: Git 第七章：remote 记下地址，push 推的是本地分支
date: 2026-10-06 16:37:00
description: Colt Steele《The Git & Github Bootcamp》GitHub 基础那一章的复盘。clone 复制的是整个仓库，它顺手记下了远程地址，建好了 origin/* 远程跟踪分支，还给默认分支设置了上游；从 git init 开始的仓库，这三件事都要手动完成。git remote add 只是在配置文件里写下一个名字和一个地址，并不联网。git push origin main 里的 origin 是目的地，main 是本地的分支，冒号写法可以让两边的名字不同。-u 记下本地分支和哪一条远程分支配对，git status 正是靠它才能说出领先或落后了几个提交。
categories:
  - [课外, AI Infra, Git]
tags:
  - GitHub
  - remote
  - push
  - SSH
  - 上游
cover: /img/covers/Git-Chapter7-GitHub.svg
series: Git
privacy: protected
sitemap: false
private_section: 课外
---

前六章的所有操作，都发生在一台电脑上的一个仓库里。Git 本身并不需要服务器，每一个仓库都保存着完整的历史，所以一个人在本地也能用得很好。但是如果想换一台电脑接着写，或者想和别人一起修改同一个项目，就需要一个大家都能访问到的仓库。**GitHub** 就是专门存放 Git 仓库的网站，放在它上面的仓库和本地的仓库是同一种东西，只是存放在 GitHub 的服务器上。

这一章讲两个方向。一个方向是把 GitHub 上已有的仓库复制到本地，用的是 `git clone`；另一个方向是把本地已有的仓库推送到 GitHub 上，用的是 `git remote` 和 `git push`。这几条命令敲起来都很简单，但是如果不清楚本地仓库是怎样记住「远程」的，就很容易把 `git push origin main` 里两个参数的意思弄反，也很难说清楚 `-u` 到底做了什么。

<!-- more -->

## 一、`git clone`：连同全部历史一起复制下来

在 GitHub 上打开一个仓库，点击绿色的 Code 按钮，就能复制到这个仓库的地址。把地址交给 `git clone`：

```bash
git clone https://github.com/octocat/Hello-World.git
# Cloning into 'Hello-World'...
# remote: Enumerating objects: 13, done.
# remote: Total 13 (delta 0), reused 0 (delta 0), pack-reused 13 (from 1)
# Receiving objects: 100% (13/13), done.
```

*代码 1：octocat 是 GitHub 自己的示例账号。以 `remote:` 开头的行是 GitHub 那一端打印出来的。*

`git clone` 会在当前目录下新建一个和仓库同名的目录 `Hello-World`。如果想换一个名字，可以在地址后面再写一个目录名，比如 `git clone <地址> hello`。

需要注意的是，clone 复制的不只是最新的那一版文件，而是整个仓库，其中包括全部的提交历史：

```bash
cd Hello-World
git log --oneline
# 7fd1a60 (HEAD -> master, origin/master, origin/HEAD) Merge pull request #6 from Spaceghost/patch-1
# 7629413 New line at end of file. --Signed off by Spaceghost
# 553c207 first commit
```

*代码 2：这些提交在克隆之前就保存在 GitHub 上，现在本地也有了一份。*

除了提交之外，clone 还在本地仓库里记下了这个仓库是从哪里来的：

```bash
git remote -v
# origin	https://github.com/octocat/Hello-World.git (fetch)
# origin	https://github.com/octocat/Hello-World.git (push)

git branch -a
# * master
#   remotes/origin/HEAD -> origin/master
#   remotes/origin/master
#   remotes/origin/octocat-patch-1
#   remotes/origin/test

git status
# On branch master
# Your branch is up to date with 'origin/master'.
#
# nothing to commit, working tree clean
```

*代码 3：clone 把远程仓库的地址记了下来，并且给它取名为 origin。*

这三条命令的输出，对应着 clone 顺手完成的三件事。第一件是把仓库的地址记下来，并且给这个地址起名叫 `origin`。第二件是让远程仓库里的每一条分支，都在本地留下一个以 `origin/` 开头的记录，这种记录叫作**远程跟踪分支**（remote-tracking branch），它记的是远程的那条分支在上一次通信时所处的位置。第三件是按照远程仓库的默认分支，在本地新建一条同名的 `master`，并且让它和 `origin/master` 配成一对，所以 `git status` 才会说本地的 master 和 `origin/master` 一致。手册里对 clone 的描述，说的也是这三件事：

> Clones a repository into a newly created directory, creates remote-tracking branches for each branch in the cloned repository (visible using git branch --remotes), and creates and checks out an initial branch that is forked from the cloned repository's currently active branch.

从 `git init` 开始的仓库，这三件事一件都没有做过。这一章后面的大部分内容，其实就是在本地仓库上把它们一件一件地手动做一遍。

`git branch -a` 里列出了四条远程分支，但是本地只有一条 `master`。如果想在另外一条分支上工作，直接切换过去就可以了：

```bash
git switch test
# Branch 'test' set up to track remote branch 'test' from 'origin'.
# Switched to a new branch 'test'
```

*代码 4：本地并没有 test 这条分支，于是 switch 按照 origin/test 新建了一条同名的分支，并且同样让它和 origin/test 配成一对。*

## 二、SSH 密钥：让 GitHub 认出是谁在推送

克隆一个公开的仓库，GitHub 并不需要知道操作的人是谁。但是往仓库里推送就不一样了，GitHub 必须先确认这个人对仓库有写权限。GitHub 已经不再接受用账号密码来完成 Git 操作，它的文档里写的是 `Password-based authentication for Git has been removed in favor of more secure authentication methods`。剩下的办法有两种。如果使用 `https://` 开头的地址，那么在 Git 询问密码时，要输入的是个人访问令牌（personal access token），而不是登录密码；如果使用 SSH 地址，就需要先在本机生成一对密钥，再把其中的公钥交给 GitHub。

同一个仓库的两种地址分别是这样的：

- HTTPS 地址：`https://github.com/<用户名>/<仓库名>.git`
- SSH 地址：`git@github.com:<用户名>/<仓库名>.git`

Code 按钮下面可以在 HTTPS 和 SSH 之间切换，复制到的就是这两种地址。SSH 的好处在于配置一次之后，每次推送都不需要再输入任何东西。配置一共分三步。

第一步是生成密钥：

```bash
ssh-keygen -t ed25519 -C "you@example.com"
# Generating public/private ed25519 key pair.
# Enter file in which to save the key (/home/zby/.ssh/id_ed25519):
```

*代码 5：`-t ed25519` 指定密钥使用的算法，`-C` 后面是一段备注，通常写自己的邮箱。*

接下来 ssh-keygen 会连续问三个问题。第一个问题是密钥保存在哪里，直接回车就会使用括号里的默认位置。如果这个位置已经有一把同名的密钥，它会多问一句 `Overwrite (y/n)?`，这时应该回答 n，直接使用已有的那一把。因为覆盖之后旧的私钥就没有了，所有登记过旧公钥的地方都会连不上。后两个问题是要不要给密钥设置一个口令（passphrase），以及再输入一遍确认。如果设置了口令，那么每次使用这把密钥都要输入它；如果不需要，直接回车留空就可以了。

完成之后，`~/.ssh/` 目录下会多出两个文件。`id_ed25519` 是**私钥**，它要一直留在这台电脑上，不能交给任何人；`id_ed25519.pub` 是**公钥**，也就是下一步要交给 GitHub 的那一份。

第二步是把公钥交给 GitHub：

```bash
cat ~/.ssh/id_ed25519.pub
# ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM3T+CRvQOTulXEB3q8yJpI0DopaJND+o5EazSCrZkp7 you@example.com
```

*代码 6：公钥只有一行，最后是第一步写下的备注。*

把这一整行复制下来，在 GitHub 网页右上角的头像菜单里依次打开 Settings 和 SSH and GPG keys，点击 New SSH key，粘贴进去保存即可。

第三步是测试能不能连上。`-T` 表示不需要分配终端，因为这里只是想确认身份：

```bash
ssh -T git@github.com
# The authenticity of host 'github.com (20.205.243.166)' can't be established.
# ED25519 key fingerprint is SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.
# This key is not known by any other names
# Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

*代码 7：第一次连接一台主机时，SSH 会先确认对方的身份。括号里的 IP 地址因地区而异。*

这是 SSH 在询问要不要相信这台从来没有连接过的主机，`SHA256:` 后面的那一串就是这台主机出示的指纹。GitHub 在文档里公布了自己的指纹，核对一致之后输入 yes，SSH 会把它记进 `~/.ssh/known_hosts`，以后就不会再问了。接下来的输出，取决于公钥有没有加好：

```text
# 公钥已经加到 GitHub 上
Hi USERNAME! You've successfully authenticated, but GitHub does not provide shell access.

# 公钥没有加，或者加错了
git@github.com: Permission denied (publickey).
```

*代码 8：成功时 USERNAME 处显示的是自己的 GitHub 用户名。GitHub 不提供 shell，所以即使认证成功，连接也会马上断开。*

看到 `Hi` 那一行，就说明 SSH 已经配好了。之后在 GitHub 上复制 SSH 地址来克隆或者推送，都会自动使用这把密钥。

## 三、本地这一边：先把 master 改成 main

现在换一个方向，从一个只存在于本地的仓库开始。`git init` 在新建仓库时，会打印一大段提示：

```bash
git init notes
# hint: Using 'master' as the name for the initial branch. This default branch name
# hint: is subject to change. To configure the initial branch name to use in all
# hint: of your new repositories, which will suppress this warning, call:
# hint:
# hint: 	git config --global init.defaultBranch <name>
# hint:
# hint: Names commonly chosen instead of 'master' are 'main', 'trunk' and
# hint: 'development'. The just-created branch can be renamed via this command:
# hint:
# hint: 	git branch -m <name>
# Initialized empty Git repository in ……/notes/.git/
```

*代码 9：在 git 2.34 上，新建的第一条分支仍然叫 master，同时提示这个默认名字以后可能会变。*

而在 GitHub 上新建的仓库，默认分支叫作 `main`。如果本地叫 master、远程叫 main，那么以后每一次推送都要想一想两边的名字，所以通常在第一次推送之前，先把本地的分支改名：

```bash
cd notes
git branch -m main

git status
# On branch main
#
# No commits yet
#
# nothing to commit (create/copy files and use "git add" to track)
```

*代码 10：`-m` 是 `--move` 的简写，`git branch -h` 对它的说明是 move/rename a branch。这时一个提交都还没有，分支照样可以改名。*

如果不想每个仓库都改一次，可以执行一次提示里给出的 `git config --global init.defaultBranch main`。这样以后新建的仓库，第一条分支就直接叫 main，那段提示也不会再出现了。

然后在 main 上提交两次：

```bash
git log --oneline
# 60c3f26 (HEAD -> main) 补上第七章
# 10f4cfd 第一篇笔记
```

*代码 11：本地仓库现在有两个提交，README.md 被修改了两次。*

## 四、`git remote add`：记下一个名字和一个地址

接下来要在 GitHub 上新建一个仓库。登录之后点击右上角的加号，选择 New repository，填好仓库名就可以创建了。这里有一个地方需要注意，因为本地已经有了提交，所以不要勾选添加 README、.gitignore 和 license 的选项。GitHub 的文档里专门写了这一条：

> Do not initialize the new repository with README, license, or gitignore files. You can add these files after your project has been pushed to GitHub.

至于为什么不能勾选，下一节的末尾会看到。

为了让每一步的输出都能在本机上复现，下面用一个本地的**裸仓库**（bare repository）来代替 GitHub 上的那个空仓库。裸仓库就是没有工作区、只有 `.git` 里那些内容的仓库，服务器上存放的仓库通常都是这种形式，因为没有人会直接在服务器上修改文件。远程仓库的地址既可以是网址，也可以是本机上的一个路径，所以把下面的路径换成 GitHub 的地址之后，命令的写法完全相同，输出也基本一样，只是 GitHub 有时会多打印几行以 `remote:` 开头的提示。

```bash
cd ..
git init --bare -b main github/notes.git
# Initialized empty Git repository in ……/github/notes.git/
cd notes
```

*代码 12：`--bare` 表示建一个裸仓库，`-b main` 让它的默认分支和 GitHub 一样叫 main。*

现在的 notes 还不知道有这样一个远程仓库：

```bash
git remote
git remote -v
```

*代码 13：两条命令都没有任何输出。和第一节克隆下来的仓库不同，从 `git init` 开始的仓库没有记录任何远程仓库。*

用 `git remote add <名字> <地址>` 记下一个：

```bash
git remote add origin ../github/notes.git

git remote -v
# origin	../github/notes.git (fetch)
# origin	../github/notes.git (push)
```

*代码 14：`origin` 是这个远程仓库的名字，`../github/notes.git` 是它的地址。*

两行分别是拉取（fetch）和推送（push）时使用的地址，通常是同一个。`origin` 这个名字并没有什么特殊之处，只是因为 clone 默认使用这个名字，大家也就都这么叫了。换成别的名字也完全可以，一个仓库还可以同时记下好几个远程仓库。

这条命令到底做了什么呢？看一看 `.git/config`：

```bash
cat .git/config
# [core]
# 	repositoryformatversion = 0
# 	filemode = true
# 	bare = false
# 	logallrefupdates = true
# [remote "origin"]
# 	url = ../github/notes.git
# 	fetch = +refs/heads/*:refs/remotes/origin/*
```

*代码 15：多出来的是 `[remote "origin"]` 这一段。*

`git remote add` 做的事情只有这些，也就是在配置文件里写下一个名字和一个地址。`url` 是地址，而 `fetch` 那一行规定了远程仓库里的分支（`refs/heads/*`）在本地要记作什么（`refs/remotes/origin/*`），第一节看到的 `origin/master` 就是按照这条规则得来的。

因为它只是写配置，并不会去连接远程仓库，所以即使地址写错了，`git remote add` 也会默默地成功。要等到真正推送的时候，错误才会暴露出来：

```bash
git remote add typo ../githb/notes.git
git push typo main
# fatal: '../githb/notes.git' does not appear to be a git repository
# fatal: Could not read from remote repository.
#
# Please make sure you have the correct access rights
# and the repository exists.
```

*代码 16：地址里把 github 写成了 githb。add 的时候没有任何提示，到了 push 才报错，退出码是 128。*

如果地址写错了，或者想把 HTTPS 地址换成 SSH 地址，不需要删掉重来。下面这几条命令执行成功时都不会打印任何东西：

- `git remote set-url origin <新地址>` 用来修改地址
- `git remote rename origin <新名字>` 用来给远程仓库改名
- `git remote remove typo` 用来删除一个远程仓库

## 五、`git push`：推送的是本地分支

现在可以第一次推送了：

```bash
git push origin main
# Enumerating objects: 6, done.
# Counting objects: 100% (6/6), done.
# Delta compression using up to 32 threads
# Compressing objects: 100% (2/2), done.
# Writing objects: 100% (6/6), 510 bytes | 510.00 KiB/s, done.
# Total 6 (delta 0), reused 0 (delta 0), pack-reused 0
# To ../github/notes.git
#  * [new branch]      main -> main
```

*代码 17：前面几行是在打包和发送对象，6 个对象就是两个提交、两个目录树和两个版本的 README.md。最后一行才是结果。*

`git push origin main` 里的两个参数，分工并不相同。`origin` 是推送的目的地，也就是上一节记下的那个远程仓库；而 `main` 指的是本地的 main 分支，它告诉 Git 要推送的是哪些提交。手册在举例时对这种写法的解释是这样的（例子里的分支叫 master）：

> Find a ref that matches master in the source repository (most likely, it would find refs/heads/master), and update the same ref (e.g. refs/heads/master) in origin repository with it. If master did not exist remotely, it would be created.

也就是说，Git 先在本地找到叫这个名字的分支，再用它去更新远程仓库里同名的分支，如果远程还没有这条分支，就新建一条。输出的最后一行 `* [new branch]      main -> main` 说的正是这件事，箭头左边是本地的分支，右边是远程的分支。

如果写上一个本地没有的分支名，push 就无法执行：

```bash
git push origin nosuch
# error: src refspec nosuch does not match any
# error: failed to push some refs to '../github/notes.git'
```

*代码 18：退出码是 1。src 是 source 的缩写，指的是本地这一边。*

即使远程仓库里已经有一条叫 nosuch 的分支，报错也完全一样，因为 Git 是在本地找不到 nosuch，和远程有没有这条分支无关。

推送完成之后，本地多出了一条远程跟踪分支：

```bash
git branch -a
# * main
#   remotes/origin/main

cat .git/refs/remotes/origin/main
# 60c3f26ad175e7c6cd62fad01d65505467296f71
```

*代码 19：origin/main 里记录的提交号，和本地的 main 相同。*

`origin/main` 就是第一节说的远程跟踪分支，它记的是上一次和远程仓库通信时，远程的 main 在哪里。推送成功之后，Git 知道远程的 main 已经指向了 60c3f26，于是顺手把 origin/main 也更新了。它和第二章讲的分支一样，也是一个记录着提交号的文件，区别在于它只会在和远程仓库通信的时候更新，平时并不会跟着本地的提交移动。

### 冒号写法：两边的名字可以不同

`git push origin main` 其实是 `git push origin main:main` 的简写。冒号左边是本地的分支（src），右边是远程的分支（dst），两边的名字相同时，可以只写一个。两边的名字当然也可以不同。先在本地新建一条 cat 分支，新建一个 cat.md 并提交，然后把它推送到远程的 main 上：

```bash
git switch -c cat
git add cat.md
git commit -m "猫咪笔记"
# [cat dade8c9] 猫咪笔记
#  1 file changed, 3 insertions(+)
#  create mode 100644 cat.md

git push origin cat:main
# （打包和发送对象的几行，这里省略）
# To ../github/notes.git
#    60c3f26..dade8c9  cat -> main
```

*代码 20：`cat -> main` 表示用本地的 cat 更新了远程的 main。*

`60c3f26..dade8c9` 是远程的 main 在推送前后的位置。因为 dade8c9 是在 60c3f26 的基础上提交的，所以远程的 main 只需要往前挪一步，这正是第三章讲的快进。再看看本地：

```bash
git log --oneline --all
# dade8c9 (HEAD -> cat, origin/main) 猫咪笔记
# 60c3f26 (main) 补上第七章
# 10f4cfd 第一篇笔记
```

*代码 21：origin/main 跟到了 dade8c9，而本地的 main 仍然停在 60c3f26。*

![git push origin cat:main 的三个部分](/img/posts/git-github/push-refspec.svg)

*图 1：origin 说的是推到哪个仓库，冒号左边的 cat 是本地分支，右边的 main 是远程仓库里的分支。推完之后，远程的 main 指向 dade8c9，本地的 main 没有变化。*

这个结果乍看有些奇怪，远程的 main 上已经有了「猫咪笔记」，本地的 main 上却还没有。但是按照上面的规则来理解，它是理所当然的，因为 push 只会更新远程的分支和本地对应的 origin/main，从来不会移动本地的分支。这种写法平时用得不多，但它把 push 的两个参数各自代表什么讲得很清楚。

更容易出问题的是接下来这一步。切换到 main 上看一眼：

```bash
git switch main
git status
# On branch main
# nothing to commit, working tree clean
```

*代码 22：git status 并没有提到 main 已经落后于远程。*

本地的 main 明明比远程少了一个提交，`git status` 却什么都没有说。原因在于 main 还没有设置上游，git status 不知道应该拿它和哪一条远程分支比较。下一节讲的 `-u` 就是用来设置上游的。

### 远程仓库里有本地没有的提交

最后回到上一节开头的那个提醒。假如在 GitHub 上新建仓库时勾选了 README，那么远程仓库一开始就有了一个提交，而本地并没有这个提交。这时第一次推送就会被拒绝。下面换一个远程里已经有 README 提交的仓库 blog.git 来演示：

```bash
git push origin main
# To ../github/blog.git
#  ! [rejected]        main -> main (fetch first)
# error: failed to push some refs to '../github/blog.git'
# hint: Updates were rejected because the remote contains work that you do
# hint: not have locally. This is usually caused by another repository pushing
# hint: to the same ref. You may want to first integrate the remote changes
# hint: (e.g., 'git pull ...') before pushing again.
# hint: See the 'Note about fast-forwards' in 'git push --help' for details.
```

*代码 23：退出码是 1。*

远程的 main 上有一个本地没有的提交，如果直接用本地的 main 覆盖过去，这个提交就丢了，所以 Git 拒绝了这次推送。这和第六章 reset 之后再推送被拒绝是同一个道理，只是这一次括号里写的是 `fetch first`，意思是远程有本地还没有拿到的东西，应该先把它拿下来。对于一个刚建好、里面只有 README 的仓库来说，最省事的办法是在 GitHub 上把它删掉，重新建一个空仓库。

## 六、`-u`：给本地分支设置上游

回到 cat 分支。如果不带任何参数，直接执行 `git push`，会得到一个错误：

```bash
git switch cat
git push
# fatal: The current branch cat has no upstream branch.
# To push the current branch and set the remote as upstream, use
#
#     git push --set-upstream origin cat
#
```

*代码 24：退出码是 128。*

不带参数的 `git push` 需要知道应该推送到哪个远程仓库的哪一条分支，这个信息就叫作**上游**（upstream），而 cat 目前还没有上游。报错信息里已经写好了解决办法，其中的 `--set-upstream` 可以简写成 `-u`：

```bash
git push -u origin cat
# Total 0 (delta 0), reused 0 (delta 0), pack-reused 0
# To ../github/notes.git
#  * [new branch]      cat -> cat
# Branch 'cat' set up to track remote branch 'cat' from 'origin'.
```

*代码 25：远程仓库在上一节已经收到过 dade8c9，所以这一次一个对象都不用发送（Total 0），只是在远程新建了一条 cat 分支。*

最后一行说的就是设置上游这件事，它被记在了 `.git/config` 里：

```bash
cat .git/config
# （前面和代码 15 相同）
# [branch "cat"]
# 	remote = origin
# 	merge = refs/heads/cat
```

*代码 26：`-u` 多写下的两行，意思是 cat 的上游是 origin 上的 cat 分支。*

所谓上游，指的就是这两行配置。它让本地的 cat 和 origin/cat 配成了一对，于是带来了两个变化。第一个变化是不带参数的 `git push` 可以用了，它会推送到上游。第二个变化是 `git status` 会拿本地的 cat 和 origin/cat 作比较。在 cat 上再提交一次，就能看到这两个变化：

```bash
git commit -am "猫喜欢纸箱"
# [cat 0e2687d] 猫喜欢纸箱
#  1 file changed, 1 insertion(+)

git status
# On branch cat
# Your branch is ahead of 'origin/cat' by 1 commit.
#   (use "git push" to publish your local commits)
#
# nothing to commit, working tree clean

git push
# （打包和发送对象的几行，这里省略）
# To ../github/notes.git
#    dade8c9..0e2687d  cat -> cat

git status
# On branch cat
# Your branch is up to date with 'origin/cat'.
#
# nothing to commit, working tree clean
```

*代码 27：提交之后，status 提示领先了 1 个提交；push 之后，又变回了一致。*

![上游：-u 让 cat 和 origin/cat 配成一对](/img/posts/git-github/upstream.svg)

*图 2：git status 比较的是本地的 cat 和 origin/cat，这两样都在本地。git push 把提交发送到远程，成功之后再把 origin/cat 挪到同一个位置。*

需要注意的是，git status 并不会联网去查询远程仓库，它比较的只是本地记录的 origin/cat。如果有别人往远程的 cat 上推送了新的提交，那么在下一次和远程通信之前，本地的 origin/cat 不会变化，git status 也就仍然会说「一致」。

上游对每一条分支只需要设置一次。克隆下来的仓库也不需要手动设置，第一节代码 3 里的 `Your branch is up to date with 'origin/master'` 说明 clone 已经替 master 设置好了。

`-u` 也可以和冒号写法一起使用，但是如果两边的名字不同，事情就会变得别扭：

```bash
git push -u origin cat:main
# Total 0 (delta 0), reused 0 (delta 0), pack-reused 0
# To ../github/notes.git
#    dade8c9..0e2687d  cat -> main
# Branch 'cat' set up to track remote branch 'main' from 'origin'.

git push
# fatal: The upstream branch of your current branch does not match
# the name of your current branch.  To push to the upstream branch
# on the remote, use
#
#     git push origin HEAD:main
#
# To push to the branch of the same name on the remote, use
#
#     git push origin HEAD
#
# To choose either option permanently, see push.default in 'git help config'.
```

*代码 28：上游已经换成了远程的 main，但是不带参数的 push 拒绝执行，退出码是 128。*

这时 cat 的上游是 origin 上的 main。不带参数的 git push 发现上游的名字和本地分支的名字不一样，就不会替人做决定，而是停下来把两种写法都列出来。手册对这个默认行为的说明是 `as a safety measure, the push is aborted if the upstream branch does not have the same name as the local one`。所以 `-u` 最好用在两边名字相同的时候，而冒号写法适合偶尔用一次，在命令里明确写出要推送到哪里。

现在可以回到上一节留下的问题了。main 没有上游，所以 git status 看不出它落后于远程。这时不能用 `git push -u origin main` 来设置上游，因为本地的 main 落后于远程，推送会被拒绝，而 `-u` 只在推送成功时才会生效。只设置上游、不推送的命令是 `git branch -u`：

```bash
git switch main
git branch -u origin/main
# Branch 'main' set up to track remote branch 'main' from 'origin'.

git status
# On branch main
# Your branch is behind 'origin/main' by 2 commits, and can be fast-forwarded.
#   (use "git pull" to update your local branch)
#
# nothing to commit, working tree clean
```

*代码 29：设置上游之后，status 立刻发现 main 落后了 2 个提交，也就是先后两次推送到远程 main 上的 dade8c9 和 0e2687d。*

提示里建议用 `git pull` 把远程的提交拿下来，这就是反方向的操作了。

## 小结

| 写法 | 作用和要点 |
| --- | --- |
| `git clone <地址>` | 复制整个仓库和全部历史，同时记下 origin、建好 origin/* 远程跟踪分支，并给默认分支设置上游 |
| `ssh-keygen -t ed25519` | 生成一对密钥，把 .pub 公钥加到 GitHub 上，再用 `ssh -T git@github.com` 测试 |
| `git branch -m main` | 把当前分支改名为 main，和 GitHub 的默认分支保持一致 |
| `git remote add <名字> <地址>` | 只在 .git/config 里写下名字和地址，不联网，所以地址写错了也不会报错 |
| `git remote -v` | 列出记下的远程仓库，从 git init 开始的仓库一开始什么都没有 |
| `git push <远程> <分支>` | 用本地分支更新远程的同名分支，远程没有这条分支就新建一条 |
| `git push <远程> <本地>:<远程分支>` | 两边名字不同时使用，push 不会移动本地的分支 |
| `git push -u <远程> <分支>` | 推送成功后设置上游，之后 push 可以不带参数，status 会报告领先或落后 |
| `git branch -u <远程>/<分支>` | 只设置上游，不推送 |

*表中的 `<远程>` 通常是 origin。*

这一章的命令都围绕着一件事，那就是本地仓库怎样记住远程。`git remote add` 在配置里记下名字和地址；`git push` 用本地的分支去更新远程的分支，并且顺手更新本地的 origin/*；`-u` 再在配置里记下本地分支和哪一条远程分支配对。这三样记录都保存在本地的 `.git` 里，所以 `git status` 不联网也能说出领先或者落后了几个提交，但是它说的只是上一次通信时的情况。

到目前为止，提交都是从本地流向远程。反方向的 `fetch` 和 `pull`，也就是把远程的新提交拿到本地，留到后面再讲。
