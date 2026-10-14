import { MAX_UPLOAD_BYTES } from '@sitebook/shared';
import { presignUpload } from '@/lib/actions';

/**
 * Upload one photo as safety evidence and return its key, for a form to send with the record.
 *
 * The bytes go straight from the phone to storage on a presigned URL, the same as every other photo
 * in the product; the record that points at them is saved afterwards.
 */
export async function uploadSafetyPhoto(
  file: File,
  projectId: string,
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  if (!file.type.startsWith('image/')) return { ok: false, error: 'Choose a photo' };
  if (file.size > MAX_UPLOAD_BYTES.image) return { ok: false, error: 'That photo is too large' };
  const presigned = await presignUpload({
    kind: 'safety_photo',
    content_type: file.type,
    content_length: file.size,
    project_id: projectId,
  });
  if (!presigned.ok || !presigned.data) {
    return { ok: false, error: presigned.error ?? 'Could not prepare the upload' };
  }
  const put = await fetch(presigned.data.url, { method: 'PUT', headers: presigned.data.headers, body: file });
  if (!put.ok) return { ok: false, error: 'The photo did not upload. Try again.' };
  return { ok: true, key: presigned.data.s3_key };
}
