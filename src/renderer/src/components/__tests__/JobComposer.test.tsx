import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../../App'
import { useAppStore } from '../../store/useAppStore'

const initialState = useAppStore.getState()

describe('App shell composer flow', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
  })

  it('renders the updated header and source actions without continue before selection', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Audiobook Forge' })).toBeInTheDocument()
    expect(screen.getByLabelText('Version 1.1')).toHaveTextContent('v1.1')
    expect(
      screen.getByText('Generate audiobook subtitles with Audiobookshelf integration')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: /Large V3 Turbo.*547 MB.*Recommended/i })
    ).toBeInTheDocument()
    expect(screen.getByText('Choose Source')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Browse Files/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Browse AudioBookShelf/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /srt/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /srt/i })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /vtt/i })).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
  })

  it('allows VTT and LRC companion outputs to be selected', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('checkbox', { name: /vtt/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /lrc/i }))

    expect(useAppStore.getState().wizard.subtitleFormats).toEqual(['srt', 'vtt', 'lrc'])
  })

  it('reveals local output settings and only enables continue when required fields exist', () => {
    render(<App />)

    const unselectedSourceCard = screen.getByText('Choose Source').closest('section')
    expect(unselectedSourceCard).toHaveClass('h-[10.75rem]', 'overflow-hidden')

    act(() => {
      useAppStore.getState().selectLocalFiles(['C:\\Audio\\book.m4b'])
    })

    const selectedSourceCard = screen.getByText('Selected Source').closest('section')
    expect(selectedSourceCard).toHaveClass('h-[10.75rem]', 'overflow-hidden')
    expect(screen.getByText('Output Folder')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    act(() => {
      useAppStore.getState().setWizardOutputFolder('C:\\Output')
    })

    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('clears source-specific controls when the user changes the selected source', () => {
    render(<App />)

    act(() => {
      useAppStore.getState().selectLocalFiles(['C:\\Audio\\book.m4b'])
      useAppStore.getState().setWizardOutputFolder('C:\\Output')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Change' }))

    expect(screen.getByRole('button', { name: /Browse Files/i })).toBeInTheDocument()
    expect(screen.queryByText('Output Folder')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
  })
})
