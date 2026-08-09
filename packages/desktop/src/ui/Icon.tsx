/** Minimal stroke icon set (24 viewBox), consistent with the CLI's restraint. */

export type IconName =
  | "plus"
  | "clock"
  | "message"
  | "blocks"
  | "chevron"
  | "folder"
  | "settings"
  | "panel"
  | "send"
  | "check"
  | "x"
  | "file"
  | "git"
  | "terminal"
  | "refresh"
  | "alert"
  | "play"
  | "pause"
  | "stop"
  | "home"
  | "seal"
  | "coin"
  | "wave";

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v5l3 2" />
      </>
    ),
    message: (
      <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3v-3A2.5 2.5 0 0 1 4 12.5v-6Z" />
    ),
    blocks: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1.5" />
        <rect x="14" y="4" width="6" height="6" rx="1.5" />
        <rect x="4" y="14" width="6" height="6" rx="1.5" />
        <path d="M17 14v6M14 17h6" />
      </>
    ),
    chevron: <path d="m9 6 6 6-6 6" />,
    folder: (
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6H10l2 2h6.5A1.5 1.5 0 0 1 20 9.5v7A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-9Z" />
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.8-1L14.4 3h-4.8l-.4 3.1a8 8 0 0 0-1.8 1l-2.4-1-2 3.4L5.1 11a7 7 0 0 0 0 2L3 14.5l2 3.4 2.4-1a8 8 0 0 0 1.8 1l.4 3.1h4.8l.4-3.1a8 8 0 0 0 1.8-1l2.4 1 2-3.4-2.1-1.5a7 7 0 0 0 .1-1Z" />
      </>
    ),
    panel: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16" />
      </>
    ),
    send: <path d="m5 12 14-7-4 14-3-5-7-2Zm7 2 3-3" />,
    check: <path d="m5 12 4 4L19 6" />,
    x: <path d="M6 6l12 12M18 6L6 18" />,
    file: (
      <>
        <path d="M7 3h7l4 4v14H7V3Z" />
        <path d="M14 3v5h5" />
      </>
    ),
    git: (
      <>
        <circle cx="7" cy="5" r="2" />
        <circle cx="7" cy="19" r="2" />
        <circle cx="17" cy="8" r="2" />
        <path d="M7 7v10M9 14c4 0 6-2 6-4" />
      </>
    ),
    terminal: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="m7 9 3 3-3 3M13 15h4" />
      </>
    ),
    refresh: (
      <>
        <path d="M19 8a7 7 0 0 0-12-2L5 8" />
        <path d="M5 4v4h4M5 16a7 7 0 0 0 12 2l2-2" />
        <path d="M19 20v-4h-4" />
      </>
    ),
    alert: (
      <>
        <path d="M12 4 3 19h18L12 4Z" />
        <path d="M12 10v4M12 16.5v.5" />
      </>
    ),
    play: <path d="M8 5.5v13l11-6.5-11-6.5Z" />,
    pause: <path d="M8 5v14M16 5v14" />,
    stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
    home: <path d="m4 11 8-7 8 7v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20v-9Z" />,
    seal: (
      <>
        <rect x="5" y="5" width="14" height="14" rx="2.5" />
        <path d="M9.5 9.5h5M9.5 12h5M9.5 14.5h3" />
      </>
    ),
    coin: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7.5v9M9.2 9.6c0-1 1.2-1.8 2.8-1.8s2.8.8 2.8 1.8-1 1.6-2.8 2-2.8 1-2.8 2 1.2 1.8 2.8 1.8 2.8-.8 2.8-1.8" />
      </>
    ),
    wave: (
      <path d="M4 12c1.5-3 3-4.5 4-4.5S10 10 10 12s1.5 4.5 2.5 4.5S15 14 16 12s1.5-4.5 2.5-4.5S20 9 20 12" />
    ),
  };
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
