'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { aiAllOn, type AiFeature, type AiFeatureState, type AiFeatureStates } from '@sitebook/shared';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/components/language-provider';

/**
 * Where each AI feature stands for this company, for client components.
 *
 * Filled from `/me` by the dashboard shell, so a button can be hidden or explained before anybody
 * presses it, rather than pressed and refused. The API refuses regardless — this is the courtesy,
 * not the control.
 *
 * Outside a provider (a test rendering one component) everything reads as on, which is what every
 * component did before these controls existed.
 */
const AiFeaturesContext = createContext<AiFeatureStates>(aiAllOn());

export function AiFeaturesProvider({ states, children }: { states: AiFeatureStates | undefined; children: ReactNode }) {
  return <AiFeaturesContext.Provider value={states ?? aiAllOn()}>{children}</AiFeaturesContext.Provider>;
}

/** One feature's state: `on`, or why it is not. */
export function useAiFeature(feature: AiFeature): AiFeatureState {
  return useContext(AiFeaturesContext)[feature];
}

/**
 * Whether a person decided this feature is off — the company, the operator, or a region choice.
 *
 * `not_configured` is deliberately not "blocked" here: a server with no key has always shown these
 * buttons and let the API answer "not configured on this deployment", and the controls do not change
 * that. The two states stay distinct — the settings screen says "not set up on this server" for one
 * and "turned off" for the other.
 */
export function aiBlocked(state: AiFeatureState): boolean {
  return state === 'off_company' || state === 'off_platform' || state === 'region_unavailable';
}

export function useAiBlocked(feature: AiFeature): boolean {
  return aiBlocked(useAiFeature(feature));
}

/**
 * The short sentence shown where an AI button would have been.
 *
 * Says *who* turned it off, because the remedy differs: an owner can turn a company switch back on
 * in Settings, nobody in the company can do anything about the server.
 */
export function aiOffMessage(state: AiFeatureState, t: (english: string) => string): string | null {
  switch (state) {
    case 'on':
      return null;
    case 'off_company':
      return t('AI is turned off for your company.');
    case 'off_platform':
      return t('This AI feature is turned off on this server.');
    case 'region_unavailable':
      return t('AI is unavailable: the region your company chose is not offered on this server.');
    case 'not_configured':
      return t('AI is not set up on this server.');
  }
}

/**
 * The note itself. `manual` names the way that still works — "Type the bill in by hand" — so the
 * note is an instruction rather than a dead end. Renders nothing unless somebody switched it off.
 */
export function AiOffNote({
  feature,
  manual,
  className,
}: {
  feature: AiFeature;
  manual?: string;
  className?: string;
}) {
  const { t } = useLanguage();
  const state = useAiFeature(feature);
  const message = aiBlocked(state) ? aiOffMessage(state, t) : null;
  if (!message) return null;
  return (
    <p className={cn('flex items-start gap-1.5 text-[12.5px] leading-relaxed text-ink-muted', className)}>
      <Sparkles className="mt-0.5 size-3.5 flex-none" aria-hidden />
      <span>
        {message}
        {manual ? ` ${manual}` : ''}
      </span>
    </p>
  );
}
