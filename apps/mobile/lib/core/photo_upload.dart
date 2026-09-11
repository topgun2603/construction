import 'dart:io';

import 'package:image_picker/image_picker.dart';

import 'api_client.dart';

/// A photo chosen on the phone, before and after it reaches storage.
class PendingPhoto {
  PendingPhoto({required this.file});

  final XFile file;

  /// Set once the bytes are in storage. Null while it is still uploading, or if it failed.
  String? s3Key;
  bool failed = false;
}

/// Taking a photo and getting it into storage.
///
/// Bytes go straight from the phone to S3 through a presigned URL and never pass through the app
/// server — which is what keeps a slow 4G upload from occupying a request thread for a minute. The
/// record that the photo exists is written afterwards, with the report, so a failed upload leaves
/// nothing behind to clean up.
class PhotoUploader {
  const PhotoUploader(this._api);

  final ApiClient _api;

  static final _picker = ImagePicker();

  /// Straight to the camera: on a site the photo is nearly always being taken now, not found.
  static Future<XFile?> capture() => _pick(ImageSource.camera);

  static Future<List<XFile>> pickFromGallery() async {
    final files = await _picker.pickMultiImage(maxWidth: 1600, imageQuality: 82, limit: 12);
    return files;
  }

  /// A clip of the site. Capped at a minute because the point is a walk-through of a floor, and
  /// because a longer one will not finish uploading from a site with one bar.
  static Future<XFile?> pickVideo({bool fromCamera = false}) => _picker.pickVideo(
    source: fromCamera ? ImageSource.camera : ImageSource.gallery,
    maxDuration: const Duration(minutes: 1),
  );

  static Future<XFile?> _pick(ImageSource source) => _picker.pickImage(
    source: source,
    // 1600px at 82% is about 300 KB — plenty to see a crack in a wall, and small enough to send
    // from a site with one bar. A 12 MP original is 4 MB and will not finish.
    maxWidth: 1600,
    imageQuality: 82,
  );

  /// Presign, PUT, return the key to attach.
  ///
  /// [kind] is what the object is for, and the server files it accordingly — a photo of a crack in
  /// a wall on one day's report is not the same thing as a photograph of the site itself.
  Future<String> upload(
    XFile file, {
    required String projectId,
    String kind = 'dpr_photo',
  }) => uploadFile(path: file.path, contentType: _contentType(file.path), projectId: projectId, kind: kind);

  /// The same, for anything that is not a photograph.
  ///
  /// The content type is passed in rather than guessed, because a PDF filed as `image/jpeg` is a
  /// document the phone then refuses to open — and by the time anybody notices, the only copy of a
  /// signed approval is stored under a type that says it is a picture.
  Future<String> uploadFile({
    required String path,
    required String contentType,
    required String projectId,
    String kind = 'document',
  }) async {
    final bytes = await File(path).readAsBytes();

    final presigned = Map<String, dynamic>.from(
      await _api.post(
            '/uploads/presign',
            body: {
              'kind': kind,
              'content_type': contentType,
              'content_length': bytes.length,
              'project_id': projectId,
            },
          )
          as Map,
    );

    // The signed headers must be replayed exactly or the PUT is rejected.
    final headers = Map<String, String>.from(presigned['headers'] as Map? ?? const {});
    final response = await HttpClient().putUrl(Uri.parse(presigned['url'] as String)).then((
      request,
    ) {
      headers.forEach(request.headers.set);
      request.contentLength = bytes.length;
      request.add(bytes);
      return request.close();
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException('Could not upload that photo (${response.statusCode})');
    }
    return presigned['s3_key'] as String;
  }

  /// Public because the media record has to be written with the same type the object was stored
  /// under: a video filed as `image/jpeg` is a thumbnail that never renders.
  static String contentTypeOf(String path) {
    final lower = path.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.heic')) return 'image/heic';
    if (lower.endsWith('.mp4')) return 'video/mp4';
    if (lower.endsWith('.mov')) return 'video/quicktime';
    if (lower.endsWith('.3gp')) return 'video/3gpp';
    if (lower.endsWith('.mkv')) return 'video/x-matroska';
    return 'image/jpeg';
  }

  static bool isVideo(String path) => contentTypeOf(path).startsWith('video/');

  String _contentType(String path) => contentTypeOf(path);
}
