import 'package:buildr_mobile/core/push.dart';
import 'package:flutter_test/flutter_test.dart';

/// The types here are the ones the API actually emits — `apps/api/src/jobs/processors`. A tap that
/// lands nowhere is worse than a tap that opens the list, so the fallback is tested as carefully as
/// the routes.
void main() {
  group('sectionForNotification', () {
    test('routes on the subject, whatever happened to it', () {
      expect(sectionForNotification('indent.approved'), 'indents');
      expect(sectionForNotification('indent.rejected'), 'indents');
      expect(sectionForNotification('indent.partially_received'), 'indents');
      expect(sectionForNotification('dpr.submitted'), 'dpr');
    });

    test('has no destination for what the phone does not show', () {
      // Wage sheets are reviewed on the web; there is no mobile section to open.
      expect(sectionForNotification('wage_period.drafted'), isNull);
    });

    test('falls back rather than guessing', () {
      expect(sectionForNotification('something.new'), isNull);
      expect(sectionForNotification(''), isNull);
      expect(sectionForNotification('indent'), 'indents');
    });
  });

  group('PushTap', () {
    test('reads the data FCM carries', () {
      final tap = PushTap.fromData({'type': 'dpr.submitted', 'project_id': 'p1'});
      expect(tap.type, 'dpr.submitted');
      expect(tap.projectId, 'p1');
    });

    test('survives a message with nothing useful on it', () {
      final tap = PushTap.fromData({});
      expect(tap.type, '');
      expect(tap.projectId, isNull);
      expect(sectionForNotification(tap.type), isNull);
    });
  });
}
