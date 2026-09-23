import { useState, type ReactNode } from 'react'
import { CircleUser, CreditCard, LogOut, RefreshCw } from 'lucide-react'
import { useApp } from '../lib/store'
import { QUOTA_HINT } from '../lib/quota'
import BrandMark from '../components/BrandMark'
import PageShell from '../components/PageShell'

function Section({
  icon: Icon,
  title,
  hint,
  action,
  children,
}: {
  icon: typeof CircleUser
  title: string
  hint: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="gt-card overflow-hidden">
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon size={18} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-xs text-muted">{hint}</p>
        </div>
        {action}
      </header>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  )
}

export default function AccountPage() {
  const settings = useApp((s) => s.settings)
  const entitlements = useApp((s) => s.entitlements)
  const [error, setError] = useState('')
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNote, setRefreshNote] = useState('')
  const [refreshKind, setRefreshKind] = useState<'ok' | 'warn' | ''>('')
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  if (!settings) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center bg-ink p-8 text-sm text-muted">
        正在加载账户信息…
      </div>
    )
  }

  const loggedIn = Boolean(settings.apiKey)
  const sub = entitlements?.subscription
  const expired = Boolean(sub && sub.expiresAt < Date.now())
  const used = Math.max(0, Math.min(100, sub?.usagePercent ?? 0))
  const email = settings.userEmail || entitlements?.user.email || '已登录账户'

  const loginWebsite = async () => {
    setBusy(true)
    setError('')
    setHint('正在打开浏览器。请在官网登录或注册，然后点击「授权并打开客户端」。')
    try {
      if (!window.gt?.account?.loginWithWebsite) {
        setError('客户端通道未就绪。请完全退出光途Work后重新打开。')
        return
      }
      const result = await window.gt.account.loginWithWebsite()
      if (!result.ok || !result.settings) {
        setError(result.error || '授权失败')
        return
      }
      const nextEnt = await window.gt.account.entitlements()
      const tasks = await window.gt.tasks.list().catch(() => [])
      useApp.setState({
        settings: result.settings,
        entitlements: nextEnt,
        tasks,
        currentId: tasks[0]?.id || null,
        view: result.settings.defaultWorkspace ? 'workbench' : 'settings',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setHint('')
    }
  }

  const refreshQuota = async () => {
    setRefreshing(true)
    setRefreshNote('')
    setRefreshKind('')
    try {
      const next = await window.gt.account.entitlements()
      if (!next) {
        setRefreshKind('warn')
        setRefreshNote('刷新失败。请确认已登录，且网关是本机控制面。')
        return
      }
      useApp.setState({ entitlements: next })
      setRefreshKind('ok')
      setRefreshNote(`额度已更新 · ${new Date().toLocaleTimeString()}`)
    } catch (err) {
      setRefreshKind('warn')
      setRefreshNote(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }

  const doLogout = async () => {
    setLoggingOut(true)
    try {
      const next = await window.gt.account.logout()
      useApp.setState({
        settings: next,
        entitlements: null,
        tasks: [],
        currentId: null,
        view: 'account',
      })
      setConfirmLogout(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setConfirmLogout(false)
    } finally {
      setLoggingOut(false)
    }
  }

  if (!loggedIn) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center bg-ink p-8">
        <div className="w-full max-w-md rounded-3xl border border-line bg-panel p-8 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
          <div className="flex items-center gap-3">
            <BrandMark size={48} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">登录光途Work</h1>
              <p className="mt-0.5 text-xs text-muted">在官网完成登录并授权本客户端，不在这里填写邮箱密码</p>
            </div>
          </div>
          {error ? (
            <div role="alert" className="mt-4 text-sm text-warn">
              {error}
            </div>
          ) : null}
          {hint ? (
            <p role="status" className="mt-4 text-sm text-muted">
              {hint}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            className="mt-6 w-full cursor-pointer rounded-xl bg-primary py-2.5 text-white transition-colors duration-200 hover:bg-primary/90 disabled:opacity-60"
            onClick={() => void loginWebsite()}
          >
            {busy ? '等待官网授权…' : '打开官网登录'}
          </button>
          {busy ? (
            <button
              type="button"
              className="mt-3 w-full cursor-pointer rounded-xl border border-line py-2 text-sm text-muted transition-colors duration-200 hover:bg-raised"
              onClick={() => void window.gt.account.cancelWebLogin()}
            >
              取消
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <PageShell title="账户" subtitle="管理套餐与用量。改密码请到官网账户页。用量只显示百分比，不展示具体额度。">
      <div className="mx-auto max-w-3xl space-y-5">
        <Section icon={CircleUser} title="登录信息" hint="当前客户端已通过官网授权，无需填写厂商 API Key。">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">
                {email.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{email}</div>
                <div className="text-xs text-muted">{entitlements?.user.role === 'admin' ? '工作人员账户' : '已连接到控制面'}</div>
              </div>
            </div>
            <button
              type="button"
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-sm text-muted transition-colors duration-200 hover:border-primary/40 hover:text-primary"
              onClick={() => setConfirmLogout(true)}
            >
              <LogOut size={14} />
              退出登录
            </button>
          </div>
        </Section>

        <Section
          icon={CreditCard}
          title="套餐与额度"
          hint="购买后只显示已使用百分比。官网续费后点刷新即可同步。"
          action={
            <button
              type="button"
              disabled={refreshing}
              aria-label="刷新额度"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-xs text-muted transition-colors duration-200 hover:border-primary/40 hover:text-primary disabled:opacity-60"
              onClick={() => void refreshQuota()}
            >
              <RefreshCw size={14} className={refreshing ? 'motion-safe:animate-spin' : ''} />
              {refreshing ? '刷新中' : '刷新额度'}
            </button>
          }
        >
          {sub && !expired ? (
            <>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{sub.packageName}</div>
                  <div className="mt-1 text-xs text-muted">到期 {new Date(sub.expiresAt).toLocaleString()}</div>
                </div>
                <div className={`text-2xl font-semibold tabular-nums ${used >= 90 ? 'text-warn' : 'text-text'}`}>
                  {used}%
                </div>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[11px] text-muted">
                  <span>已使用</span>
                  <span>剩余 {Math.max(0, 100 - used)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-raised">
                  <div
                    className={`h-full transition-[width] duration-200 ${used >= 90 ? 'bg-warn' : 'bg-primary'}`}
                    style={{ width: `${used}%` }}
                  />
                </div>
              </div>
              {used >= 100 ? <p className="text-xs leading-5 text-warn">{QUOTA_HINT}</p> : null}
            </>
          ) : (
            <p className="text-sm text-warn">{expired ? '套餐已到期，请续费后再使用。' : '暂无有效套餐，请先购买。'}</p>
          )}
          {refreshNote ? (
            <p role="status" aria-live="polite" className={`text-xs ${refreshKind === 'warn' ? 'text-warn' : 'text-primary'}`}>
              {refreshNote}
            </p>
          ) : null}
          <div>
            <div className="mb-2 text-xs text-muted">当前可用模型</div>
            <div className="flex flex-wrap gap-1.5">
              {(entitlements?.models || []).length ? (
                entitlements!.models.map((model) => (
                  <span key={model.id} className="rounded-full border border-line bg-ink px-2.5 py-0.5 text-[11px] text-text">
                    {model.name}
                    {model.kind === 'image' ? ' · 生图' : model.kind === 'video' ? ' · 生视频' : model.vision ? ' · 识图' : ''}
                  </span>
                ))
              ) : (
                <span className="text-xs text-muted">无</span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="cursor-pointer rounded-xl bg-primary px-3 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-primary/90"
            onClick={() => void window.gt.account.openShop()}
          >
            {used >= 100 ? '去官网充值' : '升级 / 续费套餐'}
          </button>
        </Section>
      </div>
      {confirmLogout ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-title"
            className="w-full max-w-sm rounded-2xl border border-line bg-panel p-5 shadow-[0_16px_40px_rgba(15,23,42,0.12)]"
          >
            <h2 id="logout-title" className="text-sm font-semibold">
              确认退出登录？
            </h2>
            <p className="mt-2 text-xs text-muted">
              退出后本机将不再显示当前账号的对话记录，也无法使用对话等功能，需重新登录。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={loggingOut}
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted transition-colors duration-200 hover:bg-raised disabled:opacity-60"
                onClick={() => setConfirmLogout(false)}
              >
                取消
              </button>
              <button
                type="button"
                disabled={loggingOut}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white transition-colors duration-200 hover:bg-primary/90 disabled:opacity-60"
                onClick={() => void doLogout()}
              >
                {loggingOut ? '退出中…' : '退出登录'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PageShell>
  )
}
