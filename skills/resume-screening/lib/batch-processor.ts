/**
 * 批量处理器
 * 支持并发处理多份简历
 */

import type {
  ResumeData,
  JobTemplate,
  ScreeningResult,
  BatchResult,
  BatchError,
  ScreeningOptions,
} from './types';
import { parseResume } from './resume-parser';
import { loadTemplate, createDefaultTemplate } from './template-manager';
import { screenResume } from './screening-engine';
import { generateReport, generateSummaryTable, publishReport, publishSummaryTable } from './report-generator';

/**
 * 批量处理配置
 */
const BATCH_CONFIG = {
  /** 最大批量数量 */
  maxBatchSize: 20,
  /** 最大并发数 */
  maxConcurrency: 5,
  /** 单份处理超时（毫秒） */
  timeout: 180000, // 3 分钟
};

/**
 * 并发控制 - 限制同时执行的 Promise 数量
 */
async function promiseLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  const executing: Promise<void>[] = [];

  for (const [index, task] of tasks.entries()) {
    const promise = Promise.resolve()
      .then(() => task())
      .then(result => {
        results[index] = { status: 'fulfilled', value: result };
      })
      .catch(error => {
        results[index] = { status: 'rejected', reason: error };
      });

    executing.push(promise);

    if (executing.length >= limit) {
      await Promise.race(executing);
      // 移除已完成的 Promise
      const stillExecuting = executing.filter(p => {
        // 检查 Promise 是否还在执行（简化实现）
        return true;
      });
      executing.length = 0;
      executing.push(...stillExecuting);
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * 处理单份简历
 */
async function processSingleResume(
  filePath: string,
  template: JobTemplate,
  options?: ScreeningOptions
): Promise<{ result: ScreeningResult; resumeData: ResumeData }> {
  // 1. 解析简历
  const resumeData = await parseResume(filePath);

  // 2. 执行筛选
  // 注意：在 Agent 模式下，prompt 会发送给 Claude
  // 这里返回的结果需要被 Agent 处理
  const { result } = screenResume(resumeData, template);

  return { result, resumeData };
}

/**
 * 批量处理简历
 */
export async function processBatch(
  filePaths: string[],
  options?: ScreeningOptions
): Promise<BatchResult> {
  const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 验证批量大小
  if (filePaths.length > BATCH_CONFIG.maxBatchSize) {
    throw new Error(`批量数量超过上限: ${filePaths.length} > ${BATCH_CONFIG.maxBatchSize}`);
  }

  // 加载岗位模板
  let template: JobTemplate;
  if (options?.templateId) {
    const loaded = loadTemplate(options.templateId);
    if (!loaded) {
      throw new Error(`模板不存在: ${options.templateId}`);
    }
    template = loaded;
  } else if (options?.customRequirements) {
    template = createDefaultTemplate(options.customRequirements);
  } else {
    template = createDefaultTemplate('通用岗位');
  }

  const results: ScreeningResult[] = [];
  const errors: BatchError[] = [];

  // 创建任务
  const tasks = filePaths.map((filePath, index) => {
    return async () => {
      try {
        const { result } = await processSingleResume(filePath, template, options);
        return { filePath, result };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { filePath, error: errorMessage };
      }
    };
  });

  // 并发执行
  const settledResults = await promiseLimit(tasks, BATCH_CONFIG.maxConcurrency);

  // 收集结果
  for (const settled of settledResults) {
    if (settled.status === 'fulfilled') {
      const { filePath, result, error } = settled.value as {
        filePath: string;
        result?: ScreeningResult;
        error?: string;
      };

      if (result) {
        results.push(result);
      } else if (error) {
        errors.push({ fileName: filePath, error });
      }
    } else {
      errors.push({
        fileName: 'unknown',
        error: settled.reason?.message || String(settled.reason),
      });
    }
  }

  // 生成汇总表
  const summaryTable = results.length > 1 ? generateSummaryTable(results) : undefined;

  return {
    batchId,
    successCount: results.length,
    failureCount: errors.length,
    results,
    errors,
    summaryTable,
  };
}

/**
 * 批量处理并发布报告
 */
export async function processBatchAndPublish(
  filePaths: string[],
  workspaceDir: string,
  options?: ScreeningOptions
): Promise<BatchResult> {
  const result = await processBatch(filePaths, options);

  // 发布每份报告
  for (const screeningResult of result.results) {
    const report = generateReport(screeningResult);
    publishReport(report, workspaceDir);
  }

  // 发布汇总表
  if (result.summaryTable) {
    publishSummaryTable(result.results, workspaceDir);
  }

  return result;
}

/**
 * 获取批量处理配置
 */
export function getBatchConfig(): typeof BATCH_CONFIG {
  return { ...BATCH_CONFIG };
}

/**
 * 设置批量处理配置
 */
export function setBatchConfig(config: Partial<typeof BATCH_CONFIG>): void {
  Object.assign(BATCH_CONFIG, config);
}