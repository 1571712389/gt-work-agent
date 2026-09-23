import { useEffect, useState } from 'react'
import type { TaskMessage } from '@shared/protocol'
import { toolProgressLabel } from './tool-display'

export { toolProgressLabel }

export function activityLabel(messages: TaskMessage[], running: boolean, stalled: boolean): string | null {
  if (!running) return null
  const last = messages.at(-1)
  if (!last || last.role === 'user') return '思考中'
  if (last.tool && !last.tool.result) return toolProgressLabel(last.tool)
  if (last.tool && last.tool.result) return '继续处理中'
  if (last.role === 'assistant' && !String(last.content || '').trim()) return '思考中'
  if (last.role === 'assistant') return null
  if (stalled) return '继续处理中'
  return null
}

export function useActivityLabel(messages: TaskMessage[], running: boolean): string | null {
  const last = messages.at(-1)
  const sig = [messages.length, last?.id || '', last?.tool?.name || '', last?.tool?.result ? '1' : '0', running ? '1' : '0'].join(':')
  const [stalled, setStalled] = useState(false)

  useEffect(() => {
    if (!running) {
      setStalled(false)
      return
    }
    setStalled(false)
    const id = window.setTimeout(() => setStalled(true), 450)
    return () => window.clearTimeout(id)
  }, [running, sig])

  return activityLabel(messages, running, stalled)
}
