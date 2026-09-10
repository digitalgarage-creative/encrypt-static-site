# Project adapters

The final output is fixed at `<opened-project>/encrypted/`. Do not ask the user
to choose or confirm a destination. The engine's static input directory is not necessarily the project root:
for standalone HTML, stage source assets in a temporary directory, then encrypt to
that fixed output inside the opened project. Never solve overlap by relocating the user's
deliverable. Exclude earlier generated deployments from the staged input.

The agent is the adapter layer; `inspect.mjs` supplies hints. The encryption engine
accepts a static directory and never executes a project build or edits its config.
Inspect scripts before running them and preserve the project's lockfile/package
manager. A successful build proves exportability, not functional equivalence.

| Input | Adapter action | Usual static output |
| --- | --- | --- |
| Already-built site | Check `index.html`, assets and path base | Supplied directory |
| Plain HTML/CSS/JS | Use a clean asset-only directory; stage required files if mixed with development files | Dedicated staging directory |
| Vite/React | Run existing build; check Vite `base` and router basename | `dist/` |
| Create React App | Run existing build; check `homepage`/`PUBLIC_URL` and router basename | `build/` |
| Next.js | Inspect config, use `output: 'export'`, then existing build | `out/` |
| Other framework | Confirm documented static adapter and run existing build | Framework-specific |

For a new Next.js export, propose only configuration changes whose effect is
understood. Typical settings include `output: 'export'`, `basePath: '/repository'`
for project hosting, and an export-compatible image loader or `images.unoptimized`.
Changing image handling has a performance cost. Follow the app's existing
trailing-slash choice; both `about.html` and `about/index.html` are resolved.
Do not add a base path without checking hard-coded `/assets/...` and fetch URLs.
Do not infer that a generated directory is current merely because it exists.

Review request-dependent handlers, middleware/proxy, cookies/headers, dynamic
rendering, `getServerSideProps`, Server Actions, runtime image optimization and
paths lacking static parameters. A Server Component can run at build time; a
static GET handler can export data. Do not reject every server-labeled file.
Database queries that run only during build can produce static content, but the
build environment and selected exported data still need review. Runtime database
access and private APIs require a separately designed backend.

Example blocker explanation:

> `app/api/report/route.ts` computes a report when a visitor requests it. This
> needs a running server, while the protected deployment contains only static
> files. Keep that feature on a separate backend or redesign it before exporting;
> removing the route would change the app's behavior.

The inspector scans source patterns and reports filenames/lines without printing
matched secrets. Conditional code and minified output can evade it or cause false
positives. The engine also refuses likely private-key/token material, source maps,
dependency/config files and recognizable Service Worker registration calls. Review
the source in addition to these checks. Remove source maps from the selected static
output or disable their emission; do not delete the developer's originals.

External resources stay external. Inventory third-party scripts, analytics,
fonts/CDNs and APIs; they can observe a user's visit or read data after unlock.
Self-host suitable dependencies inside the encrypted input when authorized and
licensing permits. Do not silently disable integrations or claim they are encrypted.

Reference: [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports).
