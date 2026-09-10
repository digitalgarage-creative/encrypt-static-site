# Encrypt Static Site

A portable **Codex + Claude Code skill** that builds a static website, encrypts
its files, and generates a password-unlock application for static hosting.
The reusable skill lives in [`skills/encrypt-static-site`](skills/encrypt-static-site).
It includes an executable encryption engine, browser runtime, project-inspection
helper and framework/hosting guidance.

**Status: initial tested implementation, not independently security-audited.**
Suitable for evaluating internal previews and semi-private static sites. It uses
Argon2id and AES-GCM envelope encryption; the public folder contains no original
site files in plaintext. It needs HTTPS or localhost and a browser supporting
module Service Workers, Web Crypto and WebAssembly.

## Install for your team

Nontechnical teammates can paste this into Codex or Claude Code:

> Install the encrypt-static-site skill from https://github.com/digitalgarage-creative/encrypt-static-site for me.

This repository is public. Teammates do not need a GitHub account to download or
install the skill. The agent can clone the public HTTPS URL without GitHub login
or download the repository ZIP. Codex or Claude Code must already be available
on their computer.
The agent can carry out the installation below. Team maintainers can also preinstall
it in the shared project. Everyday users do not need to run terminal commands.

The following commands are for the agent or team maintainer.

Requires Node.js 22+ and npm. Clone this repository from the GitHub URL your team
chooses, then run the installer from the clone:

```bash
node scripts/install.mjs --target both --scope user
```

Use `--target codex` or `--target claude` to install for only one agent. The installer
copies the self-contained skill and installs its locked encryption and HTML parser dependencies.
It does not overwrite existing skills. For an update, move the previous
`encrypt-static-site` directory aside, install the new version, and keep the old
copy until verified. Pin a reviewed repository commit/tag for team rollouts.

For a skill checked into a particular project instead:

```bash
node scripts/install.mjs --target both --scope project --project /absolute/team-project
```

| Agent | Personal install | Project install | Invocation |
| --- | --- | --- | --- |
| Codex | `~/.agents/skills/encrypt-static-site/` | `.agents/skills/encrypt-static-site/` | `$encrypt-static-site` |
| Claude Code | `~/.claude/skills/encrypt-static-site/` | `.claude/skills/encrypt-static-site/` | `/encrypt-static-site` |

Open a new session after installation. The standard `SKILL.md` contains the shared
instructions; `agents/openai.yaml` adds optional Codex display metadata. Installation
paths follow [Codex skill documentation](https://learn.chatgpt.com/docs/build-skills)
and [Claude Code skill documentation](https://code.claude.com/docs/en/skills).

If checking project installs into Git, include the skill's scripts, assets,
references, package.json and lockfile, but ignore `node_modules/`. The agent or maintainer runs
`npm ci --ignore-scripts --omit=dev` inside each installed skill directory.

## Use it

With the project open, type in Claude Code:

```text
/encrypt-static-site your-chosen-password
```

Or in Codex:

```text
$encrypt-static-site your-chosen-password
```

Replace `your-chosen-password` with your own unique password. A long, randomly chosen
passphrase is recommended; spaces are allowed. The agent uses that exact password to protect the
current project. If you leave it out, the agent asks for it in the conversation.
You can also ask in plain language: “Encrypt this site using the password … and
prepare it for GitHub Pages.”

The agent handles inspecting the project, installing missing runtime dependencies,
building, encrypting and verifying the output. Users do not need to open a terminal,
create a password file, or choose technical settings. If the project cannot work
as a static site, the agent explains why before making changes that lose behavior.

A password entered in chat remains in conversation history and may also appear in
agent tool records. Use a unique password for this site. It is not included in the
public deployment. The agent does not repeat it in the completion message.

### Optional manual CLI use

The following is for developers who prefer to run commands themselves, including
those who prefer not to give their password to the agent.

For direct CLI use from this repository:

```bash
npm ci --ignore-scripts --omit=dev --prefix skills/encrypt-static-site
node skills/encrypt-static-site/scripts/inspect.mjs /absolute/web-project

# Run in your own terminal. Password entry is hidden and sent through stdin.
python3 skills/encrypt-static-site/scripts/password-pipe.py protect \
  --input /absolute/web-project/dist \
  --output /absolute/web-project/encrypted --base /team-preview/
```

Build the app for the same base path first. Add `--spa` only for history-based
single-page routers. The input must be clean browser output; the output must be a
new directory separate from the static input, whose parent already exists.
The normal destination is `<your-project>/encrypted/`; an output folder you specify
is honored exactly. For standalone HTML projects, the agent stages input elsewhere
so the encrypted result can still live inside your project. Repeat runs preserve
that destination, verifying a replacement before swapping a generated deployment. Python 3 is only needed
for the hidden prompt helper; Node also accepts `--password-file` or
`--password-stdin`. Password files need owner-only permissions on Unix (`chmod 600`).

The encryption command performs cryptographic, prepared-package and public-file checks. Every packaged HTML page
receives a `noindex, nofollow, noarchive, nosnippet, noimageindex` robots meta tag,
visible in its source after unlocking. Original files remain unchanged; other
assets are packaged byte for byte.
The agent must also test the actual project's encrypted output in a browser before
calling that project deployment-ready. Upload **only the generated folder**.
See [hosting and verification](skills/encrypt-static-site/references/deployment.md).

## Compatibility and limits

The common engine accepts standalone HTML, already-built sites, Vite/React output,
Create React App output and statically exported Next.js output. Other frameworks
work when they produce equivalent static files; each real app still needs testing.
The adapter is agent-guided, supported by a read-only inspector. It does not
silently rewrite a backend into a static application.

Automated fixtures cover HTML and real **Vite 8.2.2 / React 19.3.0** and
**Next.js 16.3.4 App Router** production builds. Chromium checks include modules,
dynamic chunks, CSS/assets, local JSON, state updates, nested navigation, project
subpaths, refresh and lock behavior. This is fixture coverage, not a promise that
every app or browser works. CRA and other framework outputs have not been tested
as separate framework builds. See [`tests/`](tests/) for reproducible checks.

- The runtime keeps decrypted files in Service Worker memory and writes no
  plaintext/key cache. Browser worker shutdown requires unlocking again; an open
  page may need a reload when a later asset request fails. There is no offline mode.
- Unlocking is shared across tabs within the worker scope and browser profile.
  Open `/_sealed/index.html` (under your configured base) to lock all site tabs.
- Server Actions, request-dependent rendering, runtime APIs and existing PWA
  Service Workers need architectural review. Server Components that run at build
  time are compatible with a successful static export.
- A strong passphrase matters: the public ciphertext permits offline guessing.
  Password holders can copy the content. A compromised host can replace the unlock
  script and steal future passwords. Use a dedicated trusted origin and HTTPS.
- Initial limits: 64 MiB of static files and 20,000 files. Mobile memory/performance
  needs project-specific testing. In-place password rotation is not implemented;
  rebuild into a fresh folder with a new password.

Read the [security model](skills/encrypt-static-site/references/security.md) for
details. Noindex directives discourage compliant search engines; they do not make
the URL secret or prevent caching of ciphertext.

## Develop and validate

```bash
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix skills/encrypt-static-site
npx playwright install chromium
npm test
npm run test:browser
npm run test:frameworks
```

The browser tests use an isolated profile and temporary localhost servers. To use
an installed Chrome binary, set `CHROME_PATH` to its executable path. Test fixtures
contain synthetic content and a public **test-only** passphrase; never reuse it.
Development dependencies are only for testing and are not copied into the skill.
GitHub Actions runs these checks on changes.

## Team repository

The shared repository is [digitalgarage-creative/encrypt-static-site](https://github.com/digitalgarage-creative/encrypt-static-site).
Installation copies the skill locally; publishing a change here does not update
teammates' installed copies automatically. A teammate can ask their agent to update
this skill from the repository, keeping a backup until the update is verified.

Keep this reusable skill repository separate from protected project source and
from a site's publishing repository. Never commit site passwords, private site
files, plaintext build outputs, or `node_modules/` here.

## License

MIT. The runtime uses [hash-wasm](https://github.com/Daninet/hash-wasm), also MIT;
its license is copied into every generated deployment.
