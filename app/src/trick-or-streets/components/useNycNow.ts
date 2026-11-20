/** The day and the minute of the day in New York. */
export interface NycNow {
  /** "2026-10-31". */
  today: string;
  minute: number;
}

/** 5:00 PM on Friday, October 30, 2026, in New York: the moment the page always shows. */
export const FROZEN_NOW: NycNow = { today: "2026-10-30", minute: 17 * 60 };

/**
 * The day and minute in New York that the page shows, held at 5:00 PM on October 30,
 * 2026, so every visit sees the events as they stood then, whatever the date.
 */
export function useNycNow(): NycNow {
  return FROZEN_NOW;
}
