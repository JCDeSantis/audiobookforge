import React from 'react'
import { useAppStore } from '../store/useAppStore'
import { WHISPER_MODELS } from '../lib/whisperModels'
import type { WhisperModel } from '../../../shared/types'

function StepIndicator({ current }: { current: 1 | 2 | 3 }): React.JSX.Element {
  const steps: Array<{ n: 1 | 2 | 3; label: string }> = [
    { n: 1, label: 'Source' },
    { n: 2, label: 'Settings' },
    { n: 3, label: 'Transcribe' }
  ]
  return (
    <div className="flex items-center gap-0">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center">
          {i > 0 && <div className="h-0.5 w-6 bg-[#2a0000]" />}
          <div
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-[11px] font-semibold ${
              s.n === current
                ? 'bg-[#dc2626] text-white'
                : s.n < current
                ? 'bg-[#3f0000] text-[#fca5a5]'
                : 'bg-[#1a0000] text-[#6b2222]'
            }`}
          >
            <span>{s.n}</span>
            <span>{s.label}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function SettingsPage(): React.JSX.Element {
  const { wizard, setWizardModel, setWizardOutputFolder, setWizardEpubPath, setWizardStep } =
    useAppStore()

  const isAbs = wizard.source === 'abs'

  const handlePickOutputFolder = async (): Promise<void> => {
    const folder = await window.electron.files.pickOutputFolder()
    if (folder) setWizardOutputFolder(folder)
  }

  const handlePickEpub = async (): Promise<void> => {
    const path = await window.electron.files.pickEpub()
    if (path) setWizardEpubPath(path)
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-5">
      <StepIndicator current={2} />

      <div className="text-[13px] font-semibold text-[#fef2f2]">Settings</div>

      {/* Model selector */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-semibold text-[#fca5a5]">Whisper Model</label>
        <select
          className="rounded border border-[#3f0000] bg-[#0d0000] px-3 py-2 text-[11px] text-[#fef2f2] focus:border-[#dc2626] focus:outline-none"
          value={wizard.model}
          onChange={(e) => setWizardModel(e.target.value as WhisperModel)}
        >
          {WHISPER_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.size}) — {m.description}
            </option>
          ))}
        </select>
      </div>

      {/* Output folder — local files only */}
      {!isAbs && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-[#fca5a5]">Output Folder</label>
          <div className="flex items-center gap-2">
            <div
              className="flex-1 truncate rounded border border-[#3f0000] bg-[#0d0000] px-3 py-2 text-[11px] text-[#6b2222] cursor-pointer hover:border-[#dc2626]"
              onClick={handlePickOutputFolder}
            >
              {wizard.outputFolder ?? 'Click to choose folder...'}
            </div>
          </div>
        </div>
      )}

      {/* EPUB */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-semibold text-[#fca5a5]">
          EPUB for Vocabulary
          {isAbs && wizard.absItem?.ebookPath && (
            <span className="ml-1 text-[#4ade80]"> (auto-linked from ABS)</span>
          )}
        </label>
        {isAbs && wizard.absItem?.ebookPath ? (
          <div className="rounded border border-[#3f0000] bg-[#0d0000] px-3 py-2 text-[11px] text-[#fca5a5]">
            {wizard.absItem.ebookPath.split(/[\\/]/).pop()}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div
              className="flex-1 truncate rounded border border-[#3f0000] bg-[#0d0000] px-3 py-2 text-[11px] text-[#6b2222] cursor-pointer hover:border-[#dc2626]"
              onClick={handlePickEpub}
            >
              {wizard.epubPath
                ? wizard.epubPath.split(/[\\/]/).pop()
                : 'Optional — click to import EPUB'}
            </div>
            {wizard.epubPath && (
              <button
                className="text-[10px] text-[#6b2222] hover:text-[#fca5a5]"
                onClick={() => setWizardEpubPath(null)}
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {/* Nav */}
      <div className="mt-auto flex justify-between">
        <button
          className="rounded border border-[#3f0000] px-4 py-1.5 text-[11px] font-semibold text-[#6b2222] hover:text-[#fca5a5] transition-colors"
          onClick={() => setWizardStep(1)}
        >
          ← Back
        </button>
        <button
          className="rounded bg-[#dc2626] px-4 py-1.5 text-[11px] font-semibold text-white hover:bg-[#b91c1c] transition-colors disabled:opacity-30"
          disabled={!isAbs && !wizard.outputFolder}
          onClick={() => setWizardStep(3)}
        >
          Next →
        </button>
      </div>
    </div>
  )
}
