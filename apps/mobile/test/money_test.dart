import 'package:buildr_mobile/core/format.dart';
import 'package:flutter_test/flutter_test.dart';

/// Money is entered by people and stored as paise. Every case here is one somebody types on a site:
/// a budget said aloud in lakhs, an amount pasted with commas, a rupee figure with no paise at all.
void main() {
  group('rupeesToPaise', () {
    test('whole rupees become paise', () {
      expect(rupeesToPaise('3200'), '320000');
      expect(rupeesToPaise('0'), '0');
    });

    test('keeps both paise digits, and pads one', () {
      expect(rupeesToPaise('3200.55'), '320055');
      expect(rupeesToPaise('3200.5'), '320050');
    });

    test('forgives how people type an amount', () {
      expect(rupeesToPaise(' ₹ 4,20,00,000 '), '4200000000');
      expect(rupeesToPaise('42,00,000'), '420000000');
    });

    test('does not lose paise on a figure too large for a double', () {
      // ₹9,00,00,00,000.99 — a double would round the tail away.
      expect(rupeesToPaise('9000000000.99'), '900000000099');
    });

    test('refuses what is not an amount', () {
      expect(rupeesToPaise(''), isNull);
      expect(rupeesToPaise('later'), isNull);
      expect(rupeesToPaise('-500'), isNull);
      // Three decimal places is a typo, not a third of a paisa.
      expect(rupeesToPaise('3200.555'), isNull);
    });
  });
}
