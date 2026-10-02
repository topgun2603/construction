import 'api_client.dart';

/// Everything the app asks a model, in one place.
///
/// One file for the same reason the API has one `AiModule`: there should be exactly one place to
/// look for what this product sends to a vendor, and exactly one place to change when that vendor
/// changes. Every method here returns a *draft* or an *answer* — none of them writes anything. The
/// person at the phone is what turns a draft into a record, which is the whole safety model.
class AiApi {
  const AiApi(this._api);

  final ApiClient _api;

  /// A spoken site note, read into a report draft. Files nothing.
  Future<VoiceDraft> readVoiceNote({
    required String s3Key,
    required String projectId,
    String? reportDate,
  }) async {
    final json = await _api.post(
      '/dpr/voice',
      body: {
        's3_key': s3Key,
        'project_id': projectId,
        'report_date': ?reportDate,
      },
    );
    return VoiceDraft.fromJson(json as Map<String, dynamic>);
  }

  /// A photographed bill, read into an expense draft. Saves nothing.
  Future<BillDraft> scanBill(String s3Key) async {
    final json = await _api.post('/expenses/scan', body: {'s3_key': s3Key});
    return BillDraft.fromJson(json as Map<String, dynamic>);
  }

  /// A question answered from the text of the documents this person can see.
  Future<DocumentAnswer> askDocuments(String question, {String? projectId}) async {
    final json = await _api.post(
      '/documents/ask',
      body: {'question': question, 'project_id': ?projectId},
    );
    return DocumentAnswer.fromJson(json as Map<String, dynamic>);
  }

  /// A question about this account's own numbers.
  Future<DataAnswer> ask(String question) async {
    final json = await _api.post('/ask', body: {'question': question});
    return DataAnswer.fromJson(json as Map<String, dynamic>);
  }

  /// One line of text, in another language.
  Future<String> translate(String text, {required String to}) async {
    final json = await _api.post('/translate', body: {'text': text, 'to': to});
    return (json as Map<String, dynamic>)['text'] as String? ?? text;
  }
}

/// What a spoken note became. The transcript is kept so the words can be checked against a memory.
class VoiceDraft {
  const VoiceDraft({
    required this.transcript,
    required this.language,
    required this.reportDate,
    required this.weather,
    required this.workDone,
    required this.issues,
    required this.manpower,
    required this.caveats,
  });

  final String transcript;
  final String? language;
  final String reportDate;
  final String? weather;
  final String? workDone;
  final String? issues;
  final List<({String trade, int count})> manpower;
  final List<String> caveats;

  int get headcount => manpower.fold(0, (sum, row) => sum + row.count);

  factory VoiceDraft.fromJson(Map<String, dynamic> json) {
    final draft = (json['draft'] as Map<String, dynamic>?) ?? const {};
    final rows = (draft['manpower'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>();
    return VoiceDraft(
      transcript: json['transcript'] as String? ?? '',
      language: json['language'] as String?,
      reportDate: draft['report_date'] as String? ?? '',
      weather: draft['weather'] as String?,
      workDone: draft['work_done'] as String?,
      issues: draft['issues'] as String?,
      manpower: [
        for (final row in rows)
          (trade: row['trade'] as String? ?? '', count: (row['count'] as num?)?.toInt() ?? 0),
      ],
      caveats: (json['caveats'] as List<dynamic>? ?? const []).cast<String>(),
    );
  }
}

/// What a photographed bill became. Every field is nullable: a bill shot at dusk may genuinely not
/// show a date, and null means "you read this yourself" rather than a confident guess.
class BillDraft {
  const BillDraft({
    required this.amountPaise,
    required this.vendor,
    required this.spentOn,
    required this.category,
    required this.gstin,
    required this.summary,
    required this.unread,
  });

  /// Paise, as a string, like every other amount on the wire.
  final String? amountPaise;
  final String? vendor;
  final String? spentOn;
  final String? category;
  final String? gstin;
  final String? summary;

  /// Field names the scan could not fill, so the form can say so rather than look complete.
  final List<String> unread;

  factory BillDraft.fromJson(Map<String, dynamic> json) => BillDraft(
    amountPaise: json['amount'] as String?,
    vendor: json['vendor'] as String?,
    spentOn: json['spent_on'] as String?,
    category: json['category'] as String?,
    gstin: json['gstin'] as String?,
    summary: json['summary'] as String?,
    unread: (json['unread'] as List<dynamic>? ?? const []).cast<String>(),
  );
}

/// An answer from the drawings, with the page it came from.
class DocumentAnswer {
  const DocumentAnswer({
    required this.answer,
    required this.answered,
    required this.sources,
    required this.caveat,
  });

  final String answer;

  /// False when the documents do not contain the answer. Not a failure — a correct, useful answer.
  final bool answered;
  final List<DocumentCitation> sources;
  final String? caveat;

  factory DocumentAnswer.fromJson(Map<String, dynamic> json) => DocumentAnswer(
    answer: json['answer'] as String? ?? '',
    answered: json['answered'] as bool? ?? false,
    sources: [
      for (final row in (json['sources'] as List<dynamic>? ?? const []))
        DocumentCitation.fromJson(row as Map<String, dynamic>),
    ],
    caveat: json['caveat'] as String?,
  );
}

class DocumentCitation {
  const DocumentCitation({
    required this.title,
    required this.page,
    required this.snippet,
    required this.projectName,
  });

  final String title;
  final int page;
  final String snippet;
  final String? projectName;

  factory DocumentCitation.fromJson(Map<String, dynamic> json) => DocumentCitation(
    title: json['title'] as String? ?? '',
    page: (json['page'] as num?)?.toInt() ?? 0,
    snippet: json['snippet'] as String? ?? '',
    projectName: json['project_name'] as String?,
  );
}

/// An answer about the account's own numbers, with what was understood of the question.
class DataAnswer {
  const DataAnswer({
    required this.answer,
    required this.project,
    required this.period,
    required this.caveat,
  });

  final String answer;
  final String? project;
  final String period;
  final String? caveat;

  factory DataAnswer.fromJson(Map<String, dynamic> json) {
    final understood = (json['understood'] as Map<String, dynamic>?) ?? const {};
    return DataAnswer(
      answer: json['answer'] as String? ?? '',
      project: understood['project'] as String?,
      period: understood['period'] as String? ?? '',
      caveat: json['caveat'] as String?,
    );
  }
}
