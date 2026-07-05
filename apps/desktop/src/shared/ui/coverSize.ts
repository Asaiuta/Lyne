/**
 * NCM 图片多尺寸 URL 工具
 *
 * NCM CDN 支持通过 `?param=WyH` 后缀请求指定尺寸的图片。
 * 例如: `https://p1.music.126.net/xxx.jpg?param=300y300`
 */

export type CoverSize = "s" | "m" | "l" | "xl";

const SIZE_MAP: Record<CoverSize, number> = {
  s: 100,
  m: 300,
  l: 1024,
  xl: 1920,
};

/**
 * 将 NCM 图片 URL 转换为指定尺寸
 * @param url 原始图片 URL（picUrl / img1v1Url / coverUrl 等）
 * @param size 尺寸档位 s(100) / m(300) / l(1024) / xl(1920)
 * @returns 带 ?param= 的尺寸 URL，若 url 为空则返回 undefined
 */
export function coverSizeUrl(url: string | null | undefined, size: CoverSize): string | undefined {
  if (!url) return undefined;
  const px = SIZE_MAP[size];
  if (!/^https?:\/\//i.test(url)) return url;

  const https = url.replace(/^http:/i, "https:");
  try {
    const parsed = new URL(https);
    parsed.searchParams.set("param", `${px}y${px}`);
    return parsed.toString();
  } catch {
    const separator = https.includes("?") ? "&" : "?";
    return `${https}${separator}param=${px}y${px}`;
  }
}

/**
 * 根据显示像素选择合适的尺寸档位
 * @param displayPx 显示区域的像素宽度（正方形只需宽度）
 */
export function autoCoverSize(displayPx: number): CoverSize {
  if (displayPx <= 120) return "s";
  if (displayPx <= 320) return "m";
  if (displayPx <= 1080) return "l";
  return "xl";
}
