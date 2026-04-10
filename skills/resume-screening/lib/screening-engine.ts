/**
 * 筛选评估引擎
 * 根据岗位要求对简历进行多维度评估
 */

import type { ResumeData, JobTemplate, ScreeningResult, DimensionScore } from './types';

/**
 * 评估维度定义
 */
const EVALUATION_DIMENSIONS = [
  {
    key: '技能匹配',
    description: '是否具备岗位要求的技能和工具使用经验',
  },
  {
    key: '经验年限',
    description: '相关领域工作年限是否达到要求',
  },
  {
    key: '学历证书',
    description: '学历、专业证书等硬性指标',
  },
  {
    key: '项目经历',
    description: '相关项目经验、行业背景',
  },
  {
    key: '软技能',
    description: '沟通能力、团队协作等（根据简历描述推断）',
  },
] as const;

/**
 * 生成筛选 Prompt
 */
function buildScreeningPrompt(resume: ResumeData, template: JobTemplate): string {
  const dimensionList = EVALUATION_DIMENSIONS.map(d => `- ${d.key}: ${d.description}`).join('\n');

  return `你是一个专业的简历筛选专家。请根据以下岗位要求对候选人简历进行评估。

## 岗位要求

- 岗位名称: ${template.name}
- 必需技能: ${template.requiredSkills.join('、')}
- 加分技能: ${template.bonusSkills?.join('、') || '无'}
- 经验要求: ${template.experienceYears || '不限'}
- 学历要求: ${template.education || '不限'}
- 其他要求: ${template.otherRequirements?.join('、') || '无'}

## 候选人简历

- 姓名: ${resume.name}
- 技能: ${resume.skills.join('、') || '未提取到'}
- 工作经验: ${resume.experienceYears ? `${resume.experienceYears}年` : '未提取到'}
- 学历: ${resume.education?.degree || '未提取到'}${resume.education?.major ? ` (${resume.education.major})` : ''}
- 联系方式: ${resume.contact?.email || resume.contact?.phone || '未提取到'}

### 简历原文

${resume.rawText.slice(0, 3000)}${resume.rawText.length > 3000 ? '\n...(内容已截断)' : ''}

## 评估要求

请对以下五个维度进行评分（1-5分），并给出筛选结论。

评估维度:
${dimensionList}

评分标准:
- 5分: 完全符合或超出要求
- 4分: 基本符合要求，略有不足
- 3分: 部分符合要求，有明显差距
- 2分: 与要求差距较大
- 1分: 完全不符合要求

## 输出格式

请严格按照以下 JSON 格式输出:

\`\`\`json
{
  "conclusion": "pass/fail/pending",
  "dimensionScores": [
    {"dimension": "技能匹配", "score": 5, "reason": "评分理由"},
    {"dimension": "经验年限", "score": 4, "reason": "评分理由"},
    {"dimension": "学历证书", "score": 3, "reason": "评分理由"},
    {"dimension": "项目经历", "score": 4, "reason": "评分理由"},
    {"dimension": "软技能", "score": 3, "reason": "评分理由"}
  ],
  "keyReasons": [
    "核心依据1",
    "核心依据2",
    "核心依据3"
  ],
  "summary": "总体评价（可选）"
}
\`\`\`

筛选结论说明:
- pass: 建议通过，可以进入下一轮面试
- fail: 建议不通过，不符合岗位要求
- pending: 待定，需要人工复核

请开始评估并输出 JSON 结果。`;
}

/**
 * 解析 Claude 响应为 ScreeningResult
 */
function parseScreeningResponse(
  response: string,
  candidateName: string,
  jobTitle: string
): ScreeningResult {
  // 尝试提取 JSON 块
  const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : response;

  let parsed: {
    conclusion: string;
    dimensionScores: Array<{ dimension: string; score: number; reason: string }>;
    keyReasons: string[];
    summary?: string;
  };

  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // 解析失败，返回默认结果
    return {
      candidateName,
      jobTitle,
      conclusion: 'pending',
      dimensionScores: EVALUATION_DIMENSIONS.map(d => ({
        dimension: d.key,
        score: 3,
        reason: '评估解析失败，需要人工复核',
      })),
      keyReasons: ['评估结果解析失败，请人工复核'],
      processedAt: new Date().toISOString(),
    };
  }

  // 验证并规范化结论
  let conclusion: 'pass' | 'fail' | 'pending' = 'pending';
  if (parsed.conclusion === 'pass' || parsed.conclusion === 'fail') {
    conclusion = parsed.conclusion;
  }

  // 规范化维度评分
  const dimensionScores: DimensionScore[] = EVALUATION_DIMENSIONS.map(dimension => {
    const found = parsed.dimensionScores?.find(ds => ds.dimension === dimension.key);
    return {
      dimension: dimension.key,
      score: Math.max(1, Math.min(5, found?.score || 3)),
      reason: found?.reason || '未提供评分理由',
    };
  });

  return {
    candidateName,
    jobTitle,
    conclusion,
    dimensionScores,
    keyReasons: parsed.keyReasons?.slice(0, 5) || ['未提供核心依据'],
    summary: parsed.summary,
    processedAt: new Date().toISOString(),
  };
}

/**
 * 执行简历筛选评估
 *
 * 注意：此函数返回一个模拟结果，实际使用时需要集成 Claude API
 * 在 Agent 模式下，prompt 会被发送给 Claude，响应会被解析
 */
export function screenResume(
  resume: ResumeData,
  template: JobTemplate,
  claudeResponse?: string
): { prompt: string; result: ScreeningResult } {
  const prompt = buildScreeningPrompt(resume, template);

  // 如果提供了 Claude 响应，解析它
  if (claudeResponse) {
    const result = parseScreeningResponse(claudeResponse, resume.name, template.name);
    return { prompt, result };
  }

  // 否则返回 prompt 供 Agent 使用
  // Agent 会将 prompt 发送给 Claude 并获取响应
  const result: ScreeningResult = {
    candidateName: resume.name,
    jobTitle: template.name,
    conclusion: 'pending',
    dimensionScores: EVALUATION_DIMENSIONS.map(d => ({
      dimension: d.key,
      score: 3,
      reason: '等待 Claude 评估',
    })),
    keyReasons: ['等待 Claude 评估'],
    processedAt: new Date().toISOString(),
  };

  return { prompt, result };
}

/**
 * 计算 overall 评分
 */
export function calculateOverallScore(dimensionScores: DimensionScore[]): number {
  if (dimensionScores.length === 0) return 0;
  const sum = dimensionScores.reduce((acc, ds) => acc + ds.score, 0);
  return Math.round((sum / dimensionScores.length) * 10) / 10;
}

/**
 * 获取评估维度列表
 */
export function getEvaluationDimensions(): readonly { key: string; description: string }[] {
  return EVALUATION_DIMENSIONS;
}