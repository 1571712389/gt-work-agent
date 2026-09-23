export interface ModelPricing {
  id: string
  provider_id: string
  display_name: string
  multiplier: number
  enabled: number
  input_fen_per_m: number
  output_fen_per_m: number
  cache_hit_fen_per_m: number
}

export interface PackagePricingInput {
  id: string
  name: string
  slug?: string
  price_fen: number
  token_quota: number
  models_json: string
  enabled?: number
}

export type ModelTier = 'base' | 'work' | 'flagship'
export type ModelKind = 'chat' | 'image' | 'video'

export interface CatalogEntry {
  id: string
  providerId: string
  providerName: string
  baseUrl: string
  priority: number
  upstreamModel: string
  displayName: string
  tools: number
  vision?: number
  kind?: ModelKind
  unitFen?: number
  sizes?: string[]
  resolutions?: string[]
  durations?: number[]
  ratios?: string[]
  videoFenPerSec?: Record<string, number>
  fallback?: string
  input: number
  output: number
  cacheHit: number
  tier: ModelTier
  priceNote: string
}

/**
 * 官方人民币进货价，单位：分 / 百万 Token。
 * DeepSeek：闲时 Flash（2026-09）。豆包：火山方舟 Seed 短上下文档。Kimi：platform.kimi.com。
 */
export const MODEL_CATALOG: CatalogEntry[] = [
  {
    id: 'deepseek-chat',
    providerId: 'prov_deepseek',
    providerName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    priority: 10,
    upstreamModel: 'deepseek-chat',
    displayName: 'DeepSeek Chat',
    tools: 1,
    vision: 0,
    fallback: 'doubao-lite',
    input: 100,
    output: 400,
    cacheHit: 2,
    tier: 'base',
    priceNote: '兼容别名，闲时约 ¥1 未命中 / ¥4 输出。套餐额度以它为 1 倍基准。',
  },
  {
    id: 'deepseek-flash',
    providerId: 'prov_deepseek',
    providerName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    priority: 10,
    upstreamModel: 'deepseek-flash',
    displayName: 'DeepSeek Flash',
    tools: 1,
    vision: 1,
    fallback: 'deepseek-chat',
    input: 100,
    output: 400,
    cacheHit: 2,
    tier: 'base',
    priceNote: 'V4.1 Flash 闲时约 $0.15 / $0.60（约 ¥1 / ¥4），原生多模态识图。',
  },
  {
    id: 'deepseek-v4-pro',
    providerId: 'prov_deepseek',
    providerName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    priority: 10,
    upstreamModel: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    tools: 1,
    vision: 1,
    fallback: 'deepseek-flash',
    input: 462,
    output: 1386,
    cacheHit: 15,
    tier: 'flagship',
    priceNote: 'V4 Pro 闲时约 $0.66 / $1.98（约 ¥4.6 / ¥13.9），旗舰推理 + 识图。',
  },
  {
    id: 'doubao-mini',
    providerId: 'prov_doubao',
    providerName: '豆包 · 火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    priority: 20,
    upstreamModel: 'doubao-seed-1-6-mini',
    displayName: '豆包 Mini',
    tools: 1,
    vision: 1,
    fallback: 'deepseek-chat',
    input: 20,
    output: 200,
    cacheHit: 4,
    tier: 'work',
    priceNote: 'Seed 2.0 Mini ≤32K：¥0.2 / ¥2。上游 ID 以方舟控制台开通名为准。',
  },
  {
    id: 'doubao-lite',
    providerId: 'prov_doubao',
    providerName: '豆包 · 火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    priority: 20,
    upstreamModel: 'doubao-seed-1-6-lite',
    displayName: '豆包 Lite',
    tools: 1,
    vision: 1,
    fallback: 'deepseek-chat',
    input: 60,
    output: 360,
    cacheHit: 12,
    tier: 'work',
    priceNote: 'Seed 2.0 Lite ≤32K：¥0.6 / ¥3.6。长上下文更贵，可在此上调。',
  },
  {
    id: 'doubao-turbo',
    providerId: 'prov_doubao',
    providerName: '豆包 · 火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    priority: 20,
    upstreamModel: 'doubao-seed-1-6-turbo',
    displayName: '豆包 Turbo',
    tools: 1,
    vision: 1,
    fallback: 'doubao-lite',
    input: 300,
    output: 1500,
    cacheHit: 60,
    tier: 'flagship',
    priceNote: 'Seed 2.1 Turbo：¥3 / ¥15。',
  },
  {
    id: 'doubao-pro',
    providerId: 'prov_doubao',
    providerName: '豆包 · 火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    priority: 20,
    upstreamModel: 'doubao-seed-1-6-pro',
    displayName: '豆包 Pro',
    tools: 1,
    vision: 1,
    fallback: 'doubao-turbo',
    input: 600,
    output: 3000,
    cacheHit: 120,
    tier: 'flagship',
    priceNote: 'Seed 2.1 Pro / Evolving：¥6 / ¥30。',
  },
  {
    id: 'kimi-k2.6',
    providerId: 'prov_kimi',
    providerName: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    priority: 30,
    upstreamModel: 'kimi-k2.6',
    displayName: 'Kimi K2.6',
    tools: 1,
    fallback: 'deepseek-chat',
    input: 650,
    output: 2700,
    cacheHit: 110,
    tier: 'flagship',
    priceNote: '官方：未命中 ¥6.5 / 命中 ¥1.1 / 输出 ¥27。',
  },
  {
    id: 'kimi-k2.7-code',
    providerId: 'prov_kimi',
    providerName: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    priority: 30,
    upstreamModel: 'kimi-k2.7-code',
    displayName: 'Kimi K2.7 Code',
    tools: 1,
    fallback: 'kimi-k2.6',
    input: 650,
    output: 2700,
    cacheHit: 130,
    tier: 'flagship',
    priceNote: '官方：未命中 ¥6.5 / 命中 ¥1.3 / 输出 ¥27。',
  },
  {
    id: 'kimi-k3',
    providerId: 'prov_kimi',
    providerName: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    priority: 30,
    upstreamModel: 'kimi-k3',
    displayName: 'Kimi K3',
    tools: 1,
    fallback: 'kimi-k2.6',
    input: 2000,
    output: 10000,
    cacheHit: 200,
    tier: 'flagship',
    priceNote: '官方旗舰：未命中 ¥20 / 命中 ¥2 / 输出 ¥100。必须高倍率扣额。',
  },
  {
    id: 'gpt-4o-mini',
    providerId: 'prov_openai',
    providerName: 'OpenAI 兼容',
    baseUrl: 'https://api.openai.com/v1',
    priority: 40,
    upstreamModel: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    tools: 1,
    vision: 1,
    fallback: 'deepseek-chat',
    input: 108,
    output: 432,
    cacheHit: 108,
    tier: 'work',
    priceNote: '约 $0.15 / $0.60，按 ¥7.2 折算。',
  },
  {
    id: 'doubao-seedream-4.0',
    providerId: 'prov_doubao',
    providerName: '豆包 · 火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    priority: 20,
    upstreamModel: 'doubao-seedream-4-0-250828',
    displayName: 'Seedream 4.0',
    tools: 0,
    vision: 0,
    kind: 'image',
    unitFen: 20,
    sizes: ['1K', '2K', '4K'],
    input: 0,
    output: 0,
    cacheHit: 0,
    tier: 'work',
    priceNote: '文生图 / 图生图，官方约 ¥0.20 / 张。同一张豆包 Key，需在方舟开通该模型。',
  },
  {
    id: 'doubao-seedream-4.5',
    providerId: 'prov_doubao',
    providerName: '豆包 · 火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    priority: 20,
    upstreamModel: 'doubao-seedream-4-5-251128',
    displayName: 'Seedream 4.5',
    tools: 0,
    vision: 0,
    kind: 'image',
    unitFen: 25,
    sizes: ['2K', '4K'],
    input: 0,
    output: 0,
    cacheHit: 0,
    tier: 'work',
    priceNote: '画质更好的生图，官方约 ¥0.25 / 张。',
  },
  {
    id: 'doubao-seedream-5.0',
    providerId: 'prov_doubao',
    providerName: '豆包 · 火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    priority: 20,
    upstreamModel: 'doubao-seedream-5-0-260128',
    displayName: 'Seedream 5.0',
    tools: 0,
    vision: 0,
    kind: 'image',
    unitFen: 22,
    sizes: ['2K', '3K', '4K'],
    input: 0,
    output: 0,
    cacheHit: 0,
    tier: 'flagship',
    priceNote: '当前推荐的生图模型（Lite），官方约 ¥0.22 / 张，支持组图。',
  },
  {
    id: 'doubao-seedance-1.0-pro',
    providerId: 'prov_doubao',
    providerName: '豆包 · 火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    priority: 20,
    upstreamModel: 'doubao-seedance-1-0-pro-250528',
    displayName: 'Seedance 1.0 Pro',
    tools: 0,
    vision: 0,
    kind: 'video',
    unitFen: 17,
    resolutions: ['480p', '720p', '1080p'],
    durations: [2, 5, 8, 10, 12],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    videoFenPerSec: { '480p': 10, '720p': 17, '1080p': 36 },
    input: 0,
    output: 0,
    cacheHit: 0,
    tier: 'work',
    priceNote: '当前账号已开通。文生视频 / 图生视频，720p 约 ¥0.17 / 秒。',
  },
  {
    id: 'doubao-seedance-1.5-pro',
    providerId: 'prov_doubao',
    providerName: '豆包 · 火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    priority: 20,
    upstreamModel: 'doubao-seedance-1.5-pro-251215',
    displayName: 'Seedance 1.5 Pro',
    tools: 0,
    vision: 0,
    kind: 'video',
    unitFen: 35,
    resolutions: ['480p', '720p', '1080p'],
    durations: [4, 5, 8, 10, 12],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    videoFenPerSec: { '480p': 18, '720p': 35, '1080p': 77 },
    input: 0,
    output: 0,
    cacheHit: 0,
    tier: 'work',
    priceNote: '需在方舟单独开通 API。未开通时会自动改走 Seedance 1.0 Pro。',
  },
  {
    id: 'doubao-seedance-fast',
    providerId: 'prov_doubao',
    providerName: '豆包 · 火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    priority: 20,
    upstreamModel: 'doubao-seedance-2-0-fast-260128',
    displayName: 'Seedance Fast',
    tools: 0,
    vision: 0,
    kind: 'video',
    unitFen: 80,
    resolutions: ['480p', '720p'],
    durations: [4, 5, 8, 10, 12, 15],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    videoFenPerSec: { '480p': 37, '720p': 80 },
    input: 0,
    output: 0,
    cacheHit: 0,
    tier: 'work',
    priceNote: '文生视频 / 图生视频，720p 约 ¥0.80 / 秒（5 秒约 ¥4）。最高 720p。需在方舟开通 2.0 Fast。',
  },
  {
    id: 'doubao-seedance',
    providerId: 'prov_doubao',
    providerName: '豆包 · 火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    priority: 20,
    upstreamModel: 'doubao-seedance-2-0-260128',
    displayName: 'Seedance 2.0',
    tools: 0,
    vision: 0,
    kind: 'video',
    unitFen: 99,
    resolutions: ['480p', '720p', '1080p'],
    durations: [4, 5, 8, 10, 12, 15],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    videoFenPerSec: { '480p': 46, '720p': 99, '1080p': 248 },
    input: 0,
    output: 0,
    cacheHit: 0,
    tier: 'flagship',
    priceNote: '标准视频，1080p 5 秒约 ¥12.4。画质稳，贵；日常用 Fast。',
  },
]

export const DEFAULT_MODEL_PRICES: Record<string, { input: number; output: number; cacheHit: number }> = Object.fromEntries(
  MODEL_CATALOG.map((c) => [c.id, { input: c.input, output: c.output, cacheHit: c.cacheHit }]),
)

export const CATALOG_BY_ID = new Map(MODEL_CATALOG.map((c) => [c.id, c]))

export const PROMPT_MIX = 0.7
export const COMPLETION_MIX = 0.3
export const MIN_SAFE_MARKUP_X = 5
export const TARGET_MARKUP_X = 10
export const BASE_MODEL_ID = 'deepseek-chat'
const DRIFT_RATIO = 0.25

export type ProfitMode = 'margin_pct' | 'markup_x'

export function costFenFromTarget(priceFen: number, mode: ProfitMode, value: number): number {
  if (priceFen <= 0) return 0
  if (mode === 'markup_x') {
    const x = Math.max(1.05, Number(value) || 1.05)
    return Math.max(1, Math.round(priceFen / x))
  }
  const m = Math.min(90, Math.max(0, Number(value) || 0)) / 100
  return Math.max(1, Math.round(priceFen * (1 - m)))
}

export function niceQuota(n: number): number {
  const x = Math.max(1000, Math.round(n))
  if (x >= 1_000_000) return Math.round(x / 100_000) * 100_000
  if (x >= 100_000) return Math.round(x / 10_000) * 10_000
  return Math.round(x / 1000) * 1000
}

export function quotaFromProfit(priceFen: number, mixFenPerM: number, mode: ProfitMode, value: number): number {
  if (priceFen <= 0 || mixFenPerM <= 0) return 0
  const costFen = costFenFromTarget(priceFen, mode, value)
  return niceQuota((costFen / mixFenPerM) * 1e6)
}

export const TIER_LABEL: Record<ModelTier, string> = {
  base: '基准',
  work: '日常',
  flagship: '旗舰',
}

export const PRICING_NOTE =
  '后台统一用「份额」记账。DeepSeek 上 1 个 Token = 1 份额；更贵的模型 1 个 Token 扣更多份额。用户买的是份额包，官网和客户端只显示用了百分之几。官方 Token 价只做进货账。建议套餐售价 ≥ 5 倍基准满额进货，目标约 10 倍。'

export interface UsageTokens {
  prompt: number
  completion: number
  total?: number
  cacheHit?: number
}

export function mixFenPerMillion(model: Pick<ModelPricing, 'input_fen_per_m' | 'output_fen_per_m'>): number {
  return PROMPT_MIX * (model.input_fen_per_m || 0) + COMPLETION_MIX * (model.output_fen_per_m || 0)
}

export function worstFenPerMillion(model: Pick<ModelPricing, 'input_fen_per_m' | 'output_fen_per_m'>): number {
  return Math.max(model.input_fen_per_m || 0, model.output_fen_per_m || 0)
}

export function modelKind(id: string): ModelKind {
  return CATALOG_BY_ID.get(id)?.kind || 'chat'
}

export function isChatModel(id: string): boolean {
  return modelKind(id) === 'chat'
}

export function sharesFromOfficialFen(
  fen: number,
  base?: Pick<ModelPricing, 'input_fen_per_m' | 'output_fen_per_m'> | null,
): number {
  const mix = base ? mixFenPerMillion(base) : 190
  if (fen <= 0) return 1
  if (mix <= 0) return Math.max(1, fen * 5000)
  return Math.max(1, Math.ceil((fen / mix) * 1e6))
}

export function estimateGenerationFen(
  id: string,
  opts: { size?: string; resolution?: string; duration?: number; count?: number } = {},
): number {
  const cat = CATALOG_BY_ID.get(id)
  if (!cat || (cat.kind || 'chat') === 'chat') return 0
  if (cat.kind === 'image') {
    const n = Math.max(1, Math.min(4, opts.count || 1))
    return (cat.unitFen || 20) * n
  }
  const dur = Math.max(4, Math.min(15, Number(opts.duration) || 5))
  const res = opts.resolution || '720p'
  const perSec = cat.videoFenPerSec?.[res]
  if (typeof perSec === 'number') return Math.max(1, Math.round(perSec * dur))
  return Math.max(1, Math.round((cat.unitFen || 80) * dur))
}

export function suggestedMultiplier(model: ModelPricing, base: ModelPricing): number {
  if (modelKind(model.id) !== 'chat') return 1
  const baseMix = mixFenPerMillion(base)
  const mix = mixFenPerMillion(model)
  if (baseMix <= 0) return 1
  if (model.id === base.id) return 1
  return Math.max(0.1, Math.round((mix / baseMix) * 10) / 10)
}

export function applySuggestedMultipliers(models: ModelPricing[], baseId = BASE_MODEL_ID): Array<{ id: string; multiplier: number }> {
  const base = models.find((m) => m.id === baseId) || models[0]
  if (!base) return []
  return models.map((m) => ({ id: m.id, multiplier: suggestedMultiplier(m, base) }))
}

export function costFenForUsage(model: ModelPricing, usage: UsageTokens): number {
  const inputP = Number(model.input_fen_per_m) || 0
  const outputP = Number(model.output_fen_per_m) || 0
  const hitP = Number(model.cache_hit_fen_per_m) || 0
  const multiplier = model.multiplier || 1
  if (inputP <= 0 && outputP <= 0) {
    const billed = Math.max(1, Math.ceil((usage.total || usage.prompt + usage.completion || 1) * multiplier))
    return Math.max(0, Math.round((billed / 1000) * 2 * multiplier))
  }
  const prompt = usage.prompt || 0
  const hit = Math.min(Math.max(0, usage.cacheHit || 0), prompt)
  const miss = Math.max(0, prompt - hit)
  const fen = (hit * hitP + miss * inputP + (usage.completion || 0) * outputP) / 1e6
  return Math.max(0, Math.round(fen))
}

function allowedModels(pkg: PackagePricingInput, models: ModelPricing[]): ModelPricing[] {
  let allow: string[] = []
  try {
    allow = JSON.parse(pkg.models_json || '[]') as string[]
  } catch {
    allow = []
  }
  const enabled = models.filter((m) => m.enabled)
  const pool = allow.includes('*') ? enabled : enabled.filter((m) => allow.includes(m.id))
  return pool.length ? pool : enabled
}

function preferredModel(pool: ModelPricing[]): ModelPricing | undefined {
  const chat = pool.filter((m) => isChatModel(m.id))
  const src = chat.length ? chat : pool
  return src.find((m) => m.id === BASE_MODEL_ID) || src.slice().sort((a, b) => mixFenPerMillion(a) - mixFenPerMillion(b))[0]
}

function fullUseCost(quota: number, model: ModelPricing, fenPerM: number): number {
  const actual = quota / (model.multiplier || 1)
  return Math.max(0, Math.round((actual * fenPerM) / 1e6))
}

function pickByTier(pool: ModelPricing[], tier: ModelTier): ModelPricing | undefined {
  return pool.find((m) => isChatModel(m.id) && CATALOG_BY_ID.get(m.id)?.tier === tier)
}

export function analyzePackage(pkg: PackagePricingInput, models: ModelPricing[]) {
  const pool = allowedModels(pkg, models)
  const base = models.find((m) => m.id === BASE_MODEL_ID)
  const primary = preferredModel(pool)
  const byModel = pool.map((m) => {
    const cat = CATALOG_BY_ID.get(m.id)
    const kind = cat?.kind || 'chat'
    if (kind !== 'chat') {
      const unitFen = estimateGenerationFen(m.id, kind === 'video' ? { duration: 5, resolution: '720p' } : { size: '2K' })
      const unitShares = sharesFromOfficialFen(unitFen, base)
      const generations = unitShares > 0 ? Math.floor(pkg.token_quota / unitShares) : 0
      const costFen = unitFen * generations
      const profitFen = pkg.price_fen - costFen
      const marginPct = pkg.price_fen > 0 ? Math.round((profitFen / pkg.price_fen) * 1000) / 10 : null
      return {
        modelId: m.id,
        displayName: m.display_name,
        kind,
        tier: cat?.tier || 'work',
        multiplier: 1,
        suggestedMultiplier: 1,
        drifted: false,
        mixFenPerM: unitFen,
        typicalFen: costFen,
        conservativeFen: costFen,
        userTokens: generations,
        costFen,
        profitFen,
        marginPct,
        sharesPerToken: unitShares,
        unitFen,
        unitShares,
      }
    }
    const suggested = base ? suggestedMultiplier(m, base) : m.multiplier || 1
    const current = m.multiplier || 1
    const drifted = suggested > 0 && Math.abs(current - suggested) / suggested > DRIFT_RATIO
    const userTokens = Math.round(pkg.token_quota / Math.max(0.1, current))
    const costFen = fullUseCost(pkg.token_quota, m, mixFenPerMillion(m))
    const profitFen = pkg.price_fen - costFen
    const marginPct = pkg.price_fen > 0 ? Math.round((profitFen / pkg.price_fen) * 1000) / 10 : null
    return {
      modelId: m.id,
      displayName: m.display_name,
      kind,
      tier: cat?.tier || 'work',
      multiplier: current,
      suggestedMultiplier: suggested,
      drifted,
      mixFenPerM: Math.round(mixFenPerMillion(m)),
      typicalFen: costFen,
      conservativeFen: fullUseCost(pkg.token_quota, m, worstFenPerMillion(m)),
      userTokens,
      costFen,
      profitFen,
      marginPct,
      sharesPerToken: current,
    }
  })
  const typicalCostFen = primary ? fullUseCost(pkg.token_quota, primary, mixFenPerMillion(primary)) : 0
  const mixWork = pickByTier(pool, 'work') || primary
  const mixFlag = pickByTier(pool, 'flagship') || mixWork
  const blendCostFen = Math.round(
    0.7 * (primary ? fullUseCost(pkg.token_quota, primary, mixFenPerMillion(primary)) : 0) +
      0.2 * (mixWork ? fullUseCost(pkg.token_quota, mixWork, mixFenPerMillion(mixWork)) : 0) +
      0.1 * (mixFlag ? fullUseCost(pkg.token_quota, mixFlag, mixFenPerMillion(mixFlag)) : 0),
  )
  const conservativeCostFen = byModel.reduce((max, row) => Math.max(max, row.typicalFen), 0)
  const outputHeavyFen = byModel.reduce((max, row) => Math.max(max, row.conservativeFen), 0)
  const sellFenPerM = pkg.token_quota > 0 ? Math.round((pkg.price_fen / pkg.token_quota) * 1e6) : 0
  const typicalCostFenPerM = pkg.token_quota > 0 ? Math.round((typicalCostFen / pkg.token_quota) * 1e6) : 0
  const typicalMarginFen = pkg.price_fen - typicalCostFen
  const blendMarginFen = pkg.price_fen - blendCostFen
  const conservativeMarginFen = pkg.price_fen - conservativeCostFen
  const typicalMarginPct =
    pkg.price_fen > 0 ? Math.round((typicalMarginFen / pkg.price_fen) * 1000) / 10 : null
  const blendMarginPct = pkg.price_fen > 0 ? Math.round((blendMarginFen / pkg.price_fen) * 1000) / 10 : null
  const conservativeMarginPct =
    pkg.price_fen > 0 ? Math.round((conservativeMarginFen / pkg.price_fen) * 1000) / 10 : null
  const markupX =
    typicalCostFen > 0 && pkg.price_fen > 0 ? Math.round((pkg.price_fen / typicalCostFen) * 10) / 10 : null
  const suggestedMinFen = typicalCostFen * MIN_SAFE_MARKUP_X
  const suggestedTargetFen = typicalCostFen * TARGET_MARKUP_X
  const dsMult = Math.max(0.1, base?.multiplier || 1)
  const deepseekTokenEquiv = Math.round(pkg.token_quota / dsMult)
  const deepseekInputTokens = Math.round(deepseekTokenEquiv * PROMPT_MIX)
  const deepseekOutputTokens = Math.round(deepseekTokenEquiv * COMPLETION_MIX)
  const dsIn = base?.input_fen_per_m || 0
  const dsOut = base?.output_fen_per_m || 0
  const deepseekOfficialInputFen = Math.round((deepseekInputTokens * dsIn) / 1e6)
  const deepseekOfficialOutputFen = Math.round((deepseekOutputTokens * dsOut) / 1e6)
  const deepseekOfficialMixFen = deepseekOfficialInputFen + deepseekOfficialOutputFen
  const deepseekOfficialAllInputFen = Math.round((deepseekTokenEquiv * dsIn) / 1e6)
  const deepseekOfficialAllOutputFen = Math.round((deepseekTokenEquiv * dsOut) / 1e6)
  const vsDeepseekOfficialX =
    deepseekOfficialMixFen > 0 && pkg.price_fen > 0
      ? Math.round((pkg.price_fen / deepseekOfficialMixFen) * 10) / 10
      : null
  const drifted = byModel.some((row) => row.drifted)
  let status: 'gift' | 'low' | 'risk' | 'healthy' = 'healthy'
  let statusLabel = '差价健康'
  let warn = ''
  if (pkg.price_fen <= 0) {
    status = 'gift'
    statusLabel = '赠送获客'
    warn = '体验额度按进货成本计入获客，不要求毛利。只开放基准模型。'
  } else if (typicalCostFen > 0 && pkg.price_fen < suggestedMinFen) {
    status = 'low'
    statusLabel = '售价偏低'
    warn = `建议至少卖到 ${(suggestedMinFen / 100).toFixed(0)} 元（5 倍基准满额进货）。`
  } else if (drifted && conservativeCostFen > 0 && pkg.price_fen < conservativeCostFen * MIN_SAFE_MARKUP_X) {
    status = 'risk'
    statusLabel = '旗舰未对冲'
    warn = '套餐含更贵模型，但倍率低于进货比。用户若全开旗舰，差价会被吃掉。请点「按进货价同步倍率」。'
  } else if (drifted) {
    status = 'risk'
    statusLabel = '倍率未对齐'
    warn = '部分模型倍率与官方进货比不一致，差价会随用户选模波动。'
  }
  return {
    id: pkg.id,
    name: pkg.name,
    slug: pkg.slug,
    priceFen: pkg.price_fen,
    tokenQuota: pkg.token_quota,
    primaryModelId: primary?.id || null,
    sellFenPerM,
    typicalCostFenPerM,
    typicalCostFen,
    blendCostFen,
    conservativeCostFen,
    outputHeavyFen,
    typicalMarginFen,
    blendMarginFen,
    conservativeMarginFen,
    typicalMarginPct,
    blendMarginPct,
    conservativeMarginPct,
    markupX,
    suggestedMinFen,
    suggestedTargetFen,
    deepseek: {
      tokenEquiv: deepseekTokenEquiv,
      inputTokens: deepseekInputTokens,
      outputTokens: deepseekOutputTokens,
      inputFenPerM: dsIn,
      outputFenPerM: dsOut,
      officialInputFen: deepseekOfficialInputFen,
      officialOutputFen: deepseekOfficialOutputFen,
      officialMixFen: deepseekOfficialMixFen,
      officialAllInputFen: deepseekOfficialAllInputFen,
      officialAllOutputFen: deepseekOfficialAllOutputFen,
      vsOfficialX: vsDeepseekOfficialX,
      extraFen: pkg.price_fen - deepseekOfficialMixFen,
    },
    status,
    statusLabel,
    warn,
    byModel,
  }
}

export function buildPricingReport(opts: {
  packages: PackagePricingInput[]
  models: ModelPricing[]
  revenueFen: number
  costFen: number
  billedTokens: number
  profitConfig?: { mode: ProfitMode; value: number }
}) {
  const marginFen = opts.revenueFen - opts.costFen
  const marginPct = opts.revenueFen > 0 ? Math.round((marginFen / opts.revenueFen) * 1000) / 10 : null
  const base = opts.models.find((m) => m.id === BASE_MODEL_ID)
  return {
    note: PRICING_NOTE,
    mix: { prompt: PROMPT_MIX, completion: COMPLETION_MIX, cache: 'miss' as const, blend: '70% 基准 + 20% 日常 + 10% 旗舰' },
    minSafeMarkupX: MIN_SAFE_MARKUP_X,
    targetMarkupX: TARGET_MARKUP_X,
    baseModelId: BASE_MODEL_ID,
    baseOfficial: base
      ? {
          displayName: base.display_name,
          inputFenPerM: base.input_fen_per_m || 0,
          outputFenPerM: base.output_fen_per_m || 0,
          mixFenPerM: Math.round(mixFenPerMillion(base)),
        }
      : null,
    realized: {
      revenueFen: opts.revenueFen,
      costFen: opts.costFen,
      marginFen,
      marginPct,
      billedTokens: opts.billedTokens,
    },
    models: opts.models.map((m) => {
      const cat = CATALOG_BY_ID.get(m.id)
      const suggested = base ? suggestedMultiplier(m, base) : m.multiplier || 1
      return {
        ...m,
        mixFenPerM: Math.round(mixFenPerMillion(m)),
        worstFenPerM: worstFenPerMillion(m),
        suggestedMultiplier: suggested,
        drifted: suggested > 0 && Math.abs((m.multiplier || 1) - suggested) / suggested > DRIFT_RATIO,
        tier: cat?.tier || 'work',
        tierLabel: TIER_LABEL[cat?.tier || 'work'],
        priceNote: cat?.priceNote || '',
        kind: cat?.kind || 'chat',
        catalogInput: cat?.input,
        catalogOutput: cat?.output,
        catalogCacheHit: cat?.cacheHit,
        providerName: cat?.providerName || m.provider_id,
      }
    }),
    packages: opts.packages.map((pkg) => {
      const row = analyzePackage(pkg, opts.models)
      const mix = base ? mixFenPerMillion(base) : 0
      const cfg = opts.profitConfig || { mode: 'margin_pct' as ProfitMode, value: 50 }
      return {
        ...row,
        suggestedQuota: quotaFromProfit(pkg.price_fen, mix, cfg.mode, cfg.value),
      }
    }),
    profitConfig: opts.profitConfig || { mode: 'margin_pct' as ProfitMode, value: 50 },
    catalog: MODEL_CATALOG.map((c) => ({
      id: c.id,
      providerId: c.providerId,
      providerName: c.providerName,
      displayName: c.displayName,
      kind: c.kind || 'chat',
      tier: c.tier,
      tierLabel: TIER_LABEL[c.tier],
      input: c.input,
      output: c.output,
      cacheHit: c.cacheHit,
      unitFen: c.unitFen || 0,
      priceNote: c.priceNote,
    })),
  }
}
