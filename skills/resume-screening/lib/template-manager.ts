/**
 * 岗位模板管理模块
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, parse } from 'node:path';
import type { JobTemplate } from './types';

// 模板目录路径
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

/**
 * 列出所有可用的岗位模板
 */
export function listTemplates(): JobTemplate[] {
  if (!existsSync(TEMPLATES_DIR)) {
    return [];
  }

  const templates: JobTemplate[] = [];
  const files = readdirSync(TEMPLATES_DIR);

  for (const file of files) {
    if (file.endsWith('.yaml') || file.endsWith('.yml')) {
      try {
        const template = loadTemplateFromFile(join(TEMPLATES_DIR, file));
        if (template) {
          templates.push(template);
        }
      } catch (error) {
        console.error(`加载模板失败: ${file}`, error);
      }
    }
  }

  return templates;
}

/**
 * 根据 ID 加载岗位模板
 */
export function loadTemplate(id: string): JobTemplate | null {
  const yamlPath = join(TEMPLATES_DIR, `${id}.yaml`);
  const ymlPath = join(TEMPLATES_DIR, `${id}.yml`);

  if (existsSync(yamlPath)) {
    return loadTemplateFromFile(yamlPath);
  }

  if (existsSync(ymlPath)) {
    return loadTemplateFromFile(ymlPath);
  }

  return null;
}

/**
 * 从文件加载模板
 */
function loadTemplateFromFile(filePath: string): JobTemplate | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const content = readFileSync(filePath, 'utf-8');
  const template = parseYamlTemplate(content);

  // 使用文件名作为 ID
  const { name } = parse(filePath);
  template.id = name;

  return template;
}

/**
 * 解析 YAML 模板内容
 * 简单的 YAML 解析器，支持基本结构
 */
function parseYamlTemplate(content: string): JobTemplate {
  const template: JobTemplate = {
    id: '',
    name: '',
    requiredSkills: [],
  };

  const lines = content.split('\n');
  let currentKey = '';
  let currentArray: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // 检查数组项
    const arrayMatch = trimmed.match(/^(\s*)-\s+(.+)$/);
    if (arrayMatch) {
      const value = arrayMatch[2].trim();
      if (currentArray) {
        currentArray.push(value);
      }
      continue;
    }

    // 检查键值对
    const kvMatch = trimmed.match(/^(\w+)[：:]\s*(.*)$/);
    if (kvMatch) {
      // 保存之前的数组
      if (currentKey && currentArray.length > 0) {
        assignToArray(template, currentKey, currentArray);
      }

      const key = kvMatch[1];
      const value = kvMatch[2].trim();

      currentKey = key;
      currentArray = [];

      // 检查是否是简单值
      if (value && !value.startsWith('\n')) {
        assignValue(template, key, value);
      }
    }
  }

  // 保存最后的数组
  if (currentKey && currentArray.length > 0) {
    assignToArray(template, currentKey, currentArray);
  }

  return template;
}

/**
 * 赋值简单属性
 */
function assignValue(template: JobTemplate, key: string, value: string): void {
  switch (key) {
    case 'id':
      template.id = value;
      break;
    case 'name':
      template.name = value;
      break;
    case 'experienceYears':
      template.experienceYears = value;
      break;
    case 'education':
      template.education = value;
      break;
  }
}

/**
 * 赋值数组属性
 */
function assignToArray(template: JobTemplate, key: string, values: string[]): void {
  switch (key) {
    case 'requiredSkills':
      template.requiredSkills = values;
      break;
    case 'bonusSkills':
      template.bonusSkills = values;
      break;
    case 'otherRequirements':
      template.otherRequirements = values;
      break;
  }
}

/**
 * 创建默认岗位模板
 */
export function createDefaultTemplate(name: string): JobTemplate {
  return {
    id: 'default',
    name,
    requiredSkills: [],
    bonusSkills: [],
    experienceYears: '不限',
    education: '不限',
    otherRequirements: [],
  };
}