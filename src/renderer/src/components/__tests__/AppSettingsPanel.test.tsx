import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { useAppStore } from '../../store/useAppStore'

const initialState = useAppStore.getState()

describe('App settings flow', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
  })

  it('opens from the header and shows the default model control', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))

    const dialog = await screen.findByRole('dialog', { name: 'Settings' })

    expect(within(dialog).getByText('Default Whisper Model')).toBeInTheDocument()
  })

  it('saves the ABS URL and selected default model through the settings bridge', async () => {
    const setUrlMock = vi.fn().mockResolvedValue(undefined)
    const setDefaultModelMock = vi.fn().mockResolvedValue(undefined)
    const setApiKeyMock = vi.fn().mockResolvedValue(undefined)

    window.electron.settings.setUrl = setUrlMock
    window.electron.settings.setDefaultModel = setDefaultModelMock
    window.electron.settings.setApiKey = setApiKeyMock

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))

    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    fireEvent.change(within(dialog).getByPlaceholderText('https://abs.example.com'), {
      target: { value: 'http://abs.local' }
    })
    fireEvent.change(
      within(dialog).getByPlaceholderText('Enter API key (leave blank to keep existing)'),
      {
        target: { value: 'secret-key' }
      }
    )
    fireEvent.change(within(dialog).getByRole('combobox'), {
      target: { value: 'medium' }
    })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Settings' }))

    await waitFor(() => {
      expect(setUrlMock).toHaveBeenCalledWith('http://abs.local')
      expect(setDefaultModelMock).toHaveBeenCalledWith('medium')
      expect(setApiKeyMock).toHaveBeenCalledWith('secret-key')
    })
  })

  it('blocks insecure remote ABS URLs before save', async () => {
    const setUrlMock = vi.fn().mockResolvedValue(undefined)
    window.electron.settings.setUrl = setUrlMock

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))

    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    fireEvent.change(within(dialog).getByPlaceholderText('https://abs.example.com'), {
      target: { value: 'http://example.com' }
    })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Settings' }))

    expect(
      within(dialog).getByText(
        'Use HTTPS for remote AudioBookShelf servers. HTTP is only allowed on local or private-network hosts.'
      )
    ).toBeInTheDocument()
    expect(setUrlMock).not.toHaveBeenCalled()
  })

  it('closes from the panel itself after opening from the header', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))

    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Settings' }))

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('clears installed whisper models from settings', async () => {
    const getStorageInfoMock = vi
      .fn()
      .mockResolvedValueOnce({
        binaryReady: true,
        binaryVersion: 'v1.8.3',
        gpuEnabled: false,
        gpuDetected: false,
        models: [
          { id: 'tiny', name: 'Tiny', size: '78 MB', downloaded: true },
          { id: 'large-v3-turbo', name: 'Large V3 Turbo (Full)', size: '1.51 GB', downloaded: true }
        ]
      })
      .mockResolvedValueOnce({
        binaryReady: true,
        binaryVersion: 'v1.8.3',
        gpuEnabled: false,
        gpuDetected: false,
        models: []
      })
    const clearModelsMock = vi.fn().mockResolvedValue(undefined)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    window.electron.whisper.getStorageInfo = getStorageInfoMock
    window.electron.whisper.clearModels = clearModelsMock

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))

    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    await screen.findByText('2 Whisper models installed.')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear Installed Models' }))

    await waitFor(() => {
      expect(clearModelsMock).toHaveBeenCalledTimes(1)
      expect(getStorageInfoMock).toHaveBeenCalledTimes(2)
    })

    expect(within(dialog).getByText('Downloaded Whisper models cleared.')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})
