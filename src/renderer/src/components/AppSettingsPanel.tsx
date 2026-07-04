import React, { useEffect, useState } from 'react'
import type {
  ComputePreference,
  WhisperModel,
  WhisperStorageInfo
} from '../../../shared/types'
import { validateAbsUrl } from '../../../shared/urlSafety'
import { getAppClient } from '../lib/appClient'
import { WHISPER_MODELS } from '../lib/whisperModels'
import { useAppStore } from '../store/useAppStore'

interface AppSettingsPanelProps {
  onClose: () => void
}

export function AppSettingsPanel({ onClose }: AppSettingsPanelProps): React.JSX.Element {
  const { settings, setSettings } = useAppStore()
  const [url, setUrl] = useState(settings.absUrl)
  const [username, setUsername] = useState(settings.absUsername ?? '')
  const [password, setPassword] = useState('')
  const [defaultModel, setDefaultModel] = useState<WhisperModel>(settings.defaultModel)
  const [computePreference, setComputePreference] = useState<ComputePreference>(
    settings.computePreference ?? 'automatic'
  )
  const [signingIn, setSigningIn] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [loginResult, setLoginResult] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [storageInfo, setStorageInfo] = useState<WhisperStorageInfo | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [clearingModels, setClearingModels] = useState(false)
  const [deletingModel, setDeletingModel] = useState<WhisperModel | null>(null)
  const [clearResult, setClearResult] = useState<string | null>(null)
  const [diagnosticsResult, setDiagnosticsResult] = useState<string | null>(null)
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null)
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false)

  useEffect(() => {
    let isActive = true

    const loadStorageInfo = async (): Promise<void> => {
      try {
        const info = await getAppClient().whisper.getStorageInfo()
        if (!isActive) {
          return
        }
        setStorageInfo(info)
        setStorageError(null)
      } catch (error) {
        if (!isActive) {
          return
        }
        setStorageError(
          error instanceof Error ? error.message : 'Failed to load Whisper storage details.'
        )
      }
    }

    void loadStorageInfo()

    return () => {
      isActive = false
    }
  }, [])

  const installedModelCount = storageInfo?.models.filter((model) => model.downloaded).length ?? 0

  const validateCurrentUrl = (): string | null => {
    const validation = validateAbsUrl(url)
    return validation.ok ? null : validation.error
  }

  const handleClearModels = async (): Promise<void> => {
    if (installedModelCount === 0 || clearingModels) {
      return
    }

    const confirmed = window.confirm(
      'Remove all downloaded Whisper model files from this computer? They will be downloaded again when needed.'
    )
    if (!confirmed) {
      return
    }

    setClearingModels(true)
    setStorageError(null)
    setClearResult(null)

    try {
      await getAppClient().whisper.clearModels()
      const updatedInfo = await getAppClient().whisper.getStorageInfo()
      setStorageInfo(updatedInfo)
      setClearResult('Downloaded Whisper models cleared.')
    } catch (error) {
      setStorageError(
        error instanceof Error ? error.message : 'Failed to clear installed Whisper models.'
      )
    } finally {
      setClearingModels(false)
    }
  }

  const refreshStorageInfo = async (): Promise<void> => {
    const updatedInfo = await getAppClient().whisper.getStorageInfo()
    setStorageInfo(updatedInfo)
  }

  const handleDeleteModel = async (model: WhisperModel): Promise<void> => {
    setDeletingModel(model)
    setStorageError(null)
    setClearResult(null)

    try {
      await getAppClient().whisper.deleteModel(model)
      await refreshStorageInfo()
      setClearResult('Whisper model removed.')
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Failed to remove Whisper model.')
    } finally {
      setDeletingModel(null)
    }
  }

  const handleExportDiagnostics = async (): Promise<void> => {
    setExportingDiagnostics(true)
    setDiagnosticsResult(null)
    setDiagnosticsError(null)

    try {
      const exportedPath = await getAppClient().diagnostics.export()
      if (exportedPath) {
        setDiagnosticsResult(`Diagnostics exported to ${exportedPath}`)
      }
    } catch (error) {
      setDiagnosticsError(error instanceof Error ? error.message : 'Failed to export diagnostics.')
    } finally {
      setExportingDiagnostics(false)
    }
  }

  const handleSignIn = async (): Promise<void> => {
    if (!url || !username) return

    const urlError = validateCurrentUrl()
    if (urlError) {
      setFormError(urlError)
      return
    }

    setSigningIn(true)
    setFormError(null)
    setLoginResult(null)
    try {
      const result = await getAppClient().abs.login(url, username, password)
      const validation = validateAbsUrl(url)
      if (!validation.ok) return
      setUsername(result.username)
      setPassword('')
      setLoginResult(
        `Signed in as ${result.username} on Audiobookshelf ${result.serverVersion}.${
          result.connectionWarning ? ` ${result.connectionWarning}` : ''
        }`
      )
      setSettings({
        ...settings,
        absUrl: validation.normalizedUrl,
        absUsername: result.username,
        defaultModel,
        computePreference
      })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Audiobookshelf login failed.')
    } finally {
      setSigningIn(false)
    }
  }

  const handleSignOut = async (): Promise<void> => {
    setSigningOut(true)
    setFormError(null)
    try {
      await getAppClient().abs.logout()
      setUsername('')
      setPassword('')
      setLoginResult('Signed out of Audiobookshelf.')
      setSettings({ ...settings, absUsername: '' })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to sign out.')
    } finally {
      setSigningOut(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    const validation = validateAbsUrl(url)
    if (!validation.ok) {
      setFormError(validation.error)
      return
    }

    setSaving(true)
    setFormError(null)
    try {
      await getAppClient().settings.setUrl(validation.normalizedUrl)
      await getAppClient().settings.setDefaultModel(defaultModel)
      await getAppClient().settings.setComputePreference(computePreference)
      setSettings({
        ...settings,
        absUrl: validation.normalizedUrl,
        defaultModel,
        computePreference
      })
      onClose()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div
        aria-labelledby="app-settings-title"
        aria-modal="true"
        className="flex h-[min(680px,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-[#442020] bg-[linear-gradient(180deg,#150808_0%,#0d0404_100%)] shadow-[0_30px_90px_rgba(0,0,0,0.55)]"
        role="dialog"
      >
        <div className="flex flex-none items-start justify-between gap-4 border-b border-[#351616] px-5 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#b78787]">
              Workspace Defaults
            </div>
            <h2 id="app-settings-title" className="mt-2 text-xl font-semibold text-[#fff4f4]">
              Settings
            </h2>
            <p className="mt-1 max-w-lg text-xs leading-5 text-[#d9b7b7]">
              Keep AudioBookShelf access and the default whisper model together in one place for
              every new draft.
            </p>
          </div>
          <button
            aria-label="Close Settings"
            className="rounded-full border border-[#4b2222] px-3 py-1.5 text-sm text-[#f0d0d0] transition-colors hover:border-[#dc2626] hover:text-[#fff4f4]"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 rounded-lg border border-[#341616] bg-[#120707] px-4 py-3.5">
            <div>
              <div className="text-sm font-medium text-[#f6e2e2]">Audiobookshelf Login</div>
              <div className="mt-1 text-xs leading-5 text-[#a87f7f]">
                Connect with the same account you use in Audiobookshelf.
              </div>
            </div>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-[#f6e2e2]">ABS Server URL</span>
              <input
                className="h-10 rounded-[14px] border border-[#482020] bg-[#170909] px-3 text-sm text-[#fff4f4] outline-none transition-colors placeholder:text-[#8c5d5d] focus:border-[#dc2626]"
                onChange={(event) => {
                  setUrl(event.target.value)
                  setFormError(null)
                  setLoginResult(null)
                }}
                placeholder="https://abs.example.com"
                value={url}
              />
              <span className="text-xs leading-5 text-[#a87f7f]">
                Public servers require HTTPS. Private-network HTTP is allowed with a security warning.
              </span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-[#f6e2e2]">Audiobookshelf Username</span>
                <input
                  autoComplete="username"
                  className="h-10 min-w-0 rounded-[14px] border border-[#482020] bg-[#170909] px-3 text-sm text-[#fff4f4] outline-none transition-colors placeholder:text-[#8c5d5d] focus:border-[#dc2626]"
                  onChange={(event) => {
                    setUsername(event.target.value)
                    setFormError(null)
                    setLoginResult(null)
                  }}
                  placeholder="Audiobookshelf username"
                  value={username}
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-[#f6e2e2]">Password</span>
                <input
                  autoComplete="current-password"
                  className="h-10 min-w-0 rounded-[14px] border border-[#482020] bg-[#170909] px-3 text-sm text-[#fff4f4] outline-none transition-colors placeholder:text-[#8c5d5d] focus:border-[#dc2626]"
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setFormError(null)
                    setLoginResult(null)
                  }}
                  placeholder="Audiobookshelf password"
                  type="password"
                  value={password}
                />
              </label>
            </div>

            <div className="stable-clamp-2 h-10 text-xs leading-5 text-[#a87f7f]">
              Your password is sent once to your server and never stored. The returned session is
              kept in the OS credential store.
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                className="h-9 rounded-full border border-[#5b2626] px-4 text-sm font-medium text-[#f0cbcb] transition-colors hover:border-[#dc2626] hover:text-[#fff4f4] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={signingIn || !url || !username}
                onClick={handleSignIn}
                type="button"
              >
                {signingIn ? 'Signing In...' : 'Sign In'}
              </button>
              {(settings.absUsername || loginResult?.startsWith('Signed in')) && (
                <button
                  className="h-9 rounded-full border border-[#482020] px-4 text-sm font-medium text-[#e3bebe] transition-colors hover:border-[#dc2626] disabled:opacity-50"
                  disabled={signingOut}
                  onClick={handleSignOut}
                  type="button"
                >
                  {signingOut ? 'Signing Out...' : 'Sign Out'}
                </button>
              )}
            </div>

            <div
              className={`stable-feedback truncate text-xs leading-5 ${formError ? 'text-[#ff9f9f]' : 'text-[#9fe0bb]'}`}
              role={formError ? 'alert' : 'status'}
              title={formError ?? loginResult ?? undefined}
            >
              {formError ?? loginResult ?? '\u00A0'}
            </div>
          </div>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-[#f6e2e2]">Default Whisper Model</span>
            <select
              className="h-10 rounded-[14px] border border-[#482020] bg-[#170909] px-3 text-sm text-[#fff4f4] outline-none transition-colors focus:border-[#dc2626]"
              onChange={(event) => setDefaultModel(event.target.value as WhisperModel)}
              value={defaultModel}
            >
              {WHISPER_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.size})
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-[#f6e2e2]">Compute Backend</span>
            <select
              className="h-10 rounded-[14px] border border-[#482020] bg-[#170909] px-3 text-sm text-[#fff4f4] outline-none transition-colors focus:border-[#dc2626]"
              onChange={(event) =>
                setComputePreference(event.target.value as ComputePreference)
              }
              value={computePreference}
            >
              <option value="automatic">Automatic (CUDA with CPU fallback)</option>
              <option value="cpu">Force CPU</option>
            </select>
          </label>

          <div className="rounded-lg border border-[#341616] bg-[#120707] px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-lg">
                <div className="text-sm font-medium text-[#f6e2e2]">Whisper Storage</div>
                <div className="mt-1 text-sm leading-6 text-[#d9b7b7]">
                  {storageInfo ? (
                    <>
                      {installedModelCount === 0
                        ? 'No Whisper models are currently installed.'
                        : `${installedModelCount} Whisper model${installedModelCount === 1 ? '' : 's'} installed.`}
                    </>
                  ) : (
                    'Checking installed Whisper models...'
                  )}
                </div>
                <div className="mt-1 text-xs leading-5 text-[#a87f7f]">
                  Clears model files only. The Whisper binary stays installed.
                </div>
              </div>

              <button
                className="rounded-md border border-[#5b2626] px-4 py-2 text-sm font-medium text-[#f0cbcb] transition-colors hover:border-[#dc2626] hover:text-[#fff4f4] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={clearingModels || installedModelCount === 0}
                onClick={handleClearModels}
                type="button"
              >
                {clearingModels ? 'Clearing...' : 'Clear Installed Models'}
              </button>
            </div>

            {storageInfo && (
              <div className="mt-4 grid gap-2">
                {storageInfo.models.map((model) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#281313] bg-[#0b0404] px-3 py-2 text-xs"
                    key={model.id}
                  >
                    <div>
                      <div className="font-medium text-[#f4dddd]">{model.name}</div>
                      <div className="text-[#a87f7f]">
                        {model.downloaded
                          ? `${(model.diskBytes / 1024 / 1024).toFixed(1)} MB installed`
                          : `${model.size} not installed`}
                      </div>
                    </div>
                    <button
                      className="rounded-md border border-[#3f1d1d] px-2.5 py-1 text-[#e6bbbb] transition-colors hover:border-[#dc2626] disabled:opacity-40"
                      disabled={!model.downloaded || deletingModel === model.id}
                      onClick={() => handleDeleteModel(model.id)}
                      type="button"
                    >
                      {deletingModel === model.id ? 'Removing...' : 'Delete'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div
              className={`stable-feedback mt-3 truncate text-xs leading-5 ${storageError ? 'text-[#ff9f9f]' : 'text-[#9fe0bb]'}`}
              role={storageError ? 'alert' : 'status'}
              title={storageError ?? clearResult ?? undefined}
            >
              {storageError ?? clearResult ?? '\u00A0'}
            </div>
          </div>

          <div className="rounded-lg border border-[#341616] bg-[#120707] px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-[#f6e2e2]">Diagnostics</div>
                <div className="mt-1 text-xs leading-5 text-[#a87f7f]">
                  Exports sanitized app, system, queue, and model details for troubleshooting.
                </div>
              </div>
              <button
                className="rounded-md border border-[#5b2626] px-4 py-2 text-sm font-medium text-[#f0cbcb] transition-colors hover:border-[#dc2626] hover:text-[#fff4f4] disabled:opacity-50"
                disabled={exportingDiagnostics}
                onClick={handleExportDiagnostics}
                type="button"
              >
                {exportingDiagnostics ? 'Exporting...' : 'Export Diagnostics'}
              </button>
            </div>
            <div
              className={`stable-feedback mt-3 truncate text-xs leading-5 ${diagnosticsError ? 'text-[#ff9f9f]' : 'text-[#9fe0bb]'}`}
              role={diagnosticsError ? 'alert' : 'status'}
              title={diagnosticsError ?? diagnosticsResult ?? undefined}
            >
              {diagnosticsError ?? diagnosticsResult ?? '\u00A0'}
            </div>
          </div>
        </div>

        <div className="flex h-[4.5rem] flex-none items-center justify-end gap-3 border-t border-[#351616] px-5">
          <button
            className="h-9 rounded-full border border-[#482020] px-5 text-sm font-medium text-[#e3bebe] transition-colors hover:border-[#dc2626] hover:text-[#fff4f4]"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-9 rounded-full bg-[#dc2626] px-5 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(220,38,38,0.22)] transition-colors hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:bg-[#5f1d1d] disabled:text-[#e2b8b8]"
            disabled={saving || !url}
            onClick={handleSave}
            type="button"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
