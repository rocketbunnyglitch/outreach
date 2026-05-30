import "server-only";

/**
 * Attachment storage — S3-compatible object store.
 *
 * Works with: AWS S3, Cloudflare R2, Backblaze B2, MinIO, Hetzner
 * Object Storage, any other S3-compatible service. The same API
 * surface drives all of them; only the endpoint + region + bucket
 * env vars change.
 *
 * Why S3-compatible vs Gmail attachments directly: the composer
 * needs to upload BEFORE send (the operator wants to see the chip
 * settle as "uploaded" + abort early on size/MIME failures), and
 * the cron-driven scheduled send fires from a server context that
 * doesn't have the original File objects. We persist the file in
 * the object store at upload time, store the storage_key on the
 * draft's JSONB attachments array, then fetch + base64-encode on
 * send (whether sent now or hours later).
 *
 * Required env (when ATTACHMENTS_ENABLED=true):
 *   ATTACHMENTS_BUCKET           bucket name
 *   ATTACHMENTS_REGION           "auto" for R2; e.g. "us-east-1" for S3
 *   ATTACHMENTS_ENDPOINT         e.g. https://<acct>.r2.cloudflarestorage.com
 *   ATTACHMENTS_ACCESS_KEY_ID
 *   ATTACHMENTS_SECRET_ACCESS_KEY
 *   ATTACHMENTS_PUBLIC_PREFIX    (optional) for verification of incoming keys
 *
 * If ATTACHMENTS_ENABLED is unset/false, every call here returns
 * `{ enabled: false }` and the composer falls back to its existing
 * "files held in memory only" behavior — backward compatible.
 *
 * Key layout:
 *   teams/{teamId}/drafts/{draftId}/{uuid}-{sanitized-filename}
 *
 * Object metadata stored:
 *   x-amz-meta-team-id    — used for delete-on-discard auth
 *   x-amz-meta-draft-id   — links back to the draft row
 *   x-amz-meta-uploader   — staff.id for audit
 */

import { logger } from "@/lib/logger";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const MAX_BYTES = 25 * 1024 * 1024;

let cachedClient: S3Client | null = null;

interface Env {
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function readEnv(): Env | null {
  const enabled = process.env.ATTACHMENTS_ENABLED === "true";
  if (!enabled) return null;
  const bucket = process.env.ATTACHMENTS_BUCKET;
  const region = process.env.ATTACHMENTS_REGION;
  const endpoint = process.env.ATTACHMENTS_ENDPOINT;
  const accessKeyId = process.env.ATTACHMENTS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.ATTACHMENTS_SECRET_ACCESS_KEY;
  if (!bucket || !region || !endpoint || !accessKeyId || !secretAccessKey) {
    logger.warn(
      "[attachments] ATTACHMENTS_ENABLED=true but config incomplete; treating as disabled",
    );
    return null;
  }
  return { bucket, region, endpoint, accessKeyId, secretAccessKey };
}

function getClient(env: Env): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: env.region,
    endpoint: env.endpoint,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
    forcePathStyle: false,
  });
  return cachedClient;
}

export function isAttachmentStorageEnabled(): boolean {
  return readEnv() !== null;
}

export interface SignedUploadInput {
  teamId: string;
  draftId: string;
  staffId: string;
  filename: string;
  mime: string;
  sizeBytes: number;
}

export interface SignedUploadResult {
  enabled: true;
  /** Pre-signed PUT URL the browser uploads to directly. */
  uploadUrl: string;
  /** Storage key persisted on the draft attachment record. */
  storageKey: string;
  /** Required content-type header on the browser's PUT. */
  contentType: string;
  /** When the signed URL expires (ISO). */
  expiresAt: string;
}

export type SignedUploadOutput = SignedUploadResult | { enabled: false };

/**
 * Create a pre-signed PUT URL the browser can upload to directly.
 * Returns { enabled: false } if storage is not configured — caller
 * falls back to the in-memory-only path.
 */
export async function createSignedUpload(input: SignedUploadInput): Promise<SignedUploadOutput> {
  const env = readEnv();
  if (!env) return { enabled: false };
  if (input.sizeBytes > MAX_BYTES) {
    throw new Error(`File exceeds 25 MB limit (${input.sizeBytes} bytes).`);
  }
  const safeName = input.filename.replace(/[^\w.\-+@()=, ]+/g, "_").slice(0, 200);
  const storageKey = `teams/${input.teamId}/drafts/${input.draftId}/${crypto.randomUUID()}-${safeName}`;

  const cmd = new PutObjectCommand({
    Bucket: env.bucket,
    Key: storageKey,
    ContentType: input.mime,
    ContentLength: input.sizeBytes,
    Metadata: {
      "team-id": input.teamId,
      "draft-id": input.draftId,
      uploader: input.staffId,
    },
  });

  const expiresInSec = 600; // 10 minutes — generous for slow uploads
  const uploadUrl = await getSignedUrl(getClient(env), cmd, { expiresIn: expiresInSec });

  return {
    enabled: true,
    uploadUrl,
    storageKey,
    contentType: input.mime,
    expiresAt: new Date(Date.now() + expiresInSec * 1_000).toISOString(),
  };
}

/**
 * Fetch the raw bytes of a stored attachment. Used by the send
 * pipeline to base64-encode into the outbound Gmail multipart.
 *
 * Returns null when storage is disabled or the object is missing.
 */
export async function fetchAttachmentBytes(storageKey: string): Promise<Buffer | null> {
  const env = readEnv();
  if (!env) return null;
  try {
    const res = await getClient(env).send(
      new GetObjectCommand({ Bucket: env.bucket, Key: storageKey }),
    );
    const body = res.Body;
    if (!body) return null;
    // The body is a Node Readable when running under the AWS SDK
    // server transport; collect into a Buffer.
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    logger.error({ err, storageKey }, "fetchAttachmentBytes failed");
    return null;
  }
}

/**
 * Delete an object. Best-effort — failures log but don't throw.
 * Used when an operator discards a draft so we don't leak storage.
 */
export async function deleteAttachment(storageKey: string): Promise<void> {
  const env = readEnv();
  if (!env) return;
  try {
    await getClient(env).send(new DeleteObjectCommand({ Bucket: env.bucket, Key: storageKey }));
  } catch (err) {
    logger.warn({ err, storageKey }, "deleteAttachment failed (non-fatal)");
  }
}

/**
 * Validate that a storage key is shaped the way we expect — guards
 * against trusting an attacker-supplied key from a client payload.
 * Pattern matches the createSignedUpload key layout.
 */
export function isValidStorageKey(key: string, teamId: string): boolean {
  return key.startsWith(`teams/${teamId}/drafts/`) && key.length <= 512;
}
