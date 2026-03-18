import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptionJob } from '../../../../shared/types'
import { QueuePanel } from '../QueuePanel'
import { useAppStore } from '../../store/useAppStore'

const initialState = useAppStore.getState()

function createJob(overrides: Partial<TranscriptionJob> = {}): TranscriptionJob {
  return {
    id: 'job-1',
    status: 'queued',
    source: 'local',
    title: 'Red Rising',
    audioFiles: ['C:\\Audio\\red-rising.m4b'],
    outputPath: 'C:\\Output',
    absItemId: null,
    absLibraryId: null,
    absFolderId: null,
    absAuthorName: null,
    epubPath: null,
    model: 'large-v3-turbo',
    progress: null,
    srtPath: null,
    srtPaths: [],
    error: null,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    ...overrides
  }
}

describe('QueuePanel', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    useAppStore.setState(initialState, true)
  })

  it('renders the active jobs section without the old queue summary copy', () => {
    useAppStore.getState().setJobs([
      createJob({ id: 'queued-job', title: 'Queued Book', status: 'queued' }),
      createJob({
        id: 'running-job',
        title: 'Running Book',
        status: 'running',
        progress: { jobId: 'running-job', phase: 'transcribing', percent: 42 }
      }),
      createJob({ id: 'done-job', title: 'Finished Book', status: 'done', completedAt: Date.now() })
    ])

    render(<QueuePanel />)

    expect(screen.getByText('Active Jobs')).toBeInTheDocument()
    expect(screen.queryByText('Queue')).not.toBeInTheDocument()
    expect(screen.queryByText('Jobs in motion and recent completions stay here.')).not.toBeInTheDocument()
  })

  it('keeps finished jobs collapsed until expanded', () => {
    useAppStore.getState().setJobs([
      createJob({ id: 'queued-job', title: 'Queued Book', status: 'queued' }),
      createJob({
        id: 'done-job',
        title: 'Finished Book',
        status: 'done',
        completedAt: Date.now()
      }),
      createJob({
        id: 'failed-job',
        title: 'Failed Book',
        status: 'failed',
        error: 'Whisper exited unexpectedly',
        completedAt: Date.now()
      })
    ])

    render(<QueuePanel />)

    expect(screen.queryByText('Finished Book')).not.toBeInTheDocument()
    expect(screen.queryByText('Failed Book')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Finished (2)' }))

    expect(screen.getByText('Finished Book')).toBeInTheDocument()
    expect(screen.getByText('Failed Book')).toBeInTheDocument()
  })

  it('does not render the old settings entry point in the rail footer', () => {
    render(<QueuePanel />)

    expect(
      screen.queryByRole('button', { name: 'ABS Connection Settings' })
    ).not.toBeInTheDocument()
  })

  it('shows a cleaned model family name in job metadata', () => {
    useAppStore.getState().setJobs([
      createJob({
        id: 'running-job',
        status: 'running',
        model: 'large-v3-turbo-q5_0',
        progress: { jobId: 'running-job', phase: 'transcribing', percent: 42 }
      })
    ])

    render(<QueuePanel />)

    expect(screen.getByText('Local files - Large V3 Turbo')).toBeInTheDocument()
  })

  it('keeps the source and model metadata on one line', () => {
    useAppStore.getState().setJobs([
      createJob({
        id: 'running-job',
        status: 'running',
        source: 'abs',
        progress: { jobId: 'running-job', phase: 'transcribing', percent: 42 }
      })
    ])

    render(<QueuePanel />)

    expect(screen.getByTitle('AudioBookShelf - Large V3 Turbo')).toHaveClass('whitespace-nowrap')
  })

  it('keeps running live text to a single status line', () => {
    const liveText =
      'This is a very long subtitle preview that should stay on one line in the queue card.'

    useAppStore.getState().setJobs([
      createJob({
        id: 'running-job',
        status: 'running',
        progress: {
          jobId: 'running-job',
          phase: 'transcribing',
          percent: 42,
          liveText
        }
      })
    ])

    render(<QueuePanel />)

    expect(screen.getByTitle(liveText)).toHaveClass(
      'h-5',
      'overflow-hidden',
      'text-ellipsis',
      'whitespace-nowrap'
    )
  })

  it('reserves space for live text even before subtitles appear', () => {
    useAppStore.getState().setJobs([
      createJob({
        id: 'running-job',
        status: 'running',
        progress: { jobId: 'running-job', phase: 'transcribing', percent: 42 }
      })
    ])

    render(<QueuePanel />)

    expect(screen.getByTitle('')).toHaveClass('mt-2', 'h-5')
  })

  it('shows elapsed time for the active running job', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-16T13:10:00Z'))

    useAppStore.getState().setJobs([
      createJob({
        id: 'running-job',
        status: 'running',
        startedAt: Date.parse('2026-03-16T13:07:55Z'),
        progress: { jobId: 'running-job', phase: 'transcribing', percent: 42 }
      })
    ])

    render(<QueuePanel />)

    expect(screen.getByText('Elapsed 2:05')).toBeInTheDocument()
  })

  it('uses whole-job progress in the status badge while keeping phase progress in the card body', () => {
    useAppStore.getState().setJobs([
      createJob({
        id: 'running-job',
        status: 'running',
        progress: {
          jobId: 'running-job',
          phase: 'transcribing',
          percent: 42,
          overallPercent: 68
        }
      })
    ])

    render(<QueuePanel />)

    expect(screen.getByText('Running 68%')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
  })

  it('lets queued jobs be removed directly from the active jobs section', () => {
    const removeMock = vi.fn<typeof window.electron.queue.remove>()
    window.electron.queue.remove = removeMock

    useAppStore.getState().setJobs([
      createJob({ id: 'queued-job', title: 'Queued Book', status: 'queued' })
    ])

    render(<QueuePanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(removeMock).toHaveBeenCalledWith('queued-job')
  })
})
