import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../../App'
import { useAppStore } from '../../store/useAppStore'

const initialState = useAppStore.getState()

describe('App shell composer flow', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
  })

  it('renders the new header and source actions with continue disabled', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'New Transcription' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Browse Files/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Browse AudioBookShelf/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('reveals local output settings and only enables continue when required fields exist', async () => {
    render(<App />)

    await screen.findByRole('heading', { name: 'New Transcription' })

    act(() => {
      useAppStore.getState().selectLocalFiles(['C:\\Audio\\book.m4b'])
    })

    expect(screen.getByText('Output Folder')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    act(() => {
      useAppStore.getState().setWizardOutputFolder('C:\\Output')
    })

    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('clears source-specific controls when the user changes the selected source', async () => {
    render(<App />)

    await screen.findByRole('heading', { name: 'New Transcription' })

    act(() => {
      useAppStore.getState().selectLocalFiles(['C:\\Audio\\book.m4b'])
      useAppStore.getState().setWizardOutputFolder('C:\\Output')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Change' }))

    expect(screen.getByRole('button', { name: /Browse Files/i })).toBeInTheDocument()
    expect(screen.queryByText('Output Folder')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })
})
