import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/logo-data";

export const alt = "ScholarLens: a research workspace where every AI answer cites the page it came from";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #0f1726 0%, #1b1f3d 55%, #2a1d4f 100%)",
          color: "#f0efec",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_DATA_URI} width={84} height={84} alt="" />
          <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>ScholarLens</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2, maxWidth: 980 }}>
            Read papers with an AI that cites the exact page.
          </div>
          <div style={{ fontSize: 30, color: "#c3c2b7", maxWidth: 980 }}>
            Highlight a passage to ask, explain or verify it · evidence matrices · ideas checked against prior work
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 24, color: "#8cb8f0" }}>rstackhub.in · free during beta</div>
      </div>
    ),
    size,
  );
}
