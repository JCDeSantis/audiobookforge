import React from 'react'
import { useAppStore } from '../store/useAppStore'

export function AppHeader(): React.JSX.Element {
  const { queue, setSettingsOpen } = useAppStore()
  const activeCount = queue.jobs.filter((job) => job.status === 'queued' || job.status === 'running')
    .length

  return (
    <header className="border-b border-[#2f1212] bg-[#090303]/95 px-6 py-4 backdrop-blur">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[#b88989]">
            AudioBook Forge
          </div>
          <div className="mt-1 text-lg font-semibold text-[#fff3f3]">Subtitle Workspace</div>
        </div>

        <div className="flex items-center gap-3">
          <div className="rounded-full border border-[#3c1717] bg-[#160808] px-3 py-1 text-[11px] text-[#d1aaaa]">
            Queue {activeCount}
          </div>
          <button
            className="rounded-full border border-[#7f1d1d] bg-[#1a0808] px-4 py-2 text-sm font-medium text-[#fff3f3] transition-colors hover:border-[#dc2626] hover:bg-[#240b0b]"
            onClick={() => setSettingsOpen(true)}
          >
            Settings
          </button>
        </div>
      </div>
    </header>
  )
}
