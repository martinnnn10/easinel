"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/TopBar";

interface Session {
  id: string;
  title: string;
  assetName: string | null;
  messageCount: number;
  updatedAt: number;
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <TopBar
        title="Troubleshooting Sessions"
        subtitle="Every diagnosis becomes searchable organizational knowledge"
        right={
          <button
            onClick={() => router.push("/")}
            className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-1.5 hover:brightness-110"
          >
            + New session
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-6">
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-[var(--color-border)] rounded-2xl">
              <div className="w-12 h-12 mx-auto rounded-xl bg-[var(--color-surface-2)] grid place-items-center mb-4 text-xl">🧭</div>
              <p className="text-[15px] font-medium">No troubleshooting sessions yet</p>
              <p className="text-[var(--color-muted)] text-sm mt-1 max-w-sm mx-auto">
                Ask the Copilot your first maintenance question. Each session is
                saved with its diagnosis, sources, and resolution — and becomes
                part of the equipment's history.
              </p>
              <button
                onClick={() => router.push("/")}
                className="mt-5 text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-4 py-2 hover:brightness-110"
              >
                Ask your first question
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => router.push(`/?c=${s.id}`)}
                  className="w-full text-left rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-2)] transition flex items-center gap-3"
                >
                  <span className="w-9 h-9 rounded-lg bg-[var(--color-surface-2)] grid place-items-center text-[var(--color-accent)] shrink-0">💬</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium truncate">{s.title}</p>
                    <p className="text-[11px] text-[var(--color-faint)] mt-0.5">
                      {s.assetName ? `${s.assetName} · ` : ""}
                      {s.messageCount} messages · {timeAgo(s.updatedAt)}
                    </p>
                  </div>
                  <span className="text-[var(--color-faint)]">→</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
