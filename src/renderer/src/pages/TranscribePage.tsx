import React from 'react'
import { useAppStore } from '../store/useAppStore'
import { WHISPER_MODELS } from '../lib/whisperModels'

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

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="w-24 flex-shrink-0 text-[11px] text-[#6b2222]">{label}</span>
      <span className="text-[11px] text-[#fca5a5]">{value}</span>
    </div>
  )
}

export function TranscribePage(): React.JSX.Element {
  const { wizard, setWizardStep, resetWizard } = useAppStore()

  const modelInfo = WHISPER_MODELS.find((m) => m.id === wizard.model)
  const modelLabel = modelInfo ? `${modelInfo.name} (${modelInfo.size})` : wizard.model

  const titleLabel =
    wizard.source === 'abs' && wizard.absItem
      ? wizard.absItem.title
      : wizard.audioFiles.length === 1
      ? (wizard.audioFiles[0].split(/[\\/]/).pop() ?? wizard.audioFiles[0])
      : `${wizard.audioFiles.length} files`

  const sourceLabel = wizard.source === 'abs' ? 'AudioBookShelf' : 'Local file(s)'

  const outputLabel =
    wizard.source === 'abs'
      ? 'Upload to ABS automatically'
      : wizard.outputFolder ?? '(no folder selected)'

  const epubLabel =
    wizard.source === 'abs' && wizard.absItem?.ebookPath
      ? (wizard.absItem.ebookPath.split(/[\\/]/).pop() ?? 'Auto-linked')
      : wizard.epubPath
      ? (wizard.epubPath.split(/[\\/]/).pop() ?? wizard.epubPath)
      : 'None'

  const handleAddToQueue = async (): Promise<void> => {
    const jobData = {
      source: wizard.source as 'local' | 'abs',
      title: titleLabel,
      audioFiles:
        wizard.source === 'abs' && wizard.absItem
          ? wizard.absItem.audioFiles.map((af) => af.metadata.path)
          : wizard.audioFiles,
      outputPath: wizard.source === 'local' ? wizard.outputFolder : null,
      absItemId: wizard.source === 'abs' && wizard.absItem ? wizard.absItem.id : null,
      epubPath:
        wizard.source === 'abs' && wizard.absItem?.ebookPath
          ? wizard.absItem.ebookPath
          : wizard.epubPath,
      model: wizard.model
    }

    await window.electron.queue.add(jobData)
    resetWizard()
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-5">
      <StepIndicator current={3} />

      <div className="text-[13px] font-semibold text-[#fef2f2]">Review &amp; Queue</div>

      {/* Summary card */}
      <div className="rounded-lg border border-[#2a0000] bg-[#0d0000] px-4 py-3 divide-y divide-[#1a0000]">
        <Row label="Title" value={titleLabel} />
        <Row label="Source" value={sourceLabel} />
        <Row label="Model" value={modelLabel} />
        <Row label="Output" value={outputLabel} />
        <Row label="EPUB" value={epubLabel} />
      </div>

      {/* Nav */}
      <div className="mt-auto flex justify-between">
        <button
          className="rounded border border-[#3f0000] px-4 py-1.5 text-[11px] font-semibold text-[#6b2222] hover:text-[#fca5a5] transition-colors"
          onClick={() => setWizardStep(2)}
        >
          ← Back
        </button>
        <button
          className="rounded bg-[#dc2626] px-5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#b91c1c] transition-colors"
          onClick={handleAddToQueue}
        >
          Add to Queue
        </button>
      </div>
    </div>
  )
}
