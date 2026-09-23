---
id: excel-merge
name: Excel 合并报表
description: 合并多份 CSV/表格并生成带汇总的 xlsx。
tags: [office, excel]
---

# Excel 合并报表

1. Glob 找出 csv / 表格文件，Read 确认列名。
2. 对齐列后用 GenerateXlsx 写出，至少包含「明细」和「汇总」两个 sheet。
3. 同时写一份 `report-notes.md` 说明合并规则与异常行。
4. 不要手写假数据填空单元格，缺失就留空并在 notes 里标明。
