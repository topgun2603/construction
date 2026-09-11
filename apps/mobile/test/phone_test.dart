import 'package:buildr_mobile/core/phone.dart';
import 'package:flutter_test/flutter_test.dart';

/// Parity with `packages/shared/src/schemas/common.ts`.
///
/// These are the server's cases, ported deliberately. If this file and that one ever disagree, the
/// app sends Firebase one number while the API looks up another, and somebody who has been using
/// the product for a year cannot sign in — with nothing in either log to say why.
void main() {
  group('toE164Indian', () {
    test('accepts a plain ten-digit mobile', () {
      expect(toE164Indian('9876543210'), '919876543210');
    });

    test('accepts the ways people type it', () {
      expect(toE164Indian('+91 98765 43210'), '919876543210');
      expect(toE164Indian('+919876543210'), '919876543210');
      expect(toE164Indian('09876543210'), '919876543210');
      expect(toE164Indian('98765-43210'), '919876543210');
    });

    test('does not eat the 91 of a mobile that starts with it', () {
      // The bug this test exists for: stripping a leading "91" turns 9198765432 into 98765432,
      // which is not a number at all. Only the length says which 91 is a country code.
      expect(toE164Indian('9198765432'), '919198765432');
    });

    test('refuses what cannot receive an OTP', () {
      expect(toE164Indian('1234567890'), isNull); // starts with 1
      expect(toE164Indian('5876543210'), isNull); // landline range
      expect(toE164Indian('98765'), isNull);
      expect(toE164Indian(''), isNull);
      expect(toE164Indian('987654321012345'), isNull);
      expect(toE164Indian('+1 415 555 0100'), isNull); // not an Indian mobile
    });
  });

  group('formatIndianPhone', () {
    test('groups the way a number is read aloud', () {
      expect(formatIndianPhone('919876543210'), '+91 98765 43210');
    });

    test('leaves anything unexpected alone rather than mangling it', () {
      expect(formatIndianPhone('12345'), '12345');
    });
  });
}
