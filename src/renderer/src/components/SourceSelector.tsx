import React, { useRef, useState } from 'react'
import { getAppClient, isWebRuntime } from '../lib/appClient'
import { getLocalSourceTitle } from '../lib/sourceTitle'
import { useAppStore } from '../store/useAppStore'

export function SourceSelector(): React.JSX.Element {
  const {
    settings,
    wizard,
    selectLocalFiles,
    clearSelectedSource,
    setAbsModalOpen,
    setSettingsOpen,
    selectWebUpload
  } = useAppStore()
  const uploadInput = useRef<HTMLInputElement>(null)
  const [uploadPercent, setUploadPercent] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const webRuntime = isWebRuntime()

  const absSelectionCount = wizard.absItems.length
  const isMultiAbsSelection = wizard.source === 'abs' && absSelectionCount > 1
  const sourceLabel =
    wizard.source === 'abs' && isMultiAbsSelection
      ? `${absSelectionCount} AudioBookShelf titles selected`
      : wizard.source === 'abs' && wizard.absItem
        ? `${wizard.absItem.title} - ${wizard.absItem.authorName}`
        : wizard.source === 'local' && wizard.audioFiles.length > 0
          ? getLocalSourceTitle(wizard.audioFiles)
          : wizard.source === 'upload' && wizard.audioFiles.length > 0
            ? getLocalSourceTitle(wizard.audioFiles)
          : ''
  const sourceDescription =
    wizard.source === 'abs'
      ? isMultiAbsSelection
        ? 'Each selected AudioBookShelf title will queue as its own job with the same options.'
        : 'AudioBookShelf library item'
      : wizard.source === 'upload'
        ? 'Uploaded audiobook files'
        : 'Local audiobook files'

  const handleBrowseFiles = async (): Promise<void> => {
    const paths = await getAppClient().files.pickAudio()
    if (paths && paths.length > 0) {
      selectLocalFiles(paths)
    }
  }

  const handleWebUpload = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return
    setUploadError(null)
    setUploadPercent(0)
    try {
      const selection = await getAppClient().uploads.uploadFiles(Array.from(files), setUploadPercent)
      selectWebUpload(
        selection.sessionId,
        selection.audioFileNames,
        selection.epubFileName
      )
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed.')
    } finally {
      setUploadPercent(null)
      if (uploadInput.current) uploadInput.current.value = ''
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
      <section className="h-[10.75rem] flex-none overflow-hidden rounded-[22px] border border-[#341414] bg-[#120707] p-4 shadow-[0_16px_32px_rgba(0,0,0,0.22)]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ae8181]">
              Selected Source
            </div>
            <div
              className="stable-clamp-2 mt-2 h-11 text-base font-semibold leading-[1.375rem] text-[#fff3f3]"
              title={sourceLabel}
            >
              {sourceLabel}
            </div>
            <div className="stable-clamp-1 mt-1 h-5 max-w-2xl text-sm leading-5 text-[#caacac]">
              {sourceDescription}
            </div>
          </div>

          <button
            className="h-9 flex-none rounded-full border border-[#472121] px-4 text-sm text-[#e9c5c5] transition-colors hover:border-[#dc2626] hover:text-[#fff3f3]"
            onClick={clearSelectedSource}
          >
            Change
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="h-[10.75rem] flex-none overflow-hidden rounded-[22px] border border-[#341414] bg-[#120707] p-4 shadow-[0_16px_32px_rgba(0,0,0,0.22)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ae8181]">
        Choose Source
      </div>
      <div className="mt-3 grid gap-2">
        <button
          className="group flex h-[3.45rem] items-center justify-between rounded-[16px] border border-[#482020] bg-[#190909] px-4 text-left transition-colors hover:border-[#dc2626] hover:bg-[#220c0c]"
          onClick={() => (webRuntime ? uploadInput.current?.click() : void handleBrowseFiles())}
        >
          <div>
            <div className="text-sm font-semibold text-[#fff3f3]">
              {webRuntime ? 'Upload Files' : 'Browse Files'}
            </div>
            <div className="text-xs text-[#c7a3a3]">
              {uploadPercent === null
                ? 'Pick `.m4b`/`.mp3` files and optional `.epub`; reselect matching files to resume'
                : `Uploading… ${uploadPercent}%`}
            </div>
          </div>
          <div className="text-lg text-[#fff3f3]">-&gt;</div>
        </button>
        {webRuntime && (
          <input
            accept=".m4b,.mp3,.epub"
            className="hidden"
            multiple
            onChange={(event) => void handleWebUpload(event.target.files)}
            ref={uploadInput}
            type="file"
          />
        )}
        {uploadError && <div className="truncate text-xs text-[#ff9b9b]">{uploadError}</div>}

        <button
          className="group flex h-[3.45rem] items-center justify-between rounded-[16px] border border-[#482020] bg-[#190909] px-4 text-left transition-colors hover:border-[#dc2626] hover:bg-[#220c0c]"
          onClick={handleBrowseAbs}
        >
          <div>
            <div className="text-sm font-semibold text-[#fff3f3]">Browse AudioBookShelf</div>
            <div className="text-xs text-[#c7a3a3]">
              Pick an item from your AudioBookShelf library
            </div>
          </div>
          <div className="text-lg text-[#fff3f3]">-&gt;</div>
        </button>
      </div>
    </section>
  )
}
