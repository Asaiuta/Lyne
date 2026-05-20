export type ApiStatus = "success" | "error";

export type RequestState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: string };

export interface AudioDeviceInfo {
  id: number;
  name: string;
  is_default: boolean;
  sample_rate: number | null;
}

export interface DevicesResponse {
  preferred: AudioDeviceInfo[];
  other: AudioDeviceInfo[];
  preferred_name: string;
}

export interface QueueStatus {
  current_track_path: string | null;
  pending_track_path: string | null;
  needs_preload: boolean;
  pending_ready: boolean;
  is_preload_canceling: boolean;
}

export interface PersistentSettings {
  volume: number;
  device_id: number | null;
  exclusive_mode: boolean;
  eq_type: string;
  eq_bands: Record<string, number> | null;
  fir_taps: number | null;
  dither_enabled: boolean;
  output_bits: number;
  noise_shaper_curve: string;
  loudness_enabled: boolean;
  loudness_mode: string;
  target_lufs: number;
  preamp_db: number;
  saturation_enabled: boolean;
  saturation_drive: number;
  saturation_mix: number;
  crossfeed_enabled: boolean;
  crossfeed_mix: number;
  dynamic_loudness_enabled: boolean;
  dynamic_loudness_strength: number;
  target_samplerate: number | null;
  resample_quality: string;
  use_cache: boolean;
  preemptive_resample: boolean;
  use_next_prefetch: boolean;
}

export interface PersistentSettingsUpdate {
  volume?: number;
  device_id?: number | null;
  exclusive_mode?: boolean;
  eq_type?: string;
  eq_bands?: Record<string, number>;
  fir_taps?: number;
  dither_enabled?: boolean;
  output_bits?: number;
  noise_shaper_curve?: string;
  loudness_enabled?: boolean;
  loudness_mode?: string;
  target_lufs?: number;
  preamp_db?: number;
  saturation_enabled?: boolean;
  saturation_drive?: number;
  saturation_mix?: number;
  crossfeed_enabled?: boolean;
  crossfeed_mix?: number;
  dynamic_loudness_enabled?: boolean;
  dynamic_loudness_strength?: number;
  target_samplerate?: number | null;
  resample_quality?: string;
  use_cache?: boolean;
  preemptive_resample?: boolean;
  use_next_prefetch?: boolean;
}

export interface PlayerState {
  is_playing: boolean;
  is_paused: boolean;
  is_loading: boolean;
  duration: number;
  current_time: number;
  file_path: string | null;
  ncm_song_id: number | null;
  ncm_source_page_url: string | null;
  volume: number;
  device_id: number | null;
  exclusive_mode: boolean;
  eq_type: string;
  dither_enabled: boolean;
  replaygain_enabled: boolean;
  loudness_enabled: boolean;
  loudness_mode: string;
  target_lufs: number;
  preamp_db: number;
  rg_track_gain: number | null;
  rg_album_gain: number | null;
  rg_track_peak: number | null;
  rg_album_peak: number | null;
  saturation_enabled: boolean;
  saturation_drive: number;
  saturation_mix: number;
  crossfeed_enabled: boolean;
  crossfeed_mix: number;
  dynamic_loudness_enabled: boolean;
  dynamic_loudness_strength: number;
  dynamic_loudness_factor: number;
  output_bits: number;
  noise_shaper_curve: string;
  target_samplerate: number | null;
  resample_quality: string;
  use_cache: boolean;
  preemptive_resample: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  track_number: number | null;
  disc_number: number | null;
  genre: string | null;
  year: number | null;
  has_cover_art: boolean;
  external_artwork_url: string | null;
  media_id: string | null;
  repeat_mode: RepeatMode;
  shuffle_mode: ShuffleMode;
}

export type RepeatMode = "off" | "one" | "all";
export type ShuffleMode = "off" | "on";

export interface LibraryRoot {
  root_id: number;
  source_key: string | null;
  source_path: string;
  source_kind: string;
  display_name: string;
  scan_status: string;
  track_count: number;
  last_scan_started_at_epoch_secs: number | null;
  last_scan_finished_at_epoch_secs: number | null;
  updated_at_epoch_secs: number;
}

export interface MediaItem {
  media_id: string;
  source_path: string;
  source_kind: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  track_number: number | null;
  disc_number: number | null;
  genre: string | null;
  year: number | null;
  duration_secs: number | null;
  sample_rate: number | null;
  channels: number | null;
  bitrate_bps: number | null;
  bits_per_sample: number | null;
  has_cover_art: boolean;
  external_artwork_url: string | null;
  size_bytes: number | null;
  updated_at_epoch_secs: number;
}

export interface LibraryTrackSummary {
  track_key: number;
  media_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  track_number: number | null;
  file_name: string;
  folder_key: string;
  folder_label: string;
  duration_secs: number | null;
  sample_rate: number | null;
  bitrate_bps: number | null;
  bits_per_sample: number | null;
  has_cover_art: boolean;
  external_artwork_url: string | null;
  size_bytes: number | null;
  added_at_epoch_secs: number;
  updated_at_epoch_secs: number;
}

export interface LibraryFolderSummary {
  key: string;
  label: string;
  path: string;
  count: number;
}

export interface LibraryTrackSummariesResponse {
  revision: string;
  total_count: number;
  total_size_bytes: number;
  folders: LibraryFolderSummary[];
  tracks: LibraryTrackSummary[];
}

export interface LibraryTrackViewResponse {
  revision: string;
  library_total_count: number;
  library_total_size_bytes: number;
  total_count: number;
  total_size_bytes: number;
  folders: LibraryFolderSummary[];
  rows: LibraryTrackSummary[];
  media_ids: string[] | null;
}

export interface LibraryTrackGroupSummary {
  key: string;
  label: string | null;
  count: number;
  artwork_track_key: number | null;
  has_cover_art: boolean;
  external_artwork_url: string | null;
}

export interface LibraryTrackGroupsResponse {
  revision: string;
  library_total_count: number;
  library_total_size_bytes: number;
  total_count: number;
  total_size_bytes: number;
  folders: LibraryFolderSummary[];
  groups: LibraryTrackGroupSummary[];
  selected_group_key: string | null;
  rows: LibraryTrackSummary[];
}

export interface LibraryTrackDetail {
  track_key: number;
  item: MediaItem;
}

export interface LocalPlaylist {
  playlist_id: string;
  name: string;
  description: string | null;
  cover_media_id: string | null;
  cover_has_cover_art: boolean;
  cover_external_artwork_url: string | null;
  track_count: number;
  created_at_epoch_secs: number;
  updated_at_epoch_secs: number;
}

export interface LocalPlaylistDetail {
  playlist: LocalPlaylist;
  items: MediaItem[];
}

export interface QueueEntry {
  queue_id: string;
  entry_id: number;
  position_index: number;
  source_path: string;
  media_id: string | null;
  status: string;
  added_at_epoch_secs: number;
  updated_at_epoch_secs: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration_secs: number | null;
  has_cover_art: boolean;
  external_artwork_url: string | null;
}

export interface WebDavSource {
  source_key: string;
  display_name: string;
  base_url: string;
  username: string | null;
  is_default: boolean;
  created_at_epoch_secs: number;
  updated_at_epoch_secs: number;
}

export interface PlaybackHistoryEntry {
  id: number;
  session_id: number | null;
  media_id: string | null;
  ncm_song_id: number | null;
  ncm_source_page_url: string | null;
  source_path: string;
  event_type: string;
  event_at_epoch_secs: number;
  position_secs: number | null;
  payload: unknown | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration_secs: number | null;
  has_cover_art: boolean;
  external_artwork_url: string | null;
}

export interface WebDavBrowseEntry {
  href: string;
  display_name: string;
  is_dir: boolean;
  url: string;
}

export interface ScanResult {
  root_id: number;
  task_id: number;
  scanned_files: number;
  indexed_files: number;
}

export interface LibraryScanTaskPayload {
  root_id?: number;
  source_kind?: string;
  source_key?: string | null;
  display_name?: string;
  scanned_files?: number;
  indexed_files?: number;
  removed_files?: number;
}

export interface LibraryScanTask {
  task_id: number;
  task_type: "library_scan";
  source_path: string;
  status: "scanning" | "success" | "error" | string;
  store_result: boolean;
  created_at_epoch_secs: number;
  updated_at_epoch_secs: number;
  result: LibraryScanTaskPayload | null;
  error: string | null;
}

export interface ApiEnvelope {
  status: ApiStatus;
  message?: string | null;
  state?: PlayerState;
  devices?: DevicesResponse;
}
