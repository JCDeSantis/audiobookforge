import React, { useEffect, useState } from 'react'
import type { TranscriptionJob } from '../../../shared/types'
import { getWhisperModelBaseName } from '../lib/whisperModels'
import { WHISPER_MODELS } from '../lib/whisperModels'
import { useAppStore } from '../store/useAppStore'

function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case 'downloading-binary':
      return 'Downloading whisper'
    case 'downloading-model':
      return 'Downloading model'
    case 'preparing':
      return 'Preparing audio'
    case 'segmenting':
      return 'Segmenting audio'
    case 'transcribing':
      return 'Transcribing'
    case 'uploading':
      return 'Uploading subtitles'
    case 'done':
      return 'Done'
    case 'error':
      return 'Error'
    default:
      return phase ? 'Working...' : 'Paused'
  }
}

function getSavedPaths(job: TranscriptionJob): string[] {
  if (job.srtPaths.length > 0) {
    return job.srtPaths
  }

  return job.srtPath ? [job.srtPath] : []
}

function formatElapsedTime(startedAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function StatusBadge({
  job,
  isActive
}: {
  job: TranscriptionJob
  isActive: boolean
}): React.JSX.Element {
  if (isActive && job.progress) {
    const badgePercent = job.progress.overallPercent ?? job.progress.percent

    return (
      <span className="inline-flex min-w-[6.25rem] justify-center rounded-full bg-[#7f1d1d] px-2.5 py-1 text-[11px] font-medium tabular-nums text-[#ffd7d7]">
        Running {badgePercent}%
      </span>
    )
  }

  if (isActive) {
    return (
      <span className="inline-flex min-w-[6.25rem] justify-center rounded-full bg-[#7f1d1d] px-2.5 py-1 text-[11px] font-medium text-[#ffd7d7]">
        Running
      </span>
    )
  }

  if (job.status === 'queued') {
    return (
      <span className="rounded-full bg-[#281010] px-2.5 py-1 text-[11px] font-medium text-[#e2b3b3]">
        Queued
      </span>
    )
  }

  if (job.status === 'done') {
    return (
      <span className="rounded-full bg-[#183824] px-2.5 py-1 text-[11px] font-medium text-[#9fe0bb]">
        Done
      </span>
    )
  }

  if (job.status === 'failed') {
    return (
      <span className="rounded-full bg-[#401414] px-2.5 py-1 text-[11px] font-medium text-[#ff9f9f]">
        Failed
      </span>
    )
  }

  if (job.status === 'cancelled') {
    return (
      <span className="rounded-full bg-[#281010] px-2.5 py-1 text-[11px] font-medium text-[#d3a8a8]">
        Cancelled
      </span>
    )
  }

  if (job.status === 'paused') {
    return (
      <span className="rounded-md bg-[#2d1828] px-2.5 py-1 text-[11px] font-medium text-[#efc4ff]">
        Paused
      </span>
    )
  }

  return <></>
}

function JobCard({
  job,
  now,
  quiet = false
}: {
  job: TranscriptionJob
  now?: number
  quiet?: boolean
}): React.JSX.Element {
  const { queue } = useAppStore()
  const [retryModel, setRetryModel] = useState(job.model)
  const isActive = job.id === queue.activeJobId
  const savedPaths = getSavedPaths(job)
  const modelName = getWhisperModelBaseName(job.model)
  const elapsedText =
    isActive && typeof now === 'number'
      ? formatElapsedTime(job.startedAt ?? job.createdAt, now)
      : null

  const handleCancel = (): void => {
    window.electron.queue.cancel(job.id)
  }

  const handlePause = (): void => {
    window.electron.queue.pause(job.id)
  }

  const handleResume = (): void => {
    window.electron.queue.resume(job.id)
  }

  const handleRetry = async (): Promise<void> => {
    await window.electron.queue.retry(job.id, retryModel)
  }

  const handleRemove = (): void => {
    window.electron.queue.remove(job.id)
  }

  const handleRevealSaved = (): void => {
    if (savedPaths.length > 0) {
      window.electron.files.showInExplorer(savedPaths[0])
    }
  }

  return (
    <article
      className={`rounded-lg border px-4 py-3 ${
        isActive
          ? 'border-[#8f2b2b] bg-[#170909]'
          : quiet
            ? 'border-[#2e1515] bg-[#0d0404] opacity-75'
            : job.status === 'failed'
              ? 'border-[#5b1f1f] bg-[#130707]'
              : 'border-[#2f1717] bg-[#100606]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm font-semibold leading-5 text-[#fff1f1]">{job.title}</div>
        <StatusBadge job={job} isActive={isActive} />
      </div>
      <div
        className="mt-1 whitespace-nowrap text-[11px] leading-4 text-[#bb9191]"
        title={`${job.source === 'abs' ? 'AudioBookShelf' : 'Local files'} - ${modelName}`}
      >
        {job.source === 'abs' ? 'AudioBookShelf' : 'Local files'} - {modelName}
      </div>

      {isActive && job.progress && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
            <span className="text-[#f0c3c3]">{phaseLabel(job.progress.phase)}</span>
            <span className="text-[#9d7272]">{job.progress.percent}%</span>
          </div>
          <div
            aria-label={`${job.title} progress`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={job.progress.percent}
            className="h-1.5 overflow-hidden rounded-full bg-[#220d0d]"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-[#dc2626] transition-all"
              style={{ width: `${job.progress.percent}%` }}
            />
          </div>
          <div
            className="mt-2 h-5 overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-5 text-[#b48c8c]"
            title={job.progress.liveText ?? ''}
          >
            {job.progress.liveText ?? '\u00A0'}
          </div>
        </div>
      )}

      {job.status === 'failed' && job.error && (
        <p className="mt-3 text-xs leading-5 text-[#ff9b9b]">{job.error}</p>
      )}

      {job.qualityReport && (
        <div className="mt-3 rounded-md border border-[#321919] bg-[#0b0404] px-3 py-2 text-xs leading-5 text-[#caa2a2]">
          <div className="font-medium text-[#f1d6d6]">
            Quality {job.qualityReport.issueCount === 0 ? 'looks clean' : `${job.qualityReport.issueCount} item${job.qualityReport.issueCount === 1 ? '' : 's'}`}
          </div>
          <div>
            {job.qualityReport.cueCount} cues, {job.qualityReport.coveragePercent}% coverage
          </div>
          {job.qualityReport.issues[0] && (
            <div className="text-[#f0b4b4]">{job.qualityReport.issues[0].message}</div>
          )}
        </div>
      )}

      {job.status === 'done' && savedPaths.length > 0 && (
        <button
          className={`mt-3 text-left text-xs transition-colors hover:underline ${
            job.source === 'abs' ? 'text-[#f6c76a]' : 'text-[#97d8ad]'
          }`}
          onClick={handleRevealSaved}
          title={
            job.source === 'abs'
              ? 'ABS upload failed, so the subtitle was saved locally.'
              : undefined
          }
        >
          {job.source === 'abs'
            ? `ABS upload fallback - ${savedPaths[0].split(/[\\/]/).pop()}`
            : savedPaths.length === 1
              ? `Saved - ${savedPaths[0].split(/[\\/]/).pop()}`
              : `Saved - ${savedPaths.length} subtitle files`}
        </button>
      )}

      {job.status === 'done' && savedPaths.length === 0 && job.source === 'abs' && (
        <div className="mt-3 text-xs text-[#97d8ad]">Uploaded to AudioBookShelf</div>
      )}

      <div className="mt-4 flex items-center gap-3 text-xs">
        {elapsedText && <div className="text-[#9d7272]">Elapsed {elapsedText}</div>}

        <div className="ml-auto flex flex-wrap justify-end gap-2">
          {isActive && (
            <button
              className="rounded-md border border-[#5b1f1f] px-3 py-1.5 text-[#f0c7c7] transition-colors hover:border-[#dc2626] hover:text-[#fff3f3]"
              onClick={handlePause}
            >
              Pause
            </button>
          )}
          {isActive && (
            <button
              className="rounded-md border border-[#5b1f1f] px-3 py-1.5 text-[#f0c7c7] transition-colors hover:border-[#dc2626] hover:text-[#fff3f3]"
              onClick={handleCancel}
            >
              Cancel
            </button>
          )}
          {job.status === 'paused' && (
            <button
              className="rounded-md border border-[#7f1d1d] px-3 py-1.5 text-[#ffb4b4] transition-colors hover:border-[#dc2626] hover:text-[#fff3f3]"
              onClick={handleResume}
            >
              Resume
            </button>
          )}
          {job.status === 'queued' && !isActive && (
            <button
              className="rounded-md border border-[#3a1919] px-3 py-1.5 text-[#d7b0b0] transition-colors hover:border-[#dc2626] hover:text-[#fff3f3]"
              onClick={handleRemove}
            >
              Remove
            </button>
          )}
          {job.status === 'failed' && (
            <>
              <select
                className="rounded-md border border-[#3a1919] bg-[#110606] px-2 py-1.5 text-[#f3d6d6]"
                onChange={(event) => setRetryModel(event.target.value as typeof retryModel)}
                value={retryModel}
              >
                {WHISPER_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
              <button
                className="rounded-md border border-[#7f1d1d] px-3 py-1.5 text-[#ffb4b4] transition-colors hover:border-[#dc2626] hover:text-[#fff3f3]"
                onClick={handleRetry}
              >
                Retry
              </button>
            </>
          )}
          {(job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') && (
            <button
              className="rounded-md border border-[#3a1919] px-3 py-1.5 text-[#d7b0b0] transition-colors hover:border-[#dc2626] hover:text-[#fff3f3]"
              onClick={handleRemove}
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

export function QueuePanel(): React.JSX.Element {
  const [finishedOpen, setFinishedOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const { queue } = useAppStore()
  const { jobs } = queue

  const activeJobs = jobs.filter(
    (job) => job.status === 'queued' || job.status === 'running' || job.status === 'paused'
  )
  const finishedJobs = jobs.filter(
    (job) => job.status === 'done' || job.status === 'failed' || job.status === 'cancelled'
  )

  useEffect(() => {
    if (activeJobs.length === 0) {
      return
    }

    const intervalId = window.setInterval(() => setNow(Date.now()), 1000)

    return () => window.clearInterval(intervalId)
  }, [activeJobs.length])

  const handleClearDone = (): void => {
    window.electron.queue.clearDone()
  }

  const moveJob = (jobId: string, direction: -1 | 1): void => {
    const ordered = activeJobs.map((job) => job.id)
    const index = ordered.indexOf(jobId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) {
      return
    }

    const [moved] = ordered.splice(index, 1)
    ordered.splice(nextIndex, 0, moved)
    window.electron.queue.reorder(ordered)
  }

  return (
    <aside className="flex w-[320px] flex-shrink-0 flex-col border-l border-[#2f1515] bg-[linear-gradient(180deg,#090303_0%,#050101_100%)]">
      <div className="flex flex-1 flex-col overflow-y-auto px-4 py-5">
        <section>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9f7171]">
            Active Jobs
          </div>
          {activeJobs.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-[#352020] bg-[#0d0505] px-4 py-5 text-sm text-[#9e7474]">
              No jobs are running right now.
            </div>
          ) : (
            <div className="space-y-3">
              {activeJobs.map((job, index) => (
                <div key={job.id} className="grid grid-cols-[1fr_auto] gap-2">
                  <JobCard job={job} now={now} />
                  <div className="flex flex-col gap-1">
                    <button
                      aria-label={`Move ${job.title} up`}
                      className="rounded-md border border-[#321919] px-2 py-1 text-xs text-[#caa2a2] disabled:opacity-35"
                      disabled={index === 0 || job.status === 'running'}
                      onClick={() => moveJob(job.id, -1)}
                    >
                      Up
                    </button>
                    <button
                      aria-label={`Move ${job.title} down`}
                      className="rounded-md border border-[#321919] px-2 py-1 text-xs text-[#caa2a2] disabled:opacity-35"
                      disabled={index === activeJobs.length - 1 || job.status === 'running'}
                      onClick={() => moveJob(job.id, 1)}
                    >
                      Down
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {finishedJobs.length > 0 && (
          <section className="mt-5 border-t border-[#2a1212] pt-5">
            <div className="flex items-center justify-between gap-3">
              <button
                aria-expanded={finishedOpen}
                className="text-sm font-semibold text-[#f2d1d1] transition-colors hover:text-[#fff3f3]"
                onClick={() => setFinishedOpen((open) => !open)}
              >
                Finished ({finishedJobs.length})
              </button>
              <button
                className="text-xs text-[#b98e8e] transition-colors hover:text-[#fff1f1]"
                onClick={handleClearDone}
              >
                Clear done
              </button>
            </div>

            {finishedOpen && (
              <div className="mt-3 space-y-3">
                {finishedJobs.map((job) => (
                  <JobCard key={job.id} job={job} quiet />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </aside>
  )
}
