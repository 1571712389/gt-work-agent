import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const DATA = process.env.GT_API_DATA || path.resolve('data')
fs.mkdirSync(DATA, { recursive: true })

export const db = new DatabaseSync(path.join(DATA, 'workbench.db'))
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA busy_timeout = 8000')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price_fen INTEGER NOT NULL,
  period_days INTEGER NOT NULL,
  token_quota INTEGER NOT NULL,
  daily_quota INTEGER NOT NULL DEFAULT 0,
  models_json TEXT NOT NULL,
  skill_ids_json TEXT NOT NULL DEFAULT '[]',
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  allow_mcp INTEGER NOT NULL DEFAULT 0,
  allow_team INTEGER NOT NULL DEFAULT 0,
  seats INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  tokens_remaining INTEGER NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (package_id) REFERENCES packages(id)
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  amount_fen INTEGER NOT NULL,
  status TEXT NOT NULL,
  pay_method TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  order_id TEXT,
  title TEXT NOT NULL,
  tax_no TEXT NOT NULL,
  email TEXT NOT NULL,
  amount_fen INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 10
);
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  upstream_model TEXT NOT NULL,
  display_name TEXT NOT NULL,
  tools INTEGER NOT NULL DEFAULT 1,
  multiplier REAL NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  fallback_model_id TEXT,
  input_fen_per_m INTEGER NOT NULL DEFAULT 0,
  output_fen_per_m INTEGER NOT NULL DEFAULT 0,
  cache_hit_fen_per_m INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (provider_id) REFERENCES providers(id)
);
CREATE TABLE IF NOT EXISTS usage_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_id TEXT,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  billed_tokens INTEGER NOT NULL,
  cost_fen INTEGER NOT NULL DEFAULT 0,
  task_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  percent_off INTEGER NOT NULL,
  expires_at INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS password_resets (
  email TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sms_codes (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0
);
`)

{
  const cols = many<{ name: string }>('PRAGMA table_info(users)')
  const modelCols = many<{ name: string }>('PRAGMA table_info(models)')
  const addModelCol = (name: string, ddl: string) => {
    if (!modelCols.some((c) => c.name === name)) run(`ALTER TABLE models ADD COLUMN ${name} ${ddl}`)
  }
  addModelCol('input_fen_per_m', 'INTEGER NOT NULL DEFAULT 0')
  addModelCol('output_fen_per_m', 'INTEGER NOT NULL DEFAULT 0')
  addModelCol('cache_hit_fen_per_m', 'INTEGER NOT NULL DEFAULT 0')
  addModelCol('kind', "TEXT NOT NULL DEFAULT 'chat'")
  addModelCol('unit_fen', 'INTEGER NOT NULL DEFAULT 0')
  if (!cols.some((c) => c.name === 'phone')) {
    run('ALTER TABLE users ADD COLUMN phone TEXT')
  }
  run(`CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uq ON users(phone) WHERE phone IS NOT NULL AND phone != ''`)
  run(`CREATE INDEX IF NOT EXISTS sms_codes_phone_sent ON sms_codes(phone, sent_at)`)
  run(`CREATE INDEX IF NOT EXISTS email_codes_email_sent ON email_codes(email, sent_at)`)
  if (!cols.some((c) => c.name === 'password_set')) {
    run('ALTER TABLE users ADD COLUMN password_set INTEGER NOT NULL DEFAULT 1')
  }
  const orderCols = many<{ name: string }>('PRAGMA table_info(orders)')
  if (!orderCols.some((c) => c.name === 'credit_tokens')) {
    run('ALTER TABLE orders ADD COLUMN credit_tokens INTEGER NOT NULL DEFAULT 0')
  }
  db.exec(`
CREATE TABLE IF NOT EXISTS desktop_auths (
  id TEXT PRIMARY KEY,
  user_code_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  user_id TEXT,
  session_token TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_at INTEGER
);
CREATE INDEX IF NOT EXISTS desktop_auths_status ON desktop_auths(status, expires_at);
CREATE TABLE IF NOT EXISTS client_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS client_tasks_user_updated ON client_tasks(user_id, updated_at);
`);
  db.exec(`
CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_id TEXT,
  prompt TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  upstream_id TEXT,
  result_json TEXT,
  error TEXT,
  billed_tokens INTEGER NOT NULL DEFAULT 0,
  cost_fen INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS generation_jobs_user ON generation_jobs(user_id, created_at);
`)
}

export function one<T>(sql: string, params: unknown[] = []): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined
}

export function many<T>(sql: string, params: unknown[] = []): T[] {
  return db.prepare(sql).all(...params) as T[]
}

export function run(sql: string, params: unknown[] = []): void {
  db.prepare(sql).run(...params)
}

export function now(): number {
  return Date.now()
}

export function id(prefix = ''): string {
  return `${prefix}${crypto.randomUUID()}`
}
