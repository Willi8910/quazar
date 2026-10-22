/** `</>` glyph used for "Open in VS Code". */
export function CodeIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5.5 4 1.5 8l4 4M10.5 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Folder glyph used for worktrees. */
export function FolderIcon({ size = 10 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path
        d="M1.75 4.25v8a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.25H2.75a1 1 0 0 0-1 1z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Folder with a plus, for "open a folder from Finder". */
export function FolderPlusIcon({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4">
      <path
        d="M1.75 4.25v8a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.25H2.75a1 1 0 0 0-1 1z"
        strokeLinejoin="round"
      />
      <path d="M8 7.25v4M6 9.25h4" strokeLinecap="round" />
    </svg>
  );
}

/** Plus glyph, sized to match the other icons. */
export function PlusIcon({ size = 11 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M8 2.5v11M2.5 8h11" strokeLinecap="round" />
    </svg>
  );
}

/** Lucide "file-diff": a file with plus and minus, for uncommitted changes. */
export function DiffIcon({ size = 12 }: { size?: number }) {
  return (
    <svg {...lucide} width={size} height={size}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M9 10h6" />
      <path d="M12 13V7" />
      <path d="M9 17h6" />
    </svg>
  );
}

/** Git-fork glyph used for "Fork session". */
export function ForkIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="4" cy="3" r="1.6" />
      <circle cx="12" cy="3" r="1.6" />
      <circle cx="8" cy="13" r="1.6" />
      <path d="M4 4.6v1.4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V4.6M8 8v3.4" strokeLinecap="round" />
    </svg>
  );
}

/** Lucide "eye" (ISC license): hidden tabs are shown. */
export function EyeIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Lucide "eye-off" (ISC license): hide a tab / hidden tabs are not shown. */
export function EyeOffIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

const lucide = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Lucide "chevrons-down-up" (ISC license). */
export function CollapseAllIcon({ size = 13 }: { size?: number }) {
  return (
    <svg {...lucide} width={size} height={size}>
      <path d="m7 20 5-5 5 5" />
      <path d="m7 4 5 5 5-5" />
    </svg>
  );
}

/** Lucide "chevrons-up-down" (ISC license). */
export function ExpandAllIcon({ size = 13 }: { size?: number }) {
  return (
    <svg {...lucide} width={size} height={size}>
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </svg>
  );
}

/** Lucide "folder-tree" (ISC license): group tabs by folder. */
export function FolderTreeIcon({ size = 13 }: { size?: number }) {
  return (
    <svg {...lucide} width={size} height={size}>
      <path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
      <path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
      <path d="M3 5a2 2 0 0 0 2 2h3" />
      <path d="M3 3v13a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

/** Lucide "trash-2" (ISC license). */
export function TrashIcon({ size = 12 }: { size?: number }) {
  return (
    <svg {...lucide} width={size} height={size}>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

export function HistoryIcon({ size = 12 }: { size?: number }) {
  return (
    <svg {...lucide} width={size} height={size}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

export function TerminalIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...lucide} width={size} height={size}>
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </svg>
  );
}

/** Lucide "panel-left" / "panel-right": a window with its sidebar on that side. */
export function PanelIcon({ side = "left", size = 14 }: { side?: "left" | "right"; size?: number }) {
  return (
    <svg {...lucide} width={size} height={size}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d={side === "left" ? "M9 3v18" : "M15 3v18"} />
    </svg>
  );
}

/** A window with an arrow out of it: open in a new window. */
export function WindowIcon({ size = 12 }: { size?: number }) {
  return (
    <svg {...lucide} width={size} height={size}>
      <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="m10 14 11-11" />
    </svg>
  );
}

export function StopIcon({ size = 12 }: { size?: number }) {
  return (
    <svg {...lucide} width={size} height={size}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}
