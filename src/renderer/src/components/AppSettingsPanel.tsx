import React, { useState } from 'react'
import type { WhisperModel } from '../../../shared/types'
import { WHISPER_MODELS } from '../lib/whisperModels'
import { useAppStore } from '../store/useAppStore'

interface AppSettingsPanelProps {
  onClose: () => void
}

export function AppSettingsPanel({ onClose }: AppSettingsPanelProps): React.JSX.Element {
  const { settings, setSettings } = useAppStore()
  const [url, setUrl] = useState(settings.absUrl)
  const [apiKey, setApiKey] = useState('')
  const [defaultModel, setDefaultModel] = useState<WhisperModel>(settings.defaultModel)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [saving, setSaving] = useState(false)

  const handleTest = async (): Promise<void> => {
    if (!url || !apiKey) return

    setTesting(true)
    setTestResult('idle')
    try {
      const ok = await window.electron.abs.testConnection(url, apiKey)
      setTestResult(ok ? 'ok' : 'fail')
    } catch {
      setTestResult('fail')
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.electron.settings.setUrl(url)
      await window.electron.settings.setDefaultModel(defaultModel)
      if (apiKey) {
        await window.electron.settings.setApiKey(apiKey)
      }
      setSettings({ ...settings, absUrl: url, defaultModel })
      onClose()
    } catch (error) {
      console.error('Failed to save settings', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <div
        aria-labelledby="app-settings-title"
        aria-modal="true"
        className="w-full max-w-2xl rounded-[30px] border border-[#442020] bg-[linear-gradient(180deg,#150808_0%,#0d0404_100%)] shadow-[0_30px_90px_rgba(0,0,0,0.55)]"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#351616] px-6 py-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#b78787]">
              Workspace Defaults
            </div>
            <h2 id="app-settings-title" className="mt-3 text-2xl font-semibold text-[#fff4f4]">
              Settings
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-[#d9b7b7]">
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

        <div className="grid gap-5 px-6 py-6">
          <label className="grid gap-2">
            <span className="text-sm font-medium text-[#f6e2e2]">ABS Server URL</span>
            <input
              className="rounded-[18px] border border-[#482020] bg-[#170909] px-4 py-3 text-sm text-[#fff4f4] outline-none transition-colors placeholder:text-[#8c5d5d] focus:border-[#dc2626]"
              onChange={(event) => {
                setUrl(event.target.value)
                setTestResult('idle')
              }}
              placeholder="http://192.168.1.50:13378"
              value={url}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-[#f6e2e2]">API Key</span>
            <input
              className="rounded-[18px] border border-[#482020] bg-[#170909] px-4 py-3 text-sm text-[#fff4f4] outline-none transition-colors placeholder:text-[#8c5d5d] focus:border-[#dc2626]"
              onChange={(event) => {
                setApiKey(event.target.value)
                setTestResult('idle')
              }}
              placeholder="Enter API key (leave blank to keep existing)"
              type="password"
              value={apiKey}
            />
            <span className="text-xs leading-5 text-[#a87f7f]">
              Saved through the OS credential store. It is not written to disk as plaintext.
            </span>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-[#f6e2e2]">Default Whisper Model</span>
            <select
              className="rounded-[18px] border border-[#482020] bg-[#170909] px-4 py-3 text-sm text-[#fff4f4] outline-none transition-colors focus:border-[#dc2626]"
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

          <div className="rounded-[22px] border border-[#341616] bg-[#120707] px-4 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="rounded-full border border-[#5b2626] px-4 py-2 text-sm font-medium text-[#f0cbcb] transition-colors hover:border-[#dc2626] hover:text-[#fff4f4] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={testing || !url || !apiKey}
                onClick={handleTest}
                type="button"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              {testResult === 'ok' && (
                <span className="text-sm text-[#9fe0bb]">Connected successfully</span>
              )}
              {testResult === 'fail' && (
                <span className="text-sm text-[#ff9f9f]">
                  Connection failed. Check the URL and key.
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-[#351616] px-6 py-5">
          <button
            className="rounded-full border border-[#482020] px-5 py-2.5 text-sm font-medium text-[#e3bebe] transition-colors hover:border-[#dc2626] hover:text-[#fff4f4]"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-full bg-[#dc2626] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(220,38,38,0.24)] transition-colors hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:bg-[#5f1d1d] disabled:text-[#e2b8b8]"
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
