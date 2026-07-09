import { isCycleEligibleForSample } from './cycle-eligibility.util';

const HOUR = 60 * 60 * 1000;

describe('isCycleEligibleForSample', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');

  it('is not eligible before 72 hours have passed, even with events in every period', () => {
    const events = [new Date(start.getTime() + 1 * HOUR), new Date(start.getTime() + 25 * HOUR), new Date(start.getTime() + 49 * HOUR)];
    const now = new Date(start.getTime() + 60 * HOUR);
    expect(isCycleEligibleForSample(start, events, now)).toBe(false);
  });

  it('is eligible exactly at 72 hours when all three 24-hour periods have at least one event', () => {
    const events = [new Date(start.getTime() + 1 * HOUR), new Date(start.getTime() + 25 * HOUR), new Date(start.getTime() + 49 * HOUR)];
    const now = new Date(start.getTime() + 72 * HOUR);
    expect(isCycleEligibleForSample(start, events, now)).toBe(true);
  });

  it('is NOT eligible at 72 hours if the middle period (24h-48h) has no event', () => {
    const events = [new Date(start.getTime() + 1 * HOUR), new Date(start.getTime() + 49 * HOUR)];
    const now = new Date(start.getTime() + 72 * HOUR);
    expect(isCycleEligibleForSample(start, events, now)).toBe(false);
  });

  it('does not reset the count — becomes eligible once one more event occurs after the 72h mark, without needing to redo the missed period', () => {
    const events = [
      new Date(start.getTime() + 1 * HOUR),
      new Date(start.getTime() + 49 * HOUR),
      new Date(start.getTime() + 80 * HOUR), // compensating event, after the 72h mark
    ];
    const now = new Date(start.getTime() + 80 * HOUR);
    expect(isCycleEligibleForSample(start, events, now)).toBe(true);
  });

  it('is still not eligible after 72 hours if no compensating event has occurred yet', () => {
    const events = [new Date(start.getTime() + 1 * HOUR), new Date(start.getTime() + 49 * HOUR)];
    const now = new Date(start.getTime() + 90 * HOUR);
    expect(isCycleEligibleForSample(start, events, now)).toBe(false);
  });
});
