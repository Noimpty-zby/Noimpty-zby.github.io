// GitHub GraphQL 小工具：找/建 Discussion、发评论、贴表情。
// Giscus 用 pathname 映射，也就是说一篇文章对应的 Discussion 标题
// 就是它的路径，比如 /2026/07/20/homework-three/ 。
// 只要标题对得上，我们建的 Discussion 就会被 giscus 认领，
// 评论会直接出现在那篇文章的评论区里。

const TOKEN = process.env.NANALY_GITHUB_TOKEN || process.env.GITHUB_TOKEN || ''
const REPO = process.env.GITHUB_REPOSITORY || 'Noimpty-zby/Noimpty-zby.github.io'
const CATEGORY_ID = process.env.GISCUS_CATEGORY_ID || 'DIC_kwDOTYYcpM4DDOPO'
export const [OWNER, NAME] = REPO.split('/')

export const gql = async (query, variables = {}) => {
  if (!TOKEN) throw new Error('没有 GitHub token')
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'content-type': 'application/json' },
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
    { o: OWNER, n: NAME })
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
    }`, { o: OWNER, n: NAME })
  return d.repository?.discussions?.nodes || []
}

export const createDiscussion = async (title, body) => {
  const repo = await getRepo()
  const d = await gql(`
    mutation($r:ID!,$c:ID!,$t:String!,$b:String!){
      createDiscussion(input:{repositoryId:$r, categoryId:$c, title:$t, body:$b}){
        discussion{ id title url }
      }
    }`, { r: repo.id, c: CATEGORY_ID, t: title, b: body })
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

// 她留下的每条评论都带一个隐藏标记，用来判重，免得每天重复念叨同一件事
export const marker = (kind, key) => `\n\n<!-- nanaly:${kind}:${key} -->`
export const hasMarker = (disc, kind, key) =>
  (disc.comments?.nodes || []).some(c => String(c.body || '').includes(`<!-- nanaly:${kind}:${key} -->`))

export const SIGN = '\n\n<sub>—— 娜娜莉，住在这个博客里的猫。这条是自动发的。</sub>'
