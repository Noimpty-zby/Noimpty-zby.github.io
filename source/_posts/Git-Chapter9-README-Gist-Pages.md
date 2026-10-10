---
title: Git 第九章：README、Gist 和 Pages，背后都是一个 Git 仓库
date: 2026-10-10 15:04:00
description: Colt Steele《The Git & Github Bootcamp》GitHub 杂项那一章的复盘。仓库的可见性决定谁能看到它，改成公开之后别人看到的是包括全部历史的整个仓库，删掉的文件仍然留在旧提交里；合作者拿到的是推送的权限，个人仓库里只有拥有者和合作者两种身份。README 是仓库首页显示的 Markdown 文件，写 Markdown 时标题的井号后面要有空格，图片的感叹号要紧挨着方括号，只按一次回车并不会换行。Gist 本身就是一个可以 clone 的仓库，secret 并不等于私有。GitHub Pages 把某条分支上的一个目录发布成静态网站，从分支发布时默认用 Jekyll 把 Markdown 转换成 HTML。
categories:
  - [课外, AI Infra, Git]
tags:
  - GitHub
  - README
  - Markdown
  - Gist
  - GitHub Pages
cover: /img/covers/Git-Chapter9-README-Gist-Pages.svg
series: Git
privacy: protected
sitemap: false
private_section: 课外
---

前两章讲的都是本地仓库和 GitHub 上的仓库之间怎样传递提交，push 把提交送上去，fetch 和 pull 再把提交拿下来。这一章回到 GitHub 网站本身，看看它在保存仓库之外还提供了哪些功能。这些功能可以分成两组。第一组管的是人，也就是谁能看到这个仓库，以及谁能往里推送。第二组管的是怎样把内容展示给别人，包括仓库首页的 README、用来分享代码片段的 Gist，以及把仓库发布成网站的 GitHub Pages。

这些功能在网页上点几下就能用，但是它们背后都是一个普通的 Git 仓库。README 是仓库里的一个文件，Gist 本身就是一个仓库，而 Pages 发布的是某条分支上的文件。如果记住了这一点，很多看起来零散的规则就都说得通了。比如为什么把仓库改回私有，也收不回已经公开过的内容；又比如为什么在网页上改了 README 之后，本地还要再 pull 一次。

<!-- more -->

## 一、可见性：公开的是整个仓库

在 GitHub 上新建仓库时，要在 Public 和 Private 之间选一个，这就是仓库的**可见性**（visibility）。公开仓库对所有人可见，不登录也能浏览和 clone，第七章克隆的 octocat/Hello-World 就是一个公开仓库。私有仓库则只有拥有者和被邀请的合作者才能看到。

仓库建好之后，可见性也可以修改。打开仓库的 Settings，在 General 页最下面的 Danger Zone 里找到 Change repository visibility，点击 Change visibility，再选择新的可见性。这时 GitHub 会先列出这次修改带来的后果，确认之后才会生效。如果从公开改成私有，那么仓库的 star 和 watcher 会被清空。别人已经 fork 出去的副本仍然是公开的，只是和这个仓库断开了联系。如果用的是免费账号，已经发布的 GitHub Pages 网站也会被撤下。如果从私有改成公开，那么所有人都能看到代码，任何人都可以 fork，Actions 的运行记录和日志也会一起公开。

把私有仓库改成公开时，有一点特别需要注意。公开的不只是最新的那些文件，而是整个仓库，其中也包括全部的历史。下面这个仓库在第一个提交里放进了一个写着令牌的 deploy.env，第二个提交又把它删掉了：

```bash
git commit -m "第一篇笔记"
# [main (root-commit) 7d73345] 第一篇笔记
#  2 files changed, 2 insertions(+)
#  create mode 100644 README.md
#  create mode 100644 deploy.env

git rm deploy.env
# rm 'deploy.env'

git commit -m "删掉 deploy.env"
# [main 9c0f49f] 删掉 deploy.env
#  1 file changed, 1 deletion(-)
#  delete mode 100644 deploy.env

ls
# README.md

git show HEAD~1:deploy.env
# TOKEN=这里是一串令牌
```

*代码 1：`git rm` 删除文件，并且把这次删除放进暂存区。`HEAD~1:deploy.env` 指的是上一个提交里的 deploy.env。*

工作区里已经没有 deploy.env 了，但是第一个提交 7d73345 仍然保存着它。第四章讲过，Git 保存的是一份一份完整的快照，后面的提交删掉一个文件，并不会改动前面的提交。所以仓库一旦公开，任何人 clone 下来之后，都能用同样的命令看到这个令牌。公开之前，最好先用 `git log --all --stat` 把历史里出现过的文件都看一遍。如果令牌已经进过历史，那么最稳妥的做法是把它当作已经泄露，到发放它的地方把它作废，再重新生成一个。

反过来，从公开改回私有，也收不回已经公开过的内容。别人 fork 出去的副本仍然是公开的，而 clone 到别人电脑上的仓库，GitHub 更是管不到。

## 二、合作者：把推送的权限交给别人

一个属于个人账号的仓库，默认只有拥有者能往里推送。别人即使能看到这个仓库，推送也会被拒绝。如果想和同学一起维护一个仓库，就要把对方加为**合作者**（collaborator）。做法是打开仓库的 Settings，点击左侧栏 Access 一组里的 Collaborators，早些时候的界面上这一项叫 Manage access。接着点击 Add people，输入对方的用户名或者邮箱，从搜索结果里选中这个人并确认添加。对方会收到一封邀请邮件，接受邀请之后才真正成为合作者。

个人仓库里只有拥有者和合作者这两种身份。合作者可以 pull，也可以 push，但是和仓库设置有关的操作都只属于拥有者：

| 操作 | 拥有者 | 合作者 |
| --- | --- | --- |
| pull 和 push | 能 | 能 |
| 邀请合作者 | 能 | 不能 |
| 修改可见性 | 能 | 不能 |
| 删除仓库 | 能 | 不能 |

*表中只列了几项，完整的清单在 GitHub 文档的 Permission levels for a personal account repository 一页。*

也就是说，合作者拿到的就是读和写这两种权限。私有仓库也没有办法只给某个人只读的权限，文档里写的是 `Collaborators can't have read-only access to repositories owned by a personal account`。如果需要更细的分工，比如有的人只能看、有的人能推送，就要把仓库建在组织（organization）下面。另外，免费账号给公开仓库和私有仓库添加合作者都没有人数上的限制。

把一个人从合作者里移除之后，对方就不能再访问这个仓库了。但是文档里也写明了，对方已经 clone 到本地的仓库仍然留在对方手里。这和上一节是同一个道理，因为 Git 仓库复制出去的每一份都是完整的。

有了合作者之后，上一章模拟的就是每天都会遇到的情况。几个人往同一个仓库推送，所以每个人在推送之前，都要先用 fetch 或者 pull 把别人的提交拿下来。

## 三、README：仓库首页显示的那个文件

打开 GitHub 上的一个仓库，文件列表下面通常会显示一段说明。这段说明来自仓库里一个叫 **README** 的文件，一般写成 README.md。GitHub 会把它渲染成网页显示在首页上，所以它往往是访客看到的第一样东西。GitHub 的文档建议 README 讲清楚这几件事：

- 这个项目是做什么的
- 它为什么有用
- 怎样开始使用
- 遇到问题去哪里求助
- 谁在维护这个项目

README 不一定要放在根目录。GitHub 会在三个地方找它，分别是隐藏的 `.github` 目录、根目录和 `docs` 目录。如果几个地方都有 README，那么按照 `.github`、根目录、`docs` 的顺序，先找到哪个就显示哪个。

新建仓库的页面上有一个添加 README 的选项，现在的界面上是一个叫 Add README 的开关。打开它之后，GitHub 会在新仓库里生成一个 README.md，作为仓库的第一个提交。第七章讲过，如果本地已经有了提交，就不要打开这个选项，否则第一次推送会被拒绝。

README 只是仓库里一个普通的文件，所以修改它的办法和修改其他文件一样，在本地修改、提交，再 push 上去，首页就会跟着更新。也可以直接在 GitHub 的网页上编辑，保存的时候 GitHub 会让人填写提交信息，然后在远程仓库里生成一个提交。这个提交本地还没有，所以下一次在本地推送之前，要先像上一章那样把它 pull 下来。

## 四、Markdown 的基本写法

README.md 的扩展名 .md 表示它是用 **Markdown** 写的。Markdown 是一种用普通符号来标记格式的纯文本写法，比如在一行的开头加上 `#` 表示标题，在文字的前后各加两个星号表示粗体。GitHub 显示 .md 文件时，会先把它转换成 HTML，再套上自己的样式显示出来。因为标记用的都是普通符号，所以即使不经过转换，源文件本身也很容易读懂。

图 1 的左边是一份 README.md 的源文件，右边是它在 GitHub 上显示出来的样子：

![README.md 的源文件和它在 GitHub 上显示的样子](/img/posts/git-readme-gist-pages/markdown-render.svg)

*图 1：右边按照 GitHub 的样式画出，一级和二级标题下面各有一条细线，第二层列表项前面是空心的圆点。*

图里用到的写法有下面这些：

- `# 标题` 是一级标题，`##` 是二级标题，最多可以到六级，`#` 的后面要有一个空格。
- `**粗体**` 是粗体，`*斜体*` 是斜体。
- `~~删除线~~` 是删除线，这是 GitHub 在标准 Markdown 之外加上的写法。
- `> 引用` 是引用块，左边有一条竖线，文字显示成灰色。
- `- 项目` 是无序列表，`-` 换成 `*` 或 `+` 也可以，缩进两个空格就是下一层；`1. 项目` 是有序列表。
- 用一对反引号把代码围起来是行内代码，显示成等宽字体，背景是浅灰色。
- `[文字](地址)` 是链接，`![说明](地址)` 是图片。图片方括号里的说明不会显示在图片旁边，但是图片加载不出来时会显示它。

代码块用三个反引号开头，再用三个反引号结尾。开头那一行的反引号后面可以写上语言的名字：

````markdown
```bash
git log --oneline
```
````

*代码 2：GitHub 根据 bash 这个名字决定怎样高亮。写成 py、js、c 这样的常见扩展名也能识别；如果写了一个不认识的名字，代码块照样显示，只是没有高亮。*

表格也是 GitHub 加上的写法，表头下面必须有一行分隔行：

```markdown
| 命令 | 作用 |
| :--- | :---: |
| `git fetch` | 只更新 origin/* |
```

*代码 3：如果省掉第二行，这几行就只是普通的文字。冒号写在左边表示左对齐，两边都写表示居中，只写在右边表示右对齐。*

### 几处容易写错的地方

第一处是标题后面的空格。`#` 和文字之间如果没有空格，比如写成 `#没有空格`，那么 GitHub 不会把它当成标题，而是把这几个字符原样显示出来。

第二处是图片前面的感叹号。感叹号必须紧挨着方括号，如果写成 `! [logo](logo.png)`，中间多了一个空格，那么 GitHub 会把它理解成一个普通的感叹号加上一个链接：

```html
<p>! <a href="logo.png">logo</a></p>
```

*代码 4：GitHub 转换出来的 HTML。页面上显示的是一个感叹号和一个叫 logo 的链接，图片并没有出现。*

第三处是换行。在 .md 文件里，只按一次回车并不会换行：

```markdown
第一行
第二行

第三行  
第四行
```

*代码 5：「第三行」的后面还有两个空格，在这里看不出来。*

GitHub 把它转换成下面的 HTML：

```html
<p>第一行
第二行</p>
<p>第三行<br>
第四行</p>
```

*代码 6：`<p>` 是一个段落，`<br>` 是一次换行。*

第一行和第二行之间只隔着一个换行符，所以它们被放进了同一个段落。对浏览器来说，段落里的换行符和空格一样，所以这两行会接在一起显示，在 Chrome 里看到的是「第一行 第二行」。空一行才会开始一个新的段落；如果只想换行、不想分段，就要在行尾加上两个空格，或者加一个反斜杠，这两种写法都会变成 `<br>`。需要注意的是，这条规则只对 .md 文件成立。在 issue 和 pull request 的评论框里写 Markdown 时，GitHub 会把每一次回车都显示成换行。

第四处和中文的标点有关。粗体的星号如果紧挨着中文标点，有时会失效。比如 `这是**加粗。**后面`，在 GitHub 上显示出来的仍然是原样的星号。这是因为结尾的 `**` 前面是标点、后面紧跟着汉字，按照 Markdown 的规则，它不能当作粗体的结束标记。如果把句号挪到星号外面，写成 `这是**加粗**。后面`，那么就能正常显示成粗体了。

## 五、Gist：只装着几个文件的仓库

**Gist** 是 GitHub 用来分享代码片段的地方，地址是 gist.github.com。新建一个 Gist 时要填三样东西，分别是一段描述、一个带扩展名的文件名和文件的内容。GitHub 根据扩展名来决定怎样高亮，比如文件名写成 hello.py，内容就会按照 Python 来高亮。

Gist 看起来只是一个贴代码的网页，但是文档里写着 `Every gist is a Git repository, which means that it can be forked and cloned`，也就是说每一个 Gist 都是一个 Git 仓库。下面克隆 octocat 的一个公开 Gist：

```bash
git clone https://gist.github.com/6cad326836d38bd3a7ae.git hello
# Cloning into 'hello'...
# remote: Enumerating objects: 3, done.
# remote: Total 3 (delta 0), reused 0 (delta 0), pack-reused 3 (from 1)
# Receiving objects: 100% (3/3), done.

cd hello
ls
# hello_world.rb

git log
# commit de5b9b59d1f28206e8d646c7c8025e9809d0ed73 (HEAD -> master, origin/master, origin/HEAD)
# Author: The Octocat <octocat@nowhere.com>
# Date:   Wed Oct 1 09:19:34 2014 -0700
```

*代码 7：克隆地址是 gist.github.com/ 加上这个 Gist 的编号，再加上 .git。3 个对象是一个提交、一个目录树和 hello_world.rb 的内容。*

和克隆普通的仓库一样，本地有了 master 分支和 origin/master 这样的远程跟踪分支，也有了完整的历史。这个 Gist 只有一个提交，而且提交信息是空的，因为在网页上创建和编辑 Gist 时并没有填写提交信息的地方。之后每在网页上编辑一次，历史里就会多一个提交，Gist 页面上的 Revisions 标签列出的就是这些提交以及每一次的改动。反过来，在本地修改并提交之后，也可以把提交 push 回自己的 Gist。

创建 Gist 时，默认的按钮是 Create secret gist，点击旁边的下拉箭头才能换成 Create public gist。公开的 Gist 会出现在 Gist 的发现页里，也能被搜索到，而 secret Gist 不会出现在这些地方。但是 secret 并不等于私有，文档里写的是 `Secret gists aren't private`，任何人只要拿到它的网址，就能看到里面的内容。另外，公开的 Gist 不能再改成 secret，而 secret Gist 可以改成公开。所以如果一段代码真的不能给别人看，就应该放进私有仓库，而不是放进 secret Gist。

## 六、GitHub Pages：把仓库发布成网站

**GitHub Pages** 是 GitHub 提供的静态网站托管服务。它从仓库里取出 HTML、CSS 和 JavaScript 文件，需要的话先构建一遍，然后发布成一个网站。所谓静态，是指服务器只负责把这些文件原样发给浏览器，并不会在服务器上运行程序。所以需要后端程序和数据库的功能，Pages 本身是做不了的。

配置的地方在仓库 Settings 的 Pages 页。在 Build and deployment 下面，Source 选择 Deploy from a branch，然后选择一条分支和一个目录。目录只有两种选择，一种是根目录 `/`，另一种是 `/docs`。保存之后，这条分支上的这个目录就会被发布出去；以后每次往这条分支推送，网站都会重新发布一次。

![从分支发布到 GitHub Pages 的过程](/img/posts/git-readme-gist-pages/pages-publish.svg)

*图 2：发布源选的是 main 分支的 /docs，所以根目录下的 README.md 和 ssh.md 不会出现在网站上。*

网站需要一个入口文件，也就是打开网址时首先显示的那个页面。Pages 会在发布的目录里找 index.html、index.md 或者 README.md 当作入口文件。后两个是 Markdown 文件，它们之所以也能用，是因为从分支发布时，Pages 默认会先用 Jekyll 构建一遍。Jekyll 是一个静态网站生成器，它会把 Markdown 转换成 HTML。所以即使仓库里一个 .html 文件都没有，只有一个 README.md，也能发布成一个网站。如果不想让 Jekyll 处理这些文件，可以在发布的目录里放一个名叫 `.nojekyll` 的空文件。

Source 的另一个选项是 GitHub Actions，也就是用自己写的工作流来构建和发布，这样就可以换成 Jekyll 以外的生成器。这个博客就是先用 Hexo 生成静态文件，再由 Actions 发布到 Pages 上的。

网站的地址分两种。普通仓库发布的是项目网站，每个仓库可以有一个；如果仓库的名字正好是 `<用户名>.github.io`，那么它发布的就是用户网站，每个账号只能有一个：

```text
项目网站  https://<用户名>.github.io/<仓库名>/
用户网站  https://<用户名>.github.io/
```

*代码 8：两种网站都可以换成自己的域名。*

最后，Pages 和第一节的可见性也有关系。免费账号只能给公开仓库开启 Pages，所以把仓库改成私有之后，已经发布的网站会被撤下。付费账号可以从私有仓库发布网站，但是发布出来的网站仍然是公开的。文档里专门提醒了这一点，如果仓库里有敏感的内容，要先删掉再发布。

## 小结

| 写法或位置 | 作用和要点 |
| --- | --- |
| Settings 的 Danger Zone | 修改可见性，公开的是包括全部历史的整个仓库 |
| `git show HEAD~1:<文件>` | 查看上一个提交里的文件，删掉的文件在旧提交里仍然存在 |
| Settings 的 Collaborators | 邀请合作者，对方接受之后可以 pull 和 push，但是不能改设置 |
| README.md | 显示在仓库首页，依次在 `.github`、根目录、`docs` 里找 |
| `# 标题` | `#` 后面要有空格，否则就不是标题 |
| `![说明](地址)` | 图片，感叹号要紧挨着方括号 |
| 行尾两个空格或反斜杠 | .md 文件里的换行，只按一次回车不会换行，空一行是分段 |
| gist.github.com | 分享代码片段，每个 Gist 都是一个可以 clone 的仓库，secret 不等于私有 |
| Settings 的 Pages | 选一条分支和一个目录发布静态网站，入口是 index.html、index.md 或 README.md |

这一章的几样功能，都可以落回到 Git 仓库上来理解。可见性决定的是谁能读这个仓库，合作者拿到的是往仓库里写的权限。README 是仓库里的一个文件，Gist 是一个只装着几个文件的仓库，Pages 发布的则是某条分支上的一个目录。因为仓库里保存着完整的历史，而且每一份 clone 也都是完整的，所以改可见性、移除合作者都只能管住以后，已经复制出去的那些副本是收不回来的。
