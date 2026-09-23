import { quotaExhausted, quotaHint } from '../lib/quota'
import { useApp } from '../lib/store'

export default function QuotaBanner() {
  const entitlements = useApp((s) => s.entitlements)
  if (!quotaExhausted(entitlements)) return null
  return (
    <div className="mb-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2.5">
      <p className="text-xs leading-5 text-warn">{quotaHint(entitlements)}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="cursor-pointer rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors duration-200 hover:bg-primary/90"
          onClick={() => void window.gt.account.openShop()}
        >
          去官网充值
        </button>
        <button
          type="button"
          className="cursor-pointer rounded-xl border border-line bg-panel px-3 py-1.5 text-xs text-text transition-colors duration-200 hover:border-primary/40 hover:text-primary"
          onClick={() => useApp.getState().setView('account')}
        >
          去账户页刷新
        </button>
      </div>
    </div>
  )
}
