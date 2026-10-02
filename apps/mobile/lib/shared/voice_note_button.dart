import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

import '../core/ai_api.dart';
import '../core/api_client.dart';
import '../core/photo_upload.dart';
import '../core/theme.dart';
import '../core/i18n.dart';

/// Records a spoken site note and hands back the report draft it became.
///
/// This is the feature that most belongs on the phone rather than the web. A supervisor at six in
/// the evening has dusty hands, twenty minutes of light and no desk. Typing a report into a form is
/// the reason reports do not get filed, and an unfiled report is a day of a project with no record
/// of what happened on it. Saying two lines out loud is something somebody will actually do.
///
/// The recording is a means, not a record: it is uploaded, transcribed, and deleted server-side.
/// What survives is the transcript, shown next to the draft so the words can be checked.
class VoiceNoteButton extends StatefulWidget {
  const VoiceNoteButton({
    super.key,
    required this.api,
    required this.projectId,
    required this.reportDate,
    required this.onDraft,
    this.enabled = true,
  });

  final ApiClient api;
  final String projectId;
  final String reportDate;
  final void Function(VoiceDraft draft) onDraft;
  final bool enabled;

  @override
  State<VoiceNoteButton> createState() => _VoiceNoteButtonState();
}

enum _Stage { idle, recording, working }

class _VoiceNoteButtonState extends State<VoiceNoteButton> {
  final _recorder = AudioRecorder();
  _Stage _stage = _Stage.idle;
  int _seconds = 0;
  Timer? _ticker;
  String? _path;

  /// A ceiling, not a feature. Two minutes is a long site note said out loud and a short podcast;
  /// past it somebody has left the microphone live, which is both a bill and a thing nobody agreed
  /// to. The upload limit would catch it eventually — this catches it politely.
  static const _limitSeconds = 120;

  @override
  void dispose() {
    _ticker?.cancel();
    // Leaving the screen mid-recording must release the microphone, or Android keeps showing the
    // recording indicator over a screen nobody is on.
    unawaited(_recorder.dispose());
    super.dispose();
  }

  Future<void> _start() async {
    if (!await _recorder.hasPermission()) {
      _say('No microphone, or permission was refused. Allow it in Settings and try again.');
      return;
    }

    final directory = await getTemporaryDirectory();
    final path = '${directory.path}/site-note-${DateTime.now().millisecondsSinceEpoch}.m4a';

    await _recorder.start(
      // AAC in an m4a container: what an Android phone encodes natively, and a format the
      // transcriber accepts as it is. 32 kbps mono is speech, not music — a two-minute note is
      // under half a megabyte, which matters on a site with one bar.
      const RecordConfig(
        encoder: AudioEncoder.aacLc,
        bitRate: 32000,
        sampleRate: 22050,
        numChannels: 1,
      ),
      path: path,
    );

    setState(() {
      _path = path;
      _stage = _Stage.recording;
      _seconds = 0;
    });

    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _seconds += 1);
      if (_seconds >= _limitSeconds) unawaited(_stop());
    });
  }

  Future<void> _stop() async {
    _ticker?.cancel();
    if (_stage != _Stage.recording) return;
    setState(() => _stage = _Stage.working);

    try {
      await _recorder.stop();
      final path = _path;
      if (path == null) return;

      final file = File(path);
      final length = await file.length();
      if (length < 2000) {
        _say('That recording was too short to hear. Hold on a moment longer.');
        return;
      }

      final key = await PhotoUploader(widget.api).uploadFile(
        path: path,
        contentType: 'audio/mp4',
        projectId: widget.projectId,
        kind: 'dpr_voice',
      );

      final draft = await AiApi(widget.api).readVoiceNote(
        s3Key: key,
        projectId: widget.projectId,
        reportDate: widget.reportDate,
      );
      if (mounted) widget.onDraft(draft);

      // The audio has become text; there is no reason to keep a recording of somebody's voice on
      // the phone either.
      unawaited(file.delete().catchError((_) => file));
    } on ApiException catch (error) {
      _say(error.message);
    } catch (_) {
      _say('Could not read that note. Type the report instead.');
    } finally {
      if (mounted) setState(() => _stage = _Stage.idle);
    }
  }

  void _say(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    switch (_stage) {
      case _Stage.working:
        return FilledButton.tonalIcon(
          onPressed: null,
          icon: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
          label: Text('Listening to it…'),
        );

      case _Stage.recording:
        final minutes = (_seconds ~/ 60).toString();
        final seconds = (_seconds % 60).toString().padLeft(2, '0');
        return FilledButton.icon(
          onPressed: _stop,
          style: FilledButton.styleFrom(backgroundColor: Palette.blocked),
          icon: const Icon(Icons.stop_rounded, size: 18),
          label: Text('Stop · $minutes:$seconds'),
        );

      case _Stage.idle:
        return FilledButton.tonalIcon(
          onPressed: widget.enabled ? _start : null,
          icon: const Icon(Icons.mic_rounded, size: 18),
          label: Text(t('Speak the report')),
        );
    }
  }
}
