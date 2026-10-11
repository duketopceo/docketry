import { createHmac, generateKeyPairSync } from "node:crypto";
import { app } from "../src/index.js";
import {
  configureGithubApp,
  resetGithubSync,
  setGithubApiFetcher,
} from "../src/services/github-sync.js";

export const WEBHOOK_SECRET = "test-webhook-secret"; // vitest.config.ts env

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

export interface GhCall {
  url: string;
  method: string;
  auth?: string | undefined;
}

export const jsonRes = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * Install a fake GitHub transport + a real RSA App key. `installations` maps
 * installation id -> account login (ids absent from it 404, like GitHub does
 * for an installation that belongs to a different App). `manifestCodes` maps
 * a manifest code -> conversion response body.
 */
export function mockGithub(opts: {
  installations?: Record<number, string>;
  manifestCodes?: Record<string, Record<string, unknown>>;
}): { calls: GhCall[] } {
  const calls: GhCall[] = [];
  configureGithubApp({ appId: "424242", privateKey });
  setGithubApiFetcher(async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method: init?.method ?? "GET", auth: headers.authorization });
    const inst = /\/app\/installations\/(\d+)$/.exec(url);
    if (inst) {
      const login = opts.installations?.[Number(inst[1])];
      return login === undefined
        ? jsonRes({ message: "Not Found" }, 404)
        : jsonRes({ id: Number(inst[1]), account: { login } });
    }
    const conv = /\/app-manifests\/([^/]+)\/conversions$/.exec(url);
    if (conv) {
      const body = opts.manifestCodes?.[decodeURIComponent(conv[1]!)];
      return body ? jsonRes(body, 201) : jsonRes({ message: "Not Found" }, 404);
    }
    return jsonRes({ message: "unexpected" }, 500);
  });
  return { calls };
}

export { resetGithubSync };

export function signBody(body: string): string {
  return `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(body, "utf8").digest("hex")}`;
}

let delivery = 0;
export async function deliverWebhook(
  event: string,
  payload: Record<string, unknown>,
): Promise<number> {
  const body = JSON.stringify(payload);
  const res = await app.fetch(
    new Request("http://api.test/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signBody(body),
        "x-github-event": event,
        "x-github-delivery": `t-${process.pid}-${++delivery}`,
      },
      body,
    }),
  );
  return res.status;
}

/** bootstrap the instance, return the owner's session cookie */
export async function bootstrap(slug: string): Promise<string> {
  const res = await app.fetch(
    new Request("http://api.test/v1/auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceSlug: slug,
        workspaceName: slug,
        teamKey: "AB",
        email: `${slug}@test.dev`,
        name: "Owner",
        password: "pw-long-enough",
      }),
    }),
  );
  if (res.status !== 201) throw new Error(`bootstrap ${res.status}`);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

// loose on purpose: tests poke at arbitrary response shapes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiBody = Record<string, any>;

export async function api(
  cookie: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: ApiBody }> {
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      ...init,
      headers: { "content-type": "application/json", cookie, ...(init?.headers as Record<string, string>) },
    }),
  );
  const text = await res.text();
  let body: ApiBody = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { _text: text };
  }
  return { status: res.status, body };
}
