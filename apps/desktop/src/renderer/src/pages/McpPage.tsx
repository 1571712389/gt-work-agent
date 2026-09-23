import { useMemo, useState } from 'react'
import { LoaderCircle, Plus, X } from 'lucide-react'
import { useApp } from '../lib/store'
import { quotaExhausted } from '../lib/quota'
import { CONNECTOR_MARKET } from '@shared/mcp-market'
import { notify, gtCall } from '../lib/market'
import type { ConnectorConnectResult, McpInfo } from '@shared/protocol'
import PageShell from '../components/PageShell'
import QuotaBanner from '../components/QuotaBanner'
import ItemMark from '../components/ItemMark'

export default function McpPage() {
  const mcp = useApp((s) => s.mcp)
  const entitlements = useApp((s) => s.entitlements)
  const locked = Boolean(entitlements) && !entitlements?.subscription?.allowMcp
  const [q, setQ] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const [id, setId] = useState('custom-mcp')
  const [command, setCommand] = useState('npx')
  const [args, setArgs] = useState('-y @modelcontextprotocol/server-filesystem C:/Users/Public')
  const [busy, setBusy] = useState<string | null>(null)
  const [tokenFor, setTokenFor] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [tokenHint, setTokenHint] = useState('')
  const [tokenUrl, setTokenUrl] = useState('')
  const [tokenLabel, setTokenLabel] = useState('访问令牌')

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return CONNECTOR_MARKET
    return CONNECTOR_MARKET.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.id.toLowerCase().includes(query),
    )
  }, [q])

  const applyList = (list: typeof mcp) => {
    useApp.setState({ mcp: list })
  }

  const connect = async (connectorId: string, accessToken?: string) => {
    if (quotaExhausted(entitlements)) {
      notify('账户额度已用完，请到官网充值后再连接。', 'warn')
      return
    }
    if (locked) {
      notify('当前套餐未开放连接器，请升级专业版或团队版。', 'warn', { label: '去升级', view: 'account' })
      return
    }
    setBusy(connectorId)
    try {
      const result = await gtCall<ConnectorConnectResult>('mcp:connect', connectorId, accessToken)
      if (result.needSetup) {
        notify(result.hint || '该登录暂未开放，请稍后再试。', 'warn')
        return
      }
      if (result.needToken) {
        const item = CONNECTOR_MARKET.find((row) => row.id === connectorId)
        setTokenFor(connectorId)
        setToken('')
        setTokenHint(result.hint || item?.hint || '请粘贴访问令牌完成授权')
        setTokenUrl(result.tokenUrl || item?.tokenUrl || '')
        setTokenLabel(result.tokenLabel || item?.tokenLabel || '访问令牌')
        return
      }
      applyList(result.mcp)
      setTokenFor(null)
      const name = CONNECTOR_MARKET.find((row) => row.id === connectorId)?.name || connectorId
      notify(`已连接「${name}」。对话里会显示已连接数量。`, 'ok')
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'warn')
    } finally {
      setBusy(null)
    }
  }

  const installCustom = async () => {
    if (quotaExhausted(entitlements)) {
      notify('账户额度已用完，请到官网充值后再连接。', 'warn')
      return
    }
    if (locked) {
      notify('当前套餐未开放连接器，请升级专业版或团队版。', 'warn', { label: '去升级', view: 'account' })
      return
    }
    setBusy('custom')
    try {
      const list = await gtCall<McpInfo[]>('mcp:upsert', {
          id,
          command,
          args: args.split(' ').filter(Boolean),
          scope: 'user',
          approved: true,
        }, true)
      applyList(list)
      setCustomOpen(false)
      notify(`已启用自定义连接器「${id}」。`, 'ok')
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'warn')
    } finally {
      setBusy(null)
    }
  }

  const tokenItem = CONNECTOR_MARKET.find((row) => row.id === tokenFor)

  return (
    <PageShell
      title="连接器"
      subtitle="点 + 在浏览器里登录并授权。本地工具可直接启用。"
    >
      {locked && (
        <p className="mb-4 text-sm text-warn">当前套餐未开放连接器。请升级专业版或团队版后再授权。</p>
      )}
      <QuotaBanner />
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="gt-input min-w-64 flex-1"
          placeholder="搜索连接器"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="搜索连接器"
        />
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-panel px-4 py-2 text-sm text-text transition-colors duration-200 hover:border-primary/40"
          onClick={() => setCustomOpen(true)}
        >
          自定义连接器
        </button>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((item) => {
          const on = mcp.some((m) => m.id === item.id && m.approved)
          const authLabel = item.auth === 'oauth' ? '浏览器授权' : item.auth === 'token' ? '令牌授权' : '本机启用'
          return (
            <div
              key={item.id}
              className={`relative rounded-2xl border p-4 pr-12 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors duration-200 ${
                on ? 'border-primary/40 bg-primary/5' : 'border-line bg-panel'
              }`}
            >
              <div className="flex items-start gap-3">
                <ItemMark kind="mcp" id={item.id} name={item.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    {item.name}
                    {on ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="已连接" /> : null}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-muted">{item.description}</div>
                  <div className="mt-2 text-[11px] text-muted">{authLabel}</div>
                </div>
              </div>
              <button
                type="button"
                disabled={locked || busy === item.id}
                aria-label={on ? `重新连接 ${item.name}` : `添加 ${item.name}`}
                className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-raised hover:text-primary disabled:opacity-40"
                onClick={() => void connect(item.id)}
              >
                {busy === item.id ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={18} />}
              </button>
            </div>
          )
        })}
      </div>
      <div className="mt-8 space-y-2">
        <div className="text-sm text-muted">已连接</div>
        {mcp.length === 0 && <div className="text-xs text-muted">还没有连接器。点卡片右上角 + 授权或启用。</div>}
        {mcp.map((item) => {
          const catalog = CONNECTOR_MARKET.find((row) => row.id === item.id)
          return (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <ItemMark kind="mcp" id={item.id} name={catalog?.name || item.id} />
                <div className="min-w-0">
                  <div className="truncate text-sm">{catalog?.name || item.id}</div>
                  <div className="truncate text-xs text-muted">
                    {item.approved ? '已授权' : '待批准'}
                    {item.id === 'dingtalk' && item.approved ? ' · 本机钉钉已登录' : item.disabled ? ' · 仅保存凭证' : ''}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 text-xs text-warn transition-colors duration-200 hover:text-text"
                onClick={async () => {
                  useApp.setState({ mcp: await window.gt.mcp.remove(item.id) })
                  notify(`已移除连接器「${catalog?.name || item.id}」`, 'info')
                }}
              >
                移除
              </button>
            </div>
          )
        })}
      </div>

      {customOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="gt-card w-full max-w-md space-y-3 p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">自定义连接器</div>
              <button type="button" className="text-muted hover:text-text" onClick={() => setCustomOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-muted">填写 MCP 命令。适合自建或尚未上架的本地工具。</p>
            <label className="block text-xs text-muted">
              标识
              <input className="gt-input mt-1" value={id} onChange={(e) => setId(e.target.value)} />
            </label>
            <label className="block text-xs text-muted">
              命令
              <input className="gt-input mt-1" value={command} onChange={(e) => setCommand(e.target.value)} />
            </label>
            <label className="block text-xs text-muted">
              参数
              <input className="gt-input mt-1" value={args} onChange={(e) => setArgs(e.target.value)} />
            </label>
            <button
              type="button"
              disabled={locked || busy === 'custom'}
              className="rounded-xl bg-primary px-3 py-2 text-sm text-white transition-colors duration-200 hover:bg-primary/90 disabled:opacity-40"
              onClick={() => void installCustom()}
            >
              {busy === 'custom' ? '连接中…' : '批准并连接'}
            </button>
          </div>
        </div>
      )}

      {tokenFor && tokenItem && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="gt-card w-full max-w-md space-y-3 p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">授权 {tokenItem.name}</div>
              <button type="button" className="text-muted hover:text-text" onClick={() => setTokenFor(null)}>
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-muted">{tokenHint}</p>
            {tokenUrl ? (
              <p className="text-xs text-muted">可先打开服务商授权页，完成后再把令牌粘贴到下方。</p>
            ) : null}
            <label className="block text-xs text-muted">
              {tokenLabel}
              <input
                className="gt-input mt-1"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="粘贴后不会显示在对话里"
              />
            </label>
            <div className="flex gap-2">
            {tokenUrl ? (
              <button
                type="button"
                className="rounded-xl border border-line px-3 py-2 text-sm text-muted transition-colors duration-200 hover:text-primary"
                onClick={() => void window.gt.account.openUrl(tokenUrl)}
              >
                打开授权页
              </button>
            ) : null}
              <button
                type="button"
                disabled={!token.trim() || busy === tokenFor}
                className="rounded-xl bg-primary px-3 py-2 text-sm text-white transition-colors duration-200 hover:bg-primary/90 disabled:opacity-40"
                onClick={() => void connect(tokenFor, token.trim())}
              >
                {busy === tokenFor ? '连接中…' : '完成授权'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
