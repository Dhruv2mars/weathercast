export type ArchivedRadarFrame = {
  id: string;
  observed_at: string;
  retrieved_at: string;
  object_key: string;
  source_asset_id: string;
};

export function getScheduledIssueTime(input: {
  now: Date;
  startsAt: string;
  endsAt: string;
  cadenceMinutes: number;
}) {
  const now = input.now.getTime();
  const startsAt = new Date(input.startsAt).getTime();
  const endsAt = new Date(input.endsAt).getTime();
  const cadenceMs = input.cadenceMinutes * 60_000;
  if (
    !Number.isFinite(now)
    || !Number.isFinite(startsAt)
    || !Number.isFinite(endsAt)
    || !Number.isInteger(input.cadenceMinutes)
    || input.cadenceMinutes <= 0
  ) throw new Error('Study issue schedule is invalid.');
  if (now < startsAt || now >= endsAt) throw new Error('Study is not inside its registered issuance period.');
  return new Date(Math.floor(now / cadenceMs) * cadenceMs).toISOString();
}

export function selectStudyRadarFrames(input: {
  newestFirst: ArchivedRadarFrame[];
  expectedCount: number;
  now: Date;
}) {
  if (input.newestFirst.length !== input.expectedCount) {
    throw new Error(`Expected ${input.expectedCount} archived MRMS frames.`);
  }
  const frames = input.newestFirst.toReversed();
  const now = input.now.getTime();
  const newestTime = new Date(frames.at(-1)!.observed_at).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(newestTime) || newestTime > now + 60_000) {
    throw new Error('Newest MRMS frame has an invalid observation time.');
  }
  if (now - newestTime > 10 * 60_000) throw new Error('Newest MRMS frame is more than ten minutes old.');
  frames.slice(1).forEach((frame, index) => {
    const previousTime = new Date(frames[index]!.observed_at).getTime();
    const currentTime = new Date(frame.observed_at).getTime();
    if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
      throw new Error('Archived MRMS frame has an invalid observation time.');
    }
    const spacing = currentTime - previousTime;
    if (spacing < 60_000 || spacing > 5 * 60_000) throw new Error('Archived MRMS frame spacing is invalid.');
  });
  return frames;
}
