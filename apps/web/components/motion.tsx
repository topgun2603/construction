'use client';

import { motion, useInView, useMotionValue, useSpring } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';

/*
 * Motion is used to explain change, not to decorate. Everything here is short
 * (≤ 0.3s), respects reduced motion through framer's own media handling, and never
 * blocks reading — an owner opening the dashboard on site data should not wait for
 * an animation to finish before the numbers are legible.
 */

const EASE = [0.22, 0.61, 0.36, 1] as const;

/** Page-level entrance. Small offset so it reads as settling, not sliding in. */
export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Container whose children appear in sequence. Pair with `StaggerItem`. */
export function Stagger({
  children,
  className,
  delayChildren = 0,
}: {
  children: ReactNode;
  className?: string;
  delayChildren?: number;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.04, delayChildren } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Counts up to a value when it scrolls into view.
 *
 * `format` receives the interpolated number, so a money tile keeps formatting in
 * one place. Deliberately not used for currency below the rupee: watching paise
 * spin is noise, and the design sets headline money in short form anyway.
 */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString('en-IN'),
  className,
}: {
  value: number;
  format?: (value: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { stiffness: 90, damping: 20, mass: 0.6 });

  useEffect(() => {
    if (inView) motionValue.set(value);
  }, [inView, value, motionValue]);

  useEffect(() => {
    return spring.on('change', (latest) => {
      if (ref.current) ref.current.textContent = format(latest);
    });
  }, [spring, format]);

  // Render the final value in the markup so it is correct without JS and for
  // anything reading the DOM before the spring settles.
  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
