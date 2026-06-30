// Compact icon set for the PLC Explorer tree + detail panels. Keyed by the
// `icon` string emitted by buildTree(). Colors hint at node type the way an
// IDE file-tree does, so the structure is scannable at a glance.

export function NodeIcon({ name, className = "w-3.5 h-3.5" }: { name: string; className?: string }) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "cpu":
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" rx="1.5" />
          <path d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case "ladder":
      return (
        <svg {...common}>
          <path d="M4 3v18M20 3v18M4 8h16M4 14h16" />
        </svg>
      );
    case "code":
      return (
        <svg {...common}>
          <path d="M8 6 3 12l5 6M16 6l5 6-5 6" />
        </svg>
      );
    case "tag":
      return (
        <svg {...common}>
          <path d="M20.6 13.4 12 22l-9-9V3h10z" />
          <circle cx="7.5" cy="7.5" r="1.2" />
        </svg>
      );
    case "alias":
      return (
        <svg {...common}>
          <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
          <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
        </svg>
      );
    case "chip":
      return (
        <svg {...common}>
          <rect x="7" y="7" width="10" height="10" rx="1" />
          <path d="M10 2v3M14 2v3M10 19v3M14 19v3M2 10h3M2 14h3M19 10h3M19 14h3" />
        </svg>
      );
    case "braces":
      return (
        <svg {...common}>
          <path d="M8 3c-2 0-2 2-2 4s0 3-2 3c2 0 2 2 2 4s0 4 2 4M16 3c2 0 2 2 2 4s0 3 2 3c-2 0-2 2-2 4s0 4-2 4" />
        </svg>
      );
    case "plug":
      return (
        <svg {...common}>
          <path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0zM12 16v6" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}

export function Chevron({ open, className = "w-3 h-3" }: { open: boolean; className?: string }) {
  return (
    <svg
      className={`${className} transition-transform ${open ? "rotate-90" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
