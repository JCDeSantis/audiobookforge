import React from 'react'
import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { WHISPER_MODELS } from '../lib/whisperModels'
import type { WhisperModel } from '../../../shared/types'

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
    } catch (e) {
      console.error('Failed to save settings', e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-[420px] rounded-xl border border-[#2a0000] bg-[#0a0000] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2a0000] px-4 py-3">
          <span className="text-[13px] font-semibold text-[#fef2f2]">
            ABS Connection Settings
          </span>
          <button
            className="text-[11px] text-[#6b2222] hover:text-[#fca5a5]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <div className="flex flex-col gap-4 px-4 py-4">
          {/* ABS URL */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-[#fca5a5]">ABS Server URL</label>
            <input
              className="rounded border border-[#3f0000] bg-[#0d0000] px-3 py-2 text-[11px] text-[#fef2f2] placeholder-[#3f0000] focus:border-[#dc2626] focus:outline-none"
              placeholder="http://192.168.1.50:13378"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setTestResult('idle')
              }}
            />
          </div>

          {/* API Key */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-[#fca5a5]">API Key</label>
            <input
              className="rounded border border-[#3f0000] bg-[#0d0000] px-3 py-2 text-[11px] text-[#fef2f2] placeholder-[#3f0000] focus:border-[#dc2626] focus:outline-none"
              type="password"
              placeholder="Enter API key (leave blank to keep existing)"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value)
                setTestResult('idle')
              }}
            />
            <span className="text-[10px] text-[#6b2222]">
              Stored securely in OS credential store (never written to disk as plaintext)
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-[#fca5a5]">Default Whisper Model</label>
            <select
              className="rounded border border-[#3f0000] bg-[#0d0000] px-3 py-2 text-[11px] text-[#fef2f2] focus:border-[#dc2626] focus:outline-none"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value as WhisperModel)}
            >
              {WHISPER_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.size})
                </option>
              ))}
            </select>
          </div>

          {/* Test connection */}
          <div className="flex items-center gap-3">
            <button
              className="rounded border border-[#3f0000] px-3 py-1.5 text-[11px] font-semibold text-[#fca5a5] hover:border-[#dc2626] transition-colors disabled:opacity-40"
              disabled={testing || !url || !apiKey}
              onClick={handleTest}
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            {testResult === 'ok' && (
              <span className="text-[11px] text-[#4ade80]">✓ Connected</span>
            )}
            {testResult === 'fail' && (
              <span className="text-[11px] text-[#dc2626]">✗ Failed — check URL and key</span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-[#2a0000] px-4 py-3">
          <button
            className="rounded border border-[#3f0000] px-4 py-1.5 text-[11px] text-[#6b2222] hover:text-[#fca5a5] transition-colors"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded bg-[#dc2626] px-4 py-1.5 text-[11px] font-semibold text-white hover:bg-[#b91c1c] transition-colors disabled:opacity-40"
            disabled={saving || !url}
            onClick={handleSave}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
