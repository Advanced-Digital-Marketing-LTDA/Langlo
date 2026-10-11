import { relations, sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core';

const createdAt = () =>
  integer('created_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

// Match String.prototype.trim() for text fields enforced in application code.
const flashcardTrimWhitespace = sql.raw(
  [
    9,
    10,
    11,
    12,
    13,
    32,
    160,
    5760,
    ...Array.from({ length: 11 }, (_, i) => 8192 + i),
    8232,
    8233,
    8239,
    8287,
    12288,
    65279
  ]
    .map((codePoint) => `char(${codePoint})`)
    .join(' || ')
);

// Migration 0003 rejects whitespace-only/NUL identity text in user IDs, skill IDs and
// canonical mistakes. Keep its hand-authored triggers during future table rebuilds.
// T010 adds the maintained auth-library fields: email stays nullable+unique so
// provisioned identities are unique while synthetic fixture users cannot collide.
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().default(''),
    email: text('email'),
    emailVerified: integer('email_verified', { mode: 'boolean' })
      .notNull()
      .default(false),
    image: text('image'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
      .$onUpdate(() => new Date())
  },
  (table) => [
    check('users_id_nonempty', sql`length(trim(${table.id})) > 0`),
    uniqueIndex('users_email_unique').on(table.email)
  ]
);

// Maintained-auth tables (docs/auth.md). Plural names follow house style and are
// bound to the framework models through explicit modelName options in auth.ts.
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
      .$onUpdate(() => new Date()),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)]
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', {
      mode: 'timestamp_ms'
    }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', {
      mode: 'timestamp_ms'
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
      .$onUpdate(() => new Date())
  },
  (table) => [index('accounts_user_id_idx').on(table.userId)]
);

export const verifications = sqliteTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
      .$onUpdate(() => new Date())
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)]
);

export const rateLimits = sqliteTable('rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: integer('last_request').notNull()
});

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts)
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] })
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] })
}));

export const enrollments = sqliteTable(
  'enrollments',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    language: text('language', { enum: ['fr', 'de', 'en'] }).notNull(),
    startingLevel: text('starting_level', { enum: ['A1', 'A2'] }).notNull(),
    explanationLanguage: text('explanation_language', {
      enum: ['en', 'pt']
    }).notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex('enrollments_owner_language_unique').on(
      table.ownerId,
      table.language
    ),
    uniqueIndex('enrollments_identity_owner_language').on(
      table.id,
      table.ownerId,
      table.language
    ),
    check('enrollments_language', sql`${table.language} IN ('fr', 'de', 'en')`),
    // Migration 0003 guards the supported pairs: fr A1, de/en A1/A2.
    check('enrollments_level', sql`${table.startingLevel} IN ('A1', 'A2')`),
    check(
      'enrollments_explanation',
      sql`${table.explanationLanguage} IN ('en', 'pt')`
    )
  ]
);

export const skills = sqliteTable(
  'skills',
  {
    id: text('id').primaryKey(),
    language: text('language', { enum: ['fr', 'de', 'en'] }).notNull(),
    level: text('level', { enum: ['A1', 'A2'] }).notNull()
  },
  (table) => [
    uniqueIndex('skills_identity_language').on(table.id, table.language),
    check('skills_language', sql`${table.language} IN ('fr', 'de', 'en')`),
    check('skills_level', sql`${table.level} IN ('A1', 'A2')`)
  ]
);

export const prerequisites = sqliteTable(
  'prerequisites',
  {
    skillId: text('skill_id').notNull(),
    prerequisiteId: text('prerequisite_id').notNull(),
    language: text('language').notNull()
  },
  (table) => [
    primaryKey({ columns: [table.skillId, table.prerequisiteId] }),
    foreignKey({
      columns: [table.skillId, table.language],
      foreignColumns: [skills.id, skills.language]
    }),
    foreignKey({
      columns: [table.prerequisiteId, table.language],
      foreignColumns: [skills.id, skills.language]
    }),
    check(
      'prerequisites_not_self',
      sql`${table.skillId} <> ${table.prerequisiteId}`
    )
  ]
);

export const contentVersions = sqliteTable(
  'content_versions',
  {
    id: text('id').primaryKey(),
    skillId: text('skill_id').notNull(),
    language: text('language').notNull(),
    version: integer('version').notNull(),
    status: text('status', {
      enum: [
        'draft',
        'reference-checked',
        'schema-validated',
        'pilot-ready',
        'quarantined'
      ]
    })
      .notNull()
      .default('draft'),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex('content_versions_skill_version').on(
      table.skillId,
      table.version
    ),
    uniqueIndex('content_versions_identity_skill_language').on(
      table.id,
      table.skillId,
      table.language
    ),
    foreignKey({
      columns: [table.skillId, table.language],
      foreignColumns: [skills.id, skills.language]
    }),
    // Migration 0002 additionally enforces SQLite integer storage type and safe range.
    // Keep hand-authored triggers when generating future table rebuilds.
    check('content_versions_positive', sql`${table.version} > 0`),
    check(
      'content_versions_status',
      sql`${table.status} IN ('draft', 'reference-checked', 'schema-validated', 'pilot-ready', 'quarantined')`
    )
  ]
);

export const questions = sqliteTable(
  'questions',
  {
    id: text('id').primaryKey(),
    contentVersionId: text('content_version_id').notNull(),
    skillId: text('skill_id').notNull(),
    language: text('language').notNull(),
    format: text('format', {
      enum: ['multiple-choice', 'typed-blank', 'translation', 'correction']
    }).notNull()
  },
  (table) => [
    uniqueIndex('questions_identity_version_skill_language').on(
      table.id,
      table.contentVersionId,
      table.skillId,
      table.language
    ),
    foreignKey({
      columns: [table.contentVersionId, table.skillId, table.language],
      foreignColumns: [
        contentVersions.id,
        contentVersions.skillId,
        contentVersions.language
      ]
    }),
    check(
      'questions_format',
      sql`${table.format} IN ('multiple-choice', 'typed-blank', 'translation', 'correction')`
    )
  ]
);

export const studySessions = sqliteTable(
  'study_sessions',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    enrollmentId: text('enrollment_id').notNull(),
    language: text('language').notNull(),
    mode: text('mode', {
      enum: ['practice', 'assessment', 'mixed-review']
    }).notNull(),
    state: text('state', { enum: ['active', 'paused', 'completed'] })
      .notNull()
      .default('active'),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex('study_sessions_identity_owner_language').on(
      table.id,
      table.ownerId,
      table.language
    ),
    foreignKey({
      columns: [table.enrollmentId, table.ownerId, table.language],
      foreignColumns: [
        enrollments.id,
        enrollments.ownerId,
        enrollments.language
      ]
    }).onDelete('cascade'),
    index('study_sessions_owner_state').on(table.ownerId, table.state),
    check(
      'study_sessions_mode',
      sql`${table.mode} IN ('practice', 'assessment', 'mixed-review')`
    ),
    check(
      'study_sessions_state',
      sql`${table.state} IN ('active', 'paused', 'completed')`
    )
  ]
);

export const attempts = sqliteTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    studySessionId: text('study_session_id').notNull(),
    questionId: text('question_id').notNull(),
    contentVersionId: text('content_version_id').notNull(),
    skillId: text('skill_id').notNull(),
    language: text('language').notNull(),
    submissionKey: text('submission_key').notNull(),
    evidenceKind: text('evidence_kind', {
      enum: ['independent', 'assisted']
    }).notNull(),
    answer: text('answer').notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex('attempts_owner_submission_unique').on(
      table.ownerId,
      table.submissionKey
    ),
    uniqueIndex('attempts_identity_owner').on(table.id, table.ownerId),
    uniqueIndex('attempts_identity_owner_skill_language').on(
      table.id,
      table.ownerId,
      table.skillId,
      table.language
    ),
    foreignKey({
      columns: [table.studySessionId, table.ownerId, table.language],
      foreignColumns: [
        studySessions.id,
        studySessions.ownerId,
        studySessions.language
      ]
    }).onDelete('cascade'),
    foreignKey({
      columns: [
        table.questionId,
        table.contentVersionId,
        table.skillId,
        table.language
      ],
      foreignColumns: [
        questions.id,
        questions.contentVersionId,
        questions.skillId,
        questions.language
      ]
    }),
    check(
      'attempts_submission_nonempty',
      sql`length(trim(${table.submissionKey})) BETWEEN 1 AND 256`
    ),
    check(
      'attempts_evidence_kind',
      sql`${table.evidenceKind} IN ('independent', 'assisted')`
    )
  ]
);

export const evaluations = sqliteTable(
  'evaluations',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    attemptId: text('attempt_id').notNull(),
    evaluatorVersion: text('evaluator_version').notNull(),
    rubricVersion: text('rubric_version').notNull(),
    outcome: text('outcome', {
      enum: ['correct', 'incorrect', 'uncertain']
    }).notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex('evaluations_attempt_version_unique').on(
      table.attemptId,
      table.evaluatorVersion,
      table.rubricVersion
    ),
    uniqueIndex('evaluations_identity_owner_attempt').on(
      table.id,
      table.ownerId,
      table.attemptId
    ),
    foreignKey({
      columns: [table.attemptId, table.ownerId],
      foreignColumns: [attempts.id, attempts.ownerId]
    }).onDelete('cascade'),
    check(
      'evaluations_evaluator_nonempty',
      sql`length(trim(${table.evaluatorVersion})) > 0`
    ),
    check(
      'evaluations_rubric_nonempty',
      sql`length(trim(${table.rubricVersion})) > 0`
    ),
    check(
      'evaluations_outcome',
      sql`${table.outcome} IN ('correct', 'incorrect', 'uncertain')`
    )
  ]
);

export const skillEvidence = sqliteTable(
  'skill_evidence',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    attemptId: text('attempt_id').notNull(),
    evaluationId: text('evaluation_id').notNull(),
    skillId: text('skill_id').notNull(),
    language: text('language').notNull(),
    scoringVersion: text('scoring_version').notNull(),
    contribution: integer('contribution').notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex('skill_evidence_attempt_scoring_unique').on(
      table.ownerId,
      table.attemptId,
      table.scoringVersion
    ),
    foreignKey({
      columns: [table.attemptId, table.ownerId, table.skillId, table.language],
      foreignColumns: [
        attempts.id,
        attempts.ownerId,
        attempts.skillId,
        attempts.language
      ]
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.evaluationId, table.ownerId, table.attemptId],
      foreignColumns: [
        evaluations.id,
        evaluations.ownerId,
        evaluations.attemptId
      ]
    }).onDelete('cascade'),
    check(
      'skill_evidence_scoring_nonempty',
      sql`length(trim(${table.scoringVersion})) > 0`
    ),
    check('skill_evidence_contribution', sql`${table.contribution} IN (0, 1)`)
  ]
);

export const cardDrafts = sqliteTable(
  'card_drafts',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    language: text('language').notNull(),
    skillId: text('skill_id').notNull(),
    canonicalMistake: text('canonical_mistake').notNull(),
    sourceId: text('source_id').notNull(),
    format: text('format', { enum: ['cloze', 'question-answer'] }).notNull(),
    state: text('state', { enum: ['draft', 'approved', 'rejected'] })
      .notNull()
      .default('draft'),
    fieldsJson: text('fields_json').notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex('card_drafts_canonical_identity_unique').on(
      table.ownerId,
      table.language,
      table.skillId,
      table.canonicalMistake
    ),
    uniqueIndex('card_drafts_source_unique').on(table.sourceId),
    uniqueIndex('card_drafts_identity_owner_source_language').on(
      table.id,
      table.ownerId,
      table.sourceId,
      table.language
    ),
    foreignKey({
      columns: [table.skillId, table.language],
      foreignColumns: [skills.id, skills.language]
    }),
    check(
      'card_drafts_mistake_nonempty',
      sql`length(trim(${table.canonicalMistake})) BETWEEN 1 AND 4096`
    ),
    check(
      'card_drafts_source_format',
      sql`length(${table.sourceId}) = 74 AND ${table.sourceId} GLOB 'langlo:v1:*' AND substr(${table.sourceId}, 11) NOT GLOB '*[^0-9a-f]*'`
    ),
    check(
      'card_drafts_format',
      sql`${table.format} IN ('cloze', 'question-answer')`
    ),
    check(
      'card_drafts_state',
      sql`${table.state} IN ('draft', 'approved', 'rejected')`
    ),
    check('card_drafts_fields_json', sql`json_valid(${table.fieldsJson})`)
  ]
);

export const deliveries = sqliteTable(
  'deliveries',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardDraftId: text('card_draft_id').notNull(),
    language: text('language').notNull(),
    sourceId: text('source_id').notNull(),
    confirmedProfile: text('confirmed_profile').notNull(),
    confirmedDeck: text('confirmed_deck').notNull(),
    state: text('state', {
      enum: ['pending', 'claimed', 'delivered', 'failed']
    })
      .notNull()
      .default('pending'),
    claimToken: text('claim_token'),
    claimedAt: integer('claimed_at'),
    claimExpiresAt: integer('claim_expires_at'),
    retryCount: integer('retry_count').notNull().default(0),
    noteId: text('note_id'),
    deliveredAt: integer('delivered_at'),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex('deliveries_source_unique').on(table.sourceId),
    uniqueIndex('deliveries_card_unique').on(table.cardDraftId),
    foreignKey({
      columns: [
        table.cardDraftId,
        table.ownerId,
        table.sourceId,
        table.language
      ],
      foreignColumns: [
        cardDrafts.id,
        cardDrafts.ownerId,
        cardDrafts.sourceId,
        cardDrafts.language
      ]
    }).onDelete('cascade'),
    index('deliveries_owner_state').on(table.ownerId, table.state),
    check(
      'deliveries_profile_nonempty',
      sql`length(trim(${table.confirmedProfile})) > 0`
    ),
    check(
      'deliveries_deck_nonempty',
      sql`length(trim(${table.confirmedDeck})) > 0`
    ),
    check(
      'deliveries_state',
      sql`${table.state} IN ('pending', 'claimed', 'delivered', 'failed')`
    ),
    check('deliveries_retry_count', sql`${table.retryCount} >= 0`),
    check(
      'deliveries_claim_shape',
      sql`(${table.state} = 'claimed' AND ${table.claimToken} IS NOT NULL AND length(${table.claimToken}) > 0 AND ${table.claimedAt} IS NOT NULL AND ${table.claimExpiresAt} IS NOT NULL AND ${table.claimExpiresAt} > ${table.claimedAt}) OR (${table.state} <> 'claimed' AND ${table.claimToken} IS NULL AND ${table.claimedAt} IS NULL AND ${table.claimExpiresAt} IS NULL)`
    ),
    check(
      'deliveries_acknowledgement',
      sql`(${table.state} = 'delivered' AND ${table.noteId} IS NOT NULL AND length(trim(${table.noteId})) > 0 AND ${table.deliveredAt} IS NOT NULL) OR (${table.state} <> 'delivered' AND ${table.noteId} IS NULL AND ${table.deliveredAt} IS NULL)`
    )
  ]
);

export const nativeFlashcardDecks = sqliteTable(
  'native_flashcard_decks',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex('native_flashcard_decks_id_owner_unique').on(
      table.id,
      table.ownerId
    ),
    index('native_flashcard_decks_owner').on(table.ownerId),
    check(
      'native_flashcard_decks_name_nonempty',
      sql`length(trim(${table.name}, ${flashcardTrimWhitespace})) BETWEEN 1 AND 160 AND length(${table.name}) <= 160 AND instr(${table.name}, char(0)) = 0`
    )
  ]
);

// Migration 0004 guards restricted Cloze syntax on INSERT/UPDATE; preserve these triggers in rebuilds.
export const nativeFlashcardNotes = sqliteTable(
  'native_flashcard_notes',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id').notNull(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deckId: text('deck_id').notNull(),
    kind: text('kind', { enum: ['basic', 'cloze'] }).notNull(),
    contentJson: text('content_json').notNull(),
    status: text('status', { enum: ['draft', 'approved', 'rejected'] })
      .notNull()
      .default('draft'),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex('native_flashcard_notes_id_owner_unique').on(
      table.id,
      table.ownerId
    ),
    uniqueIndex('native_flashcard_notes_source_owner_unique').on(
      table.ownerId,
      table.sourceId
    ),
    foreignKey({
      columns: [table.deckId, table.ownerId],
      foreignColumns: [nativeFlashcardDecks.id, nativeFlashcardDecks.ownerId]
    }).onDelete('cascade'),
    index('native_flashcard_notes_owner_deck').on(table.ownerId, table.deckId),
    check(
      'native_flashcard_notes_kind',
      sql`${table.kind} IN ('basic', 'cloze')`
    ),
    check(
      'native_flashcard_notes_status',
      sql`${table.status} IN ('draft', 'approved', 'rejected')`
    ),
    check(
      'native_flashcard_notes_content_json',
      sql`json_valid(${table.contentJson})`
    ),
    check(
      'native_flashcard_notes_source_id',
      sql`length(${table.sourceId}) = 74 AND instr(${table.sourceId}, char(0)) = 0 AND ${table.sourceId} GLOB 'langlo:v1:*' AND substr(${table.sourceId}, 11) NOT GLOB '*[^0-9a-f]*'`
    ),
    check(
      'native_flashcard_notes_content_shape',
      sql`(${table.kind} = 'basic' AND json_type(${table.contentJson}) = 'object' AND json_type(${table.contentJson}, '$.front') = 'text' AND json_type(${table.contentJson}, '$.back') = 'text' AND instr(json_extract(${table.contentJson}, '$.front'), char(0)) = 0 AND length(trim(json_extract(${table.contentJson}, '$.front'), ${flashcardTrimWhitespace})) BETWEEN 1 AND 4096 AND length(json_extract(${table.contentJson}, '$.front')) <= 4096 AND instr(json_extract(${table.contentJson}, '$.back'), char(0)) = 0 AND length(trim(json_extract(${table.contentJson}, '$.back'), ${flashcardTrimWhitespace})) BETWEEN 1 AND 4096 AND length(json_extract(${table.contentJson}, '$.back')) <= 4096 AND json_remove(${table.contentJson}, '$.front', '$.back') = '{}') OR (${table.kind} = 'cloze' AND json_type(${table.contentJson}) = 'object' AND json_type(${table.contentJson}, '$.text') = 'text' AND instr(json_extract(${table.contentJson}, '$.text'), char(0)) = 0 AND length(trim(json_extract(${table.contentJson}, '$.text'), ${flashcardTrimWhitespace})) BETWEEN 1 AND 4096 AND length(json_extract(${table.contentJson}, '$.text')) <= 4096 AND json_remove(${table.contentJson}, '$.text') = '{}')`
    )
  ]
);

export const nativeFlashcards = sqliteTable(
  'native_flashcards',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    noteId: text('note_id').notNull(),
    ordinal: integer('ordinal').notNull().default(0),
    stateJson: text('state_json').notNull(),
    dueAt: integer('due_at').notNull(),
    revision: integer('revision').notNull().default(0),
    suspended: integer('suspended', { mode: 'boolean' })
      .notNull()
      .default(false),
    schedulerVersion: text('scheduler_version').notNull(),
    parametersJson: text('parameters_json').notNull()
  },
  (table) => [
    uniqueIndex('native_flashcards_id_owner_unique').on(
      table.id,
      table.ownerId
    ),
    uniqueIndex('native_flashcards_note_ordinal_unique').on(
      table.ownerId,
      table.noteId,
      table.ordinal
    ),
    foreignKey({
      columns: [table.noteId, table.ownerId],
      foreignColumns: [nativeFlashcardNotes.id, nativeFlashcardNotes.ownerId]
    }).onDelete('cascade'),
    index('native_flashcards_owner_due').on(
      table.ownerId,
      table.suspended,
      table.dueAt
    ),
    check(
      'native_flashcards_ordinal',
      sql`typeof(${table.ordinal}) = 'integer' AND ${table.ordinal} >= 0`
    ),
    check(
      'native_flashcards_due_at',
      sql`typeof(${table.dueAt}) = 'integer' AND ${table.dueAt} >= 0`
    ),
    check(
      'native_flashcards_revision',
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} >= 0`
    ),
    check(
      'native_flashcards_suspended',
      sql`typeof(${table.suspended}) = 'integer' AND ${table.suspended} IN (0, 1)`
    ),
    check('native_flashcards_state_json', sql`json_valid(${table.stateJson})`),
    check(
      'native_flashcards_parameters_json',
      sql`json_valid(${table.parametersJson})`
    )
  ]
);

// Migration 0004 uses WITHOUT ROWID (not expressible by this Drizzle builder)
// and adds hand-authored UPDATE/DELETE and duplicate-INSERT guards. Preserve the
// table option and all three triggers in rebuilds; DELETE is permitted only after
// the parent card has been removed by the intentional owner-data cascade.
export const nativeFlashcardReviewEvents = sqliteTable(
  'native_flashcard_review_events',
  {
    id: text('id').notNull(),
    ownerId: text('owner_id').notNull(),
    cardId: text('card_id').notNull(),
    expectedRevision: integer('expected_revision').notNull(),
    rating: text('rating', {
      enum: ['again', 'hard', 'good', 'easy']
    }).notNull(),
    reviewedAt: integer('reviewed_at').notNull(),
    schedulerVersion: text('scheduler_version').notNull(),
    parametersJson: text('parameters_json').notNull(),
    resultJson: text('result_json').notNull()
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    foreignKey({
      columns: [table.cardId, table.ownerId],
      foreignColumns: [nativeFlashcards.id, nativeFlashcards.ownerId]
    }).onDelete('cascade'),
    index('native_flashcard_review_events_card_time').on(
      table.ownerId,
      table.cardId,
      table.reviewedAt
    ),
    check(
      'native_flashcard_review_events_reviewed_at',
      sql`typeof(${table.reviewedAt}) = 'integer' AND ${table.reviewedAt} >= 0`
    ),
    check(
      'native_flashcard_review_events_revision',
      sql`typeof(${table.expectedRevision}) = 'integer' AND ${table.expectedRevision} >= 0`
    ),
    check(
      'native_flashcard_review_events_id_nonempty',
      sql`length(trim(${table.id}, ${flashcardTrimWhitespace})) BETWEEN 1 AND 256 AND length(${table.id}) <= 256`
    ),
    check(
      'native_flashcard_review_events_rating',
      sql`${table.rating} IN ('again', 'hard', 'good', 'easy')`
    ),
    check(
      'native_flashcard_review_events_parameters_json',
      sql`json_valid(${table.parametersJson})`
    ),
    check(
      'native_flashcard_review_events_result_json',
      sql`json_valid(${table.resultJson})`
    )
  ]
);
