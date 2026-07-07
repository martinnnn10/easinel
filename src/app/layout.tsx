import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "EAS Maintenance Intelligence",
  description:
    "AI maintenance intelligence for industrial teams — every repair, manual, work order, drawing, and technician note becomes machine memory your team can use the next time equipment goes down.",
};

// viewport-fit=cover lets the at-the-machine field view pad its sticky footer
// past the iOS home indicator via env(safe-area-inset-*).
export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/* Keyboard/AT users can jump straight past the nav to the content. */}
        <a href="#main-content" className="skip-link">Skip to content</a>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 min-w-0 flex flex-col overflow-hidden"
          >
            <AppShell>{children}</AppShell>
          </main>
        </div>
      </body>
    </html>
  );
}
