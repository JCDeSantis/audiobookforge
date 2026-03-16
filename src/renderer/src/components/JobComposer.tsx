import React from 'react'
import { canContinue } from '../lib/jobDraft'
import { useAppStore } from '../store/useAppStore'
import { JobOptionsCard } from './JobOptionsCard'
import { SourceSelector } from './SourceSelector'

export function JobComposer(): React.JSX.Element {
  const { wizard, setConfirmationOpen } = useAppStore()
  const readyToContinue = canContinue(wizard)

  return (
    <section className="flex flex-1 flex-col overflow-y-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5">
        <SourceSelector />
        <JobOptionsCard />

        <div className="mt-auto flex justify-end">
          <button
            className="rounded-full bg-[#dc2626] px-6 py-3 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(220,38,38,0.28)] transition-all hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:bg-[#522020] disabled:text-[#d6b0b0] disabled:shadow-none"
            disabled={!readyToContinue}
            onClick={() => setConfirmationOpen(true)}
          >
            Continue
          </button>
        </div>
      </div>
    </section>
  )
}
