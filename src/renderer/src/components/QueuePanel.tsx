import React from 'react'
import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { AppSettingsPanel } from './AppSettingsPanel'
import type { TranscriptionJob } from '../../../shared/types'

function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case 'downloading-binary': return 'Downloading whisper'
    case 'downloading-model': return 'Downloading model'
    case 'preparing': return 'Preparing audio'
    case 'segmenting': return 'Segmenting audio'
    case 'transcribing': return 'Transcribing'
    case 'done': return 'Done'
    case 'error': return 'Error'
    default: return 'Working…'
  }
}

function JobCard({ job }: { job: TranscriptionJob }): React.JSX.Element {
  const { queue } = useAppStore()
  const isActive = job.id === queue.activeJobId

  const handleCancel = (): void => {
    window.electron.queue.cancel(job.id)
  }

  const handleRetry = async (): Promise<void> => {
    // Re-queue the job with same parameters
    await window.electron.queue.add({
      source: job.source,
      title: job.title,
      audioFiles: job.audioFiles,
      outputPath: job.outputPath,
      absItemId: job.absItemId,
      absLibraryId: job.absLibraryId,
      absFolderId: job.absFolderId,
      absAuthorName: job.absAuthorName,
      epubPath: job.epubPath,
      model: job.model
    })
  }

  const handleRemove = (): void => {
    window.electron.queue.remove(job.id)
  }

  return (
    <div
      className={`rounded-[6px] border p-2 ${
        isActive
          ? 'border-[#991b1b] bg-[#120000]'
          : job.status === 'done'
          ? 'border-[#2a0000] bg-[#0a0000] opacity-60'
          : job.status === 'failed'
          ? 'border-[#7f1d1d] bg-[#0d0000]'
          : 'border-[#2a0000] bg-[#0a0000]'
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-1 mb-1">
        <span className="text-[10px] font-semibold leading-tight text-[#fef2f2] max-w-[120px] line-clamp-2">
          {job.title}
        </span>
        <StatusBadge job={job} isActive={isActive} />
      </div>

      {/* Progress bar for running jobs */}
      {isActive && job.progress && (
        <>
          <div className="mb-0.5 flex items-center justify-between">
            <span className="text-[9px] text-[#fca5a5]">{phaseLabel(job.progress.phase)}</span>
            {job.progress.segmentCount != null && job.progress.segmentIndex != null && (
              <span className="text-[9px] text-[#6b2222]">
                {job.progress.segmentIndex}/{job.progress.segmentCount}
              </span>
            )}
          </div>
          <div className="h-[3px] overflow-hidden rounded-sm bg-[#080000]">
            <div
              className="h-full rounded-sm bg-[#dc2626] transition-all"
              style={{ width: `${job.progress.percent}%` }}
            />
          </div>
          {job.progress.liveText && (
            <div className="mt-1 text-[9px] text-[#6b2222] line-clamp-1">
              {job.progress.liveText}
            </div>
          )}
        </>
      )}

      {/* Meta row */}
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[9px] text-[#6b2222]">
          {job.source === 'abs' ? 'ABS' : 'Local'} · {job.model}
        </span>
        <div className="flex gap-1">
          {isActive && (
            <button
              className="text-[9px] text-[#6b2222] hover:text-[#fca5a5]"
              onClick={handleCancel}
            >
              Cancel
            </button>
          )}
          {job.status === 'failed' && (
            <button
              className="text-[9px] text-[#dc2626] hover:text-[#fca5a5]"
              onClick={handleRetry}
            >
              Retry
            </button>
          )}
          {(job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') && (
            <button
              className="text-[9px] text-[#6b2222] hover:text-[#fca5a5]"
              onClick={handleRemove}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Error message */}
      {job.status === 'failed' && job.error && (
        <div className="mt-1 text-[9px] text-[#dc2626] line-clamp-2">{job.error}</div>
      )}

      {/* Done — show path */}
      {job.status === 'done' && job.srtPath && job.source === 'abs' && (
        <div
          className="mt-1 text-[9px] text-[#ca8a04] cursor-pointer hover:underline line-clamp-1"
          onClick={() => window.electron.files.showInExplorer(job.srtPath!)}
          title="ABS upload unsupported — update ABS to 2.2+ for auto-upload"
        >
          ABS upload failed — {job.srtPath.split(/[\\/]/).pop()}
        </div>
      )}
      {job.status === 'done' && job.srtPath && job.source !== 'abs' && (
        <div
          className="mt-1 text-[9px] text-[#4ade80] cursor-pointer hover:underline line-clamp-1"
          onClick={() => window.electron.files.showInExplorer(job.srtPath!)}
        >
          Saved → {job.srtPath.split(/[\\/]/).pop()}
        </div>
      )}
      {job.status === 'done' && !job.srtPath && job.source === 'abs' && (
        <div className="mt-1 text-[9px] text-[#4ade80]">Uploaded to ABS</div>
      )}
    </div>
  )
}

function StatusBadge({
  job,
  isActive
}: {
  job: TranscriptionJob
  isActive: boolean
}): React.JSX.Element {
  if (isActive && job.progress) {
    return (
      <span className="whitespace-nowrap rounded-[3px] bg-[#7f1d1d] px-1.5 py-0.5 text-[9px] text-[#fca5a5]">
        ▶ {job.progress.percent}%
      </span>
    )
  }
  if (isActive) {
    return (
      <span className="whitespace-nowrap rounded-[3px] bg-[#7f1d1d] px-1.5 py-0.5 text-[9px] text-[#fca5a5]">
        ▶ Running
      </span>
    )
  }
  if (job.status === 'queued') {
    return (
      <span className="whitespace-nowrap rounded-[3px] bg-[#1a0000] px-1.5 py-0.5 text-[9px] text-[#6b2222]">
        ⏳ Queued
      </span>
    )
  }
  if (job.status === 'done') {
    return (
      <span className="whitespace-nowrap rounded-[3px] bg-[#14532d] px-1.5 py-0.5 text-[9px] text-[#4ade80]">
        ✓ Done
      </span>
    )
  }
  if (job.status === 'failed') {
    return (
      <span className="whitespace-nowrap rounded-[3px] bg-[#3f0000] px-1.5 py-0.5 text-[9px] text-[#dc2626]">
        ✗ Failed
      </span>
    )
  }
  if (job.status === 'cancelled') {
    return (
      <span className="whitespace-nowrap rounded-[3px] bg-[#1a0000] px-1.5 py-0.5 text-[9px] text-[#6b2222]">
        — Cancelled
      </span>
    )
  }
  return <></>
}

export function QueuePanel(): React.JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { queue } = useAppStore()
  const { jobs } = queue

  const activeJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'running')
  const hasDone = jobs.some(
    (j) => j.status === 'done' || j.status === 'failed' || j.status === 'cancelled'
  )

  const handleClearDone = (): void => {
    window.electron.queue.clearDone()
  }

  return (
    <>
      <div className="flex w-[230px] flex-shrink-0 flex-col bg-[#060000]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2a0000] px-3.5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#fca5a5]">
              Queue
            </span>
            <span className="rounded-full bg-[#1a0000] px-1.5 py-0.5 text-[10px] text-[#6b2222]">
              {activeJobs.length}
            </span>
          </div>
          {hasDone && (
            <button
              className="text-[9px] text-[#6b2222] hover:text-[#fca5a5]"
              onClick={handleClearDone}
            >
              Clear done
            </button>
          )}
        </div>

        {/* Job list */}
        <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-2">
          {jobs.length === 0 && (
            <div className="mt-4 text-center text-[10px] text-[#3f0000]">No jobs yet</div>
          )}
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-[#2a0000] px-3.5 py-2.5">
          <button
            className="flex items-center gap-1.5 text-[10px] text-[#6b2222] hover:text-[#fca5a5] transition-colors"
            onClick={() => setSettingsOpen(true)}
          >
            <span>⚙</span>
            <span>ABS Connection Settings</span>
          </button>
        </div>
      </div>

      {/* AppSettingsPanel overlay */}
      {settingsOpen && <AppSettingsPanel onClose={() => setSettingsOpen(false)} />}
    </>
  )
}
