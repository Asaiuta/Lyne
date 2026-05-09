import type { JSX } from "solid-js";

type IconProps = JSX.SvgSVGAttributes<SVGSVGElement>;

const baseProps: IconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 1.6,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": true
};

export function IconLogo(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M8.4 6.8L13.4 10L8.4 13.2Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconQueue(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M3.5 6.5h13" />
      <path d="M3.5 10h13" />
      <path d="M3.5 13.5h7.5" />
      <path d="M14 12.4l3.5 1.6-3.5 1.6z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconLibrary(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="3" y="3" width="2.6" height="14" rx="0.6" />
      <rect x="6.6" y="3" width="2.6" height="14" rx="0.6" />
      <path d="M11.2 4.2l3 0.8-2.4 11-3-0.8z" />
    </svg>
  );
}

export function IconMusic(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M13.5 3.5v9.4" />
      <path d="M13.5 3.5l-6.8 1.4v9.5" />
      <path d="M6.7 14.4a2.4 1.7 0 1 1-1.4-1.5" />
      <path d="M13.5 12.9a2.4 1.7 0 1 1-1.4-1.5" />
    </svg>
  );
}

export function IconStorage(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <ellipse cx="10" cy="5" rx="6.2" ry="2.4" />
      <path d="M3.8 5v5c0 1.3 2.8 2.4 6.2 2.4s6.2-1.1 6.2-2.4V5" />
      <path d="M3.8 10v5c0 1.3 2.8 2.4 6.2 2.4s6.2-1.1 6.2-2.4v-5" />
    </svg>
  );
}

export function IconList(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M6.5 5.5h10" />
      <path d="M6.5 10h10" />
      <path d="M6.5 14.5h10" />
      <path d="M3.5 5.5h0.1" />
      <path d="M3.5 10h0.1" />
      <path d="M3.5 14.5h0.1" />
    </svg>
  );
}

export function IconHistory(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M3.5 10a6.5 6.5 0 1 0 1.5-4.1" />
      <path d="M3 3v3.5h3.5" />
      <path d="M10 6.5v4l2.6 1.6" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="10" cy="10" r="2.4" />
      <path d="M10 2v2.4M10 15.6V18M2 10h2.4M15.6 10H18M4.4 4.4l1.7 1.7M13.9 13.9l1.7 1.7M4.4 15.6l1.7-1.7M13.9 6.1l1.7-1.7" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="9" cy="9" r="5" />
      <path d="M12.6 12.6l4.4 4.4" />
    </svg>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 4l-5 6 5 6" />
    </svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M8 4l5 6-5 6" />
    </svg>
  );
}

export function IconCollapse(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4 5h12" />
      <path d="M4 10h7.5" />
      <path d="M4 15h12" />
      <path d="M16 8l-3 2 3 2" />
    </svg>
  );
}

export function IconExpand(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4 5h12" />
      <path d="M4 10h12" />
      <path d="M4 15h12" />
      <path d="M11 8l3 2-3 2" />
    </svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M6 4.5l9 5.5-9 5.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconPause(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="5.5" y="4.5" width="3" height="11" rx="0.6" fill="currentColor" stroke="none" />
      <rect x="11.5" y="4.5" width="3" height="11" rx="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSkipPrev(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="4" y="4.5" width="2" height="11" rx="0.4" fill="currentColor" stroke="none" />
      <path d="M16 4.5v11l-9-5.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSkipNext(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4 4.5v11l9-5.5z" fill="currentColor" stroke="none" />
      <rect x="14" y="4.5" width="2" height="11" rx="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconShuffle(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M3 5.5h2.6l3.4 4 3.4 4H15" />
      <path d="M3 14.5h2.6l3.4-4" />
      <path d="M12 6.5l3-1-1 3" />
      <path d="M12 13.5l3 1-1-3" />
    </svg>
  );
}

export function IconRepeat(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M5 7.5h9.5a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H5" />
      <path d="M7 5.5l-2 2 2 2" />
      <path d="M14 14.5l2-2-2-2" />
    </svg>
  );
}

export function IconRepeatOne(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M5 7.5h9.5a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H5" />
      <path d="M7 5.5l-2 2 2 2" />
      <path d="M14 14.5l2-2-2-2" />
      <path d="M10 13v-4l-1 0.6" />
    </svg>
  );
}

export function IconStop(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="5" y="5" width="10" height="10" rx="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconVolumeHigh(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M3.5 8v4h2.5l3.5 2.5v-9L6 8z" fill="currentColor" stroke="none" />
      <path d="M12.5 6.8a4.2 4.2 0 0 1 0 6.4" />
      <path d="M14.6 4.5a7 7 0 0 1 0 11" />
    </svg>
  );
}

export function IconVolumeMute(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M3.5 8v4h2.5l3.5 2.5v-9L6 8z" fill="currentColor" stroke="none" />
      <path d="M12.5 7.5l4 5" />
      <path d="M16.5 7.5l-4 5" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M5 5l10 10" />
      <path d="M15 5l-10 10" />
    </svg>
  );
}

export function IconDelete(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4.5 6h11" />
      <path d="M8 6V4.5h4V6" />
      <path d="M6.5 8l0.7 8h5.6l0.7-8" />
      <path d="M9 9.5v4.5" />
      <path d="M11 9.5v4.5" />
    </svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M3.5 6.5a6.5 6.5 0 0 1 11.4-3.1" />
      <path d="M11 2.5h4v4" />
      <path d="M16.5 13.5a6.5 6.5 0 0 1-11.4 3.1" />
      <path d="M9 17.5H5v-4" />
    </svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="6" y="6" width="10" height="11" rx="1.5" />
      <path d="M4 13V4.5A1.5 1.5 0 0 1 5.5 3H13" />
    </svg>
  );
}

export function IconPlayCircle(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M8.5 7l4.5 3-4.5 3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M10 4v12" />
      <path d="M4 10h12" />
    </svg>
  );
}

export function IconArtist(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="10" cy="7.5" r="3" />
      <path d="M4 16.5c1-3 3.4-4.5 6-4.5s5 1.5 6 4.5" />
    </svg>
  );
}

export function IconAlbum(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="2" />
    </svg>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3.2L9 6.5h6.5A1.5 1.5 0 0 1 17 8v6.5A1.5 1.5 0 0 1 15.5 16h-11A1.5 1.5 0 0 1 3 14.5z" />
    </svg>
  );
}

export function IconQueueAdd(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M3.5 6h10" />
      <path d="M3.5 10h7" />
      <path d="M3.5 14h7" />
      <path d="M14.5 12v5" />
      <path d="M12 14.5h5" />
    </svg>
  );
}

export function IconMinimize(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4 10h12" />
    </svg>
  );
}

export function IconMaximize(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="4" y="4" width="12" height="12" rx="1.5" />
    </svg>
  );
}

export function IconRestore(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="5.5" y="3" width="10.5" height="10.5" rx="1.5" />
      <path d="M3 8h2.5V5.5" />
      <path d="M8 17v-2.5H15.5" />
    </svg>
  );
}

export function IconSparkle(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M10 2.5l1.5 5.5 5.5 1.5-5.5 1.5L10 16.5 8.5 11 3 9.5l5.5-1.5z" />
    </svg>
  );
}

export function IconCompass(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M13.2 6.8l-1.8 4.8-4.8 1.8 1.8-4.8z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconHeart(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M10 16.5s-6.5-4.5-6.5-8A3.5 3.5 0 0 1 10 5.5a3.5 3.5 0 0 1 6.5 3c0 3.5-6.5 8-6.5 8z" />
    </svg>
  );
}

export function IconCloud(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M5.5 14.5a3.5 3.5 0 0 1-.4-7A5.5 5.5 0 0 1 15.6 9a3.5 3.5 0 0 1 .4 6.5H5.5z" />
    </svg>
  );
}

export function IconControls(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4 5.5h12" />
      <path d="M4 10h12" />
      <path d="M4 14.5h12" />
      <circle cx="8" cy="5.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="7" cy="14.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconPlaylist(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4 5.5h12" />
      <path d="M4 9.5h8" />
      <path d="M4 13.5h8" />
      <path d="M14 11v5" />
      <path d="M12 13.5h4" />
    </svg>
  );
}

export function IconStar(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M10 3l2.2 4.5 5 .7-3.6 3.5.8 5L10 14.5 5.6 16.7l.8-5L2.8 8.2l5-.7z" />
    </svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M6 8l4 4 4-4" />
    </svg>
  );
}

export function IconDots(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="5" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
