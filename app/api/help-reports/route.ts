import { HELP_REPORT_FIELDS, HELP_REPORT_HOURS, validHelpLocation } from '@/lib/help-reports';
import { ApiError, checkOrigin, failure, getServerDb, hashToken, json, readJson } from '@/lib/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function reportId(req: Request): string {
  const token = req.headers.get('x-flow-report-token') || '';
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError(401, 'Your report could not be verified. Reopen Report / Request help.');
  return hashToken(token);
}

function reportText(value: unknown, max: number, field: string): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    throw new ApiError(400, `${field} must be text with at most ${max} characters.`);
  return value.trim();
}

function databaseError(error: { code?: string }): never {
  if (error.code === '42P01' || error.code === 'PGRST205')
    throw new ApiError(503, 'Help reporting is not available yet. Please try again later.');
  throw error;
}

export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const id = reportId(req);
    const body = await readJson(req, 4096);
    if (body.consent !== true) throw new ApiError(400, 'Confirm that your location and report will be public.');
    const name = reportText(body.name, 60, 'Name');
    const message = reportText(body.message, 280, 'Message');
    const { latitude, longitude, accuracy, located_at } = body;
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || typeof accuracy !== 'number'
        || typeof located_at !== 'string' || !validHelpLocation({ latitude, longitude, accuracy, located_at }))
      throw new ApiError(400, 'A location inside the Philippines map area is required.');
    const now = Date.now();
    const measured = Date.parse(located_at);
    if (!Number.isFinite(measured) || measured < now - 300000 || measured > now + 60000)
      throw new ApiError(400, 'Your location is out of date. Use Find my location again.');
    const { data, error } = await getServerDb().from('flow_help_reports').upsert({
      id, name, message, latitude, longitude, accuracy,
      located_at: new Date(measured).toISOString(),
      updated_at: new Date(now).toISOString(),
      expires_at: new Date(now + HELP_REPORT_HOURS * 3600000).toISOString(),
    }, { onConflict: 'id' }).select(HELP_REPORT_FIELDS).single();
    if (error) databaseError(error);
    return json({ report: data });
  } catch (error) { return failure(error); }
}

export async function DELETE(req: Request) {
  try {
    checkOrigin(req);
    const id = reportId(req);
    const { error } = await getServerDb().from('flow_help_reports').delete().eq('id', id);
    if (error) databaseError(error);
    return json({ removed: true, id });
  } catch (error) { return failure(error); }
}
