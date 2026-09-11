// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'database.dart';

// ignore_for_file: type=lint
class $MirroredProjectsTable extends MirroredProjects
    with TableInfo<$MirroredProjectsTable, MirroredProject> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $MirroredProjectsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _clientNameMeta = const VerificationMeta(
    'clientName',
  );
  @override
  late final GeneratedColumn<String> clientName = GeneratedColumn<String>(
    'client_name',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _addressMeta = const VerificationMeta(
    'address',
  );
  @override
  late final GeneratedColumn<String> address = GeneratedColumn<String>(
    'address',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
    'status',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('planning'),
  );
  static const VerificationMeta _startDateMeta = const VerificationMeta(
    'startDate',
  );
  @override
  late final GeneratedColumn<String> startDate = GeneratedColumn<String>(
    'start_date',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _targetEndDateMeta = const VerificationMeta(
    'targetEndDate',
  );
  @override
  late final GeneratedColumn<String> targetEndDate = GeneratedColumn<String>(
    'target_end_date',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _budgetAmountMeta = const VerificationMeta(
    'budgetAmount',
  );
  @override
  late final GeneratedColumn<String> budgetAmount = GeneratedColumn<String>(
    'budget_amount',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _latMeta = const VerificationMeta('lat');
  @override
  late final GeneratedColumn<double> lat = GeneratedColumn<double>(
    'lat',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _lngMeta = const VerificationMeta('lng');
  @override
  late final GeneratedColumn<double> lng = GeneratedColumn<double>(
    'lng',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    name,
    clientName,
    address,
    status,
    startDate,
    targetEndDate,
    budgetAmount,
    lat,
    lng,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'mirrored_projects';
  @override
  VerificationContext validateIntegrity(
    Insertable<MirroredProject> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('client_name')) {
      context.handle(
        _clientNameMeta,
        clientName.isAcceptableOrUnknown(data['client_name']!, _clientNameMeta),
      );
    }
    if (data.containsKey('address')) {
      context.handle(
        _addressMeta,
        address.isAcceptableOrUnknown(data['address']!, _addressMeta),
      );
    }
    if (data.containsKey('status')) {
      context.handle(
        _statusMeta,
        status.isAcceptableOrUnknown(data['status']!, _statusMeta),
      );
    }
    if (data.containsKey('start_date')) {
      context.handle(
        _startDateMeta,
        startDate.isAcceptableOrUnknown(data['start_date']!, _startDateMeta),
      );
    }
    if (data.containsKey('target_end_date')) {
      context.handle(
        _targetEndDateMeta,
        targetEndDate.isAcceptableOrUnknown(
          data['target_end_date']!,
          _targetEndDateMeta,
        ),
      );
    }
    if (data.containsKey('budget_amount')) {
      context.handle(
        _budgetAmountMeta,
        budgetAmount.isAcceptableOrUnknown(
          data['budget_amount']!,
          _budgetAmountMeta,
        ),
      );
    }
    if (data.containsKey('lat')) {
      context.handle(
        _latMeta,
        lat.isAcceptableOrUnknown(data['lat']!, _latMeta),
      );
    }
    if (data.containsKey('lng')) {
      context.handle(
        _lngMeta,
        lng.isAcceptableOrUnknown(data['lng']!, _lngMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  MirroredProject map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return MirroredProject(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
      clientName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}client_name'],
      ),
      address: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}address'],
      ),
      status: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}status'],
      )!,
      startDate: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}start_date'],
      ),
      targetEndDate: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}target_end_date'],
      ),
      budgetAmount: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}budget_amount'],
      ),
      lat: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}lat'],
      ),
      lng: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}lng'],
      ),
    );
  }

  @override
  $MirroredProjectsTable createAlias(String alias) {
    return $MirroredProjectsTable(attachedDatabase, alias);
  }
}

class MirroredProject extends DataClass implements Insertable<MirroredProject> {
  final String id;
  final String name;
  final String? clientName;
  final String? address;
  final String status;
  final String? startDate;
  final String? targetEndDate;
  final String? budgetAmount;
  final double? lat;
  final double? lng;
  const MirroredProject({
    required this.id,
    required this.name,
    this.clientName,
    this.address,
    required this.status,
    this.startDate,
    this.targetEndDate,
    this.budgetAmount,
    this.lat,
    this.lng,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['name'] = Variable<String>(name);
    if (!nullToAbsent || clientName != null) {
      map['client_name'] = Variable<String>(clientName);
    }
    if (!nullToAbsent || address != null) {
      map['address'] = Variable<String>(address);
    }
    map['status'] = Variable<String>(status);
    if (!nullToAbsent || startDate != null) {
      map['start_date'] = Variable<String>(startDate);
    }
    if (!nullToAbsent || targetEndDate != null) {
      map['target_end_date'] = Variable<String>(targetEndDate);
    }
    if (!nullToAbsent || budgetAmount != null) {
      map['budget_amount'] = Variable<String>(budgetAmount);
    }
    if (!nullToAbsent || lat != null) {
      map['lat'] = Variable<double>(lat);
    }
    if (!nullToAbsent || lng != null) {
      map['lng'] = Variable<double>(lng);
    }
    return map;
  }

  MirroredProjectsCompanion toCompanion(bool nullToAbsent) {
    return MirroredProjectsCompanion(
      id: Value(id),
      name: Value(name),
      clientName: clientName == null && nullToAbsent
          ? const Value.absent()
          : Value(clientName),
      address: address == null && nullToAbsent
          ? const Value.absent()
          : Value(address),
      status: Value(status),
      startDate: startDate == null && nullToAbsent
          ? const Value.absent()
          : Value(startDate),
      targetEndDate: targetEndDate == null && nullToAbsent
          ? const Value.absent()
          : Value(targetEndDate),
      budgetAmount: budgetAmount == null && nullToAbsent
          ? const Value.absent()
          : Value(budgetAmount),
      lat: lat == null && nullToAbsent ? const Value.absent() : Value(lat),
      lng: lng == null && nullToAbsent ? const Value.absent() : Value(lng),
    );
  }

  factory MirroredProject.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return MirroredProject(
      id: serializer.fromJson<String>(json['id']),
      name: serializer.fromJson<String>(json['name']),
      clientName: serializer.fromJson<String?>(json['clientName']),
      address: serializer.fromJson<String?>(json['address']),
      status: serializer.fromJson<String>(json['status']),
      startDate: serializer.fromJson<String?>(json['startDate']),
      targetEndDate: serializer.fromJson<String?>(json['targetEndDate']),
      budgetAmount: serializer.fromJson<String?>(json['budgetAmount']),
      lat: serializer.fromJson<double?>(json['lat']),
      lng: serializer.fromJson<double?>(json['lng']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'name': serializer.toJson<String>(name),
      'clientName': serializer.toJson<String?>(clientName),
      'address': serializer.toJson<String?>(address),
      'status': serializer.toJson<String>(status),
      'startDate': serializer.toJson<String?>(startDate),
      'targetEndDate': serializer.toJson<String?>(targetEndDate),
      'budgetAmount': serializer.toJson<String?>(budgetAmount),
      'lat': serializer.toJson<double?>(lat),
      'lng': serializer.toJson<double?>(lng),
    };
  }

  MirroredProject copyWith({
    String? id,
    String? name,
    Value<String?> clientName = const Value.absent(),
    Value<String?> address = const Value.absent(),
    String? status,
    Value<String?> startDate = const Value.absent(),
    Value<String?> targetEndDate = const Value.absent(),
    Value<String?> budgetAmount = const Value.absent(),
    Value<double?> lat = const Value.absent(),
    Value<double?> lng = const Value.absent(),
  }) => MirroredProject(
    id: id ?? this.id,
    name: name ?? this.name,
    clientName: clientName.present ? clientName.value : this.clientName,
    address: address.present ? address.value : this.address,
    status: status ?? this.status,
    startDate: startDate.present ? startDate.value : this.startDate,
    targetEndDate: targetEndDate.present
        ? targetEndDate.value
        : this.targetEndDate,
    budgetAmount: budgetAmount.present ? budgetAmount.value : this.budgetAmount,
    lat: lat.present ? lat.value : this.lat,
    lng: lng.present ? lng.value : this.lng,
  );
  MirroredProject copyWithCompanion(MirroredProjectsCompanion data) {
    return MirroredProject(
      id: data.id.present ? data.id.value : this.id,
      name: data.name.present ? data.name.value : this.name,
      clientName: data.clientName.present
          ? data.clientName.value
          : this.clientName,
      address: data.address.present ? data.address.value : this.address,
      status: data.status.present ? data.status.value : this.status,
      startDate: data.startDate.present ? data.startDate.value : this.startDate,
      targetEndDate: data.targetEndDate.present
          ? data.targetEndDate.value
          : this.targetEndDate,
      budgetAmount: data.budgetAmount.present
          ? data.budgetAmount.value
          : this.budgetAmount,
      lat: data.lat.present ? data.lat.value : this.lat,
      lng: data.lng.present ? data.lng.value : this.lng,
    );
  }

  @override
  String toString() {
    return (StringBuffer('MirroredProject(')
          ..write('id: $id, ')
          ..write('name: $name, ')
          ..write('clientName: $clientName, ')
          ..write('address: $address, ')
          ..write('status: $status, ')
          ..write('startDate: $startDate, ')
          ..write('targetEndDate: $targetEndDate, ')
          ..write('budgetAmount: $budgetAmount, ')
          ..write('lat: $lat, ')
          ..write('lng: $lng')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    name,
    clientName,
    address,
    status,
    startDate,
    targetEndDate,
    budgetAmount,
    lat,
    lng,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is MirroredProject &&
          other.id == this.id &&
          other.name == this.name &&
          other.clientName == this.clientName &&
          other.address == this.address &&
          other.status == this.status &&
          other.startDate == this.startDate &&
          other.targetEndDate == this.targetEndDate &&
          other.budgetAmount == this.budgetAmount &&
          other.lat == this.lat &&
          other.lng == this.lng);
}

class MirroredProjectsCompanion extends UpdateCompanion<MirroredProject> {
  final Value<String> id;
  final Value<String> name;
  final Value<String?> clientName;
  final Value<String?> address;
  final Value<String> status;
  final Value<String?> startDate;
  final Value<String?> targetEndDate;
  final Value<String?> budgetAmount;
  final Value<double?> lat;
  final Value<double?> lng;
  final Value<int> rowid;
  const MirroredProjectsCompanion({
    this.id = const Value.absent(),
    this.name = const Value.absent(),
    this.clientName = const Value.absent(),
    this.address = const Value.absent(),
    this.status = const Value.absent(),
    this.startDate = const Value.absent(),
    this.targetEndDate = const Value.absent(),
    this.budgetAmount = const Value.absent(),
    this.lat = const Value.absent(),
    this.lng = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  MirroredProjectsCompanion.insert({
    required String id,
    required String name,
    this.clientName = const Value.absent(),
    this.address = const Value.absent(),
    this.status = const Value.absent(),
    this.startDate = const Value.absent(),
    this.targetEndDate = const Value.absent(),
    this.budgetAmount = const Value.absent(),
    this.lat = const Value.absent(),
    this.lng = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       name = Value(name);
  static Insertable<MirroredProject> custom({
    Expression<String>? id,
    Expression<String>? name,
    Expression<String>? clientName,
    Expression<String>? address,
    Expression<String>? status,
    Expression<String>? startDate,
    Expression<String>? targetEndDate,
    Expression<String>? budgetAmount,
    Expression<double>? lat,
    Expression<double>? lng,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (name != null) 'name': name,
      if (clientName != null) 'client_name': clientName,
      if (address != null) 'address': address,
      if (status != null) 'status': status,
      if (startDate != null) 'start_date': startDate,
      if (targetEndDate != null) 'target_end_date': targetEndDate,
      if (budgetAmount != null) 'budget_amount': budgetAmount,
      if (lat != null) 'lat': lat,
      if (lng != null) 'lng': lng,
      if (rowid != null) 'rowid': rowid,
    });
  }

  MirroredProjectsCompanion copyWith({
    Value<String>? id,
    Value<String>? name,
    Value<String?>? clientName,
    Value<String?>? address,
    Value<String>? status,
    Value<String?>? startDate,
    Value<String?>? targetEndDate,
    Value<String?>? budgetAmount,
    Value<double?>? lat,
    Value<double?>? lng,
    Value<int>? rowid,
  }) {
    return MirroredProjectsCompanion(
      id: id ?? this.id,
      name: name ?? this.name,
      clientName: clientName ?? this.clientName,
      address: address ?? this.address,
      status: status ?? this.status,
      startDate: startDate ?? this.startDate,
      targetEndDate: targetEndDate ?? this.targetEndDate,
      budgetAmount: budgetAmount ?? this.budgetAmount,
      lat: lat ?? this.lat,
      lng: lng ?? this.lng,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (clientName.present) {
      map['client_name'] = Variable<String>(clientName.value);
    }
    if (address.present) {
      map['address'] = Variable<String>(address.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (startDate.present) {
      map['start_date'] = Variable<String>(startDate.value);
    }
    if (targetEndDate.present) {
      map['target_end_date'] = Variable<String>(targetEndDate.value);
    }
    if (budgetAmount.present) {
      map['budget_amount'] = Variable<String>(budgetAmount.value);
    }
    if (lat.present) {
      map['lat'] = Variable<double>(lat.value);
    }
    if (lng.present) {
      map['lng'] = Variable<double>(lng.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('MirroredProjectsCompanion(')
          ..write('id: $id, ')
          ..write('name: $name, ')
          ..write('clientName: $clientName, ')
          ..write('address: $address, ')
          ..write('status: $status, ')
          ..write('startDate: $startDate, ')
          ..write('targetEndDate: $targetEndDate, ')
          ..write('budgetAmount: $budgetAmount, ')
          ..write('lat: $lat, ')
          ..write('lng: $lng, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $MirroredWorkersTable extends MirroredWorkers
    with TableInfo<$MirroredWorkersTable, MirroredWorker> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $MirroredWorkersTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _tradeMeta = const VerificationMeta('trade');
  @override
  late final GeneratedColumn<String> trade = GeneratedColumn<String>(
    'trade',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _skillLevelMeta = const VerificationMeta(
    'skillLevel',
  );
  @override
  late final GeneratedColumn<String> skillLevel = GeneratedColumn<String>(
    'skill_level',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
    'status',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('active'),
  );
  static const VerificationMeta _contractorIdMeta = const VerificationMeta(
    'contractorId',
  );
  @override
  late final GeneratedColumn<String> contractorId = GeneratedColumn<String>(
    'contractor_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _contractorNameMeta = const VerificationMeta(
    'contractorName',
  );
  @override
  late final GeneratedColumn<String> contractorName = GeneratedColumn<String>(
    'contractor_name',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _dailyWageMeta = const VerificationMeta(
    'dailyWage',
  );
  @override
  late final GeneratedColumn<String> dailyWage = GeneratedColumn<String>(
    'daily_wage',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    name,
    trade,
    skillLevel,
    status,
    contractorId,
    contractorName,
    dailyWage,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'mirrored_workers';
  @override
  VerificationContext validateIntegrity(
    Insertable<MirroredWorker> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('trade')) {
      context.handle(
        _tradeMeta,
        trade.isAcceptableOrUnknown(data['trade']!, _tradeMeta),
      );
    }
    if (data.containsKey('skill_level')) {
      context.handle(
        _skillLevelMeta,
        skillLevel.isAcceptableOrUnknown(data['skill_level']!, _skillLevelMeta),
      );
    }
    if (data.containsKey('status')) {
      context.handle(
        _statusMeta,
        status.isAcceptableOrUnknown(data['status']!, _statusMeta),
      );
    }
    if (data.containsKey('contractor_id')) {
      context.handle(
        _contractorIdMeta,
        contractorId.isAcceptableOrUnknown(
          data['contractor_id']!,
          _contractorIdMeta,
        ),
      );
    }
    if (data.containsKey('contractor_name')) {
      context.handle(
        _contractorNameMeta,
        contractorName.isAcceptableOrUnknown(
          data['contractor_name']!,
          _contractorNameMeta,
        ),
      );
    }
    if (data.containsKey('daily_wage')) {
      context.handle(
        _dailyWageMeta,
        dailyWage.isAcceptableOrUnknown(data['daily_wage']!, _dailyWageMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  MirroredWorker map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return MirroredWorker(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
      trade: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}trade'],
      ),
      skillLevel: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}skill_level'],
      ),
      status: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}status'],
      )!,
      contractorId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}contractor_id'],
      ),
      contractorName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}contractor_name'],
      ),
      dailyWage: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}daily_wage'],
      ),
    );
  }

  @override
  $MirroredWorkersTable createAlias(String alias) {
    return $MirroredWorkersTable(attachedDatabase, alias);
  }
}

class MirroredWorker extends DataClass implements Insertable<MirroredWorker> {
  final String id;
  final String name;
  final String? trade;
  final String? skillLevel;
  final String status;
  final String? contractorId;
  final String? contractorName;
  final String? dailyWage;
  const MirroredWorker({
    required this.id,
    required this.name,
    this.trade,
    this.skillLevel,
    required this.status,
    this.contractorId,
    this.contractorName,
    this.dailyWage,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['name'] = Variable<String>(name);
    if (!nullToAbsent || trade != null) {
      map['trade'] = Variable<String>(trade);
    }
    if (!nullToAbsent || skillLevel != null) {
      map['skill_level'] = Variable<String>(skillLevel);
    }
    map['status'] = Variable<String>(status);
    if (!nullToAbsent || contractorId != null) {
      map['contractor_id'] = Variable<String>(contractorId);
    }
    if (!nullToAbsent || contractorName != null) {
      map['contractor_name'] = Variable<String>(contractorName);
    }
    if (!nullToAbsent || dailyWage != null) {
      map['daily_wage'] = Variable<String>(dailyWage);
    }
    return map;
  }

  MirroredWorkersCompanion toCompanion(bool nullToAbsent) {
    return MirroredWorkersCompanion(
      id: Value(id),
      name: Value(name),
      trade: trade == null && nullToAbsent
          ? const Value.absent()
          : Value(trade),
      skillLevel: skillLevel == null && nullToAbsent
          ? const Value.absent()
          : Value(skillLevel),
      status: Value(status),
      contractorId: contractorId == null && nullToAbsent
          ? const Value.absent()
          : Value(contractorId),
      contractorName: contractorName == null && nullToAbsent
          ? const Value.absent()
          : Value(contractorName),
      dailyWage: dailyWage == null && nullToAbsent
          ? const Value.absent()
          : Value(dailyWage),
    );
  }

  factory MirroredWorker.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return MirroredWorker(
      id: serializer.fromJson<String>(json['id']),
      name: serializer.fromJson<String>(json['name']),
      trade: serializer.fromJson<String?>(json['trade']),
      skillLevel: serializer.fromJson<String?>(json['skillLevel']),
      status: serializer.fromJson<String>(json['status']),
      contractorId: serializer.fromJson<String?>(json['contractorId']),
      contractorName: serializer.fromJson<String?>(json['contractorName']),
      dailyWage: serializer.fromJson<String?>(json['dailyWage']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'name': serializer.toJson<String>(name),
      'trade': serializer.toJson<String?>(trade),
      'skillLevel': serializer.toJson<String?>(skillLevel),
      'status': serializer.toJson<String>(status),
      'contractorId': serializer.toJson<String?>(contractorId),
      'contractorName': serializer.toJson<String?>(contractorName),
      'dailyWage': serializer.toJson<String?>(dailyWage),
    };
  }

  MirroredWorker copyWith({
    String? id,
    String? name,
    Value<String?> trade = const Value.absent(),
    Value<String?> skillLevel = const Value.absent(),
    String? status,
    Value<String?> contractorId = const Value.absent(),
    Value<String?> contractorName = const Value.absent(),
    Value<String?> dailyWage = const Value.absent(),
  }) => MirroredWorker(
    id: id ?? this.id,
    name: name ?? this.name,
    trade: trade.present ? trade.value : this.trade,
    skillLevel: skillLevel.present ? skillLevel.value : this.skillLevel,
    status: status ?? this.status,
    contractorId: contractorId.present ? contractorId.value : this.contractorId,
    contractorName: contractorName.present
        ? contractorName.value
        : this.contractorName,
    dailyWage: dailyWage.present ? dailyWage.value : this.dailyWage,
  );
  MirroredWorker copyWithCompanion(MirroredWorkersCompanion data) {
    return MirroredWorker(
      id: data.id.present ? data.id.value : this.id,
      name: data.name.present ? data.name.value : this.name,
      trade: data.trade.present ? data.trade.value : this.trade,
      skillLevel: data.skillLevel.present
          ? data.skillLevel.value
          : this.skillLevel,
      status: data.status.present ? data.status.value : this.status,
      contractorId: data.contractorId.present
          ? data.contractorId.value
          : this.contractorId,
      contractorName: data.contractorName.present
          ? data.contractorName.value
          : this.contractorName,
      dailyWage: data.dailyWage.present ? data.dailyWage.value : this.dailyWage,
    );
  }

  @override
  String toString() {
    return (StringBuffer('MirroredWorker(')
          ..write('id: $id, ')
          ..write('name: $name, ')
          ..write('trade: $trade, ')
          ..write('skillLevel: $skillLevel, ')
          ..write('status: $status, ')
          ..write('contractorId: $contractorId, ')
          ..write('contractorName: $contractorName, ')
          ..write('dailyWage: $dailyWage')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    name,
    trade,
    skillLevel,
    status,
    contractorId,
    contractorName,
    dailyWage,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is MirroredWorker &&
          other.id == this.id &&
          other.name == this.name &&
          other.trade == this.trade &&
          other.skillLevel == this.skillLevel &&
          other.status == this.status &&
          other.contractorId == this.contractorId &&
          other.contractorName == this.contractorName &&
          other.dailyWage == this.dailyWage);
}

class MirroredWorkersCompanion extends UpdateCompanion<MirroredWorker> {
  final Value<String> id;
  final Value<String> name;
  final Value<String?> trade;
  final Value<String?> skillLevel;
  final Value<String> status;
  final Value<String?> contractorId;
  final Value<String?> contractorName;
  final Value<String?> dailyWage;
  final Value<int> rowid;
  const MirroredWorkersCompanion({
    this.id = const Value.absent(),
    this.name = const Value.absent(),
    this.trade = const Value.absent(),
    this.skillLevel = const Value.absent(),
    this.status = const Value.absent(),
    this.contractorId = const Value.absent(),
    this.contractorName = const Value.absent(),
    this.dailyWage = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  MirroredWorkersCompanion.insert({
    required String id,
    required String name,
    this.trade = const Value.absent(),
    this.skillLevel = const Value.absent(),
    this.status = const Value.absent(),
    this.contractorId = const Value.absent(),
    this.contractorName = const Value.absent(),
    this.dailyWage = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       name = Value(name);
  static Insertable<MirroredWorker> custom({
    Expression<String>? id,
    Expression<String>? name,
    Expression<String>? trade,
    Expression<String>? skillLevel,
    Expression<String>? status,
    Expression<String>? contractorId,
    Expression<String>? contractorName,
    Expression<String>? dailyWage,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (name != null) 'name': name,
      if (trade != null) 'trade': trade,
      if (skillLevel != null) 'skill_level': skillLevel,
      if (status != null) 'status': status,
      if (contractorId != null) 'contractor_id': contractorId,
      if (contractorName != null) 'contractor_name': contractorName,
      if (dailyWage != null) 'daily_wage': dailyWage,
      if (rowid != null) 'rowid': rowid,
    });
  }

  MirroredWorkersCompanion copyWith({
    Value<String>? id,
    Value<String>? name,
    Value<String?>? trade,
    Value<String?>? skillLevel,
    Value<String>? status,
    Value<String?>? contractorId,
    Value<String?>? contractorName,
    Value<String?>? dailyWage,
    Value<int>? rowid,
  }) {
    return MirroredWorkersCompanion(
      id: id ?? this.id,
      name: name ?? this.name,
      trade: trade ?? this.trade,
      skillLevel: skillLevel ?? this.skillLevel,
      status: status ?? this.status,
      contractorId: contractorId ?? this.contractorId,
      contractorName: contractorName ?? this.contractorName,
      dailyWage: dailyWage ?? this.dailyWage,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (trade.present) {
      map['trade'] = Variable<String>(trade.value);
    }
    if (skillLevel.present) {
      map['skill_level'] = Variable<String>(skillLevel.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (contractorId.present) {
      map['contractor_id'] = Variable<String>(contractorId.value);
    }
    if (contractorName.present) {
      map['contractor_name'] = Variable<String>(contractorName.value);
    }
    if (dailyWage.present) {
      map['daily_wage'] = Variable<String>(dailyWage.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('MirroredWorkersCompanion(')
          ..write('id: $id, ')
          ..write('name: $name, ')
          ..write('trade: $trade, ')
          ..write('skillLevel: $skillLevel, ')
          ..write('status: $status, ')
          ..write('contractorId: $contractorId, ')
          ..write('contractorName: $contractorName, ')
          ..write('dailyWage: $dailyWage, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $MirroredWorkerSitesTable extends MirroredWorkerSites
    with TableInfo<$MirroredWorkerSitesTable, MirroredWorkerSite> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $MirroredWorkerSitesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _workerIdMeta = const VerificationMeta(
    'workerId',
  );
  @override
  late final GeneratedColumn<String> workerId = GeneratedColumn<String>(
    'worker_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _projectIdMeta = const VerificationMeta(
    'projectId',
  );
  @override
  late final GeneratedColumn<String> projectId = GeneratedColumn<String>(
    'project_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [workerId, projectId];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'mirrored_worker_sites';
  @override
  VerificationContext validateIntegrity(
    Insertable<MirroredWorkerSite> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('worker_id')) {
      context.handle(
        _workerIdMeta,
        workerId.isAcceptableOrUnknown(data['worker_id']!, _workerIdMeta),
      );
    } else if (isInserting) {
      context.missing(_workerIdMeta);
    }
    if (data.containsKey('project_id')) {
      context.handle(
        _projectIdMeta,
        projectId.isAcceptableOrUnknown(data['project_id']!, _projectIdMeta),
      );
    } else if (isInserting) {
      context.missing(_projectIdMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {workerId, projectId};
  @override
  MirroredWorkerSite map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return MirroredWorkerSite(
      workerId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}worker_id'],
      )!,
      projectId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}project_id'],
      )!,
    );
  }

  @override
  $MirroredWorkerSitesTable createAlias(String alias) {
    return $MirroredWorkerSitesTable(attachedDatabase, alias);
  }
}

class MirroredWorkerSite extends DataClass
    implements Insertable<MirroredWorkerSite> {
  final String workerId;
  final String projectId;
  const MirroredWorkerSite({required this.workerId, required this.projectId});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['worker_id'] = Variable<String>(workerId);
    map['project_id'] = Variable<String>(projectId);
    return map;
  }

  MirroredWorkerSitesCompanion toCompanion(bool nullToAbsent) {
    return MirroredWorkerSitesCompanion(
      workerId: Value(workerId),
      projectId: Value(projectId),
    );
  }

  factory MirroredWorkerSite.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return MirroredWorkerSite(
      workerId: serializer.fromJson<String>(json['workerId']),
      projectId: serializer.fromJson<String>(json['projectId']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'workerId': serializer.toJson<String>(workerId),
      'projectId': serializer.toJson<String>(projectId),
    };
  }

  MirroredWorkerSite copyWith({String? workerId, String? projectId}) =>
      MirroredWorkerSite(
        workerId: workerId ?? this.workerId,
        projectId: projectId ?? this.projectId,
      );
  MirroredWorkerSite copyWithCompanion(MirroredWorkerSitesCompanion data) {
    return MirroredWorkerSite(
      workerId: data.workerId.present ? data.workerId.value : this.workerId,
      projectId: data.projectId.present ? data.projectId.value : this.projectId,
    );
  }

  @override
  String toString() {
    return (StringBuffer('MirroredWorkerSite(')
          ..write('workerId: $workerId, ')
          ..write('projectId: $projectId')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(workerId, projectId);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is MirroredWorkerSite &&
          other.workerId == this.workerId &&
          other.projectId == this.projectId);
}

class MirroredWorkerSitesCompanion extends UpdateCompanion<MirroredWorkerSite> {
  final Value<String> workerId;
  final Value<String> projectId;
  final Value<int> rowid;
  const MirroredWorkerSitesCompanion({
    this.workerId = const Value.absent(),
    this.projectId = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  MirroredWorkerSitesCompanion.insert({
    required String workerId,
    required String projectId,
    this.rowid = const Value.absent(),
  }) : workerId = Value(workerId),
       projectId = Value(projectId);
  static Insertable<MirroredWorkerSite> custom({
    Expression<String>? workerId,
    Expression<String>? projectId,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (workerId != null) 'worker_id': workerId,
      if (projectId != null) 'project_id': projectId,
      if (rowid != null) 'rowid': rowid,
    });
  }

  MirroredWorkerSitesCompanion copyWith({
    Value<String>? workerId,
    Value<String>? projectId,
    Value<int>? rowid,
  }) {
    return MirroredWorkerSitesCompanion(
      workerId: workerId ?? this.workerId,
      projectId: projectId ?? this.projectId,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (workerId.present) {
      map['worker_id'] = Variable<String>(workerId.value);
    }
    if (projectId.present) {
      map['project_id'] = Variable<String>(projectId.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('MirroredWorkerSitesCompanion(')
          ..write('workerId: $workerId, ')
          ..write('projectId: $projectId, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $MirroredAttendanceTable extends MirroredAttendance
    with TableInfo<$MirroredAttendanceTable, MirroredAttendanceRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $MirroredAttendanceTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _projectIdMeta = const VerificationMeta(
    'projectId',
  );
  @override
  late final GeneratedColumn<String> projectId = GeneratedColumn<String>(
    'project_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _dateMeta = const VerificationMeta('date');
  @override
  late final GeneratedColumn<String> date = GeneratedColumn<String>(
    'date',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _workerIdMeta = const VerificationMeta(
    'workerId',
  );
  @override
  late final GeneratedColumn<String> workerId = GeneratedColumn<String>(
    'worker_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
    'status',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _overtimeHoursMeta = const VerificationMeta(
    'overtimeHours',
  );
  @override
  late final GeneratedColumn<String> overtimeHours = GeneratedColumn<String>(
    'overtime_hours',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('0'),
  );
  static const VerificationMeta _pendingMeta = const VerificationMeta(
    'pending',
  );
  @override
  late final GeneratedColumn<bool> pending = GeneratedColumn<bool>(
    'pending',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("pending" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  @override
  List<GeneratedColumn> get $columns => [
    projectId,
    date,
    workerId,
    status,
    overtimeHours,
    pending,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'mirrored_attendance';
  @override
  VerificationContext validateIntegrity(
    Insertable<MirroredAttendanceRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('project_id')) {
      context.handle(
        _projectIdMeta,
        projectId.isAcceptableOrUnknown(data['project_id']!, _projectIdMeta),
      );
    } else if (isInserting) {
      context.missing(_projectIdMeta);
    }
    if (data.containsKey('date')) {
      context.handle(
        _dateMeta,
        date.isAcceptableOrUnknown(data['date']!, _dateMeta),
      );
    } else if (isInserting) {
      context.missing(_dateMeta);
    }
    if (data.containsKey('worker_id')) {
      context.handle(
        _workerIdMeta,
        workerId.isAcceptableOrUnknown(data['worker_id']!, _workerIdMeta),
      );
    } else if (isInserting) {
      context.missing(_workerIdMeta);
    }
    if (data.containsKey('status')) {
      context.handle(
        _statusMeta,
        status.isAcceptableOrUnknown(data['status']!, _statusMeta),
      );
    } else if (isInserting) {
      context.missing(_statusMeta);
    }
    if (data.containsKey('overtime_hours')) {
      context.handle(
        _overtimeHoursMeta,
        overtimeHours.isAcceptableOrUnknown(
          data['overtime_hours']!,
          _overtimeHoursMeta,
        ),
      );
    }
    if (data.containsKey('pending')) {
      context.handle(
        _pendingMeta,
        pending.isAcceptableOrUnknown(data['pending']!, _pendingMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {projectId, date, workerId};
  @override
  MirroredAttendanceRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return MirroredAttendanceRow(
      projectId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}project_id'],
      )!,
      date: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}date'],
      )!,
      workerId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}worker_id'],
      )!,
      status: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}status'],
      )!,
      overtimeHours: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}overtime_hours'],
      )!,
      pending: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}pending'],
      )!,
    );
  }

  @override
  $MirroredAttendanceTable createAlias(String alias) {
    return $MirroredAttendanceTable(attachedDatabase, alias);
  }
}

class MirroredAttendanceRow extends DataClass
    implements Insertable<MirroredAttendanceRow> {
  final String projectId;
  final String date;
  final String workerId;
  final String status;
  final String overtimeHours;
  final bool pending;
  const MirroredAttendanceRow({
    required this.projectId,
    required this.date,
    required this.workerId,
    required this.status,
    required this.overtimeHours,
    required this.pending,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['project_id'] = Variable<String>(projectId);
    map['date'] = Variable<String>(date);
    map['worker_id'] = Variable<String>(workerId);
    map['status'] = Variable<String>(status);
    map['overtime_hours'] = Variable<String>(overtimeHours);
    map['pending'] = Variable<bool>(pending);
    return map;
  }

  MirroredAttendanceCompanion toCompanion(bool nullToAbsent) {
    return MirroredAttendanceCompanion(
      projectId: Value(projectId),
      date: Value(date),
      workerId: Value(workerId),
      status: Value(status),
      overtimeHours: Value(overtimeHours),
      pending: Value(pending),
    );
  }

  factory MirroredAttendanceRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return MirroredAttendanceRow(
      projectId: serializer.fromJson<String>(json['projectId']),
      date: serializer.fromJson<String>(json['date']),
      workerId: serializer.fromJson<String>(json['workerId']),
      status: serializer.fromJson<String>(json['status']),
      overtimeHours: serializer.fromJson<String>(json['overtimeHours']),
      pending: serializer.fromJson<bool>(json['pending']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'projectId': serializer.toJson<String>(projectId),
      'date': serializer.toJson<String>(date),
      'workerId': serializer.toJson<String>(workerId),
      'status': serializer.toJson<String>(status),
      'overtimeHours': serializer.toJson<String>(overtimeHours),
      'pending': serializer.toJson<bool>(pending),
    };
  }

  MirroredAttendanceRow copyWith({
    String? projectId,
    String? date,
    String? workerId,
    String? status,
    String? overtimeHours,
    bool? pending,
  }) => MirroredAttendanceRow(
    projectId: projectId ?? this.projectId,
    date: date ?? this.date,
    workerId: workerId ?? this.workerId,
    status: status ?? this.status,
    overtimeHours: overtimeHours ?? this.overtimeHours,
    pending: pending ?? this.pending,
  );
  MirroredAttendanceRow copyWithCompanion(MirroredAttendanceCompanion data) {
    return MirroredAttendanceRow(
      projectId: data.projectId.present ? data.projectId.value : this.projectId,
      date: data.date.present ? data.date.value : this.date,
      workerId: data.workerId.present ? data.workerId.value : this.workerId,
      status: data.status.present ? data.status.value : this.status,
      overtimeHours: data.overtimeHours.present
          ? data.overtimeHours.value
          : this.overtimeHours,
      pending: data.pending.present ? data.pending.value : this.pending,
    );
  }

  @override
  String toString() {
    return (StringBuffer('MirroredAttendanceRow(')
          ..write('projectId: $projectId, ')
          ..write('date: $date, ')
          ..write('workerId: $workerId, ')
          ..write('status: $status, ')
          ..write('overtimeHours: $overtimeHours, ')
          ..write('pending: $pending')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(projectId, date, workerId, status, overtimeHours, pending);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is MirroredAttendanceRow &&
          other.projectId == this.projectId &&
          other.date == this.date &&
          other.workerId == this.workerId &&
          other.status == this.status &&
          other.overtimeHours == this.overtimeHours &&
          other.pending == this.pending);
}

class MirroredAttendanceCompanion
    extends UpdateCompanion<MirroredAttendanceRow> {
  final Value<String> projectId;
  final Value<String> date;
  final Value<String> workerId;
  final Value<String> status;
  final Value<String> overtimeHours;
  final Value<bool> pending;
  final Value<int> rowid;
  const MirroredAttendanceCompanion({
    this.projectId = const Value.absent(),
    this.date = const Value.absent(),
    this.workerId = const Value.absent(),
    this.status = const Value.absent(),
    this.overtimeHours = const Value.absent(),
    this.pending = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  MirroredAttendanceCompanion.insert({
    required String projectId,
    required String date,
    required String workerId,
    required String status,
    this.overtimeHours = const Value.absent(),
    this.pending = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : projectId = Value(projectId),
       date = Value(date),
       workerId = Value(workerId),
       status = Value(status);
  static Insertable<MirroredAttendanceRow> custom({
    Expression<String>? projectId,
    Expression<String>? date,
    Expression<String>? workerId,
    Expression<String>? status,
    Expression<String>? overtimeHours,
    Expression<bool>? pending,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (projectId != null) 'project_id': projectId,
      if (date != null) 'date': date,
      if (workerId != null) 'worker_id': workerId,
      if (status != null) 'status': status,
      if (overtimeHours != null) 'overtime_hours': overtimeHours,
      if (pending != null) 'pending': pending,
      if (rowid != null) 'rowid': rowid,
    });
  }

  MirroredAttendanceCompanion copyWith({
    Value<String>? projectId,
    Value<String>? date,
    Value<String>? workerId,
    Value<String>? status,
    Value<String>? overtimeHours,
    Value<bool>? pending,
    Value<int>? rowid,
  }) {
    return MirroredAttendanceCompanion(
      projectId: projectId ?? this.projectId,
      date: date ?? this.date,
      workerId: workerId ?? this.workerId,
      status: status ?? this.status,
      overtimeHours: overtimeHours ?? this.overtimeHours,
      pending: pending ?? this.pending,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (projectId.present) {
      map['project_id'] = Variable<String>(projectId.value);
    }
    if (date.present) {
      map['date'] = Variable<String>(date.value);
    }
    if (workerId.present) {
      map['worker_id'] = Variable<String>(workerId.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (overtimeHours.present) {
      map['overtime_hours'] = Variable<String>(overtimeHours.value);
    }
    if (pending.present) {
      map['pending'] = Variable<bool>(pending.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('MirroredAttendanceCompanion(')
          ..write('projectId: $projectId, ')
          ..write('date: $date, ')
          ..write('workerId: $workerId, ')
          ..write('status: $status, ')
          ..write('overtimeHours: $overtimeHours, ')
          ..write('pending: $pending, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $OutboxTable extends Outbox with TableInfo<$OutboxTable, OutboxEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $OutboxTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    hasAutoIncrement: true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'PRIMARY KEY AUTOINCREMENT',
    ),
  );
  static const VerificationMeta _kindMeta = const VerificationMeta('kind');
  @override
  late final GeneratedColumn<String> kind = GeneratedColumn<String>(
    'kind',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _clientIdMeta = const VerificationMeta(
    'clientId',
  );
  @override
  late final GeneratedColumn<String> clientId = GeneratedColumn<String>(
    'client_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _payloadMeta = const VerificationMeta(
    'payload',
  );
  @override
  late final GeneratedColumn<String> payload = GeneratedColumn<String>(
    'payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _labelMeta = const VerificationMeta('label');
  @override
  late final GeneratedColumn<String> label = GeneratedColumn<String>(
    'label',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
    defaultValue: currentDateAndTime,
  );
  static const VerificationMeta _attemptsMeta = const VerificationMeta(
    'attempts',
  );
  @override
  late final GeneratedColumn<int> attempts = GeneratedColumn<int>(
    'attempts',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _lastErrorMeta = const VerificationMeta(
    'lastError',
  );
  @override
  late final GeneratedColumn<String> lastError = GeneratedColumn<String>(
    'last_error',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _blockedMeta = const VerificationMeta(
    'blocked',
  );
  @override
  late final GeneratedColumn<bool> blocked = GeneratedColumn<bool>(
    'blocked',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("blocked" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    kind,
    clientId,
    payload,
    label,
    createdAt,
    attempts,
    lastError,
    blocked,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'outbox';
  @override
  VerificationContext validateIntegrity(
    Insertable<OutboxEntry> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('kind')) {
      context.handle(
        _kindMeta,
        kind.isAcceptableOrUnknown(data['kind']!, _kindMeta),
      );
    } else if (isInserting) {
      context.missing(_kindMeta);
    }
    if (data.containsKey('client_id')) {
      context.handle(
        _clientIdMeta,
        clientId.isAcceptableOrUnknown(data['client_id']!, _clientIdMeta),
      );
    } else if (isInserting) {
      context.missing(_clientIdMeta);
    }
    if (data.containsKey('payload')) {
      context.handle(
        _payloadMeta,
        payload.isAcceptableOrUnknown(data['payload']!, _payloadMeta),
      );
    } else if (isInserting) {
      context.missing(_payloadMeta);
    }
    if (data.containsKey('label')) {
      context.handle(
        _labelMeta,
        label.isAcceptableOrUnknown(data['label']!, _labelMeta),
      );
    } else if (isInserting) {
      context.missing(_labelMeta);
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    }
    if (data.containsKey('attempts')) {
      context.handle(
        _attemptsMeta,
        attempts.isAcceptableOrUnknown(data['attempts']!, _attemptsMeta),
      );
    }
    if (data.containsKey('last_error')) {
      context.handle(
        _lastErrorMeta,
        lastError.isAcceptableOrUnknown(data['last_error']!, _lastErrorMeta),
      );
    }
    if (data.containsKey('blocked')) {
      context.handle(
        _blockedMeta,
        blocked.isAcceptableOrUnknown(data['blocked']!, _blockedMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  OutboxEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return OutboxEntry(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      kind: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}kind'],
      )!,
      clientId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}client_id'],
      )!,
      payload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}payload'],
      )!,
      label: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}label'],
      )!,
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
      attempts: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}attempts'],
      )!,
      lastError: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_error'],
      ),
      blocked: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}blocked'],
      )!,
    );
  }

  @override
  $OutboxTable createAlias(String alias) {
    return $OutboxTable(attachedDatabase, alias);
  }
}

class OutboxEntry extends DataClass implements Insertable<OutboxEntry> {
  final int id;

  /// What kind of thing this is: `attendance`, `dpr`.
  final String kind;

  /// The idempotency key the API deduplicates on.
  final String clientId;

  /// The request body, as JSON.
  final String payload;

  /// Something a person would recognise in a queue: "Roll call, Lakeview Tower, 10 Sep".
  final String label;
  final DateTime createdAt;
  final int attempts;

  /// Why the last attempt failed, kept so the queue can explain itself rather than just sitting there.
  final String? lastError;

  /// Set when the server refused it in a way retrying cannot fix — a validation error, a permission
  /// it does not have. Those need a person, so they stop being retried and start being shown.
  final bool blocked;
  const OutboxEntry({
    required this.id,
    required this.kind,
    required this.clientId,
    required this.payload,
    required this.label,
    required this.createdAt,
    required this.attempts,
    this.lastError,
    required this.blocked,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['kind'] = Variable<String>(kind);
    map['client_id'] = Variable<String>(clientId);
    map['payload'] = Variable<String>(payload);
    map['label'] = Variable<String>(label);
    map['created_at'] = Variable<DateTime>(createdAt);
    map['attempts'] = Variable<int>(attempts);
    if (!nullToAbsent || lastError != null) {
      map['last_error'] = Variable<String>(lastError);
    }
    map['blocked'] = Variable<bool>(blocked);
    return map;
  }

  OutboxCompanion toCompanion(bool nullToAbsent) {
    return OutboxCompanion(
      id: Value(id),
      kind: Value(kind),
      clientId: Value(clientId),
      payload: Value(payload),
      label: Value(label),
      createdAt: Value(createdAt),
      attempts: Value(attempts),
      lastError: lastError == null && nullToAbsent
          ? const Value.absent()
          : Value(lastError),
      blocked: Value(blocked),
    );
  }

  factory OutboxEntry.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return OutboxEntry(
      id: serializer.fromJson<int>(json['id']),
      kind: serializer.fromJson<String>(json['kind']),
      clientId: serializer.fromJson<String>(json['clientId']),
      payload: serializer.fromJson<String>(json['payload']),
      label: serializer.fromJson<String>(json['label']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      attempts: serializer.fromJson<int>(json['attempts']),
      lastError: serializer.fromJson<String?>(json['lastError']),
      blocked: serializer.fromJson<bool>(json['blocked']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'kind': serializer.toJson<String>(kind),
      'clientId': serializer.toJson<String>(clientId),
      'payload': serializer.toJson<String>(payload),
      'label': serializer.toJson<String>(label),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'attempts': serializer.toJson<int>(attempts),
      'lastError': serializer.toJson<String?>(lastError),
      'blocked': serializer.toJson<bool>(blocked),
    };
  }

  OutboxEntry copyWith({
    int? id,
    String? kind,
    String? clientId,
    String? payload,
    String? label,
    DateTime? createdAt,
    int? attempts,
    Value<String?> lastError = const Value.absent(),
    bool? blocked,
  }) => OutboxEntry(
    id: id ?? this.id,
    kind: kind ?? this.kind,
    clientId: clientId ?? this.clientId,
    payload: payload ?? this.payload,
    label: label ?? this.label,
    createdAt: createdAt ?? this.createdAt,
    attempts: attempts ?? this.attempts,
    lastError: lastError.present ? lastError.value : this.lastError,
    blocked: blocked ?? this.blocked,
  );
  OutboxEntry copyWithCompanion(OutboxCompanion data) {
    return OutboxEntry(
      id: data.id.present ? data.id.value : this.id,
      kind: data.kind.present ? data.kind.value : this.kind,
      clientId: data.clientId.present ? data.clientId.value : this.clientId,
      payload: data.payload.present ? data.payload.value : this.payload,
      label: data.label.present ? data.label.value : this.label,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      attempts: data.attempts.present ? data.attempts.value : this.attempts,
      lastError: data.lastError.present ? data.lastError.value : this.lastError,
      blocked: data.blocked.present ? data.blocked.value : this.blocked,
    );
  }

  @override
  String toString() {
    return (StringBuffer('OutboxEntry(')
          ..write('id: $id, ')
          ..write('kind: $kind, ')
          ..write('clientId: $clientId, ')
          ..write('payload: $payload, ')
          ..write('label: $label, ')
          ..write('createdAt: $createdAt, ')
          ..write('attempts: $attempts, ')
          ..write('lastError: $lastError, ')
          ..write('blocked: $blocked')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    kind,
    clientId,
    payload,
    label,
    createdAt,
    attempts,
    lastError,
    blocked,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is OutboxEntry &&
          other.id == this.id &&
          other.kind == this.kind &&
          other.clientId == this.clientId &&
          other.payload == this.payload &&
          other.label == this.label &&
          other.createdAt == this.createdAt &&
          other.attempts == this.attempts &&
          other.lastError == this.lastError &&
          other.blocked == this.blocked);
}

class OutboxCompanion extends UpdateCompanion<OutboxEntry> {
  final Value<int> id;
  final Value<String> kind;
  final Value<String> clientId;
  final Value<String> payload;
  final Value<String> label;
  final Value<DateTime> createdAt;
  final Value<int> attempts;
  final Value<String?> lastError;
  final Value<bool> blocked;
  const OutboxCompanion({
    this.id = const Value.absent(),
    this.kind = const Value.absent(),
    this.clientId = const Value.absent(),
    this.payload = const Value.absent(),
    this.label = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.attempts = const Value.absent(),
    this.lastError = const Value.absent(),
    this.blocked = const Value.absent(),
  });
  OutboxCompanion.insert({
    this.id = const Value.absent(),
    required String kind,
    required String clientId,
    required String payload,
    required String label,
    this.createdAt = const Value.absent(),
    this.attempts = const Value.absent(),
    this.lastError = const Value.absent(),
    this.blocked = const Value.absent(),
  }) : kind = Value(kind),
       clientId = Value(clientId),
       payload = Value(payload),
       label = Value(label);
  static Insertable<OutboxEntry> custom({
    Expression<int>? id,
    Expression<String>? kind,
    Expression<String>? clientId,
    Expression<String>? payload,
    Expression<String>? label,
    Expression<DateTime>? createdAt,
    Expression<int>? attempts,
    Expression<String>? lastError,
    Expression<bool>? blocked,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (kind != null) 'kind': kind,
      if (clientId != null) 'client_id': clientId,
      if (payload != null) 'payload': payload,
      if (label != null) 'label': label,
      if (createdAt != null) 'created_at': createdAt,
      if (attempts != null) 'attempts': attempts,
      if (lastError != null) 'last_error': lastError,
      if (blocked != null) 'blocked': blocked,
    });
  }

  OutboxCompanion copyWith({
    Value<int>? id,
    Value<String>? kind,
    Value<String>? clientId,
    Value<String>? payload,
    Value<String>? label,
    Value<DateTime>? createdAt,
    Value<int>? attempts,
    Value<String?>? lastError,
    Value<bool>? blocked,
  }) {
    return OutboxCompanion(
      id: id ?? this.id,
      kind: kind ?? this.kind,
      clientId: clientId ?? this.clientId,
      payload: payload ?? this.payload,
      label: label ?? this.label,
      createdAt: createdAt ?? this.createdAt,
      attempts: attempts ?? this.attempts,
      lastError: lastError ?? this.lastError,
      blocked: blocked ?? this.blocked,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (kind.present) {
      map['kind'] = Variable<String>(kind.value);
    }
    if (clientId.present) {
      map['client_id'] = Variable<String>(clientId.value);
    }
    if (payload.present) {
      map['payload'] = Variable<String>(payload.value);
    }
    if (label.present) {
      map['label'] = Variable<String>(label.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (attempts.present) {
      map['attempts'] = Variable<int>(attempts.value);
    }
    if (lastError.present) {
      map['last_error'] = Variable<String>(lastError.value);
    }
    if (blocked.present) {
      map['blocked'] = Variable<bool>(blocked.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('OutboxCompanion(')
          ..write('id: $id, ')
          ..write('kind: $kind, ')
          ..write('clientId: $clientId, ')
          ..write('payload: $payload, ')
          ..write('label: $label, ')
          ..write('createdAt: $createdAt, ')
          ..write('attempts: $attempts, ')
          ..write('lastError: $lastError, ')
          ..write('blocked: $blocked')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $MirroredProjectsTable mirroredProjects = $MirroredProjectsTable(
    this,
  );
  late final $MirroredWorkersTable mirroredWorkers = $MirroredWorkersTable(
    this,
  );
  late final $MirroredWorkerSitesTable mirroredWorkerSites =
      $MirroredWorkerSitesTable(this);
  late final $MirroredAttendanceTable mirroredAttendance =
      $MirroredAttendanceTable(this);
  late final $OutboxTable outbox = $OutboxTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    mirroredProjects,
    mirroredWorkers,
    mirroredWorkerSites,
    mirroredAttendance,
    outbox,
  ];
}

typedef $$MirroredProjectsTableCreateCompanionBuilder =
    MirroredProjectsCompanion Function({
      required String id,
      required String name,
      Value<String?> clientName,
      Value<String?> address,
      Value<String> status,
      Value<String?> startDate,
      Value<String?> targetEndDate,
      Value<String?> budgetAmount,
      Value<double?> lat,
      Value<double?> lng,
      Value<int> rowid,
    });
typedef $$MirroredProjectsTableUpdateCompanionBuilder =
    MirroredProjectsCompanion Function({
      Value<String> id,
      Value<String> name,
      Value<String?> clientName,
      Value<String?> address,
      Value<String> status,
      Value<String?> startDate,
      Value<String?> targetEndDate,
      Value<String?> budgetAmount,
      Value<double?> lat,
      Value<double?> lng,
      Value<int> rowid,
    });

class $$MirroredProjectsTableFilterComposer
    extends Composer<_$AppDatabase, $MirroredProjectsTable> {
  $$MirroredProjectsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get clientName => $composableBuilder(
    column: $table.clientName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get address => $composableBuilder(
    column: $table.address,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get startDate => $composableBuilder(
    column: $table.startDate,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get targetEndDate => $composableBuilder(
    column: $table.targetEndDate,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get budgetAmount => $composableBuilder(
    column: $table.budgetAmount,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get lat => $composableBuilder(
    column: $table.lat,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get lng => $composableBuilder(
    column: $table.lng,
    builder: (column) => ColumnFilters(column),
  );
}

class $$MirroredProjectsTableOrderingComposer
    extends Composer<_$AppDatabase, $MirroredProjectsTable> {
  $$MirroredProjectsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get clientName => $composableBuilder(
    column: $table.clientName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get address => $composableBuilder(
    column: $table.address,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get startDate => $composableBuilder(
    column: $table.startDate,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get targetEndDate => $composableBuilder(
    column: $table.targetEndDate,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get budgetAmount => $composableBuilder(
    column: $table.budgetAmount,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get lat => $composableBuilder(
    column: $table.lat,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get lng => $composableBuilder(
    column: $table.lng,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$MirroredProjectsTableAnnotationComposer
    extends Composer<_$AppDatabase, $MirroredProjectsTable> {
  $$MirroredProjectsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

  GeneratedColumn<String> get clientName => $composableBuilder(
    column: $table.clientName,
    builder: (column) => column,
  );

  GeneratedColumn<String> get address =>
      $composableBuilder(column: $table.address, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<String> get startDate =>
      $composableBuilder(column: $table.startDate, builder: (column) => column);

  GeneratedColumn<String> get targetEndDate => $composableBuilder(
    column: $table.targetEndDate,
    builder: (column) => column,
  );

  GeneratedColumn<String> get budgetAmount => $composableBuilder(
    column: $table.budgetAmount,
    builder: (column) => column,
  );

  GeneratedColumn<double> get lat =>
      $composableBuilder(column: $table.lat, builder: (column) => column);

  GeneratedColumn<double> get lng =>
      $composableBuilder(column: $table.lng, builder: (column) => column);
}

class $$MirroredProjectsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $MirroredProjectsTable,
          MirroredProject,
          $$MirroredProjectsTableFilterComposer,
          $$MirroredProjectsTableOrderingComposer,
          $$MirroredProjectsTableAnnotationComposer,
          $$MirroredProjectsTableCreateCompanionBuilder,
          $$MirroredProjectsTableUpdateCompanionBuilder,
          (
            MirroredProject,
            BaseReferences<
              _$AppDatabase,
              $MirroredProjectsTable,
              MirroredProject
            >,
          ),
          MirroredProject,
          PrefetchHooks Function()
        > {
  $$MirroredProjectsTableTableManager(
    _$AppDatabase db,
    $MirroredProjectsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$MirroredProjectsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$MirroredProjectsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$MirroredProjectsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> name = const Value.absent(),
                Value<String?> clientName = const Value.absent(),
                Value<String?> address = const Value.absent(),
                Value<String> status = const Value.absent(),
                Value<String?> startDate = const Value.absent(),
                Value<String?> targetEndDate = const Value.absent(),
                Value<String?> budgetAmount = const Value.absent(),
                Value<double?> lat = const Value.absent(),
                Value<double?> lng = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => MirroredProjectsCompanion(
                id: id,
                name: name,
                clientName: clientName,
                address: address,
                status: status,
                startDate: startDate,
                targetEndDate: targetEndDate,
                budgetAmount: budgetAmount,
                lat: lat,
                lng: lng,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String name,
                Value<String?> clientName = const Value.absent(),
                Value<String?> address = const Value.absent(),
                Value<String> status = const Value.absent(),
                Value<String?> startDate = const Value.absent(),
                Value<String?> targetEndDate = const Value.absent(),
                Value<String?> budgetAmount = const Value.absent(),
                Value<double?> lat = const Value.absent(),
                Value<double?> lng = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => MirroredProjectsCompanion.insert(
                id: id,
                name: name,
                clientName: clientName,
                address: address,
                status: status,
                startDate: startDate,
                targetEndDate: targetEndDate,
                budgetAmount: budgetAmount,
                lat: lat,
                lng: lng,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$MirroredProjectsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $MirroredProjectsTable,
      MirroredProject,
      $$MirroredProjectsTableFilterComposer,
      $$MirroredProjectsTableOrderingComposer,
      $$MirroredProjectsTableAnnotationComposer,
      $$MirroredProjectsTableCreateCompanionBuilder,
      $$MirroredProjectsTableUpdateCompanionBuilder,
      (
        MirroredProject,
        BaseReferences<_$AppDatabase, $MirroredProjectsTable, MirroredProject>,
      ),
      MirroredProject,
      PrefetchHooks Function()
    >;
typedef $$MirroredWorkersTableCreateCompanionBuilder =
    MirroredWorkersCompanion Function({
      required String id,
      required String name,
      Value<String?> trade,
      Value<String?> skillLevel,
      Value<String> status,
      Value<String?> contractorId,
      Value<String?> contractorName,
      Value<String?> dailyWage,
      Value<int> rowid,
    });
typedef $$MirroredWorkersTableUpdateCompanionBuilder =
    MirroredWorkersCompanion Function({
      Value<String> id,
      Value<String> name,
      Value<String?> trade,
      Value<String?> skillLevel,
      Value<String> status,
      Value<String?> contractorId,
      Value<String?> contractorName,
      Value<String?> dailyWage,
      Value<int> rowid,
    });

class $$MirroredWorkersTableFilterComposer
    extends Composer<_$AppDatabase, $MirroredWorkersTable> {
  $$MirroredWorkersTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get trade => $composableBuilder(
    column: $table.trade,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get skillLevel => $composableBuilder(
    column: $table.skillLevel,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get contractorId => $composableBuilder(
    column: $table.contractorId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get contractorName => $composableBuilder(
    column: $table.contractorName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get dailyWage => $composableBuilder(
    column: $table.dailyWage,
    builder: (column) => ColumnFilters(column),
  );
}

class $$MirroredWorkersTableOrderingComposer
    extends Composer<_$AppDatabase, $MirroredWorkersTable> {
  $$MirroredWorkersTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get trade => $composableBuilder(
    column: $table.trade,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get skillLevel => $composableBuilder(
    column: $table.skillLevel,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get contractorId => $composableBuilder(
    column: $table.contractorId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get contractorName => $composableBuilder(
    column: $table.contractorName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get dailyWage => $composableBuilder(
    column: $table.dailyWage,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$MirroredWorkersTableAnnotationComposer
    extends Composer<_$AppDatabase, $MirroredWorkersTable> {
  $$MirroredWorkersTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

  GeneratedColumn<String> get trade =>
      $composableBuilder(column: $table.trade, builder: (column) => column);

  GeneratedColumn<String> get skillLevel => $composableBuilder(
    column: $table.skillLevel,
    builder: (column) => column,
  );

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<String> get contractorId => $composableBuilder(
    column: $table.contractorId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get contractorName => $composableBuilder(
    column: $table.contractorName,
    builder: (column) => column,
  );

  GeneratedColumn<String> get dailyWage =>
      $composableBuilder(column: $table.dailyWage, builder: (column) => column);
}

class $$MirroredWorkersTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $MirroredWorkersTable,
          MirroredWorker,
          $$MirroredWorkersTableFilterComposer,
          $$MirroredWorkersTableOrderingComposer,
          $$MirroredWorkersTableAnnotationComposer,
          $$MirroredWorkersTableCreateCompanionBuilder,
          $$MirroredWorkersTableUpdateCompanionBuilder,
          (
            MirroredWorker,
            BaseReferences<
              _$AppDatabase,
              $MirroredWorkersTable,
              MirroredWorker
            >,
          ),
          MirroredWorker,
          PrefetchHooks Function()
        > {
  $$MirroredWorkersTableTableManager(
    _$AppDatabase db,
    $MirroredWorkersTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$MirroredWorkersTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$MirroredWorkersTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$MirroredWorkersTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> name = const Value.absent(),
                Value<String?> trade = const Value.absent(),
                Value<String?> skillLevel = const Value.absent(),
                Value<String> status = const Value.absent(),
                Value<String?> contractorId = const Value.absent(),
                Value<String?> contractorName = const Value.absent(),
                Value<String?> dailyWage = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => MirroredWorkersCompanion(
                id: id,
                name: name,
                trade: trade,
                skillLevel: skillLevel,
                status: status,
                contractorId: contractorId,
                contractorName: contractorName,
                dailyWage: dailyWage,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String name,
                Value<String?> trade = const Value.absent(),
                Value<String?> skillLevel = const Value.absent(),
                Value<String> status = const Value.absent(),
                Value<String?> contractorId = const Value.absent(),
                Value<String?> contractorName = const Value.absent(),
                Value<String?> dailyWage = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => MirroredWorkersCompanion.insert(
                id: id,
                name: name,
                trade: trade,
                skillLevel: skillLevel,
                status: status,
                contractorId: contractorId,
                contractorName: contractorName,
                dailyWage: dailyWage,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$MirroredWorkersTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $MirroredWorkersTable,
      MirroredWorker,
      $$MirroredWorkersTableFilterComposer,
      $$MirroredWorkersTableOrderingComposer,
      $$MirroredWorkersTableAnnotationComposer,
      $$MirroredWorkersTableCreateCompanionBuilder,
      $$MirroredWorkersTableUpdateCompanionBuilder,
      (
        MirroredWorker,
        BaseReferences<_$AppDatabase, $MirroredWorkersTable, MirroredWorker>,
      ),
      MirroredWorker,
      PrefetchHooks Function()
    >;
typedef $$MirroredWorkerSitesTableCreateCompanionBuilder =
    MirroredWorkerSitesCompanion Function({
      required String workerId,
      required String projectId,
      Value<int> rowid,
    });
typedef $$MirroredWorkerSitesTableUpdateCompanionBuilder =
    MirroredWorkerSitesCompanion Function({
      Value<String> workerId,
      Value<String> projectId,
      Value<int> rowid,
    });

class $$MirroredWorkerSitesTableFilterComposer
    extends Composer<_$AppDatabase, $MirroredWorkerSitesTable> {
  $$MirroredWorkerSitesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get workerId => $composableBuilder(
    column: $table.workerId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnFilters(column),
  );
}

class $$MirroredWorkerSitesTableOrderingComposer
    extends Composer<_$AppDatabase, $MirroredWorkerSitesTable> {
  $$MirroredWorkerSitesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get workerId => $composableBuilder(
    column: $table.workerId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$MirroredWorkerSitesTableAnnotationComposer
    extends Composer<_$AppDatabase, $MirroredWorkerSitesTable> {
  $$MirroredWorkerSitesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get workerId =>
      $composableBuilder(column: $table.workerId, builder: (column) => column);

  GeneratedColumn<String> get projectId =>
      $composableBuilder(column: $table.projectId, builder: (column) => column);
}

class $$MirroredWorkerSitesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $MirroredWorkerSitesTable,
          MirroredWorkerSite,
          $$MirroredWorkerSitesTableFilterComposer,
          $$MirroredWorkerSitesTableOrderingComposer,
          $$MirroredWorkerSitesTableAnnotationComposer,
          $$MirroredWorkerSitesTableCreateCompanionBuilder,
          $$MirroredWorkerSitesTableUpdateCompanionBuilder,
          (
            MirroredWorkerSite,
            BaseReferences<
              _$AppDatabase,
              $MirroredWorkerSitesTable,
              MirroredWorkerSite
            >,
          ),
          MirroredWorkerSite,
          PrefetchHooks Function()
        > {
  $$MirroredWorkerSitesTableTableManager(
    _$AppDatabase db,
    $MirroredWorkerSitesTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$MirroredWorkerSitesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$MirroredWorkerSitesTableOrderingComposer(
                $db: db,
                $table: table,
              ),
          createComputedFieldComposer: () =>
              $$MirroredWorkerSitesTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> workerId = const Value.absent(),
                Value<String> projectId = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => MirroredWorkerSitesCompanion(
                workerId: workerId,
                projectId: projectId,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String workerId,
                required String projectId,
                Value<int> rowid = const Value.absent(),
              }) => MirroredWorkerSitesCompanion.insert(
                workerId: workerId,
                projectId: projectId,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$MirroredWorkerSitesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $MirroredWorkerSitesTable,
      MirroredWorkerSite,
      $$MirroredWorkerSitesTableFilterComposer,
      $$MirroredWorkerSitesTableOrderingComposer,
      $$MirroredWorkerSitesTableAnnotationComposer,
      $$MirroredWorkerSitesTableCreateCompanionBuilder,
      $$MirroredWorkerSitesTableUpdateCompanionBuilder,
      (
        MirroredWorkerSite,
        BaseReferences<
          _$AppDatabase,
          $MirroredWorkerSitesTable,
          MirroredWorkerSite
        >,
      ),
      MirroredWorkerSite,
      PrefetchHooks Function()
    >;
typedef $$MirroredAttendanceTableCreateCompanionBuilder =
    MirroredAttendanceCompanion Function({
      required String projectId,
      required String date,
      required String workerId,
      required String status,
      Value<String> overtimeHours,
      Value<bool> pending,
      Value<int> rowid,
    });
typedef $$MirroredAttendanceTableUpdateCompanionBuilder =
    MirroredAttendanceCompanion Function({
      Value<String> projectId,
      Value<String> date,
      Value<String> workerId,
      Value<String> status,
      Value<String> overtimeHours,
      Value<bool> pending,
      Value<int> rowid,
    });

class $$MirroredAttendanceTableFilterComposer
    extends Composer<_$AppDatabase, $MirroredAttendanceTable> {
  $$MirroredAttendanceTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get date => $composableBuilder(
    column: $table.date,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get workerId => $composableBuilder(
    column: $table.workerId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get overtimeHours => $composableBuilder(
    column: $table.overtimeHours,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get pending => $composableBuilder(
    column: $table.pending,
    builder: (column) => ColumnFilters(column),
  );
}

class $$MirroredAttendanceTableOrderingComposer
    extends Composer<_$AppDatabase, $MirroredAttendanceTable> {
  $$MirroredAttendanceTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get date => $composableBuilder(
    column: $table.date,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get workerId => $composableBuilder(
    column: $table.workerId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get overtimeHours => $composableBuilder(
    column: $table.overtimeHours,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get pending => $composableBuilder(
    column: $table.pending,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$MirroredAttendanceTableAnnotationComposer
    extends Composer<_$AppDatabase, $MirroredAttendanceTable> {
  $$MirroredAttendanceTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get projectId =>
      $composableBuilder(column: $table.projectId, builder: (column) => column);

  GeneratedColumn<String> get date =>
      $composableBuilder(column: $table.date, builder: (column) => column);

  GeneratedColumn<String> get workerId =>
      $composableBuilder(column: $table.workerId, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<String> get overtimeHours => $composableBuilder(
    column: $table.overtimeHours,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get pending =>
      $composableBuilder(column: $table.pending, builder: (column) => column);
}

class $$MirroredAttendanceTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $MirroredAttendanceTable,
          MirroredAttendanceRow,
          $$MirroredAttendanceTableFilterComposer,
          $$MirroredAttendanceTableOrderingComposer,
          $$MirroredAttendanceTableAnnotationComposer,
          $$MirroredAttendanceTableCreateCompanionBuilder,
          $$MirroredAttendanceTableUpdateCompanionBuilder,
          (
            MirroredAttendanceRow,
            BaseReferences<
              _$AppDatabase,
              $MirroredAttendanceTable,
              MirroredAttendanceRow
            >,
          ),
          MirroredAttendanceRow,
          PrefetchHooks Function()
        > {
  $$MirroredAttendanceTableTableManager(
    _$AppDatabase db,
    $MirroredAttendanceTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$MirroredAttendanceTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$MirroredAttendanceTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$MirroredAttendanceTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> projectId = const Value.absent(),
                Value<String> date = const Value.absent(),
                Value<String> workerId = const Value.absent(),
                Value<String> status = const Value.absent(),
                Value<String> overtimeHours = const Value.absent(),
                Value<bool> pending = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => MirroredAttendanceCompanion(
                projectId: projectId,
                date: date,
                workerId: workerId,
                status: status,
                overtimeHours: overtimeHours,
                pending: pending,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String projectId,
                required String date,
                required String workerId,
                required String status,
                Value<String> overtimeHours = const Value.absent(),
                Value<bool> pending = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => MirroredAttendanceCompanion.insert(
                projectId: projectId,
                date: date,
                workerId: workerId,
                status: status,
                overtimeHours: overtimeHours,
                pending: pending,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$MirroredAttendanceTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $MirroredAttendanceTable,
      MirroredAttendanceRow,
      $$MirroredAttendanceTableFilterComposer,
      $$MirroredAttendanceTableOrderingComposer,
      $$MirroredAttendanceTableAnnotationComposer,
      $$MirroredAttendanceTableCreateCompanionBuilder,
      $$MirroredAttendanceTableUpdateCompanionBuilder,
      (
        MirroredAttendanceRow,
        BaseReferences<
          _$AppDatabase,
          $MirroredAttendanceTable,
          MirroredAttendanceRow
        >,
      ),
      MirroredAttendanceRow,
      PrefetchHooks Function()
    >;
typedef $$OutboxTableCreateCompanionBuilder =
    OutboxCompanion Function({
      Value<int> id,
      required String kind,
      required String clientId,
      required String payload,
      required String label,
      Value<DateTime> createdAt,
      Value<int> attempts,
      Value<String?> lastError,
      Value<bool> blocked,
    });
typedef $$OutboxTableUpdateCompanionBuilder =
    OutboxCompanion Function({
      Value<int> id,
      Value<String> kind,
      Value<String> clientId,
      Value<String> payload,
      Value<String> label,
      Value<DateTime> createdAt,
      Value<int> attempts,
      Value<String?> lastError,
      Value<bool> blocked,
    });

class $$OutboxTableFilterComposer
    extends Composer<_$AppDatabase, $OutboxTable> {
  $$OutboxTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get clientId => $composableBuilder(
    column: $table.clientId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get payload => $composableBuilder(
    column: $table.payload,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get label => $composableBuilder(
    column: $table.label,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get attempts => $composableBuilder(
    column: $table.attempts,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastError => $composableBuilder(
    column: $table.lastError,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get blocked => $composableBuilder(
    column: $table.blocked,
    builder: (column) => ColumnFilters(column),
  );
}

class $$OutboxTableOrderingComposer
    extends Composer<_$AppDatabase, $OutboxTable> {
  $$OutboxTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get clientId => $composableBuilder(
    column: $table.clientId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get payload => $composableBuilder(
    column: $table.payload,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get label => $composableBuilder(
    column: $table.label,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get attempts => $composableBuilder(
    column: $table.attempts,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastError => $composableBuilder(
    column: $table.lastError,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get blocked => $composableBuilder(
    column: $table.blocked,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$OutboxTableAnnotationComposer
    extends Composer<_$AppDatabase, $OutboxTable> {
  $$OutboxTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get kind =>
      $composableBuilder(column: $table.kind, builder: (column) => column);

  GeneratedColumn<String> get clientId =>
      $composableBuilder(column: $table.clientId, builder: (column) => column);

  GeneratedColumn<String> get payload =>
      $composableBuilder(column: $table.payload, builder: (column) => column);

  GeneratedColumn<String> get label =>
      $composableBuilder(column: $table.label, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<int> get attempts =>
      $composableBuilder(column: $table.attempts, builder: (column) => column);

  GeneratedColumn<String> get lastError =>
      $composableBuilder(column: $table.lastError, builder: (column) => column);

  GeneratedColumn<bool> get blocked =>
      $composableBuilder(column: $table.blocked, builder: (column) => column);
}

class $$OutboxTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $OutboxTable,
          OutboxEntry,
          $$OutboxTableFilterComposer,
          $$OutboxTableOrderingComposer,
          $$OutboxTableAnnotationComposer,
          $$OutboxTableCreateCompanionBuilder,
          $$OutboxTableUpdateCompanionBuilder,
          (
            OutboxEntry,
            BaseReferences<_$AppDatabase, $OutboxTable, OutboxEntry>,
          ),
          OutboxEntry,
          PrefetchHooks Function()
        > {
  $$OutboxTableTableManager(_$AppDatabase db, $OutboxTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$OutboxTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$OutboxTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$OutboxTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<String> kind = const Value.absent(),
                Value<String> clientId = const Value.absent(),
                Value<String> payload = const Value.absent(),
                Value<String> label = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
                Value<int> attempts = const Value.absent(),
                Value<String?> lastError = const Value.absent(),
                Value<bool> blocked = const Value.absent(),
              }) => OutboxCompanion(
                id: id,
                kind: kind,
                clientId: clientId,
                payload: payload,
                label: label,
                createdAt: createdAt,
                attempts: attempts,
                lastError: lastError,
                blocked: blocked,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                required String kind,
                required String clientId,
                required String payload,
                required String label,
                Value<DateTime> createdAt = const Value.absent(),
                Value<int> attempts = const Value.absent(),
                Value<String?> lastError = const Value.absent(),
                Value<bool> blocked = const Value.absent(),
              }) => OutboxCompanion.insert(
                id: id,
                kind: kind,
                clientId: clientId,
                payload: payload,
                label: label,
                createdAt: createdAt,
                attempts: attempts,
                lastError: lastError,
                blocked: blocked,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$OutboxTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $OutboxTable,
      OutboxEntry,
      $$OutboxTableFilterComposer,
      $$OutboxTableOrderingComposer,
      $$OutboxTableAnnotationComposer,
      $$OutboxTableCreateCompanionBuilder,
      $$OutboxTableUpdateCompanionBuilder,
      (OutboxEntry, BaseReferences<_$AppDatabase, $OutboxTable, OutboxEntry>),
      OutboxEntry,
      PrefetchHooks Function()
    >;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$MirroredProjectsTableTableManager get mirroredProjects =>
      $$MirroredProjectsTableTableManager(_db, _db.mirroredProjects);
  $$MirroredWorkersTableTableManager get mirroredWorkers =>
      $$MirroredWorkersTableTableManager(_db, _db.mirroredWorkers);
  $$MirroredWorkerSitesTableTableManager get mirroredWorkerSites =>
      $$MirroredWorkerSitesTableTableManager(_db, _db.mirroredWorkerSites);
  $$MirroredAttendanceTableTableManager get mirroredAttendance =>
      $$MirroredAttendanceTableTableManager(_db, _db.mirroredAttendance);
  $$OutboxTableTableManager get outbox =>
      $$OutboxTableTableManager(_db, _db.outbox);
}
