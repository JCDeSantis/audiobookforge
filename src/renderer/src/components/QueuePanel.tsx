import React, { useEffect, useState } from 'react'
import type { TranscriptionJob } from '../../../shared/types'
import { getAppClient } from '../lib/appClient'
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
      <span className="status-badge bg-[#7f1d1d] tabular-nums text-[#ffd7d7]">
        Running {badgePercent}%
      </span>
    )
  }

  if (isActive) {
    return <span className="status-badge bg-[#7f1d1d] text-[#ffd7d7]">Running</span>
  }

  if (job.status === 'queued') {
    return <span className="status-badge bg-[#281010] text-[#e2b3b3]">Queued</span>
  }

  if (job.status === 'done') {
    return <span className="status-badge bg-[#183824] text-[#9fe0bb]">Done</span>
  }

  if (job.status === 'failed') {
    return <span className="status-badge bg-[#401414] text-[#ff9f9f]">Failed</span>
  }

  if (job.status === 'cancelled') {
    return <span className="status-badge bg-[#281010] text-[#d3a8a8]">Cancelled</span>
  }

  if (job.status === 'paused') {
    return <span className="status-badge bg-[#2d1828] text-[#efc4ff]">Paused</span>
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
  const stablePhaseLabel = job.progress
    ? phaseLabel(job.progress.phase)
    : job.status === 'paused'
      ? 'Paused'
      : isActive
        ? 'Starting'
        : 'Waiting in queue'

  const handleCancel = (): void => {
    getAppClient().queue.cancel(job.id)
  }

  const handlePause = (): void => {
    getAppClient().queue.pause(job.id)
  }

  const handleResume = (): void => {
    getAppClient().queue.resume(job.id)
  }

  const handleRetry = async (): Promise<void> => {
    await getAppClient().queue.retry(job.id, retryModel)
  }

  const handleRemove = (): void => {
    getAppClient().queue.remove(job.id)
  }

  const handleRevealSaved = (): void => {
    if (savedPaths.length > 0) {
      getAppClient().files.showInExplorer(savedPaths[0])
    }
  }

  const handleDownload = (artifactId: string): void => {
    void getAppClient().files.downloadArtifact(artifactId)
  }

  return (
    <article
      className={`overflow-hidden rounded-lg border px-3.5 py-3 ${quiet ? 'min-h-[9.5rem]' : 'h-[11.75rem]'} ${
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
        <div
          className="h-5 min-w-0 truncate text-sm font-semibold leading-5 text-[#fff1f1]"
          title={job.title}
        >
          {job.title}
        </div>
        <StatusBadge job={job} isActive={isActive} />
      </div>
      <div
        className="mt-1 h-4 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-4 text-[#bb9191]"
        title={`${job.source === 'abs' ? 'AudioBookShelf' : job.source === 'upload' ? 'Browser upload' : 'Local files'} - ${modelName}`}
      >
        {job.source === 'abs' ? 'AudioBookShelf' : job.source === 'upload' ? 'Browser upload' : 'Local files'} - {modelName}
      </div>

      {!quiet && (
        <div
          className="mt-2 h-[4.25rem] overflow-hidden"
          data-testid={`job-progress-slot-${job.id}`}
        >
          <div className="mb-1.5 flex h-5 items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-[#f0c3c3]">{stablePhaseLabel}</span>
            <span className="flex-none tabular-nums text-[#9d7272]">
              {job.progress ? `${job.progress.percent}%` : '\u00A0'}
            </span>
          </div>
          <div
            aria-label={job.progress ? `${job.title} progress` : undefined}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={job.progress?.percent}
            className="h-1.5 overflow-hidden rounded-full bg-[#220d0d]"
            role={job.progress ? 'progressbar' : undefined}
          >
            <div
              className="h-full rounded-full bg-[#dc2626] transition-all"
              style={{ width: `${job.progress?.percent ?? 0}%` }}
            />
          </div>
          <div
            className="mt-2 h-5 overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-5 text-[#b48c8c]"
            title={job.progress?.liveText ?? ''}
          >
            {job.progress?.liveText ?? '\u00A0'}
          </div>
        </div>
      )}

      {job.status === 'failed' && job.error && (
        <p className="stable-clamp-2 mt-2 h-10 text-xs leading-5 text-[#ff9b9b]" title={job.error}>
          {job.error}
        </p>
      )}

      {job.qualityReport && (
        <div className="mt-2 max-h-[5.5rem] overflow-hidden rounded-md border border-[#321919] bg-[#0b0404] px-3 py-2 text-xs leading-5 text-[#caa2a2]">
          <div className="font-medium text-[#f1d6d6]">
            Quality{' '}
            {job.qualityReport.issueCount === 0
              ? 'looks clean'
              : `${job.qualityReport.issueCount} item${job.qualityReport.issueCount === 1 ? '' : 's'}`}
          </div>
          <div>
            {job.qualityReport.cueCount} cues, {job.qualityReport.coveragePercent}% coverage
          </div>
          {job.qualityReport.issues[0] && (
            <div className="truncate text-[#f0b4b4]" title={job.qualityReport.issues[0].message}>
              {job.qualityReport.issues[0].message}
            </div>
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

      {job.status === 'done' &&
        savedPaths.length === 0 &&
        job.source === 'abs' &&
        !job.resultArtifactIds?.length && (
        <div className="mt-3 text-xs text-[#97d8ad]">Uploaded to AudioBookShelf</div>
      )}

      {job.status === 'done' && job.source === 'abs' && job.deliveryWarning && (
        <div className="mt-2 truncate text-xs text-[#f6c76a]" title={job.deliveryWarning}>
          ABS upload fallback — download results below
        </div>
      )}

      <div className={`${quiet ? 'mt-3' : 'mt-2'} flex h-8 items-center gap-2 text-xs`}>
        {!quiet && (
          <div className="min-w-[4.75rem] flex-none tabular-nums text-[#9d7272]">
            {elapsedText ? `Elapsed ${elapsedText}` : '\u00A0'}
          </div>
        )}

        <div className="ml-auto flex min-w-0 flex-nowrap justify-end gap-1.5">
          {job.status === 'done' &&
            (job.source === 'upload' || job.source === 'abs') &&
            job.resultArtifactIds?.map((artifactId, index) => (
              <button
                key={artifactId}
                className="rounded-md border border-[#28543a] px-2.5 py-1.5 text-[#a9e3bd] transition-colors hover:border-[#4b9a69] hover:text-[#effff4]"
                onClick={() => handleDownload(artifactId)}
              >
                {job.resultArtifactIds!.length === 1 ? 'Download' : `Download ${index + 1}`}
              </button>
            ))}
          {isActive && (
            <button
              className="h-8 rounded-md border border-[#5b1f1f] px-2.5 text-[#f0c7c7] transition-colors hover:border-[#dc2626] hover:text-[#fff3f3]"
              onClick={handlePause}
            >
              Pause
            </button>
          )}
          {isActive && (
            <button
              className="h-8 rounded-md border border-[#5b1f1f] px-2.5 text-[#f0c7c7] transition-colors hover:border-[#dc2626] hover:text-[#fff3f3]"
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
    getAppClient().queue.clearDone()
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
    getAppClient().queue.reorder(ordered)
  }

  return (
    <aside className="flex w-[336px] flex-shrink-0 flex-col border-l border-[#2f1515] bg-[linear-gradient(180deg,#090303_0%,#050101_100%)]">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3.5 py-4">
        <section>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9f7171]">
            Active Jobs
          </div>
          {activeJobs.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-[#352020] bg-[#0d0505] px-4 py-5 text-sm text-[#9e7474]">
              No jobs are running right now.
            </div>
          ) : (
            <div className="space-y-2.5">
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
