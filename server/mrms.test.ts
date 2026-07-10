import { gzipSync } from 'node:zlib';
import { describe, expect, test } from 'bun:test';

import { ForecastArchive } from './archive';
import { ingestMrmsFrames, MrmsAdapter, parseMrmsObservedAt, parseS3List, validateGribGzip } from './mrms';

const key = 'CONUS/PrecipRate_00.00/20260710/MRMS_PrecipRate_00.00_20260710-152800.grib2.gz';
const gribGzip = new Uint8Array(gzipSync(Buffer.from([
  0x47, 0x52, 0x49, 0x42, 0x00, 0x00, 0xd1, 0x02,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x14,
  0x37, 0x37, 0x37, 0x37,
])));
const listing = `<?xml version="1.0"?><ListBucketResult><Contents><Key>${key}</Key><LastModified>2026-07-10T15:30:50.000Z</LastModified><Size>${gribGzip.byteLength}</Size></Contents></ListBucketResult>`;

describe('NOAA MRMS adapter', () => {
  test('parses official S3 listings and observation timestamps', () => {
    expect(parseMrmsObservedAt(key)).toBe('2026-07-10T15:28:00.000Z');
    expect(parseS3List(listing)).toEqual([{
      key,
      observedAt: '2026-07-10T15:28:00.000Z',
      lastModified: '2026-07-10T15:30:50.000Z',
      size: gribGzip.byteLength,
    }]);
  });

  test('rejects corrupt gzip and non-GRIB payloads', () => {
    expect(validateGribGzip(gribGzip)).toBe(20);
    expect(() => validateGribGzip(new Uint8Array([1, 2, 3]))).toThrow('not gzip');
    expect(() => validateGribGzip(new Uint8Array(gzipSync(Buffer.from('nope'))))).toThrow('not GRIB');
    expect(() => validateGribGzip(new Uint8Array(gzipSync(Buffer.from('GRIBfixture'))))).toThrow('edition 2');
  });

  test('archives validated raw frames and immutable metadata', async () => {
    const fetchImpl = (async (request: string | URL | Request) => {
      const url = request.toString();
      return url.includes('list-type=2')
        ? new Response(listing, { status: 200 })
        : new Response(gribGzip, { status: 200 });
    }) as typeof fetch;
    const archive = new ForecastArchive(':memory:');
    const adapter = new MrmsAdapter('Weathercast-Test/1.0', fetchImpl, 'https://bucket.example');
    const result = await ingestMrmsFrames({
      archive,
      adapter,
      domain: 'CONUS',
      product: 'PrecipRate_00.00',
      now: new Date('2026-07-10T15:31:00.000Z'),
      frameCount: 8,
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ discovered: 1, ingested: 1 });
    expect(archive.countSourceAssets()).toBe(1);
    expect(archive.listRadarFrames('CONUS', 'PrecipRate_00.00')).toHaveLength(1);
    archive.close();
  });

  test('rejects a response whose byte count changed after listing', async () => {
    const fetchImpl = (async (request: string | URL | Request) => request.toString().includes('list-type=2')
      ? new Response(listing, { status: 200 })
      : new Response(new Uint8Array([...gribGzip, 0]), { status: 200 })) as typeof fetch;
    const adapter = new MrmsAdapter('Weathercast-Test/1.0', fetchImpl, 'https://bucket.example');
    const objects = await adapter.listRecent(
      'CONUS',
      'PrecipRate_00.00',
      new Date('2026-07-10T15:31:00.000Z'),
      45,
      new AbortController().signal,
    );
    await expect(adapter.download(objects[0], new AbortController().signal)).rejects.toThrow('size does not match');
  });
});
