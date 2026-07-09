const PERIOD_MS = 24 * 60 * 60 * 1000;
const CYCLE_MS = 3 * PERIOD_MS;

export function isCycleEligibleForSample(firstTrainingEventAt: Date, eventTimestamps: Date[], now: Date = new Date()): boolean {
  const startMs = firstTrainingEventAt.getTime();

  const periodHasEvent = (periodIndex: number): boolean =>
    eventTimestamps.some((t) => {
      const offset = t.getTime() - startMs;
      return offset >= periodIndex * PERIOD_MS && offset < (periodIndex + 1) * PERIOD_MS;
    });

  const allThreePeriodsSatisfied = periodHasEvent(0) && periodHasEvent(1) && periodHasEvent(2);
  if (allThreePeriodsSatisfied) {
    return now.getTime() >= startMs + CYCLE_MS;
  }

  const cycleEndMs = startMs + CYCLE_MS;
  if (now.getTime() < cycleEndMs) {
    return false;
  }
  // Past the 72-hour mark with a missed period — do not reset; become eligible
  // once one more real training event occurs after the mark (corrected point 12).
  return eventTimestamps.some((t) => t.getTime() >= cycleEndMs);
}
