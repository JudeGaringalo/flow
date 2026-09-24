# FLOW verification

The local checks (`npm run typecheck`, `npm test`, `npm run build`) verify the
client and API code but do not execute SQL against a live Supabase project.

1. Check the hosted database using the table query in
   [live setup](LIVE_SETUP.md). Confirm `public` contains only `flow_nodes` among
   FLOW tables, with existing node coordinates, last readings and device-token
   hashes preserved. Removing local SQL files does not change the database.
2. As an anonymous visitor, read the public observation columns. Attempt to
   select `token_hash` and `last_message_id`; permission should be denied.
3. Register a dedicated test sensor from a private terminal. An omitted or wrong
   installer secret must be rejected. Store the returned device token privately.
4. An invalid device token must be refused. A valid three-boolean report must
   update the one row and appear on another browser's map. A repeated latest
   `message_id` must not update `last_seen`. An impossible combination must show
   a sensor fault.
5. Stop sending for more than two minutes; the map must show unavailable.
   Disconnect a browser and confirm it cannot claim a current reading.
6. Verify phone install, narrow-screen map controls and accessible location details.

Do not test by inventing readings for a real monitored location. FLOW does not
measure road passability or promise emergency-grade delivery.
