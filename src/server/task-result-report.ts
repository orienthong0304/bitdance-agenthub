import { z } from 'zod'

import type { DispatchPlanItem, TaskResultReport } from '@/shared/types'

export const REPORT_TASK_RESULT_TOOL_NAME = 'report_task_result'

export const ReportTaskResultArgsSchema = z.object({
  status: z.enum(['complete', 'failed', 'blocked']),
  summary: z.string().min(1),
  acceptanceResults: z
    .array(
      z.object({
        criterion: z.string().min(1),
        passed: z.boolean(),
        evidence: z.string().min(1),
      }),
    )
    .optional(),
  blockers: z.array(z.string().min(1)).optional(),
})

type ParsedTaskResultReport = z.infer<typeof ReportTaskResultArgsSchema>

export interface TaskResultReportEvaluation {
  ok: boolean
  error?: string
}

export function normalizeTaskResultReport(data: ParsedTaskResultReport): TaskResultReport {
  const acceptanceResults = data.acceptanceResults
    ?.map((result) => ({
      criterion: result.criterion.trim(),
      passed: result.passed,
      evidence: result.evidence.trim(),
    }))
    .filter((result) => result.criterion && result.evidence)
  const blockers = data.blockers?.map((blocker) => blocker.trim()).filter(Boolean)

  return {
    status: data.status,
    summary: data.summary.trim(),
    ...(acceptanceResults && acceptanceResults.length > 0 ? { acceptanceResults } : {}),
    ...(blockers && blockers.length > 0 ? { blockers } : {}),
  }
}

export function parseTaskResultReport(value: unknown): TaskResultReport | null {
  const parsed = ReportTaskResultArgsSchema.safeParse(value)
  return parsed.success ? normalizeTaskResultReport(parsed.data) : null
}

export function readTaskResultReportFromToolResult(result: unknown): TaskResultReport | null {
  return readTaskResultReportFromUnknown(result, 0)
}

export function isTaskResultReportToolName(toolName: string): boolean {
  return (
    toolName === REPORT_TASK_RESULT_TOOL_NAME ||
    toolName.endsWith(`__${REPORT_TASK_RESULT_TOOL_NAME}`) ||
    toolName.endsWith(`_${REPORT_TASK_RESULT_TOOL_NAME}`)
  )
}

export function evaluateTaskResultReport(
  task: DispatchPlanItem,
  report: TaskResultReport | undefined,
): TaskResultReportEvaluation {
  if (!report) {
    return {
      ok: false,
      error: `Task "${task.id}" completed without report_task_result`,
    }
  }

  if (report.status !== 'complete') {
    return {
      ok: false,
      error: formatReportedNonCompletion(task.id, report),
    }
  }

  const failedAcceptance = report.acceptanceResults?.filter((result) => !result.passed) ?? []
  if (failedAcceptance.length > 0) {
    return {
      ok: false,
      error: `Task "${task.id}" did not satisfy acceptance criteria: ${failedAcceptance
        .map((result) => `${result.criterion} (${result.evidence})`)
        .join('; ')}`,
    }
  }

  const criteria = task.acceptanceCriteria ?? []
  if (criteria.length > 0) {
    const reportedCriteria = new Set(
      (report.acceptanceResults ?? []).map((result) => result.criterion.trim()),
    )
    const missing = criteria.filter((criterion) => !reportedCriteria.has(criterion.trim()))
    if (missing.length > 0) {
      return {
        ok: false,
        error: `Task "${task.id}" report is missing acceptance criteria result(s): ${missing.join('; ')}`,
      }
    }
  }

  return { ok: true }
}

function readTaskResultReportFromUnknown(
  value: unknown,
  depth: number,
): TaskResultReport | null {
  if (depth > 6) return null

  const direct = parseTaskResultReport(value)
  if (direct) return direct

  if (typeof value === 'string') {
    return readTaskResultReportFromJsonText(value, depth + 1)
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = readTaskResultReportFromUnknown(item, depth + 1)
      if (parsed) return parsed
    }
    return null
  }

  if (!isRecord(value)) return null

  if (typeof value.text === 'string') {
    const parsed = readTaskResultReportFromJsonText(value.text, depth + 1)
    if (parsed) return parsed
  }

  for (const key of ['structuredContent', 'structured_content', 'result', 'value', 'content']) {
    if (!(key in value)) continue
    const parsed = readTaskResultReportFromUnknown(value[key], depth + 1)
    if (parsed) return parsed
  }

  return null
}

function readTaskResultReportFromJsonText(text: string, depth: number): TaskResultReport | null {
  try {
    return readTaskResultReportFromUnknown(JSON.parse(text), depth)
  } catch {
    return null
  }
}

function formatReportedNonCompletion(taskId: string, report: TaskResultReport): string {
  const blockers =
    report.blockers && report.blockers.length > 0
      ? ` Blockers: ${report.blockers.join('; ')}`
      : ''
  return `Task "${taskId}" reported ${report.status}: ${report.summary}${blockers}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}
