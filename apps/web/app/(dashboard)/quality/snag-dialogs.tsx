'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mic, Plus, Square, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { SNAG_PRIORITIES, SNAG_TRADES, type SnagPriority } from '@sitebook/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/components/language-provider';
import { AiOffNote } from '@/components/ai-features';
import { createSnag, quickSnag, sitePeopleOptions } from '@/lib/quality-actions';
import { ANY, SNAG_PRIORITY } from './labels';
import { FormError, PhotoPicker } from './quality-ui';
import { uploadQualityFile, uploadQualityPhotos } from './upload';

export interface SiteOption {
  id: string;
  name: string;
}

export interface PersonOption {
  id: string;
  name: string;
}

/** The site picker both dialogs open with, unless the dialog was opened from the site itself. */
function SitePicker({
  sites,
  value,
  onChange,
}: {
  sites: SiteOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <Field label={t('Site')}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={t('Choose a site')} />
        </SelectTrigger>
        <SelectContent>
          {sites.map((site) => (
            <SelectItem key={site.id} value={site.id}>
              {site.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** The trades offered as suggestions; anything else can still be typed. */
export function TradeSuggestions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {SNAG_TRADES.map((trade) => (
        <option key={trade} value={trade} />
      ))}
    </datalist>
  );
}

/**
 * A snag written out in full: what, where, whose, by when. For the office, or anybody who already
 * knows who should fix it. Quick capture is the other door, for the person on the slab.
 */
export function NewSnagDialog({
  sites,
  fixedSiteId,
  contractors,
}: {
  sites: SiteOption[];
  fixedSiteId?: string;
  contractors: PersonOption[];
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState(fixedSiteId ?? '');
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [priority, setPriority] = useState<SnagPriority>('medium');
  const [userId, setUserId] = useState(ANY);
  const [contractorId, setContractorId] = useState(ANY);
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Whoever could be given it are the site's own people, so the list follows the site.
  useEffect(() => {
    if (!open || !siteId) {
      setPeople([]);
      return;
    }
    let live = true;
    void sitePeopleOptions(siteId).then((result) => {
      if (live) setPeople(result.ok ? (result.data ?? []) : []);
    });
    return () => {
      live = false;
    };
  }, [open, siteId]);

  function submit(formData: FormData) {
    setError(null);
    const read = (name: string) => String(formData.get(name) ?? '').trim();
    if (!siteId) {
      setError(t('Choose the site'));
      return;
    }
    start(async () => {
      const uploaded = await uploadQualityPhotos(photos, siteId);
      if (!uploaded.ok) {
        setError(t(uploaded.error));
        return;
      }
      const result = await createSnag({
        project_id: siteId,
        title: read('title'),
        description: read('description') || null,
        location: read('location') || null,
        trade: read('trade') || null,
        priority,
        assigned_user_id: userId === ANY ? null : userId,
        assigned_contractor_id: contractorId === ANY ? null : contractorId,
        due_on: read('due_on') || null,
        client_visible: formData.get('client_visible') === 'on',
        photo_keys: uploaded.keys,
      });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not save the snag'));
        return;
      }
      toast.success(`${t('Snag')} #${result.data.number} ${t('raised')}`);
      setOpen(false);
      setPhotos([]);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Plus className="size-4" />
          {t('New snag')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('New snag')}</DialogTitle>
          <DialogDescription>
            {t('Something that is not right and needs fixing before handover. Photos are the “before” picture.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          {!fixedSiteId && <SitePicker sites={sites} value={siteId} onChange={setSiteId} />}
          <Field label={t('What is wrong')} htmlFor="snag-title">
            <Input id="snag-title" name="title" required maxLength={200} placeholder={t('Hollow tiles near the balcony door')} />
          </Field>
          <Field label={t('Details')} htmlFor="snag-description" optional>
            <Textarea id="snag-description" name="description" maxLength={2000} className="min-h-[64px]" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Where')} htmlFor="snag-location" optional>
              <Input id="snag-location" name="location" maxLength={200} placeholder={t('Flat 204, living room')} />
            </Field>
            <Field label={t('Trade')} htmlFor="snag-trade" optional>
              <Input id="snag-trade" name="trade" maxLength={60} list="snag-trades" />
              <TradeSuggestions id="snag-trades" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Priority')}>
              <Select value={priority} onValueChange={(value) => setPriority(value as SnagPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SNAG_PRIORITIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(SNAG_PRIORITY[value].label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('Fix by')} htmlFor="snag-due" optional>
              <Input id="snag-due" name="due_on" type="date" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Given to')} optional>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t('Nobody yet')}</SelectItem>
                  {people.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('Contractor')} optional>
              <Select value={contractorId} onValueChange={setContractorId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t('None')}</SelectItem>
                  {contractors.map((contractor) => (
                    <SelectItem key={contractor.id} value={contractor.id}>
                      {contractor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <label className="flex items-start gap-2 text-[13.5px]">
            <input type="checkbox" name="client_visible" className="mt-0.5 size-4 accent-accent" />
            <span>
              {t('Show on the client’s punch list')}
              <span className="block text-[12.5px] text-ink-muted">
                {t('The client sees the snag and its photos, never who it is assigned to.')}
              </span>
            </span>
          </label>
          <Field label={t('Photos')} optional>
            <PhotoPicker files={photos} onChange={setPhotos} disabled={pending} />
          </Field>
          <FormError error={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Raise snag')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Quick capture: a photo and a few words, or a voice note, from somebody walking the floor.
 *
 * It becomes a *draft* — the title, trade and priority are a guess (a model's, or keyword rules')
 * and somebody confirms it before it lands on anybody's list. That is what makes it safe to be
 * this fast.
 */
export function QuickCaptureDialog({
  sites,
  fixedSiteId,
  size = 'sm',
}: {
  sites: SiteOption[];
  fixedSiteId?: string;
  size?: 'sm' | 'lg';
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState(fixedSiteId ?? '');
  const [photos, setPhotos] = useState<File[]>([]);
  const [voice, setVoice] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function reset() {
    setPhotos([]);
    setVoice(null);
    setError(null);
  }

  function submit(formData: FormData) {
    setError(null);
    const note = String(formData.get('note') ?? '').trim();
    const location = String(formData.get('location') ?? '').trim();
    if (!siteId) {
      setError(t('Choose the site'));
      return;
    }
    if (!note && !voice && photos.length === 0) {
      setError(t('Take a photo, write a few words or record a voice note'));
      return;
    }
    start(async () => {
      const uploaded = await uploadQualityPhotos(photos, siteId);
      if (!uploaded.ok) {
        setError(t(uploaded.error));
        return;
      }
      let voiceKey: string | undefined;
      if (voice) {
        const sent = await uploadQualityFile(voice, 'dpr_voice', siteId);
        if (!sent.ok) {
          setError(t(sent.error));
          return;
        }
        voiceKey = sent.key;
      }
      const result = await quickSnag({
        project_id: siteId,
        photo_keys: uploaded.keys,
        ...(note ? { note } : {}),
        ...(voiceKey ? { voice_s3_key: voiceKey } : {}),
        ...(location ? { location } : {}),
      });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not save the snag'));
        return;
      }
      toast.success(`${t('Draft snag')} #${result.data.number}: ${result.data.title}`);
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size={size}>
          <Zap className="size-4" />
          {t('Quick snag')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Quick snag')}</DialogTitle>
          <DialogDescription>
            {t('A photo and a few words is enough. It is saved as a draft for somebody to check and assign.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          {!fixedSiteId && <SitePicker sites={sites} value={siteId} onChange={setSiteId} />}
          <PhotoPicker files={photos} onChange={setPhotos} disabled={pending} label={t('Take photo')} />
          <Field label={t('What is wrong')} htmlFor="quick-note" optional>
            <Textarea
              id="quick-note"
              name="note"
              maxLength={2000}
              className="min-h-[64px]"
              placeholder={t('Seepage below the bathroom window, 3rd floor')}
            />
          </Field>
          <VoiceRecorder blob={voice} onChange={setVoice} onError={setError} disabled={pending} />
          {/* Off is not broken here: a voice note is kept on the snag to listen to, and the keyword
              rules still make the first guess at the title and trade. */}
          <AiOffNote feature="voice" manual={t('A voice note is kept on the snag to listen to, not transcribed.')} />
          <AiOffNote feature="suggestions" manual={t('The title and trade are guessed from keywords instead.')} />
          <Field label={t('Where')} htmlFor="quick-location" optional>
            <Input id="quick-location" name="location" maxLength={200} />
          </Field>
          <FormError error={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Save draft')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Records a voice note and holds it until the snag is saved — unlike the daily report's button,
 * which transcribes immediately, because here the API does the listening when the draft is made.
 * The same two-minute ceiling, for the same reason: a live microphone left on is not consent.
 */
function VoiceRecorder({
  blob,
  onChange,
  onError,
  disabled,
}: {
  blob: Blob | null;
  onChange: (blob: Blob | null) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const LIMIT_SECONDS = 120;

  useEffect(() => {
    if (!recording) return;
    const tick = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(tick);
  }, [recording]);

  useEffect(() => {
    if (recording && seconds >= LIMIT_SECONDS) stop();
  }, [recording, seconds]);

  // Closing the dialog mid-recording must release the microphone.
  useEffect(() => {
    return () => recorder.current?.stream.getTracks().forEach((track) => track.stop());
  }, []);

  async function begin() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError(t('This browser cannot record audio. Type the note instead.'));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      onError(t('No microphone, or permission was refused. Allow it in the address bar and retry.'));
      return;
    }
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported?.(type));
    chunks.current = [];
    const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    media.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const recorded = new Blob(chunks.current, { type: media.mimeType });
      if (recorded.size < 2000) {
        onError(t('That recording was too short to hear. Hold on a moment longer.'));
        return;
      }
      onChange(recorded);
    };
    recorder.current = media;
    setSeconds(0);
    setRecording(true);
    media.start(1000);
  }

  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    setRecording(false);
  }

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  if (recording) {
    return (
      <Button type="button" variant="secondary" onClick={stop} className="self-start">
        <Square className="size-3.5 fill-current text-blocked-fg" />
        <span className="tabular-nums">
          {t('Stop')} · {clock}
        </span>
      </Button>
    );
  }
  if (blob) {
    return (
      <div className="flex items-center gap-2 rounded-panel border border-line bg-raised px-3 py-2 text-[13px]">
        <Mic className="size-4 text-accent" />
        <span className="flex-1">
          {t('Voice note recorded')} · <span className="tabular-nums">{clock}</span>
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={() => onChange(null)}
          aria-label={t('Discard the voice note')}
          disabled={disabled}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    );
  }
  return (
    <Button type="button" variant="secondary" onClick={() => void begin()} disabled={disabled} className="self-start">
      <Mic className="size-4" />
      {t('Say it instead')}
    </Button>
  );
}
