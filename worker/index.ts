import { getServerByName, routePartykitRequest } from 'partyserver'
import { submissionInputSchema } from '../shared/schema.ts'
import { isEditorRequest } from './editor.ts'
import { searchNews } from './news.ts'
import type { Tracker } from './tracker.ts'

export { Tracker } from './tracker.ts'

export const ROOM = 'main'

const tracker = (env: Env) => getServerByName<Env, Tracker>(env.Tracker, ROOM)

async function handleSubmission(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return Response.json({ error: 'Expected a JSON body.' }, { status: 400 })
  // Honeypot: the form hides this field, so only a bot fills it in. Pretend it worked.
  if (body.website) return Response.json({ ok: true })
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
