import { getServerByName, routePartykitRequest } from 'partyserver'
import { commentInputSchema, submissionInputSchema } from '../shared/schema.ts'
import { isEditorRequest } from './editor.ts'
import { searchNews } from './news.ts'
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

async function handleSubmission(req: Request, env: Env): Promise<Response> {
  const body = await readerPost(req, env)
  if (body instanceof Response) return body
  const parsed = submissionInputSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return Response.json({ error: `${first.path.join('.')}: ${first.message}` }, { status: 400 })
  }
  const result = await (await tracker(env)).submit(parsed.data, 'public')
  return result.ok
    ? Response.json({ ok: true, duplicate: result.duplicate })
    : Response.json({ error: result.error }, { status: result.status })
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    if (url.pathname === '/api/submissions' && req.method === 'POST') return handleSubmission(req, env)
    if (url.pathname === '/api/comments' && req.method === 'POST') return handleComment(req, env)
    if (url.pathname === '/api/editor/session') {
      return (await isEditorRequest(req, env)) ? Response.json({ ok: true }) : new Response('unauthorized', { status: 401 })
    }
    if (url.pathname === '/api/editor/news-search' && req.method === 'POST') {
      if (!(await isEditorRequest(req, env))) return new Response('unauthorized', { status: 401 })
      return Response.json(await searchNews(env, await tracker(env)))
    }
    return (await routePartykitRequest(req, env)) ?? new Response('not found', { status: 404 })
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(searchNews(env, await tracker(env)).then((report) => console.log('news search', report)))
  },
} satisfies ExportedHandler<Env>
