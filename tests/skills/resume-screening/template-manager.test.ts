/**
 * 模板管理模块测试
 */

import { describe, it, expect } from 'vitest';
import { listTemplates, loadTemplate, createDefaultTemplate } from '../../../skills/resume-screening/lib/template-manager';

describe('Template Manager', () => {
  describe('listTemplates', () => {
    it('should return an array of templates', () => {
      const templates = listTemplates();
      expect(Array.isArray(templates)).toBe(true);
    });

    it('should include java-developer template', () => {
      const templates = listTemplates();
      const javaTemplate = templates.find(t => t.id === 'java-developer');
      expect(javaTemplate).toBeDefined();
      expect(javaTemplate?.name).toBe('Java 开发工程师');
    });

    it('should include frontend-developer template', () => {
      const templates = listTemplates();
      const frontendTemplate = templates.find(t => t.id === 'frontend-developer');
      expect(frontendTemplate).toBeDefined();
      expect(frontendTemplate?.name).toBe('前端开发工程师');
    });
  });

  describe('loadTemplate', () => {
    it('should load java-developer template by id', () => {
      const template = loadTemplate('java-developer');
      expect(template).toBeDefined();
      expect(template?.id).toBe('java-developer');
      expect(template?.requiredSkills).toContain('Java');
      expect(template?.requiredSkills).toContain('Spring Boot');
    });

    it('should load frontend-developer template by id', () => {
      const template = loadTemplate('frontend-developer');
      expect(template).toBeDefined();
      expect(template?.id).toBe('frontend-developer');
      expect(template?.requiredSkills).toContain('JavaScript');
      expect(template?.requiredSkills).toContain('React');
    });

    it('should return null for non-existent template', () => {
      const template = loadTemplate('non-existent');
      expect(template).toBeNull();
    });
  });

  describe('createDefaultTemplate', () => {
    it('should create a template with default values', () => {
      const template = createDefaultTemplate('测试岗位');
      expect(template.id).toBe('default');
      expect(template.name).toBe('测试岗位');
      expect(template.requiredSkills).toEqual([]);
      expect(template.experienceYears).toBe('不限');
      expect(template.education).toBe('不限');
    });
  });
});