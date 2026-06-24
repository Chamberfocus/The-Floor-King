import { ImageResponse } from "next/og";

// Apple touch icon (iOS "Add to Home Screen").
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0b0c10 0%, #1f2937 100%)",
          color: "#ffffff",
          fontSize: 96,
          fontWeight: 800,
          letterSpacing: -4,
        }}
      >
        FK
      </div>
    ),
    { ...size },
  );
}
