/**
 * 筛选评估引擎测试
 */

import { describe, it, expect } from 'vitest';
import { screenResume, calculateOverallScore, getEvaluationDimensions } from '../../../skills/resume-screening/lib/screening-engine';
import type { ResumeData, JobTemplate } from '../../../skills/resume-screening/lib/types';

describe('Screening Engine', () => {
  const mockResume: ResumeData = {
    name: '张三',
    contact: {
      email: 'zhangsan@example.com',
      phone: '13812345678'
    },
    skills: ['Java', 'Spring Boot', 'MySQL', 'Redis'],
    experienceYears: 5,
    education: {
      degree: '本科',
      major: '计算机科学'
    },
    rawText: `
姓名：张三
技能：Java, Spring Boot, MySQL, Redis
工作经验：5年
学历：本科 计算机科学
项目经历：电商系统开发、微服务架构设计
    `
  };

  const mockTemplate: JobTemplate = {
    id: 'test-java',
    name: 'Java 开发工程师',
    requiredSkills: ['Java', 'Spring Boot', 'MySQL'],
    bonusSkills: ['Redis', 'Kafka'],
    experienceYears: '3+',
    education: '本科及以上'
  };

  describe('screenResume', () => {
    it('should return prompt and result', () => {
      const { prompt, result } = screenResume(mockResume, mockTemplate);

      expect(prompt).toBeDefined();
      expect(prompt).toContain('Java 开发工程师');
      expect(prompt).toContain('张三');

      expect(result).toBeDefined();
      expect(result.candidateName).toBe('张三');
      expect(result.jobTitle).toBe('Java 开发工程师');
    });

    it('should return pending result when no Claude response provided', () => {
      const { result } = screenResume(mockResume, mockTemplate);

      expect(result.conclusion).toBe('pending');
      expect(result.dimensionScores).toHaveLength(5);
    });

    it('should parse valid Claude response', () => {
      const claudeResponse = `
\`\`\`json
{
  "conclusion": "pass",
  "dimensionScores": [
    {"dimension": "技能匹配", "score": 5, "reason": "完全符合要求"},
    {"dimension": "经验年限", "score": 4, "reason": "经验丰富"},
    {"dimension": "学历证书", "score": 4, "reason": "本科符合要求"},
    {"dimension": "项目经历", "score": 4, "reason": "有相关项目经验"},
    {"dimension": "软技能", "score": 3, "reason": "需要进一步了解"}
  ],
  "keyReasons": ["技能匹配度高", "经验丰富", "学历符合要求"],
  "summary": "整体符合岗位要求"
}
\`\`\`
      `;

      const { result } = screenResume(mockResume, mockTemplate, claudeResponse);

      expect(result.conclusion).toBe('pass');
      expect(result.dimensionScores[0].score).toBe(5);
      expect(result.keyReasons).toHaveLength(3);
    });
  });

  describe('calculateOverallScore', () => {
    it('should calculate average score', () => {
      const scores = [
        { dimension: '技能匹配', score: 5, reason: '' },
        { dimension: '经验年限', score: 4, reason: '' },
        { dimension: '学历证书', score: 3, reason: '' },
        { dimension: '项目经历', score: 4, reason: '' },
        { dimension: '软技能', score: 4, reason: '' }
      ];

      const overall = calculateOverallScore(scores);
      expect(overall).toBe(4.0);
    });

    it('should return 0 for empty scores', () => {
      const overall = calculateOverallScore([]);
      expect(overall).toBe(0);
    });
  });

  describe('getEvaluationDimensions', () => {
    it('should return 5 dimensions', () => {
      const dimensions = getEvaluationDimensions();
      expect(dimensions).toHaveLength(5);
    });

    it('should include required dimensions', () => {
      const dimensions = getEvaluationDimensions();
      const keys = dimensions.map(d => d.key);

      expect(keys).toContain('技能匹配');
      expect(keys).toContain('经验年限');
      expect(keys).toContain('学历证书');
      expect(keys).toContain('项目经历');
      expect(keys).toContain('软技能');
    });
  });
});