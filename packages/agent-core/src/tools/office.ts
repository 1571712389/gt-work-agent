import ExcelJS from 'exceljs'
import PptxGenJS from 'pptxgenjs'
import path from 'node:path'
import { ensureParentDir, resolveWorkspacePath } from '../sandbox'
import type { ExecutableTool } from '../types'

export const officeTools: ExecutableTool[] = [
  {
    spec: {
      type: 'function',
      function: {
        name: 'GenerateXlsx',
        description: '根据行列数据生成 Excel 文件到工作空间。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            sheets: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'null'] } } },
                },
                required: ['name', 'rows'],
              },
            },
          },
          required: ['path', 'sheets'],
        },
      },
    },
    risk: 'medium',
    readonly: false,
    async execute(args, ctx) {
      const abs = resolveWorkspacePath(String(args.path || 'report.xlsx'), {
        workspace: ctx.workspace,
        extraAllowDirs: ctx.extraAllowDirs,
      })
      ensureParentDir(abs)
      const wb = new ExcelJS.Workbook()
      const sheets = Array.isArray(args.sheets) ? args.sheets : []
      for (const sheet of sheets) {
        const row = sheet as { name?: string; rows?: unknown[][] }
        const ws = wb.addWorksheet(row.name || 'Sheet1')
        for (const data of row.rows || []) ws.addRow(data as (string | number | null)[])
      }
      if (!sheets.length) wb.addWorksheet('Sheet1')
      await wb.xlsx.writeFile(abs)
      return { ok: true, title: path.basename(abs), content: `已生成 ${abs}` }
    },
  },
  {
    spec: {
      type: 'function',
      function: {
        name: 'GeneratePptx',
        description: '根据标题和条目生成 PPTX 到工作空间。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            title: { type: 'string' },
            slides: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  bullets: { type: 'array', items: { type: 'string' } },
                },
                required: ['title'],
              },
            },
          },
          required: ['path', 'title', 'slides'],
        },
      },
    },
    risk: 'medium',
    readonly: false,
    async execute(args, ctx) {
      const abs = resolveWorkspacePath(String(args.path || 'deck.pptx'), {
        workspace: ctx.workspace,
        extraAllowDirs: ctx.extraAllowDirs,
      })
      ensureParentDir(abs)
      const pptx = new PptxGenJS()
      pptx.author = '光途Work'
      const cover = pptx.addSlide()
      cover.addText(String(args.title || '演示文稿'), {
        x: 0.8,
        y: 2.2,
        w: 8.4,
        fontSize: 32,
        bold: true,
        color: '0F172A',
      })
      const slides = Array.isArray(args.slides) ? args.slides : []
      for (const item of slides) {
        const slide = item as { title?: string; bullets?: string[] }
        const page = pptx.addSlide()
        page.addText(slide.title || '', { x: 0.6, y: 0.4, w: 9, fontSize: 22, bold: true, color: '1D4ED8' })
        page.addText((slide.bullets || []).map((b) => ({ text: b, options: { bullet: true, breakLine: true } })), {
          x: 0.7,
          y: 1.2,
          w: 8.6,
          h: 3.8,
          fontSize: 16,
          color: '334155',
        })
      }
      await pptx.writeFile({ fileName: abs })
      return { ok: true, title: path.basename(abs), content: `已生成 ${abs}` }
    },
  },
]
