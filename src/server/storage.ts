import fs from "fs/promises";
import os from "os";
import path from "path";
import { nanoid } from "nanoid";

const UPLOAD_DIR = process.env.PRIVATE_STORAGE_PATH || path.join(process.cwd(), "private_uploads");

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/tiff",
]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export interface StoredFile {
  storagePath: string;
  fileSize: number;
}

export async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

export function validateFile(mimeType: string, fileSize: number): string | null {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return `Unsupported file type: ${mimeType}. Allowed: PDF, PNG, JPEG, WebP, TIFF`;
  }
  if (fileSize > MAX_FILE_SIZE) {
    return `File too large: ${(fileSize / 1024 / 1024).toFixed(1)}MB. Maximum: 20MB`;
  }
  return null;
}

export async function storeFile(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string
): Promise<StoredFile> {
  try {
    await ensureUploadDir();

    const ext = path.extname(originalFilename) || mimeToExt(mimeType);
    const uniqueName = `${nanoid(16)}${ext}`;
    const tenantDir = UPLOAD_DIR;

    const fullPath = path.join(tenantDir, uniqueName);
    await fs.writeFile(fullPath, buffer);

    return {
      storagePath: uniqueName,
      fileSize: buffer.length,
    };
  } catch (error) {
    console.error("Store file error:", error);
    throw new Error(`Failed to store file: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

export async function readPrivateFile(storagePath: string): Promise<Buffer> {
  const fullPath = path.join(UPLOAD_DIR, path.basename(storagePath));
  return fs.readFile(fullPath);
}


export async function deletePrivateFile(storagePath: string): Promise<void> {
  const fullPath = path.join(UPLOAD_DIR, path.basename(storagePath));
  try {
    await fs.unlink(fullPath);
  } catch {
    // File may already be deleted, ignore
  }
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/tiff": ".tiff",
  };
  return map[mime] || ".bin";
}
