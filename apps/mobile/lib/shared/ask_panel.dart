import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/ai_api.dart';
import '../core/api_client.dart';
import '../core/auth_controller.dart';
import '../core/i18n.dart';
import '../core/theme.dart';

/// Asks a question of the drawings and contracts on this screen.
///
/// The answer to "what is the slab thickness on the third floor" is already written down. It is on
/// page 14 of a sixty-page structural set, which on a site with one free hand means it is unknown —
/// so somebody rings the consultant, or guesses, and a guess about a slab is poured in concrete.
/// This is the phone where that question actually gets asked.
///
/// Every answer carries the document and the page it came from, and that is not decoration: it is
/// what lets somebody open the drawing and confirm it in ten seconds. An answer nobody can check is
/// an answer nobody should build to.
class AskDocumentsPanel extends ConsumerStatefulWidget {
  const AskDocumentsPanel({super.key, this.projectId});

  final String? projectId;

  @override
  ConsumerState<AskDocumentsPanel> createState() => _AskDocumentsPanelState();
}

class _AskDocumentsPanelState extends ConsumerState<AskDocumentsPanel> {
  final _question = TextEditingController();
  bool _asking = false;
  DocumentAnswer? _answer;
  String? _error;

  @override
  void dispose() {
    _question.dispose();
    super.dispose();
  }

  Future<void> _ask() async {
    final text = _question.text.trim();
    if (text.length < 5) return;

    setState(() {
      _asking = true;
      _error = null;
    });
    try {
      final answer = await AiApi(
        ref.read(apiClientProvider),
      ).askDocuments(text, projectId: widget.projectId);
      if (mounted) setState(() => _answer = answer);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = t('Could not answer that just now.'));
    } finally {
      if (mounted) setState(() => _asking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final answer = _answer;
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Palette.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Palette.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _question,
                  textInputAction: TextInputAction.search,
                  onSubmitted: (_) => _ask(),
                  decoration: InputDecoration(
                    isDense: true,
                    hintText: t('What is the slab thickness on the third floor?'),
                    prefixIcon: const Icon(Icons.find_in_page_outlined, size: 20),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: _asking ? null : _ask,
                child: _asking
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(t('Ask')),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            t('Answered from the text of your own drawings, with the page it came from.'),
            style: const TextStyle(fontSize: 11.5, color: Palette.inkMuted),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(_error!, style: const TextStyle(fontSize: 12.5, color: Palette.blocked)),
          ],
          if (answer != null) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Palette.neutralBg,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    answer.answer,
                    style: TextStyle(
                      fontSize: 14,
                      height: 1.5,
                      color: answer.answered ? Palette.ink : Palette.inkMuted,
                    ),
                  ),
                  for (final source in answer.sources) ...[
                    const SizedBox(height: 10),
                    Text(
                      '${source.title} · ${t('page')} ${source.page}',
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 2),
                    // The drawing's own words, not a paraphrase. This is the line somebody reads to
                    // decide whether to trust the sentence above it.
                    Text(
                      source.snippet,
                      style: const TextStyle(fontSize: 12, height: 1.45, color: Palette.inkMuted),
                    ),
                  ],
                  if (answer.caveat != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      answer.caveat!,
                      style: const TextStyle(fontSize: 12, color: Palette.pending),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Asks a question about the account's own numbers — spend, wages, headcount, materials.
///
/// The model reads the question and nothing else: it turns words into a metric and a period, and
/// deterministic code on the server computes the figure from the asker's own rows. A model asked to
/// produce a total would eventually produce a plausible wrong one, and a plausible wrong total in a
/// construction ledger is worse than no answer, because somebody acts on it.
class AskDataSheet extends ConsumerStatefulWidget {
  const AskDataSheet({super.key});

  /// Opened as a sheet rather than a screen: it is a question somebody asks in the middle of doing
  /// something else, and it should hand them back to whatever that was.
  static Future<void> show(BuildContext context) => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Palette.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
    ),
    builder: (_) => const AskDataSheet(),
  );

  @override
  ConsumerState<AskDataSheet> createState() => _AskDataSheetState();
}

class _AskDataSheetState extends ConsumerState<AskDataSheet> {
  final _question = TextEditingController();
  bool _asking = false;
  DataAnswer? _answer;
  String? _error;

  @override
  void dispose() {
    _question.dispose();
    super.dispose();
  }

  Future<void> _ask() async {
    final text = _question.text.trim();
    if (text.length < 3) return;

    setState(() {
      _asking = true;
      _error = null;
    });
    try {
      final answer = await AiApi(ref.read(apiClientProvider)).ask(text);
      if (mounted) setState(() => _answer = answer);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = t('Could not answer that just now.'));
    } finally {
      if (mounted) setState(() => _asking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final answer = _answer;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        16,
        16,
        16,
        MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            t('Ask about your numbers'),
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _question,
            autofocus: true,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _ask(),
            decoration: InputDecoration(
              hintText: t('How much did we spend on steel last month?'),
            ),
          ),
          const SizedBox(height: 10),
          FilledButton(
            onPressed: _asking ? null : _ask,
            child: _asking
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(t('Ask')),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(fontSize: 12.5, color: Palette.blocked)),
          ],
          if (answer != null) ...[
            const SizedBox(height: 14),
            Text(answer.answer, style: const TextStyle(fontSize: 15, height: 1.5)),
            const SizedBox(height: 6),
            // What was understood, so somebody can see the question was read correctly rather than
            // trusting a number that answers a different question.
            Text(
              '${answer.project ?? t('All sites')} · ${answer.period}',
              style: const TextStyle(fontSize: 12, color: Palette.inkMuted),
            ),
            if (answer.caveat != null) ...[
              const SizedBox(height: 6),
              Text(
                answer.caveat!,
                style: const TextStyle(fontSize: 12, color: Palette.pending),
              ),
            ],
          ],
        ],
      ),
    );
  }
}
