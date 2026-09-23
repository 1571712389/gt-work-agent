import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { ExecutableTool, ToolResult } from '@gt-workbench/agent-core'

function isMcpNoise(text: string): boolean {
  const line = text.trim()
  if (!line) return true
  if (/npm warn deprecated/i.test(line)) return true
  if (/Client does not support MCP Roots/i.test(line)) return true
  if (/using allowed directories set from server args/i.test(line)) return true
  if (/Secure MCP Filesystem Server running/i.test(line)) return true
  if (/Sequential Thinking MCP Server running/i.test(line)) return true
  if (/^MCP .* running on stdio/i.test(line)) return true
  return false
}

export interface McpServerConfig {
  id: string
  command: string
  args?: string[]
  env?: Record<string, string>
  scope: 'user' | 'project' | 'local'
  approved?: boolean
  disabled?: boolean
}

interface LiveServer {
  config: McpServerConfig
  client: Client
}

export class McpHost {
  private servers = new Map<string, LiveServer>()

  list(): McpServerConfig[] {
    return [...this.servers.values()].map((s) => s.config)
  }

  async connect(config: McpServerConfig): Promise<void> {
    if (!config.approved) throw new Error(`MCP 服务器 ${config.id} 尚未批准`)
    if (config.disabled) return
    await this.disconnect(config.id)
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: {
        ...process.env,
        npm_config_update_notifier: 'false',
        npm_config_loglevel: 'error',
        ...config.env,
      },
      // 默认 inherit 会把 MCP / npx 的弃用提示打到 Electron 终端，看起来像报错
      stderr: 'pipe',
    })
    const stderr = transport.stderr
    if (stderr) {
      stderr.on('data', (chunk: Buffer | string) => {
        const text = String(chunk)
        if (isMcpNoise(text)) return
        process.stderr.write(chunk)
      })
    }
    const client = new Client({ name: 'gt-workbench', version: '0.1.0' }, { capabilities: {} })
    await client.connect(transport)
    this.servers.set(config.id, { config, client })
  }

  async disconnect(id: string): Promise<void> {
    const live = this.servers.get(id)
    if (!live) return
    try {
      await live.client.close()
    } catch {
      /* ignore */
    }
    this.servers.delete(id)
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.servers.keys()].map((id) => this.disconnect(id)))
  }

  async asTools(): Promise<ExecutableTool[]> {
    const tools: ExecutableTool[] = []
    for (const [id, live] of this.servers) {
      const listed = await live.client.listTools()
      for (const tool of listed.tools) {
        const name = `mcp__${id}__${tool.name}`
        tools.push({
          spec: {
            type: 'function',
            function: {
              name,
              description: `[MCP:${id}] ${tool.description || tool.name}`,
              parameters: (tool.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
            },
          },
          risk: 'medium',
          readonly: false,
          execute: async (args): Promise<ToolResult> => {
            const result = await live.client.callTool({ name: tool.name, arguments: args })
            const text = Array.isArray(result.content)
              ? result.content
                  .map((part) => {
                    if ('text' in part && typeof part.text === 'string') return part.text
                    return JSON.stringify(part)
                  })
                  .join('\n')
              : JSON.stringify(result.content)
            return { ok: !result.isError, title: name, content: text || '(empty)' }
          },
        })
      }
    }
    return tools
  }
}
