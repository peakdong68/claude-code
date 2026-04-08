import { v4 as uuid } from "uuid";

// ---------- Types ----------

export interface EnvironmentRecord {
  id: string;
  secret: string;
  machineName: string | null;
  directory: string | null;
  branch: string | null;
  gitRepoUrl: string | null;
  maxSessions: number;
  workerType: string;
  bridgeId: string | null;
  status: string;
  lastPollAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRecord {
  id: string;
  environmentId: string | null;
  title: string | null;
  status: string;
  source: string;
  permissionMode: string | null;
  workerEpoch: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkItemRecord {
  id: string;
  environmentId: string;
  sessionId: string;
  state: string;
  secret: string;
  createdAt: Date;
  updatedAt: Date;
}

// ---------- Stores (in-memory Maps) ----------

const environments = new Map<string, EnvironmentRecord>();
const sessions = new Map<string, SessionRecord>();
const workItems = new Map<string, WorkItemRecord>();

// ---------- Environment ----------

export function storeCreateEnvironment(req: {
  secret: string;
  machineName?: string;
  directory?: string;
  branch?: string;
  gitRepoUrl?: string;
  maxSessions?: number;
  workerType?: string;
  bridgeId?: string;
}): EnvironmentRecord {
  const id = `env_${uuid().replace(/-/g, "")}`;
  const now = new Date();
  const record: EnvironmentRecord = {
    id,
    secret: req.secret,
    machineName: req.machineName ?? null,
    directory: req.directory ?? null,
    branch: req.branch ?? null,
    gitRepoUrl: req.gitRepoUrl ?? null,
    maxSessions: req.maxSessions ?? 1,
    workerType: req.workerType ?? "claude_code",
    bridgeId: req.bridgeId ?? null,
    status: "active",
    lastPollAt: now,
    createdAt: now,
    updatedAt: now,
  };
  environments.set(id, record);
  return record;
}

export function storeGetEnvironment(id: string): EnvironmentRecord | undefined {
  return environments.get(id);
}

export function storeUpdateEnvironment(id: string, patch: Partial<Pick<EnvironmentRecord, "status" | "lastPollAt" | "updatedAt">>): boolean {
  const rec = environments.get(id);
  if (!rec) return false;
  Object.assign(rec, patch, { updatedAt: new Date() });
  return true;
}

export function storeListActiveEnvironments(): EnvironmentRecord[] {
  return [...environments.values()].filter((e) => e.status === "active");
}

// ---------- Session ----------

export function storeCreateSession(req: {
  environmentId?: string | null;
  title?: string | null;
  source?: string;
  permissionMode?: string | null;
  idPrefix?: string;
}): SessionRecord {
  const id = `${req.idPrefix || "session_"}${uuid().replace(/-/g, "")}`;
  const now = new Date();
  const record: SessionRecord = {
    id,
    environmentId: req.environmentId ?? null,
    title: req.title ?? null,
    status: "idle",
    source: req.source ?? "remote-control",
    permissionMode: req.permissionMode ?? null,
    workerEpoch: 0,
    createdAt: now,
    updatedAt: now,
  };
  sessions.set(id, record);
  return record;
}

export function storeGetSession(id: string): SessionRecord | undefined {
  return sessions.get(id);
}

export function storeUpdateSession(id: string, patch: Partial<Pick<SessionRecord, "title" | "status" | "workerEpoch" | "updatedAt">>): boolean {
  const rec = sessions.get(id);
  if (!rec) return false;
  Object.assign(rec, patch, { updatedAt: new Date() });
  return true;
}

export function storeListSessions(): SessionRecord[] {
  return [...sessions.values()];
}

export function storeListSessionsByEnvironment(envId: string): SessionRecord[] {
  return [...sessions.values()].filter((s) => s.environmentId === envId);
}

export function storeDeleteSession(id: string): boolean {
  return sessions.delete(id);
}

// ---------- Work Items ----------

export function storeCreateWorkItem(req: {
  environmentId: string;
  sessionId: string;
  secret: string;
}): WorkItemRecord {
  const id = `work_${uuid().replace(/-/g, "")}`;
  const now = new Date();
  const record: WorkItemRecord = {
    id,
    environmentId: req.environmentId,
    sessionId: req.sessionId,
    state: "pending",
    secret: req.secret,
    createdAt: now,
    updatedAt: now,
  };
  workItems.set(id, record);
  return record;
}

export function storeGetWorkItem(id: string): WorkItemRecord | undefined {
  return workItems.get(id);
}

export function storeGetPendingWorkItem(environmentId: string): WorkItemRecord | undefined {
  for (const item of workItems.values()) {
    if (item.environmentId === environmentId && item.state === "pending") {
      return item;
    }
  }
  return undefined;
}

export function storeUpdateWorkItem(id: string, patch: Partial<Pick<WorkItemRecord, "state" | "updatedAt">>): boolean {
  const rec = workItems.get(id);
  if (!rec) return false;
  Object.assign(rec, patch, { updatedAt: new Date() });
  return true;
}

// ---------- Reset (for tests) ----------

export function storeReset() {
  environments.clear();
  sessions.clear();
  workItems.clear();
}
