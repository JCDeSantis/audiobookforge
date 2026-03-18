import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbsBookSummary, TranscriptionJob } from '../../../../shared/types'
import { QueueConfirmationModal } from '../QueueConfirmationModal'
import { useAppStore } from '../../store/useAppStore'

const initialState = useAppStore.getState()

function createAbsItem(overrides: Partial<AbsBookSummary> = {}): AbsBookSummary {
  return {
    id: 'abs-1',
    libraryId: 'library-1',
    folderId: 'folder-1',
    relPath: '/books/test',
    isFile: false,
    title: 'Red Rising',
    authorName: 'Pierce Brown',
    duration: 6400,
    cover: null,
    hasSubtitles: false,
    ebookPath: 'C:\\Books\\Red Rising.epub',
    audioFiles: [
      {
        index: 0,
        ino: '11',
        contentUrl: '/media/red-rising-part-1.mp3',
        metadata: {
          filename: 'Red Rising Part 1.mp3',
          ext: 'mp3',
          path: '/books/test/part-1.mp3',
          relPath: 'part-1.mp3'
        },
        duration: 3200,
        mimeType: 'audio/mpeg',
        addedAt: 0,
        updatedAt: 0
      },
      {
        index: 1,
        ino: '22',
        contentUrl: null,
        metadata: {
          filename: 'Red Rising Part 2.mp3',
          ext: 'mp3',
          path: '/books/test/part-2.mp3',
          relPath: 'part-2.mp3'
        },
        duration: 3200,
        mimeType: 'audio/mpeg',
        addedAt: 0,
        updatedAt: 0
      }
    ],
    ...overrides
  }
}

function createQueuedJob(overrides: Partial<TranscriptionJob> = {}): TranscriptionJob {
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

describe('QueueConfirmationModal', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
  })

  it('shows the local output folder in the summary', () => {
    act(() => {
      useAppStore.getState().selectLocalFiles(['C:\\Audio\\red-rising.m4b'])
      useAppStore.getState().setWizardOutputFolder('C:\\Output')
      useAppStore.getState().setConfirmationOpen(true)
    })

    render(<QueueConfirmationModal />)

    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.getByText('C:\\Output')).toBeInTheDocument()
  })

  it('shows automatic ABS upload messaging for ABS jobs', () => {
    act(() => {
      useAppStore.getState().selectAbsItem(createAbsItem())
      useAppStore.getState().setConfirmationOpen(true)
    })

    render(<QueueConfirmationModal />)

    expect(screen.getByText('Upload to ABS automatically')).toBeInTheDocument()
  })

  it('builds and submits the current draft when add to queue is clicked', async () => {
    const addMock = vi
      .fn<typeof window.electron.queue.add>()
      .mockResolvedValue(createQueuedJob({ source: 'abs', absItemId: 'abs-1' }))

    window.electron.queue.add = addMock

    act(() => {
      useAppStore.getState().setSettings({
        absUrl: 'http://abs.local/',
        defaultModel: 'large-v3-turbo'
      })
      useAppStore.getState().selectAbsItem(createAbsItem())
      useAppStore.getState().setConfirmationOpen(true)
    })

    render(<QueueConfirmationModal />)

    fireEvent.click(screen.getByRole('button', { name: 'Add to Queue' }))

    expect(addMock).toHaveBeenCalledWith({
      source: 'abs',
      title: 'Red Rising',
      audioFiles: [],
      outputPath: null,
      absItemId: 'abs-1',
      absLibraryId: 'library-1',
      absFolderId: 'folder-1',
      absAuthorName: 'Pierce Brown',
      epubPath: 'C:\\Books\\Red Rising.epub',
      model: 'large-v3-turbo'
    })
  })

  it('submits one queue job per selected ABS book', async () => {
    const addMock = vi
      .fn<typeof window.electron.queue.add>()
      .mockResolvedValue(createQueuedJob({ source: 'abs', absItemId: 'abs-1' }))

    window.electron.queue.add = addMock

    act(() => {
      useAppStore.getState().setSettings({
        absUrl: 'http://abs.local/',
        defaultModel: 'large-v3-turbo'
      })
      useAppStore.getState().selectAbsItems([
        createAbsItem(),
        createAbsItem({
          id: 'abs-2',
          title: 'Golden Son',
          authorName: 'Pierce Brown',
          ebookPath: null
        })
      ])
      useAppStore.getState().setWizardEpubPath('C:\\Books\\Shared Context.epub')
      useAppStore.getState().setConfirmationOpen(true)
    })

    render(<QueueConfirmationModal />)

    fireEvent.click(screen.getByRole('button', { name: 'Add 2 Jobs to Queue' }))

    await waitFor(() => {
      expect(addMock).toHaveBeenCalledTimes(2)
    })

    expect(addMock).toHaveBeenNthCalledWith(1, {
      source: 'abs',
      title: 'Red Rising',
      audioFiles: [],
      outputPath: null,
      absItemId: 'abs-1',
      absLibraryId: 'library-1',
      absFolderId: 'folder-1',
      absAuthorName: 'Pierce Brown',
      epubPath: 'C:\\Books\\Red Rising.epub',
      model: 'large-v3-turbo'
    })
    expect(addMock).toHaveBeenNthCalledWith(2, {
      source: 'abs',
      title: 'Golden Son',
      audioFiles: [],
      outputPath: null,
      absItemId: 'abs-2',
      absLibraryId: 'library-1',
      absFolderId: 'folder-1',
      absAuthorName: 'Pierce Brown',
      epubPath: 'C:\\Books\\Shared Context.epub',
      model: 'large-v3-turbo'
    })
  })

  it('closes on back without resetting the draft', () => {
    act(() => {
      useAppStore.getState().selectLocalFiles(['C:\\Audio\\red-rising.m4b'])
      useAppStore.getState().setWizardOutputFolder('C:\\Output')
      useAppStore.getState().setConfirmationOpen(true)
    })

    render(<QueueConfirmationModal />)

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(useAppStore.getState().ui.confirmationOpen).toBe(false)
    expect(useAppStore.getState().wizard.audioFiles).toEqual(['C:\\Audio\\red-rising.m4b'])
    expect(useAppStore.getState().wizard.outputFolder).toBe('C:\\Output')
  })
})
