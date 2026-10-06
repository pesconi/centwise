import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Centwise",
  description: "Personal finance with clarity."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}