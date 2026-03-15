import { useEffect } from 'react'
import { useAppStore } from './store/useAppStore'
import { SourcePage } from './pages/SourcePage'
import { SettingsPage } from './pages/SettingsPage'
import { TranscribePage } from './pages/TranscribePage'
import { QueuePanel } from './components/QueuePanel'
import { AbsLibraryModal } from './components/AbsLibraryModal'

export default function App(): JSX.Element {
  const { wizard, setJobs, setSettings, absModalOpen } = useAppStore()

  // Load settings and queue on mount, subscribe to live queue updates
  useEffect(() => {
    window.electron.settings.get().then(setSettings).catch(console.error)
    window.electron.queue.getAll().then(setJobs).catch(console.error)

    const unsub = window.electron.queue.onUpdated((jobs) => setJobs(jobs))
    return unsub
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0a0000]">
      {/* Left: 3-step wizard */}
      <div className="flex flex-1 flex-col overflow-hidden border-r border-[#2a0000]">
        {wizard.step === 1 && <SourcePage />}
        {wizard.step === 2 && <SettingsPage />}
        {wizard.step === 3 && <TranscribePage />}
      </div>

      {/* Right: persistent queue panel — also owns AppSettingsPanel */}
      <QueuePanel />

      {/* ABS Library Modal */}
      {absModalOpen && <AbsLibraryModal />}
    </div>
  )
}
