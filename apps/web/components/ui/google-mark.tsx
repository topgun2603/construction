/**
 * Google's mark, inline.
 *
 * Inline rather than an `<img>` because the CSP on the sign-in pages allows no external images,
 * and it is four paths — cheaper to ship than the request would be.
 *
 * Lives here because three screens draw it: the builder login, the account page that links an
 * address, and the console login. It was copied into the first two before this file existed, which
 * is exactly how a brand mark ends up with three slightly different sets of path data.
 */
export function GoogleMark({ className = 'size-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className={className}>
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.9 2.6 13.7l7.8 6.1C12.3 14 17.6 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.15-3.2-.43-4.7H24v9h12.7c-.55 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.2 6.9-17.3z"
      />
      <path
        fill="#FBBC05"
        d="M10.4 28.2a14.6 14.6 0 0 1 0-8.4l-7.8-6.1a23.6 23.6 0 0 0 0 20.6l7.8-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 47.5c6.2 0 11.5-2 15.3-5.6l-7.6-5.9c-2.1 1.4-4.8 2.3-7.7 2.3-6.4 0-11.7-4.5-13.6-10.4l-7.8 6.1C6.5 42.1 14.6 47.5 24 47.5z"
      />
    </svg>
  );
}
