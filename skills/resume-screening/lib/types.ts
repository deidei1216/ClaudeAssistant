/**
 * Resume Screening Skill - 类型定义
 */

/**
 * 简历数据
 */
export interface ResumeData {
  /** 候选人姓名 */
  name: string;
  /** 联系方式 */
  contact?: {
    email?: string;
    phone?: string;
  };
  /** 技能列表 */
  skills: string[];
  /** 工作经验（年） */
  experienceYears?: number;
  /** 学历 */
  education?: {
    degree: string;
    major?: string;
    school?: string;
  };
  /** 证书列表 */
  certificates?: string[];
  /** 项目经历 */
  projects?: Project[];
  /** 工作经历 */
  workHistory?: WorkExperience[];
  /** 原始文本内容 */
  rawText: string;
}

/**
 * 项目经历
 */
export interface Project {
  name: string;
  description?: string;
  role?: string;
  technologies?: string[];
  duration?: string;
}

/**
 * 工作经历
 */
export interface WorkExperience {
  company: string;
  position: string;
  duration?: string;
  description?: string;
}

/**
 * 岗位模板
 */
export interface JobTemplate {
  /** 模板ID */
  id: string;
  /** 岗位名称 */
  name: string;
  /** 必需技能 */
  requiredSkills: string[];
  /** 加分技能 */
  bonusSkills?: string[];
  /** 经验年限要求 */
  experienceYears?: string;
  /** 学历要求 */
  education?: string;
  /** 其他要求 */
  otherRequirements?: string[];
}

/**
 * 维度评分
 */
export interface DimensionScore {
  /** 维度名称 */
  dimension: string;
  /** 评分 (1-5) */
  score: number;
  /** 评分说明 */
  reason: string;
}

/**
 * 筛选结果
 */
export interface ScreeningResult {
  /** 候选人姓名 */
  candidateName: string;
  /** 岗位名称 */
  jobTitle: string;
  /** 筛选结论 */
  conclusion: 'pass' | 'fail' | 'pending';
  /** 维度评分列表 */
  dimensionScores: DimensionScore[];
  /** 核心依据 */
  keyReasons: string[];
  /** 总体评价 */
  summary?: string;
  /** 处理时间 */
  processedAt: string;
}

/**
 * 筛选报告
 */
export interface ScreeningReport {
  /** 报告ID */
  id: string;
  /** 筛选结果 */
  result: ScreeningResult;
  /** Markdown 内容 */
  markdown: string;
  /** 生成时间 */
  generatedAt: string;
}

/**
 * 批量处理结果
 */
export interface BatchResult {
  /** 批次ID */
  batchId: string;
  /** 成功数量 */
  successCount: number;
  /** 失败数量 */
  failureCount: number;
  /** 筛选结果列表 */
  results: ScreeningResult[];
  /** 错误列表 */
  errors: BatchError[];
  /** 汇总表 Markdown */
  summaryTable?: string;
}

/**
 * 批量处理错误
 */
export interface BatchError {
  /** 文件名 */
  fileName: string;
  /** 错误信息 */
  error: string;
}

/**
 * 解析选项
 */
export interface ParseOptions {
  /** 最大文本长度 */
  maxLength?: number;
  /** 编码 */
  encoding?: string;
}

/**
 * 筛选选项
 */
export interface ScreeningOptions {
  /** 是否使用模板 */
  templateId?: string;
  /** 自定义岗位要求 */
  customRequirements?: string;
  /** 输出格式 */
  outputFormat?: 'markdown' | 'json';
}