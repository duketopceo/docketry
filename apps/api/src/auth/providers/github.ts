import type {
  IdentityResult,
  OAuthProvider,
} from "./types.js";
import { oauthFetch } from "./types.js";

// GitHub OAuth (oauth-only — no id_token; identity comes from /user +
// /user/emails per the plan's provider research). PKCE works on github.com;
// GHES is out of scope (Scope Boundaries).
const AUTH_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API = "https://api.github.com";

export function githubProvider(opts: {
  key: string;
  label: string;
  clientId: string;
  clientSecret: string;
  source: "env" | "db";
}): OAuthProvider {
  return {
    key: opts.key,
    type: "github",
    label: opts.label,
    public: {
      clientId: opts.clientId,
      scopes: ["read:user", "user:email"],
      issuer: null,
      source: opts.source,
    },
    authorizeUrl({ redirectUri, state, codeChallenge }) {
      const u = new URL(AUTH_URL);
      u.searchParams.set("client_id", opts.clientId);
      u.searchParams.set("redirect_uri", redirectUri);
      u.searchParams.set("scope", "read:user user:email");
      u.searchParams.set("state", state);
      u.searchParams.set("code_challenge", codeChallenge);
      u.searchParams.set("code_challenge_method", "S256");
      return u.toString();
    },
    async exchange({ code, redirectUri, codeVerifier }): Promise<IdentityResult> {
      const fetch = oauthFetch();
      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          code,
          redirect_uri: redirectUri,
          ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
        }),
      });
      const tokenBody = (await tokenRes.json()) as {
        access_token?: string;
        error?: string;
      };
      if (!tokenRes.ok || !tokenBody.access_token) {
        throw new Error(`github token exchange failed: ${tokenBody.error ?? tokenRes.status}`);
      }
      const auth = { authorization: `Bearer ${tokenBody.access_token}`, accept: "application/vnd.github+json" };
      const userRes = await fetch(`${API}/user`, { headers: auth });
      if (!userRes.ok) throw new Error(`github /user failed: ${userRes.status}`);
      const profile = (await userRes.json()) as {
        id: number;
        email: string | null;
        name: string | null;
        avatar_url: string | null;
      };
      let email = profile.email;
      let verified = email !== null;
      if (!email) {
        // no public email — fall back to the verified primary (user:email scope)
        const emailsRes = await fetch(`${API}/user/emails`, { headers: auth });
        if (emailsRes.ok) {
          const emails = (await emailsRes.json()) as {
            email: string;
            primary: boolean;
            verified: boolean;
          }[];
          const primary = emails.find((e) => e.primary && e.verified);
          email = primary?.email ?? null;
          verified = primary !== undefined;
        } else {
          email = null;
          verified = false;
        }
      }
      return {
        subject: String(profile.id),
        email,
        emailVerified: verified,
        name: profile.name,
        avatarUrl: profile.avatar_url,
        hd: null,
      };
    },
  };
}
