import { hashPassword, one, run, now, id } from './auth'
import type { PackageRow } from './auth'
import {
  applySuggestedMultipliers,
  costFenForUsage,
  MODEL_CATALOG,
  type ModelPricing,
} from './pricing'
import { many } from './db'
import { normalizeProviderKey } from './provider-key'
import './db'

const TRIAL_SKILLS = [
  'weekly-report',
  'meeting-notes',
  'excel-merge',
  'ppt-outline',
  'file-organize',
  'daily-standup',
  'email-reply',
  'meeting-agenda',
  'research-digest',
  'competitor-brief',
  'sop-write',
  'customer-reply',
  'social-post',
  'translate-zh',
  'mindmap-md',
  'travel-itinerary',
  'personal-plan',
  'proposal-onepager',
  'risk-register',
  'job-jd',
  'interview-notes',
  'minutes-todo',
  'expense-table',
  'weekly-plan',
  'notice-write',
  'mail-followup',
  'leave-request',
  'calendar-block',
  'handover-note',
]

function seedAdmin(): void {
  const email = 'admin'
  const legacy = one<{ id: string; email: string }>(
    'SELECT id, email FROM users WHERE role = ? AND email IN (?, ?)',
    ['admin', 'admin@local', 'admin@qq.com'],
  )
  if (legacy && legacy.email !== email && !one('SELECT id FROM users WHERE email = ?', [email])) {
    run('UPDATE users SET email = ? WHERE id = ?', [email, legacy.id])
  }
  if (!one('SELECT id FROM users WHERE email = ?', [email])) {
    run(
      `INSERT INTO users (id, email, name, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, 'admin', 'active', ?)`,
      [id('usr_'), email, '管理员', hashPassword(process.env.GT_ADMIN_PASSWORD || 'admin123'), now()],
    )
  }
  const password = process.env.GT_ADMIN_PASSWORD
  if (password && !one('SELECT key FROM app_meta WHERE key = ?', ['admin_password_from_env'])) {
    run('UPDATE users SET password_hash = ?, password_set = 1 WHERE email = ? AND role = ?', [
      hashPassword(password),
      email,
      'admin',
    ])
    run(`INSERT INTO app_meta (key, value) VALUES ('admin_password_from_env', '1')`)
  }
}

function seedPackages(): void {
  if (one('SELECT id FROM packages LIMIT 1')) return
  const pkgs: Array<Omit<PackageRow, 'enabled'> & { sort: number }> = [
    {
      id: 'pkg_trial',
      slug: 'trial',
      name: '体验版',
      description: '7 天体验，限定 DeepSeek（含 Flash / V4 Pro），适合试用本地工作台。',
      price_fen: 0,
      period_days: 7,
      token_quota: 100_000,
      daily_quota: 20_000,
      models_json: JSON.stringify(['deepseek-chat', 'deepseek-flash', 'deepseek-v4-pro']),
      skill_ids_json: JSON.stringify(TRIAL_SKILLS),
      max_concurrency: 1,
      allow_mcp: 0,
      allow_team: 0,
      seats: 1,
      sort: 1,
    },
    {
      id: 'pkg_pro',
      slug: 'pro',
      name: '专业版',
      description: '多模型 + 办公技能全开，适合个人高频使用。',
      price_fen: 9900,
      period_days: 30,
      token_quota: 5_000_000,
      daily_quota: 0,
      models_json: JSON.stringify([
        'deepseek-chat',
        'deepseek-flash',
        'deepseek-v4-pro',
        'doubao-mini',
        'doubao-lite',
        'gpt-4o-mini',
      ]),
      skill_ids_json: JSON.stringify(['*']),
      max_concurrency: 3,
      allow_mcp: 1,
      allow_team: 0,
      seats: 1,
      sort: 2,
    },
    {
      id: 'pkg_team',
      slug: 'team',
      name: '团队版',
      description: '多席位、专家团与项目空间，适合小团队交付。',
      price_fen: 29900,
      period_days: 30,
      token_quota: 20_000_000,
      daily_quota: 0,
      models_json: JSON.stringify(['*']),
      skill_ids_json: JSON.stringify(['*']),
      max_concurrency: 8,
      allow_mcp: 1,
      allow_team: 1,
      seats: 5,
      sort: 3,
    },
  ]
  for (const p of pkgs) {
    run(
      `INSERT INTO packages (id, slug, name, description, price_fen, period_days, token_quota, daily_quota, models_json, skill_ids_json, max_concurrency, allow_mcp, allow_team, seats, sort, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        p.id,
        p.slug,
        p.name,
        p.description,
        p.price_fen,
        p.period_days,
        p.token_quota,
        p.daily_quota,
        p.models_json,
        p.skill_ids_json,
        p.max_concurrency,
        p.allow_mcp,
        p.allow_team,
        p.seats,
        p.sort,
      ],
    )
  }
}

function seedProviders(): void {
  const providers = new Map<string, { name: string; baseUrl: string; priority: number }>()
  for (const item of MODEL_CATALOG) {
    if (!providers.has(item.providerId)) {
      providers.set(item.providerId, {
        name: item.providerName,
        baseUrl: item.baseUrl,
        priority: item.priority,
      })
    }
  }
  for (const [pid, prov] of providers) {
    if (!one('SELECT id FROM providers WHERE id = ?', [pid])) {
      run(`INSERT INTO providers (id, name, base_url, api_key, enabled, priority) VALUES (?, ?, ?, '', 1, ?)`, [
        pid,
        prov.name,
        prov.baseUrl,
        prov.priority,
      ])
    }
  }
  for (const item of MODEL_CATALOG) {
    if (one('SELECT id FROM models WHERE id = ?', [item.id])) continue
    run(
      `INSERT INTO models (id, provider_id, upstream_model, display_name, tools, multiplier, enabled, fallback_model_id, input_fen_per_m, output_fen_per_m, cache_hit_fen_per_m, kind, unit_fen)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.providerId,
        item.upstreamModel,
        item.displayName,
        item.tools,
        item.fallback || null,
        item.input,
        item.output,
        item.cacheHit,
        item.kind || 'chat',
        item.unitFen || 0,
      ],
    )
  }
}

function seedModelKinds(): void {
  for (const item of MODEL_CATALOG) {
    run(`UPDATE models SET kind = ?, unit_fen = CASE WHEN unit_fen = 0 THEN ? ELSE unit_fen END WHERE id = ?`, [
      item.kind || 'chat',
      item.unitFen || 0,
      item.id,
    ])
  }
}

function seedModelPrices(): void {
  for (const item of MODEL_CATALOG) {
    run(
      `UPDATE models SET input_fen_per_m = ?, output_fen_per_m = ?, cache_hit_fen_per_m = ? WHERE id = ? AND input_fen_per_m = 0 AND output_fen_per_m = 0`,
      [item.input, item.output, item.cacheHit, item.id],
    )
  }
}

function syncNewModelMultipliers(): void {
  const models = many<ModelPricing>('SELECT * FROM models')
  for (const row of applySuggestedMultipliers(models)) {
    run(`UPDATE models SET multiplier = ? WHERE id = ? AND multiplier = 1 AND id != 'deepseek-chat'`, [row.multiplier, row.id])
  }
}

function mergePackageModels(slug: string, extra: string[]): void {
  const row = one<{ models_json: string }>('SELECT models_json FROM packages WHERE slug = ?', [slug])
  if (!row) return
  let list: string[] = []
  try {
    list = JSON.parse(row.models_json || '[]') as string[]
  } catch {
    return
  }
  if (list.includes('*')) return
  const next = [...list]
  for (const id of extra) {
    if (!next.includes(id)) next.push(id)
  }
  if (next.length !== list.length) {
    run(`UPDATE packages SET models_json = ? WHERE slug = ?`, [JSON.stringify(next), slug])
  }
}

function ensurePackageAllowlists(): void {
  const pro = one<{ models_json: string }>('SELECT models_json FROM packages WHERE slug = ?', ['pro'])
  if (pro?.models_json === JSON.stringify(['deepseek-chat', 'gpt-4o-mini'])) {
    run(`UPDATE packages SET models_json = ? WHERE slug = 'pro'`, [
      JSON.stringify(['deepseek-chat', 'doubao-mini', 'doubao-lite', 'gpt-4o-mini']),
    ])
  }
  mergePackageModels('trial', ['deepseek-chat', 'deepseek-flash', 'deepseek-v4-pro'])
  mergePackageModels('pro', [
    'deepseek-chat',
    'deepseek-flash',
    'deepseek-v4-pro',
    'doubao-mini',
    'doubao-lite',
    'gpt-4o-mini',
    'doubao-seedream-4.0',
    'doubao-seedream-5.0',
    'doubao-seedance-1.0-pro',
    'doubao-seedance-1.5-pro',
    'doubao-seedance-fast',
  ])
}

function backfillUsageCosts(): void {
  if (one("SELECT key FROM app_meta WHERE key = 'cost_fen_official'")) return
  const models = many<ModelPricing>('SELECT * FROM models')
  if (!models.length) return
  const byId = new Map(models.map((m) => [m.id, m]))
  const logs = many<{ id: string; model: string; prompt_tokens: number; completion_tokens: number; total_tokens: number }>(
    'SELECT id, model, prompt_tokens, completion_tokens, total_tokens FROM usage_logs',
  )
  for (const log of logs) {
    const model = byId.get(log.model)
    if (!model) continue
    const fen = costFenForUsage(model, {
      prompt: log.prompt_tokens,
      completion: log.completion_tokens,
      total: log.total_tokens,
    })
    run('UPDATE usage_logs SET cost_fen = ? WHERE id = ?', [fen, log.id])
  }
  run(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('cost_fen_official', '1')`)
}

function revokeEnvSeededProviderKeys(): void {
  if (one("SELECT key FROM app_meta WHERE key = 'provider_keys_admin_only'")) return
  run(`UPDATE providers SET api_key = ''`)
  run(`INSERT INTO app_meta (key, value) VALUES ('provider_keys_admin_only', '1')`)
}

function repairProviderKeys(): void {
  const rows = many<{ id: string; api_key: string }>('SELECT id, api_key FROM providers')
  for (const row of rows) {
    const next = normalizeProviderKey(row.api_key)
    if (next !== row.api_key) {
      run('UPDATE providers SET api_key = ? WHERE id = ?', [next, row.id])
    }
  }
}

function syncSeedance15Upstream(): void {
  run(
    `UPDATE models SET upstream_model = 'doubao-seedance-1.5-pro-251215'
     WHERE id = 'doubao-seedance-1.5-pro' AND upstream_model IN (
       'doubao-seedance-1-5-pro',
       'doubao-seedance-1-5-pro-251215',
       ''
     )`,
  )
}

function seedExtras(): void {
  if (!one('SELECT id FROM coupons WHERE code = ?', ['LAUNCH50'])) {
    run(`INSERT INTO coupons (id, code, percent_off, expires_at, enabled) VALUES (?, ?, ?, NULL, 1)`, [
      id('cpn_'),
      'LAUNCH50',
      50,
    ])
  }
  if (!one('SELECT key FROM app_meta WHERE key = ?', ['shop_url'])) {
    run(`INSERT INTO app_meta (key, value) VALUES ('shop_url', ?)`, [process.env.GT_SHOP_URL || 'http://127.0.0.1:8787'])
  }
}

export function seedIfEmpty(): void {
  try {
    seedAdmin()
    seedPackages()
    seedProviders()
    revokeEnvSeededProviderKeys()
    repairProviderKeys()
    seedModelPrices()
    seedModelKinds()
    syncNewModelMultipliers()
    ensurePackageAllowlists()
    syncSeedance15Upstream()
    backfillUsageCosts()
    seedExtras()
    run(`UPDATE packages SET skill_ids_json = ? WHERE slug = 'trial'`, [JSON.stringify(TRIAL_SKILLS)])
  } catch (err) {
    const locked = err && typeof err === 'object' && 'errstr' in err && (err as { errstr?: string }).errstr === 'database is locked'
    if (locked) {
      console.warn('数据库被占用，跳过本次种子写入。')
      return
    }
    throw err
  }
}

seedIfEmpty()
