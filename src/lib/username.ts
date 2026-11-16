const KEY = 'decidering.comment-name'

export function savedUsername(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveUsername(name: string) {
  try {
    localStorage.setItem(KEY, name)
  } catch {}
}
