import { renderAppIcon } from "@/lib/pwa-icon";

/** iOS home-screen icon. iOS applies its own rounding, so this is square. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderAppIcon(180);
}
