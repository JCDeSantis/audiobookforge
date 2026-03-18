import { beforeEach, describe, expect, it } from 'vitest'
import type { AbsBookSummary } from '../../../../shared/types'
import { useAppStore } from '../useAppStore'

const initialState = useAppStore.getState()

function createAbsItem(overrides: Partial<AbsBookSummary> = {}): AbsBookSummary {
  return {
    id: 'abs-1',
    libraryId: 'library-1',
    folderId: 'folder-1',
    relPath: '/books/test',
    isFile: false,
    title: 'Leviathan Wakes',
    authorName: 'James S. A. Corey',
    duration: 6400,
    cover: null,
    hasSubtitles: false,
    ebookPath: 'C:\\Books\\Leviathan Wakes.epub',
    audioFiles: [],
    ...overrides
  }
}

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
  })

  it('applies a new default model only to a fresh draft', () => {
    useAppStore.getState().setSettings({ absUrl: '', defaultModel: 'medium' })
    expect(useAppStore.getState().wizard.model).toBe('medium')

    useAppStore.getState().selectLocalFiles(['C:\\Audio\\book.m4b'])
    useAppStore.getState().setSettings({ absUrl: '', defaultModel: 'large-v3' })

    expect(useAppStore.getState().wizard.model).toBe('medium')
  })

  it('clears local state when switching from local files to ABS', () => {
    useAppStore.getState().setWizardOutputFolder('C:\\Output')
    useAppStore.getState().selectLocalFiles(['C:\\Audio\\book.m4b'])

    useAppStore.getState().selectAbsItem(createAbsItem())

    expect(useAppStore.getState().wizard.source).toBe('abs')
    expect(useAppStore.getState().wizard.audioFiles).toEqual([])
    expect(useAppStore.getState().wizard.outputFolder).toBeNull()
    expect(useAppStore.getState().wizard.absItems).toHaveLength(1)
  })

  it('clears the selected ABS item when switching back to local files', () => {
    useAppStore.getState().selectAbsItem(createAbsItem())

    useAppStore.getState().selectLocalFiles(['C:\\Audio\\book.m4b'])

    expect(useAppStore.getState().wizard.source).toBe('local')
    expect(useAppStore.getState().wizard.absItem).toBeNull()
    expect(useAppStore.getState().wizard.absItems).toEqual([])
  })

  it('stores multiple ABS selections in the draft', () => {
    useAppStore
      .getState()
      .selectAbsItems([
        createAbsItem(),
        createAbsItem({ id: 'abs-2', title: "Caliban's War" })
      ])

    expect(useAppStore.getState().wizard.source).toBe('abs')
    expect(useAppStore.getState().wizard.absItem?.id).toBe('abs-1')
    expect(useAppStore.getState().wizard.absItems.map((item) => item.id)).toEqual([
      'abs-1',
      'abs-2'
    ])
  })

  it('tracks confirmation modal state without resetting the draft', () => {
    useAppStore.getState().selectLocalFiles(['C:\\Audio\\book.m4b'])
    useAppStore.getState().setWizardOutputFolder('C:\\Output')

    useAppStore.getState().setConfirmationOpen(true)
    expect(useAppStore.getState().ui.confirmationOpen).toBe(true)

    useAppStore.getState().setConfirmationOpen(false)
    expect(useAppStore.getState().ui.confirmationOpen).toBe(false)
    expect(useAppStore.getState().wizard.audioFiles).toEqual(['C:\\Audio\\book.m4b'])
  })

  it('resetWizard closes the modal and restores the default model', () => {
    useAppStore.getState().setSettings({ absUrl: '', defaultModel: 'large-v3' })
    useAppStore.getState().setWizardModel('medium')
    useAppStore.getState().setConfirmationOpen(true)

    useAppStore.getState().resetWizard()

    expect(useAppStore.getState().ui.confirmationOpen).toBe(false)
    expect(useAppStore.getState().wizard.model).toBe('large-v3')
    expect(useAppStore.getState().wizard.source).toBeNull()
  })
})
