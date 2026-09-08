import type {
  CaptureScreenshot,
  FetchPagePerformance,
  FetchRenderedPage,
} from "../browserless";
import { applyMockStageWork } from "./mock-stages";
import { resolveMockTerminalState } from "./outcome";
import type { ArtifactStorage } from "../storage/audit-artifacts";
import type { UrlSafetyDeps } from "../url-safety";
import {
  createSupabaseAuditStore,
  type AuditWorkflowStore,
} from "./store";
import {
  STAGE_SEQUENCE,
  type AuditWorkflowState,
  type WorkflowTerminalState,
} from "./types";

export interface RunAuditPipelineInput {
  auditId: string;
  websiteUrl: string;
  store?: AuditWorkflowStore;
  delayMs?: number;
  outcome?: WorkflowTerminalState;
  safetyDeps?: UrlSafetyDeps;
  realScanEnabled?: boolean;
  fetchHomePage?: FetchRenderedPage;
  captureScreenshot?: CaptureScreenshot;
  fetchPerformance?: FetchPagePerformance;
  artifactStorage?: ArtifactStorage;
}

export interface ApplyStageResult {
  transition: "inserted" | "exists";
  abortTo?: WorkflowTerminalState;
  reasonCode?: string;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function applyStage(input: {
  store: AuditWorkflowStore;
  auditId: string;
  websiteUrl: string;
  fromState: AuditWorkflowState;
  toState: AuditWorkflowState;
  outcome: WorkflowTerminalState;
  safetyDeps?: UrlSafetyDeps;
  realScanEnabled?: boolean;
  fetchHomePage?: FetchRenderedPage;
  captureScreenshot?: CaptureScreenshot;
  fetchPerformance?: FetchPagePerformance;
  artifactStorage?: ArtifactStorage;
}): Promise<ApplyStageResult> {
  const result = await input.store.recordTransition(
    input.auditId,
    input.fromState,
    input.toState,
  );

  const work = await applyMockStageWork({
    store: input.store,
    auditId: input.auditId,
    websiteUrl: input.websiteUrl,
    toState: input.toState,
    outcome: input.outcome,
    safetyDeps: input.safetyDeps,
    realScanEnabled: input.realScanEnabled,
    fetchHomePage: input.fetchHomePage,
    captureScreenshot: input.captureScreenshot,
    fetchPerformance: input.fetchPerformance,
    artifactStorage: input.artifactStorage,
  });

  return {
    transition: result,
    abortTo: work.abortTo,
    reasonCode: work.reasonCode,
  };
}

/**
 * Durable-friendly mock pipeline. The Vercel Workflow wrapper calls this
 * one stage at a time from `"use step"` functions. Tests call it directly.
 */
export async function runAuditPipeline(
  input: RunAuditPipelineInput,
): Promise<WorkflowTerminalState> {
  const store = input.store ?? createSupabaseAuditStore();
  const audit = await store.getAudit(input.auditId);
  if (!audit) {
    throw new Error(`Audit not found: ${input.auditId}`);
  }

  const outcome = input.outcome ?? resolveMockTerminalState(input.websiteUrl);
  const delayMs = input.delayMs ?? 0;

  for (let i = 1; i < STAGE_SEQUENCE.length; i += 1) {
    const fromState = STAGE_SEQUENCE[i - 1];
    const toState = STAGE_SEQUENCE[i];
    await delay(delayMs);
    const stage = await applyStage({
      store,
      auditId: input.auditId,
      websiteUrl: input.websiteUrl,
      fromState,
      toState,
      outcome,
      safetyDeps: input.safetyDeps,
      realScanEnabled: input.realScanEnabled,
      fetchHomePage: input.fetchHomePage,
      captureScreenshot: input.captureScreenshot,
      fetchPerformance: input.fetchPerformance,
      artifactStorage: input.artifactStorage,
    });

    if (stage.abortTo) {
      await delay(delayMs);
      await applyStage({
        store,
        auditId: input.auditId,
        websiteUrl: input.websiteUrl,
        fromState: toState,
        toState: stage.abortTo,
        outcome: stage.abortTo,
        safetyDeps: input.safetyDeps,
        realScanEnabled: input.realScanEnabled,
        fetchHomePage: input.fetchHomePage,
        captureScreenshot: input.captureScreenshot,
        fetchPerformance: input.fetchPerformance,
        artifactStorage: input.artifactStorage,
      });
      return stage.abortTo;
    }
  }

  await delay(delayMs);
  await applyStage({
    store,
    auditId: input.auditId,
    websiteUrl: input.websiteUrl,
    fromState: "validating_report",
    toState: outcome,
    outcome,
    safetyDeps: input.safetyDeps,
    realScanEnabled: input.realScanEnabled,
    fetchHomePage: input.fetchHomePage,
    captureScreenshot: input.captureScreenshot,
    fetchPerformance: input.fetchPerformance,
    artifactStorage: input.artifactStorage,
  });

  return outcome;
}
