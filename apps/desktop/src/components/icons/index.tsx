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
    <svg {...baseProps} viewBox="0 0 1024 1024" fill="none" stroke="none" {...props}>
      <path
        class="logo-mark-base"
        d="M511.764091 131.708086a446.145957 446.145957 0 1 0 446.145957 446.145957 446.145957 446.145957 0 0 0-446.145957-446.145957z m0 519.76004A71.829499 71.829499 0 1 1 583.59359 580.530919 72.275645 72.275645 0 0 1 511.764091 651.468126z"
        fill="currentColor"
        fill-opacity="0.29"
      />
      <path
        class="logo-mark-accent"
        d="M802.205109 0.541175l-168.197026 37.030114a67.814185 67.814185 0 0 0-53.091369 66.029602V223.614153l3.569168 349.778431h114.213365V223.614153h108.859613a26.322611 26.322611 0 0 0 26.768758-26.322611V26.863786a26.768757 26.768757 0 0 0-32.122509-26.322611z"
        fill="currentColor"
      />
      <path
        class="logo-mark-accent"
        d="M511.764091 386.457428a186.935156 186.935156 0 1 0 186.935156 186.48901A186.935156 186.935156 0 0 0 511.764091 386.457428z m0 264.564552a71.383353 71.383353 0 1 1 71.383353-71.383353 71.383353 71.383353 0 0 1-71.383353 71.383353z"
        fill="currentColor"
      />
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

export function IconTag(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M3.8 4.6v5.2c0 0.5 0.2 1 0.6 1.4l5.9 5.9a1.8 1.8 0 0 0 2.5 0l4.3-4.3a1.8 1.8 0 0 0 0-2.5L11.2 4.4A2 2 0 0 0 9.8 3.8H4.6a0.8 0.8 0 0 0-0.8 0.8z" />
      <circle cx="7.2" cy="7.2" r="1.1" />
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

export function IconFormatListFilled(props: IconProps) {
  return (
    <svg width={32} height={32} viewBox="0 0 24 24" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5s1.5-.67 1.5-1.5s-.67-1.5-1.5-1.5m0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5S5.5 6.83 5.5 6S4.83 4.5 4 4.5m0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5s1.5-.68 1.5-1.5s-.67-1.5-1.5-1.5M8 19h12c.55 0 1-.45 1-1s-.45-1-1-1H8c-.55 0-1 .45-1 1s.45 1 1 1m0-6h12c.55 0 1-.45 1-1s-.45-1-1-1H8c-.55 0-1 .45-1 1s.45 1 1 1M7 6c0 .55.45 1 1 1h12c.55 0 1-.45 1-1s-.45-1-1-1H8c-.55 0-1 .45-1 1"
      />
    </svg>
  );
}

export function IconRefreshFilled(props: IconProps) {
  return (
    <svg width={32} height={32} viewBox="0 0 24 24" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="M17.65 6.35a7.95 7.95 0 0 0-6.48-2.31c-3.67.37-6.69 3.35-7.1 7.02C3.52 15.91 7.27 20 12 20a7.98 7.98 0 0 0 7.21-4.56c.32-.67-.16-1.44-.9-1.44c-.37 0-.72.2-.88.53a5.994 5.994 0 0 1-6.8 3.31c-2.22-.49-4.01-2.3-4.48-4.52A6.002 6.002 0 0 1 12 6c1.66 0 3.14.69 4.22 1.78l-1.51 1.51c-.63.63-.19 1.71.7 1.71H19c.55 0 1-.45 1-1V6.41c0-.89-1.08-1.34-1.71-.71z"
      />
    </svg>
  );
}

export function IconPlayFilled(props: IconProps) {
  return (
    <svg width={32} height={32} viewBox="0 0 24 24" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18a1 1 0 0 0 0-1.69L9.54 5.98A.998.998 0 0 0 8 6.82"
      />
    </svg>
  );
}

export function IconAddFilled(props: IconProps) {
  return (
    <svg width={32} height={32} viewBox="0 0 24 24" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="M18 13h-5v5c0 .55-.45 1-1 1s-1-.45-1-1v-5H6c-.55 0-1-.45-1-1s.45-1 1-1h5V6c0-.55.45-1 1-1s1 .45 1 1v5h5c.55 0 1 .45 1 1s-.45 1-1 1"
      />
    </svg>
  );
}

export function IconFolderCogFilled(props: IconProps) {
  return (
    <svg width={32} height={32} viewBox="0 0 24 24" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="M4 4c-1.11 0-2 .89-2 2v12a2 2 0 0 0 2 2h8.08a7 7 0 0 1-.08-1a7 7 0 0 1 7-7a7 7 0 0 1 3 .69V8a2 2 0 0 0-2-2h-8l-2-2zm14 10a.26.26 0 0 0-.26.21l-.19 1.32c-.3.13-.59.29-.85.47l-1.24-.5c-.11 0-.24 0-.31.13l-1 1.73c-.06.11-.04.24.06.32l1.06.82a4.193 4.193 0 0 0 0 1l-1.06.82a.26.26 0 0 0-.06.32l1 1.73c.06.13.19.13.31.13l1.24-.5c.26.18.54.35.85.47l.19 1.32c.02.12.12.21.26.21h2c.11 0 .22-.09.24-.21l.19-1.32c.3-.13.57-.29.84-.47l1.23.5c.13 0 .26 0 .33-.13l1-1.73a.26.26 0 0 0-.06-.32l-1.07-.82c.02-.17.04-.33.04-.5c0-.17-.01-.33-.04-.5l1.06-.82a.26.26 0 0 0 .06-.32l-1-1.73c-.06-.13-.19-.13-.32-.13l-1.23.5c-.27-.18-.54-.35-.85-.47l-.19-1.32A.236.236 0 0 0 20 14zm1 3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5c-.84 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5"
      />
    </svg>
  );
}

export function IconBatchFilled(props: IconProps) {
  return (
    <svg width={32} height={32} viewBox="0 0 24 24" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="M11 8c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1s.45 1 1 1h7c.55 0 1-.45 1-1m0 8c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1s.45 1 1 1h7c.55 0 1-.45 1-1m6.05-5.71a.996.996 0 0 1-1.41 0l-2.12-2.12a.996.996 0 1 1 1.41-1.41l1.41 1.41l3.54-3.54a.996.996 0 1 1 1.41 1.41zm0 8a.996.996 0 0 1-1.41 0l-2.12-2.12a.996.996 0 1 1 1.41-1.41l1.41 1.41l3.54-3.54a.996.996 0 1 1 1.41 1.41z"
      />
    </svg>
  );
}

export function IconMenuFilled(props: IconProps) {
  return (
    <svg width={32} height={32} viewBox="0 0 24 24" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="M4 18h16c.55 0 1-.45 1-1s-.45-1-1-1H4c-.55 0-1 .45-1 1s.45 1 1 1m0-5h16c.55 0 1-.45 1-1s-.45-1-1-1H4c-.55 0-1 .45-1 1s.45 1 1 1M3 7c0 .55.45 1 1 1h16c.55 0 1-.45 1-1s-.45-1-1-1H4c-.55 0-1 .45-1 1"
      />
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

export function IconReplay5(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M8 7H4V3" />
      <path d="M4.8 7A8 8 0 1 1 4 12" />
      <path d="M14.2 9.2h-3.6l-0.4 2.4h1.9a2.2 2.2 0 1 1-2 3" />
    </svg>
  );
}

export function IconForward5(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M16 7h4V3" />
      <path d="M19.2 7A8 8 0 1 0 20 12" />
      <path d="M14.2 9.2h-3.6l-0.4 2.4h1.9a2.2 2.2 0 1 1-2 3" />
    </svg>
  );
}

export function IconCheckmark(props: IconProps) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="M14.046 3.486a.75.75 0 0 1-.032 1.06l-7.93 7.474a.85.85 0 0 1-1.188-.022l-2.68-2.72a.75.75 0 1 1 1.068-1.053l2.234 2.267l7.468-7.038a.75.75 0 0 1 1.06.032z"
      />
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

export function IconDeleteFilled(props: IconProps) {
  return (
    <svg width={32} height={32} viewBox="0 0 24 24" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6zm13-15h-3.5l-1-1h-5l-1 1H5v2h14z"
      />
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

export function IconPower(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M10 3.5v6" />
      <path d="M6.2 5.8a6 6 0 1 0 7.6 0" />
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

export function IconShare(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="5.5" cy="10" r="2.1" />
      <circle cx="14.5" cy="5.2" r="2.1" />
      <circle cx="14.5" cy="14.8" r="2.1" />
      <path d="M7.4 9l5.2-2.8" />
      <path d="M7.4 11l5.2 2.8" />
    </svg>
  );
}

export function IconLink(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M8.2 11.8a3 3 0 0 1 0-4.2l2.1-2.1a3 3 0 1 1 4.2 4.2l-1.2 1.2" />
      <path d="M11.8 8.2a3 3 0 0 1 0 4.2l-2.1 2.1a3 3 0 1 1-4.2-4.2l1.2-1.2" />
    </svg>
  );
}

export function IconVideo(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="3.5" y="5.5" width="10" height="9" rx="1.6" />
      <path d="M13.5 8.2l3-1.7v7l-3-1.7" />
    </svg>
  );
}

export function IconEye(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M2.8 10s2.6-5 7.2-5 7.2 5 7.2 5-2.6 5-7.2 5-7.2-5-7.2-5Z" />
      <circle cx="10" cy="10" r="2.2" />
    </svg>
  );
}

export function IconChat(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v5A2.5 2.5 0 0 1 13.5 13H9l-4 3v-3.4a2.5 2.5 0 0 1-1-2.1Z" />
      <path d="M7 7.5h6" />
      <path d="M7 10h4" />
    </svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6.2v4.1l2.7 1.6" />
    </svg>
  );
}

export function IconSpeed(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4 13.5a6.5 6.5 0 1 1 12 0" />
      <path d="M10 13l3-4" />
      <path d="M7 15h6" />
    </svg>
  );
}

export function IconTune(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4.5 5.5h11" />
      <path d="M4.5 10h11" />
      <path d="M4.5 14.5h11" />
      <circle cx="8" cy="5.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="7" cy="14.5" r="1.5" fill="currentColor" stroke="none" />
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

export function IconFolderPlus(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3.2L9 6.5h6.5A1.5 1.5 0 0 1 17 8v6.5A1.5 1.5 0 0 1 15.5 16h-11A1.5 1.5 0 0 1 3 14.5z" />
      <path d="M10 9v5" />
      <path d="M7.5 11.5h5" />
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

export function IconHomeFilled(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="M4 19v-9q0-.475.213-.9t.587-.7l6-4.5q.525-.4 1.2-.4t1.2.4l6 4.5q.375.275.588.7T20 10v9q0 .825-.588 1.413T18 21h-3q-.425 0-.712-.288T14 20v-5q0-.425-.288-.712T13 14h-2q-.425 0-.712.288T10 15v5q0 .425-.288.713T9 21H6q-.825 0-1.412-.587T4 19"
      />
    </svg>
  );
}

export function IconDiscoverFilled(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        fill-rule="evenodd"
        d="M5.9999978125,4.0176934375L18.0000078125,4.0176934375C18.4970078125,4.0176934375,18.9000078125,3.6147534375,18.9000078125,3.1176944375C18.9000078125,2.6206384375,18.4970078125,2.2176944613,18.0000078125,2.2176944613L5.9999978125,2.2176944613C5.5029478125,2.2176944613,5.0999978125,2.6206384375,5.0999978125,3.1176944375C5.0999978125,3.6147534375,5.5029478125,4.0176934375,5.9999978125,4.0176934375ZM3.1960448125,16.8951734375L2.8022507125,11.1750534375Q2.6749484125,9.3258934375,2.7196047125,8.6725834375Q2.8020806125,7.4659834375,3.4361238125,6.7867934375Q4.0701678125,6.1076034375,5.2682578125,5.9424434375Q5.9169578125,5.8530234375,7.7704578125,5.8530234375L16.2294078125,5.8530234375Q18.0829078125,5.8530234375,18.7316078125,5.9424434375Q19.9297078125,6.1076034375,20.5638078125,6.7867934375Q21.1978078125,7.4659934375,21.2803078125,8.6725834375Q21.3249078125,9.3259034375,21.1976078125,11.1750234375L20.8039078125,16.8951734375Q20.6913078125,18.5299734375,20.5753078125,19.1062734375Q20.3615078125,20.1678734375,19.7462078125,20.7422734375Q19.1309078125,21.3166734375,18.0572078125,21.4569734375Q17.474207812499998,21.5331734375,15.8356078125,21.5331734375L8.1642578125,21.5331734375Q6.5256978125,21.5331734375,5.9427178125,21.4569734375Q4.8689478125,21.3166734375,4.2536678125,20.7422734375Q3.6383718125,20.1678734375,3.4246308125000002,19.1062734375Q3.3085848125,18.5299734375,3.1960448125,16.8951734375ZM14.6375078125,8.530113437499999C14.7011078125,8.5104734375,14.7673078125,8.5004834375,14.8339078125,8.5004834375C15.2018078125,8.5004834375,15.4999078125,8.7986734375,15.4999078125,9.1665134375L15.4999078125,15.5220734375L15.4819078125,15.5220734375C15.4827078125,15.5418734375,15.4831078125,15.5618734375,15.4831078125,15.5818734375C15.4831078125,16.379873437500002,14.8362078125,17.0268734375,14.0382078125,17.0268734375C13.2402078125,17.0268734375,12.5932578125,16.379873437500002,12.5932578125,15.5818734375C12.5932578125,14.7838734375,13.2402078125,14.1369734375,14.0382078125,14.1369734375C14.2953078125,14.1369734375,14.5367078125,14.2040734375,14.7459078125,14.3218734375L14.7459078125,11.0771534375L10.3793178125,12.4171734375L10.3793178125,16.8837734375C10.386277812500001,16.9412734375,10.3898678125,16.9997734375,10.3898678125,17.0591734375C10.3898678125,17.857173437500002,9.742947812499999,18.5041734375,8.9449278125,18.5041734375C8.1469178125,18.504173437500002,7.4999978125,17.857173437500002,7.4999978125,17.0591734375C7.4999978125,16.2611734375,8.1469178125,15.6142734375,8.9449278125,15.6142734375C9.190897812500001,15.6142734375,9.422507812500001,15.6756734375,9.6252478125,15.7840734375L9.6252478125,10.5687534375C9.6252478125,10.2765934375,9.8156578125,10.0185334375,10.0948278125,9.932363437500001L14.6375078125,8.530113437499999Z"
      />
    </svg>
  );
}

export function IconRadioFilled(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="M3.24 6.15C2.51 6.43 2 7.17 2 8v12c0 1.1.9 2 2 2h16a2 2 0 0 0 2-2V8c0-1.1-.9-2-2-2H8.3l7.43-3c.46-.19.68-.71.49-1.17a.894.894 0 0 0-1.17-.49zM7 20c-1.66 0-3-1.34-3-3s1.34-3 3-3s3 1.34 3 3s-1.34 3-3 3m13-8h-2v-1c0-.55-.45-1-1-1s-1 .45-1 1v1H4V9c0-.55.45-1 1-1h14c.55 0 1 .45 1 1z"
      />
    </svg>
  );
}

export function IconRecordFilled(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="M17 18.25v3.25H7v-3.25c0-1.38 2.24-2.5 5-2.5s5 1.12 5 2.5M12 5.5a6.5 6.5 0 0 1 6.5 6.5c0 1.25-.35 2.42-.96 3.41L16 14.04c.32-.61.5-1.31.5-2.04c0-2.5-2-4.5-4.5-4.5s-4.5 2-4.5 4.5c0 .73.18 1.43.5 2.04l-1.54 1.37c-.61-.99-.96-2.16-.96-3.41A6.5 6.5 0 0 1 12 5.5m0-4A10.5 10.5 0 0 1 22.5 12c0 2.28-.73 4.39-1.96 6.11l-1.5-1.35c.92-1.36 1.46-3 1.46-4.76A8.5 8.5 0 0 0 12 3.5A8.5 8.5 0 0 0 3.5 12c0 1.76.54 3.4 1.46 4.76l-1.5 1.35A10.473 10.473 0 0 1 1.5 12A10.5 10.5 0 0 1 12 1.5m0 8a2.5 2.5 0 0 1 2.5 2.5a2.5 2.5 0 0 1-2.5 2.5A2.5 2.5 0 0 1 9.5 12A2.5 2.5 0 0 1 12 9.5Z"
      />
    </svg>
  );
}

export function IconStarFilled(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="m12 17.27l4.15 2.51c.76.46 1.69-.22 1.49-1.08l-1.1-4.72l3.67-3.18c.67-.58.31-1.68-.57-1.75l-4.83-.41l-1.89-4.46c-.34-.81-1.5-.81-1.84 0L9.19 8.63l-4.83.41c-.88.07-1.24 1.17-.57 1.75l3.67 3.18l-1.1 4.72c-.2.86.73 1.54 1.49 1.08z"
      />
    </svg>
  );
}

export function IconHistoryFilled(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="M13.26 3C8.17 2.86 4 6.95 4 12H2.21c-.45 0-.67.54-.35.85l2.79 2.8c.2.2.51.2.71 0l2.79-2.8a.5.5 0 0 0-.36-.85H6c0-3.9 3.18-7.05 7.1-7c3.72.05 6.85 3.18 6.9 6.9c.05 3.91-3.1 7.1-7 7.1c-1.61 0-3.1-.55-4.28-1.48a.994.994 0 0 0-1.32.08c-.42.42-.39 1.13.08 1.49A8.858 8.858 0 0 0 13 21c5.05 0 9.14-4.17 9-9.26c-.13-4.69-4.05-8.61-8.74-8.74m-.51 5c-.41 0-.75.34-.75.75v3.68c0 .35.19.68.49.86l3.12 1.85c.36.21.82.09 1.03-.26c.21-.36.09-.82-.26-1.03l-2.88-1.71v-3.4c0-.4-.34-.74-.75-.74"
      />
    </svg>
  );
}

export function IconFire(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M10.5 18a5.5 5.5 0 0 0 5.5-5.5c0-2.4-1.3-4.2-3.2-5.8-.6 1.7-1.5 2.7-2.5 3.2.3-2.5-.8-4.8-3-6.4.1 3.2-3.3 4.9-3.3 8.9A5.5 5.5 0 0 0 10.5 18z" />
      <path d="M10.5 15.5A2.5 2.5 0 0 0 13 13c0-1.1-.6-2-1.4-2.7-.4 1-.9 1.6-1.6 1.9.1-1.1-.3-2.1-1.2-2.9 0 1.9-.8 2.5-.8 3.7a2.5 2.5 0 0 0 2.5 2.5z" />
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

export function IconHeartFilled(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M10 16.5s-6.5-4.5-6.5-8A3.5 3.5 0 0 1 10 5.5a3.5 3.5 0 0 1 6.5 3c0 3.5-6.5 8-6.5 8z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconFavoriteBorderFilled(props: IconProps) {
  return (
    <svg width={32} height={32} viewBox="0 0 24 24" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="M19.66 3.99c-2.64-1.8-5.9-.96-7.66 1.1c-1.76-2.06-5.02-2.91-7.66-1.1c-1.4.96-2.28 2.58-2.34 4.29c-.14 3.88 3.3 6.99 8.55 11.76l.1.09c.76.69 1.93.69 2.69-.01l.11-.1c5.25-4.76 8.68-7.87 8.55-11.75c-.06-1.7-.94-3.32-2.34-4.28M12.1 18.55l-.1.1l-.1-.1C7.14 14.24 4 11.39 4 8.5C4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5c0 2.89-3.14 5.74-7.9 10.05"
      />
    </svg>
  );
}

export function IconFavoriteFilled(props: IconProps) {
  return (
    <svg width={32} height={32} viewBox="0 0 24 24" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="M13.35 20.13c-.76.69-1.93.69-2.69-.01l-.11-.1C5.3 15.27 1.87 12.16 2 8.28c.06-1.7.93-3.33 2.34-4.29c2.64-1.8 5.9-.96 7.66 1.1c1.76-2.06 5.02-2.91 7.66-1.1c1.41.96 2.28 2.59 2.34 4.29c.14 3.88-3.3 6.99-8.55 11.76z"
      />
    </svg>
  );
}

export function IconHeartBit(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M10 16.5s-6.5-4.5-6.5-8A3.5 3.5 0 0 1 10 5.5a3.5 3.5 0 0 1 6.5 3c0 3.5-6.5 8-6.5 8z" fill="currentColor" stroke="none" />
      <path d="M5 10.5h1.6l0.9-2 1.5 4 1-2H11.5" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function IconHeartbeatFilled(props: IconProps) {
  return (
    <svg width={32} height={32} viewBox="0 0 256 256" aria-hidden={true} {...props}>
      <path
        fill="currentColor"
        d="M72 144H32a8 8 0 0 1 0-16h35.72l13.62-20.44a8 8 0 0 1 13.32 0l25.34 38l9.34-14A8 8 0 0 1 136 128h24a8 8 0 0 1 0 16h-19.72l-13.62 20.44a8 8 0 0 1-13.32 0L88 126.42l-9.34 14A8 8 0 0 1 72 144M178 40c-20.65 0-38.73 8.88-50 23.89C116.73 48.88 98.65 40 78 40a62.07 62.07 0 0 0-62 62v2.25a8 8 0 1 0 16-.5V102a46.06 46.06 0 0 1 46-46c19.45 0 35.78 10.36 42.6 27a8 8 0 0 0 14.8 0c6.82-16.67 23.15-27 42.6-27a46.06 46.06 0 0 1 46 46c0 53.61-77.76 102.15-96 112.8c-10.83-6.31-42.63-26-66.68-52.21a8 8 0 1 0-11.8 10.82c31.17 34 72.93 56.68 74.69 57.63a8 8 0 0 0 7.58 0C136.21 228.66 240 172 240 102a62.07 62.07 0 0 0-62-62"
      />
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

export function IconThumbUp(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M7.2 16.5H5.3a1.7 1.7 0 0 1-1.7-1.7V9.7A1.7 1.7 0 0 1 5.3 8h3.2V5.2a1.4 1.4 0 0 1 2.6-.3l1.1 3.1h2.4a1.7 1.7 0 0 1 1.7 1.7v5.1a1.7 1.7 0 0 1-1.7 1.7H7.2Z" />
      <path d="M7.2 8v8.3" />
    </svg>
  );
}

export function IconThumbUpFilled(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M7.2 16.5H5.3a1.7 1.7 0 0 1-1.7-1.7V9.7A1.7 1.7 0 0 1 5.3 8h3.2V5.2a1.4 1.4 0 0 1 2.6-.3l1.1 3.1h2.4a1.7 1.7 0 0 1 1.7 1.7v5.1a1.7 1.7 0 0 1-1.7 1.7H7.2Z" fill="currentColor" stroke="none" />
      <path d="M7.2 8v8.3" stroke="var(--surface, #fff)" />
    </svg>
  );
}

export function IconThumbDown(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M7.2 3.5h7.4a1.7 1.7 0 0 1 1.7 1.7v5.1a1.7 1.7 0 0 1-1.7 1.7h-2.4l-1.1 3.1a1.4 1.4 0 0 1-2.6-.3V12H5.3a1.7 1.7 0 0 1-1.6-2.2l1.4-4.9a1.9 1.9 0 0 1 2.1-1.4Z" />
      <path d="M7.2 3.7V12" />
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

export function IconBookOpen(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M10 5.8c-1.2-1-2.8-1.5-5-1.5A1.5 1.5 0 0 0 3.5 5.8v10A1.5 1.5 0 0 1 5 14.3c2.2 0 3.8.5 5 1.5" />
      <path d="M10 5.8c1.2-1 2.8-1.5 5-1.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 0-1.5-1.5c-2.2 0-3.8.5-5 1.5" />
      <path d="M10 5.8v10" />
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

export function IconChevronUp(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M6 12l4-4 4 4" />
    </svg>
  );
}

export function IconLocation(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M10 17.5s5.5-4.8 5.5-9.2A5.5 5.5 0 0 0 4.5 8.3c0 4.4 5.5 9.2 5.5 9.2z" />
      <circle cx="10" cy="8.5" r="1.8" />
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

export function IconMessage(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h6a2.5 2.5 0 0 1 2.5 2.5v4A2.5 2.5 0 0 1 13 12H9l-4.5 4v-4.5A2.5 2.5 0 0 1 2 9V5.5" />
      <path d="M7 7h6" />
      <path d="M7 9.5h3.5" />
    </svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M10 3.5v8" />
      <path d="M6.5 8.5L10 12l3.5-3.5" />
      <path d="M4 15.5h12" />
    </svg>
  );
}

export function IconTextPlay(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4 5.5h8" />
      <path d="M4 9h6" />
      <path d="M4 12.5h5" />
      <path d="M12.5 10.5l4 2.5-4 2.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconDesktopLyric(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="3" y="4" width="14" height="9.5" rx="1.5" />
      <path d="M7 16h6" />
      <path d="M10 13.5V16" />
      <path d="M6 7.5h8" />
      <path d="M7.5 10h5" />
    </svg>
  );
}

export function IconSpinner(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="10" cy="10" r="7" stroke-dasharray="32" stroke-dashoffset="8" />
    </svg>
  );
}
