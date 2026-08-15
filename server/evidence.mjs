import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MIME_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export function parseImageDataUrl(dataUrl, { maximumBytes = 8 * 1024 * 1024 } = {}) {
  if (typeof dataUrl !== "string") throw new Error("IMAGE_REQUIRED");
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
  if (!match) throw new Error("IMAGE_FORMAT_UNSUPPORTED");
  const mime = match[1];
  const bytes = Buffer.from(match[2].replace(/[\r\n]/g, ""), "base64");
  if (bytes.length < 64) throw new Error("IMAGE_TOO_SMALL");
  if (bytes.length > maximumBytes) throw new Error("IMAGE_TOO_LARGE");
  const hasExpectedSignature = (
    (mime === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || (mime === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    || (mime === "image/webp" && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP")
  );
  if (!hasExpectedSignature) throw new Error("IMAGE_CONTENT_INVALID");
  return {
    mime,
    bytes,
    extension: MIME_EXTENSIONS.get(mime),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function saveEvidence({ evidenceDir, submissionId, image }) {
  await mkdir(evidenceDir, { recursive: true });
  const filename = `${submissionId}.${image.extension}`;
  const path = join(evidenceDir, filename);
  await writeFile(path, image.bytes, { flag: "wx" });
  return path;
}

function evidenceSignature(secret, submissionId, expiresAt) {
  return createHmac("sha256", secret)
    .update(`${submissionId}.${expiresAt}`)
    .digest("base64url");
}

export function createSignedEvidenceUrl({ publicBaseUrl, secret, submissionId, lifetimeSeconds = 1800 }) {
  const expiresAt = Math.floor(Date.now() / 1000) + lifetimeSeconds;
  const signature = evidenceSignature(secret, submissionId, expiresAt);
  const url = new URL(`/api/evidence/${encodeURIComponent(submissionId)}`, publicBaseUrl);
  url.searchParams.set("expires", String(expiresAt));
  url.searchParams.set("signature", signature);
  return url.toString();
}

export function verifyEvidenceSignature({ secret, submissionId, expiresAt, signature }) {
  if (!expiresAt || !signature || !/^\d{10}$/.test(String(expiresAt))) return false;
  if (Number(expiresAt) < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(evidenceSignature(secret, submissionId, expiresAt));
  const received = Buffer.from(String(signature));
  return expected.length === received.length && timingSafeEqual(expected, received);
}
