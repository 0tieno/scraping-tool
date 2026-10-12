import { createContext, useCallback, useContext, useState, type CSSProperties, type ReactNode } from "react";
import { countdown, TIER_LABELS } from "../format";
import type { Tier } from "../types";

export function ScoreRing({ score, tier, large = false }: { score: number; tier: Tier; large?: boolean }) {
  return (
    <div className={`score t-${tier}${large ? " lg" : ""}`} style={{ "--p": score } as CSSProperties} title={`Relevance ${score}/100 (${TIER_LABELS[tier]})`}>
      <span>{score}</span>
    </div>
  );
}

export function TierPill({ tier }: { tier: Tier }) {
  return <span className={`pill tier t-${tier}`}>{TIER_LABELS[tier]}</span>;
}

export function Due({ deadline }: { deadline: string | null }) {
  const c = countdown(deadline);
  return <span className={`due ${c.urgency}`}>{c.label}</span>;
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="opp-list" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="opp" key={i} style={{ cursor: "default" }}>
          <div className="skeleton" style={{ width: 46, height: 46, borderRadius: "50%" }} />
          <div style={{ display: "grid", gap: 8 }}>
            <div className="skeleton" style={{ height: 14, width: `${60 + ((i * 13) % 30)}%` }} />
            <div className="skeleton" style={{ height: 11, width: "40%" }} />
          </div>
          <div className="skeleton" style={{ height: 12, width: 60 }} />
        </div>
      ))}
    </div>
  );
}

type IconName = "radar" | "board" | "sources" | "settings" | "search" | "external" | "file" | "spark" | "refresh" | "download" | "back" | "copy" | "play";

const PATHS: Record<IconName, ReactNode> = {
  radar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12l6-6" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="11" rx="1.5" />
      <rect x="17" y="4" width="4" height="7" rx="1.5" />
    </>
  ),
  sources: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  spark: <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  back: <path d="M15 18l-6-6 6-6" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </>
  ),
  play: <path d="M7 4v16l13-8z" />,
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function BrandMark() {
  // Kipeo means "butterfly" in Swahili — a stylised butterfly over a radar sweep.
  return (
    <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="var(--brand)" />
      <circle cx="20" cy="20" r="12" fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="1.5" />
      <path d="M20 20c-2-6-8-9-11-6s1 8 11 6zm0 0c2-6 8-9 11-6s-1 8-11 6zm0 0c-1.5 4-5.5 7-7.5 5s1-5.5 7.5-5zm0 0c1.5 4 5.5 7 7.5 5s-1-5.5-7.5-5z" fill="white" />
      <circle cx="20" cy="20" r="1.6" fill="var(--accent)" />
    </svg>
  );
}

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const show = useCallback((m: string) => {
    setMessage(m);
    window.setTimeout(() => setMessage((cur) => (cur === m ? null : cur)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
