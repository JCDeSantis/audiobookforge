import React, { useEffect } from 'react'
import { AbsLibraryModal } from './components/AbsLibraryModal'
import { AppHeader } from './components/AppHeader'
import { AppSettingsPanel } from './components/AppSettingsPanel'
import { JobComposer } from './components/JobComposer'
import { QueueConfirmationModal } from './components/QueueConfirmationModal'
import { QueuePanel } from './components/QueuePanel'
import { useAppStore } from './store/useAppStore'

export default function App(): React.JSX.Element {
  const { setJobs, setSettings, absModalOpen, ui, setSettingsOpen } = useAppStore()

  useEffect(() => {
    window.electron.settings.get().then(setSettings).catch(console.error)
    window.electron.queue.getAll().then(setJobs).catch(console.error)

    const unsub = window.electron.queue.onUpdated((jobs) => setJobs(jobs))
    return unsub
  }, [setJobs, setSettings])

  return (
    <>
      <div className="flex h-screen w-screen overflow-hidden bg-[#070202]">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-[#2f1212] bg-[linear-gradient(180deg,#090303_0%,#050101_100%)]">
          <AppHeader />
          <JobComposer />
        </div>

        <QueuePanel />
      </div>

      {absModalOpen && <AbsLibraryModal />}
      {ui.confirmationOpen && <QueueConfirmationModal />}
      {ui.settingsOpen && <AppSettingsPanel onClose={() => setSettingsOpen(false)} />}
    </>
  )
}
