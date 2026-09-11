/// Indian mobile numbers, normalised the way the server stores them.
///
/// A port of `toE164Indian` from `packages/shared/src/schemas/common.ts`, kept deliberately
/// identical. The two have to agree exactly: the app sends a number to Firebase and the API looks
/// the person up by the number it normalised at invite time, so any drift between them locks a real
/// person out of their own account with nothing in the logs to show why.
///
/// The rule the naive version gets wrong: a number cannot be un-prefixed by stripping a leading
/// "91", because 9198765432 is itself a valid ten-digit mobile. Only the length says which is which.
String? toE164Indian(String input) {
  final digits = input.replaceAll(RegExp(r'\D'), '');

  final String? subscriber;
  if (digits.length == 12 && digits.startsWith('91')) {
    subscriber = digits.substring(2);
  } else if (digits.length == 11 && digits.startsWith('0')) {
    subscriber = digits.substring(1);
  } else if (digits.length == 10) {
    subscriber = digits;
  } else {
    subscriber = null;
  }

  if (subscriber == null) return null;
  // Indian mobiles start 6-9. Landlines and short codes cannot receive an OTP.
  if (!RegExp(r'^[6-9]\d{9}$').hasMatch(subscriber)) return null;
  return '91$subscriber';
}

/// `919876543210` → `+91 98765 43210`, for showing back what somebody typed.
String formatIndianPhone(String e164) {
  final digits = e164.replaceAll(RegExp(r'\D'), '');
  if (digits.length != 12 || !digits.startsWith('91')) return e164;
  final subscriber = digits.substring(2);
  return '+91 ${subscriber.substring(0, 5)} ${subscriber.substring(5)}';
}
