import type { AgentMode, ExpertMeta, ExpertTeamMeta, SkillMeta } from './types'

export function buildSystemPrompt(opts: {
  workspace: string
  mode: AgentMode
  planning: boolean
  tree: string
  skills: SkillMeta[]
  expert?: ExpertMeta | null
  team?: ExpertTeamMeta | null
  extraSystem?: string
}): string {
  const modeHint =
    opts.mode === 'ask'
      ? '当前是 Ask 模式：只能阅读和检索，禁止创建、修改、删除文件，禁止执行 Shell。'
      : opts.mode === 'plan' && opts.planning
        ? '当前是 Plan 模式：先调研并调用 SubmitPlan 提交方案。在用户确认前不要执行写入或 Shell。'
        : '当前是 Craft 模式：直接完成任务。优先在工作空间内交付可验收文件，而不是只给建议。'

  const expertBlock = opts.expert
    ? `\n你正在以专家「${opts.expert.name} · ${opts.expert.title}」身份工作。\n${opts.expert.systemPrompt}\n方法论：\n${opts.expert.methodology}`
    : ''

  const teamBlock = opts.team
    ? `\n你是专家团「${opts.team.name}」的团长。先拆解任务，再用 Task 工具把子任务分给成员，最后汇总成一份可验收结果。成员：${opts.team.memberIds.join('、')}。`
    : ''

  const skillBlock = opts.skills.length
    ? `\n已启用技能：\n${opts.skills.map((s) => `### ${s.name}\n${s.body}`).join('\n\n')}`
    : ''

  return [
    '你是光途Work，一个可在用户本机工作空间里完成任务的 Agent。',
    '用中文回复。先理解目标，再按需调用工具，最后给出简短结论和产物路径。',
    modeHint,
    `工作空间：${opts.workspace}`,
    '路径规则：工具参数里的路径尽量使用相对工作空间的路径。不要尝试逃逸到工作空间之外，除非用户明确要求并已授权。',
    '不要编造文件内容。需要信息时先 Read / Glob / Grep。',
    'Bash 在 Windows 上通过 PowerShell 执行，工作目录为工作空间。避免危险命令。',
    expertBlock,
    teamBlock,
    skillBlock,
    opts.extraSystem ? `\n附加约束：\n${opts.extraSystem}` : '',
    `\n工作空间文件树（截断）：\n${opts.tree}`,
  ]
    .filter(Boolean)
    .join('\n')
}
