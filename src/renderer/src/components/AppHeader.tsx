import React from 'react'
import appLogo from '../assets/app-logo.png'
import packageJson from '../../../../package.json'
import { useAppStore } from '../store/useAppStore'

export function AppHeader(): React.JSX.Element {
  const displayVersion = packageJson.version.replace(/\.0$/, '')
  const { queue, setSettingsOpen } = useAppStore()
  const activeCount = queue.jobs.filter(
    (job) => job.status === 'queued' || job.status === 'running'
  ).length

  return (
    <header className="flex h-[var(--app-header-height)] flex-none items-center border-b border-[#2f1212] bg-[#090303]/95 px-5 backdrop-blur">
      <div className="flex w-full min-w-0 items-center gap-4">
        <div className="app-brand">
          <img alt="" className="app-brand-icon" src={appLogo} />
          <div className="app-brand-copy">
            <h1 className="app-wordmark" aria-label="Audiobook Forge">
              <span className="app-wordmark-primary">Audiobook</span>{' '}
              <span className="app-wordmark-accent">Forge</span>
            </h1>
            <p className="app-tagline">
              Generate audiobook subtitles with Audiobookshelf integration
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-none items-center justify-end gap-2.5">
          <span
            aria-label={`Version ${displayVersion}`}
            className="inline-flex h-6 flex-none items-center rounded-full border border-[#321818] bg-[#100606] px-2.5 text-[10px] font-medium tabular-nums text-[#987171]"
          >
            v{displayVersion}
          </span>
          <div className="inline-flex h-8 min-w-[5.25rem] items-center justify-center rounded-full border border-[#3c1717] bg-[#160808] px-3 text-[11px] text-[#d1aaaa]">
            Queue {activeCount}
          </div>
          <button
            className="h-9 rounded-full border border-[#7f1d1d] bg-[#1a0808] px-4 text-sm font-medium text-[#fff3f3] transition-colors hover:border-[#dc2626] hover:bg-[#240b0b]"
            onClick={() => setSettingsOpen(true)}
          >
            Settings
          </button>
        </div>
      </div>
    </header>
  )
}
