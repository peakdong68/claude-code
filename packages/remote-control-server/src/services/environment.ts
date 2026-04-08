import { config } from "../config";
import {
  storeCreateEnvironment,
  storeGetEnvironment,
  storeUpdateEnvironment,
  storeListActiveEnvironments,
} from "../store";
import type { RegisterEnvironmentRequest, EnvironmentResponse } from "../types/api";
import type { EnvironmentRecord } from "../store";

function toResponse(row: EnvironmentRecord): EnvironmentResponse {
  return {
    id: row.id,
    machine_name: row.machineName,
    directory: row.directory,
    branch: row.branch,
    status: row.status,
    last_poll_at: row.lastPollAt ? row.lastPollAt.getTime() / 1000 : null,
  };
}

export function registerEnvironment(req: RegisterEnvironmentRequest & { metadata?: { worker_type?: string } }) {
  const secret = config.apiKeys[0] || "";
  // TUI sends worker_type inside metadata object; also accept top-level for compat
  const workerType = req.worker_type || req.metadata?.worker_type;
  const record = storeCreateEnvironment({
    secret,
    machineName: req.machine_name,
    directory: req.directory,
    branch: req.branch,
    gitRepoUrl: req.git_repo_url,
    maxSessions: req.max_sessions,
    workerType,
    bridgeId: req.bridge_id,
  });

  return { environment_id: record.id, environment_secret: record.secret, status: record.status as "active" };
}

export function deregisterEnvironment(envId: string) {
  storeUpdateEnvironment(envId, { status: "deregistered" });
}

export function getEnvironment(envId: string) {
  return storeGetEnvironment(envId);
}

export function updatePollTime(envId: string) {
  storeUpdateEnvironment(envId, { lastPollAt: new Date() });
}

export function listActiveEnvironments() {
  return storeListActiveEnvironments();
}

export function listActiveEnvironmentsResponse(): EnvironmentResponse[] {
  return storeListActiveEnvironments().map(toResponse);
}

export function reconnectEnvironment(envId: string) {
  storeUpdateEnvironment(envId, { status: "active" });
}
