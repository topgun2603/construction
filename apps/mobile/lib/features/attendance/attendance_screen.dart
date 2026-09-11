import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/db/database.dart';
import '../../core/db/offline_repository.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';

/// The roll call.
///
/// This is the screen the product exists for: one person, standing at a gate at seven in the
/// morning, marking forty people present or absent with one thumb. Everything about it is shaped by
/// that — big targets, no scrolling to find a save button, no dialog between deciding and recording.
///
/// The whole day is sent in one request. Forty separate calls would be forty chances for the third
/// one to fail on a site with one bar of signal, leaving a half-marked day that nobody can tell from
/// a day where half the crew did not turn up.
class AttendanceScreen extends ConsumerStatefulWidget {
  const AttendanceScreen({super.key});

  @override
  ConsumerState<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends ConsumerState<AttendanceScreen> {
  String? _projectId;

  /// worker id → present | half_day | absent, as edited but not yet sent.
  final Map<String, String> _marks = {};
  bool _saving = false;
  bool _dirty = false;

  @override
  Widget build(BuildContext context) {
    // The mirrored list, so the picker is there with no signal.
    final sites = ref.watch(offlineSitesProvider);
    final date = ref.watch(workingDateProvider);
    final me = ref.watch(authControllerProvider).me;
    final canRecord = me?.can('attendance.record') ?? false;

    return AsyncSection<List<MirroredProject>>(
      value: sites,
      onRetry: () => ref.invalidate(offlineSitesProvider),
      builder: (siteRows) {
        if (siteRows.isEmpty) {
          return const EmptyNote(
            icon: Icons.how_to_reg_outlined,
            title: 'No sites to mark',
            body: 'You are not on any site yet. Whoever runs the account assigns them.',
          );
        }
        final projectId = _projectId ?? siteRows.first.id;

        return Column(
          children: [
            _Chooser(
              sites: siteRows,
              projectId: projectId,
              date: date,
              onSite: (id) => setState(() {
                _projectId = id;
                _marks.clear();
                _dirty = false;
              }),
              onDate: (value) {
                ref.read(workingDateProvider.notifier).state = value;
                setState(() {
                  _marks.clear();
                  _dirty = false;
                });
              },
            ),
            Expanded(child: _rollCall(projectId, date, canRecord)),
          ],
        );
      },
    );
  }

  Widget _rollCall(String projectId, String date, bool canRecord) {
    final key = RollCallKey(projectId, date);
    final crew = ref.watch(rollCallProvider(key));

    if (crew.isLoading) return const Loading();
    if (crew.hasError) {
      return ErrorNote(error: crew.error!, onRetry: () => ref.invalidate(rollCallProvider(key)));
    }

    final workers = crew.value!;
    if (workers.isEmpty) {
      return const EmptyNote(
        icon: Icons.groups_outlined,
        title: 'Nobody is on this site',
        body:
            'The roll call only lists workers assigned to this site. Assign them on the site, or '
            'from Workers, and they appear here — with signal or without, once this phone has '
            'seen them once.',
      );
    }

    String statusOf(String workerId) =>
        _marks[workerId] ?? workers.firstWhere((w) => w.id == workerId).status;

    final present = workers.where((w) => statusOf(w.id) == 'present').length;
    final half = workers.where((w) => statusOf(w.id) == 'half_day').length;
    final unsent = workers.where((w) => w.unsent).length;

    String? lastContractor;

    return Column(
      children: [
        Container(
          width: double.infinity,
          color: Palette.raised,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '$present present · $half half day',
                      style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
                    ),
                    if (unsent > 0)
                      Text(
                        '$unsent waiting to send',
                        style: const TextStyle(fontSize: 12, color: Palette.pending),
                      ),
                  ],
                ),
              ),
              if (canRecord)
                TextButton(
                  onPressed: () => setState(() {
                    for (final worker in workers) {
                      _marks[worker.id] = 'present';
                    }
                    _dirty = true;
                  }),
                  child: const Text('All present'),
                ),
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            padding: EdgeInsets.only(bottom: bottomInset(context) + 60),
            itemCount: workers.length,
            itemBuilder: (context, index) {
              final worker = workers[index];
              final showHeader = worker.contractorName != lastContractor;
              lastContractor = worker.contractorName;

              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (showHeader)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
                      child: Text(
                        worker.contractorName.toUpperCase(),
                        style: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 1,
                          color: Palette.inkMuted,
                        ),
                      ),
                    ),
                  _WorkerRow(
                    name: worker.name,
                    trade: worker.trade,
                    wage: worker.dailyWage,
                    status: statusOf(worker.id),
                    unsent: worker.unsent,
                    enabled: canRecord,
                    onMark: (status) => setState(() {
                      _marks[worker.id] = status;
                      _dirty = true;
                    }),
                  ),
                ],
              );
            },
          ),
        ),
        if (canRecord)
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: FilledButton(
                onPressed: _dirty && !_saving ? () => _save(projectId, date, workers) : null,
                child: _saving
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
                      )
                    : Text(_dirty ? 'Save roll call' : 'Nothing changed'),
              ),
            ),
          ),
      ],
    );
  }

  /// Saves to the phone. Sending is the sync engine's problem, and it will keep at it.
  Future<void> _save(String projectId, String date, List<RollCallWorker> workers) async {
    setState(() => _saving = true);
    try {
      // Only what changed. Re-sending an untouched day would rewrite rows nobody edited, and on a
      // wage period already locked in that is the difference between a correction and a rewrite.
      final existing = {for (final worker in workers) worker.id: worker.status};
      final changed = {
        for (final entry in _marks.entries)
          if (existing[entry.key] != entry.value) entry.key: entry.value,
      };

      if (changed.isEmpty) {
        setState(() {
          _dirty = false;
          _saving = false;
        });
        return;
      }

      await ref
          .read(offlineRepositoryProvider)
          .saveRollCall(projectId: projectId, date: date, marks: changed);

      if (!mounted) return;
      setState(() {
        _marks.clear();
        _dirty = false;
      });
      ref.invalidate(rollCallProvider(RollCallKey(projectId, date)));

      final online = ref.read(syncStateProvider).value?.online ?? true;
      notify(
        context,
        online
            ? '${changed.length} marked'
            : '${changed.length} marked and saved on this phone. It will send itself.',
      );
    } catch (error) {
      if (!mounted) return;
      // Local writes fail only when the disk does, which is worth saying out loud.
      notify(context, 'Could not save on this phone: $error', bad: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

/// Which site, which day. Both change often enough to live at the top rather than behind a menu.
class _Chooser extends StatelessWidget {
  const _Chooser({
    required this.sites,
    required this.projectId,
    required this.date,
    required this.onSite,
    required this.onDate,
  });

  final List<MirroredProject> sites;
  final String projectId;
  final String date;
  final ValueChanged<String> onSite;
  final ValueChanged<String> onDate;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Palette.surface,
      padding: const EdgeInsets.fromLTRB(16, 10, 8, 10),
      child: Row(
        children: [
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: sites.any((site) => site.id == projectId) ? projectId : sites.first.id,
                isExpanded: true,
                borderRadius: BorderRadius.circular(12),
                items: [
                  for (final site in sites)
                    DropdownMenuItem(
                      value: site.id,
                      child: Text(
                        site.name,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                      ),
                    ),
                ],
                onChanged: (value) {
                  if (value != null) onSite(value);
                },
              ),
            ),
          ),
          TextButton.icon(
            onPressed: () async {
              final current = parseIsoDate(date) ?? DateTime.now();
              final picked = await showDatePicker(
                context: context,
                initialDate: current,
                // A month back covers a late correction; the future is not markable, because
                // attendance is a record of what happened.
                firstDate: DateTime.now().subtract(const Duration(days: 31)),
                lastDate: DateTime.now(),
              );
              if (picked != null) onDate(isoDate(picked));
            },
            icon: const Icon(Icons.calendar_today_outlined, size: 16),
            label: Text(
              date == todayIso() ? 'Today' : shortDate(date),
              style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

/// One worker, three buttons. No dropdown, no long-press, no confirmation.
class _WorkerRow extends StatelessWidget {
  const _WorkerRow({
    required this.name,
    required this.trade,
    required this.wage,
    required this.status,
    required this.unsent,
    required this.enabled,
    required this.onMark,
  });

  final String name;
  final String? trade;
  final String? wage;
  final String status;

  /// Marked here and not yet accepted by the server.
  final bool unsent;
  final bool enabled;
  final ValueChanged<String> onMark;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Palette.surface,
      margin: const EdgeInsets.only(bottom: 1),
      padding: const EdgeInsets.fromLTRB(16, 10, 10, 10),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
                      ),
                    ),
                    if (unsent) ...[
                      const SizedBox(width: 6),
                      const Icon(Icons.schedule, size: 13, color: Palette.pending),
                    ],
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  [
                    if (trade != null && trade!.isNotEmpty) trade,
                    if (wage != null) '${formatInr(wage)}/day',
                  ].whereType<String>().join(' · '),
                  style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                ),
              ],
            ),
          ),
          _MarkButton(
            label: 'P',
            tooltip: 'Present',
            selected: status == 'present',
            colour: Palette.done,
            enabled: enabled,
            onTap: () => onMark('present'),
          ),
          _MarkButton(
            label: '½',
            tooltip: 'Half day',
            selected: status == 'half_day',
            colour: Palette.pending,
            enabled: enabled,
            onTap: () => onMark('half_day'),
          ),
          _MarkButton(
            label: 'A',
            tooltip: 'Absent',
            selected: status == 'absent',
            colour: Palette.blocked,
            enabled: enabled,
            onTap: () => onMark('absent'),
          ),
        ],
      ),
    );
  }
}

class _MarkButton extends StatelessWidget {
  const _MarkButton({
    required this.label,
    required this.tooltip,
    required this.selected,
    required this.colour,
    required this.enabled,
    required this.onTap,
  });

  final String label;
  final String tooltip;
  final bool selected;
  final Color colour;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Padding(
        padding: const EdgeInsets.only(left: 6),
        child: Material(
          color: selected ? colour : Palette.neutralBg,
          borderRadius: BorderRadius.circular(11),
          child: InkWell(
            borderRadius: BorderRadius.circular(11),
            onTap: enabled ? onTap : null,
            // 46px: a gloved thumb, per the same rule the web app follows.
            child: SizedBox(
              width: 46,
              height: 46,
              child: Center(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                    color: selected ? Colors.white : Palette.inkMuted,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
