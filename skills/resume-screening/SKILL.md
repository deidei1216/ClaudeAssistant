---
name: resume-screening
description: 简历筛选技能，用于根据岗位要求对候选人简历进行多维度评估
---

# Resume Screening Skill

## Overview

简历筛选技能，支持 Word/PDF 简历解析、多维度评估、报告生成和批量处理。

## When to Use

- 上传简历文件（Word/PDF）时自动触发
- 需要对候选人进行标准化筛选评估
- 批量处理多份简历（最多 20 份/批次）
- 使用岗位模板快速设定评估标准

## Capabilities

- **简历解析**：提取 Word/PDF 文件中的文本内容
- **多维度评估**：技能匹配、经验年限、学历证书、项目经历、软技能
- **岗位模板库**：预设常见岗位的评估标准
- **报告生成**：Markdown 格式筛选报告
- **批量处理**：并发处理，最多 5 个并行

## Output

- 单份简历：Markdown 筛选报告
- 批量处理：各简历独立报告 + 汇总表

## Files

- `skills/resume-screening/index.ts` - 入口模块
- `skills/resume-screening/lib/types.ts` - 类型定义
- `skills/resume-screening/lib/resume-parser.ts` - 简历解析
- `skills/resume-screening/lib/template-manager.ts` - 模板管理
- `skills/resume-screening/lib/screening-engine.ts` - 评估引擎
- `skills/resume-screening/lib/report-generator.ts` - 报告生成
- `skills/resume-screening/lib/batch-processor.ts` - 批量处理
- `skills/resume-screening/templates/` - 岗位模板库