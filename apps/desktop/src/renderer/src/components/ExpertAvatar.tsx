const PORTRAITS: Record<
  string,
  { bg: string; skin: string; hair: string; shirt: string; style: 'short' | 'bob' | 'bun' | 'long' | 'spike' | 'side'; extra?: 'glasses' | 'headset' }
> = {
  writer: { bg: '#FFE8C8', skin: '#F1C27D', hair: '#3B2A1A', shirt: '#1A7FD4', style: 'bob', extra: 'glasses' },
  researcher: { bg: '#D8F0E3', skin: '#E8B895', hair: '#2C1810', shirt: '#0F766E', style: 'bun', extra: 'glasses' },
  translator: { bg: '#EDE4FF', skin: '#F2C7A7', hair: '#5C3317', shirt: '#7C3AED', style: 'long' },
  trainer: { bg: '#FFE0C2', skin: '#D1A37A', hair: '#1C1917', shirt: '#EA580C', style: 'short' },
  designer: { bg: '#FCE7F3', skin: '#F1C27D', hair: '#7C2D12', shirt: '#DB2777', style: 'bob' },
  engineer: { bg: '#DBEAFE', skin: '#C68642', hair: '#111827', shirt: '#1D4ED8', style: 'spike', extra: 'headset' },
  finance: { bg: '#CCFBF1', skin: '#E8B895', hair: '#44403C', shirt: '#0F766E', style: 'side', extra: 'glasses' },
  legal: { bg: '#E2E8F0', skin: '#F2C7A7', hair: '#1C1917', shirt: '#334155', style: 'bun', extra: 'glasses' },
  support: { bg: '#FEF3C7', skin: '#F1C27D', hair: '#9A3412', shirt: '#F59E0B', style: 'long' },
  sales: { bg: '#FFE4E6', skin: '#D1A37A', hair: '#292524', shirt: '#E11D48', style: 'short' },
  hr: { bg: '#D1FAE5', skin: '#F2C7A7', hair: '#78350F', shirt: '#059669', style: 'long' },
  pm: { bg: '#E0F2FE', skin: '#E8B895', hair: '#44403C', shirt: '#0284C7', style: 'short', extra: 'glasses' },
  organizer: { bg: '#FFEDD5', skin: '#C68642', hair: '#1C1917', shirt: '#C2410C', style: 'bun' },
  analyst: { bg: '#E0E7FF', skin: '#8D5524', hair: '#0C0A09', shirt: '#4338CA', style: 'side', extra: 'glasses' },
}

function Hair({ style, color }: { style: (typeof PORTRAITS)[string]['style']; color: string }) {
  if (style === 'bob') {
    return <path d="M18 26c0-12 8-18 14-18s14 6 14 18v6c-3-8-8-10-14-10S21 24 18 32z" fill={color} />
  }
  if (style === 'bun') {
    return (
      <>
        <circle cx="32" cy="12" r="6" fill={color} />
        <path d="M20 28c1-12 7-16 12-16s11 4 12 16c-4-6-8-8-12-8s-8 2-12 8z" fill={color} />
      </>
    )
  }
  if (style === 'long') {
    return <path d="M16 30c1-14 9-20 16-20s15 6 16 20v18c-5-10-10-12-16-12S21 38 16 48z" fill={color} />
  }
  if (style === 'spike') {
    return <path d="M18 30 22 10l6 12 4-14 4 14 6-10 4 18c-4-8-10-12-14-12s-10 4-14 12z" fill={color} />
  }
  if (style === 'side') {
    return <path d="M20 26c0-12 6-16 14-16 6 0 12 5 12 16 0 4-2 6-4 6-1-8-5-12-10-12-6 0-10 5-12 12z" fill={color} />
  }
  return <path d="M18 28c1-12 8-16 14-16s13 4 14 16c-4-7-9-9-14-9s-10 2-14 9z" fill={color} />
}

export default function ExpertAvatar({
  id,
  name,
  size = 48,
}: {
  id: string
  name: string
  size?: number
}) {
  const p = PORTRAITS[id]
  if (!p) {
    const glyph = Array.from(name.trim())[0] || '?'
    return (
      <span
        aria-hidden
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
        style={{ width: size, height: size }}
      >
        {glyph}
      </span>
    )
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className="shrink-0 rounded-full"
      role="img"
      aria-label={`${name}的头像`}
    >
      <circle cx="32" cy="32" r="32" fill={p.bg} />
      <Hair style={p.style} color={p.hair} />
      <ellipse cx="32" cy="58" rx="20" ry="12" fill={p.shirt} />
      <circle cx="32" cy="30" r="13" fill={p.skin} />
      <circle cx="27" cy="29" r="1.6" fill="#1F2937" />
      <circle cx="37" cy="29" r="1.6" fill="#1F2937" />
      <path d="M28 36c2 2 6 2 8 0" stroke="#B45309" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {p.extra === 'glasses' && (
        <>
          <circle cx="27" cy="29" r="4.2" fill="none" stroke="#1F2937" strokeWidth="1.4" />
          <circle cx="37" cy="29" r="4.2" fill="none" stroke="#1F2937" strokeWidth="1.4" />
          <path d="M31.2 29h1.6" stroke="#1F2937" strokeWidth="1.4" />
        </>
      )}
      {p.extra === 'headset' && (
        <>
          <path d="M18 28c0-10 6-16 14-16s14 6 14 16" fill="none" stroke="#111827" strokeWidth="2.2" />
          <rect x="15" y="26" width="6" height="10" rx="2" fill="#111827" />
          <rect x="43" y="26" width="6" height="10" rx="2" fill="#111827" />
        </>
      )}
    </svg>
  )
}

export function TeamAvatars({
  memberIds,
  names,
  size = 40,
}: {
  memberIds: string[]
  names: Record<string, string>
  size?: number
}) {
  const shown = memberIds.slice(0, 3)
  return (
    <span className="inline-flex shrink-0 items-center" aria-hidden>
      {shown.map((id, index) => (
        <span key={id} className="rounded-full ring-2 ring-white" style={{ marginLeft: index === 0 ? 0 : -10, zIndex: 3 - index }}>
          <ExpertAvatar id={id} name={names[id] || id} size={size} />
        </span>
      ))}
    </span>
  )
}
