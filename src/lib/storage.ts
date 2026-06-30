import { promises as fs } from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────
// Object storage abstraction.
//
// • If S3-compatible credentials are configured, original uploaded files are
//   written to the bucket (Cloudflare R2 / AWS S3 / Backblaze B2 / MinIO).
// • Otherwise files fall back to the local `uploads/` directory.
//
// This is what makes the app safe on EPHEMERAL hosting (Manus, serverless,
// containers without a persistent disk): point storage at a bucket and point
// DATABASE_URL at hosted libSQL/Turso, and nothing is lost on restart.
//
// `documents.storagePath` stores an opaque ref:
//   local  ->  the absolute file path
//   s3     ->  "s3://<bucket>/<key>"
// ─────────────────────────────────────────────────────────────────────────

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

const S3_BUCKET = process.env.STORAGE_S3_BUCKET;
const S3_KEY_ID = process.env.STORAGE_S3_ACCESS_KEY_ID;
const S3_SECRET = process.env.STORAGE_S3_SECRET_ACCESS_KEY;

export function storageMode(): "s3" | "local" {
  return S3_BUCKET && S3_KEY_ID && S3_SECRET ? "s3" : "local";
}

// Lazy, cached S3 client so the AWS SDK is only loaded when actually used.
let s3clientPromise: Promise<import("@aws-sdk/client-s3").S3Client> | null = null;
async function getS3() {
  if (!s3clientPromise) {
    s3clientPromise = (async () => {
      const { S3Client } = await import("@aws-sdk/client-s3");
      return new S3Client({
        region: process.env.STORAGE_S3_REGION ?? "us-east-1",
        endpoint: process.env.STORAGE_S3_ENDPOINT || undefined,
        forcePathStyle: process.env.STORAGE_S3_FORCE_PATH_STYLE === "true",
        credentials: {
          accessKeyId: S3_KEY_ID!,
          secretAccessKey: S3_SECRET!,
        },
      });
    })();
  }
  return s3clientPromise;
}

/** Store a file's bytes. Returns an opaque storage ref to persist. */
export async function putObject(
  key: string,
  body: Buffer,
  contentType?: string
): Promise<string> {
  if (storageMode() === "s3") {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await getS3();
    await client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET!,
        Key: key,
        Body: body,
        ContentType: contentType || "application/octet-stream",
      })
    );
    return `s3://${S3_BUCKET}/${key}`;
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const filePath = path.join(UPLOAD_DIR, key);
  await fs.writeFile(filePath, body);
  return filePath;
}

/** Retrieve a stored file's bytes from its ref. */
export async function getObject(ref: string): Promise<Buffer> {
  if (ref.startsWith("s3://")) {
    const without = ref.slice("s3://".length);
    const slash = without.indexOf("/");
    const bucket = without.slice(0, slash);
    const key = without.slice(slash + 1);
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await getS3();
    const res = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
  return fs.readFile(ref);
}
