import { bearer } from 'party-db/server'

async function digest(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
}

export async function isEditorToken(token: string, env: Env): Promise<boolean> {
  if (!env.EDITOR_TOKEN) return false
  const [a, b] = await Promise.all([digest(token), digest(env.EDITOR_TOKEN)])
  return crypto.subtle.timingSafeEqual(a, b)
}

export async function isEditorRequest(req: Request, env: Env): Promise<boolean> {
  const token = bearer(req)
  return token ? isEditorToken(token, env) : false
}
