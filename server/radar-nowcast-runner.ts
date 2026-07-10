import { z } from 'zod';

import { radarNowcastSchema } from './radar-nowcast-contract';

type Provenance = {
  latitude: number;
  longitude: number;
  sourceDataTime: string;
  inputSha256: string[];
};

function validateProvenance(nowcast: ReturnType<typeof radarNowcastSchema.parse>, input: Provenance) {
  if (
    nowcast.location.latitude !== Number(input.latitude.toFixed(4))
    || nowcast.location.longitude !== Number(input.longitude.toFixed(4))
  ) throw new Error('Radar decoder returned a different location.');
  if (new Date(nowcast.sourceDataTime).getTime() !== new Date(input.sourceDataTime).getTime()) {
    throw new Error('Radar decoder source time does not match the newest archived frame.');
  }
  if (
    nowcast.inputSha256.length !== input.inputSha256.length
    || !nowcast.inputSha256.every((checksum, index) => checksum === input.inputSha256[index])
  ) throw new Error('Radar decoder checksums do not match archived source assets.');
  return nowcast;
}

export function validateRadarDecoderOutput(input: {
  output: string;
  latitude: number;
  longitude: number;
  sourceDataTime: string;
  inputSha256: string[];
}) {
  if (input.output.length > 1_000_000) throw new Error('Radar decoder output exceeds one megabyte.');
  const nowcast = radarNowcastSchema.parse(JSON.parse(input.output));
  return validateProvenance(nowcast, input);
}

const batchEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  runs: z.array(z.unknown()).min(1).max(20),
});

const targetIdSchema = z.object({ targetId: z.string().min(1).max(128) });

export function validateRadarBatchDecoderOutput(input: {
  output: string;
  targets: Array<{ id: string; latitude: number; longitude: number }>;
  sourceDataTime: string;
  inputSha256: string[];
}) {
  if (input.output.length > 5_000_000) throw new Error('Radar batch decoder output exceeds five megabytes.');
  const envelope = batchEnvelopeSchema.parse(JSON.parse(input.output));
  if (envelope.runs.length !== input.targets.length) {
    throw new Error('Radar batch decoder returned a different target count.');
  }
  return envelope.runs.map((raw, index) => {
    const { targetId } = targetIdSchema.parse(raw);
    const expected = input.targets[index];
    if (!expected || targetId !== expected.id) throw new Error('Radar batch target order does not match the study.');
    const nowcast = validateProvenance(radarNowcastSchema.parse(raw), {
      latitude: expected.latitude,
      longitude: expected.longitude,
      sourceDataTime: input.sourceDataTime,
      inputSha256: input.inputSha256,
    });
    return { targetId, nowcast };
  });
}
