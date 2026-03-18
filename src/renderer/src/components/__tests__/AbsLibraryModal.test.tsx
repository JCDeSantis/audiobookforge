import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AbsBook } from '../../../../shared/types'
import { AbsLibraryModal } from '../AbsLibraryModal'
import { useAppStore } from '../../store/useAppStore'

const initialState = useAppStore.getState()

function createBook(overrides: Partial<AbsBook>): AbsBook {
  return {
    id: 'book-1',
    libraryId: 'library-1',
    folderId: 'folder-1',
    relPath: '/Author/Series/Book',
    isFile: false,
    title: 'The Way of Kings',
    authorName: 'Brandon Sanderson',
    duration: 1680,
    cover: null,
    hasSubtitles: false,
    ebookPath: null,
    audioFiles: [
      {
        index: 0,
        ino: 'ino-1',
        contentUrl: null,
        metadata: {
          filename: 'book-1.m4b',
          ext: '.m4b',
          path: '/Author/Series/Book/book-1.m4b',
          relPath: 'book-1.m4b'
        },
        duration: 1680,
        mimeType: 'audio/mp4',
        addedAt: 1,
        updatedAt: 1
      }
    ],
    ...overrides
  }
}

const books: AbsBook[] = [
  createBook({
    id: 'book-1',
    title: 'The Way of Kings',
    authorName: 'Brandon Sanderson',
    hasSubtitles: false
  }),
  createBook({
    id: 'book-2',
    title: 'Atlas Shrugged',
    authorName: 'Ayn Rand',
    hasSubtitles: true
  }),
  createBook({
    id: 'book-3',
    title: 'Project Hail Mary',
    authorName: 'Andy Weir',
    hasSubtitles: false
  })
]

describe('AudioBookShelf library modal', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)

    useAppStore.setState({
      settings: { absUrl: 'http://abs.local', defaultModel: 'large-v3-turbo' },
      absModalOpen: true,
      absLibrary: {
        connected: true,
        libraries: [{ id: 'library-1', name: 'Main Shelf', mediaType: 'book' }],
        books: { 'library-1': books },
        lastFetched: Date.now()
      }
    })
  })

  it('sorts the book grid by title, author, and subtitle status', async () => {
    render(<AbsLibraryModal />)

    await screen.findByRole('heading', { level: 3, name: 'Atlas Shrugged' })

    const getVisibleTitles = (): string[] =>
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent ?? '')

    expect(getVisibleTitles()).toEqual([
      'Project Hail Mary',
      'The Way of Kings',
      'Atlas Shrugged'
    ])

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'author' } })
    expect(getVisibleTitles()).toEqual([
      'Project Hail Mary',
      'Atlas Shrugged',
      'The Way of Kings'
    ])

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'missing-srt' } })
    expect(getVisibleTitles()).toEqual([
      'Project Hail Mary',
      'The Way of Kings',
      'Atlas Shrugged'
    ])

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'has-srt' } })
    expect(getVisibleTitles()).toEqual([
      'Atlas Shrugged',
      'Project Hail Mary',
      'The Way of Kings'
    ])
  })

  it('selects a grid card and loads it back into the composer', async () => {
    render(<AbsLibraryModal />)

    fireEvent.click(await screen.findByRole('button', { name: /Project Hail Mary/i }))

    await waitFor(() => {
      expect(useAppStore.getState().wizard.absItem?.id).toBe('book-3')
      expect(useAppStore.getState().wizard.absItems.map((item) => item.id)).toEqual(['book-3'])
      expect(useAppStore.getState().absModalOpen).toBe(false)
    })
  })

  it('supports multi-select and loads several books into the composer', async () => {
    render(<AbsLibraryModal />)

    fireEvent.click(screen.getByRole('button', { name: 'Batch Select' }))
    fireEvent.click(await screen.findByRole('button', { name: /Project Hail Mary/i }))
    fireEvent.click(screen.getByRole('button', { name: /The Way of Kings/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Selected (2)' }))

    await waitFor(() => {
      expect(useAppStore.getState().wizard.absItems.map((item) => item.id)).toEqual([
        'book-3',
        'book-1'
      ])
      expect(useAppStore.getState().wizard.absItem?.id).toBe('book-3')
      expect(useAppStore.getState().absModalOpen).toBe(false)
    })
  })
})
