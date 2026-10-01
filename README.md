# FLOW

FLOW is a Next.js public map of current readings from registered monitoring devices and recorded evacuation site candidates. The map opens in Metro Manila. Site listings may be incomplete or outdated; confirm availability with the local disaster office.

## Start

```sh
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and enter your own project values. Never commit `.env.local`. The hosted Supabase database must already contain `public.flow_nodes`, `public.flow_evacuation_sites`, and the server functions used by the device routes.

Deploy this version before applying `remove-evacuation-source-urls.sql` to an existing database. That SQL removes only the evacuation site source URL column; it keeps the site records. The map no longer displays a per-site source link. Map and dataset attribution remains where required.

Run `npm run check` before deployment. Test sensor reporting and the hosted database separately.

The interface icon paths are adapted from Lucide (ISC license).
