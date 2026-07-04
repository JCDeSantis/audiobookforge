import React from 'react'
import { useAppStore } from '../store/useAppStore'
import { WHISPER_MODELS } from '../lib/whisperModels'
import type { WhisperModel } from '../../../shared/types'

function fileNameFromPath(path: string | null): string {
  if (!path) return 'None'
  return path.split(/[\\/]/).pop() ?? path
}

function getComposerModelOptionLabel(model: (typeof WHISPER_MODELS)[number]): string {
  const recommendedLabel = model.id === 'large-v3-turbo-q5_0' ? ' (Recommended)' : ''
  return `${model.name} - ${model.size}${recommendedLabel}`
}

export function JobOptionsCard(): React.JSX.Element {
  const {
    wizard,
    setWizardModel,
    setWizardSubtitleFormat,
    setWizardOutputFolder,
    setWizardEpubPath
  } = useAppStore()
  const isAbs = wizard.source === 'abs'
  const selectedAbsItems =
    wizard.absItems.length > 0 ? wizard.absItems : wizard.absItem ? [wizard.absItem] : []
  const linkedAbsItems = selectedAbsItems.filter((item) => item.ebookPath)
  const hasSingleLinkedEpub = selectedAbsItems.length === 1 && Boolean(linkedAbsItems[0]?.ebookPath)
  const linkedEpub = hasSingleLinkedEpub ? (linkedAbsItems[0]?.ebookPath ?? null) : null
  const hasMixedLinkedEpubs =
    selectedAbsItems.length > 1 &&
    linkedAbsItems.length > 0 &&
    linkedAbsItems.length < selectedAbsItems.length
  const linkedEpubSummary =
    selectedAbsItems.length > 1 && linkedAbsItems.length > 0
      ? linkedAbsItems.length === selectedAbsItems.length
        ? `All ${selectedAbsItems.length} selected books have linked ABS EPUB files.`
        : `${linkedAbsItems.length} of ${selectedAbsItems.length} selected books have linked ABS EPUB files.`
      : null

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

  return (
    <section className="h-[14rem] flex-none overflow-hidden rounded-[22px] border border-[#341414] bg-[#120707] p-4 shadow-[0_16px_32px_rgba(0,0,0,0.22)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ae8181]">
        Processing Options
      </div>

      <div className="mt-3 grid max-h-[10.75rem] grid-cols-1 gap-3 overflow-y-auto pr-1 md:grid-cols-2">
        <label className="block">
          <div className="mb-1.5 text-xs font-medium text-[#f9e7e7]">Whisper Model</div>
          <select
            className="h-10 w-full rounded-[14px] border border-[#4a1d1d] bg-[#1a0909] px-3 text-sm text-[#fff3f3] outline-none transition-colors focus:border-[#dc2626]"
            value={wizard.model}
            onChange={(event) => setWizardModel(event.target.value as WhisperModel)}
          >
            {WHISPER_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {getComposerModelOptionLabel(model)}
              </option>
            ))}
          </select>
        </label>

        <fieldset aria-labelledby="subtitle-formats-label">
          <div className="mb-1.5 flex items-center gap-2" id="subtitle-formats-label">
            <span className="text-xs font-medium text-[#f9e7e7]">Subtitle Formats</span>
            <span className="rounded-full border border-[#654b22] bg-[#261b08] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.06em] text-[#d9b86d]">
              Experimental
            </span>
          </div>
          <div className="grid h-10 grid-cols-3 gap-1.5 rounded-[14px] border border-[#4a1d1d] bg-[#100606] p-1">
            {(['srt', 'vtt', 'lrc'] as const).map((format) => (
              <label
                className={`flex min-w-0 items-center justify-center gap-1 rounded-[10px] border px-1.5 transition-colors ${
                  wizard.subtitleFormats.includes(format)
                    ? 'border-[#8f2828] bg-[#351010] text-[#fff0f0] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                    : 'cursor-pointer border-transparent text-[#b88f8f] hover:border-[#4b1d1d] hover:bg-[#1b0909] hover:text-[#efd7d7]'
                }`}
                key={format}
              >
                <input
                  checked={wizard.subtitleFormats.includes(format)}
                  className="sr-only"
                  disabled={format === 'srt'}
                  onChange={(event) => setWizardSubtitleFormat(format, event.target.checked)}
                  type="checkbox"
                />
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">
                  {format}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {wizard.source === 'local' && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-[#f9e7e7]">Output Folder</div>
            <button
              className="flex h-10 w-full items-center justify-between gap-3 rounded-[14px] border border-[#4a1d1d] bg-[#1a0909] px-3 text-left text-sm text-[#f0d4d4] transition-colors hover:border-[#dc2626]"
              onClick={handlePickOutputFolder}
            >
              <span className="min-w-0 truncate" title={wizard.outputFolder ?? undefined}>
                {wizard.outputFolder ?? 'Choose subtitle output folder'}
              </span>
              <span className="flex-none text-[#dc2626]">Browse</span>
            </button>
          </div>
        )}

        {wizard.source && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-[#f9e7e7]">
              EPUB {linkedEpub || linkedEpubSummary ? '(linked from ABS)' : '(optional)'}
            </div>
            {linkedEpub ? (
              <div
                className="h-10 truncate rounded-[14px] border border-[#4a1d1d] bg-[#1a0909] px-3 py-2.5 text-sm text-[#f0d4d4]"
                title={fileNameFromPath(linkedEpub)}
              >
                {fileNameFromPath(linkedEpub)}
              </div>
            ) : (
              <div className="space-y-2">
                {linkedEpubSummary && (
                  <div className="stable-clamp-2 min-h-10 rounded-[14px] border border-[#4a1d1d] bg-[#1a0909] px-3 py-2 text-xs leading-5 text-[#f0d4d4]">
                    {linkedEpubSummary}
                    {hasMixedLinkedEpubs && wizard.epubPath && (
                      <span className="block pt-1 text-[#d5b1b1]">
                        Shared fallback: {fileNameFromPath(wizard.epubPath)}
                      </span>
                    )}
                  </div>
                )}

                {(!linkedEpubSummary || hasMixedLinkedEpubs) && (
                  <button
                    className="flex h-10 w-full items-center justify-between gap-3 rounded-[14px] border border-[#4a1d1d] bg-[#1a0909] px-3 text-left text-sm text-[#f0d4d4] transition-colors hover:border-[#dc2626]"
                    onClick={handlePickEpub}
                  >
                    <span className="min-w-0 truncate">
                      {wizard.epubPath
                        ? fileNameFromPath(wizard.epubPath)
                        : isAbs && hasMixedLinkedEpubs
                          ? 'Add a shared EPUB for books without one'
                          : 'Add an EPUB for vocabulary context'}
                    </span>
                    <span className="flex-none text-[#dc2626]">
                      {wizard.epubPath ? 'Change' : 'Browse'}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
