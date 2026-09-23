import { bashTool } from './bash'
import { fsTools } from './fs'
import { metaTools } from './meta'
import { officeTools } from './office'
import { webTools } from './web'
import type { AgentMode, ExecutableTool } from '../types'

export function builtinTools(): ExecutableTool[] {
  return [...fsTools, bashTool, ...webTools, ...metaTools, ...officeTools]
}

export function toolsForMode(all: ExecutableTool[], mode: AgentMode, planning: boolean): ExecutableTool[] {
  if (mode === 'ask') return all.filter((t) => t.readonly && t.spec.function.name !== 'SubmitPlan')
  if (mode === 'plan' && planning) {
    return all.filter((t) => t.readonly || t.spec.function.name === 'SubmitPlan')
  }
  return all
}
