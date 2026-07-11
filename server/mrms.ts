import { gunzipSync } from 'node:zlib';
import type { PrecisionIngestionStore } from './precision-ingestion-store';

export type MrmsDomain = 'CONUS';
export type MrmsProduct = 'PrecipRate_00.00' | 'RadarQualityIndex_00.00';

export type MrmsObject = {
  key: string;
  observedAt: string;
  lastModified: string;
  size: number;
};

type FetchLike = typeof fetch;

const BUCKET_URL = 'https://noaa-mrms-pds.s3.amazonaws.com';

function xmlValue(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return match?.[1]
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

export function parseMrmsObservedAt(key: string) {
  const match = key.match(/_(\d{8})-(\d{6})\.grib2\.gz$/);
  if (!match) throw new Error('MRMS object key does not contain an observation timestamp.');
  const [, date, time] = match;
  const instant = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}.000Z`);
  if (Number.isNaN(instant.getTime())) throw new Error('MRMS object timestamp is invalid.');
  return instant.toISOString();
}

export function parseS3List(xml: string): MrmsObject[] {
  return [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((match) => {
    const key = xmlValue(match[1], 'Key');
    const lastModified = xmlValue(match[1], 'LastModified');
    const size = Number(xmlValue(match[1], 'Size'));
    if (!key || !lastModified || !Number.isFinite(size) || size < 0) throw new Error('S3 listing is malformed.');
    return { key, observedAt: parseMrmsObservedAt(key), lastModified, size };
  });
}

function dateStamp(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function timeStamp(date: Date) {
  return date.toISOString().slice(11, 19).replaceAll(':', '');
}

export function validateGribGzip(raw: Uint8Array) {
  if (raw[0] !== 0x1f || raw[1] !== 0x8b) throw new Error('MRMS object is not gzip data.');
  const grib = new Uint8Array(gunzipSync(raw, { maxOutputLength: 100_000_000 }));
  if (new TextDecoder().decode(grib.slice(0, 4)) !== 'GRIB') throw new Error('MRMS gzip payload is not GRIB data.');
  if (grib[7] !== 2) throw new Error('MRMS payload is not GRIB edition 2.');
  if (new TextDecoder().decode(grib.slice(-4)) !== '7777') throw new Error('MRMS GRIB payload is truncated.');
  return grib.byteLength;
}

export class MrmsAdapter {
  constructor(
    private readonly userAgent: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly bucketUrl = BUCKET_URL,
  ) {}

  async listRecent(domain: MrmsDomain, product: MrmsProduct, now: Date, lookbackMinutes: number, signal: AbortSignal) {
    const start = new Date(now.getTime() - lookbackMinutes * 60_000);
    const dates = [...new Set([dateStamp(start), dateStamp(now)])];
    const results: MrmsObject[] = [];
    for (const date of dates) {
      const prefix = `${domain}/${product}/${date}/`;
      const params = new URLSearchParams({
        'list-type': '2',
        prefix,
        'max-keys': '100',
      });
      if (date === dateStamp(start)) {
        params.set('start-after', `${prefix}MRMS_${product}_${date}-${timeStamp(start)}.grib2.gz`);
      }
      const response = await this.fetchImpl(`${this.bucketUrl}?${params}`, {
        headers: { Accept: 'application/xml', 'User-Agent': this.userAgent },
        signal,
      });
      if (!response.ok) throw new Error(`MRMS listing returned ${response.status}.`);
      results.push(...parseS3List(await response.text()));
    }
    const earliest = start.getTime();
    return results
      .filter((object) => object.key.endsWith('.grib2.gz') && new Date(object.observedAt).getTime() >= earliest)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  }

  async download(object: MrmsObject, signal: AbortSignal) {
    if (object.size > 10_000_000) throw new Error('MRMS object exceeds the configured size limit.');
    const response = await this.fetchImpl(`${this.bucketUrl}/${object.key}`, {
      headers: { Accept: 'application/octet-stream', 'User-Agent': this.userAgent },
      signal,
    });
    if (!response.ok) throw new Error(`MRMS download returned ${response.status}.`);
    const raw = new Uint8Array(await response.arrayBuffer());
    if (raw.byteLength > 10_000_000) throw new Error('MRMS response exceeds the configured size limit.');
    if (raw.byteLength !== object.size) throw new Error('MRMS response size does not match its immutable listing.');
    validateGribGzip(raw);
    return raw;
  }
}

export async function ingestMrmsFrames(input: {
  archive: Pick<PrecisionIngestionStore, 'archiveRadarFrame'>;
  adapter: MrmsAdapter;
  domain: MrmsDomain;
  product: MrmsProduct;
  now: Date;
  frameCount: number;
  signal: AbortSignal;
}) {
  const objects = await input.adapter.listRecent(input.domain, input.product, input.now, 45, input.signal);
  const selected = objects.slice(-input.frameCount);
  const retrievedAt = input.now.toISOString();
  for (const object of selected) {
    const raw = await input.adapter.download(object, input.signal);
    await input.archive.archiveRadarFrame({
      asset: {
        provider: 'noaa-mrms-nodd',
        upstreamKey: object.key,
        retrievedAt,
        mediaType: 'application/gzip',
        bytes: raw,
      },
      frame: {
        domain: input.domain,
        product: input.product,
        observedAt: object.observedAt,
        retrievedAt,
        objectKey: object.key,
      },
    });
  }
  return { discovered: objects.length, ingested: selected.length };
}
