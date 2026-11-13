const KEY = 'decidering.editor-token'

export function editorToken(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined
  } catch {
    return undefined
  }
}

export const isEditor = () => editorToken() !== undefined

// The sync socket reads the token once, when it connects, so signing in or out
// reloads the page to reconnect as the new identity.
export async function signIn(token: string): Promise<boolean> {
  const res = await fetch('/api/editor/session', { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) return false
  localStorage.setItem(KEY, token)
  window.location.reload()
  return true
}

export function signOut() {
  localStorage.removeItem(KEY)
  window.location.reload()
}

export function editorFetch(path: string, init: RequestInit = {}) {
  return fetch(path, { ...init, headers: { ...init.headers, authorization: `Bearer ${editorToken()}` } })
}
