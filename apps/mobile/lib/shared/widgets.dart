import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api_client.dart';
import '../core/theme.dart';

/// The small pieces every screen is built from.
///
/// They exist so that a list of workers, a list of indents and a list of expenses look like the same
/// app rather than three apps — and so that "failed to load" is handled once, properly, with a way
/// back, instead of thirteen times badly.

/// How much room the bottom of a scrolling screen needs.
///
/// The floating bar sits over the content and the phone's gesture strip sits under that, so a list
/// padded to zero ends with its last row unreachable behind both. Every scrolling screen adds this;
/// the alternative — a SafeArea per screen — pushes the background up and leaves a pale band under
/// the bar on exactly the phones that have a gesture strip.
/// The floating bar's own height: the pill plus the gap under it.
///
/// Screens need this to keep their content and their buttons clear of a bar that floats over them,
/// so it lives here rather than being repeated as a number in six files.
const double kFloatingBarHeight = 74;

/// The system's own inset — the gesture strip or the three-button bar — in logical pixels.
///
/// Read from the view, not from the nearest MediaQuery. A screen inside the shell is a Scaffold
/// inside a Scaffold, and each one consumes part of the padding on the way down; measuring at the
/// bottom of that stack gave a fraction of the real inset, which is how the "file report" button
/// ended up sitting behind the navigation bar. The view knows the true number.
double systemBottomInset(BuildContext context) =>
    MediaQueryData.fromView(View.of(context)).viewPadding.bottom;

/// How far a floating action button has to be lifted to clear the navigation bar.
double fabInset(BuildContext context) => systemBottomInset(context) + kFloatingBarHeight + 14;

/// How much room the bottom of a scrolling screen needs.
///
/// The floating bar sits over the content and the phone's own navigation sits under that, so a list
/// padded to zero ends with its last row unreachable behind both.
double bottomInset(BuildContext context, {bool hasBar = true, bool hasFab = false}) {
  final system = systemBottomInset(context);
  return system + (hasBar ? kFloatingBarHeight + 16 : 16) + (hasFab ? 76 : 0);
}

class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key, this.trailing});

  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Row(
      children: [
        Expanded(
          child: Text(
            text.toUpperCase(),
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.1,
              color: Palette.inkMuted,
            ),
          ),
        ),
        ?trailing,
      ],
    ),
  );
}

/// A status in a coloured pill. One vocabulary for every status in the app.
class StatusPill extends StatelessWidget {
  const StatusPill(this.status, {super.key, this.label});

  final String status;
  final String? label;

  static (Color, Color) toneFor(String status) {
    switch (status) {
      case 'active':
      case 'approved':
      case 'submitted':
      case 'received':
      case 'paid':
      case 'present':
        return (Palette.doneBg, Palette.done);
      case 'on_hold':
      case 'rejected':
      case 'blocked':
      case 'absent':
      case 'urgent':
        return (Palette.blockedBg, Palette.blocked);
      case 'completed':
      case 'closed':
        return (Palette.neutralBg, Palette.inkSoft);
      default:
        return (Palette.pendingBg, Palette.pending);
    }
  }

  @override
  Widget build(BuildContext context) {
    final (background, foreground) = toneFor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(999)),
      child: Text(
        label ?? _label(status),
        style: TextStyle(color: foreground, fontSize: 12, fontWeight: FontWeight.w600),
      ),
    );
  }

  static String _label(String status) {
    switch (status) {
      case 'on_hold':
        return 'On hold';
      case 'half_day':
        return 'Half day';
      case 'in_transit':
        return 'In transit';
      default:
        return status.isEmpty
            ? '—'
            : status[0].toUpperCase() + status.substring(1).replaceAll('_', ' ');
    }
  }
}

/// Nothing here, and why. Never a bare "No data".
class EmptyNote extends StatelessWidget {
  const EmptyNote({super.key, required this.title, required this.body, this.icon});

  final String title;
  final String body;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
    child: Column(
      children: [
        if (icon != null) ...[
          Icon(icon, size: 34, color: Palette.inkFaint),
          const SizedBox(height: 14),
        ],
        Text(
          title,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 6),
        Text(
          body,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 13.5, color: Palette.inkMuted, height: 1.45),
        ),
      ],
    ),
  );
}

/// A failed load, with the reason and a way to try again.
class ErrorNote extends StatelessWidget {
  const ErrorNote({super.key, required this.error, this.onRetry});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final message = error is ApiException
        ? (error as ApiException).message
        : 'Something went wrong';
    final forbidden = error is ApiException && (error as ApiException).status == 403;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 32),
      child: Column(
        children: [
          Icon(forbidden ? Icons.lock_outline : Icons.cloud_off, size: 30, color: Palette.inkFaint),
          const SizedBox(height: 12),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 14, color: Palette.inkSoft, height: 1.4),
          ),
          if (onRetry != null && !forbidden) ...[
            const SizedBox(height: 16),
            OutlinedButton(
              style: OutlinedButton.styleFrom(minimumSize: const Size(130, 44)),
              onPressed: onRetry,
              child: const Text('Try again'),
            ),
          ],
        ],
      ),
    );
  }
}

class Loading extends StatelessWidget {
  const Loading({super.key});

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 48),
    child: Center(child: CircularProgressIndicator(strokeWidth: 2.5)),
  );
}

/// A number with its label, for the tiles across the top of a screen.
/// One number with its name under it, and optionally the line of context the web tiles carry.
///
/// Fills whatever it is given rather than sizing itself: in a [Row] it goes inside an `Expanded`,
/// in a [KpiStrip] inside a fixed width. A tile that decided its own size would make those two
/// layouts disagree about which is in charge.
class StatTile extends StatelessWidget {
  const StatTile({
    super.key,
    required this.label,
    required this.value,
    this.note,
    this.tone,
    this.onTap,
  });

  final String label;
  final String value;

  /// The smaller line under the label — what the number is measured against, or what it implies.
  final String? note;
  final Color? tone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        decoration: BoxDecoration(
          color: Palette.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Palette.line),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: tone ?? Palette.ink),
            ),
            const SizedBox(height: 3),
            Text(
              label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, color: Palette.inkMuted, height: 1.25),
            ),
            if (note case final note?) ...[
              const SizedBox(height: 3),
              Text(
                note,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11, color: Palette.inkFaint, height: 1.25),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// The row of numbers a screen opens with, the same figures the web page shows above its table.
///
/// It scrolls sideways rather than wrapping to a grid. Four tiles will not fit across a phone at a
/// legible size, and a 2x2 block pushes the actual list — the thing somebody opened the screen for
/// — below the fold. The first tile and a half of the second are visible at rest, which is what
/// tells anybody there is more to swipe at.
class KpiStrip extends StatelessWidget {
  const KpiStrip({super.key, required this.tiles});

  final List<StatTile> tiles;

  @override
  Widget build(BuildContext context) {
    if (tiles.isEmpty) return const SizedBox.shrink();

    /*
     * Sized to the tallest tile rather than to a number.
     *
     * It was a fixed 96, which held until a tile needed two lines for its label *and* two for its
     * note — "Approved, not delivered / Ordered or awaiting delivery" — and then overflowed by
     * twelve pixels on a real phone. Any fixed height is the same bug waiting for a longer word or
     * a larger text scale, and somebody reading at 1.3x is exactly who cannot afford a clipped
     * number.
     *
     * `IntrinsicHeight` costs an extra layout pass over four tiles, which is nothing, and buys a
     * strip that cannot clip whatever is put in it.
     */
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: IntrinsicHeight(
        child: Row(
          // Every tile takes the height of the tallest, so the row reads as one band rather than a
          // skyline.
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var index = 0; index < tiles.length; index++) ...[
              if (index > 0) const SizedBox(width: 10),
              SizedBox(width: 168, child: tiles[index]),
            ],
          ],
        ),
      ),
    );
  }
}

/// A card that wraps a list, with dividers between rows and nothing around the edges.
class ListCard extends StatelessWidget {
  const ListCard({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Card(
    clipBehavior: Clip.antiAlias,
    child: Column(
      children: [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) const Divider(height: 1, indent: 16, endIndent: 16),
          children[i],
        ],
      ],
    ),
  );
}

/// Turns a provider's three states into the three widgets above, so no screen has to.
class AsyncSection<T> extends StatelessWidget {
  const AsyncSection({
    super.key,
    required this.value,
    required this.builder,
    required this.onRetry,
  });

  final AsyncValue<T> value;
  final Widget Function(T data) builder;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => value.when(
    loading: () => const Loading(),
    error: (error, _) => ErrorNote(error: error, onRetry: onRetry),
    data: builder,
  );
}

/// Tells somebody what happened, in one line, without stealing the screen.
/// Asks before something that cannot be undone by tapping again.
///
/// The destructive choice is named — "Remove", not "OK" — so the dialog can be read in the half
/// second anybody actually gives it, and the words say what will survive rather than only what is
/// being lost.
Future<bool> confirm(
  BuildContext context, {
  required String title,
  required String body,
  required String danger,
}) async {
  final answer = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Keep it'),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(danger, style: const TextStyle(color: Palette.blocked)),
        ),
      ],
    ),
  );
  return answer ?? false;
}

void notify(BuildContext context, String message, {bool bad = false}) {
  ScaffoldMessenger.of(context)
    ..clearSnackBars()
    ..showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: bad ? Palette.blocked : Palette.ink,
        duration: Duration(seconds: bad ? 5 : 3),
      ),
    );
}

/// Hands a file to whatever app on the phone can open it.
///
/// A PDF or a CAD export belongs in the viewer somebody already has, not in a reader this app would
/// otherwise have to grow and keep working. Returns false when nothing on the phone will take it,
/// so the caller can say so rather than appearing to do nothing.
Future<bool> openExternal(String url) async {
  try {
    return await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  } catch (_) {
    return false;
  }
}
