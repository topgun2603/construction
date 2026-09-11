import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../api_client.dart';

/// Photographs waiting to be uploaded, and where they live while they wait.
///
/// `image_picker` hands back a file in the operating system's cache, which Android is free to
/// delete whenever it wants the space — often overnight, which is exactly how long a phone might
/// hold a report before it finds signal. So a photo attached to a queued report is copied somewhere
/// the app owns, and only deleted once the server has it.
class PhotoQueue {
  const PhotoQueue(this._api);

  final ApiClient _api;

  static const _folder = 'outbox_photos';

  /// Where kept photos live.
  ///
  /// A seam, not a setting. `getApplicationSupportDirectory` is a platform channel and there is no
  /// platform under a unit test, so the tests point this at a temporary folder. Nothing in the app
  /// touches it.
  static Future<Directory> Function() storageDirectory = () async =>
      Directory('${(await getApplicationSupportDirectory()).path}/$_folder');

  /// Copies a picked file somewhere it will survive, and returns the new path.
  static Future<String> keep(String sourcePath) async {
    final directory = await storageDirectory();
    if (!directory.existsSync()) await directory.create(recursive: true);

    final extension = sourcePath.contains('.') ? sourcePath.split('.').last : 'jpg';
    final name = '${DateTime.now().microsecondsSinceEpoch}-${sourcePath.hashCode.abs()}.$extension';
    final destination = '${directory.path}/$name';
    await File(sourcePath).copy(destination);
    return destination;
  }

  /// Presign, PUT, and hand back the key the report should reference.
  Future<String> upload(String path, {required String projectId}) async {
    final file = File(path);
    if (!file.existsSync()) {
      // The copy is gone — a factory reset, a user clearing storage. Better to file the report
      // without the photograph than to keep the whole thing stuck forever.
      throw const MissingPhoto();
    }
    final bytes = await file.readAsBytes();

    final presigned = Map<String, dynamic>.from(
      await _api.post(
            '/uploads/presign',
            body: {
              'kind': 'dpr_photo',
              'content_type': contentTypeFor(path),
              'content_length': bytes.length,
              'project_id': projectId,
            },
          )
          as Map,
    );

    await _api.putToStorage(
      url: presigned['url'] as String,
      headers: Map<String, String>.from(presigned['headers'] as Map? ?? const {}),
      bytes: bytes,
    );
    return presigned['s3_key'] as String;
  }

  /// Removes a file the server has accepted. Failure here is not worth telling anybody about: a
  /// stray photo costs a few hundred kilobytes, and the report is already filed.
  static Future<void> discard(String path) async {
    try {
      final file = File(path);
      if (file.existsSync()) await file.delete();
    } catch (_) {
      /* nothing to do */
    }
  }

  static String contentTypeFor(String path) {
    final lower = path.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.heic')) return 'image/heic';
    return 'image/jpeg';
  }
}

/// The file backing a queued photo has gone. The report goes without it.
class MissingPhoto implements Exception {
  const MissingPhoto();

  @override
  String toString() => 'the photo file is no longer on this phone';
}
