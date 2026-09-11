import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_providers.dart';
import '../core/format.dart';
import '../core/theme.dart';
import 'widgets.dart';

/// Photographs of a site.
///
/// The objects are private, so every image here is fetched through a URL signed for this person, for
/// an hour. Nothing in the app ever holds a permanent link to somebody's site photographs, and a URL
/// that leaks stops working on its own.
class SitePhotos extends ConsumerWidget {
  const SitePhotos({super.key, required this.projectId});

  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final media = ref.watch(siteMediaProvider(projectId));

    return AsyncSection<List<Map<String, dynamic>>>(
      value: media,
      onRetry: () => ref.invalidate(siteMediaProvider(projectId)),
      builder: (rows) {
        if (rows.isEmpty) {
          return const Card(
            child: EmptyNote(
              icon: Icons.photo_camera_outlined,
              title: 'No photos yet',
              body:
                  'Photographs of the approach, the elevation, the work in progress — added from '
                  'the web app for now.',
            ),
          );
        }

        return SizedBox(
          height: 150,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: rows.length,
            separatorBuilder: (_, _) => const SizedBox(width: 10),
            itemBuilder: (context, index) => _Thumb(
              media: rows[index],
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => _Viewer(media: rows, initialIndex: index),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _Thumb extends ConsumerWidget {
  const _Thumb({required this.media, required this.onTap});

  final Map<String, dynamic> media;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // The thumbnail if the media worker has made one, the original otherwise — a 4 MB photo shown at
    // 190 pixels is a slow gallery on a site with one bar of signal.
    final key = (media['thumb_s3_key'] ?? media['s3_key']) as String;
    final url = ref.watch(viewUrlProvider(key));
    final isVideo = media['kind'] == 'video';

    return GestureDetector(
      onTap: onTap,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: SizedBox(
          width: 190,
          height: 150,
          child: Stack(
            fit: StackFit.expand,
            children: [
              Container(color: Palette.neutralBg),
              url.when(
                loading: () => const Center(
                  child: SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
                error: (_, _) =>
                    const Center(child: Icon(Icons.broken_image_outlined, color: Palette.inkFaint)),
                data: (link) => Image.network(
                  link,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => const Center(
                    child: Icon(Icons.broken_image_outlined, color: Palette.inkFaint),
                  ),
                ),
              ),
              if (isVideo)
                const Center(child: Icon(Icons.play_circle_fill, size: 40, color: Colors.white70)),
              if (media['caption'] != null)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                    decoration: const BoxDecoration(color: Color(0xB31B1A2E)),
                    child: Text(
                      media['caption'] as String,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Colors.white, fontSize: 12),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Full screen, swipe between photos, pinch to zoom.
class _Viewer extends ConsumerStatefulWidget {
  const _Viewer({required this.media, required this.initialIndex});

  final List<Map<String, dynamic>> media;
  final int initialIndex;

  @override
  ConsumerState<_Viewer> createState() => _ViewerState();
}

class _ViewerState extends ConsumerState<_Viewer> {
  late final PageController _controller = PageController(initialPage: widget.initialIndex);
  late int _index = widget.initialIndex;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final current = widget.media[_index];

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(
          '${_index + 1} of ${widget.media.length}',
          style: const TextStyle(fontSize: 15, color: Colors.white),
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: PageView.builder(
              controller: _controller,
              itemCount: widget.media.length,
              onPageChanged: (index) => setState(() => _index = index),
              itemBuilder: (context, index) {
                // The original here, not the thumbnail: this is the screen somebody opened to look
                // closely at a crack in a wall.
                final key = widget.media[index]['s3_key'] as String;
                final url = ref.watch(viewUrlProvider(key));
                return url.when(
                  loading: () => const Center(
                    child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white54),
                  ),
                  error: (_, _) => const Center(
                    child: Text('Could not load this one', style: TextStyle(color: Colors.white70)),
                  ),
                  data: (link) => InteractiveViewer(
                    maxScale: 5,
                    child: Center(
                      child: Image.network(
                        link,
                        fit: BoxFit.contain,
                        errorBuilder: (_, _, _) => const Icon(
                          Icons.broken_image_outlined,
                          color: Colors.white54,
                          size: 40,
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          Container(
            width: double.infinity,
            color: Colors.black,
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (current['caption'] != null)
                  Text(
                    current['caption'] as String,
                    style: const TextStyle(color: Colors.white, fontSize: 15, height: 1.4),
                  ),
                const SizedBox(height: 4),
                Text(
                  '${(current['uploaded_by'] as Map?)?['name'] ?? ''} · '
                  '${shortDate((current['taken_at'] ?? current['created_at']) as String?)}',
                  style: const TextStyle(color: Colors.white54, fontSize: 12.5),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
