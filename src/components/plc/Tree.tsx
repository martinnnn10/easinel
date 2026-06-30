"use client";

import { useEffect, useMemo, useRef } from "react";
import { NodeIcon, Chevron } from "./icons";

export interface TreeNode {
  id: string;
  type: string;
  label: string;
  sublabel?: string;
  icon: string;
  children?: TreeNode[];
  group?: boolean;
}

interface FlatRow {
  node: TreeNode;
  depth: number;
  hasChildren: boolean;
}

// Flatten the tree into the currently-visible rows given the expanded set.
// This is what makes ArrowUp/ArrowDown behave like a real IDE tree.
function flatten(nodes: TreeNode[], expanded: Set<string>, depth = 0, out: FlatRow[] = []): FlatRow[] {
  for (const node of nodes) {
    const hasChildren = Boolean(node.children && node.children.length);
    out.push({ node, depth, hasChildren });
    if (hasChildren && expanded.has(node.id)) {
      flatten(node.children!, expanded, depth + 1, out);
    }
  }
  return out;
}

export function Tree({
  nodes,
  selectedId,
  expanded,
  onToggle,
  onSelect,
}: {
  nodes: TreeNode[];
  selectedId: string | null;
  expanded: Set<string>;
  onToggle: (id: string, next?: boolean) => void;
  onSelect: (node: TreeNode) => void;
}) {
  const rows = useMemo(() => flatten(nodes, expanded), [nodes, expanded]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the selected row scrolled into view (e.g. when navigated by search).
  useEffect(() => {
    if (!selectedId || !containerRef.current) return;
    const el = containerRef.current.querySelector<HTMLElement>(`[data-node-id="${cssEscape(selectedId)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const move = (delta: number) => {
    const idx = rows.findIndex((r) => r.node.id === selectedId);
    const next = rows[Math.max(0, Math.min(rows.length - 1, (idx < 0 ? 0 : idx) + delta))];
    if (next) {
      onSelect(next.node);
      const el = containerRef.current?.querySelector<HTMLElement>(`[data-node-id="${cssEscape(next.node.id)}"]`);
      el?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent, row: FlatRow) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (row.hasChildren && !expanded.has(row.node.id)) onToggle(row.node.id, true);
        else if (row.hasChildren) move(1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (row.hasChildren && expanded.has(row.node.id)) onToggle(row.node.id, false);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (row.hasChildren) onToggle(row.node.id);
        if (!row.node.group) onSelect(row.node);
        break;
    }
  };

  return (
    <div ref={containerRef} role="tree" className="text-[12.5px] select-none">
      {rows.map((row) => {
        const selected = row.node.id === selectedId;
        const isGroup = row.node.group;
        return (
          <div
            key={row.node.id}
            data-node-id={row.node.id}
            role="treeitem"
            aria-expanded={row.hasChildren ? expanded.has(row.node.id) : undefined}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, row)}
            onClick={() => {
              if (row.hasChildren) onToggle(row.node.id);
              if (!isGroup) onSelect(row.node);
            }}
            className={`group flex items-center gap-1 rounded-md pr-2 py-[3px] cursor-pointer outline-none ${
              selected
                ? "bg-[var(--color-accent-soft)] text-[var(--color-text)]"
                : "hover:bg-[var(--color-surface-2)] text-[var(--color-muted)]"
            } focus:ring-1 focus:ring-[var(--color-accent)]`}
            style={{ paddingLeft: 6 + row.depth * 14 }}
          >
            <span className="w-3.5 shrink-0 grid place-items-center text-[var(--color-faint)]">
              {row.hasChildren ? <Chevron open={expanded.has(row.node.id)} /> : null}
            </span>
            <span
              className={`shrink-0 grid place-items-center ${
                isGroup ? "text-[var(--color-faint)]" : iconColor(row.node.type)
              }`}
            >
              <NodeIcon name={row.node.icon} />
            </span>
            <span className={`truncate ${isGroup ? "uppercase tracking-wide text-[10.5px] text-[var(--color-faint)] font-semibold" : "font-medium"}`}>
              {row.node.label}
            </span>
            {row.node.sublabel && !isGroup && (
              <span className="ml-auto pl-2 text-[10.5px] text-[var(--color-faint)] truncate shrink-0 max-w-[45%]">
                {row.node.sublabel}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function iconColor(type: string): string {
  switch (type) {
    case "controller":
      return "text-[var(--color-accent)]";
    case "task":
      return "text-[var(--color-amber)]";
    case "program":
      return "text-[#c9a3ff]";
    case "routine":
      return "text-[var(--color-green)]";
    case "tag":
      return "text-[#7fb2ff]";
    case "aoi":
      return "text-[#ff9f7f]";
    case "udt":
      return "text-[#f5c542]";
    case "module":
      return "text-[var(--color-muted)]";
    default:
      return "text-[var(--color-muted)]";
  }
}

// Minimal CSS.escape polyfill for attribute selectors (node ids contain / and :).
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}
