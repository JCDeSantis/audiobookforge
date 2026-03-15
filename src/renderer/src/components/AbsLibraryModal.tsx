import React from 'react'
import { useState, useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import type { AbsBook } from '../../../shared/types'

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function subtitleBadge(book: AbsBook, inQueue: boolean): React.JSX.Element {
  if (inQueue) {
    return (
      <span className="rounded-[3px] bg-[#1d4ed8] px-1.5 py-0.5 text-[9px] text-[#93c5fd]">
        In Queue
      </span>
    )
  }
  if (book.hasSubtitles) {
    return (
      <span className="rounded-[3px] bg-[#14532d] px-1.5 py-0.5 text-[9px] text-[#4ade80]">
        Has SRT
      </span>
    )
  }
  return (
    <span className="rounded-[3px] bg-[#1a0000] px-1.5 py-0.5 text-[9px] text-[#6b2222]">
      No SRT
    </span>
  )
}

export function AbsLibraryModal(): React.JSX.Element {
  const {
    settings,
    absLibrary,
    queue,
    setAbsLibraries,
    setAbsBooks,
    setAbsConnected,
    setWizardAbsItem,
    setWizardSource,
    setAbsModalOpen
  } = useAppStore()

  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const queuedAbsIds = new Set(
    queue.jobs
      .filter((j) => j.source === 'abs' && (j.status === 'queued' || j.status === 'running'))
      .map((j) => j.absItemId)
      .filter(Boolean) as string[]
  )

  const loadLibraries = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const libs = await window.electron.abs.getLibraries()
      setAbsLibraries(libs)
      setAbsConnected(true)
      if (libs.length > 0 && !selectedLibraryId) {
        setSelectedLibraryId(libs[0].id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect to ABS')
      setAbsConnected(false)
    } finally {
      setLoading(false)
    }
  }

  const loadBooks = async (libraryId: string): Promise<void> => {
    if (absLibrary.books[libraryId]) return
    setLoading(true)
    setError(null)
    try {
      const books = await window.electron.abs.getBooks(libraryId)
      setAbsBooks(libraryId, books)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load books')
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const libs = await window.electron.abs.getLibraries()
      setAbsLibraries(libs)
      // Reload current library's books
      if (selectedLibraryId) {
        const books = await window.electron.abs.getBooks(selectedLibraryId)
        setAbsBooks(selectedLibraryId, books)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (absLibrary.libraries.length === 0) {
      loadLibraries()
    } else if (absLibrary.libraries.length > 0 && !selectedLibraryId) {
      setSelectedLibraryId(absLibrary.libraries[0].id)
    }
  }, [])

  useEffect(() => {
    if (selectedLibraryId) {
      loadBooks(selectedLibraryId)
    }
  }, [selectedLibraryId])

  const currentBooks = selectedLibraryId ? (absLibrary.books[selectedLibraryId] ?? []) : []
  const filteredBooks = search
    ? currentBooks.filter(
        (b) =>
          b.title.toLowerCase().includes(search.toLowerCase()) ||
          b.authorName.toLowerCase().includes(search.toLowerCase())
      )
    : currentBooks

  const [selecting, setSelecting] = useState<string | null>(null)

  const handleSelectBook = async (book: AbsBook): Promise<void> => {
    setSelecting(book.id)
    try {
      // Fetch full item details to get audioFiles (not included in library list response)
      const fullBook = await window.electron.abs.getBook(book.id)
      setWizardAbsItem({
        id: fullBook.id,
        libraryId: fullBook.libraryId,
        folderId: fullBook.folderId,
        title: fullBook.title,
        authorName: fullBook.authorName,
        duration: fullBook.duration,
        cover: fullBook.cover,
        hasSubtitles: fullBook.hasSubtitles,
        ebookPath: fullBook.ebookPath,
        audioFiles: fullBook.audioFiles
      })
      setWizardSource('abs')
      setAbsModalOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load book details')
    } finally {
      setSelecting(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="flex h-[600px] w-[700px] flex-col rounded-xl border border-[#2a0000] bg-[#0a0000] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2a0000] px-4 py-3">
          <span className="text-[13px] font-semibold text-[#fef2f2]">AudioBookShelf Library</span>
          <div className="flex items-center gap-2">
            <button
              className="text-[11px] text-[#6b2222] hover:text-[#fca5a5] transition-colors"
              onClick={handleRefresh}
              disabled={loading}
            >
              ↻ Refresh
            </button>
            <button
              className="text-[11px] text-[#6b2222] hover:text-[#fca5a5] transition-colors"
              onClick={() => setAbsModalOpen(false)}
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="border-b border-[#3f0000] bg-[#0d0000] px-4 py-2 text-[11px] text-[#dc2626]">
            {error}
            {settings.absUrl === '' && (
              <span className="ml-1 text-[#6b2222]">
                — Configure ABS URL in settings first.
              </span>
            )}
          </div>
        )}

        {/* Library tabs */}
        {absLibrary.libraries.length > 0 && (
          <div className="flex gap-0 border-b border-[#2a0000] px-4">
            {absLibrary.libraries.map((lib) => (
              <button
                key={lib.id}
                className={`px-3 py-2 text-[11px] font-medium transition-colors border-b-2 ${
                  lib.id === selectedLibraryId
                    ? 'border-[#dc2626] text-[#fca5a5]'
                    : 'border-transparent text-[#6b2222] hover:text-[#fca5a5]'
                }`}
                onClick={() => setSelectedLibraryId(lib.id)}
              >
                {lib.name}
              </button>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="border-b border-[#2a0000] px-4 py-2">
          <input
            className="w-full rounded border border-[#2a0000] bg-[#0d0000] px-3 py-1.5 text-[11px] text-[#fef2f2] placeholder-[#3f0000] focus:border-[#dc2626] focus:outline-none"
            placeholder="Search title or author..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Book list */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading && (
            <div className="flex h-full items-center justify-center text-[11px] text-[#6b2222]">
              Loading...
            </div>
          )}
          {!loading && filteredBooks.length === 0 && (
            <div className="flex h-full items-center justify-center text-[11px] text-[#3f0000]">
              {absLibrary.libraries.length === 0
                ? 'Connect to ABS in settings to browse your library.'
                : 'No books found.'}
            </div>
          )}
          <div className="grid grid-cols-1 gap-1.5">
            {filteredBooks.map((book) => (
              <div
                key={book.id}
                className={`flex items-center gap-3 rounded border px-3 py-2 transition-colors ${
                  selecting === book.id
                    ? 'cursor-wait border-[#3f0000] bg-[#120000] opacity-70'
                    : selecting !== null
                    ? 'cursor-not-allowed border-[#1a0000] bg-[#0d0000] opacity-40'
                    : 'cursor-pointer border-[#1a0000] bg-[#0d0000] hover:border-[#3f0000] hover:bg-[#120000]'
                }`}
                onClick={() => selecting === null && handleSelectBook(book)}
              >
                {/* Cover art */}
                {book.cover ? (
                  <img
                    src={book.cover}
                    alt={book.title}
                    className="h-10 w-8 flex-shrink-0 rounded object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                ) : (
                  <div className="flex h-10 w-8 flex-shrink-0 items-center justify-center rounded bg-[#1a0000] text-[16px]">
                    📚
                  </div>
                )}

                {/* Info */}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[11px] font-semibold leading-tight text-[#fef2f2] line-clamp-1">
                    {book.title}
                  </span>
                  <span className="text-[10px] text-[#6b2222]">
                    {book.authorName} · {formatDuration(book.duration)}
                  </span>
                </div>

                {/* Status badge */}
                <div className="flex-shrink-0">
                  {selecting === book.id ? (
                    <span className="rounded-[3px] bg-[#1a0000] px-1.5 py-0.5 text-[9px] text-[#6b2222]">
                      Loading…
                    </span>
                  ) : (
                    subtitleBadge(book, queuedAbsIds.has(book.id))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
