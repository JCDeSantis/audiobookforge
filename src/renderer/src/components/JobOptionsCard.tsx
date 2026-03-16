import React from 'react'
import { useAppStore } from '../store/useAppStore'
import { WHISPER_MODELS } from '../lib/whisperModels'
import type { WhisperModel } from '../../../shared/types'

function fileNameFromPath(path: string | null): string {
  if (!path) return 'None'
  return path.split(/[\\/]/).pop() ?? path
}

export function JobOptionsCard(): React.JSX.Element {
  const { wizard, setWizardModel, setWizardOutputFolder, setWizardEpubPath } = useAppStore()
  const isAbs = wizard.source === 'abs'

  const handlePickOutputFolder = async (): Promise<void> => {
    const folder = await window.electron.files.pickOutputFolder()
    if (folder) {
      setWizardOutputFolder(folder)
    }
  }

  const handlePickEpub = async (): Promise<void> => {
    const path = await window.electron.files.pickEpub()
    if (path) {
      setWizardEpubPath(path)
    }
  }

  const linkedEpub = isAbs && wizard.absItem?.ebookPath ? wizard.absItem.ebookPath : null

  return (
    <section className="rounded-[28px] border border-[#341414] bg-[#120707] p-5 shadow-[0_20px_40px_rgba(0,0,0,0.25)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ae8181]">
        Processing Options
      </div>

      <div className="mt-4 space-y-4">
        <label className="block">
          <div className="mb-2 text-sm font-medium text-[#f9e7e7]">Whisper Model</div>
          <select
            className="w-full rounded-[18px] border border-[#4a1d1d] bg-[#1a0909] px-4 py-3 text-sm text-[#fff3f3] outline-none transition-colors focus:border-[#dc2626]"
            value={wizard.model}
            onChange={(event) => setWizardModel(event.target.value as WhisperModel)}
          >
            {WHISPER_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} · {model.size}
              </option>
            ))}
          </select>
        </label>

        {wizard.source === 'local' && (
          <div>
            <div className="mb-2 text-sm font-medium text-[#f9e7e7]">Output Folder</div>
            <button
              className="flex w-full items-center justify-between rounded-[18px] border border-[#4a1d1d] bg-[#1a0909] px-4 py-3 text-left text-sm text-[#f0d4d4] transition-colors hover:border-[#dc2626]"
              onClick={handlePickOutputFolder}
            >
              <span>{wizard.outputFolder ?? 'Choose where subtitle files will be saved'}</span>
              <span className="text-[#dc2626]">Browse</span>
            </button>
          </div>
        )}

        {wizard.source && (
          <div>
            <div className="mb-2 text-sm font-medium text-[#f9e7e7]">
              EPUB {linkedEpub ? '(linked from ABS)' : '(optional)'}
            </div>
            {linkedEpub ? (
              <div className="rounded-[18px] border border-[#4a1d1d] bg-[#1a0909] px-4 py-3 text-sm text-[#f0d4d4]">
                {fileNameFromPath(linkedEpub)}
              </div>
            ) : (
              <button
                className="flex w-full items-center justify-between rounded-[18px] border border-[#4a1d1d] bg-[#1a0909] px-4 py-3 text-left text-sm text-[#f0d4d4] transition-colors hover:border-[#dc2626]"
                onClick={handlePickEpub}
              >
                <span>
                  {wizard.epubPath
                    ? fileNameFromPath(wizard.epubPath)
                    : 'Add an EPUB for vocabulary context'}
                </span>
                <span className="text-[#dc2626]">{wizard.epubPath ? 'Change' : 'Browse'}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
