import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zestar Agency Media Command Center",
  description: "A white-labeled media monitoring dashboard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
