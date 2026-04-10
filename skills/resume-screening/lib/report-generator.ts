/**
 * 报告生成器
 * 生成 Markdown 格式的筛选报告
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ScreeningResult, ScreeningReport } from './types';
import { calculateOverallScore } from './screening-engine';

/**
 * 生成 Markdown 筛选报告
 */
export function generateMarkdownReport(result: ScreeningResult): string {
  const overallScore = calculateOverallScore(result.dimensionScores);

  const conclusionEmoji = {
    pass: '✅',
    fail: '❌',
    pending: '⏳',
  };

  const conclusionText = {
    pass: '通过',
    fail: '不通过',
    pending: '待定（需人工复核）',
  };

  const lines: string[] = [
    `# 简历筛选报告`,
    '',
    `## 基本信息`,
    '',
    `| 项目 | 内容 |`,
    `|------|------|`,
    `| 候选人 | ${result.candidateName} |`,
    `| 岗位 | ${result.jobTitle} |`,
    `| 筛选结论 | ${conclusionEmoji[result.conclusion]} ${conclusionText[result.conclusion]} |`,
    `| 综合评分 | ${overallScore.toFixed(1)} / 5.0 |`,
    `| 处理时间 | ${new Date(result.processedAt).toLocaleString('zh-CN')} |`,
    '',
    `## 维度评分`,
    '',
    `| 维度 | 评分 | 说明 |`,
    `|------|:----:|------|`,
  ];

  for (const ds of result.dimensionScores) {
    const stars = '⭐'.repeat(ds.score);
    lines.push(`| ${ds.dimension} | ${stars} (${ds.score}) | ${ds.reason} |`);
  }

  lines.push('');
  lines.push(`## 核心依据`);
  lines.push('');

  for (let i = 0; i < result.keyReasons.length; i++) {
    lines.push(`${i + 1}. ${result.keyReasons[i]}`);
  }

  if (result.summary) {
    lines.push('');
    lines.push(`## 总体评价`);
    lines.push('');
    lines.push(result.summary);
  }

  lines.push('');
  lines.push(`---`);
  lines.push(`*本报告由 Resume Screening Agent 自动生成*`);

  return lines.join('\n');
}

/**
 * 生成筛选报告
 */
export function generateReport(result: ScreeningResult): ScreeningReport {
  const id = `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    result,
    markdown: generateMarkdownReport(result),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * 保存报告到文件
 */
export function saveReport(
  report: ScreeningReport,
  outputDir: string,
  fileName?: string
): string {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const name = fileName || `screening-report-${report.result.candidateName}-${Date.now()}.md`;
  const filePath = join(outputDir, name);

  writeFileSync(filePath, report.markdown, 'utf-8');

  return filePath;
}

/**
 * 生成批量处理汇总表
 */
export function generateSummaryTable(results: ScreeningResult[]): string {
  const lines: string[] = [
    `# 简历筛选汇总表`,
    '',
    `生成时间: ${new Date().toLocaleString('zh-CN')}`,
    '',
    `## 结果统计`,
    '',
    `| 状态 | 数量 |`,
    `|------|:----:|`,
    `| ✅ 通过 | ${results.filter(r => r.conclusion === 'pass').length} |`,
    `| ❌ 不通过 | ${results.filter(r => r.conclusion === 'fail').length} |`,
    `| ⏳ 待定 | ${results.filter(r => r.conclusion === 'pending').length} |`,
    `| **总计** | **${results.length}** |`,
    '',
    `## 详细列表`,
    '',
    `| 序号 | 候选人 | 岗位 | 结论 | 综合评分 | 核心依据 |`,
    `|:----:|--------|------|:----:|:--------:|----------|`,
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const overallScore = calculateOverallScore(r.dimensionScores);
    const conclusionEmoji = { pass: '✅', fail: '❌', pending: '⏳' };
    const keyReason = r.keyReasons[0] || '-';

    lines.push(
      `| ${i + 1} | ${r.candidateName} | ${r.jobTitle} | ${conclusionEmoji[r.conclusion]} | ${overallScore.toFixed(1)} | ${keyReason.slice(0, 50)}${keyReason.length > 50 ? '...' : ''} |`
    );
  }

  lines.push('');
  lines.push(`---`);
  lines.push(`*本报告由 Resume Screening Agent 自动生成*`);

  return lines.join('\n');
}

/**
 * 发布报告到交付目录
 */
export function publishReport(
  report: ScreeningReport,
  workspaceDir: string
): string {
  const deliveriesDir = join(workspaceDir, '.deliveries');

  return saveReport(report, deliveriesDir);
}

/**
 * 发布汇总表到交付目录
 */
export function publishSummaryTable(
  results: ScreeningResult[],
  workspaceDir: string
): string {
  const deliveriesDir = join(workspaceDir, '.deliveries');

  if (!existsSync(deliveriesDir)) {
    mkdirSync(deliveriesDir, { recursive: true });
  }

  const fileName = `screening-summary-${Date.now()}.md`;
  const filePath = join(deliveriesDir, fileName);
  const content = generateSummaryTable(results);

  writeFileSync(filePath, content, 'utf-8');

  return filePath;
}