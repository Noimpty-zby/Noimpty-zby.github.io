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
  if (data.errors) throw new Error(data.errors.map(e => e.message).join('; '))
  if (!data.data) throw new Error(`HTTP ${res.status}｜${data.message || JSON.stringify(data).slice(0, 120)}`)
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

// 一次把所有 Discussion 及其评论拉下来，后面全在内存里查，省 API 调用
export const listDiscussions = async () => {
  const d = await gql(`
    query($o:String!,$n:String!){
      repository(owner:$o,name:$n){
        discussions(first:100, orderBy:{field:UPDATED_AT,direction:DESC}){
          nodes{
            id title url
            reactions(first:20){ nodes{ content user{ login } } }
            comments(first:50){
              nodes{
                id body createdAt url author{ login }
                replies(first:20){ nodes{ id body createdAt author{ login } } }
              }
            }
          }
        }
      }
    }`, { o: OWNER, n: NAME }, REPO_TOKEN)
  return d.repository?.discussions?.nodes || []
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

export const triggerDeploy = async (workflowFile = 'pages.yml', ref = 'main') => {
  const token = process.env.GITHUB_TOKEN || ''
  if (!token) { console.log('  没有 GITHUB_TOKEN，无法触发部署'); return false }
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
    const t = await res.text()
    console.log(`  触发部署失败：HTTP ${res.status} ${t.slice(0, 160)}`)
    return false
  } catch (e) {
    console.log('  触发部署失败：' + String(e.message || e).slice(0, 140))
    return false
  }
}
