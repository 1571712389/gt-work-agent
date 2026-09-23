---
id: minutes-todo
name: 纪要转待办
description: 把会议纪要、聊天记录或录音要点拆成可执行待办，含负责人、截止日和优先级。
tags: [office]
---

# 纪要转待办

1. 先用 Glob / Grep / Read 收集工作空间里的纪要、聊天摘录或会议笔记。
2. 缺失信息用 AskUserQuestion 补：负责人默认规则、截止日期、是否只要未完成项。
3. 输出 `minutes-todo.md`，表格列：事项 / 负责人 / 截止 / 优先级 / 来源原句。
4. 不要编造未出现的承诺。含糊事项单独列入「待确认」。
