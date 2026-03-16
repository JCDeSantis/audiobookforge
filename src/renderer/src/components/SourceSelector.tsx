import React from 'react'
import { getLocalSourceTitle } from '../lib/sourceTitle'
import { useAppStore } from '../store/useAppStore'

export function SourceSelector(): React.JSX.Element {
  const {
    settings,
    wizard,
    selectLocalFiles,
    clearSelectedSource,
    setAbsModalOpen,
    setSettingsOpen
  } = useAppStore()

  const sourceLabel =
    wizard.source === 'abs' && wizard.absItem
      ? `${wizard.absItem.title} - ${wizard.absItem.authorName}`
      : wizard.source === 'local' && wizard.audioFiles.length > 0
        ? getLocalSourceTitle(wizard.audioFiles)
        : ''

  const handleBrowseFiles = async (): Promise<void> => {
    const paths = await window.electron.files.pickAudio()
    if (paths && paths.length > 0) {
      selectLocalFiles(paths)
    }
  }

  const handleBrowseAbs = (): void => {
    if (!settings.absUrl) {
      setSettingsOpen(true)
      return
    }

    setAbsModalOpen(true)
  }

  if (wizard.source && sourceLabel) {
    return (
      <section className="rounded-[28px] border border-[#341414] bg-[#120707] p-5 shadow-[0_20px_40px_rgba(0,0,0,0.25)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ae8181]">
              Selected Source
            </div>
            <div className="mt-2 text-lg font-semibold text-[#fff3f3]">{sourceLabel}</div>
            <div className="mt-1 text-sm text-[#caacac]">
              {wizard.source === 'abs' ? 'AudioBookShelf library item' : 'Local audiobook files'}
            </div>
          </div>

          <button
            className="rounded-full border border-[#472121] px-4 py-2 text-sm text-[#e9c5c5] transition-colors hover:border-[#dc2626] hover:text-[#fff3f3]"
            onClick={clearSelectedSource}
          >
            Change
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-[28px] border border-[#341414] bg-[#120707] p-5 shadow-[0_20px_40px_rgba(0,0,0,0.25)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ae8181]">
        Choose Source
      </div>
      <div className="mt-4 grid gap-3">
        <button
          className="group flex items-center justify-between rounded-[22px] border border-[#482020] bg-[#190909] px-5 py-4 text-left transition-all hover:border-[#dc2626] hover:bg-[#220c0c]"
          onClick={handleBrowseFiles}
        >
          <div>
            <div className="text-base font-semibold text-[#fff3f3]">Browse Files</div>
            <div className="mt-1 text-sm text-[#c7a3a3]">Pick one or more `.m4b` or `.mp3` files</div>
          </div>
          <div className="text-2xl text-[#dc2626] transition-transform group-hover:translate-x-1">
            -&gt;
          </div>
        </button>

        <button
          className="group flex items-center justify-between rounded-[22px] border border-[#482020] bg-[#190909] px-5 py-4 text-left transition-all hover:border-[#dc2626] hover:bg-[#220c0c]"
          onClick={handleBrowseAbs}
        >
          <div>
            <div className="text-base font-semibold text-[#fff3f3]">Browse AudioBookShelf</div>
            <div className="mt-1 text-sm text-[#c7a3a3]">
              Pick an item from your AudioBookShelf library
            </div>
          </div>
          <div className="text-2xl text-[#dc2626] transition-transform group-hover:translate-x-1">
            -&gt;
          </div>
        </button>
      </div>
    </section>
  )
}
