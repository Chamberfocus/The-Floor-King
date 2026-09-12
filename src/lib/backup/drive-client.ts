export type DriveNode = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  bytes?: Uint8Array;
  size?: number;
  md5Checksum?: string;
  appProperties?: Record<string, string>;
  trashed?: boolean;
  driveId?: string;
  canAddChildren?: boolean;
};

export type UploadedFile = {
  id: string;
  name: string;
  size: number;
  md5Checksum?: string;
};

export interface DriveClient {
  readonly rootId: string;
  ensureChildFolder(parentId: string, name: string): Promise<{ id: string; name: string }>;
  uploadBytes(
    parentId: string,
    name: string,
    bytes: Uint8Array,
    mime: string,
    appProperties?: Record<string, string>,
  ): Promise<UploadedFile>;
  readBytes(fileId: string): Promise<Uint8Array>;
  deleteDescendant(fileId: string): Promise<void>;
  listChildren(parentId: string): Promise<DriveNode[]>;
  getFile(fileId: string): Promise<DriveNode>;
  copyFile(fileId: string, destParentId: string, name: string): Promise<UploadedFile>;
  knownIds(): Set<string>;
  walkFromRoot(): Promise<DriveNode[]>;
}

export const FOLDER_MIME = "application/vnd.google-apps.folder";
