import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_providers.dart';
import '../../shared/widgets.dart';
import 'documents_list.dart';

/// Every document across the sites this person is on.
///
/// The site's own list is where a drawing is usually filed, because one without a site is one
/// nobody can find. This is the other half: a client on two flats, or a manager running six, should
/// not have to remember which job the contract was filed against.
class DocumentsScreen extends ConsumerWidget {
  const DocumentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(documentsProvider(null));
          await ref.read(documentsProvider(null).future);
        },
        child: ListView(
          padding: EdgeInsets.fromLTRB(16, 14, 16, bottomInset(context, hasFab: true)),
          children: const [
            SectionLabel('Current revisions'),
            DocumentsList(showProject: true),
          ],
        ),
      ),
      /*
       * `fabInset` is already the whole lift — the phone's own navigation plus the floating bar the
       * shell draws over this screen. Subtracting the bar height back off, as this once did, put
       * the button exactly behind the bar it was meant to clear.
       */
      floatingActionButton: Padding(
        padding: EdgeInsets.only(bottom: fabInset(context)),
        child: const AddDocumentButton(),
      ),
    );
  }
}
