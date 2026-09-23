import type { ReactNode } from 'react'

export default function PageShell({
  title,
  subtitle,
  children,
  wide,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className={`min-h-0 min-w-0 flex-1 bg-ink ${wide ? 'overflow-hidden' : 'overflow-auto'}`}>
      <div
        className={
          wide
            ? 'mx-auto flex h-full min-h-0 max-w-[1920px] flex-col px-6 py-6 lg:px-8'
            : 'mx-auto max-w-6xl px-8 py-8'
        }
      >
        <header className="shrink-0">
          <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
          {subtitle ? <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p> : null}
        </header>
        <div className={wide ? 'mt-5 min-h-0 flex-1' : 'mt-6'}>{children}</div>
      </div>
    </div>
  )
}
