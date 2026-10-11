import { createServer, type Server } from "node:http";
import { generateKeyPairSync } from "node:crypto";

// No real GitHub calls anywhere in e2e. The API is pointed here with
// GITHUB_API_URL; this fakes only what the setup flow reads —
// GET /app/installations/:id with the App JWT (PLAN-006). Ids absent from
// INSTALLATIONS 404, exactly like GitHub does for another App's installation.
export const FAKE_GH_PORT = Number(process.env.E2E_FAKE_GH_PORT ?? "4010");
export const INSTALLATIONS: Record<number, string> = {
  501: "e2e-org",
  502: "e2e-other-org",
};
export const GH_APP_SLUG = "tallyline-e2e";
export const GH_WEBHOOK_SECRET = "e2e-webhook-secret";

// one RSA key per config load; only the API webServer consumes it
export const GH_APP_PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
}).privateKey;

export function startFakeGithub(): Promise<Server> {
  const server = createServer((req, res) => {
    const m = /^\/app\/installations\/(\d+)$/.exec(req.url ?? "");
    const login = m ? INSTALLATIONS[Number(m[1])] : undefined;
    const ok = m && login && /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(req.headers.authorization ?? "");
    res.setHeader("content-type", "application/json");
    if (ok) {
      res.end(JSON.stringify({ id: Number(m[1]), account: { login } }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "Not Found" }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(FAKE_GH_PORT, "127.0.0.1", () => resolve(server));
  });
}
