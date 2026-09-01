export type DraftEnvelope = { serializedDraft: string; nameInput: string; pendingPublishKey: string | null };
type SandboxFileSystem = {
  getInfoAsync(path: string): Promise<{ exists: boolean }>;
  readAsStringAsync(path: string): Promise<string>;
  writeAsStringAsync(path: string, value: string): Promise<void>;
  deleteAsync(path: string, options?: { idempotent?: boolean }): Promise<void>;
};

function parseEnvelope(raw: string): DraftEnvelope | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const candidate = value as Partial<DraftEnvelope>;
    if (typeof candidate.serializedDraft !== "string" || typeof candidate.nameInput !== "string") return null;
    if (candidate.pendingPublishKey !== null && typeof candidate.pendingPublishKey !== "string") return null;
    return { serializedDraft: candidate.serializedDraft, nameInput: candidate.nameInput, pendingPublishKey: candidate.pendingPublishKey };
  } catch { return null; }
}

export function createDraftStore(fileSystem: SandboxFileSystem, path: string) {
  return {
    async load(): Promise<DraftEnvelope | null> {
      if (!(await fileSystem.getInfoAsync(path)).exists) return null;
      return parseEnvelope(await fileSystem.readAsStringAsync(path));
    },
    async save(value: DraftEnvelope): Promise<void> { await fileSystem.writeAsStringAsync(path, JSON.stringify(value)); },
    async clear(): Promise<void> { await fileSystem.deleteAsync(path, { idempotent: true }); }
  };
}
