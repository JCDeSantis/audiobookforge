import React, { useEffect, useState } from 'react'
import { getWebAppClient } from '../lib/appClient'

export function WebAuthGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<'checking' | 'login' | 'authenticated'>('checking')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    void getWebAppClient()
      .restoreSession()
      .then((authenticated) => setStatus(authenticated ? 'authenticated' : 'login'))
      .catch(() => setStatus('login'))
  }, [])

  const login = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await getWebAppClient().login(password)
      setPassword('')
      setStatus('authenticated')
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Login failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'authenticated') return <>{children}</>
  if (status === 'checking') {
    return <div className="flex h-dvh items-center justify-center bg-[#070202] text-[#d9b7b7]">Loading Audiobook Forge…</div>
  }

  return (
    <main className="flex h-dvh items-center justify-center bg-[#070202] p-4">
      <form
        className="w-full max-w-sm rounded-[24px] border border-[#442020] bg-[#120707] p-6 shadow-2xl"
        onSubmit={(event) => void login(event)}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#b78787]">
          Audiobook Forge Web
        </div>
        <h1 className="mt-2 text-xl font-semibold text-[#fff4f4]">Sign in</h1>
        <p className="mt-2 text-sm text-[#b99191]">Enter the password configured for this container.</p>
        <label className="mt-5 grid gap-2 text-sm text-[#f6e2e2]">
          Password
          <input
            autoFocus
            className="h-11 rounded-[14px] border border-[#482020] bg-[#170909] px-3 text-[#fff4f4] outline-none focus:border-[#dc2626]"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </label>
        <div className="mt-3 min-h-5 text-xs text-[#ff9f9f]" role="alert">{error}</div>
        <button
          className="mt-3 h-10 w-full rounded-full bg-[#dc2626] text-sm font-semibold text-white disabled:opacity-50"
          disabled={submitting || password.length === 0}
          type="submit"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
