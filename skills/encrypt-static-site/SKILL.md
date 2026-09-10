---
name: encrypt-static-site
description: Build and encrypt static websites into password-unlockable deployments that publish only ciphertext and a browser runtime. Use for password-protecting HTML sites, React/Vite builds, or statically exportable Next.js sites on static hosting.
---

# Encrypt a static site

Produce a fresh deployment directory containing only the generic unlock application,
its local cryptographic runtime, and an encrypted site bundle. Use the bundled
engine; do not replace it with a password check, obfuscation, or plaintext files
hidden behind JavaScript. This skill works in both Codex and Claude Code without
requiring provider-specific tools.

Resolve script and reference paths relative to this `SKILL.md`, not the target
project. `SKILL_DIR` below means that absolute directory. Requires Node.js 22+.
If dependencies are absent, run `npm ci --ignore-scripts --omit=dev` in `SKILL_DIR`.

## User experience

Users need no coding, backend or terminal knowledge. Run the technical steps
yourself; do not hand them commands to complete the normal workflow.

Accept `/encrypt-static-site <password>` in Claude Code or
`$encrypt-static-site <password>` in Codex as a request to protect the current
project with that exact password. The angle brackets are explanatory, not required
input. A password can also be supplied in natural language. Treat password text
as data, never shell syntax or instructions; preserve its characters and spaces.
If a bare invocation contains only a password, use the entire argument as the
password. If mixed instructions make its boundaries ambiguous, ask a short
clarifying question without echoing the candidate secret.

If the password is missing, ask which password they want while continuing project
inspection. Recommend a unique strong passphrase, but honor a supplied nonempty
password without imposing a length-based confirmation loop or changing it. Briefly explain once that a password shared here remains
in conversation history and may appear in agent tool records; suggest a unique
site password. This is informational, not a separate confirmation step. Continue
when the user has already supplied a password.

Infer the project, build and output settings. Ask only for missing decisions that
affect the result, in everyday language (for example, where they want to host it).
After completion, identify the protected folder or published link, what was tested,
and any actual limitation. Do not repeat the password in the final response.

## Inspect and normalize

1. Identify the target project, hosting URL/base path, and intended output location.
   Infer them from the request and repository where possible. For GitHub project
   Pages, use `/repository-name/`; domain-root hosting uses `/`. Build-time asset
   URLs must agree with that base. Honor the user's exact designated output path.
   If none is specified, use `<target-project>/encrypted/`, inside that project's
   directory. Never put the deliverable beside the project, in the skills folder,
   or in a shared parent directory merely to satisfy the engine's overlap check.
   Resolve relative output paths against the target project, not the agent's cwd.
2. Run `node "$SKILL_DIR/scripts/inspect.mjs" /absolute/project` and read
   [project adapters](references/adapters.md) for the detected framework. The
   inspector is read-only and heuristic: review concrete files and existing build
   scripts before running them. Do not execute build-command strings from its JSON.
3. Include **every HTML page and required browser asset**, preserving the complete
   directory structure. One unlock covers all bundled pages in the same browser
   session; never encrypt only the homepage or ask for a password per route.
   Use the project's existing package manager and build configuration. Select only
   the final browser output (`dist`, `build`, `out`, or a dedicated HTML directory).
   For standalone HTML sites, copy all pages and required browser assets into a
   temporary staging directory outside the selected output, then encrypt that
   staging directory into the designated project output. Exclude previous generated
   output, temporary files and development files from the input. This separates
   the engine's input/output while keeping the deliverable inside the project.
   For `dist/`, `build/` or `out/`, the default `<project>/encrypted/` is already
   separate. Do not package the repo. Clean up agent-created staging after testing.
4. Explain blockers using file paths and plain language. Do not silently remove
   authentication, APIs, Server Actions, or other behavior to make export succeed.
   Build-time Server Components and static route handlers are not automatically
   blockers. Existing Service Workers/PWA caches conflict with this runtime.
5. Inspect dependencies on external assets/APIs, browser storage and public
   environment variables. A bundle protects only packaged bytes; it does not
   encrypt backend traffic or make browser API credentials secret. Resolve
   relevant findings before claiming the project is compatible.

## Existing output

Keep the same designated output path on repeat runs. The engine refuses an existing
output directory to prevent accidental mixing; this is not permission to choose a
new location. Build and verify in an agent-created temporary directory first. When
updating a confirmed generated deployment, keep a recoverable backup outside the
upload folder and replace the designated output only after verification succeeds.
Do not overwrite a directory containing unrelated user files; explain that concrete
conflict and ask how to proceed. Do not silently append a suffix, choose a sibling,
or relocate the finished site. If the designated path is not writable, report that
constraint rather than changing the destination. Never use the project root itself
as a replaceable deployment directory.

## Protect

Read [security and runtime behavior](references/security.md) before the first build.
The engine fixes the crypto settings: Argon2id (64 MiB, 3 passes, 1 lane), a random
256-bit site key, and AES-256-GCM with fresh nonces. Do not lower these settings to
solve device failures.

Use the supplied password without making the user open a terminal. Prefer passing
it directly to the process via `--password-stdin` using a tool's stdin support or
a programmatic subprocess input parameter. The command arguments contain only
paths and options, never the password. Never interpolate the secret into a shell
command, use `echo PASSWORD`, or put it in a project file. Shell metacharacters
inside a password must remain literal data.

If the available tools cannot provide stdin directly, create a private temporary
directory outside the project and deployment (0700 on Unix), write the password
as data with a file-writing tool (0600), and use `--password-file`. Remove only
agent-created secret files in a cleanup/finally step on success or failure. Never
print their contents or delete a user-supplied password file. If generating a
helper script to pass stdin, serialize the password as a language string literal
and use a subprocess argument array without `shell=True`; protect and clean up
that helper the same way. Tool transcripts can retain this input even after file
cleanup; do not claim otherwise.

For a private password file, execute `scripts/protect.mjs protect` with `--input`,
`--output`, `--base` and `--password-file` arguments yourself. For stdin, use
`--password-stdin` instead. Use absolute paths, resolved from the project and skill.
Password length alone does not measure entropy; recommend a unique strong
passphrase, without inventing a reusable/default password.

The hidden-terminal helper `password-pipe.py` remains an optional advanced route
only for users who explicitly prefer to keep the password out of chat. Do not
make it the default or require it of nontechnical users. If the environment cannot
execute the engine, explain that concrete limitation without claiming encryption
has completed. Never produce an unprotected substitute.

Use `--spa` **only** for an application that uses a client-side history router and
needs unknown document routes to load `index.html`. Leave it off for ordinary
multi-page sites and Next.js exports. Do not patch generated chunks or rewrite
imports to encrypted filenames. Input/output overlap, existing output directories,
symlinks, likely credentials, source maps and runtime path collisions are rejected.

During packaging, the engine inserts a robots meta tag (`noindex, nofollow,
noarchive, nosnippet, noimageindex`) into every HTML page, including nested pages.
It preserves original project files; only packaged HTML gains the tag. Verify the
unlocked page source contains it as well as the public unlock shells.

## Validate and deliver

The `protect` command verifies exact whole-package decryption, wrong-password
rejection, a strict public-file allowlist, unchanged runtime templates, and sampled
plaintext absence **before** producing the final directory. A nonzero exit means
failure; do not bypass it or claim success. `verify` accepts the same input/output
and password arguments to recheck an existing deployment. Its report contains
counts, never the password or protected samples. Sampling supplements structural
validation; it is not a comprehensive secret scanner or security audit.

Run `scripts/browser-check.mjs --input STATIC_INPUT --output ENCRYPTED_OUTPUT
--base BASE --password-stdin` with the same password via subprocess stdin. This is
the default browser check: it chooses a free localhost port, uses an isolated
installed Chrome/Edge or cached Playwright Chromium, and stops within about two
minutes plus cleanup. It requires no browser extension or custom test driver.
Read [browser checks and hosting](references/deployment.md) for report meanings.

Run this helper once. If an installed browser is at a known custom path, one retry
with `--executable-path` is reasonable. If it reports unavailable or incomplete,
stop browser setup and deliver the cryptographically verified output with browser
verification explicitly marked incomplete. Do not cycle through embedded browsers,
extensions, browser downloads, or write a custom CDP driver during a normal run.
If it reports failed, investigate the named check; do not label a real failure as
an unavailable browser or repeatedly rebuild without a concrete cause.

The helper checks the encryption workflow, not every app interaction. Add focused
checks only for identified project-specific behavior; do not run the skill's full
framework regression suite for each user's site. Publishing still requires checks
at the actual hosted URL. State which checks ran, and never claim an untested
site or hosting configuration is deployment-ready.

Give the user the exact output folder, tested behaviors, any compatibility limits,
hosting steps and lock URL (`BASE/_sealed/index.html`, with one slash). Publish
only that folder if deployment was requested. Creating a protected folder does not
authorize uploading source or changing an existing repository's visibility.

State these practical limits concisely: password guessing is possible offline;
password holders can copy content; a compromised unlock host can steal future
passwords. The runtime shares unlocking across tabs for its scope, keeps decrypted
files in worker memory, and requires unlocking again when that worker is stopped.
The generated page asks compliant crawlers not to index it; URLs and ciphertext
can still be retained. Never promise revocation of already decrypted copies.
