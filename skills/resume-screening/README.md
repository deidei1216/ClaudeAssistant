# Resume Screening Skill

简历筛选技能，用于根据岗位要求对候选人简历进行多维度评估。

## 功能特性

- **简历解析**：支持 Word (.docx, .doc) 和 PDF 文件的文本提取
- **多维度评估**：技能匹配、经验年限、学历证书、项目经历、软技能
- **岗位模板库**：预设常见岗位的评估标准，支持自定义模板
- **报告生成**：Markdown 格式筛选报告
- **批量处理**：并发处理，最多 5 个并行，单批次最多 20 份简历

## 安装

确保已安装 `pdf-parse` 依赖：

```bash
npm install pdf-parse
```

## 使用方式

### 单份简历筛选

```typescript
import { parseResume } from './skills/resume-screening/lib/resume-parser';
import { loadTemplate } from './skills/resume-screening/lib/template-manager';
import { screenResume } from './skills/resume-screening/lib/screening-engine';
import { generateReport, publishReport } from './skills/resume-screening/lib/report-generator';

// 1. 解析简历
const resumeData = await parseResume('/path/to/resume.pdf');

// 2. 加载岗位模板
const template = loadTemplate('java-developer');

// 3. 执行筛选
const { result } = screenResume(resumeData, template);

// 4. 生成报告
const report = generateReport(result);

// 5. 发布报告
publishReport(report, '/path/to/workspace');
```

### 批量处理

```typescript
import { processBatchAndPublish } from './skills/resume-screening/lib/batch-processor';

const filePaths = [
  '/path/to/resume1.pdf',
  '/path/to/resume2.docx',
  // ... 最多 20 份
];

const result = await processBatchAndPublish(filePaths, '/path/to/workspace', {
  templateId: 'java-developer'
});

console.log(`成功: ${result.successCount}, 失败: ${result.failureCount}`);
```

### 使用自定义岗位要求

```typescript
import { createDefaultTemplate } from './skills/resume-screening/lib/template-manager';
import { screenResume } from './skills/resume-screening/lib/screening-engine';

const template = createDefaultTemplate('高级前端工程师');
template.requiredSkills = ['React', 'TypeScript', 'Node.js'];
template.experienceYears = '5+';
template.education = '本科及以上';

const { result } = screenResume(resumeData, template);
```

## 岗位模板

### 使用预设模板

```typescript
import { listTemplates, loadTemplate } from './skills/resume-screening/lib/template-manager';

// 列出所有模板
const templates = listTemplates();
// [{ id: 'java-developer', name: 'Java 开发工程师', ... }, ...]

// 加载特定模板
const template = loadTemplate('java-developer');
```

### 创建自定义模板

在 `skills/resume-screening/templates/` 目录下创建 YAML 文件：

```yaml
# my-position.yaml
id: my-position
name: 我的岗位
requiredSkills:
  - 技能1
  - 技能2
bonusSkills:
  - 加分技能1
experienceYears: 3+
education: 本科及以上
otherRequirements:
  - 其他要求1
```

## 评估维度

| 维度 | 说明 |
|------|------|
| 技能匹配 | 是否具备岗位要求的技能和工具使用经验 |
| 经验年限 | 相关领域工作年限是否达到要求 |
| 学历证书 | 学历、专业证书等硬性指标 |
| 项目经历 | 相关项目经验、行业背景 |
| 软技能 | 沟通能力、团队协作等（根据简历描述推断） |

## 输出格式

### 筛选报告 (Markdown)

```markdown
# 简历筛选报告

## 基本信息

| 项目 | 内容 |
|------|------|
| 候选人 | 张三 |
| 岗位 | Java 开发工程师 |
| 筛选结论 | ✅ 通过 |
| 综合评分 | 4.2 / 5.0 |

## 维度评分

| 维度 | 评分 | 说明 |
|------|:----:|------|
| 技能匹配 | ⭐⭐⭐⭐⭐ (5) | 完全符合岗位要求 |
| 经验年限 | ⭐⭐⭐⭐ (4) | 5年经验，超出要求 |
| ... | ... | ... |

## 核心依据

1. 具备 Java、Spring Boot 等核心技能
2. 有互联网项目经验
3. 学历符合要求
```

## API 参考

### 解析模块

```typescript
parseResume(filePath: string, options?: ParseOptions): Promise<ResumeData>
parseResumeFromBuffer(buffer: Buffer, fileType: 'pdf' | 'word', options?: ParseOptions): Promise<ResumeData>
```

### 模板管理

```typescript
listTemplates(): JobTemplate[]
loadTemplate(id: string): JobTemplate | null
createDefaultTemplate(name: string): JobTemplate
```

### 筛选引擎

```typescript
screenResume(resume: ResumeData, template: JobTemplate, claudeResponse?: string): { prompt: string; result: ScreeningResult }
calculateOverallScore(dimensionScores: DimensionScore[]): number
```

### 报告生成

```typescript
generateReport(result: ScreeningResult): ScreeningReport
generateMarkdownReport(result: ScreeningResult): string
saveReport(report: ScreeningReport, outputDir: string, fileName?: string): string
publishReport(report: ScreeningReport, workspaceDir: string): string
```

### 批量处理

```typescript
processBatch(filePaths: string[], options?: ScreeningOptions): Promise<BatchResult>
processBatchAndPublish(filePaths: string[], workspaceDir: string, options?: ScreeningOptions): Promise<BatchResult>
```

## 注意事项

- **软技能评估**：基于简历文字描述推断，可能存在主观判断偏见，建议在面试环节验证
- **PDF 解析**：扫描版 PDF 可能无法提取文本内容
- **批量处理**：单批次最多 20 份简历，并发最多 5 个

## License

MIT