import { useEffect } from 'react'
import Sidebar from './components/Sidebar'
import Dialogs from './components/Dialogs'
import WorkbenchPage from './pages/WorkbenchPage'
import StudioPage from './pages/StudioPage'
import SettingsPage from './pages/SettingsPage'
import SkillsPage from './pages/SkillsPage'
import ExpertsPage from './pages/ExpertsPage'
import McpPage from './pages/McpPage'
import ProjectsPage from './pages/ProjectsPage'
import AccountPage from './pages/AccountPage'
import Toast from './components/Toast'
import { useApp } from './lib/store'
import type { ViewId } from '@shared/protocol'

const GUEST_VIEWS = new Set<ViewId>(['account', 'settings'])

export default function App() {
  const view = useApp((s) => s.view)
  const apiKey = useApp((s) => s.settings?.apiKey)
  const hydrate = useApp((s) => s.hydrate)
  const applyEvent = useApp((s) => s.applyEvent)
  const loggedIn = Boolean(apiKey)
  const shown: ViewId = !loggedIn && !GUEST_VIEWS.has(view) ? 'account' : view

  useEffect(() => {
    if (!window.gt) {
      console.error('window.gt 未注入，预加载失败')
      return
    }
    void hydrate().catch((err) => console.error('hydrate failed', err))
    return window.gt.tasks.onEvent(({ taskId, event, runId }) => applyEvent(taskId, event, runId))
  }, [hydrate, applyEvent])

  useEffect(() => {
    if (!loggedIn && !GUEST_VIEWS.has(view)) useApp.getState().setView('account')
  }, [loggedIn, view])

  return (
    <div className="flex h-full bg-ink text-text">
      <Sidebar />
      {shown === 'workbench' && <WorkbenchPage />}
      {shown === 'studio' && <StudioPage />}
      {shown === 'settings' && <SettingsPage />}
      {shown === 'skills' && <SkillsPage />}
      {shown === 'experts' && <ExpertsPage />}
      {shown === 'mcp' && <McpPage />}
      {shown === 'projects' && <ProjectsPage />}
      {shown === 'account' && <AccountPage />}
      <Dialogs />
      <Toast />
    </div>
  )
}
