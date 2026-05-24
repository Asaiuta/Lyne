import { For, createEffect, createSignal, onCleanup } from "solid-js";
import { useTranslation } from "../shared/i18n";
import { SImage } from "./SImage";

interface CoverArtProps {
  coverUrl: string | null;
  alt?: string;
}

interface Layer {
  key: number;
  url: string;
}

const CROSSFADE_MS = 350;

export function CoverArt(props: CoverArtProps) {
  const { t } = useTranslation();
  const [layers, setLayers] = createSignal<Layer[]>([]);
  let nextKey = 0;
  let lastUrl: string | null | undefined;

  createEffect(() => {
    const url = props.coverUrl;
    if (url === lastUrl) return;
    lastUrl = url;

    if (!url) {
      setLayers([]);
      return;
    }

    const key = ++nextKey;
    setLayers((prev) => [...prev, { key, url }]);
    const timer = window.setTimeout(() => {
      setLayers((prev) => (prev.length > 1 ? prev.filter((layer) => layer.key === key) : prev));
    }, CROSSFADE_MS);
    onCleanup(() => window.clearTimeout(timer));
  });

  const resolvedAlt = () => props.alt ?? t("cover.alt");

  return (
    <div class="cover-art">
      <SImage
        src={null}
        alt=""
        class="cover-placeholder"
        observeVisibility={false}
        shape="rect"
        aspect="square"
        ariaHidden="true"
      />
      <For each={layers()}>{(layer) => <CoverLayer url={layer.url} alt={resolvedAlt()} />}</For>
    </div>
  );
}

function CoverLayer(props: { url: string; alt: string }) {
  return (
    <SImage
      src={props.url}
      alt={props.alt}
      class="cover-art-layer"
      mediaClass="cover-art-image"
      observeVisibility={false}
      shape="rect"
      aspect="square"
    />
  );
}
