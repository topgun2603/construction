'use client';

import { useMemo } from 'react';
import qrcode from 'qrcode-generator';
import { cn } from '@/lib/utils';

/**
 * A QR code drawn as one SVG path, for an authenticator app to scan.
 *
 * Drawn here in the browser from the `otpauth://` URI rather than fetched as an image: the URI holds
 * the secret, and an image service would be one more place it went.
 *
 * Always black on white, in the dark theme too, and the one place the colours are not tokens: many
 * authenticator scanners cannot read an inverted code, and a themed one would be unscannable for
 * exactly the people who chose dark mode. The white quiet zone is part of the symbol.
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => {
    // Error correction M: a phone held at an angle to a laptop screen still reads it.
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    let d = '';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (code.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
      }
    }
    return { size: count + 8, path: d };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn('rounded-card', className)}
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
