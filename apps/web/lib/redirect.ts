import { NextResponse } from "next/server";

// Relative-Location redirect — never build redirect targets from req.url.
// Behind a reverse proxy or tunnel the request Host can be the upstream
// name (e.g. localhost:3100), which would leak into absolute redirects and
// send the browser to an unreachable origin. A relative Location resolves
// against whatever origin the browser actually requested.
export function redirectTo(path: string, status = 307): NextResponse {
  const res = new NextResponse(null, { status });
  res.headers.set("location", path);
  return res;
}
