export type InstagramTimestampedItem = {
  id?: unknown;
  post_id?: unknown;
  shortCode?: unknown;
  timestamp?: unknown;
  posted_at?: unknown;
};

export type ScrapedInstagramPost = InstagramTimestampedItem & {
  id?: string;
  shortCode?: string;
  ownerUsername?: string;
  takenAtTimestamp?: string | number;
  url?: string;
  displayUrl?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  caption?: string;
  likesCount?: number;
  commentsCount?: number;
  type?: string;
};

const MILLISECOND_EPOCH_THRESHOLD = 10_000_000_000;
const INSTAGRAM_LAUNCH_YEAR = 2010;

export function parseInstagramPostTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  let date: Date;
  if (typeof value === "number") {
    date = new Date(
      value >= MILLISECOND_EPOCH_THRESHOLD ? value : value * 1000
    );
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
      const numericValue = Number(trimmed);
      date = new Date(
        numericValue >= MILLISECOND_EPOCH_THRESHOLD
          ? numericValue
          : numericValue * 1000
      );
    } else {
      date = new Date(trimmed);
    }
  } else {
    return null;
  }

  if (Number.isNaN(date.getTime())) return null;

  // Actor payloads occasionally contain scrape timestamps or malformed future
  // epochs. Do not let those masquerade as a post's publication date.
  const year = date.getUTCFullYear();
  if (year < INSTAGRAM_LAUNCH_YEAR || date.getTime() > Date.now() + 86_400_000) {
    return null;
  }

  return date.toISOString();
}

export function sortInstagramPostsNewestFirst<T extends InstagramTimestampedItem>(
  posts: readonly T[]
): T[] {
  return [...posts].sort((left, right) => {
    const leftTimestamp = parseInstagramPostTimestamp(
      left.timestamp ?? left.posted_at
    );
    const rightTimestamp = parseInstagramPostTimestamp(
      right.timestamp ?? right.posted_at
    );
    const leftTime = leftTimestamp ? Date.parse(leftTimestamp) : -Infinity;
    const rightTime = rightTimestamp ? Date.parse(rightTimestamp) : -Infinity;

    if (leftTime !== rightTime) return rightTime - leftTime;

    const leftId = String(left.shortCode ?? left.post_id ?? left.id ?? "");
    const rightId = String(right.shortCode ?? right.post_id ?? right.id ?? "");
    return rightId.localeCompare(leftId);
  });
}
