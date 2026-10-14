import { MAX_UPLOAD_BYTES } from '@sitebook/shared';
import { presignUpload } from '@/lib/actions';

/**
 * Upload one photo or PDF for an RFI, a response or a submittal and return what the record needs.
 *
 * The bytes go straight from the browser to storage on a presigned URL, like every other file in the
 * product; the record that points at them is saved afterwards.
 */
export async function uploadRfiFile(
  file: File,
  projectId: string,
): Promise<{ ok: true; s3_key: string; content_type: string; filename: string } | { ok: false; error: string }> {
  if (!file.type.startsWith('image/') && !file.type.startsWith('application/')) {
    return { ok: false, error: 'Choose a photo or a PDF' };
  }
  if (file.size > MAX_UPLOAD_BYTES.image) return { ok: false, error: 'That file is too large' };
  const presigned = await presignUpload({
    kind: 'rfi_attachment',
    content_type: file.type,
    content_length: file.size,
    project_id: projectId,
  });
  if (!presigned.ok || !presigned.data) {
    return { ok: false, error: presigned.error ?? 'Could not prepare the upload' };
  }
  const put = await fetch(presigned.data.url, { method: 'PUT', headers: presigned.data.headers, body: file });
  if (!put.ok) return { ok: false, error: 'The file did not upload. Try again.' };
  return { ok: true, s3_key: presigned.data.s3_key, content_type: file.type, filename: file.name.slice(0, 200) };
}

/** Upload several, stopping at the first failure so the form can say which one. */
export async function uploadRfiFiles(
  files: readonly File[],
  projectId: string,
): Promise<
  | { ok: true; files: Array<{ s3_key: string; content_type: string; filename: string }> }
  | { ok: false; error: string }
> {
  const out: Array<{ s3_key: string; content_type: string; filename: string }> = [];
  for (const file of files) {
    const uploaded = await uploadRfiFile(file, projectId);
    if (!uploaded.ok) return { ok: false, error: `${file.name}: ${uploaded.error}` };
    out.push({ s3_key: uploaded.s3_key, content_type: uploaded.content_type, filename: uploaded.filename });
  }
  return { ok: true, files: out };
}
