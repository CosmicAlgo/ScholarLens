// ScholarLens mark: a lens over a page, picking out one highlighted line of evidence.

export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="sl-g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2a78d6" />
          <stop offset="1" stopColor="#7b5cf0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#sl-g)" />
      <rect x="7" y="5.5" width="13.5" height="17.5" rx="2.2" fill="#fff" fillOpacity="0.95" />
      <path d="M9.6 9.6h8.3M9.6 12.6h6" stroke="#7b5cf0" strokeOpacity="0.55" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="19" cy="18.5" r="6" fill="#ffffff" fillOpacity="0.18" stroke="#fff" strokeWidth="2.3" />
      <path d="M15.6 18.5h6.8" stroke="#fde047" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M23.4 22.9 26.4 25.9" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M25.5 4.8l.75 1.85 1.85.75-1.85.75-.75 1.85-.75-1.85-1.85-.75 1.85-.75z" fill="#fff" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight text-[0.98rem]">
      <LogoMark size={26} />
      <span>
        Scholar<span className="text-accent-ink">Lens</span>
      </span>
    </span>
  );
}
