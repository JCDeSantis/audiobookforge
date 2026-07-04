import React, { useState } from 'react'
import { getAppClient } from '../lib/appClient'
import { buildConfirmationRows, buildQueueJobPayloads } from '../lib/jobDraft'
import { useAppStore } from '../store/useAppStore'

function SummaryRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-[#2a1010] py-3 last:border-b-0">
      <dt className="min-w-0 text-xs font-semibold uppercase tracking-[0.16em] text-[#9d7070]">
        {label}
      </dt>
      <dd className="text-right text-sm text-[#f5dddd]">{value}</dd>
    </div>
  )
}

export function QueueConfirmationModal(): React.JSX.Element {
  const { settings, wizard, resetWizard, setConfirmationOpen } = useAppStore()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const summaryRows = buildConfirmationRows(wizard)
  const absSelectionCount = wizard.absItems.length
  const jobCount = wizard.source === 'abs' && absSelectionCount > 0 ? absSelectionCount : 1
  const isMultiAbsSelection = wizard.source === 'abs' && jobCount > 1

  const handleBack = (): void => {
    setConfirmationOpen(false)
    setSubmitError(null)
  }

  const handleAddToQueue = async (): Promise<void> => {
    let queuedCount = 0

    try {
      setIsSubmitting(true)
      setSubmitError(null)

      for (const payload of buildQueueJobPayloads(wizard, settings)) {
        await getAppClient().queue.add(payload)
        queuedCount += 1
      }

      resetWizard()
    } catch (error) {
      const fallbackMessage =
        queuedCount > 0
          ? `${queuedCount} of ${jobCount} jobs were added before the queue request failed.`
          : 'Unable to add the job to the queue.'
      const errorMessage = error instanceof Error ? error.message : fallbackMessage

      setSubmitError(queuedCount > 0 ? `${fallbackMessage} ${errorMessage}`.trim() : errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex h-[min(520px,calc(100vh-2rem))] w-full max-w-xl flex-col overflow-hidden rounded-[24px] border border-[#4a1d1d] bg-[linear-gradient(180deg,#160808_0%,#0c0404_100%)] p-5 shadow-[0_30px_90px_rgba(0,0,0,0.55)]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#b98585]">
          Confirm Queue {isMultiAbsSelection ? 'Jobs' : 'Job'}
        </div>
        <h2 className="mt-2 text-xl font-semibold text-[#fff5f5]">
          {isMultiAbsSelection ? 'Ready to add these books?' : 'Ready to add this book?'}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#d9b6b6]">
          {isMultiAbsSelection
            ? 'Quick double-check, then each selected title goes into the queue as its own job with the same settings.'
            : 'Quick double-check, then the job goes straight into the queue.'}
        </p>

        <dl className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-[20px] border border-[#351313] bg-[#120707] px-4 py-1">
          {summaryRows.map((row) => (
            <SummaryRow key={row.label} label={row.label} value={row.value} />
          ))}
        </dl>

        <p
          className="stable-feedback mt-3 truncate text-xs leading-5 text-[#f87171]"
          role={submitError ? 'alert' : undefined}
          title={submitError ?? undefined}
        >
          {submitError ?? '\u00A0'}
        </p>

        <div className="mt-3 flex h-10 flex-none items-end justify-end gap-3">
          <button
            className="rounded-full border border-[#4a1d1d] px-5 py-2.5 text-sm font-medium text-[#f0cccc] transition-colors hover:border-[#dc2626] hover:text-[#fff5f5] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
            onClick={handleBack}
          >
            Back
          </button>
          <button
            className="rounded-full bg-[#dc2626] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(220,38,38,0.24)] transition-colors hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:bg-[#5f1d1d] disabled:text-[#e2b8b8]"
            disabled={isSubmitting}
            onClick={handleAddToQueue}
          >
            {isSubmitting
              ? 'Adding...'
              : isMultiAbsSelection
                ? `Add ${jobCount} Jobs to Queue`
                : 'Add to Queue'}
          </button>
        </div>
      </div>
    </div>
  )
}
