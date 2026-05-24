import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { isVideoArtworkUrl } from "../shared/utils/mediaUrls";
import "../shared/styles/components/image.css";

export type SImageShape = "rect" | "pill" | "circle";
export type SImageAspect = "square" | "auto" | number;
export type SImageObjectFit = "cover" | "contain" | "fill" | "none" | "scale-down";
export type SImageCrossOrigin = "" | "anonymous" | "use-credentials";

export interface SImageProps {
  src: string | undefined | null;
  alt?: string;
  class?: string;
  mediaClass?: string;
  placeholderClass?: string;
  style?: JSX.CSSProperties;
  mediaStyle?: JSX.CSSProperties;
  placeholderSrc?: string;
  shape?: SImageShape;
  aspect?: SImageAspect;
  /** 元素进入视口后才加载 src */
  observeVisibility?: boolean;
  /** 离开视口时释放 src 以回收内存 */
  releaseOnHide?: boolean;
  /** 使用浏览器异步解码 */
  decodeAsync?: boolean;
  /** 使用原生懒加载 */
  nativeLazy?: boolean;
  objectFit?: SImageObjectFit;
  draggable?: boolean;
  crossOrigin?: SImageCrossOrigin;
  crossorigin?: SImageCrossOrigin;
  videoAutoplay?: boolean;
  videoLoop?: boolean;
  videoMuted?: boolean;
  videoPlaysInline?: boolean;
  ariaHidden?: boolean | "true" | "false";
  onLoad?: (e: Event) => void;
  onError?: (e: Event) => void;
  onVisibilityChange?: (visible: boolean) => void;
}

export const DEFAULT_SIMAGE_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='none'/%3E%3Cpath d='M125 48v68.5a26 26 0 1 1-13-22.5V66l-54 10.5v50a26 26 0 1 1-13-22.5V66z' fill='rgba(128,128,128,.42)'/%3E%3C/svg%3E";

type VisibilityCallback = (visible: boolean) => void;

const SIMAGE_VISIBILITY_ROOT_MARGIN = "200px";
const visibilityCallbacks = new Map<Element, VisibilityCallback>();
let sharedVisibilityObserver: IntersectionObserver | null = null;

const getSharedVisibilityObserver = (): IntersectionObserver | null => {
  if (typeof IntersectionObserver === "undefined") return null;
  if (sharedVisibilityObserver === null) {
    sharedVisibilityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        visibilityCallbacks.get(entry.target)?.(entry.isIntersecting);
      }
    }, { rootMargin: SIMAGE_VISIBILITY_ROOT_MARGIN });
  }
  return sharedVisibilityObserver;
};

const observeSImageVisibility = (
  element: Element,
  callback: VisibilityCallback
): (() => void) => {
  const observer = getSharedVisibilityObserver();
  if (observer === null) {
    callback(true);
    return () => undefined;
  }

  visibilityCallbacks.set(element, callback);
  observer.observe(element);

  return () => {
    observer.unobserve(element);
    visibilityCallbacks.delete(element);
    if (visibilityCallbacks.size === 0) {
      observer.disconnect();
      sharedVisibilityObserver = null;
    }
  };
};

export function SImage(props: SImageProps) {
  const observeVisibility = () => props.observeVisibility ?? true;
  const releaseOnHide = () => props.releaseOnHide ?? false;
  const decodeAsync = () => props.decodeAsync ?? true;
  const nativeLazy = () => props.nativeLazy ?? true;
  const objectFit = () => props.objectFit ?? "cover";
  const shape = () => props.shape ?? "rect";
  const aspect = () => props.aspect ?? "auto";
  const placeholderSrc = () => props.placeholderSrc ?? DEFAULT_SIMAGE_PLACEHOLDER;
  const crossOrigin = () => props.crossOrigin ?? props.crossorigin;
  const draggable = () => props.draggable ?? false;
  const videoAutoplay = () => props.videoAutoplay ?? true;
  const videoLoop = () => props.videoLoop ?? true;
  const videoMuted = () => props.videoMuted ?? true;
  const videoPlaysInline = () => props.videoPlaysInline ?? true;

  const [imgSrc, setImgSrc] = createSignal<string | undefined>(undefined);
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [hasError, setHasError] = createSignal(false);
  const [isVisible, setIsVisible] = createSignal(!observeVisibility());

  let containerRef: HTMLDivElement | undefined;
  let imgRef: HTMLImageElement | undefined;
  let videoRef: HTMLVideoElement | undefined;
  let loadToken = 0;
  let currentToken = 0;
  let lastVisible: boolean | null = null;

  const resolvedClass = createMemo(() =>
    [
      "s-image",
      `s-image--${shape()}`,
      isLoaded() ? "is-loaded" : "",
      hasError() ? "is-error" : "",
      props.class ?? ""
    ]
      .filter(Boolean)
      .join(" ")
  );
  const aspectStyle = createMemo<JSX.CSSProperties>(() => {
    const value = aspect();
    if (value === "auto") return {};
    return { "aspect-ratio": value === "square" ? "1 / 1" : String(value) };
  });
  const rootStyle = createMemo<JSX.CSSProperties>(() => ({
    ...aspectStyle(),
    ...(props.style ?? {})
  }));
  const mediaStyle = createMemo<JSX.CSSProperties>(() => ({
    "object-fit": objectFit(),
    ...(props.mediaStyle ?? {})
  }));
  const mediaClass = createMemo(() =>
    ["s-image-media", isLoaded() ? "is-loaded" : "", props.mediaClass ?? ""]
      .filter(Boolean)
      .join(" ")
  );
  const placeholderClass = createMemo(() =>
    ["s-image-placeholder", props.placeholderClass ?? ""]
      .filter(Boolean)
      .join(" ")
  );
  const isVideo = createMemo(() => isVideoArtworkUrl(imgSrc()));

  createEffect(() => {
    if (!observeVisibility()) {
      setIsVisible(true);
      return;
    }
    if (!containerRef) return;

    const unobserve = observeSImageVisibility(containerRef, setIsVisible);
    onCleanup(unobserve);
  });

  // React to visibility + src changes
  createEffect(() => {
    const visible = isVisible();
    const src = props.src;
    const shouldRelease = releaseOnHide();

    if (lastVisible !== visible) {
      lastVisible = visible;
      props.onVisibilityChange?.(visible);
    }

    if (!observeVisibility()) {
      // No visibility observation — load immediately
      if (src && imgSrc() !== src) {
        loadToken += 1;
        currentToken = loadToken;
        setIsLoaded(false);
        setHasError(false);
        setImgSrc(src);
      } else if (!src) {
        loadToken += 1;
        currentToken = loadToken;
        setIsLoaded(false);
        setHasError(false);
        setImgSrc(undefined);
      }
      return;
    }

    if (visible) {
      if (src && imgSrc() !== src) {
        loadToken += 1;
        currentToken = loadToken;
        setIsLoaded(false);
        setHasError(false);
        setImgSrc(src);
      } else if (!src) {
        loadToken += 1;
        currentToken = loadToken;
        setIsLoaded(false);
        setHasError(false);
        setImgSrc(undefined);
      }
    } else if (shouldRelease) {
      if (imgSrc() !== undefined) {
        loadToken += 1;
        currentToken = loadToken;
        setIsLoaded(false);
        setImgSrc(undefined);
      }
    }
  });

  const isLatestMediaEvent = (e: Event): boolean => {
    const target = e.currentTarget as HTMLImageElement | HTMLVideoElement | null;
    return currentToken === loadToken && target?.getAttribute("src") === imgSrc();
  };

  const handleLoad = (e: Event) => {
    if (!isLatestMediaEvent(e)) return;
    setHasError(false);
    setIsLoaded(true);
    props.onLoad?.(e);
  };

  const handleError = (e: Event) => {
    if (!isLatestMediaEvent(e)) return;
    setIsLoaded(false);
    setHasError(true);
    setImgSrc(undefined);
    props.onError?.(e);
  };

  onCleanup(() => {
    try {
      if (imgRef) imgRef.src = "";
      if (videoRef) videoRef.src = "";
    } catch {
      /* empty */
    }
  });

  return (
    <div
      ref={containerRef}
      class={resolvedClass()}
      style={rootStyle()}
      aria-hidden={props.ariaHidden}
    >
      <img
        class={placeholderClass()}
        src={placeholderSrc()}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
      <Show when={imgSrc()}>
        {(src) => (
          <Show
            when={isVideo()}
            fallback={
              <img
                ref={imgRef}
                class={mediaClass()}
                src={src()}
                alt={props.alt ?? ""}
                decoding={decodeAsync() ? "async" : "auto"}
                loading={nativeLazy() ? "lazy" : "eager"}
                style={mediaStyle()}
                draggable={draggable()}
                crossOrigin={crossOrigin()}
                onLoad={handleLoad}
                onError={handleError}
              />
            }
          >
            <video
              ref={videoRef}
              class={mediaClass()}
              src={src()}
              aria-label={props.alt}
              autoplay={videoAutoplay()}
              loop={videoLoop()}
              muted={videoMuted()}
              playsinline={videoPlaysInline()}
              style={mediaStyle()}
              onCanPlay={handleLoad}
              onError={handleError}
            />
          </Show>
        )}
      </Show>
    </div>
  );
}
