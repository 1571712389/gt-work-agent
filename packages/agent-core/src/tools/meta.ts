import type { ExecutableTool } from '../types'

export const metaTools: ExecutableTool[] = [
  {
    spec: {
      type: 'function',
      function: {
        name: 'AskUserQuestion',
        description: '向用户澄清关键信息。Plan 模式下在提交方案前使用。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            questions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  prompt: { type: 'string' },
                  options: { type: 'array', items: { type: 'string' } },
                  allowFreeText: { type: 'boolean' },
                },
                required: ['id', 'prompt'],
              },
            },
          },
          required: ['questions'],
        },
      },
    },
    risk: 'low',
    readonly: true,
    async execute(args, ctx) {
      const questions = Array.isArray(args.questions) ? args.questions : []
      const answers = await ctx.askUser({
        requestId: crypto.randomUUID(),
        taskId: ctx.taskId,
        title: String(args.title || '需要你确认几点'),
        questions: questions.map((q) => {
          const row = q as Record<string, unknown>
          return {
            id: String(row.id || crypto.randomUUID()),
            prompt: String(row.prompt || ''),
            options: Array.isArray(row.options) ? row.options.map(String) : undefined,
            allowFreeText: row.allowFreeText === true,
          }
        }),
      })
      return { ok: true, content: JSON.stringify(answers, null, 2) }
    },
  },
  {
    spec: {
      type: 'function',
      function: {
        name: 'SubmitPlan',
        description: '提交完整执行方案。仅 Plan 模式、用户确认前调用。确认后才会真正改文件。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            steps: { type: 'array', items: { type: 'string' } },
            files_to_touch: { type: 'array', items: { type: 'string' } },
            markdown: { type: 'string' },
          },
          required: ['title', 'markdown'],
        },
      },
    },
    risk: 'low',
    readonly: true,
    async execute(args, ctx) {
      const plan = {
        title: String(args.title || '执行方案'),
        steps: Array.isArray(args.steps) ? args.steps.map(String) : [],
        filesToTouch: Array.isArray(args.files_to_touch) ? args.files_to_touch.map(String) : [],
        markdown: String(args.markdown || ''),
      }
      ctx.onEvent({ type: 'plan', plan })
      ctx.onEvent({ type: 'status', status: 'awaiting_plan' })
      return {
        ok: true,
        extra: { _pause: 'awaiting_plan', plan },
        content: '方案已提交，等待用户确认后再执行。',
      }
    },
  },
  {
    spec: {
      type: 'function',
      function: {
        name: 'Task',
        description: '启动一个子 Agent 处理子任务。专家团或复杂并行拆解时使用。',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
            label: { type: 'string' },
            readonly: { type: 'boolean' },
          },
          required: ['prompt'],
        },
      },
    },
    risk: 'medium',
    readonly: false,
    async execute(args, ctx) {
      if (!ctx.spawnSubagent) return { ok: false, content: '当前运行环境不支持子 Agent。' }
      const result = await ctx.spawnSubagent({
        taskId: `${ctx.taskId}:sub:${crypto.randomUUID().slice(0, 8)}`,
        prompt: String(args.prompt || ''),
        label: args.label ? String(args.label) : undefined,
        readonly: args.readonly === true,
      })
      return { ok: true, title: String(args.label || 'subagent'), content: result }
    },
  },
  {
    spec: {
      type: 'function',
      function: {
        name: 'LoadSkill',
        description: '按需加载一个已安装技能的完整说明书。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
      },
    },
    risk: 'low',
    readonly: true,
    async execute(args) {
      return { ok: true, extra: { _loadSkill: String(args.id || '') }, content: `请求加载技能 ${args.id}` }
    },
  },
]
