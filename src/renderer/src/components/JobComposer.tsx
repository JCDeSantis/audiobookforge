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
        <div className="rounded-[32px] border border-[#341414] bg-[radial-gradient(circle_at_top,rgba(220,38,38,0.16),transparent_38%),linear-gradient(180deg,#120707_0%,#0c0505_100%)] px-6 py-7 shadow-[0_30px_60px_rgba(0,0,0,0.35)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#ae8181]">
            Job Setup
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-[#fff7f7]">
            New Transcription
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#d4b5b5]">
            Choose a source, confirm the few options that matter, and send the book to the queue
            without bouncing through multiple setup pages.
          </p>
        </div>

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
