import { useState, type FormEvent } from 'react'
import { useLocation } from '@tanstack/react-router'
import { SIGN_IN_CODE_MINUTES } from '../../shared/schema.ts'
import { authClient, useSignedIn } from '../lib/auth.ts'
import { Modal } from './Modal.tsx'

type Step = { at: 'email' } | { at: 'code'; email: string }

export function SignIn({ className }: { className: string }) {
  const { signedIn, person, isPending } = useSignedIn()
  // The editor page has its own sign-in, with the editor token, until editors sign in as people (#24).
  const onEditorPage = useLocation({ select: (l) => l.pathname.startsWith('/editor') })
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>({ at: 'email' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function close() {
    setOpen(false)
    setStep({ at: 'email' })
    setError(null)
  }

  async function sendCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const email = (new FormData(e.currentTarget).get('email') as string).trim()
    setBusy(true)
    setError(null)
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
    setBusy(false)
    if (error) return setError(error.status === 429 ? 'That is a lot of codes in a short time. Give it a minute.' : (error.message ?? 'The code could not be sent.'))
    setStep({ at: 'code', email })
  }

  async function checkCode(e: FormEvent<HTMLFormElement>, email: string) {
    e.preventDefault()
    const otp = (new FormData(e.currentTarget).get('code') as string).trim()
    setBusy(true)
    setError(null)
    const { error } = await authClient.signIn.emailOtp({ email, otp })
    setBusy(false)
    if (error) return setError(error.code === 'TOO_MANY_ATTEMPTS' ? 'Too many wrong tries. Ask for a new code.' : 'That code did not work. Check it, or ask for a new one.')
    close()
  }

  if (isPending || onEditorPage) return null
  if (signedIn) {
    return (
      <span className="flex items-center gap-2 text-sm font-semibold">
        <span>{person?.display_name ?? 'Signed in'}</span>
        <button type="button" className="underline underline-offset-2 hover:text-accent" onClick={() => void authClient.signOut()}>
          Sign out
        </button>
      </span>
    )
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        Sign in
      </button>
      <Modal
        open={open}
        onClose={close}
        title="Sign in"
        description="We email you a code. Your email address is never shown to anyone; others see the name you post under."
      >
        {step.at === 'email' ? (
          <form onSubmit={sendCode} className="space-y-4">
            <div>
              <label className="label" htmlFor="sign-in-email">
                Email address
              </label>
              <input id="sign-in-email" name="email" type="email" required autoComplete="email" className="field" />
            </div>
            {error && <p className="text-sm text-oppose">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Sending…' : 'Email me a code'}
              </button>
              <button type="button" className="btn" onClick={close}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={(e) => void checkCode(e, step.email)} className="space-y-4">
            <p className="text-sm">
              We sent a code to <span className="font-semibold">{step.email}</span>. It works once, for {SIGN_IN_CODE_MINUTES} minutes.
            </p>
            <div>
              <label className="label" htmlFor="sign-in-code">
                Code
              </label>
              <input id="sign-in-code" name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} className="field" />
            </div>
            {error && <p className="text-sm text-oppose">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Checking…' : 'Sign in'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setStep({ at: 'email' })
                  setError(null)
                }}
              >
                Use another address
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
