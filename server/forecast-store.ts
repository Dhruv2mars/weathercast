import type { NowcastEnvelope } from './archive';
import type { ArchivedRadarFrame } from './study-issuance';

export type ForecastIssueInput = {
  envelope: NowcastEnvelope;
  cell: string;
  latitude: number;
  longitude: number;
  provider: string;
  upstreamRunId?: string;
};

export interface ForecastStore {
  isReady(): boolean | Promise<boolean>;
  findFresh(cell: string, now: Date): NowcastEnvelope | null | Promise<NowcastEnvelope | null>;
  save(input: ForecastIssueInput): NowcastEnvelope | Promise<NowcastEnvelope>;
  listRadarFrames(
    domain: string,
    product: string,
    limit?: number,
  ): ArchivedRadarFrame[] | Promise<ArchivedRadarFrame[]>;
  countRecentVerifiedObservationStations(
    source: string,
    since: string,
    through: string,
  ): number | Promise<number>;
  close(): void | Promise<void>;
}
