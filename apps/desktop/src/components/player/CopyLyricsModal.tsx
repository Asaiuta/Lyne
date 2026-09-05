import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { LyricLine } from "../../shared/media/lyrics";
import { useTranslation } from "../../shared/i18n";
import { copyToClipboard } from "../../shared/utils/clipboard";
import { NaiveButton, NaiveCheckbox, NaiveCheckboxGroup, NaiveScrollbar } from "../../shared/ui/naive";
import "../../shared/styles/components/copy-lyrics-modal.css";
import { Modal } from "../Modal";

interface CopyLyricsModalProps {
  open: boolean;
  lyrics: readonly LyricLine[];
  title: string;
  artist?: string | null;
  onClose: () => void;
}

type CopyLyricOption = "title" | "artist" | "translation" | "romanization" | "blankLine";

const COPY_OPTIONS: readonly CopyLyricOption[] = [
  "title",
  "artist",
  "translation",
  "romanization",
  "blankLine"
];

const lineTextForCopy = (
  line: LyricLine,
  options: ReadonlySet<CopyLyricOption>
): string[] => {
  const lines = [line.text];
  if (options.has("translation") && line.translatedText?.trim()) {
    lines.push(line.translatedText.trim());
  }
  if (options.has("romanization") && line.romanText?.trim()) {
    lines.push(line.romanText.trim());
  }
  return lines;
};

const composeCopiedLyrics = (
  lyrics: readonly LyricLine[],
  selectedIndices: ReadonlySet<number>,
  options: ReadonlySet<CopyLyricOption>,
  title: string,
  artist?: string | null
): string => {
  const output: string[] = [];
  const titleText = title.trim();
  const artistText = artist?.trim() ?? "";

  if (options.has("title") && titleText) {
    output.push(titleText);
  }
  if (options.has("artist") && artistText) {
    output.push(artistText);
  }
  if (output.length > 0) {
    output.push("");
  }

  lyrics.forEach((line, index) => {
    if (!selectedIndices.has(index)) return;
    const lineParts = lineTextForCopy(line, options);
    if (lineParts.length === 0) return;
    output.push(...lineParts);
    if (options.has("blankLine")) {
      output.push("");
    }
  });

  return output.join("\n").trimEnd();
};

export function CopyLyricsModal(props: CopyLyricsModalProps) {
  const { t } = useTranslation();
  const [selectedIndices, setSelectedIndices] = createSignal<readonly number[]>([]);
  const [selectedOptions, setSelectedOptions] = createSignal<readonly CopyLyricOption[]>([
    "translation",
    "romanization"
  ]);

  const allLineIndices = createMemo(() => props.lyrics.map((_, index) => index));
  const selectedIndexSet = createMemo(() => new Set(selectedIndices()));
  const selectedOptionSet = createMemo(() => new Set<CopyLyricOption>(selectedOptions()));
  const selectedCount = createMemo(() => selectedIndices().length);
  const canCopy = createMemo(() => selectedCount() > 0);
  const copyPreview = createMemo(() =>
    composeCopiedLyrics(
      props.lyrics,
      selectedIndexSet(),
      selectedOptionSet(),
      props.title,
      props.artist
    )
  );

  createEffect(() => {
    if (!props.open) return;
    setSelectedIndices(allLineIndices());
  });

  const toggleAll = () => {
    setSelectedIndices((current) =>
      current.length === props.lyrics.length ? [] : allLineIndices()
    );
  };
  const copySelected = () => {
    const text = copyPreview();
    if (!text.trim()) return;
    void copyToClipboard(text);
    props.onClose();
  };

  return (
    <Modal
      open={props.open}
      title={t("fullPlayer.copyLyrics.title")}
      onClose={props.onClose}
      size="lg"
      footer={
        <>
          <NaiveButton
            variant="tertiary"
            onClick={toggleAll}
            disabled={props.lyrics.length === 0}
          >
            {selectedCount() === props.lyrics.length
              ? t("fullPlayer.copyLyrics.clear")
              : t("fullPlayer.copyLyrics.selectAll")}
          </NaiveButton>
          <NaiveButton class="player" variant="primary" disabled={!canCopy()} onClick={copySelected}>
            {t("fullPlayer.copyLyrics.copy", { count: selectedCount() })}
          </NaiveButton>
        </>
      }
    >
      <div class="copy-lyrics-modal">
        <div class="copy-lyrics-options">
          <NaiveCheckboxGroup
            value={selectedOptions()}
            onUpdateValue={(value) => setSelectedOptions(value as CopyLyricOption[])}
            ariaLabel={t("fullPlayer.copyLyrics.options")}
            class="copy-lyrics-option-group"
          >
            <For each={COPY_OPTIONS}>
              {(option) => (
                <NaiveCheckbox
                  value={option}
                  label={t(`fullPlayer.copyLyrics.option.${option}` as const)}
                />
              )}
            </For>
          </NaiveCheckboxGroup>
        </div>

        <Show
          when={props.lyrics.length > 0}
          fallback={<div class="copy-lyrics-empty">{t("fullPlayer.copyLyrics.empty")}</div>}
        >
          <NaiveCheckboxGroup
            value={selectedIndices()}
            onUpdateValue={(value) => setSelectedIndices(value as number[])}
            ariaLabel={t("fullPlayer.copyLyrics.lines")}
          >
            <NaiveScrollbar class="copy-lyrics-scroll" maxHeight="52vh">
              <div class="copy-lyrics-list">
                <For each={props.lyrics}>
                  {(line, index) => (
                    <NaiveCheckbox value={index()} class="copy-lyrics-line-check">
                      <span class="copy-lyrics-line">
                        <span class="copy-lyrics-line-main">{line.text}</span>
                        <Show when={line.translatedText}>
                          {(translated) => (
                            <span class="copy-lyrics-line-extra">{translated()}</span>
                          )}
                        </Show>
                        <Show when={line.romanText}>
                          {(roman) => <span class="copy-lyrics-line-extra">{roman()}</span>}
                        </Show>
                      </span>
                    </NaiveCheckbox>
                  )}
                </For>
              </div>
            </NaiveScrollbar>
          </NaiveCheckboxGroup>
        </Show>
      </div>
    </Modal>
  );
}
