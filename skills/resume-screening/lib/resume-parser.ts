/**
 * 简历解析模块
 * 支持 PDF 和 Word 文档的文本提取
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { ResumeData, ParseOptions } from './types';

// 动态导入类型
type PDFParseResult = {
  text: string;
  numpages?: number;
  info?: Record<string, unknown>;
};

/**
 * 解析 PDF 文件内容
 */
async function parsePDF(buffer: Buffer, _options?: ParseOptions): Promise<string> {
  // 使用动态导入避免编译时错误
  const pdfParse = (await import('pdf-parse')).default;

  const data: PDFParseResult = await pdfParse(buffer);
  return data.text || '';
}

/**
 * 解析 Word 文档内容
 */
async function parseWord(buffer: Buffer, _options?: ParseOptions): Promise<string> {
  // 使用 mammoth 或其他库解析 Word 文档
  // 由于 docx 库主要用于创建文档，这里使用简化的文本提取
  // 实际生产环境建议使用 mammoth 或其他专门的解析库

  // 简单的文本提取：查找 ASCII 文本
  const text = buffer.toString('utf8');

  // 过滤非可打印字符
  const cleanText = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .join('\n');

  return cleanText;
}

/**
 * 检测文件类型
 */
function detectFileType(filePath: string): 'pdf' | 'word' | 'unknown' {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx' || ext === '.doc') return 'word';
  return 'unknown';
}

/**
 * 从文本中提取候选人姓名
 */
function extractName(text: string): string {
  // 简单的姓名提取：查找常见的姓名模式
  const namePatterns = [
    /^姓名[：:]\s*(.+)$/m,
    /^Name[：:]\s*(.+)$/mi,
    /^([^\n]{2,4})\s*[简履]历/m,
  ];

  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return '未知候选人';
}

/**
 * 从文本中提取联系方式
 */
function extractContact(text: string): ResumeData['contact'] {
  const contact: ResumeData['contact'] = {};

  // 提取邮箱
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) {
    contact.email = emailMatch[0];
  }

  // 提取电话
  const phoneMatch = text.match(/1[3-9]\d{9}/);
  if (phoneMatch) {
    contact.phone = phoneMatch[0];
  }

  return contact;
}

/**
 * 从文本中提取技能列表
 */
function extractSkills(text: string): string[] {
  const skills: string[] = [];

  // 查找技能部分
  const skillPatterns = [
    /技能[：:]\s*([\s\S]*?)(?=\n\n|\n[^\s]|$)/i,
    /专业技能[：:]\s*([\s\S]*?)(?=\n\n|\n[^\s]|$)/i,
    /技术栈[：:]\s*([\s\S]*?)(?=\n\n|\n[^\s]|$)/i,
  ];

  for (const pattern of skillPatterns) {
    const match = text.match(pattern);
    if (match) {
      // 分割技能（按换行、逗号、顿号等）
      const skillText = match[1];
      const extractedSkills = skillText
        .split(/[,\n、，]/)
        .map(s => s.trim())
        .filter(s => s.length > 0 && s.length < 50);
      skills.push(...extractedSkills);
    }
  }

  return [...new Set(skills)]; // 去重
}

/**
 * 从文本中提取工作经验年数
 */
function extractExperienceYears(text: string): number | undefined {
  // 查找工作年限
  const yearPatterns = [
    /(\d+)\s*[年]?\s*工作经验/,
    /工作年限[：:]\s*(\d+)/,
    /(\d+)\s*years?\s*(?:of\s*)?experience/i,
  ];

  for (const pattern of yearPatterns) {
    const match = text.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return undefined;
}

/**
 * 从文本中提取学历信息
 */
function extractEducation(text: string): ResumeData['education'] | undefined {
  const degreePatterns = [
    /(博士|硕士|研究生|本科|大专|专科|高中|中专)/,
    /(Doctor|Master|Bachelor|PhD|MD)/i,
  ];

  for (const pattern of degreePatterns) {
    const match = text.match(pattern);
    if (match) {
      const education: ResumeData['education'] = {
        degree: match[1],
      };

      // 尝试提取专业
      const majorMatch = text.match(/专业[：:]\s*(.+?)(?:\n|$)/);
      if (majorMatch) {
        education.major = majorMatch[1].trim();
      }

      // 尝试提取学校
      const schoolMatch = text.match(/学校[：:]\s*(.+?)(?:\n|$)/);
      if (schoolMatch) {
        education.school = schoolMatch[1].trim();
      }

      return education;
    }
  }

  return undefined;
}

/**
 * 解析简历文件
 */
export async function parseResume(
  filePath: string,
  options?: ParseOptions
): Promise<ResumeData> {
  const fileType = detectFileType(filePath);

  if (fileType === 'unknown') {
    throw new Error(`不支持的文件格式: ${extname(filePath)}`);
  }

  const buffer = readFileSync(filePath);
  let text: string;

  if (fileType === 'pdf') {
    text = await parsePDF(buffer, options);
  } else {
    text = await parseWord(buffer, options);
  }

  // 应用最大长度限制
  if (options?.maxLength && text.length > options.maxLength) {
    text = text.slice(0, options.maxLength);
  }

  // 提取结构化数据
  const resumeData: ResumeData = {
    name: extractName(text),
    contact: extractContact(text),
    skills: extractSkills(text),
    experienceYears: extractExperienceYears(text),
    education: extractEducation(text),
    rawText: text,
  };

  return resumeData;
}

/**
 * 从 Buffer 解析简历
 */
export async function parseResumeFromBuffer(
  buffer: Buffer,
  fileType: 'pdf' | 'word',
  options?: ParseOptions
): Promise<ResumeData> {
  let text: string;

  if (fileType === 'pdf') {
    text = await parsePDF(buffer, options);
  } else {
    text = await parseWord(buffer, options);
  }

  // 应用最大长度限制
  if (options?.maxLength && text.length > options.maxLength) {
    text = text.slice(0, options.maxLength);
  }

  // 提取结构化数据
  const resumeData: ResumeData = {
    name: extractName(text),
    contact: extractContact(text),
    skills: extractSkills(text),
    experienceYears: extractExperienceYears(text),
    education: extractEducation(text),
    rawText: text,
  };

  return resumeData;
}