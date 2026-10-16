import { describe, expect, it } from "vitest";
import { redirectTo } from "./redirect";

describe("redirectTo", () => {
  it("emits a relative Location — never the upstream Host", () => {
    // behind a tunnel/proxy the request Host can be an internal name like
    // localhost:3100; absolute redirects built from req.url would strand
    // the browser there. relative Location resolves on the public origin.
    const res = redirectTo("/login?error=exchange");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/login?error=exchange");
  });

  it("honours non-default status codes", () => {
    const res = redirectTo("/login", 303);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
  });
});
