/**
 * 报告生成器测试
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateMarkdownReport, generateReport, generateSummaryTable } from '../../../skills/resume-screening/lib/report-generator';
import type { ScreeningResult } from '../../../skills/resume-screening/lib/types';

const TEST_OUTPUT_DIR = join(__dirname, 'test-output');

describe('Report Generator', () => {
  const mockResult: ScreeningResult = {
    candidateName: '张三',
    jobTitle: 'Java 开发工程师',
    conclusion: 'pass',
    dimensionScores: [
      { dimension: '技能匹配', score: 5, reason: '完全符合岗位要求' },
      { dimension: '经验年限', score: 4, reason: '5年经验，超出要求' },
      { dimension: '学历证书', score: 4, reason: '本科学历符合要求' },
      { dimension: '项目经历', score: 4, reason: '有相关项目经验' },
      { dimension: '软技能', score: 3, reason: '需要进一步了解' }
    ],
    keyReasons: [
      '具备 Java、Spring Boot 等核心技能',
      '有互联网项目经验',
      '学历符合要求'
    ],
    summary: '整体符合岗位要求，建议进入下一轮面试',
    processedAt: new Date().toISOString()
  };

  beforeAll(() => {
    if (!existsSync(TEST_OUTPUT_DIR)) {
      mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    if (existsSync(TEST_OUTPUT_DIR)) {
      rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  describe('generateMarkdownReport', () => {
    it('should generate valid markdown', () => {
      const markdown = generateMarkdownReport(mockResult);

      expect(markdown).toContain('# 简历筛选报告');
      expect(markdown).toContain('张三');
      expect(markdown).toContain('Java 开发工程师');
      expect(markdown).toContain('✅');
      expect(markdown).toContain('通过');
    });

    it('should include dimension scores', () => {
      const markdown = generateMarkdownReport(mockResult);

      expect(markdown).toContain('技能匹配');
      expect(markdown).toContain('经验年限');
      expect(markdown).toContain('学历证书');
      expect(markdown).toContain('项目经历');
      expect(markdown).toContain('软技能');
    });

    it('should include key reasons', () => {
      const markdown = generateMarkdownReport(mockResult);

      expect(markdown).toContain('具备 Java、Spring Boot 等核心技能');
    });

    it('should handle fail conclusion', () => {
      const failResult = { ...mockResult, conclusion: 'fail' as const };
      const markdown = generateMarkdownReport(failResult);

      expect(markdown).toContain('❌');
      expect(markdown).toContain('不通过');
    });

    it('should handle pending conclusion', () => {
      const pendingResult = { ...mockResult, conclusion: 'pending' as const };
      const markdown = generateMarkdownReport(pendingResult);

      expect(markdown).toContain('⏳');
      expect(markdown).toContain('待定');
    });
  });

  describe('generateReport', () => {
    it('should create a report with id and markdown', () => {
      const report = generateReport(mockResult);

      expect(report.id).toBeDefined();
      expect(report.id).toMatch(/^report-/);
      expect(report.markdown).toBeDefined();
      expect(report.generatedAt).toBeDefined();
    });
  });

  describe('generateSummaryTable', () => {
    it('should generate summary for multiple results', () => {
      const results: ScreeningResult[] = [
        mockResult,
        { ...mockResult, candidateName: '李四', conclusion: 'fail' },
        { ...mockResult, candidateName: '王五', conclusion: 'pending' }
      ];

      const summary = generateSummaryTable(results);

      expect(summary).toContain('# 简历筛选汇总表');
      expect(summary).toContain('张三');
      expect(summary).toContain('李四');
      expect(summary).toContain('王五');
      expect(summary).toContain('✅ 通过');
      expect(summary).toContain('❌ 不通过');
      expect(summary).toContain('⏳ 待定');
    });

    it('should show correct statistics', () => {
      const results: ScreeningResult[] = [
        { ...mockResult, conclusion: 'pass' },
        { ...mockResult, conclusion: 'pass' },
        { ...mockResult, conclusion: 'fail' }
      ];

      const summary = generateSummaryTable(results);

      expect(summary).toContain('| ✅ 通过 | 2 |');
      expect(summary).toContain('| ❌ 不通过 | 1 |');
      expect(summary).toContain('| **总计** | **3** |');
    });
  });
});