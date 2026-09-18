# QA — Node.js backend migration

## Executed in this delivery

- 32 deterministic domain tests (probe patterns, stale data, fault classification, safe
  normalization, alert escalation and CSV safety).
- 14 live-only source/config regression checks (no seeds, demo timestamps, fabricated
  charts or illustrations).
- 40 isolated backend/API checks. These execute the TypeScript handlers/helpers after
  transpilation with mocked Supabase/Next lifecycle/Web Push and fetch dependencies.
  Coverage includes authorization, input validation, SSRF prevention, private keys,
  registration, subscription ownership, ingestion, AI fallback/version changes, queue
  dispatch/skips/retries/expiry and the same-origin API caller.
- 27 TS/TSX source files passed syntax checking.
- The supplied UI/CSS/assets were compared against the previous live-only project:
  styling, geometry, assets, map/detail components and hooks are unchanged. Only two
  informational sentences in dialogs describe the relocated backend.

Test input fixtures exist only in test code and are never seeded in the running app
or database. No browser, cloud or sensor is falsely reported as connected.

## Not verified here

The npm registry was unreachable. The full dependency-aware `tsc`/Next.js build,
Vercel deploy, migrations on a real Supabase project, live Realtime, ESP32 networking,
real Gemini API calls and actual encrypted Web Push/browser delivery were not run.
The package has no fabricated lockfile and no test stubs in application source.
The isolated harness does not prove real SDK compatibility or deployment success.

## Run locally before deployment

```sh
npm install
npm run check
```

For the patch, which deliberately preserves your package.json scripts:

```sh
npm run typecheck
npm test
node scripts/test-node-api.mjs
npm run build
```

## Live acceptance checklist

1. Without Supabase variables, the map loads with no sensor connection/markers.
2. With an empty configured database, the map says no registered nodes.
3. Anonymous reads cannot write observations or inspect credentials/push endpoints.
4. Unauthenticated or non-installer registration is refused.
5. Register an actual node: it has no current reading until ingestion.
6. POST a real-device packet to Next.js using that node's token; only that ID is updated.
7. Duplicate message ID does not append duplicate history or generate another event.
8. Test dry -> L1 -> L2 -> L3; invalid combinations show a fault, not a valid level.
9. Heartbeats update freshness; stale states become unavailable in the UI.
10. Browser Realtime re-fetches authorized data; it never trusts a broadcast payload as
    the sensor observation itself.
11. AI reads approved evidence. Missing key/quota failure shows labeled fallback;
    a changed observation version suppresses the old summary.
12. Rotate a node token: old token fails; new token works.
13. Grant Web Push permission from an actual click, save a threshold preference and
    trigger a fresh upward event. Confirm an OS notification and its correct deep link.
14. Expired/unsubscribed endpoints are removed or skipped. Stale/superseded events
    never produce current flood alerts. Test a temporary provider failure and retry.
15. Confirm the retry job targets the production Next.js `/api/push-dispatch` URL.
    Inspect BOTH cron runs and HTTP response records; HTTP 200 is not phone delivery.
16. Test production deployment protection, public/private environment values and denied
    origin/auth requests. Inspect built client JS to ensure private keys are absent.
17. Verify your real Windows Node/npm environment, supported desktop/mobile browsers,
    iOS Home Screen permission flow and actual hardware power/wiring independently.

## Limitations that remain

Prototype only, not an official warning or road-passability system. No continuous
water depth/rainfall feed, forecast, guaranteed delivery, offline historical replay,
city-scale pagination, account transfer or tamper-proof hardware. A 3.3 V probe signal
does not validate electrical safety or deployment reliability. Integrations need a
real end-to-end test before a competition demonstration or public launch.
