import type { ExecutableTool } from '../types'

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const webTools: ExecutableTool[] = [
  {
    spec: {
      type: 'function',
      function: {
        name: 'WebFetch',
        description: '获取一个公开 HTTP/HTTPS 页面的文本内容。',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string' },
          },
          required: ['url'],
        },
      },
    },
    risk: 'low',
    readonly: true,
    async execute(args, ctx) {
      const url = String(args.url || '')
      if (!/^https?:\/\//i.test(url)) return { ok: false, content: '只允许 http/https URL' }
      const resp = await fetch(url, { redirect: 'follow', signal: ctx.signal })
      const text = await resp.text()
      const body = stripTags(text).slice(0, 20_000)
      return { ok: resp.ok, title: url, content: `HTTP ${resp.status}\n${body}` }
    },
  },
  {
    spec: {
      type: 'function',
      function: {
        name: 'WebSearch',
        description: '通过 DuckDuckGo 检索公开网页摘要。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      },
    },
    risk: 'low',
    readonly: true,
    async execute(args) {
      const query = String(args.query || '').trim()
      if (!query) return { ok: false, content: '查询为空' }
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
      const resp = await fetch(url, { headers: { 'User-Agent': 'gt-workbench/0.1' } })
      const data = (await resp.json()) as {
        AbstractText?: string
        AbstractURL?: string
        Heading?: string
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>
      }
      const lines: string[] = []
      if (data.Heading) lines.push(`# ${data.Heading}`)
      if (data.AbstractText) lines.push(data.AbstractText, data.AbstractURL || '')
      const topics = data.RelatedTopics || []
      for (const topic of topics.slice(0, 8)) {
        if (topic.Text) lines.push(`- ${topic.Text} ${topic.FirstURL || ''}`)
        for (const sub of topic.Topics || []) {
          if (sub.Text) lines.push(`- ${sub.Text} ${sub.FirstURL || ''}`)
        }
      }
      return { ok: true, title: query, content: lines.join('\n').trim() || '未找到摘要，可改用 WebFetch 打开具体链接。' }
    },
  },
]
