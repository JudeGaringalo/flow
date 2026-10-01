
export interface MappedEvacuationSite {
  id: string;
  name: string;
  city: string;
  latitude: number;
  longitude: number;
}

export interface EvacuationSiteResponse {
  sites: MappedEvacuationSite[];
  retrievedAt: string;
}
