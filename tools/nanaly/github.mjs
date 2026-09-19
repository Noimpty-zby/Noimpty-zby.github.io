// GitHub GraphQL 小工具：找/建 Discussion、发评论、贴表情。
// Giscus 用 pathname 映射，也就是说一篇文章对应的 Discussion 标题
// 就是它的路径，比如 /2026/07/20/homework-three/ 。
// 只要标题对得上，我们建的 Discussion 就会被 giscus 认领，
// 评论会直接出现在那篇文章的评论区里。

// 两把 token，各干各的：
//
//   REPO_TOKEN —— 仓库自己的 GITHUB_TOKEN。workflow 里给了 discussions: write，
//                 用来做「新建讨论」这类需要仓库写权限的事。
//   HER_TOKEN  —— 她小号的 PAT。用来发评论、贴表情，好让读者看到的是她的头像和名字。
//
// 为什么要分开：小号不是仓库协作者，没有写权限，新建讨论会被拒
// （报错就是 `xxx does not have the correct permissions to execute CreateDiscussion`）。
// 但发评论只需要读权限，所以说话仍然是她本人。
// 分开之后既不用把小号加成协作者，她的发言也还是她自己的身份。
const REPO_TOKEN = process.env.GITHUB_TOKEN || ''
const HER_TOKEN = process.env.NANALY_GITHUB_TOKEN || REPO_TOKEN
const REPO = process.env.GITHUB_REPOSITORY || 'Noimpty-zby/Noimpty-zby.github.io'
const CATEGORY_ID = process.env.GISCUS_CATEGORY_ID || 'DIC_kwDOTYYcpM4DDOPO'
export const [OWNER, NAME] = REPO.split('/')

export const gql = async (query, variables = {}, token = HER_TOKEN) => {
  if (!token) throw new Error('没有 GitHub token')
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000)
  })
  const data = await res.json().catch(() => ({}))
  if (data?.errors?.length) throw new Error(data.errors.map(e => e.message).join('; '))
  if (!res.ok || !data?.data) throw new Error(`HTTP ${res.status}｜${data?.message || JSON.stringify(data).slice(0, 120)}`)
  return data.data
}

let repoCache = null
export const getRepo = async () => {
  if (repoCache) return repoCache
  const d = await gql(`query($o:String!,$n:String!){ repository(owner:$o,name:$n){ id } }`,
    { o: OWNER, n: NAME }, REPO_TOKEN)
  repoCache = d.repository
  return repoCache
}

const replyFields = 'id body createdAt url author{ login url }'
const replyConnection = `replies(last:20){ nodes{ ${replyFields} } pageInfo{ hasPreviousPage startCursor } }`
const commentFields = `id body createdAt url author{ login url } ${replyConnection}`

// An incomplete connection loses both pending questions and de-duplication
// markers. Follow every cursor; fail visibly rather than silently truncating.
const completeConnection = async (connection, loadPage, backwards = false) => {
  const result = [...(connection?.nodes || [])]
  const seen = new Set()
  let page = connection
  while (backwards ? page?.pageInfo?.hasPreviousPage : page?.pageInfo?.hasNextPage) {
    const cursor = backwards ? page.pageInfo.startCursor : page.pageInfo.endCursor
    if (!cursor || seen.has(cursor)) throw new Error('GitHub 分页游标无效，无法完整读取讨论')
    seen.add(cursor)
    page = await loadPage(cursor)
    if (!page || !Array.isArray(page.nodes)) throw new Error('GitHub 分页缺少评论数据')
    if (backwards) result.unshift(...page.nodes)
    else result.push(...page.nodes)
  }
  const ids = new Set()
  return result.filter(node => {
    if (!node || (node.id && ids.has(node.id))) return false
    if (node.id) ids.add(node.id)
    return true
  })
}

export const listDiscussions = async () => {
  const load = async after => {
    const d = await gql(`
      query($o:String!,$n:String!,$after:String){
        repository(owner:$o,name:$n){
          discussions(first:100,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}){
            nodes{
              id title url
              reactions(first:20){ nodes{ id content user{ login } } pageInfo{ hasNextPage endCursor } }
              comments(last:50){ nodes{ ${commentFields} } pageInfo{ hasPreviousPage startCursor } }
            }
            pageInfo{ hasNextPage endCursor }
          }
        }
      }`, { o: OWNER, n: NAME, after }, REPO_TOKEN)
    if (!d.repository?.discussions) throw new Error('GitHub 未返回讨论列表')
    return d.repository.discussions
  }
  const discussions = await completeConnection(await load(null), load)
  for (const discussion of discussions) {
    const comments = await completeConnection(discussion.comments, async before => {
      const d = await gql(`query($id:ID!,$before:String!){node(id:$id){... on Discussion{
        comments(last:50,before:$before){nodes{${commentFields}} pageInfo{hasPreviousPage startCursor}}
      }}}`, { id: discussion.id, before }, REPO_TOKEN)
      return d.node?.comments
    }, true)
    for (const comment of comments) {
      const replies = await completeConnection(comment.replies, async before => {
        const d = await gql(`query($id:ID!,$before:String!){node(id:$id){... on DiscussionComment{
          replies(last:100,before:$before){nodes{${replyFields}} pageInfo{hasPreviousPage startCursor}}
        }}}`, { id: comment.id, before }, REPO_TOKEN)
        return d.node?.replies
      }, true)
      comment.replies = { nodes: replies }
    }
    discussion.comments = { nodes: comments }
    const reactions = await completeConnection(discussion.reactions, async after => {
      const d = await gql(`query($id:ID!,$after:String!){node(id:$id){... on Discussion{
        reactions(first:100,after:$after){nodes{id content user{login}} pageInfo{hasNextPage endCursor}}
      }}}`, { id: discussion.id, after }, REPO_TOKEN)
      return d.node?.reactions
    })
    discussion.reactions = { nodes: reactions }
  }
  return discussions
}

// 新建讨论需要仓库写权限，所以这里用仓库自己的 token（她的小号没这个权限）。
// 讨论主体是 giscus 不显示的，读者只会看到下面的评论，所以由谁建无所谓。
export const createDiscussion = async (title, body) => {
  const repo = await getRepo()
  const d = await gql(`
    mutation($r:ID!,$c:ID!,$t:String!,$b:String!){
      createDiscussion(input:{repositoryId:$r, categoryId:$c, title:$t, body:$b}){
        discussion{ id title url }
      }
    }`, { r: repo.id, c: CATEGORY_ID, t: title, b: body }, REPO_TOKEN)
  return d.createDiscussion.discussion
}

export const addComment = async (discussionId, body) => {
  const d = await gql(`
    mutation($d:ID!,$b:String!){
      addDiscussionComment(input:{discussionId:$d, body:$b}){ comment{ id url } }
    }`, { d: discussionId, b: body })
  return d.addDiscussionComment.comment
}

// content 取值：THUMBS_UP HEART HOORAY ROCKET EYES LAUGH CONFUSED THUMBS_DOWN
export const addReaction = async (subjectId, content) => {
  try {
    await gql(`
      mutation($s:ID!,$c:ReactionContent!){
        addReaction(input:{subjectId:$s, content:$c}){ reaction{ content } }
      }`, { s: subjectId, c: content })
    return true
  } catch (e) {
    // 已经贴过同一个表情会报错，这不算失败
    if (/already/i.test(String(e.message))) return false
    throw e
  }
}

// 讨论标题的匹配：giscus 建出来的标题长这样 —— 2026/08/12/xxx/ ，**开头没有斜杠**。
// 而 location.pathname 是 /2026/08/12/xxx/ ，带斜杠。
// 一开始我按带斜杠的形式去找，每次都找不到，于是每次都新建一个重复的讨论，
// giscus 随后指向了新的那个，主人原来的评论就"消失"了。
// 所以比较前一律把两端的斜杠剥掉。
export const titleKey = t => String(t || '').replace(/^\/+|\/+$/g, '').toLowerCase()

// 找已有讨论时用这个，别用 ===
export const findDiscussion = (discussions, path) => {
  const k = titleKey(path)
  return (discussions || []).find(d => titleKey(d.title) === k) || null
}

// 新建时用 giscus 的写法：开头不带斜杠、结尾带斜杠。
// 注意这里**不能转小写** —— giscus 用的是原样的 location.pathname，
// 而路径里有 UE5-ActionRoguelike 这种大小写，转了它就认不出来了。
// （titleKey 转小写只是为了比较时宽松一点，两者用途不同。）
export const giscusTitle = path => String(path || '').replace(/^\/+|\/+$/g, '') + '/'

// 她留下的每条评论都带一个隐藏标记，用来判重，免得每天重复念叨同一件事
export const marker = (kind, key) => `\n\n<!-- nanaly:${kind}:${key} -->`
export const hasMarker = (disc, kind, key) =>
  (disc.comments?.nodes || []).some(c => String(c.body || '').includes(`<!-- nanaly:${kind}:${key} -->`))

export const SIGN = '\n\n<sub>—— 娜娜莉，住在这个博客里的猫。这条是自动发的。</sub>'

// ---------------- 让她的提交能触发部署 ----------------
//
// GitHub 有一条防递归的规则：用默认的 GITHUB_TOKEN 推上去的提交，
// 不会触发任何 on:push 的工作流。所以她提交了文章或批注之后，
// 站点其实不会重新构建 —— 文件进了仓库，线上却看不见。
//
// 官方认可的绕法是显式派发一次 workflow_dispatch（GITHUB_TOKEN 可以做这件事）。
// 需要 workflow 里有 permissions: actions: write。
//
// 派发失败会**抛异常**，别改回只打一行日志。理由和 pushWithRetry 那段一模一样：
// 这是整条链路的最后一步，它没成功就等于「文件进了仓库、线上看不见」，
// 而工作流是绿的、邮件照发，没有任何人会发现。
// 抛出去至少能让那次运行变红 —— 内容已经推上去了，重跑一次 pages.yml 就能补上。

export const triggerDeploy = async (workflowFile = 'pages.yml', ref = 'main') => {
  const token = process.env.GITHUB_TOKEN || ''
  // 没 token 基本只会发生在本地手跑：那种情况下推上去的提交本来就会触发 on:push
  // （防递归规则只管 GITHUB_TOKEN 推的提交），部署照样会发生，不该在这里报警。
  if (!token) { console.log('  没有 GITHUB_TOKEN，跳过触发部署（本地推送会自己触发）'); return false }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${OWNER}/${NAME}/actions/workflows/${workflowFile}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ ref }),
        signal: AbortSignal.timeout(20000)
      })
    if (res.status === 204) { console.log('  已触发站点部署'); return true }
    throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  } catch (e) {
    throw new Error('没能触发站点部署（' + String(e.message || e).slice(0, 160)
      + '）—— 东西已经推进仓库了，但线上还是旧的，去重跑一次 pages.yml')
  }
}
