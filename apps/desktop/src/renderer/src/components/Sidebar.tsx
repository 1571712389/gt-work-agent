import {
  Bot,
  CircleUser,
  FolderKanban,
  Images,
  Plug,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react'
import { useApp } from '../lib/store'
import type { ViewId } from '@shared/protocol'
import BrandMark from './BrandMark'

const NAV: Array<{ id: ViewId; label: string; icon: typeof Bot }> = [
  { id: 'workbench', label: '任务', icon: Bot },
  { id: 'studio', label: '创作', icon: Images },
  { id: 'skills', label: '技能', icon: Sparkles },
  { id: 'experts', label: '专家', icon: Users },
  { id: 'mcp', label: '连接', icon: Plug },
  { id: 'projects', label: '项目', icon: FolderKanban },
  { id: 'account', label: '账户', icon: CircleUser },
  { id: 'settings', label: '设置', icon: Settings },
]

export default function Sidebar() {
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const settings = useApp((s) => s.settings)
  const loggedIn = Boolean(settings?.apiKey)
  const open = (id: ViewId) => {
    if (!loggedIn && id !== 'account' && id !== 'settings') {
      setView('account')
      return
    }
    setView(id)
  }
  return (
    <aside className="flex w-[76px] flex-col items-center border-r border-line bg-panel py-4">
      <button
        type="button"
        className="mb-5 transition-opacity duration-200 hover:opacity-80"
        title="光途Work"
        onClick={() => open('workbench')}
      >
        <BrandMark size={40} />
      </button>
      <nav className="flex flex-1 flex-col gap-1">
        {NAV.slice(0, 6).map((item) => {
          const Icon = item.icon
          const active = view === item.id
          return (
            <button
              key={item.id}
              title={loggedIn ? item.label : '请先登录'}
              onClick={() => open(item.id)}
              className={`flex w-[60px] flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10px] transition-colors duration-200 ${
                active ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-raised hover:text-text'
              } ${loggedIn ? '' : 'opacity-45'}`}
            >
              <Icon size={18} />
              {item.label}
            </button>
          )
        })}
      </nav>
      <div className="flex flex-col gap-1">
        {NAV.slice(6).map((item) => {
          const Icon = item.icon
          const active = view === item.id
          return (
            <button
              key={item.id}
              title={item.label}
              onClick={() => open(item.id)}
              className={`flex w-[60px] flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10px] transition-colors duration-200 ${
                active ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-raised hover:text-text'
              }`}
            >
              <Icon size={18} />
              {item.label}
            </button>
          )
        })}
        {settings?.userEmail ? (
          <div className="mt-1 max-w-[68px] truncate px-1 text-center text-[10px] text-muted" title={settings.userEmail}>
            {settings.userEmail.split('@')[0]}
          </div>
        ) : null}
      </div>
    </aside>
  )
}
