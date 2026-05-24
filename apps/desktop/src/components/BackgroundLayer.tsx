import { CoverBlurBg } from "./appearance/CoverBlurBg";

interface BackgroundLayerProps {
  coverUrl: string | null;
  enabled: boolean;
  blur?: number;
  maskOpacity?: number;
}

export function BackgroundLayer(props: BackgroundLayerProps) {
  return <CoverBlurBg {...props} />;
}
