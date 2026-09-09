import {sql} from 'drizzle-orm';
import {index, integer, sqliteTable, text, uniqueIndex} from 'drizzle-orm/sqlite-core';

export const modpacks = sqliteTable('modpacks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  minecraftVersion: text('minecraft_version').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  revision: integer('revision').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const datasetPublications = sqliteTable('dataset_publications', {
  publicationId: text('publication_id').primaryKey(),
  manifestSha256: text('manifest_sha256').notNull(),
  objectCount: integer('object_count').notNull(),
  storedBytes: integer('stored_bytes').notNull(),
  committedAt: integer('committed_at').notNull(),
});

export const datasetChannels = sqliteTable(
  'dataset_channels',
  {
    slug: text('slug').primaryKey(),
    displayName: text('display_name').notNull(),
    minecraftVersion: text('minecraft_version').notNull(),
    packVersion: text('pack_version').notNull(),
    publicationId: text('publication_id')
      .notNull()
      .references(() => datasetPublications.publicationId),
    previewAssetSetId: text('preview_asset_set_id').notNull(),
    isDefault: integer('is_default').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    activatedAt: integer('activated_at').notNull(),
  },
  table => [
    uniqueIndex('dataset_channels_one_default_idx')
      .on(table.isDefault)
      .where(sql`${table.isDefault} = 1`),
    uniqueIndex('dataset_channels_publication_idx').on(table.publicationId),
    uniqueIndex('dataset_channels_preview_asset_set_idx').on(table.previewAssetSetId),
  ],
);

export const feedbackReports = sqliteTable(
  'feedback_reports',
  {
    id: text('id').primaryKey(),
    kind: text('kind', {enum: ['bug', 'feature']}).notNull(),
    title: text('title').notNull().default(''),
    message: text('message').notNull(),
    contact: text('contact'),
    packSlug: text('pack_slug'),
    packName: text('pack_name'),
    pageUrl: text('page_url'),
    userAgent: text('user_agent'),
    fingerprintHash: text('fingerprint_hash').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    index('feedback_reports_rate_limit_idx').on(table.fingerprintHash, table.createdAt),
    index('feedback_reports_created_at_idx').on(table.createdAt),
  ],
);

export const exportFailureReports = sqliteTable(
  'export_failure_reports',
  {
    fingerprint: text('fingerprint').primaryKey(),
    issueNumber: integer('issue_number'),
    issueUrl: text('issue_url'),
    status: text('status', {enum: ['pending', 'reported']}).notNull(),
    clientHash: text('client_hash').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('export_failure_reports_rate_limit_idx').on(table.clientHash, table.createdAt),
    index('export_failure_reports_created_at_idx').on(table.createdAt),
  ],
);

export const recipeFavorites = sqliteTable(
  'recipe_favorites',
  {
    packSlug: text('pack_slug').notNull(),
    publicationId: text('publication_id').notNull(),
    itemKey: text('item_key').notNull(),
    clientHash: text('client_hash').notNull(),
    recipeCategory: integer('recipe_category').notNull(),
    recipeIndex: integer('recipe_index').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('recipe_favorites_user_item_idx').on(
      table.packSlug,
      table.publicationId,
      table.itemKey,
      table.clientHash,
    ),
    index('recipe_favorites_ranking_idx').on(
      table.packSlug,
      table.publicationId,
      table.itemKey,
      table.recipeCategory,
      table.recipeIndex,
    ),
    index('recipe_favorites_client_hash_idx').on(table.clientHash),
  ],
);

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    avatarKey: text('avatar_key'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('users_provider_identity_idx').on(table.provider, table.providerUserId),
    uniqueIndex('users_avatar_key_idx').on(table.avatarKey),
  ],
);

export const accountRecipeFavorites = sqliteTable(
  'account_recipe_favorites',
  {
    userId: text('user_id').notNull().references(() => users.id, {onDelete: 'cascade'}),
    packSlug: text('pack_slug').notNull(),
    publicationId: text('publication_id').notNull(),
    itemKey: text('item_key').notNull(),
    recipeCategory: integer('recipe_category').notNull(),
    recipeIndex: integer('recipe_index').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('account_recipe_favorites_user_item_idx').on(
      table.userId,
      table.packSlug,
      table.publicationId,
      table.itemKey,
    ),
    index('account_recipe_favorites_ranking_idx').on(
      table.packSlug,
      table.publicationId,
      table.itemKey,
      table.recipeCategory,
      table.recipeIndex,
    ),
    index('account_recipe_favorites_user_leaderboard_idx').on(
      table.packSlug,
      table.publicationId,
      table.userId,
    ),
  ],
);

export const donationContributions = sqliteTable(
  'donation_contributions',
  {
    contributionId: text('contribution_id').primaryKey(),
    donorKey: text('donor_key').notNull(),
    publicName: text('public_name'),
    cadence: text('cadence', {enum: ['one_time', 'monthly']}).notNull(),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    grossCents: integer('gross_cents').notNull(),
    currency: text('currency').notNull(),
    paidAt: integer('paid_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('donation_contributions_week_idx').on(table.currency, table.paidAt),
    index('donation_contributions_donor_idx').on(table.donorKey, table.paidAt),
    index('donation_contributions_payment_intent_idx').on(table.stripePaymentIntentId),
  ],
);

export const donationRefunds = sqliteTable(
  'donation_refunds',
  {
    stripeChargeId: text('stripe_charge_id').primaryKey(),
    stripePaymentIntentId: text('stripe_payment_intent_id').notNull(),
    refundedCents: integer('refunded_cents').notNull(),
    currency: text('currency').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('donation_refunds_payment_intent_idx').on(table.stripePaymentIntentId),
  ],
);

export const donationWebhookEvents = sqliteTable(
  'donation_webhook_events',
  {
    eventId: text('event_id').primaryKey(),
    eventType: text('event_type').notNull(),
    processedAt: integer('processed_at').notNull(),
  },
  table => [index('donation_webhook_events_processed_idx').on(table.processedAt)],
);
