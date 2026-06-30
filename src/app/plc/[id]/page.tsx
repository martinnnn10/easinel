"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Tree, type TreeNode } from "@/components/plc/Tree";
import { DetailPanel, type NodeDetail } from "@/components/plc/DetailPanel";
import { NodeIcon } from "@/components/plc/icons";

interface Meta {
  id: string;
  filename: string;
  source: string;
  fidelity: string;
  fidelityNote: string | null;
  controller: string;
  processorType: string | null;
  softwareRevision: string | null;
  exportDate: string | null;
  stats: Record<string, number>;
}

interface SearchHit {
  id: string;
  type: string;
  label: string;
  context: string;
}

// Collect ancestor ids for a node id so we can auto-expand the tree to it.
function ancestorsOf(nodeId: string): string[] {
  const out: string[] = [];
  const [type, ...rest] = nodeId.split(":");
  const path = rest.join(":");
  if (type === "routine") {
    const prog = path.split("/")[0];
    out.push("group:programs", `program:${prog}`, "group:tasks");
    // also expand any task that may contain it (cheap: expand all task groups)
  } else if (type === "tag") {
    const parts = path.split("/");
    if (parts[0] === "controller") out.push("group:ctags");
    else {
      out.push("group:programs", `program:${parts[1]}`, `group:ptags:${parts[1]}`);
    }
  } else if (type === "program") {
    out.push("group:programs", "group:tasks");
  } else if (type === "task") {
    out.push("group:tasks");
  } else if (type === "aoi") {
    out.push("group:aois");
  } else if (type === "udt") {
    out.push("group:udts");
  } else if (type === "module") {
    out.push("group:modules");
  }
  return out;
}

export default function PlcExplorerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();

  const [meta, setMeta] = useState<Meta | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load tree + meta.
  useEffect(() => {
    fetch(`/api/plc/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || "Failed to load project");
        return r.json();
      })
      .then((j) => {
        setMeta(j.meta);
        setTree(j.tree);
        // Expand the first couple of levels for a welcoming initial view.
        const init = new Set<string>(["group:tasks", "group:programs"]);
        for (const top of j.tree as TreeNode[]) {
          if (top.group && top.children && top.children.length <= 6) init.add(top.id);
        }
        setExpanded(init);
        // Deep-link via ?node=, else default to controller.
        const initial = search.get("node") || "controller";
        selectNode(initial, j.tree);
      })
      .catch((e) => setLoadError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadDetail = useCallback(
    async (nodeId: string) => {
      setDetailLoading(true);
      try {
        const r = await fetch(`/api/plc/${id}/node?nodeId=${encodeURIComponent(nodeId)}`);
        const json = (await r.json()) as NodeDetail;
        setDetail(json);
      } catch (e) {
        setDetail({
          found: false,
          type: "unknown",
          id: nodeId,
          title: nodeId,
          notice: `Could not load this node: ${(e as Error).message}`,
          data: {},
          breadcrumb: [],
        });
      } finally {
        setDetailLoading(false);
      }
    },
    [id]
  );

  const selectNode = useCallback(
    (nodeId: string, treeForExpand?: TreeNode[]) => {
      setSelectedId(nodeId);
      // expand ancestors so the node is visible in the tree
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const a of ancestorsOf(nodeId)) next.add(a);
        // also expand any task groups that contain the program
        void treeForExpand;
        return next;
      });
      loadDetail(nodeId);
      // reflect in URL (shallow)
      const url = new URL(window.location.href);
      url.searchParams.set("node", nodeId);
      window.history.replaceState({}, "", url.toString());
    },
    [loadDetail]
  );

  const onToggle = useCallback((nid: string, forced?: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const willOpen = forced ?? !next.has(nid);
      if (willOpen) next.add(nid);
      else next.delete(nid);
      return next;
    });
  }, []);

  // Debounced search.
  useEffect(() => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/plc/${id}/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((j) => setHits(j.hits ?? []))
        .catch(() => setHits([]));
    }, 160);
    return () => clearTimeout(t);
  }, [query, id]);

  // Cmd/Ctrl+F focuses the explorer search instead of the browser's.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const breadcrumb = detail?.breadcrumb ?? [];

  if (loadError) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="PLC Explorer" subtitle="Project could not be opened" />
        <div className="flex-1 grid place-items-center px-6">
          <div className="max-w-md text-center">
            <div className="text-[14px] font-semibold mb-1">We couldn’t open this PLC project</div>
            <p className="text-[13px] text-[var(--color-muted)]">{loadError}</p>
            <button onClick={() => router.push("/plc")} className="mt-4 text-[12.5px] text-[var(--color-accent)] hover:underline">
              ← Back to PLC projects
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title={meta?.controller || "PLC Explorer"}
        subtitle={meta ? `${meta.filename} · ${meta.source.toUpperCase()}${meta.processorType ? ` · ${meta.processorType}` : ""}` : "Loading…"}
        right={
          meta && (
            <span
              className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded border ${
                meta.fidelity === "full"
                  ? "border-[var(--color-green)]/40 text-[var(--color-green)]"
                  : "border-[var(--color-amber)]/40 text-[var(--color-amber)]"
              }`}
            >
              {meta.fidelity === "full" ? "Full detail" : "Summary only"}
            </span>
          )
        }
      />

      {meta?.fidelity !== "full" && (
        <div className="px-5 py-3 bg-[rgba(245,165,36,0.08)] border-b border-[var(--color-amber)]/30">
          <div className="flex items-start gap-2.5 max-w-3xl">
            <span className="text-[var(--color-amber)] mt-0.5">⚠️</span>
            <div className="min-w-0">
              <p className="text-[12.5px] text-[#f1d9a8] leading-snug">
                {meta?.fidelityNote ||
                  "This is a compressed Rockwell .ACD binary — ladder logic, tags, and rung comments are not stored in readable form, so only a summary is available here."}
              </p>
              <div className="mt-2 text-[12px] text-[var(--color-muted)]">
                <span className="text-[var(--color-text)] font-medium">Get full logic in ~30 seconds:</span>{" "}
                open the project in <span className="text-[var(--color-text)]">Studio 5000</span> →
                <span className="text-[var(--color-text)]"> File → Save As</span> → choose
                <span className="text-[var(--color-text)]"> “.L5X (XML)”</span> → upload that L5X here.
                EAS parses L5X into the full Explorer (programs, routines, rungs, tags, cross-references).
              </div>
              <div className="mt-2">
                <a
                  href="/knowledge"
                  className="inline-block text-[12px] font-medium rounded-md bg-[var(--color-accent)] text-white px-3 py-1 hover:brightness-110"
                >
                  Upload the L5X export →
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Tree sidebar */}
        <div className="w-[300px] shrink-0 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-surface)]/40">
          <div className="p-2.5 border-b border-[var(--color-border)]">
            <div className="relative">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setQuery("");
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder="Search (⌘F)…"
                className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] pl-8 pr-3 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent)]"
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-faint)]">
                <SearchIcon />
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-1.5">
            {hits !== null ? (
              <div className="text-[12.5px]">
                <div className="px-2 py-1 text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
                  {hits.length} result{hits.length === 1 ? "" : "s"}
                </div>
                {hits.map((h) => (
                  <button
                    key={h.id + h.label}
                    onClick={() => {
                      selectNode(h.id);
                      setQuery("");
                    }}
                    className="w-full text-left flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--color-surface-2)]"
                  >
                    <span className="text-[var(--color-faint)] shrink-0">
                      <NodeIcon name={iconFor(h.type)} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{h.label}</span>
                      <span className="block truncate text-[10.5px] text-[var(--color-faint)]">{h.context}</span>
                    </span>
                  </button>
                ))}
                {hits.length === 0 && <div className="px-2 py-2 text-[12px] text-[var(--color-faint)] italic">No matches.</div>}
              </div>
            ) : (
              <Tree nodes={tree} selectedId={selectedId} expanded={expanded} onToggle={onToggle} onSelect={(n) => selectNode(n.id)} />
            )}
          </div>
        </div>

        {/* Detail */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Breadcrumb */}
          <div className="h-9 shrink-0 border-b border-[var(--color-border)] flex items-center px-4 gap-1 text-[12px] text-[var(--color-muted)] overflow-x-auto">
            <button
              onClick={() => router.back()}
              className="hover:text-[var(--color-accent)] shrink-0 flex items-center gap-1 mr-1"
              title="Back to where you came from"
            >
              ← Back
            </button>
            <span className="text-[var(--color-faint)] shrink-0">·</span>
            <button onClick={() => router.push("/plc")} className="hover:text-[var(--color-accent)] shrink-0">
              Projects
            </button>
            {breadcrumb.map((b) => (
              <span key={b.id} className="flex items-center gap-1 shrink-0">
                <span className="text-[var(--color-faint)]">/</span>
                <button onClick={() => selectNode(b.id)} className="hover:text-[var(--color-accent)] truncate max-w-[200px]">
                  {b.label}
                </button>
              </span>
            ))}
          </div>

          <div className="flex-1 min-h-0">
            <DetailPanel projectId={id} detail={detail} loading={detailLoading} onNavigate={(nid) => selectNode(nid)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function iconFor(type: string): string {
  switch (type) {
    case "program":
      return "folder";
    case "routine":
      return "ladder";
    case "tag":
      return "tag";
    case "aoi":
      return "chip";
    case "udt":
      return "braces";
    case "module":
      return "plug";
    default:
      return "tag";
  }
}

function SearchIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
