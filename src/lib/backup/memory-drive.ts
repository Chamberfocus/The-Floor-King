import { createHash, randomUUID } from "node:crypto";
import { BACKUP_ROOT_FOLDER_ID, MARKER_SYSTEM } from "./constants";
import type { DriveClient, DriveNode, UploadedFile } from "./drive-client";
import { FOLDER_MIME } from "./drive-client";
import { isIdUnderBackupRoot } from "./drive-scope";

/**
 * In-memory Drive used for tests and restore-validation fixtures.
 * Enforces the same root-scoping rules as production.
 */
export class MemoryDrive implements DriveClient {
  readonly rootId = BACKUP_ROOT_FOLDER_ID;
  private nodes = new Map<string, DriveNode>();
  private failUploads = 0;
  uploadsAttempted = 0;

  constructor() {
    this.nodes.set(this.rootId, {
      id: this.rootId,
      name: "Floor King CRM Backups",
      mimeType: FOLDER_MIME,
      parents: [],
      appProperties: { floorKingBackup: MARKER_SYSTEM },
    });
  }

  /** Simulate transient upload failures, then succeed. */
  setTransientUploadFailures(n: number) {
    this.failUploads = n;
  }

  seedUnrelatedFile(parentId: string, name: string, id = randomUUID()) {
    this.nodes.set(id, {
      id,
      name,
      mimeType: "text/plain",
      parents: [parentId],
      bytes: new Uint8Array([1]),
      size: 1,
    });
    return id;
  }

  knownIds(): Set<string> {
    return new Set(this.nodes.keys());
  }

  private assertUnderRoot(id: string) {
    if (!isIdUnderBackupRoot(id, this.knownIds())) {
      throw new Error("DRIVE_OUTSIDE_ROOT");
    }
  }

  async getFile(fileId: string): Promise<DriveNode> {
    this.assertUnderRoot(fileId);
    const n = this.nodes.get(fileId);
    if (!n) throw new Error("DRIVE_NOT_FOUND");
    return n;
  }

  async listChildren(parentId: string): Promise<DriveNode[]> {
    this.assertUnderRoot(parentId);
    return [...this.nodes.values()].filter((n) => n.parents.includes(parentId));
  }

  async ensureChildFolder(parentId: string, name: string): Promise<{ id: string; name: string }> {
    this.assertUnderRoot(parentId);
    const existing = (await this.listChildren(parentId)).find(
      (n) => n.name === name && n.mimeType === FOLDER_MIME,
    );
    if (existing) return { id: existing.id, name: existing.name };
    const id = randomUUID();
    this.nodes.set(id, {
      id,
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
      appProperties: { floorKingBackup: MARKER_SYSTEM },
    });
    return { id, name };
  }

  async uploadBytes(
    parentId: string,
    name: string,
    bytes: Uint8Array,
    mime: string,
    appProperties?: Record<string, string>,
  ): Promise<UploadedFile> {
    this.assertUnderRoot(parentId);
    this.uploadsAttempted += 1;
    if (this.failUploads > 0) {
      this.failUploads -= 1;
      throw new Error("DRIVE_UPLOAD_TRANSIENT");
    }
    const existing = (await this.listChildren(parentId)).find(
      (n) => n.name === name && n.mimeType !== FOLDER_MIME,
    );
    const id = existing?.id ?? randomUUID();
    const copy = Uint8Array.from(bytes);
    this.nodes.set(id, {
      id,
      name,
      mimeType: mime,
      parents: [parentId],
      bytes: copy,
      size: copy.byteLength,
      md5Checksum: createHash("md5").update(copy).digest("hex"),
      appProperties: { floorKingBackup: MARKER_SYSTEM, ...appProperties },
    });
    return { id, name, size: copy.byteLength, md5Checksum: this.nodes.get(id)?.md5Checksum };
  }

  async readBytes(fileId: string): Promise<Uint8Array> {
    const n = await this.getFile(fileId);
    if (!n.bytes) throw new Error("DRIVE_NOT_FILE");
    return n.bytes;
  }

  async deleteDescendant(fileId: string): Promise<void> {
    if (fileId === this.rootId) throw new Error("DRIVE_DELETE_ROOT_FORBIDDEN");
    this.assertUnderRoot(fileId);
    const n = this.nodes.get(fileId);
    if (!n) throw new Error("DRIVE_NOT_FOUND");
    if (n.appProperties?.floorKingBackup !== MARKER_SYSTEM) {
      throw new Error("DRIVE_DELETE_UNRELATED_FORBIDDEN");
    }
    const stack = [fileId];
    while (stack.length) {
      const id = stack.pop() as string;
      for (const child of this.nodes.values()) {
        if (child.parents.includes(id)) stack.push(child.id);
      }
      this.nodes.delete(id);
    }
  }

  async copyFile(fileId: string, destParentId: string, name: string): Promise<UploadedFile> {
    const src = await this.getFile(fileId);
    if (!src.bytes) throw new Error("DRIVE_NOT_FILE");
    return this.uploadBytes(destParentId, name, src.bytes, src.mimeType, src.appProperties);
  }

  async walkFromRoot(): Promise<DriveNode[]> {
    return [...this.nodes.values()];
  }
}
