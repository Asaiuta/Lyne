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
}

export interface PlayerState {
  is_playing: boolean;
  is_paused: boolean;
  is_loading: boolean;
  duration: number;
  current_time: number;
  file_path: string | null;
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
}

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
  updated_at_epoch_secs: number;
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
  source_path: string;
  event_type: string;
  event_at_epoch_secs: number;
  position_secs: number | null;
  payload: unknown | null;
}

export interface WebDavBrowseEntry {
  href: string;
  display_name: string;
  is_dir: boolean;
  url: string;
}

export interface ScanResult {
  root_id: number;
  scanned_files: number;
  indexed_files: number;
}

export interface ApiEnvelope {
  status: ApiStatus;
  message?: string | null;
  state?: PlayerState;
  devices?: DevicesResponse;
}
