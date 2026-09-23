import { useApp } from '../lib/store'
import { friendlyPermissionTool, permissionDetailRows } from '../lib/tool-display'

export default function Dialogs() {
  const permission = useApp((s) => s.pendingPermission)
  const question = useApp((s) => s.pendingQuestion)

  if (permission) {
    const rows = permissionDetailRows(permission.args)
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30">
        <div className="w-[420px] rounded-2xl border border-line bg-panel p-5 shadow-[0_16px_40px_rgba(15,23,42,0.12)]">
          <div className="text-sm font-semibold">需要确认：{friendlyPermissionTool(permission.tool)}</div>
          <p className="mt-2 text-xs text-muted">{permission.reason}</p>
          {rows.length ? (
            <dl className="mt-3 space-y-2 rounded-xl bg-raised px-3 py-2.5 text-xs">
              {rows.map((row) => (
                <div key={`${row.label}-${row.value}`} className="flex gap-2">
                  <dt className="shrink-0 text-muted">{row.label}</dt>
                  <dd className="min-w-0 break-all text-text">{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg bg-raised px-3 py-1.5 text-sm transition-colors duration-200 hover:bg-line"
              onClick={() => {
                void window.gt.tasks.permission(permission.requestId, 'deny')
                useApp.setState({ pendingPermission: null })
              }}
            >
              拒绝
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white transition-colors duration-200 hover:bg-primary/90"
              onClick={() => {
                void window.gt.tasks.permission(permission.requestId, 'allow')
                useApp.setState({ pendingPermission: null })
              }}
            >
              允许一次
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (question) {
    return <QuestionForm />
  }
  return null
}

function QuestionForm() {
  const question = useApp((s) => s.pendingQuestion)!
  return (
    <form
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30"
      onSubmit={(e) => {
        e.preventDefault()
        const data = new FormData(e.currentTarget)
        const answers: Record<string, string> = {}
        for (const q of question.questions) answers[q.id] = String(data.get(q.id) || '')
        void window.gt.tasks.answer(question.requestId, answers)
        useApp.setState({ pendingQuestion: null })
      }}
    >
      <div className="w-[460px] rounded-2xl border border-line bg-panel p-5 shadow-[0_16px_40px_rgba(15,23,42,0.12)]">
        <div className="text-sm font-semibold">{question.title}</div>
        <div className="mt-3 space-y-3">
          {question.questions.map((q) => (
            <label key={q.id} className="block text-xs">
              <div className="mb-1 text-muted">{q.prompt}</div>
              {q.options?.length ? (
                <select name={q.id} className="gt-input">
                  {q.options.map((opt) => (
                    <option key={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input name={q.id} className="gt-input" />
              )}
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="submit" className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white transition-colors duration-200 hover:bg-primary/90">
            提交
          </button>
        </div>
      </div>
    </form>
  )
}
