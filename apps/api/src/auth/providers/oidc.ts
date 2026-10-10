import * as client from "openid-client";
import type {
  IdentityResult,
  OAuthProvider,
} from "./types.js";

// OpenID Connect over discovery — covers google (fixed issuer) and generic
// oidc (configured issuer). Discovery is cached per issuer; openid-client
// validates id_token signature/nonce/aud/iss/exp for us.
const discoveryCache = new Map<string, Promise<client.Configuration>>();

function discover(issuer: string, clientId: string, clientSecret: string) {
  let p = discoveryCache.get(issuer);
  if (!p) {
    p = client.discovery(new URL(issuer), clientId, clientSecret);
    discoveryCache.set(issuer, p);
    p.catch(() => discoveryCache.delete(issuer));
  }
  return p;
}

export function __clearOidcDiscoveryForTests() {
  discoveryCache.clear();
}

export function oidcProvider(opts: {
  key: string;
  type: "google" | "oidc";
  label: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  source: "env" | "db";
}): OAuthProvider {
  const scope = [...new Set([...opts.scopes, "openid"])].join(" ");
  return {
    key: opts.key,
    type: opts.type,
    label: opts.label,
    public: {
      clientId: opts.clientId,
      scopes: scope.split(" "),
      issuer: opts.issuer,
      source: opts.source,
    },
    async authorizeUrl({ redirectUri, state, nonce, codeChallenge }) {
      // google's authorize endpoint is documented-stable; generic oidc
      // comes from discovery so any compliant IdP works
      const base =
        opts.type === "google"
          ? "https://accounts.google.com/o/oauth2/v2/auth"
          : (await discover(opts.issuer, opts.clientId, opts.clientSecret))
              .serverMetadata().authorization_endpoint!;
      const u = new URL(base);
      u.searchParams.set("client_id", opts.clientId);
      u.searchParams.set("redirect_uri", redirectUri);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("scope", scope);
      u.searchParams.set("state", state);
      u.searchParams.set("nonce", nonce);
      u.searchParams.set("code_challenge", codeChallenge);
      u.searchParams.set("code_challenge_method", "S256");
      return u.toString();
    },
    async exchange({ code, redirectUri, codeVerifier, nonce }): Promise<IdentityResult> {
      const config = await discover(opts.issuer, opts.clientId, opts.clientSecret);
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set("code", code);
      const checks: client.AuthorizationCodeGrantChecks = {
        idTokenExpected: true,
      };
      if (codeVerifier) checks.pkceCodeVerifier = codeVerifier;
      if (nonce) checks.expectedNonce = nonce;
      const tokens = await client.authorizationCodeGrant(
        config,
        callbackUrl,
        checks,
      );
      const claims = tokens.claims();
      if (!claims?.sub) throw new Error("oidc id_token missing subject");
      return {
        subject: String(claims.sub),
        email: typeof claims.email === "string" ? claims.email : null,
        // an IdP that omits the claim is treated as unverified → invite-only
        emailVerified: claims.email_verified === true,
        name: typeof claims.name === "string" ? claims.name : null,
        avatarUrl: typeof claims.picture === "string" ? claims.picture : null,
        hd: typeof claims.hd === "string" ? claims.hd : null,
      };
    },
  };
}

export function googleProvider(opts: {
  key: string;
  label: string;
  clientId: string;
  clientSecret: string;
  source: "env" | "db";
}): OAuthProvider {
  return oidcProvider({
    ...opts,
    type: "google",
    issuer: "https://accounts.google.com",
    scopes: ["openid", "email", "profile"],
  });
}
