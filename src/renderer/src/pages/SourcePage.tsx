import React from 'react'
import { useCallback } from 'react'
import { useAppStore } from '../store/useAppStore'
import { getLocalSourceTitle } from '../lib/sourceTitle'

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

export function SourcePage(): React.JSX.Element {
  const {
    wizard,
    setWizardAudioFiles,
    setWizardSource,
    setWizardAbsItem,
    setWizardStep,
    setAbsModalOpen
  } = useAppStore()

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        /\.(m4b|mp3)$/i.test(f.name)
      )
      if (files.length === 0) return
      const paths = files.map((f) => window.electron.webUtils.getPathForFile(f))
      setWizardAudioFiles(paths)
      setWizardSource('local')
      setWizardAbsItem(null)
    },
    [setWizardAudioFiles, setWizardSource, setWizardAbsItem]
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }, [])

  const handleBrowseFiles = async (): Promise<void> => {
    const paths = await window.electron.files.pickAudio()
    if (paths && paths.length > 0) {
      setWizardAudioFiles(paths)
      setWizardSource('local')
      setWizardAbsItem(null)
    }
  }

  const canAdvance =
    wizard.source === 'abs'
      ? wizard.absItem !== null
      : wizard.audioFiles.length > 0

  const getSourceLabel = (): string => {
    if (wizard.source === 'abs' && wizard.absItem) {
      return `${wizard.absItem.title} — ${wizard.absItem.authorName}`
    }
    if (wizard.source === 'local' && wizard.audioFiles.length > 0) {
      return getLocalSourceTitle(wizard.audioFiles)
    }
    return ''
  }

  const sourceLabel = getSourceLabel()

  return (
    <div className="flex flex-1 flex-col gap-3.5 p-5">
      <StepIndicator current={1} />

      <div className="text-[13px] font-semibold text-[#fef2f2]">Choose a source</div>

      {/* Drop zone */}
      <div
        className="cursor-pointer rounded-lg border-[1.5px] border-dashed border-[#3f0000] bg-[#080000] p-[18px] text-center transition-colors hover:border-[#7f1d1d]"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={handleBrowseFiles}
      >
        <div className="mb-1 text-2xl">📁</div>
        <div className="text-[11px] text-[#fca5a5]">Drop .m4b or .mp3 files here</div>
        <div className="mt-0.5 text-[10px] text-[#6b2222]">
          Multiple files supported (multi-part books)
        </div>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-[#2a0000]" />
        <span className="text-[10px] text-[#6b2222]">or</span>
        <div className="h-px flex-1 bg-[#2a0000]" />
      </div>

      {/* ABS browse button */}
      <div
        className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#7f1d1d] bg-[#120000] p-3 transition-colors hover:border-[#dc2626]"
        onClick={() => setAbsModalOpen(true)}
      >
        <div className="text-xl">📚</div>
        <div>
          <div className="text-[12px] font-semibold text-[#fca5a5]">Browse AudioBookShelf</div>
          <div className="text-[10px] text-[#6b2222]">Browse your ABS library</div>
        </div>
        <div className="ml-auto text-[14px] text-[#6b2222]">→</div>
      </div>

      {/* Selected source indicator */}
      {sourceLabel && (
        <div className="rounded border border-[#3f0000] bg-[#0d0000] px-3 py-2 text-[11px] text-[#fca5a5]">
          ✓ {sourceLabel}
        </div>
      )}

      {/* Nav */}
      <div className="mt-auto flex justify-end">
        <button
          className="rounded px-4 py-1.5 text-[11px] font-semibold text-white transition-colors disabled:opacity-30"
          style={{ backgroundColor: canAdvance ? '#dc2626' : '#3f0000' }}
          disabled={!canAdvance}
          onClick={() => setWizardStep(2)}
        >
          Next →
        </button>
      </div>
    </div>
  )
}
