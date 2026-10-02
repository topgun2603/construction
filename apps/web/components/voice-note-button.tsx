'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import type { VoiceDprResult } from '@sitebook/shared';
import { MAX_UPLOAD_BYTES } from '@sitebook/shared';
import { presignUpload, transcribeVoiceNote } from '@/lib/actions';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';

/**
 * Records a spoken site note and hands back the report draft it became.
 *
 * The one thing this component is for: a supervisor who will not type a report will say one. So
 * the interaction is a single button that starts listening, the same button to stop, and then the
 * form fills in. No file picker, no upload dialog, no second page.
 *
 * The recording is a means, not a record. It is uploaded, transcribed, and deleted server-side —
 * what survives is the transcript, shown next to the draft so the words can be checked against
 * what was actually said.
 */
export function VoiceNoteButton({
  projectId,
  reportDate,
  onDraft,
  onError,
  disabled,
}: {
  projectId: string;
  reportDate?: string;
  onDraft: (result: VoiceDprResult) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle');
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  /*
   * A ceiling, not a feature.
   *
   * Two minutes is a long site note said out loud and a short podcast; past it somebody has left
   * the tab open with the microphone live, which is both a bill and a thing nobody consented to.
   * The upload limit would catch it eventually — this catches it politely.
   */
  const LIMIT_SECONDS = 120;

  useEffect(() => {
    if (state !== 'recording') return;
    const tick = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(tick);
  }, [state]);

  useEffect(() => {
    if (state === 'recording' && seconds >= LIMIT_SECONDS) stop();
  }, [state, seconds]);

  // Leaving the page mid-recording must release the microphone, or the browser keeps showing the
  // recording indicator over a form nobody is on any more.
  useEffect(() => {
    return () => {
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError('This browser cannot record audio. Type the report, or use the phone app.');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Site noise is the normal condition, not the exception: a mixer, a cutting machine, and
        // somebody shouting. These three are the difference between a usable transcript and one.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      onError('No microphone, or permission was refused. Allow it in the address bar and retry.');
      return;
    }

    const mimeType = pickMimeType();
    chunks.current = [];
    const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    media.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      void send(new Blob(chunks.current, { type: media.mimeType }));
    };

    recorder.current = media;
    setSeconds(0);
    setState('recording');
    // A one-second timeslice rather than none: without it a tab suspended mid-recording can lose
    // everything spoken, because nothing was flushed until stop.
    media.start(1000);
  }

  function stop() {
    if (recorder.current?.state === 'recording') {
      setState('working');
      recorder.current.stop();
    }
  }

  async function send(blob: Blob) {
    try {
      if (blob.size < 2000) {
        onError('That recording was too short to hear. Hold the button a moment longer.');
        return;
      }
      if (blob.size > MAX_UPLOAD_BYTES.audio) {
        onError('That recording is too long. Keep a note under two minutes.');
        return;
      }

      // The bare type — `audio/webm`, not `audio/webm;codecs=opus`. The codec parameter is the
      // browser's business and the presign endpoint will not accept it.
      const contentType = blob.type.split(';')[0] || 'audio/webm';
      const presigned = await presignUpload({
        kind: 'dpr_voice',
        content_type: contentType,
        content_length: blob.size,
        project_id: projectId,
      });
      if (!presigned.ok || !presigned.data) {
        onError(presigned.error ?? 'Could not prepare the upload.');
        return;
      }

      const put = await fetch(presigned.data.url, {
        method: 'PUT',
        headers: presigned.data.headers,
        body: blob,
      });
      if (!put.ok) {
        onError('The recording did not upload. Check the connection and try again.');
        return;
      }

      const result = await transcribeVoiceNote({
        s3_key: presigned.data.s3_key,
        project_id: projectId,
        ...(reportDate ? { report_date: reportDate } : {}),
      });
      if (!result.ok || !result.data) {
        onError(result.error ?? 'Could not read that note.');
        return;
      }
      onDraft(result.data);
    } finally {
      setState('idle');
      setSeconds(0);
    }
  }

  if (state === 'working') {
    return (
      <Button type="button" variant="secondary" size="sm" disabled>
        <Loader2 className="size-4 animate-spin" /> {t('Listening to it…')}
      </Button>
    );
  }

  if (state === 'recording') {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={stop}>
        <Square className="size-3.5 fill-current text-blocked-fg" />
        <span className="tabular-nums">
          {t('Stop')} · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </span>
      </Button>
    );
  }

  return (
    <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => void start()}>
      <Mic className="size-4" /> {t('Speak the report')}
    </Button>
  );
}

/**
 * What this browser can actually record.
 *
 * Chrome and Firefox give WebM/Opus; Safari gives MP4/AAC and refuses an unsupported `mimeType`
 * outright rather than falling back. Asking first and passing nothing when none match leaves the
 * browser to its own default, which is always something it can produce.
 */
function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type));
}
