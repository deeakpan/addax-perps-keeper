import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Addax Perps Keepers",
  description: "gTrade liquidation bots for LiteForge",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "2rem", lineHeight: 1.5 }}>
        {children}
      </body>
    </html>
  );
}
