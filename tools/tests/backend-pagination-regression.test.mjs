import assert from 'node:assert/strict'

process.env.GITHUB_TOKEN = 'offline-test-token'
const { listDiscussions, gql } = await import('../nanaly/github.mjs')
const originalFetch = globalThis.fetch
const calls = []
const response = data => ({ ok: true, status: 200, json: async () => ({ data }) })
try {
  globalThis.fetch = async (url, init) => {
    const { query, variables } = JSON.parse(init.body)
    calls.push({ query, variables })
    if (query.includes('repository(owner:')) {
      if (variables.after === 'discussion-next') return response({ repository: { discussions: {
        nodes: [{ id: 'd2', title: '2026/09/18/second/' }], pageInfo: { hasNextPage: false }
      } } })
      return response({ repository: { discussions: {
        nodes: [{ id: 'd1', title: '2026/09/19/first/',
          comments: { nodes: [{ id: 'new', body: 'new question', replies: {
            nodes: [{ id: 'reply-new', body: 'another reader' }],
            pageInfo: { hasPreviousPage: true, startCursor: 'reply-previous' }
          } }], pageInfo: { hasPreviousPage: true, startCursor: 'comment-previous' } },
          reactions: { nodes: [{ id: 'reaction-1', user: { login: 'reader' } }],
            pageInfo: { hasNextPage: true, endCursor: 'reaction-next' } }
        }], pageInfo: { hasNextPage: true, endCursor: 'discussion-next' }
      } } })
    }
    if (variables.before === 'comment-previous') return response({ node: { comments: {
      nodes: [{ id: 'old', body: '<!-- nanaly:patrol:already-reported -->', replies: { nodes: [] } }],
      pageInfo: { hasPreviousPage: false }
    } } })
    if (variables.before === 'reply-previous') return response({ node: { replies: {
      nodes: [{ id: 'reply-old', body: '<!-- nanaly:reply:new -->', author: { login: 'nanaly' } }],
      pageInfo: { hasPreviousPage: false }
    } } })
    if (variables.after === 'reaction-next') return response({ node: { reactions: {
      nodes: [{ id: 'reaction-2', user: { login: 'nanaly' } }], pageInfo: { hasNextPage: false }
    } } })
    throw new Error('Unexpected request: ' + JSON.stringify(variables))
  }
  const result = await listDiscussions()
  assert.equal(result.length, 2)
  assert.deepEqual(result[0].comments.nodes.map(c => c.id), ['old', 'new'])
  assert.deepEqual(result[0].comments.nodes[1].replies.nodes.map(c => c.id), ['reply-old', 'reply-new'])
  assert.equal(result[0].reactions.nodes[1].user.login, 'nanaly')
  assert.equal(calls.length, 5)
  console.log('  ✓ discussion, comment, reply and reaction cursors retain complete history')

  globalThis.fetch = async () => response({ repository: { discussions: { nodes: [], pageInfo: { hasNextPage: true } } } })
  await assert.rejects(listDiscussions, /分页游标无效/)
  console.log('  ✓ missing cursor fails visibly instead of returning truncated history')

  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ data: { partial: true } }) })
  await assert.rejects(() => gql('query{}'), /HTTP 503/)
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => null })
  await assert.rejects(() => gql('query{}'), /HTTP 200/)
  console.log('  ✓ HTTP errors and null API responses cannot look like successful requests')
} finally {
  globalThis.fetch = originalFetch
}
