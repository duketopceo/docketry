# Releasing the npm packages

`@tallyline/mcp-server` and `@tallyline/cli` publish from
`.github/workflows/publish.yml` when a `v*` tag is pushed, with npm provenance.

One-time owner steps (not done by the repo):

1. Create the `tallyline` npm org/scope (or claim the scope with a user) and
   confirm `@tallyline/mcp-server` and `@tallyline/cli` are free.
2. Preferred: after the first publish, configure each package's npm
   "Trusted Publisher" (GitHub repo `duketopceo/tallyline`, workflow
   `publish.yml`, environment `npm`). The first publish of a new package needs a token.
3. First publish: create a granular automation token limited to the
   `@tallyline` scope, store it as the `NPM_TOKEN` secret of a GitHub
   environment named `npm` (add required reviewers), then delete it once trusted
   publishing works.
4. Bump `version` in both `package.json` files plus `VERSION` in
   `tools/cli/src/cli.ts` and `SERVER_INFO` in `apps/mcp-server/src/server.ts`,
   merge, then `git tag vX.Y.Z && git push origin vX.Y.Z`. The workflow fails if
   the tag and package versions differ.

Check after release: `npm view @tallyline/mcp-server dist.attestations.url` and
`npx -y @tallyline/mcp-server --help`.
