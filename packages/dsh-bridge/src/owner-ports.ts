import type { OfficialImageRef, PenglaiImSource } from "@penglai/contracts";

/** Narrow official Agent face consumed by Penglai message routing. */
export interface DshAgentLike {
  id: string;
  session?: {
    events?: ReadonlyArray<{
      type?: string;
      data?: { inserted?: ReadonlyArray<{ id?: string }> };
    }>;
  };
  followup(message: {
    id?: string;
    role: "user";
    content: Array<{ type: "text"; text: string } | { type: "image"; attachment: OfficialImageRef }>;
    source: PenglaiImSource;
  }): void;
  steer(message: {
    id?: string;
    role: "user";
    content: Array<{ type: "text"; text: string } | { type: "image"; attachment: OfficialImageRef }>;
    source: PenglaiImSource;
  }): void;
  cancel(cause: string, opts?: { keepInbox?: boolean }): void;
  inbox: { remove(id: string): boolean };
}

/** Penglai's read-only projection of one official DSH Workspace owner row. */
export interface DshWorkspaceView {
  id: string;
  title: string;
  sessionIds: readonly string[];
  group?: string;
}

/** Penglai's narrow projection of one official DSH Session owner row. */
export interface DshSessionView {
  id: string;
  title?: string;
}

export interface DshModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface DshSessionModelDirectory {
  current: DshModelSelection;
  routable: boolean;
  groups: Array<{
    id: string;
    name: string;
    models: Array<{ id: string; name: string }>;
  }>;
}

/** Official Agent lifecycle owner. No Session or Workspace directory methods belong here. */
export interface DshAgentOwner {
  getAgent(sessionId: string): DshAgentLike | undefined;
  resumeAgent?(sessionId: string): Promise<DshAgentLike>;
}

/** Official Workspace directory owner. */
export interface DshWorkspaceOwner {
  listWorkspaces(): DshWorkspaceView[];
}

/**
 * Official Session business owner projected into Penglai's transport-neutral
 * directory contract. The alpha adapter will be backed by the generated
 * `remote.session` client; the rc.2 adapter remains an explicitly historical
 * ApiProxy implementation.
 */
export interface DshSessionOwner {
  listSessions(): Promise<DshSessionView[]>;
  createSession(workspaceIdentity: string, title?: string): Promise<{ id: string }>;
  describeSessionModels(sessionId: string): Promise<DshSessionModelDirectory>;
  selectSessionModel(
    sessionId: string,
    selection: DshModelSelection,
  ): Promise<DshModelSelection>;
}

/** Exact owner composition accepted by the Penglai bridge. */
export type DshHost = {
  version: string;
} & DshAgentOwner & DshWorkspaceOwner & Partial<DshSessionOwner>;
