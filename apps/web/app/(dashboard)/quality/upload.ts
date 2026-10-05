import { MAX_UPLOAD_BYTES } from '@sitebook/shared';
import { presignUpload } from '@/lib/actions';

export type QualityUploadKind = 'quality_photo' | 'quality_report' | 'dpr_voice';

/**
 * One file straight to storage, the same two steps every upload in the app takes: ask the API for
 * a signed PUT, then send the bytes there with the signed headers replayed exactly.
 *
 * Returns the storage key the quality endpoints take, or the reason it failed in words the person
 * holding the phone can act on. Called from the browser — the bytes never pass through Next.
 */
export async function uploadQualityFile(
  file: Blob & { name?: string },
  kind: QualityUploadKind,
  projectId: string,
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  // The bare type: `audio/webm`, not `audio/webm;codecs=opus`, which the presign refuses.
  const contentType = file.type.split(';')[0] || (kind === 'dpr_voice' ? 'audio/webm' : 'image/jpeg');
  const limit = contentType.startsWith('audio/') ? MAX_UPLOAD_BYTES.audio : MAX_UPLOAD_BYTES.image;
  if (file.size > limit) {
    return { ok: false, error: `${file.name ?? 'That file'} is too large to upload` };
  }

  const presigned = await presignUpload({
    kind,
    content_type: contentType,
    content_length: file.size,
    project_id: projectId,
  });
  if (!presigned.ok || !presigned.data) {
    return { ok: false, error: presigned.error ?? 'Could not prepare the upload' };
  }

  const put = await fetch(presigned.data.url, {
    method: 'PUT',
    headers: presigned.data.headers,
    body: file,
  }).catch(() => null);
  if (!put?.ok) {
    return { ok: false, error: 'The upload failed. Check the connection and try again.' };
  }
  return { ok: true, key: presigned.data.s3_key };
}

/** Several photos in order; stops at the first failure so nothing half-attached is saved. */
export async function uploadQualityPhotos(
  files: File[],
  projectId: string,
): Promise<{ ok: true; keys: string[] } | { ok: false; error: string }> {
  const keys: string[] = [];
  for (const file of files) {
    const result = await uploadQualityFile(file, 'quality_photo', projectId);
    if (!result.ok) return result;
    keys.push(result.key);
  }
  return { ok: true, keys };
}
