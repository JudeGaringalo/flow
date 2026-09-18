# Update the existing FLOW project without Deno

This patch is based on the previously supplied `FLOW_NextJS_Live_Only.zip`.
It cannot know about your newer local/GitHub changes. Back up or commit first.
No cloud database, function deployment or account was changed by preparing this ZIP.

## 1. Stop the dev server and copy files

Press Ctrl+C. Copy the contents of the patch's `files/` folder into your project root
(the folder with package.json). Merge your own edits when a listed file overlaps.
The patch does not include .env.local, .git, package-lock.json or node_modules.
It also does not replace package.json or your VS Code settings.

The preserved UI has not been redesigned. `components/flow/dialogs.tsx` only changes
two explanatory strings from the old backend wording to Next.js. Merge those two
strings manually when you have changed the component locally.

## 2. Add the Node.js packages

In PowerShell, in the project root:

```powershell
npm install web-push@3.6.7 server-only@0.0.1
npm install --save-dev @types/web-push@^3.6.0
```

Keep your existing Next.js/React dependencies and lockfile; npm updates the lockfile.
Do not reinstall Deno or add browser-side secret keys.

## 3. Remove the obsolete source/configuration

Only after the new files have been copied:

```powershell
Remove-Item -Recurse -Force supabase/functions -ErrorAction SilentlyContinue
Remove-Item supabase/config.toml -ErrorAction SilentlyContinue
```

Those paths in the supplied project contained only the old function implementation
and function deployment settings. Preserve unrelated additions before deleting.
The old `supabase/.env.example` is also obsolete; server configuration is now shown
in the root `.env.example`. Do not delete any real `.env.local` file with credentials.

Keep `supabase/migrations/` and `supabase/schedule-push.sql`: they are database SQL,
not Deno. Keep the existing Next.js UI source, public assets and service worker.

In `.vscode/settings.json`, remove `deno.enablePaths` and any Deno-specific executable
path settings. If that file only contains the Deno setup, delete the file. To override
a globally enabled Deno extension for this project, set `"deno.enable": false` and
`"deno.enablePaths": []` instead. Preserve any unrelated editor settings.
You may disable/uninstall the Deno extension if no other project needs it. The installed
Deno executable can stay on your computer; this project no longer runs or checks it.

## 4. Add private server environment variables

Preserve your existing public Supabase URL/key in `.env.local`. Add:

```env
SUPABASE_SECRET_KEY=YOUR_PRIVATE_SUPABASE_SERVER_KEY
```

This is **not** the public publishable key. Do not paste real secrets into chat or Git.
For AI/push, copy the corresponding private variable values from your previous function
configuration into `.env.local` and Vercel. See the root `.env.example` and LIVE_SETUP.md.
Supabase secrets are not automatically inherited by your Vercel application.

## 5. Apply the additional SQL before using registration/push

In Supabase SQL Editor:

- Already using the supplied `flow_*` schema: run **only** `002_node_api.sql`.
- New database: run `001_flow.sql` once, then `002_node_api.sql`.

Do not rerun the original CREATE TABLE migration on an existing database.
Migration 002 adds transactional helper functions. It does not drop/reset records.
The map remains empty when no actual nodes are registered.

## 6. Check and restart

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run typecheck
node scripts/test-node-api.mjs
npm run build
npm run dev
```

If typecheck/build reports an error, resolve it before deployment. The full dependency
build could not be run in the delivery environment; isolated tests are not a substitute.

## 7. Update the actual integrations

Browser callers are already changed to `/api/register-node`, `/api/manage-push` and
`/api/flow-intelligence`. Hardware must now send to:

```text
https://YOUR-FLOW-SITE.vercel.app/api/ingest-reading
```

Keep the same per-device token and JSON contract. The firmware change is not performed
by copying web files. For queue retries, follow the Vault/SQL steps in LIVE_SETUP.md,
using `flow_app_origin` and the new Next.js dispatch URL.

Deploy on Vercel with the server variables configured. Test the full sensor -> database
-> map -> AI/push flow. After cutover succeeds, disable/delete old deployed Edge Functions
through your Supabase deployment workflow; local deletion alone does not remove them.

## Migration files

The patch includes a `CHANGED_FILES.txt` manifest and `DELETED_FILES.txt` list.
No fake readings or location records are added by any migration command.
