import type { ResolveNcmTrackInput } from "./ncmDomainTypes";

export const buildResolveNcmTrackBody = (input: ResolveNcmTrackInput) => ({
  song_id: input.songId,
  level: input.level ?? null,
  source_page_url: input.sourcePageUrl,
  title: input.title ?? null,
  artist: input.artist ?? null,
  album: input.album ?? null,
  duration_secs: input.durationSecs ?? null,
  artwork_url: input.artworkUrl ?? null
});

export const postJson = (body?: object): RequestInit => ({
  method: "POST",
  ...(body ? { body: JSON.stringify(body) } : {})
});
