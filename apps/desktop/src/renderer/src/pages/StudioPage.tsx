import { useEffect, useMemo, useRef, useState } from 'react'
import { Clapperboard, Download, FolderOpen, ImagePlus, Images, LoaderCircle, X } from 'lucide-react'
import type { GenerateJob } from '@shared/protocol'
import { useApp } from '../lib/store'
import { quotaExhausted, quotaHint } from '../lib/quota'
import PageShell from '../components/PageShell'
import QuotaBanner from '../components/QuotaBanner'

type Kind = 'image' | 'video'

function ipcMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']+': (?:Error:\s*)?/i, '')
}

function kindOf(model: { kind?: string }): Kind | 'chat' {
  return model.kind === 'image' || model.kind === 'video' ? model.kind : 'chat'
}

function statusLabel(status: string) {
  if (status === 'succeeded') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'running') return '生成中'
  return '排队中'
}

function JobImage({ job, onPreview }: { job: GenerateJob; onPreview: (src: string) => void }) {
  const [src, setSrc] = useState(job.urls?.[0] || '')
  useEffect(() => {
    if (!job.localPath) {
      setSrc(job.urls?.[0] || '')
      return
    }
    void window.gt.files.dataUrl(job.localPath).then((url) => {
      if (url) setSrc(url)
    })
  }, [job.localPath, job.urls])
  if (!src) return null
  return (
    <button type="button" className="block h-full w-full" onClick={() => onPreview(src)} title="预览图片">
      <img src={src} alt="" className="h-full w-full object-cover" />
    </button>
  )
}

function localMediaUrl(abs: string): string {
  return `gt-media://local/?path=${encodeURIComponent(abs)}`
}

function JobVideo({ job }: { job: GenerateJob }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const blobRef = useRef('')
  const [src, setSrc] = useState('')
  const [poster, setPoster] = useState('')
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    setPoster('')
    setBroken(false)
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current)
      blobRef.current = ''
    }
    if (job.localPath) setSrc(localMediaUrl(job.localPath))
    else setSrc(job.urls?.[0] || '')
    return () => {
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current)
        blobRef.current = ''
      }
    }
  }, [job.id, job.localPath, job.urls])

  const capturePoster = () => {
    const video = videoRef.current
    if (!video || poster || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    try {
      setPoster(canvas.toDataURL('image/jpeg', 0.72))
    } catch {
      /* remote video may taint the canvas */
    }
  }

  const loadLocalBlob = async () => {
    if (!job.localPath) return false
    try {
      const bytes = await window.gt.files.bytes(job.localPath)
      if (!bytes?.byteLength) return false
      const blob = new Blob([new Uint8Array(bytes)], { type: 'video/mp4' })
      const url = URL.createObjectURL(blob)
      if (blobRef.current) URL.revokeObjectURL(blobRef.current)
      blobRef.current = url
      setSrc(url)
      return true
    } catch {
      return false
    }
  }

  if (!src || broken) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-sm text-muted">
        <Clapperboard size={20} />
        <span>视频已保存到本机，点「打开」播放</span>
      </div>
    )
  }

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster || undefined}
      className="studio-video h-full w-full bg-black object-cover"
      controls
      preload="auto"
      playsInline
      onLoadedMetadata={() => {
        const video = videoRef.current
        if (video && video.currentTime < 0.05) video.currentTime = 0.08
      }}
      onLoadedData={capturePoster}
      onSeeked={capturePoster}
      onError={() => {
        void (async () => {
          if (job.localPath && src.startsWith('gt-media:')) {
            if (await loadLocalBlob()) return
          }
          if (job.urls?.[0] && src !== job.urls[0]) {
            setSrc(job.urls[0])
            return
          }
          setBroken(true)
        })()
      }}
    />
  )
}

export default function StudioPage() {
  const settings = useApp((s) => s.settings)
  const entitlements = useApp((s) => s.entitlements)
  const [kind, setKind] = useState<Kind>('image')
  const [prompt, setPrompt] = useState('')
  const [modelId, setModelId] = useState('')
  const [size, setSize] = useState('2K')
  const [resolution, setResolution] = useState('720p')
  const [duration, setDuration] = useState(5)
  const [ratio, setRatio] = useState('16:9')
  const [imagePath, setImagePath] = useState('')
  const [preview, setPreview] = useState('')
  const [jobs, setJobs] = useState<GenerateJob[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lightbox, setLightbox] = useState('')

  const models = useMemo(() => {
    const list = (entitlements?.models || []).filter((m) => kindOf(m) === kind)
    const preferred = kind === 'video' ? ['doubao-seedance-1.0-pro', 'doubao-seedance-1.5-pro'] : ['doubao-seedream-5.0', 'doubao-seedream-4.5', 'doubao-seedream-4.0']
    return list.slice().sort((a, b) => {
      const ai = preferred.indexOf(a.id)
      const bi = preferred.indexOf(b.id)
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
  }, [entitlements?.models, kind])
  const current = models.find((m) => m.id === modelId) || models[0]
  const loggedIn = Boolean(settings?.apiKey)
  const gallery = useMemo(
    () => jobs.filter((job) => job.status !== 'failed'),
    [jobs],
  )
  const pendingVideo = gallery.some((job) => job.kind === 'video' && (job.status === 'queued' || job.status === 'running'))
  const submitting = busy || (kind === 'video' && pendingVideo)

  useEffect(() => {
    if (!models.length) {
      setModelId('')
      return
    }
    if (!models.some((m) => m.id === modelId)) setModelId(models[0].id)
  }, [models, modelId])

  useEffect(() => {
    if (current?.sizes?.length && !current.sizes.includes(size)) setSize(current.sizes[1] || current.sizes[0])
    if (current?.resolutions?.length && !current.resolutions.includes(resolution)) {
      setResolution(current.resolutions.includes('720p') ? '720p' : current.resolutions[0])
    }
    if (current?.durations?.length && !current.durations.includes(duration)) setDuration(current.durations[1] || current.durations[0])
    if (current?.ratios?.length && !current.ratios.includes(ratio)) setRatio(current.ratios[0])
  }, [current, size, resolution, duration, ratio])

  useEffect(() => {
    if (!lightbox) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightbox('')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  useEffect(() => {
    if (!loggedIn) return
    void window.gt.generate
      .list()
      .then((list) => {
        setJobs(list.filter((job) => job.status !== 'failed'))
      })
      .catch(() => undefined)
  }, [loggedIn])

  useEffect(() => {
    const pending = jobs.filter((job) => job.status === 'queued' || job.status === 'running')
    if (!pending.length) return
    const timer = window.setInterval(() => {
      void Promise.all(pending.map((job) => window.gt.generate.status(job.id)))
        .then((next) => {
          setJobs((prev) => {
            const map = new Map(prev.map((item) => [item.id, item]))
            for (const job of next) {
              if (job.status === 'failed') map.delete(job.id)
              else map.set(job.id, job)
            }
            return [...map.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          })
        })
        .catch(() => undefined)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [jobs])

  const pickRef = async () => {
    const picked = await window.gt.generate.pickImage()
    if (!picked) return
    setImagePath(picked)
    const url = await window.gt.files.dataUrl(picked).catch(() => '')
    setPreview(url)
  }

  const submit = async () => {
    if (!current || busy) return
    if (quotaExhausted(entitlements)) {
      setError(quotaHint(entitlements))
      return
    }
    if (kind === 'video' && pendingVideo) {
      setError('正在生成中，请等待当前视频完成后再试。')
      return
    }
    const text = prompt.trim()
    if (!text) {
      setError('请先描述要生成的画面。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const job = await window.gt.generate.start({
        kind,
        model: current.id,
        prompt: text,
        size: kind === 'image' ? size : undefined,
        resolution: kind === 'video' ? resolution : undefined,
        duration: kind === 'video' ? duration : undefined,
        ratio: kind === 'video' ? ratio : undefined,
        imagePath: imagePath || undefined,
      })
      if (job.status === 'failed') {
        setError(job.error || '生成失败')
        return
      }
      setJobs((prev) => [job, ...prev.filter((item) => item.id !== job.id && item.status !== 'failed')])
    } catch (err) {
      setError(ipcMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell wide title="创作">
      {!loggedIn ? (
        <div className="gt-card max-w-xl p-6">
          <p className="text-sm text-muted">登录后才能生成。体验版不含生图 / 生视频，请升级专业版。</p>
          <button
            type="button"
            className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-primary/90"
            onClick={() => useApp.getState().setView('account')}
          >
            去账户页登录
          </button>
        </div>
      ) : (
        <div className="grid h-full min-h-0 gap-6 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
          <section className="gt-card min-h-0 space-y-4 overflow-y-auto p-5">
            <QuotaBanner />
            <div className="flex rounded-xl bg-raised p-1">
              {(['image', 'video'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setKind(item)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200 ${
                    kind === item ? 'bg-primary text-white' : 'text-muted hover:text-text'
                  }`}
                >
                  {item === 'image' ? <Images size={15} /> : <Clapperboard size={15} />}
                  {item === 'image' ? '图片' : '视频'}
                </button>
              ))}
            </div>

            {!models.length ? (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                <p className="text-sm text-primary">当前套餐没有{kind === 'image' ? '生图' : '生视频'}模型。</p>
                <p className="mt-1 text-xs text-muted">体验版只含对话。专业版含 Seedream / Seedance Fast，团队版含全部。</p>
                <button
                  type="button"
                  className="mt-3 rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-primary/90"
                  onClick={() => void window.gt.account.openShop()}
                >
                  升级套餐
                </button>
              </div>
            ) : (
              <>
                <label className="block text-sm font-medium">
                  描述
                  <textarea
                    className="gt-input mt-2 min-h-32 resize-y"
                    value={prompt}
                    maxLength={2000}
                    placeholder={kind === 'image' ? '例：清晨的办公桌，一杯咖啡，窗外是浅色城市，电影感，柔和日光' : '例：镜头缓缓推过林间木屋，晨雾流动，电影感，稳定云台'}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </label>
                <label className="block text-sm font-medium">
                  模型
                  <select className="gt-input mt-2" value={current?.id || ''} onChange={(e) => setModelId(e.target.value)}>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                {kind === 'image' ? (
                  <label className="block text-sm font-medium">
                    清晰度
                    <select className="gt-input mt-2" value={size} onChange={(e) => setSize(e.target.value)}>
                      {(current?.sizes || ['2K']).map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <label className="block text-sm font-medium">
                      分辨率
                      <select className="gt-input mt-2" value={resolution} onChange={(e) => setResolution(e.target.value)}>
                        {(current?.resolutions || ['720p']).map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm font-medium">
                      时长
                      <select className="gt-input mt-2" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                        {(current?.durations || [5]).map((item) => (
                          <option key={item} value={item}>
                            {item} 秒
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm font-medium">
                      画幅
                      <select className="gt-input mt-2" value={ratio} onChange={(e) => setRatio(e.target.value)}>
                        {(current?.ratios || ['16:9']).map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                <div>
                  <div className="text-sm font-medium">参考图（可选）</div>
                  <p className="mt-0.5 text-xs text-muted">{kind === 'image' ? '图生图或按参考改画' : '图生视频，用作首帧 / 风格参考'}</p>
                  {preview ? (
                    <div className="relative mt-2 overflow-hidden rounded-xl border border-line">
                      <img src={preview} alt="" className="max-h-40 w-full object-cover" />
                      <button
                        type="button"
                        className="absolute right-2 top-2 rounded-full bg-white/90 p-1 text-muted"
                        onClick={() => {
                          setImagePath('')
                          setPreview('')
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 py-6 text-sm text-muted transition-colors duration-200 hover:border-primary/40 hover:text-text"
                      onClick={() => void pickRef()}
                    >
                      <ImagePlus size={16} />
                      选择图片
                    </button>
                  )}
                </div>
                {error ? (
                  <p className="text-sm text-warn" role="alert">
                    {error}
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={!quotaExhausted(entitlements) && (submitting || !current)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-primary/90 disabled:opacity-50"
                  onClick={() => {
                    if (quotaExhausted(entitlements)) {
                      void window.gt.account.openShop()
                      return
                    }
                    void submit()
                  }}
                >
                  {submitting ? <LoaderCircle size={16} className="animate-spin" /> : null}
                  {quotaExhausted(entitlements)
                    ? '去官网充值'
                    : kind === 'video' && pendingVideo
                      ? '正在生成中'
                      : busy
                        ? '生成中'
                        : kind === 'image'
                          ? '生成图片'
                          : '生成视频'}
                </button>
              </>
            )}
          </section>

          <section className="flex min-h-0 min-w-0 flex-col">
            <div className="mb-3 flex shrink-0 items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold tracking-tight">作品</h2>
              <p className="text-xs text-muted">{gallery.length ? `${gallery.length} 个` : '还没有作品'}</p>
            </div>
            {!gallery.length ? (
              <div className="gt-card flex min-h-0 flex-1 flex-col items-center justify-center p-8 text-center">
                <Images size={28} className="text-primary" />
                <p className="mt-3 text-sm font-medium">还没有作品</p>
                <p className="mt-1 max-w-sm text-xs text-muted">生成成功后会下载到本机。视频通常要等 1–3 分钟。</p>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="grid gap-3 sm:grid-cols-2 min-[1500px]:grid-cols-3 min-[1900px]:grid-cols-4">
                {gallery.map((job) => (
                  <article key={job.id} className="gt-card overflow-hidden">
                    <div className="relative aspect-video bg-raised">
                      {job.status === 'succeeded' && job.kind === 'image' ? (
                        <JobImage job={job} onPreview={setLightbox} />
                      ) : null}
                      {job.status === 'succeeded' && job.kind === 'video' && (job.urls?.[0] || job.localPath) ? (
                        <JobVideo job={job} />
                      ) : null}
                      {job.status !== 'succeeded' ? (
                        <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
                          <span className="thinking-dot" />
                          <span className="thinking-dot" />
                          <span className="thinking-dot" />
                          <span>{statusLabel(job.status)}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="space-y-2 p-3">
                      <h3 className="line-clamp-2 text-sm font-medium leading-snug">{job.prompt}</h3>
                      <p className="text-[11px] text-muted">
                        {job.model}
                        {job.size ? ` · ${job.size}` : ''}
                        {job.resolution ? ` · ${job.resolution}` : ''}
                        {job.duration ? ` · ${job.duration}s` : ''}
                      </p>
                      {job.status === 'succeeded' && (job.localPath || job.urls?.[0]) ? (
                        <div className="flex gap-2">
                          {job.kind === 'image' ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-muted hover:text-text"
                              onClick={() => {
                                if (job.localPath) {
                                  void window.gt.files.dataUrl(job.localPath).then((url) => {
                                    if (url) setLightbox(url)
                                  })
                                  return
                                }
                                if (job.urls?.[0]) setLightbox(job.urls[0])
                              }}
                            >
                              预览
                            </button>
                          ) : null}
                          {job.localPath ? (
                            <>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-muted hover:text-text"
                                onClick={() => void window.gt.files.open(job.localPath!)}
                              >
                                <FolderOpen size={12} />
                                打开
                              </button>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-muted hover:text-text"
                                onClick={() => void window.gt.files.show(job.localPath!)}
                              >
                                <Download size={12} />
                                位置
                              </button>
                            </>
                          ) : job.urls?.[0] ? (
                            <a
                              href={job.urls[0]}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-muted hover:text-text"
                            >
                              打开链接
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
      {lightbox ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 sm:p-8 lg:p-12"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          onClick={() => setLightbox('')}
        >
          <button
            type="button"
            className="absolute right-6 top-6 rounded-full bg-white p-2 text-muted"
            aria-label="关闭预览"
            onClick={() => setLightbox('')}
          >
            <X size={16} />
          </button>
          <img
            src={lightbox}
            alt=""
            className="max-h-full max-w-full rounded-xl object-contain shadow-lg"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
    </PageShell>
  )
}
