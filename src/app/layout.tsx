import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "EAS Copilot — The AI Technician",
  description:
    "The AI technician every maintenance department wishes they had. Diagnose equipment faults in seconds, grounded in your manuals, drawings, and repair history.",
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
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
