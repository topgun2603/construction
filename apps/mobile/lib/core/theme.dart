import 'package:flutter/material.dart';

/// The BUILDR palette, taken from the web preset (`packages/config/tailwind/preset.js`).
///
/// Kept as plain constants rather than derived from a seed colour: the two products are the same
/// product, and a client who sees the web app and the phone app on the same day should not be
/// wondering whether they are looking at the same company.
class Palette {
  const Palette._();

  static const canvas = Color(0xFFF2F1F9);
  static const surface = Color(0xFFFFFFFF);
  static const raised = Color(0xFFFAFAFE);

  static const ink = Color(0xFF1B1A2E);
  static const inkSoft = Color(0xFF4A4870);
  static const inkMuted = Color(0xFF6B6A8C);
  static const inkFaint = Color(0xFF9694B4);

  static const line = Color(0xFFE6E5F0);
  static const lineStrong = Color(0xFFD9D7E8);

  static const accent = Color(0xFF6C4CE0);
  static const accentSoft = Color(0xFFDCD6F8);

  static const done = Color(0xFF12805C);
  static const doneBg = Color(0xFFE3F6EF);
  static const pending = Color(0xFFA86A08);
  static const pendingBg = Color(0xFFFCF1E1);
  static const blocked = Color(0xFFD8443C);
  static const blockedBg = Color(0xFFFDEAE9);
  static const neutralBg = Color(0xFFEDECF6);
}

/// Light only, like the web app: status colour carries meaning here, and a second palette would need
/// every status pair re-derived to stay legible.
ThemeData buildrTheme() {
  final base = ThemeData.light(useMaterial3: true);

  return base.copyWith(
    scaffoldBackgroundColor: Palette.canvas,
    colorScheme: ColorScheme.fromSeed(
      seedColor: Palette.accent,
      brightness: Brightness.light,
    ).copyWith(primary: Palette.accent, surface: Palette.surface, error: Palette.blocked),
    textTheme: base.textTheme.apply(bodyColor: Palette.ink, displayColor: Palette.ink),
    appBarTheme: const AppBarTheme(
      backgroundColor: Palette.canvas,
      foregroundColor: Palette.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
    ),
    cardTheme: CardThemeData(
      color: Palette.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Palette.line),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Palette.accent,
        foregroundColor: Colors.white,
        // Site staff work one-handed, often with gloves — the same 48px target as the web app.
        minimumSize: const Size.fromHeight(52),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: Palette.ink,
        minimumSize: const Size.fromHeight(52),
        side: const BorderSide(color: Palette.lineStrong),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Palette.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Palette.lineStrong),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Palette.lineStrong),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Palette.accent, width: 2),
      ),
      hintStyle: const TextStyle(color: Palette.inkFaint),
    ),
    dividerTheme: const DividerThemeData(color: Palette.line, space: 1, thickness: 1),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: Palette.ink,
      contentTextStyle: TextStyle(color: Colors.white, fontSize: 14),
      behavior: SnackBarBehavior.floating,
    ),
  );
}
