import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fireblade Web",
  description: "Company calls, people and device management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}