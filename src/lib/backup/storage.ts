export type StorageObjectMeta = {
  bucket: string;
  path: string;
  size: number;
  contentType: string | null;
};

export type StorageListPage = {
  name: string;
  id: string | null;
  metadata?: { size?: number | string; mimetype?: string } | null;
};

export type StorageLister = (
  bucket: string,
  prefix: string,
) => Promise<StorageListPage[]>;

function joinPrefix(prefix: string, name: string): string {
  if (!prefix) return name;
  return `${prefix.replace(/\/$/, "")}/${name}`;
}

/**
 * Recursive Storage walk. Supabase list() is prefix-only (not recursive).
 * Folders typically have a null id.
 */
export async function enumerateStorageObjects(
  buckets: string[],
  list: StorageLister,
): Promise<StorageObjectMeta[]> {
  const out: StorageObjectMeta[] = [];
  for (const bucket of buckets) {
    const queue = [""];
    const seen = new Set<string>();
    while (queue.length) {
      const prefix = queue.shift() as string;
      const page = await list(bucket, prefix);
      for (const item of page) {
        if (!item.name || item.name === ".emptyFolderPlaceholder") continue;
        const path = joinPrefix(prefix, item.name);
        if (seen.has(path)) continue;
        seen.add(path);
        const isFolder = item.id == null;
        if (isFolder) {
          queue.push(path);
          continue;
        }
        const size = Number(item.metadata?.size ?? 0);
        out.push({
          bucket,
          path,
          size: Number.isFinite(size) ? size : 0,
          contentType: item.metadata?.mimetype ?? null,
        });
      }
    }
  }
  return out;
}

export function storageBackupComplete(args: {
  expected: StorageObjectMeta[];
  backedUpPaths: Array<{ bucket: string; path: string }>;
  failures: Array<{ bucket: string; path: string }>;
}): { ok: true } | { ok: false; code: string } {
  if (args.failures.length > 0) return { ok: false, code: "STORAGE_PARTIAL_FAILURE" };
  const got = new Set(args.backedUpPaths.map((p) => `${p.bucket}/${p.path}`));
  for (const e of args.expected) {
    if (!got.has(`${e.bucket}/${e.path}`)) return { ok: false, code: "STORAGE_OBJECT_MISSING" };
  }
  if (got.size !== args.expected.length) return { ok: false, code: "STORAGE_COUNT_MISMATCH" };
  return { ok: true };
}
