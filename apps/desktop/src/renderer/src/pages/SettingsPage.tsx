import { useState, type ReactNode } from 'react'
import {
  CheckCircle2,
  CircleAlert,
  CircleUser,
  FolderOpen,
  RefreshCw,
  Shield,
} from 'lucide-react'
import { useApp } from '../lib/store'
import PageShell from '../components/PageShell'

function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: typeof CircleUser
  title: string
  hint: string
  children: ReactNode
}) {
  return (
    <section className="gt-card overflow-hidden">
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon size={18} strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-xs text-muted">{hint}</p>
        </div>
      </header>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  )
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-text">
        {label}
      </label>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      <div className="mt-2">{children}</div>
    </div>
  )
}

export default function SettingsPage() {
  const settings = useApp((s) => s.settings)
  const [updateMsg, setUpdateMsg] = useState('')
  const [updateKind, setUpdateKind] = useState<'ok' | 'warn' | ''>('')
  const [checking, setChecking] = useState(false)
  if (!settings) {
    return (
      <PageShell title="设置" subtitle="正在加载客户端配置…">
        <p className="text-sm text-muted">请稍候。若一直空白，请完全退出后重新打开客户端。</p>
      </PageShell>
    )
  }
  const update = (patch: Partial<typeof settings>) => {
    const next = { ...settings, ...patch }
    useApp.setState({ settings: next })
    void window.gt.settings.set(next)
  }
  const email = settings.userEmail || '账户'

  return (
    <PageShell title="设置" subtitle="工作空间、权限和客户端行为。模型和套餐由账户决定。">
      <div className="mx-auto max-w-3xl space-y-5">
        <Section icon={CircleUser} title="账户" hint="登录状态、套餐和用量都在账户页管理。">
          {settings.apiKey ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">
                  {email.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{email}</div>
                  <div className="text-xs text-muted">已登录，套餐与用量请到账户页查看</div>
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-xl border border-line px-3 py-1.5 text-sm text-primary transition-colors duration-200 hover:border-primary/40"
                onClick={() => useApp.getState().setView('account')}
              >
                管理账户
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-3 py-3 text-left transition-colors duration-200 hover:bg-primary/10"
              onClick={() => useApp.getState().setView('account')}
            >
              <span className="text-sm text-primary">尚未登录，点此注册或登录</span>
              <span className="text-xs text-muted">去账户页</span>
            </button>
          )}
        </Section>

        <Section icon={FolderOpen} title="工作空间与权限" hint="任务默认写入这里。敏感操作可要求确认。">
          <Field id="workspace" label="默认工作空间">
            <div className="flex gap-2">
              <input
                id="workspace"
                className="gt-input flex-1"
                value={settings.defaultWorkspace}
                onChange={(e) => update({ defaultWorkspace: e.target.value })}
              />
              <button
                type="button"
                className="shrink-0 rounded-xl border border-line bg-raised px-3 text-sm transition-colors duration-200 hover:bg-line"
                onClick={() => window.gt.settings.pickDir().then((dir) => dir && update({ defaultWorkspace: dir }))}
              >
                选择目录
              </button>
            </div>
          </Field>
          <Field id="permission" label="权限模式">
            <select
              id="permission"
              className="gt-input"
              value={settings.permissionMode}
              onChange={(e) => update({ permissionMode: e.target.value as typeof settings.permissionMode })}
            >
              <option value="default">默认（敏感操作确认）</option>
              <option value="acceptEdits">自动批准工作空间内编辑</option>
              <option value="bypass">完全访问（谨慎）</option>
            </select>
          </Field>
        </Section>

        <Section icon={Shield} title="应用" hint="托盘与更新不影响对话内容。">
          <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-line bg-ink px-3 py-3">
            <span>
              <span className="block text-sm font-medium">关闭窗口时保持托盘运行</span>
              <span className="mt-0.5 block text-xs text-muted">任务不会因为关窗口而中断</span>
            </span>
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-primary"
              checked={settings.closeToTray}
              onChange={(e) => update({ closeToTray: e.target.checked })}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={checking}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-raised px-3 py-2 text-sm transition-colors duration-200 hover:bg-line disabled:opacity-60"
              onClick={async () => {
                setChecking(true)
                try {
                  const info = await window.gt.account.checkUpdate()
                  setUpdateKind(info.ok ? 'ok' : 'warn')
                  setUpdateMsg(info.ok ? `更新源版本 ${info.version}` : info.message || '暂无更新')
                } finally {
                  setChecking(false)
                }
              }}
            >
              <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
              {checking ? '检查中…' : '检查更新'}
            </button>
            {updateMsg ? (
              <span
                role="status"
                className={`inline-flex items-center gap-1 text-xs ${updateKind === 'ok' ? 'text-emerald-700' : 'text-muted'}`}
              >
                {updateKind === 'ok' ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
                {updateMsg}
              </span>
            ) : null}
          </div>
        </Section>
      </div>
    </PageShell>
  )
}
