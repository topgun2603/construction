import 'package:buildr_mobile/shared/location_picker.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('the picker opens and can be dragged on without closing', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => ElevatedButton(
                onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => const LocationPickerSheet(),
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('Where is the site?'), findsOneWidget);

    // Panning the map must move the map, not throw the sheet off the bottom of the screen.
    await tester.drag(find.byType(FlutterMap), const Offset(0, 160));
    await tester.pumpAndSettle();
    expect(find.text('Where is the site?'), findsOneWidget);
  });
}
