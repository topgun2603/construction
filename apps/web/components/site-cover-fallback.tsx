import { cn } from '@/lib/utils';

/**
 * The card image for a site that has no photograph.
 *
 * Generated rather than a stock photo, for two reasons. A photograph of somebody else's building on
 * your site card is a small lie, and it is the kind that gets screenshotted into a client meeting. And
 * a single shared placeholder would make every unphotographed site look identical — which is the
 * opposite of what a cover image is for.
 *
 * So each site gets its own: the blueprint grid the login screens already use, a tint chosen from the
 * design palette by hashing the site id, and its initials. Same site, same cover, every time. Inline
 * SVG, so it costs nothing to download and stays crisp at any density.
 */

/**
 * Tints drawn from the app's own palette rather than a spun hue wheel.
 *
 * A random hue would eventually land on something that fights the violet accent or reads as a status
 * colour — a site card is not the place to accidentally invent "red means blocked".
 */
const TINTS = [
  { from: '#6C4CE0', to: '#4A3AA8' }, // accent violet
  { from: '#1B1A2E', to: '#363357' }, // ink
  { from: '#12805C', to: '#0E6B4E' }, // done green
  { from: '#A86A08', to: '#85510A' }, // pending amber
  { from: '#3C5A9A', to: '#2A3F6E' }, // blueprint blue
] as const;

/** Stable across renders and machines: the same site must not change colour on reload. */
function tintFor(seed: string): (typeof TINTS)[number] {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    // djb2-ish. Not cryptographic — it only has to spread five ways and never move.
    hash = (hash * 33 + seed.charCodeAt(index)) >>> 0;
  }
  return TINTS[hash % TINTS.length] as (typeof TINTS)[number];
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '··';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
}

export function SiteCoverFallback({
  seed,
  name,
  className,
}: {
  /** The site id, so the cover is stable even if the site is renamed. */
  seed: string;
  name: string;
  className?: string;
}) {
  const tint = tintFor(seed);
  const label = initials(name);
  // Scoped to the seed so two covers on one page cannot share a gradient id.
  const gradientId = `cover-${seed.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <svg
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid slice"
      className={cn('h-full w-full', className)}
      role="img"
      aria-label={`${name} — no photograph yet`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={tint.from} />
          <stop offset="100%" stopColor={tint.to} />
        </linearGradient>
        <pattern id={`${gradientId}-grid`} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="#fff" strokeOpacity="0.09" strokeWidth="1" />
        </pattern>
      </defs>

      <rect width="320" height="180" fill={`url(#${gradientId})`} />
      <rect width="320" height="180" fill={`url(#${gradientId}-grid)`} />

      {/*
        A structure rather than an icon: two columns and a beam, the simplest thing that reads as a
        building under construction at 40 pixels tall.
      */}
      <g stroke="#fff" strokeOpacity="0.22" strokeWidth="2.5" fill="none" strokeLinecap="square">
        <path d="M232 132V72" />
        <path d="M266 132V72" />
        <path d="M300 132V72" />
        <path d="M222 72h88" />
        <path d="M222 96h88" />
        <path d="M222 120h88" />
      </g>

      <text
        x="24"
        y="118"
        fill="#fff"
        fillOpacity="0.9"
        fontSize="56"
        fontWeight="700"
        letterSpacing="-2"
        fontFamily="var(--font-plex-sans), ui-sans-serif, system-ui, sans-serif"
      >
        {label}
      </text>
    </svg>
  );
}
