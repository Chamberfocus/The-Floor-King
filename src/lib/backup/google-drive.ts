import { createHash } from "node:crypto";
import { BACKUP_ROOT_FOLDER_ID, DRIVE_UPLOAD_ATTEMPTS, MARKER_SYSTEM } from "./constants";
import type { DriveClient, DriveNode, UploadedFile } from "./drive-client";
import { FOLDER_MIME } from "./drive-client";
import { DriveApiError, isRetryableDriveStatus, throwDriveApiError } from "./drive-error";
import { isIdUnderBackupRoot } from "./drive-scope";

type FetchLike = typeof fetch;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isGoogleUploadHost(hostname: string): boolean {
  return hostname === "www.googleapis.com" || hostname.endsWith(".googleapis.com");
}

const FILE_FIELDS = "id,name,mimeType,parents,size,md5Checksum,appProperties,trashed,driveId,capabilities(canAddChildren)";

export class GoogleDriveClient implements DriveClient {
  readonly rootId = BACKUP_ROOT_FOLDER_ID;
  private known = new Set<string>([BACKUP_ROOT_FOLDER_ID]);

  constructor(
    private accessToken: string,
    private fetchImpl: FetchLike = fetch,
  ) {}

  knownIds(): Set<string> {
    return new Set(this.known);
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  private assertKnown(id: string) {
    if (!isIdUnderBackupRoot(id, this.known)) throw new Error("DRIVE_OUTSIDE_ROOT");
  }

  private async driveFetch(url: string, init: RequestInit = {}) {
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { ...this.authHeaders(), ...(init.headers as Record<string, string> | undefined) },
    });
    return res;
  }

  private mapNode(json: DriveNode & { size?: string; capabilities?: { canAddChildren?: boolean } }): DriveNode {
    this.known.add(json.id);
    return {
      ...json,
      size: json.size != null ? Number(json.size) : undefined,
      parents: json.parents ?? [],
      canAddChildren: json.capabilities?.canAddChildren ?? json.canAddChildren,
    };
  }

  async getFile(fileId: string): Promise<DriveNode> {
    this.assertKnown(fileId);
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("fields", FILE_FIELDS);
    const res = await this.driveFetch(url.toString());
    if (!res.ok) await throwDriveApiError("destination_folder", res);
    const json = (await res.json()) as DriveNode & {
      size?: string;
      capabilities?: { canAddChildren?: boolean };
    };
    if (json.parents?.length) {
      const parentKnown = json.parents.some((p) => this.known.has(p) || p === this.rootId);
      if (!parentKnown && fileId !== this.rootId) throw new Error("DRIVE_OUTSIDE_ROOT");
    }
    return this.mapNode(json);
  }

  async listChildren(parentId: string): Promise<DriveNode[]> {
    this.assertKnown(parentId);
    const out: DriveNode[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("q", `'${parentId}' in parents and trashed = false`);
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      url.searchParams.set(
        "fields",
        "nextPageToken,files(id,name,mimeType,parents,size,md5Checksum,appProperties,trashed,driveId)",
      );
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await this.driveFetch(url.toString());
      if (!res.ok) await throwDriveApiError("list", res);
      const json = (await res.json()) as {
        nextPageToken?: string;
        files?: Array<DriveNode & { size?: string }>;
      };
      for (const f of json.files ?? []) {
        out.push(this.mapNode(f));
      }
      pageToken = json.nextPageToken;
    } while (pageToken);
    return out;
  }

  async ensureChildFolder(parentId: string, name: string): Promise<{ id: string; name: string }> {
    this.assertKnown(parentId);
    const kids = await this.listChildren(parentId);
    const existing = kids.find((k) => k.name === name && k.mimeType === FOLDER_MIME);
    if (existing) return { id: existing.id, name: existing.name };
    const res = await this.driveFetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        parents: [parentId],
        appProperties: { floorKingBackup: MARKER_SYSTEM },
      }),
    });
    if (!res.ok) await throwDriveApiError("folder_create", res);
    const json = (await res.json()) as { id: string; name: string };
    this.known.add(json.id);
    return json;
  }

  async uploadBytes(
    parentId: string,
    name: string,
    bytes: Uint8Array,
    mime: string,
    appProperties?: Record<string, string>,
  ): Promise<UploadedFile> {
    this.assertKnown(parentId);
    let lastErr: unknown;
    for (let attempt = 1; attempt <= DRIVE_UPLOAD_ATTEMPTS; attempt++) {
      try {
        return await this.uploadOnce(parentId, name, bytes, mime, appProperties);
      } catch (err) {
        lastErr = err;
        const status = err instanceof DriveApiError ? err.status : 0;
        if (!isRetryableDriveStatus(status) || attempt >= DRIVE_UPLOAD_ATTEMPTS) break;
        await sleep(250 * attempt);
      }
    }
    throw lastErr instanceof Error ? lastErr : new DriveApiError("upload", 0, "unknown");
  }

  private async uploadOnce(
    parentId: string,
    name: string,
    bytes: Uint8Array,
    mime: string,
    appProperties?: Record<string, string>,
  ): Promise<UploadedFile> {
    const metadata = JSON.stringify({
      name,
      parents: [parentId],
      appProperties: { floorKingBackup: MARKER_SYSTEM, ...appProperties },
    });
    const init = await this.driveFetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,md5Checksum,parents,trashed",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mime,
          "X-Upload-Content-Length": String(bytes.byteLength),
        },
        body: metadata,
      },
    );
    if (!init.ok) await throwDriveApiError("upload", init);
    const location = init.headers.get("location");
    if (!location) throw new DriveApiError("upload", init.status || 500, "missing_upload_url");
    let uploadUrl: URL;
    try {
      uploadUrl = new URL(location);
    } catch {
      throw new DriveApiError("upload", 500, "invalid_upload_url");
    }
    if (!isGoogleUploadHost(uploadUrl.hostname)) {
      throw new DriveApiError("upload", 500, "invalid_upload_url");
    }
    const put = await this.driveFetch(uploadUrl.toString(), {
      method: "PUT",
      headers: {
        "Content-Type": mime,
        "Content-Length": String(bytes.byteLength),
      },
      body: Buffer.from(bytes),
    });
    if (!put.ok) await throwDriveApiError("upload", put);
    const json = (await put.json()) as { id: string; name: string; size?: string; md5Checksum?: string };
    this.known.add(json.id);
    return {
      id: json.id,
      name: json.name,
      size: json.size != null ? Number(json.size) : bytes.byteLength,
      md5Checksum: json.md5Checksum ?? createHash("md5").update(bytes).digest("hex"),
    };
  }

  async readBytes(fileId: string): Promise<Uint8Array> {
    this.assertKnown(fileId);
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
    url.searchParams.set("alt", "media");
    url.searchParams.set("supportsAllDrives", "true");
    const res = await this.driveFetch(url.toString());
    if (!res.ok) await throwDriveApiError("download", res);
    return new Uint8Array(await res.arrayBuffer());
  }

  async deleteDescendant(fileId: string): Promise<void> {
    if (fileId === this.rootId) throw new Error("DRIVE_DELETE_ROOT_FORBIDDEN");
    this.assertKnown(fileId);
    const file = await this.getFile(fileId);
    if (file.appProperties?.floorKingBackup !== MARKER_SYSTEM) {
      throw new Error("DRIVE_DELETE_UNRELATED_FORBIDDEN");
    }
    const res = await this.driveFetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
      { method: "DELETE" },
    );
    if (!res.ok && res.status !== 404) await throwDriveApiError("delete", res);
    this.known.delete(fileId);
  }

  async copyFile(fileId: string, destParentId: string, name: string): Promise<UploadedFile> {
    this.assertKnown(fileId);
    this.assertKnown(destParentId);
    const res = await this.driveFetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/copy?supportsAllDrives=true`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          parents: [destParentId],
          appProperties: { floorKingBackup: MARKER_SYSTEM },
        }),
      },
    );
    if (!res.ok) await throwDriveApiError("copy", res);
    const json = (await res.json()) as { id: string; name: string; size?: string };
    this.known.add(json.id);
    return { id: json.id, name: json.name, size: json.size != null ? Number(json.size) : 0 };
  }

  async walkFromRoot(): Promise<DriveNode[]> {
    const out: DriveNode[] = [];
    const queue = [this.rootId];
    const seen = new Set<string>();
    while (queue.length) {
      const id = queue.shift() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      const kids = await this.listChildren(id);
      for (const k of kids) {
        out.push(k);
        if (k.mimeType === FOLDER_MIME) queue.push(k.id);
      }
    }
    return out;
  }
}
