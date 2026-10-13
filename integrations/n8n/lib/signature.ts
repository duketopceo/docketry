import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Mirrors the signing scheme in apps/api/src/services/outbound.ts:
 * `X-Tallyline-Signature: sha256=<hex HMAC-SHA256 of the raw JSON body>`.
 */
export function signTallylineBody(
	rawBody: string | Buffer,
	secret: string,
): string {
	return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

/**
 * Constant-time verification of a delivery signature. Fails closed on a
 * missing/malformed header or missing secret/raw body.
 */
export function verifyTallylineSignature(
	rawBody: string | Buffer | undefined,
	signatureHeader: string | undefined,
	secret: string | undefined,
): boolean {
	if (!secret || rawBody === undefined || signatureHeader === undefined) {
		return false;
	}
	if (!signatureHeader.startsWith("sha256=")) return false;
	const expected = signTallylineBody(rawBody, secret);
	if (expected.length !== signatureHeader.length) return false;
	return timingSafeEqual(
		Buffer.from(signatureHeader),
		Buffer.from(expected),
	);
}

/**
 * Reads a delivery header by its `x-tallyline-*` name. (This package is
 * published standalone, so it cannot import the shared helper from
 * @tallyline/types.)
 */
export function deliveryHeader(
	headers: Record<string, unknown>,
	name: string,
): string | undefined {
	const v = headers[name];
	return typeof v === "string" ? v : undefined;
}
