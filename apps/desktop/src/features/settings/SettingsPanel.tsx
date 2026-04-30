import { useCallback, useEffect, useState } from "react";
import { createApiClient } from "../../shared/api/client";
import type {
  AudioDeviceInfo,
  DevicesResponse,
  PersistentSettings,
  PersistentSettingsUpdate,
  RequestState
} from "../../shared/api/types";

const api = createApiClient();

interface SettingsPanelProps {
  onStateRefresh: () => Promise<void>;
}

interface SettingsFormState {
  deviceId: string;
  exclusiveMode: boolean;
  volume: string;
  eqType: string;
  firTaps: string;
  ditherEnabled: boolean;
  outputBits: string;
  noiseShaperCurve: string;
  loudnessEnabled: boolean;
  loudnessMode: string;
  targetLufs: string;
  preampDb: string;
  targetSamplerate: string;
  resampleQuality: string;
  useCache: boolean;
  preemptiveResample: boolean;
}

const NOISE_SHAPER_OPTIONS = ["Lipshitz5", "FWeighted9", "ModifiedE9", "ImprovedE9", "TpdfOnly"] as const;
const LOUDNESS_MODE_OPTIONS = ["track", "album", "streaming", "replaygain_track", "replaygain_album"] as const;
const RESAMPLE_QUALITY_OPTIONS = ["low", "std", "hq", "uhq"] as const;
const OUTPUT_BIT_OPTIONS = ["16", "24", "32"] as const;

const readErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed";

const toFormState = (settings: PersistentSettings): SettingsFormState => ({
  deviceId: settings.device_id === null ? "" : String(settings.device_id),
  exclusiveMode: settings.exclusive_mode,
  volume: String(settings.volume),
  eqType: settings.eq_type,
  firTaps: settings.fir_taps === null ? "" : String(settings.fir_taps),
  ditherEnabled: settings.dither_enabled,
  outputBits: String(settings.output_bits),
  noiseShaperCurve: settings.noise_shaper_curve,
  loudnessEnabled: settings.loudness_enabled,
  loudnessMode: settings.loudness_mode,
  targetLufs: String(settings.target_lufs),
  preampDb: String(settings.preamp_db),
  targetSamplerate: settings.target_samplerate === null ? "" : String(settings.target_samplerate),
  resampleQuality: settings.resample_quality,
  useCache: settings.use_cache,
  preemptiveResample: settings.preemptive_resample
});

const parseOptionalInteger = (value: string, label: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer or left empty.`);
  }

  return parsed;
};

const parseRequiredNumber = (value: string, label: string): number => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid number.`);
  }

  return parsed;
};

const parseDeviceId = (value: string): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error("Output device selection is invalid.");
  }

  return parsed;
};

const isOption = <T extends string>(value: string, options: readonly T[]): value is T =>
  options.includes(value as T);

export function SettingsPanel({ onStateRefresh }: SettingsPanelProps) {
  const [settingsState, setSettingsState] = useState<RequestState<PersistentSettings>>({
    status: "idle"
  });
  const [devicesState, setDevicesState] = useState<RequestState<DevicesResponse>>({
    status: "idle"
  });
  const [form, setForm] = useState<SettingsFormState>({
    deviceId: "",
    exclusiveMode: false,
    volume: "0.7",
    eqType: "IIR",
    firTaps: "1023",
    ditherEnabled: true,
    outputBits: "24",
    noiseShaperCurve: "Lipshitz5",
    loudnessEnabled: true,
    loudnessMode: "track",
    targetLufs: "-12",
    preampDb: "0",
    targetSamplerate: "",
    resampleQuality: "hq",
    useCache: false,
    preemptiveResample: true
  });
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const loadPanelData = useCallback(async () => {
    setSettingsState({ status: "loading" });
    setDevicesState({ status: "loading" });

    try {
      const [settings, devices] = await Promise.all([api.getSettings(), api.listDevices()]);
      setSettingsState({ status: "success", data: settings });
      setDevicesState({ status: "success", data: devices });
      setForm(toFormState(settings));
      setSaveError(null);
    } catch (error) {
      const message = readErrorMessage(error);
      setSettingsState({ status: "error", error: message });
      setDevicesState({ status: "error", error: message });
    }
  }, []);

  useEffect(() => {
    void loadPanelData();
  }, [loadPanelData]);

  const handleSave = async () => {
    setSaveMessage(null);
    setSaveError(null);

    try {
      const deviceId = parseDeviceId(form.deviceId);
      const volume = parseRequiredNumber(form.volume, "Volume");
      const firTaps = parseOptionalInteger(form.firTaps, "FIR taps");
      const outputBits = Number.parseInt(form.outputBits, 10);
      const targetLufs = parseRequiredNumber(form.targetLufs, "Loudness target");
      const preampDb = parseRequiredNumber(form.preampDb, "Preamp");
      const targetSamplerate = parseOptionalInteger(form.targetSamplerate, "Upsampling");

      if (!Number.isFinite(volume) || volume < 0 || volume > 4) {
        throw new Error("Volume must stay between 0.0 and 4.0.");
      }
      if (!Number.isInteger(outputBits) || !isOption(form.outputBits, OUTPUT_BIT_OPTIONS)) {
        throw new Error("Output bit depth selection is invalid.");
      }
      if (!isOption(form.noiseShaperCurve, NOISE_SHAPER_OPTIONS)) {
        throw new Error("Noise shaper selection is invalid.");
      }
      if (!isOption(form.loudnessMode, LOUDNESS_MODE_OPTIONS)) {
        throw new Error("Loudness mode selection is invalid.");
      }
      if (!isOption(form.resampleQuality, RESAMPLE_QUALITY_OPTIONS)) {
        throw new Error("Resample quality selection is invalid.");
      }

      const settingsUpdate: PersistentSettingsUpdate = {
        device_id: deviceId,
        exclusive_mode: form.exclusiveMode,
        volume,
        eq_type: form.eqType,
        fir_taps: form.eqType === "FIR" ? firTaps ?? 1023 : undefined,
        dither_enabled: form.ditherEnabled,
        output_bits: outputBits,
        noise_shaper_curve: form.noiseShaperCurve,
        loudness_enabled: form.loudnessEnabled,
        loudness_mode: form.loudnessMode,
        target_lufs: targetLufs,
        preamp_db: preampDb,
        target_samplerate: targetSamplerate,
        resample_quality: form.resampleQuality,
        use_cache: form.useCache,
        preemptive_resample: form.preemptiveResample
      };

      setIsSaving(true);
      await api.configureOutput(deviceId, form.exclusiveMode);
      await api.saveSettings(settingsUpdate);
      await Promise.all([onStateRefresh(), loadPanelData()]);
      setSaveMessage("Engine settings applied and persisted.");
    } catch (error) {
      setSaveError(readErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const devices: AudioDeviceInfo[] =
    devicesState.status === "success"
      ? [...devicesState.data.preferred, ...devicesState.data.other]
      : [];

  return (
    <section className="panel panel-settings">
      <div className="panel-header">
        <h2>Engine</h2>
        <span className="panel-meta">Precision controls</span>
      </div>

      <div className="settings-group">
        <label className="field-label" htmlFor="settings-device">
          Output Device
        </label>
        <select
          id="settings-device"
          className="select-input"
          value={form.deviceId}
          onChange={(event) => setForm((current) => ({ ...current, deviceId: event.target.value }))}
          disabled={devicesState.status !== "success" || isSaving}
        >
          <option value="">System Default</option>
          {devices.map((device) => (
            <option key={device.id} value={String(device.id)}>
              {device.name}
              {device.is_default ? " (Default)" : ""}
            </option>
          ))}
        </select>
      </div>

      <label className="toggle-row" htmlFor="settings-exclusive">
        <span>Exclusive Mode</span>
        <input
          id="settings-exclusive"
          type="checkbox"
          checked={form.exclusiveMode}
          onChange={(event) =>
            setForm((current) => ({ ...current, exclusiveMode: event.target.checked }))
          }
          disabled={isSaving}
        />
      </label>

      <div className="settings-grid">
        <div className="settings-group">
          <label className="field-label" htmlFor="settings-volume">
            Volume
          </label>
          <input
            id="settings-volume"
            className="text-input"
            type="text"
            value={form.volume}
            onChange={(event) => setForm((current) => ({ ...current, volume: event.target.value }))}
            disabled={isSaving}
          />
        </div>

        <div className="settings-group">
          <label className="field-label" htmlFor="settings-upsampling">
            Upsampling (Hz)
          </label>
          <input
            id="settings-upsampling"
            className="text-input"
            type="text"
            value={form.targetSamplerate}
            onChange={(event) =>
              setForm((current) => ({ ...current, targetSamplerate: event.target.value }))
            }
            placeholder="Empty to disable"
            disabled={isSaving}
          />
        </div>
      </div>

      <div className="settings-grid">
        <div className="settings-group">
          <label className="field-label" htmlFor="settings-eq">
            EQ Profile
          </label>
          <select
            id="settings-eq"
            className="select-input"
            value={form.eqType}
            onChange={(event) => setForm((current) => ({ ...current, eqType: event.target.value }))}
            disabled={isSaving}
          >
            <option value="IIR">IIR</option>
            <option value="FIR">FIR</option>
          </select>
        </div>

        <div className="settings-group">
          <label className="field-label" htmlFor="settings-fir-taps">
            FIR Taps
          </label>
          <input
            id="settings-fir-taps"
            className="text-input"
            type="text"
            value={form.firTaps}
            onChange={(event) => setForm((current) => ({ ...current, firTaps: event.target.value }))}
            placeholder="1023"
            disabled={isSaving || form.eqType !== "FIR"}
          />
        </div>
      </div>

      <div className="settings-grid">
        <div className="settings-group">
          <label className="field-label" htmlFor="settings-output-bits">
            Output Bits
          </label>
          <select
            id="settings-output-bits"
            className="select-input"
            value={form.outputBits}
            onChange={(event) => setForm((current) => ({ ...current, outputBits: event.target.value }))}
            disabled={isSaving}
          >
            {OUTPUT_BIT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option} bit
              </option>
            ))}
          </select>
        </div>

        <div className="settings-group">
          <label className="field-label" htmlFor="settings-noise-shaper">
            Noise Shaper
          </label>
          <select
            id="settings-noise-shaper"
            className="select-input"
            value={form.noiseShaperCurve}
            onChange={(event) =>
              setForm((current) => ({ ...current, noiseShaperCurve: event.target.value }))
            }
            disabled={isSaving}
          >
            {NOISE_SHAPER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="settings-grid">
        <label className="toggle-row" htmlFor="settings-dither">
          <span>Dither Enabled</span>
          <input
            id="settings-dither"
            type="checkbox"
            checked={form.ditherEnabled}
            onChange={(event) =>
              setForm((current) => ({ ...current, ditherEnabled: event.target.checked }))
            }
            disabled={isSaving}
          />
        </label>

        <label className="toggle-row" htmlFor="settings-loudness-enabled">
          <span>Loudness Enabled</span>
          <input
            id="settings-loudness-enabled"
            type="checkbox"
            checked={form.loudnessEnabled}
            onChange={(event) =>
              setForm((current) => ({ ...current, loudnessEnabled: event.target.checked }))
            }
            disabled={isSaving}
          />
        </label>
      </div>

      <div className="settings-grid">
        <div className="settings-group">
          <label className="field-label" htmlFor="settings-loudness-mode">
            Loudness Mode
          </label>
          <select
            id="settings-loudness-mode"
            className="select-input"
            value={form.loudnessMode}
            onChange={(event) =>
              setForm((current) => ({ ...current, loudnessMode: event.target.value }))
            }
            disabled={isSaving}
          >
            {LOUDNESS_MODE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-group">
          <label className="field-label" htmlFor="settings-target-lufs">
            Target LUFS
          </label>
          <input
            id="settings-target-lufs"
            className="text-input"
            type="text"
            value={form.targetLufs}
            onChange={(event) => setForm((current) => ({ ...current, targetLufs: event.target.value }))}
            disabled={isSaving}
          />
        </div>
      </div>

      <div className="settings-grid">
        <div className="settings-group">
          <label className="field-label" htmlFor="settings-preamp">
            Preamp (dB)
          </label>
          <input
            id="settings-preamp"
            className="text-input"
            type="text"
            value={form.preampDb}
            onChange={(event) => setForm((current) => ({ ...current, preampDb: event.target.value }))}
            disabled={isSaving}
          />
        </div>

        <div className="settings-group">
          <label className="field-label" htmlFor="settings-resample-quality">
            Resample Quality
          </label>
          <select
            id="settings-resample-quality"
            className="select-input"
            value={form.resampleQuality}
            onChange={(event) =>
              setForm((current) => ({ ...current, resampleQuality: event.target.value }))
            }
            disabled={isSaving}
          >
            {RESAMPLE_QUALITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="settings-grid">
        <label className="toggle-row" htmlFor="settings-use-cache">
          <span>Use Cache</span>
          <input
            id="settings-use-cache"
            type="checkbox"
            checked={form.useCache}
            onChange={(event) =>
              setForm((current) => ({ ...current, useCache: event.target.checked }))
            }
            disabled={isSaving}
          />
        </label>

        <label className="toggle-row" htmlFor="settings-preemptive">
          <span>Preemptive Resample</span>
          <input
            id="settings-preemptive"
            type="checkbox"
            checked={form.preemptiveResample}
            onChange={(event) =>
              setForm((current) => ({ ...current, preemptiveResample: event.target.checked }))
            }
            disabled={isSaving}
          />
        </label>
      </div>

      <div className="button-row">
        <button className="primary-button" type="button" onClick={handleSave} disabled={isSaving}>
          Save
        </button>
        <button className="ghost-button" type="button" onClick={() => void loadPanelData()} disabled={isSaving}>
          Reload
        </button>
      </div>

      {settingsState.status === "error" ? <div className="status-error">{settingsState.error}</div> : null}
      {devicesState.status === "error" ? <div className="status-error">{devicesState.error}</div> : null}
      {saveError ? <div className="status-error">{saveError}</div> : null}
      {saveMessage ? <div className="status-line">{saveMessage}</div> : null}
      {settingsState.status === "success" ? (
        <div className="status-line">
          Loaded persisted profile · EQ {settingsState.data.eq_type} · LUFS {settingsState.data.target_lufs} ·
          {` ${settingsState.data.output_bits} bit`}
        </div>
      ) : null}
    </section>
  );
}
