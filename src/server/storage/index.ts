import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { forbidden } from "../authz";

/**
 * Storage de mídia com isolamento por tenant:
 * - Toda chave começa com `org/{orgId}/` e é validada contra o tenant da operação.
 * - Acesso do navegador só por URL temporária (assinada, curta duração).
 * Drivers: `local` (desenvolvimento/VPS com disco criptografado) e `s3`
 * (Cloudflare R2, MinIO, AWS S3 — criptografia em repouso do provedor).
 */
export interface StorageDriver {
  put(key: string, body: Readable, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  size(key: string): Promise<number | null>;
  signedGetUrl(key: string, ttlSeconds: number): Promise<string>;
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function mediaKey(orgId: string, conversationId: string, fileName: string) {
  for (const s of [orgId, conversationId, fileName]) {
    if (!SAFE_SEGMENT.test(s) || s === "." || s === "..") throw new Error("Segmento de chave inválido");
  }
  return `org/${orgId}/conversations/${conversationId}/${fileName}`;
}

/** Garante que a chave pertence ao tenant. Chamado em TODA operação. */
export function assertKeyInTenant(orgId: string, key: string) {
  const prefix = `org/${orgId}/`;
  if (!key.startsWith(prefix) || key.includes("..") || key.includes("//")) throw forbidden("Acesso à mídia negado.");
}

/* ----------------------------- driver local ----------------------------- */
export class LocalStorage implements StorageDriver {
  constructor(
    private readonly root: string,
    private readonly secret: string,
    private readonly baseUrl: string,
  ) {}
  private file(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw forbidden();
    return full;
  }
  async put(key: string, body: Readable) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await pipeline(body, createWriteStream(f, { mode: 0o600 }));
  }
  async get(key: string) {
    return createReadStream(this.file(key));
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
  async size(key: string) {
    try {
      return (await stat(this.file(key))).size;
    } catch {
      return null;
    }
  }
  sign(key: string, exp: number) {
    return createHmac("sha256", this.secret).update(`${key}:${exp}`).digest("base64url");
  }
  async signedGetUrl(key: string, ttlSeconds: number) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const q = new URLSearchParams({ key, exp: String(exp), sig: this.sign(key, exp) });
    return `${this.baseUrl}/api/v1/media/local?${q}`;
  }
  verify(key: string, exp: number, sig: string, now = Date.now()) {
    if (!Number.isFinite(exp) || exp * 1000 < now) return false;
    const a = Buffer.from(this.sign(key, exp));
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

/* ------------------------------ driver S3 ------------------------------ */
export class S3Storage implements StorageDriver {
  private clientPromise;
  constructor(private readonly bucket: string) {
    this.clientPromise = import("@aws-sdk/client-s3").then(
      ({ S3Client }) =>
        new S3Client({
          endpoint: process.env.S3_ENDPOINT || undefined,
          region: process.env.S3_REGION || "auto",
          forcePathStyle: Boolean(process.env.S3_ENDPOINT),
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
          },
        }),
    );
  }
  async put(key: string, body: Readable, contentType: string) {
    // Upload multipart em streaming (arquivos de até ~2 GB sem carregar em memória).
    const { Upload } = await import("@aws-sdk/lib-storage");
    await new Upload({
      client: await this.clientPromise,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
    }).done();
  }
  async get(key: string) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const r = await (await this.clientPromise).send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return r.Body as Readable;
  }
  async delete(key: string) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.clientPromise).send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async size(key: string) {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      const r = await (await this.clientPromise).send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return r.ContentLength ?? null;
    } catch {
      return null;
    }
  }
  async signedGetUrl(key: string, ttlSeconds: number) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    return getSignedUrl(await this.clientPromise, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSeconds });
  }
}

let driver: StorageDriver | undefined;
export function getStorage(): StorageDriver {
  if (!driver) {
    driver =
      process.env.STORAGE_DRIVER === "s3"
        ? new S3Storage(process.env.S3_BUCKET ?? "")
        : new LocalStorage(
            process.env.STORAGE_LOCAL_DIR ?? "./var/storage",
            process.env.BETTER_AUTH_SECRET ?? "dev-secret",
            process.env.APP_URL ?? "http://localhost:3000",
          );
  }
  return driver;
}

/** Fachada com checagem de tenant obrigatória. */
export const tenantStorage = (orgId: string) => ({
  put: (key: string, body: Readable, contentType: string) => (assertKeyInTenant(orgId, key), getStorage().put(key, body, contentType)),
  get: (key: string) => (assertKeyInTenant(orgId, key), getStorage().get(key)),
  delete: (key: string) => (assertKeyInTenant(orgId, key), getStorage().delete(key)),
  size: (key: string) => (assertKeyInTenant(orgId, key), getStorage().size(key)),
  signedGetUrl: (key: string, ttl = Number(process.env.MEDIA_URL_TTL_SECONDS ?? 300)) => (
    assertKeyInTenant(orgId, key), getStorage().signedGetUrl(key, ttl)
  ),
});
