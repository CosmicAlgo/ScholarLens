import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/logo-data";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={LOGO_DATA_URI} width={180} height={180} alt="" />
    ),
    size,
  );
}
