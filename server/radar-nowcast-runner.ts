import { radarNowcastSchema } from './radar-nowcast-contract';

export function validateRadarDecoderOutput(input: {
  output: string;
  latitude: number;
  longitude: number;
  sourceDataTime: string;
  inputSha256: string[];
}) {
  if (input.output.length > 1_000_000) throw new Error('Radar decoder output exceeds one megabyte.');
  const nowcast = radarNowcastSchema.parse(JSON.parse(input.output));
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
