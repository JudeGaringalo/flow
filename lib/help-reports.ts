export const HELP_REPORT_HOURS = 6;
export const HELP_REPORT_FIELDS = 'id,name,message,latitude,longitude,accuracy,located_at,updated_at,expires_at';

export interface HelpReport {
  id: string;
  name: string;
  message: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  located_at: string;
  updated_at: string;
  expires_at: string;
}

export interface HelpLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  located_at: string;
}

export interface HelpDraft extends HelpLocation {
  name: string;
  message: string;
  consent: boolean;
}

export function validHelpLocation(value: HelpLocation): boolean {
  return Number.isFinite(value.latitude) && value.latitude >= 4 && value.latitude <= 22
    && Number.isFinite(value.longitude) && value.longitude >= 112 && value.longitude <= 128
    && Number.isFinite(value.accuracy) && value.accuracy >= 0 && value.accuracy <= 50000;
}

export function parseHelpReport(value: unknown): HelpReport | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as HelpReport;
  if (typeof row.id !== 'string' || !/^[a-f0-9]{64}$/.test(row.id)
      || typeof row.name !== 'string' || row.name.length > 60
      || typeof row.message !== 'string' || row.message.length > 280
      || !validHelpLocation(row)
      || ![row.located_at, row.updated_at, row.expires_at].every(date =>
        typeof date === 'string' && Number.isFinite(Date.parse(date)))) return null;
  return {
    id: row.id, name: row.name, message: row.message,
    latitude: row.latitude, longitude: row.longitude, accuracy: row.accuracy,
    located_at: row.located_at, updated_at: row.updated_at, expires_at: row.expires_at,
  };
}

export function helpReportTime(value: string): string {
  return new Date(value).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'Asia/Manila',
  }) + ' PHT';
}
