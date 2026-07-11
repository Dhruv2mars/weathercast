import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

describe('PostgreSQL serving archive migration', () => {
  test('enforces immutable forecast issues and indexed readiness inputs', async () => {
    const sql = await Bun.file(join(import.meta.dir, 'postgres', '001_serving.sql')).text();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS forecast_issues');
    expect(sql).toContain('CREATE TRIGGER forecast_issues_reject_update');
    expect(sql).toContain('CREATE TRIGGER forecast_issues_reject_delete');
    expect(sql).toContain('rain_observations_readiness');
    expect(sql).toContain('radar_frames_domain_product_observed');
    expect(sql).toContain('response_json JSONB NOT NULL');
    expect(sql).toContain('payload BYTEA NOT NULL');
    expect(sql).toContain('source_assets_reject_update');
    expect(sql).toContain('rain_observed BOOLEAN NOT NULL');
  });
});
