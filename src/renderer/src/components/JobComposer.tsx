import React from 'react'
import { canContinue } from '../lib/jobDraft'
import { useAppStore } from '../store/useAppStore'
import { JobOptionsCard } from './JobOptionsCard'
import { SourceSelector } from './SourceSelector'

export function JobComposer(): React.JSX.Element {
  const { wizard, setConfirmationOpen } = useAppStore()
  const readyToContinue = canContinue(wizard)
  const hasSelectedSource =
    (wizard.source === 'local' && wizard.audioFiles.length > 0) ||
    (wizard.source === 'abs' && (wizard.absItems.length > 0 || Boolean(wizard.absItem)))

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-3.5">
        <SourceSelector />
        <JobOptionsCard />

        <div className="mt-auto flex h-10 flex-none items-end justify-end">
          {hasSelectedSource && (
            <button
              className="h-10 rounded-full bg-[#dc2626] px-6 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(220,38,38,0.24)] transition-colors hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:bg-[#522020] disabled:text-[#d6b0b0] disabled:shadow-none"
              disabled={!readyToContinue}
              onClick={() => setConfirmationOpen(true)}
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
