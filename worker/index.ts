import { getServerByName, routePartykitRequest } from 'partyserver'
import { commentInputSchema, proposalInputSchema } from '../shared/schema.ts'
import { isEditorRequest } from './editor.ts'
import { atomResponse } from './feed.ts'
import { dryRunArticle, queueIsAttended, searchNews } from './news.ts'
import type { Tracker } from './tracker.ts'

export { Tracker } from './tracker.ts'

export const ROOM = 'main'

const tracker = (env: Env) => getServerByName<Env, Tracker>(env.Tracker, ROOM)

// Shared front door for anything an anonymous reader can post.
async function readerPost(req: Request, env: Env): Promise<Record<string, unknown> | Response> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown'
  if (!(await env.POST_LIMITER.limit({ key: ip })).success) {
    return Response.json({ error: 'That is a lot of posts in a short time. Give it a minute.' }, { status: 429 })
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return Response.json({ error: 'Expected a JSON body.' }, { status: 400 })
  // Honeypot: the form hides this field, so only a bot fills it in. Pretend it worked.
  if (body.website) return Response.json({ ok: true })
  return body
}

async function handleComment(req: Request, env: Env): Promise<Response> {
  const body = await readerPost(req, env)
  if (body instanceof Response) return body
  const parsed = commentInputSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return Response.json({ error: `${first.path.join('.')}: ${first.message}` }, { status: 400 })
  }
  const result = await (await tracker(env)).comment(parsed.data)
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: result.error }, { status: result.status })
}

async function handleProposal(req: Request, env: Env): Promise<Response> {
  const body = await readerPost(req, env)
  if (body instanceof Response) return body
  const parsed = proposalInputSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return Response.json({ error: `${first.path.join('.')}: ${first.message}` }, { status: 400 })
  }
  const { source_url, source_title, submitter_note, ...item } = parsed.data
  const result = await (await tracker(env)).propose({ source: { url: source_url, title: source_title }, note: submitter_note, items: [item] }, 'reader')
  return result.ok
    ? Response.json({ ok: true, duplicate: result.queued === 0 })
    : Response.json({ error: result.error }, { status: result.status })
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    if (url.pathname === '/feed.xml' && req.method === 'GET') return atomResponse(req, env)
    if (url.pathname === '/api/proposals' && req.method === 'POST') return handleProposal(req, env)
    if (url.pathname === '/api/comments' && req.method === 'POST') return handleComment(req, env)
    if (url.pathname === '/api/editor/session') {
      return (await isEditorRequest(req, env)) ? Response.json({ ok: true }) : new Response('unauthorized', { status: 401 })
    }
    if (url.pathname === '/api/editor/news-search' && req.method === 'POST') {
      if (!(await isEditorRequest(req, env))) return new Response('unauthorized', { status: 401 })
      return Response.json(await searchNews(env, await tracker(env)))
    }
    if (url.pathname === '/api/editor/read-article' && req.method === 'POST') {
      if (!(await isEditorRequest(req, env))) return new Response('unauthorized', { status: 401 })
      const body = (await req.json().catch(() => null)) as { url?: unknown; question_id?: unknown } | null
      const target = typeof body?.url === 'string' && /^https?:\/\//.test(body.url) ? body.url : null
      if (!target || typeof body?.question_id !== 'string') return Response.json({ error: 'Expected a url and a question_id.' }, { status: 400 })
      const result = await dryRunArticle(env, target, body.question_id)
      return Response.json(result, { status: 'error' in result ? 404 : 200 })
    }
    return (await routePartykitRequest(req, env)) ?? new Response('not found', { status: 404 })
  },

  // Awaited, not left to waitUntil: a run reads articles for minutes, and
  // waitUntil only promises a short time after the handler returns.
  async scheduled(controller, env) {
    const now = new Date(controller.scheduledTime)
    if (!(await queueIsAttended(env.DB, now))) return console.log('news search skipped: earlier leads are waiting and none was reviewed in the last day')
    console.log('news search', await searchNews(env, await tracker(env), now))
  },
} satisfies ExportedHandler<Env>
