/// Money and dates, formatted the way this business writes them.
///
/// Money arrives from the API as a **string of paise**, never a number: `"2544000"` is ₹25,440.00.
/// It stays a string all the way here and is split with integer arithmetic, because a rupee value
/// large enough to matter — a crore budget is 10^11 paise — loses precision the moment it becomes a
/// double, and a wage sheet that is off by a paisa is a wage sheet somebody has to explain.
library;

/// `"2544000"` → `"25,440.00"`, Indian grouping.
String formatPaise(String? paise) {
  final value = BigInt.tryParse(paise ?? '') ?? BigInt.zero;
  final negative = value.isNegative;
  final abs = value.abs();
  final whole = abs ~/ BigInt.from(100);
  final fraction = (abs % BigInt.from(100)).toString().padLeft(2, '0');
  final text = '${_groupIndian(whole.toString())}.$fraction';
  return negative ? '-$text' : text;
}

String formatInr(String? paise) {
  final body = formatPaise(paise);
  return body.startsWith('-') ? '-₹${body.substring(1)}' : '₹$body';
}

/// Headline figures the way they are spoken: `₹4.2 Cr`, `₹94.2 L`.
///
/// Below a lakh there is no conventional short form, so it falls back to grouped rupees with no
/// paise — a tile showing a budget has no room for them and nobody reads them there.
String formatInrCompact(String? paise) {
  final value = BigInt.tryParse(paise ?? '') ?? BigInt.zero;
  final negative = value.isNegative;
  final rupees = value.abs() ~/ BigInt.from(100);
  final sign = negative ? '-' : '';

  final crore = BigInt.from(10000000);
  final lakh = BigInt.from(100000);
  if (rupees >= crore) return '$sign₹${_oneDecimal(rupees, crore)} Cr';
  if (rupees >= lakh) return '$sign₹${_oneDecimal(rupees, lakh)} L';
  return '$sign₹${_groupIndian(rupees.toString())}';
}

String _oneDecimal(BigInt rupees, BigInt unit) {
  final tenths = (rupees * BigInt.from(10)) ~/ unit;
  return '${tenths ~/ BigInt.from(10)}.${tenths % BigInt.from(10)}';
}

/// 2,2,3 grouping: 12345678 → 1,23,45,678.
String _groupIndian(String digits) {
  if (digits.length <= 3) return digits;
  final head = digits.substring(0, digits.length - 3);
  final tail = digits.substring(digits.length - 3);
  final grouped = head.replaceAllMapped(RegExp(r'\B(?=(\d{2})+(?!\d))'), (match) => ',');
  return '$grouped,$tail';
}

const _months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/// `2026-09-10` → `10 Sep`. The year only appears when it is not this one, because on a site
/// everything is this year and the extra four characters cost a column.
String shortDate(String? iso) {
  final date = parseIsoDate(iso);
  if (date == null) return '—';
  final now = DateTime.now();
  final suffix = date.year == now.year ? '' : ' ${date.year}';
  return '${date.day} ${_months[date.month - 1]}$suffix';
}

String longDate(String? iso) {
  final date = parseIsoDate(iso);
  if (date == null) return '—';
  return '${date.day} ${_months[date.month - 1]} ${date.year}';
}

DateTime? parseIsoDate(String? iso) {
  if (iso == null || iso.length < 10) return null;
  return DateTime.tryParse(iso.substring(0, 10));
}

/// `DateTime` → `2026-09-10`, which is what every date field on the API takes.
String isoDate(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

/// Today in the only timezone this product has: IST.
///
/// A phone left on airport time would otherwise file a report against yesterday, and attendance for
/// the wrong day is a wage dispute rather than a display bug.
String todayIso() {
  final ist = DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30));
  return isoDate(ist);
}

/// What somebody typed into a rupee field → a string of paise the API will take, or null when it
/// is not a number.
///
/// Integers the whole way: `3200.55` as a double is 3200.549999…, and a rounding slip here is a
/// rupee somebody has to account for at the end of the month. Commas, spaces and a leading ₹ are
/// stripped because people type a budget the way they say it.
String? rupeesToPaise(String input) {
  final text = input.replaceAll(RegExp(r'[,\s₹]'), '');
  final match = RegExp(r'^(\d+)(?:\.(\d{1,2}))?$').firstMatch(text);
  if (match == null) return null;

  final rupees = BigInt.parse(match.group(1)!);
  final paise = BigInt.parse((match.group(2) ?? '0').padRight(2, '0'));
  return (rupees * BigInt.from(100) + paise).toString();
}

/// `site_supervisor` → `Site supervisor`.
String titleCase(String value) {
  if (value.isEmpty) return value;
  final spaced = value.replaceAll('_', ' ');
  return spaced[0].toUpperCase() + spaced.substring(1);
}

/// How long ago, in the words somebody would use out loud.
String relativeTime(String? isoTimestamp) {
  if (isoTimestamp == null) return '';
  final then = DateTime.tryParse(isoTimestamp);
  if (then == null) return '';
  final diff = DateTime.now().difference(then.toLocal());
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return '${diff.inHours} h ago';
  if (diff.inDays == 1) return 'yesterday';
  if (diff.inDays < 7) return '${diff.inDays} days ago';
  return shortDate(isoTimestamp);
}
