import { ImageResponse } from "next/og";

// App icon (home-screen / PWA). Generated so there's no binary asset to manage.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 280,
          fontWeight: 800,
          letterSpacing: -10,
        }}
      >
        FK
      </div>
    ),
    { ...size },
  );
}
