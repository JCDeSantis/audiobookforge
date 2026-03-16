import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
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
    completedAt: null,
    ...overrides
  }
}

describe('QueuePanel', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
  })

  it('shows an active-job count for queued and running jobs', () => {
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

    expect(screen.getByText('2 active')).toBeInTheDocument()
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
})
