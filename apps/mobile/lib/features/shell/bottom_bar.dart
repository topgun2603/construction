import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../shared/widgets.dart';

/// The bottom bar.
///
/// A floating pill rather than the Material default: it sits above the system navigation, which on
/// this class of phone is a gesture strip that would otherwise sit right on top of the labels, and
/// the shape makes it obvious the bar belongs to the app rather than the operating system.
///
/// EVERY ITEM GETS THE SAME WIDTH. The earlier version put the label beside the icon and let the
/// selected item grow, which cannot look evenly spaced however the gaps are distributed: one item is
/// simply wider than the others, so the icons drift out of rhythm and the eye reads the whole bar as
/// lopsided. Equal slots with the label under the icon keeps every icon on the same beat, and only
/// the highlight moves. It also removes the animated width that was flashing an overflow stripe
/// mid-transition — there is nothing left to overflow.
class FloatingBottomBar extends StatelessWidget {
  const FloatingBottomBar({
    super.key,
    required this.items,
    required this.selectedIndex,
    required this.onSelected,
  });

  final List<({IconData icon, String label})> items;
  final int selectedIndex;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    /*
     * SafeArea, not arithmetic on the inset.
     *
     * Working it out by hand went wrong: the Scaffold hands its bottom bar a MediaQuery it has
     * already adjusted, so measuring the inset here and adding a fraction of it left the pill sitting
     * on the system navigation with its bottom corners cut off. SafeArea asks the framework for the
     * real gap and is right on a gesture strip, on three buttons, and on a phone with neither.
     */
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
        child: Container(
          // 64 plus the 10 below it is `kFloatingBarHeight`, which is what every screen leaves clear.
          height: kFloatingBarHeight - 10,
          padding: const EdgeInsets.symmetric(horizontal: 6),
          decoration: BoxDecoration(
            color: Palette.ink,
            borderRadius: BorderRadius.circular(22),
            boxShadow: [
              BoxShadow(
                color: Palette.ink.withValues(alpha: 0.28),
                blurRadius: 22,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Row(
            children: [
              for (var i = 0; i < items.length; i++)
                _Item(
                  icon: items[i].icon,
                  label: items[i].label,
                  selected: i == selectedIndex,
                  onTap: () => onSelected(i),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Item extends StatelessWidget {
  const _Item({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Semantics(
        selected: selected,
        button: true,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // Only the highlight moves. A fixed size, so nothing reflows when the selection changes.
              AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                curve: Curves.easeOut,
                width: 46,
                height: 28,
                decoration: BoxDecoration(
                  color: selected ? Palette.accent : Colors.transparent,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Icon(icon, size: 20, color: selected ? Colors.white : Colors.white70),
              ),
              const SizedBox(height: 4),
              Text(
                label,
                maxLines: 1,
                // A long label in another language shortens rather than pushing the bar around.
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11,
                  height: 1.1,
                  color: selected ? Colors.white : Colors.white60,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
