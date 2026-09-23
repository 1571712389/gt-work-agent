import type { ExecutableTool } from '@gt-workbench/agent-core'
import { listReportTemplates, submitReport } from './dws-cli'

function contentRows(value: unknown): Array<{ key?: string; content: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const row = item && typeof item === 'object' ? (item as { key?: unknown; content?: unknown }) : {}
      return {
        key: row.key == null ? undefined : String(row.key),
        content: String(row.content || ''),
      }
    })
    .filter((item) => item.content.trim())
}

export function dingTalkTools(): ExecutableTool[] {
  return [
    {
      spec: {
        type: 'function',
        function: {
          name: 'DingTalkReportTemplates',
          description:
            '列出当前已登录钉钉账号可提交的日志模板和栏目。使用用户自己的企业身份，不要向用户索要 AppKey、AppSecret、userid 或 access_token。',
          parameters: { type: 'object', properties: {} },
        },
      },
      risk: 'low',
      readonly: true,
      async execute() {
        const templates = await listReportTemplates()
        if (!templates.length) return { ok: true, title: '钉钉日志模板', content: '已登录钉钉，但没有可用的日志模板。' }
        const lines = templates.map((item) =>
          item.fields.length ? `${item.name}（栏目：${item.fields.map((field) => field.key).join('、')}）` : item.name,
        )
        return { ok: true, title: '钉钉日志模板', content: `可提交的日志模板：\n${lines.join('\n')}` }
      },
    },
    {
      spec: {
        type: 'function',
        function: {
          name: 'DingTalkSubmitReport',
          description:
            '用当前已登录的钉钉账号，向用户自己的企业提交日志。contents 的 key 必须使用模板栏目名。禁止向用户索要 AppKey、AppSecret、userid 或 access_token，也不要编写 gettoken 脚本。',
          parameters: {
            type: 'object',
            properties: {
              templateName: { type: 'string', description: '模板名称，例如日报。不填时优先选名称里带日报或日志的模板。' },
              contents: {
                type: 'array',
                description: '按模板栏目拆开的正文。',
                items: {
                  type: 'object',
                  properties: {
                    key: { type: 'string', description: '模板栏目名' },
                    content: { type: 'string' },
                  },
                  required: ['content'],
                },
              },
            },
            required: ['contents'],
          },
        },
      },
      risk: 'high',
      readonly: false,
      async execute(args) {
        const content = await submitReport(
          typeof args.templateName === 'string' ? args.templateName : undefined,
          contentRows(args.contents),
        )
        return { ok: true, title: '提交钉钉日志', content }
      },
    },
  ]
}
