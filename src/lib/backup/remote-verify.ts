import { DATABASE_DUMP_NAME } from "./constants";

export type RemoteDumpMeta = {
  name?: string;
  size?: number;
  md5Checksum?: string;
  trashed?: boolean;
  parents?: string[];
};

/**
 * Independent Drive metadata proof. Does not download file bytes.
 */
export function verifyDriveDumpMetadata(args: {
  localBytes: number;
  localMd5: string;
  remote: RemoteDumpMeta | null;
  expectedParentId: string;
}): { ok: true } | { ok: false; code: string } {
  const remote = args.remote;
  if (!remote) return { ok: false, code: "DUMP_REMOTE_MISSING" };
  if (remote.name && remote.name !== DATABASE_DUMP_NAME) {
    return { ok: false, code: "DUMP_NAME_MISMATCH" };
  }
  if (remote.trashed) return { ok: false, code: "DUMP_REMOTE_TRASHED" };
  if (remote.parents && !remote.parents.includes(args.expectedParentId)) {
    return { ok: false, code: "DUMP_PARENT_MISMATCH" };
  }
  if (typeof remote.size !== "number" || remote.size !== args.localBytes) {
    return { ok: false, code: "DUMP_SIZE_MISMATCH" };
  }
  const md5 = remote.md5Checksum?.toLowerCase();
  if (!md5 || md5 !== args.localMd5.toLowerCase()) {
    return { ok: false, code: "DUMP_MD5_MISMATCH" };
  }
  return { ok: true };
}
