import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ForecastArchive } from './archive';

const directories: string[] = [];

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('ForecastArchive', () => {
  test('creates durable append-only forecast tables', () => {
    const directory = mkdtempSync(join(tmpdir(), 'weathercast-archive-'));
    directories.push(directory);
    const path = join(directory, 'archive.sqlite');
    const archive = new ForecastArchive(path);
    archive.close();

    const database = new Database(path);
    database.query(`
      INSERT INTO forecast_issues (
        id, issued_at, generated_at, valid_until, location_cell, latitude, longitude,
        provider, response_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('id-1', '2026-07-10T10:00:00.000Z', '2026-07-10T10:00:00.000Z',
      '2026-07-10T10:04:00.000Z', '28.6000,77.2000', 28.6, 77.2, 'fixture', '{}');

    expect(() => database.query('UPDATE forecast_issues SET provider = ? WHERE id = ?').run('mutated', 'id-1'))
      .toThrow('forecast issues are immutable');
    expect(() => database.query('DELETE FROM forecast_issues WHERE id = ?').run('id-1'))
      .toThrow('forecast issues are immutable');
    database.close();
  });
});
