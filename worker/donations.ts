import Stripe from 'stripe';
import {
  type D1Database,
  type DatasetRuntime,
  methodNotAllowed,
  noStoreJson,
} from './datasetRuntime.ts';
import {currentUser} from './userAccounts.ts';

export const DONATIONS_ROUTE = '/api/donations';
export const DONATION_CHECKOUT_ROUTE = `${DONATIONS_ROUTE}/checkout`;
export const DONATION_SUBSCRIPTION_ROUTE = `${DONATIONS_ROUTE}/subscription`;
export const DONATION_WEBHOOK_ROUTE = `${DONATIONS_ROUTE}/webhook`;

const MAX_BODY_BYTES = 4 * 1024;
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const MIN_DONATION_CENTS = 100;
const MAX_DONATION_CENTS = 100_000;
const LEADERBOARD_LIMIT = 50;
const UNSAFE_TEXT_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;
const initializedDatabases = new WeakMap<object, Promise<void>>();

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS donation_contributions (
    contribution_id TEXT PRIMARY KEY NOT NULL,
    donor_key TEXT NOT NULL,
    public_name TEXT,
    cadence TEXT NOT NULL,
    stripe_payment_intent_id TEXT,
    gross_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    paid_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS donation_contributions_week_idx
   ON donation_contributions (currency, paid_at)`,
  `CREATE INDEX IF NOT EXISTS donation_contributions_donor_idx
   ON donation_contributions (donor_key, paid_at)`,
  `CREATE INDEX IF NOT EXISTS donation_contributions_payment_intent_idx
   ON donation_contributions (stripe_payment_intent_id)`,
  `CREATE TABLE IF NOT EXISTS donation_refunds (
    stripe_charge_id TEXT PRIMARY KEY NOT NULL,
    stripe_payment_intent_id TEXT NOT NULL,
    refunded_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS donation_refunds_payment_intent_idx
   ON donation_refunds (stripe_payment_intent_id)`,
  `CREATE TABLE IF NOT EXISTS donation_webhook_events (
    event_id TEXT PRIMARY KEY NOT NULL,
    event_type TEXT NOT NULL,
    processed_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS donation_webhook_events_processed_idx
   ON donation_webhook_events (processed_at)`,
  'PRAGMA optimize',
] as const;

interface OperatingCost {
  id: 'supabase' | 'cloudflare' | 'github-actions';
  label: string;
  monthlyCents: number;
  cumulativeCents: number;
}

interface DonationConfiguration {
  costs: OperatingCost[];
  goalCents: number;
}

interface ContributionRow {
  total_cents: number | null;
}

interface LeaderboardRow {
  donor_key: string;
  public_name: string;
  total_cents: number;
}

interface AnonymousRow {
  donor_count: number;
  total_cents: number | null;
}

function requiredMonthlyCents(value: string | undefined, name: string): number {
  if (!value || !/^\d{1,9}$/u.test(value)) {
    throw new Error(`${name} must be a positive integer number of US cents.`);
  }
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error(`${name} must be a positive integer number of US cents.`);
  }
  return cents;
}

export function donationConfiguration(runtime: DatasetRuntime): DonationConfiguration {
  const inputs = [
    ['github-actions', 'GitHub Actions', runtime.DONATION_GITHUB_ACTIONS_MONTHLY_CENTS, 'DONATION_GITHUB_ACTIONS_MONTHLY_CENTS'],
    ['cloudflare', 'Cloudflare', runtime.DONATION_CLOUDFLARE_MONTHLY_CENTS, 'DONATION_CLOUDFLARE_MONTHLY_CENTS'],
    ['supabase', 'Supabase', runtime.DONATION_SUPABASE_MONTHLY_CENTS, 'DONATION_SUPABASE_MONTHLY_CENTS'],
  ] as const;
  let cumulativeCents = 0;
  const costs = inputs.map(([id, label, value, environmentName]) => {
    const monthlyCents = requiredMonthlyCents(value, environmentName);
    cumulativeCents += monthlyCents;
    return {id, label, monthlyCents, cumulativeCents};
  });
  return {costs, goalCents: cumulativeCents};
}

export function donationMonth(now = Date.now()): {startsAt: number; endsAt: number} {
  const date = new Date(now);
  const startsAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const endsAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return {startsAt, endsAt};
}

export function ensureDonationSchema(db: D1Database): Promise<void> {
  const cached = initializedDatabases.get(db as object);
  if (cached) return cached;
  const operation = db
    .batch(schemaStatements.map(statement => db.prepare(statement)))
    .then(results => {
      if (results.some(result => !result.success)) {
        throw new Error('D1 reported an unsuccessful donation schema statement.');
      }
    })
    .catch(error => {
      initializedDatabases.delete(db as object);
      console.error('Donation schema initialization failed.', error);
      throw error;
    });
  initializedDatabases.set(db as object, operation);
  return operation;
}

function requestOriginAllowed(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}

function validDisplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 60 &&
    value.trim() === value &&
    !UNSAFE_TEXT_PATTERN.test(value)
  );
}

function stripeId(value: unknown, prefix: string): string | null {
  if (typeof value === 'string') return value.startsWith(prefix) ? value : null;
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as {id?: unknown}).id;
    return typeof id === 'string' && id.startsWith(prefix) ? id : null;
  }
  return null;
}

function metadataIdentity(metadata: Stripe.Metadata | null | undefined): {
  donorKey: string;
  publicName: string | null;
} | null {
  const donorKey = metadata?.mrt_donor_key;
  if (!donorKey || donorKey.length > 96 || !/^(?:user:[0-9a-f-]{36}|guest:[0-9a-f-]{36})$/iu.test(donorKey)) {
    return null;
  }
  const publicName = metadata?.mrt_public === '1' && validDisplayName(metadata.mrt_public_name)
    ? metadata.mrt_public_name
    : null;
  return {donorKey, publicName};
}

function netContributionSql(where: string): string {
  return `SELECT COALESCE(SUM(
      CASE WHEN c.gross_cents > COALESCE(r.refunded_cents, 0)
           THEN c.gross_cents - COALESCE(r.refunded_cents, 0)
           ELSE 0 END
    ), 0) AS total_cents
    FROM donation_contributions c
    LEFT JOIN (
      SELECT stripe_payment_intent_id, SUM(refunded_cents) AS refunded_cents
      FROM donation_refunds
      GROUP BY stripe_payment_intent_id
    ) r ON r.stripe_payment_intent_id = c.stripe_payment_intent_id
    ${where}`;
}

async function donationStatus(db: D1Database, configuration: DonationConfiguration): Promise<Response> {
  const month = donationMonth();
  const [total, leaderboard, anonymous] = await Promise.all([
    db.prepare(netContributionSql(
      `WHERE c.currency = 'usd' AND c.paid_at >= ? AND c.paid_at < ?`,
    )).bind(month.startsAt, month.endsAt).first<ContributionRow>(),
    db.prepare(
      `SELECT c.donor_key, MAX(c.public_name) AS public_name,
        SUM(CASE WHEN c.gross_cents > COALESCE(r.refunded_cents, 0)
                 THEN c.gross_cents - COALESCE(r.refunded_cents, 0)
                 ELSE 0 END) AS total_cents
       FROM donation_contributions c
       LEFT JOIN (
         SELECT stripe_payment_intent_id, SUM(refunded_cents) AS refunded_cents
         FROM donation_refunds
         GROUP BY stripe_payment_intent_id
       ) r ON r.stripe_payment_intent_id = c.stripe_payment_intent_id
       WHERE c.currency = 'usd' AND c.paid_at >= ? AND c.paid_at < ?
         AND c.public_name IS NOT NULL
       GROUP BY c.donor_key
       HAVING total_cents > 0
       ORDER BY total_cents DESC, public_name ASC
       LIMIT ?`,
    ).bind(month.startsAt, month.endsAt, LEADERBOARD_LIMIT).all<LeaderboardRow>(),
    db.prepare(
      `SELECT COUNT(DISTINCT c.donor_key) AS donor_count,
        SUM(CASE WHEN c.gross_cents > COALESCE(r.refunded_cents, 0)
                 THEN c.gross_cents - COALESCE(r.refunded_cents, 0)
                 ELSE 0 END) AS total_cents
       FROM donation_contributions c
       LEFT JOIN (
         SELECT stripe_payment_intent_id, SUM(refunded_cents) AS refunded_cents
         FROM donation_refunds
         GROUP BY stripe_payment_intent_id
       ) r ON r.stripe_payment_intent_id = c.stripe_payment_intent_id
       WHERE c.currency = 'usd' AND c.paid_at >= ? AND c.paid_at < ?
         AND c.public_name IS NULL`,
    ).bind(month.startsAt, month.endsAt).first<AnonymousRow>(),
  ]);
  if (!leaderboard.success) throw new Error('D1 reported an unsuccessful donor-leaderboard query.');
  const totalCents = total?.total_cents ?? 0;
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new Error('Donation storage contains an invalid monthly total.');
  }
  const entries = (leaderboard.results ?? []).map(row => {
    if (
      !validDisplayName(row.public_name) ||
      !Number.isSafeInteger(row.total_cents) ||
      row.total_cents <= 0
    ) {
      throw new Error('Donation storage contains an invalid public leaderboard row.');
    }
    return {donorKey: row.donor_key, displayName: row.public_name, totalCents: row.total_cents};
  });
  const anonymousDonorCount = anonymous?.donor_count ?? 0;
  const anonymousTotalCents = anonymous?.total_cents ?? 0;
  return noStoreJson({
    enabled: true,
    currency: 'usd',
    month,
    totalCents,
    goalCents: configuration.goalCents,
    marks: configuration.costs,
    leaderboard: entries,
    anonymous: {
      donorCount: Number.isSafeInteger(anonymousDonorCount) ? anonymousDonorCount : 0,
      totalCents: Number.isSafeInteger(anonymousTotalCents) ? anonymousTotalCents : 0,
    },
  });
}

async function parseCheckoutBody(request: Request): Promise<
  | {amountCents: number; cadence: 'one_time' | 'monthly'; publicName: string | null; returnUrl: string}
  | Response
> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/u.test(length) || Number(length) > MAX_BODY_BYTES)) {
    return noStoreJson({error: 'Donation request is too large.'}, 413);
  }
  let value: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return noStoreJson({error: 'Donation request is too large.'}, 413);
    }
    value = JSON.parse(text) as unknown;
  } catch {
    return noStoreJson({error: 'Donation request must be valid JSON.'}, 400);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return noStoreJson({error: 'Donation request has an invalid shape.'}, 400);
  }
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).sort().join(',') !== 'amountCents,cadence,publicName,returnUrl' ||
    !Number.isSafeInteger(body.amountCents) ||
    (body.amountCents as number) < MIN_DONATION_CENTS ||
    (body.amountCents as number) > MAX_DONATION_CENTS ||
    (body.cadence !== 'one_time' && body.cadence !== 'monthly') ||
    (body.publicName !== null && !validDisplayName(body.publicName)) ||
    typeof body.returnUrl !== 'string' ||
    body.returnUrl.length > 2048
  ) {
    return noStoreJson({error: 'Donation request contains invalid values.'}, 400);
  }
  return {
    amountCents: body.amountCents as number,
    cadence: body.cadence,
    publicName: body.publicName,
    returnUrl: body.returnUrl,
  };
}

function checkoutReturnUrl(candidate: string, requestUrl: URL, outcome: 'success' | 'canceled'): string {
  const parsed = new URL(candidate);
  if (parsed.origin !== requestUrl.origin || parsed.username || parsed.password) {
    throw new Error('Donation return URL must use the current application origin.');
  }
  parsed.searchParams.set('donation', outcome);
  return parsed.toString();
}

function stripeClient(runtime: DatasetRuntime): Stripe {
  const secret = runtime.STRIPE_SECRET_KEY;
  if (!secret || !/^(?:sk|rk)_(?:test|live)_[A-Za-z0-9_]{16,}$/u.test(secret)) {
    throw new Error('STRIPE_SECRET_KEY is missing or invalid.');
  }
  return new Stripe(secret, {httpClient: Stripe.createFetchHttpClient()});
}

type ManagedSubscription = {
  subscription: Stripe.Subscription;
  item: Stripe.SubscriptionItem;
  amountCents: number;
};

export async function managedDonationSubscription(
  client: Stripe,
  userId: string,
): Promise<ManagedSubscription | null> {
  const result = await client.subscriptions.search({
    query: `metadata['mrt_donor_key']:'user:${userId}'`,
    limit: 20,
  });
  const subscription = result.data
    .filter(entry => ['active', 'trialing', 'past_due'].includes(entry.status))
    .sort((left, right) => right.created - left.created)[0];
  if (!subscription) return null;
  if (subscription.items.data.length !== 1) {
    throw new Error('The monthly donation subscription does not have exactly one tier item.');
  }
  const item = subscription.items.data[0];
  const amountCents = item.price.unit_amount;
  if (
    item.price.currency !== 'usd' ||
    item.price.recurring?.interval !== 'month' ||
    !Number.isSafeInteger(amountCents) ||
    amountCents === null ||
    amountCents < MIN_DONATION_CENTS ||
    amountCents > MAX_DONATION_CENTS
  ) {
    throw new Error('The monthly donation subscription has an unsupported tier price.');
  }
  return {subscription, item, amountCents};
}

function managedSubscriptionJson(managed: ManagedSubscription | null) {
  if (!managed) return {subscription: null};
  return {
    subscription: {
      amountCents: managed.amountCents,
      status: managed.subscription.status,
      nextBillingAt: managed.item.current_period_end * 1000,
    },
  };
}

async function parseTierBody(request: Request): Promise<number | Response> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/u.test(length) || Number(length) > MAX_BODY_BYTES)) {
    return noStoreJson({error: 'Tier request is too large.'}, 413);
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return noStoreJson({error: 'Tier request is too large.'}, 413);
    }
    body = JSON.parse(text) as unknown;
  } catch {
    return noStoreJson({error: 'Tier request must be valid JSON.'}, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return noStoreJson({error: 'Tier request has an invalid shape.'}, 400);
  }
  const record = body as Record<string, unknown>;
  if (
    Object.keys(record).join(',') !== 'amountCents' ||
    !Number.isSafeInteger(record.amountCents) ||
    (record.amountCents as number) < MIN_DONATION_CENTS ||
    (record.amountCents as number) > MAX_DONATION_CENTS
  ) {
    return noStoreJson({error: 'Tier amount must be between $1 and $1,000 per month.'}, 400);
  }
  return record.amountCents as number;
}

async function manageDonationSubscription(
  request: Request,
  runtime: DatasetRuntime,
  url: URL,
): Promise<Response> {
  const user = await currentUser(request, runtime);
  if (!user) return noStoreJson({error: 'Sign in to manage a monthly donation tier.'}, 401);
  const client = stripeClient(runtime);
  const managed = await managedDonationSubscription(client, user.id);
  if (request.method === 'GET') return noStoreJson(managedSubscriptionJson(managed));
  if (!requestOriginAllowed(request, url)) {
    console.warn('A cross-origin donation tier request was refused.', {
      origin: request.headers.get('origin'),
    });
    return noStoreJson({error: 'Cross-origin tier changes are not allowed.'}, 403);
  }
  const amountCents = await parseTierBody(request);
  if (amountCents instanceof Response) return amountCents;
  if (!managed) return noStoreJson({error: 'No active monthly donation tier was found.'}, 404);
  const product = managed.item.price.product;
  const productId = typeof product === 'string' ? product : product.id;
  if (!productId.startsWith('prod_')) {
    throw new Error('The monthly donation subscription has an invalid Stripe product.');
  }
  const updated = await client.subscriptions.update(managed.subscription.id, {
    items: [{
      id: managed.item.id,
      price_data: {
        currency: 'usd',
        product: productId,
        recurring: {interval: 'month'},
        unit_amount: amountCents,
      },
    }],
    proration_behavior: 'none',
  });
  const updatedItem = updated.items.data[0];
  if (!updatedItem) throw new Error('Stripe returned a monthly subscription without its tier item.');
  return noStoreJson(managedSubscriptionJson({subscription: updated, item: updatedItem, amountCents}));
}

async function createCheckout(
  request: Request,
  runtime: DatasetRuntime,
  url: URL,
): Promise<Response> {
  if (!requestOriginAllowed(request, url)) {
    console.warn('A cross-origin donation Checkout request was refused.', {
      origin: request.headers.get('origin'),
    });
    return noStoreJson({error: 'Cross-origin donation requests are not allowed.'}, 403);
  }
  const parsed = await parseCheckoutBody(request);
  if (parsed instanceof Response) return parsed;
  const user = await currentUser(request, runtime);
  if (!user && request.headers.has('authorization')) {
    return noStoreJson({error: 'Your account session is invalid or expired.'}, 401);
  }
  const donorKey = user ? `user:${user.id}` : `guest:${crypto.randomUUID()}`;
  const publicName = parsed.publicName ?? null;
  const metadata: Stripe.MetadataParam = {
    mrt_kind: parsed.cadence,
    mrt_donor_key: donorKey,
    mrt_public: publicName ? '1' : '0',
    ...(publicName ? {mrt_public_name: publicName} : {}),
  };
  const session = await stripeClient(runtime).checkout.sessions.create({
    mode: parsed.cadence === 'monthly' ? 'subscription' : 'payment',
    submit_type: parsed.cadence === 'monthly' ? 'subscribe' : 'donate',
    success_url: checkoutReturnUrl(parsed.returnUrl, url, 'success'),
    cancel_url: checkoutReturnUrl(parsed.returnUrl, url, 'canceled'),
    metadata,
    ...(parsed.cadence === 'monthly'
      ? {subscription_data: {metadata}}
      : {payment_intent_data: {metadata}}),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: parsed.amountCents,
        product_data: {
          name: parsed.cadence === 'monthly'
            ? 'Recipe Tree monthly support'
            : 'Recipe Tree donation',
          description: 'Helps cover Recipe Tree hosting and build services.',
        },
        ...(parsed.cadence === 'monthly' ? {recurring: {interval: 'month' as const}} : {}),
      },
    }],
  });
  if (!session.url || !session.url.startsWith('https://checkout.stripe.com/')) {
    throw new Error('Stripe created a Checkout Session without a hosted Checkout URL.');
  }
  return noStoreJson({checkoutUrl: session.url}, 201);
}

function invoicePaymentIntent(invoice: Stripe.Invoice): string | null {
  const payments = invoice.payments?.data ?? [];
  for (const invoicePayment of payments) {
    const paymentIntentId = stripeId(invoicePayment.payment.payment_intent, 'pi_');
    if (paymentIntentId && invoicePayment.status === 'paid') return paymentIntentId;
  }
  return null;
}

async function saveContribution(
  db: D1Database,
  event: Stripe.Event,
  values: {
    contributionId: string;
    donorKey: string;
    publicName: string | null;
    cadence: 'one_time' | 'monthly';
    paymentIntentId: string | null;
    grossCents: number;
    currency: string;
    paidAt: number;
  },
): Promise<void> {
  const results = await db.batch([
    db.prepare(
      `INSERT INTO donation_contributions
         (contribution_id, donor_key, public_name, cadence, stripe_payment_intent_id,
          gross_cents, currency, paid_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (contribution_id)
       DO UPDATE SET donor_key = excluded.donor_key,
                     public_name = excluded.public_name,
                     stripe_payment_intent_id = excluded.stripe_payment_intent_id,
                     gross_cents = excluded.gross_cents,
                     currency = excluded.currency,
                     paid_at = excluded.paid_at,
                     updated_at = excluded.updated_at`,
    ).bind(
      values.contributionId,
      values.donorKey,
      values.publicName,
      values.cadence,
      values.paymentIntentId,
      values.grossCents,
      values.currency,
      values.paidAt,
      Date.now(),
    ),
    db.prepare(
      `INSERT INTO donation_webhook_events (event_id, event_type, processed_at)
       VALUES (?, ?, ?)
       ON CONFLICT (event_id) DO NOTHING`,
    ).bind(event.id, event.type, Date.now()),
  ]);
  if (results.some(result => !result.success)) {
    throw new Error('D1 reported an unsuccessful donation contribution write.');
  }
}

export async function applyDonationWebhookEvent(
  db: D1Database,
  event: Stripe.Event,
  stripe?: Stripe,
): Promise<void> {
  const alreadyProcessed = await db.prepare(
    'SELECT event_id FROM donation_webhook_events WHERE event_id = ? LIMIT 1',
  ).bind(event.id).first<{event_id: string}>();
  if (alreadyProcessed?.event_id === event.id) return;

  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded'
  ) {
    const session = event.data.object;
    if (session.mode !== 'payment' || session.payment_status !== 'paid') return;
    const identity = metadataIdentity(session.metadata);
    if (!identity || session.metadata?.mrt_kind !== 'one_time') {
      console.warn('A paid Checkout Session was not a Recipe Tree donation.', {sessionId: session.id});
      return;
    }
    if (!Number.isSafeInteger(session.amount_total) || (session.amount_total ?? 0) <= 0 || session.currency !== 'usd') {
      throw new Error('A paid donation Checkout Session contains an invalid USD total.');
    }
    const paymentIntentId = stripeId(session.payment_intent, 'pi_');
    if (!paymentIntentId) {
      throw new Error('A paid donation Checkout Session has no PaymentIntent for refund tracking.');
    }
    await saveContribution(db, event, {
      contributionId: `checkout:${session.id}`,
      donorKey: identity.donorKey,
      publicName: identity.publicName,
      cadence: 'one_time',
      paymentIntentId,
      grossCents: session.amount_total as number,
      currency: session.currency,
      paidAt: event.created * 1000,
    });
    return;
  }

  if (event.type === 'invoice.paid') {
    const invoice = event.data.object;
    const metadata = invoice.parent?.subscription_details?.metadata;
    const identity = metadataIdentity(metadata);
    if (!identity || metadata?.mrt_kind !== 'monthly') {
      console.warn('A paid invoice was not a Recipe Tree monthly donation.', {invoiceId: invoice.id});
      return;
    }
    if (!Number.isSafeInteger(invoice.amount_paid) || invoice.amount_paid <= 0 || invoice.currency !== 'usd') {
      throw new Error('A paid donation invoice contains an invalid USD total.');
    }
    const paidAt = invoice.status_transitions.paid_at
      ? invoice.status_transitions.paid_at * 1000
      : event.created * 1000;
    let paymentIntentId = invoicePaymentIntent(invoice);
    if (!paymentIntentId && stripe) {
      const payments = await stripe.invoicePayments.list({invoice: invoice.id, limit: 10});
      for (const payment of payments.data) {
        const candidate = stripeId(payment.payment.payment_intent, 'pi_');
        if (candidate && payment.status === 'paid') {
          paymentIntentId = candidate;
          break;
        }
      }
    }
    if (!paymentIntentId) {
      throw new Error('A paid donation invoice has no PaymentIntent for refund tracking.');
    }
    await saveContribution(db, event, {
      contributionId: `invoice:${invoice.id}`,
      donorKey: identity.donorKey,
      publicName: identity.publicName,
      cadence: 'monthly',
      paymentIntentId,
      grossCents: invoice.amount_paid,
      currency: invoice.currency,
      paidAt,
    });
    return;
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    const paymentIntentId = stripeId(charge.payment_intent, 'pi_');
    if (!paymentIntentId) {
      console.warn('A refunded charge cannot be matched to a donation PaymentIntent.', {
        chargeId: charge.id,
      });
      return;
    }
    if (!Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0) {
      throw new Error('A refunded Stripe charge contains an invalid refund total.');
    }
    const results = await db.batch([
      db.prepare(
        `INSERT INTO donation_refunds
           (stripe_charge_id, stripe_payment_intent_id, refunded_cents, currency, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (stripe_charge_id)
         DO UPDATE SET stripe_payment_intent_id = excluded.stripe_payment_intent_id,
                       refunded_cents = excluded.refunded_cents,
                       currency = excluded.currency,
                       updated_at = excluded.updated_at`,
      ).bind(charge.id, paymentIntentId, charge.amount_refunded, charge.currency, Date.now()),
      db.prepare(
        `INSERT INTO donation_webhook_events (event_id, event_type, processed_at)
         VALUES (?, ?, ?)
         ON CONFLICT (event_id) DO NOTHING`,
      ).bind(event.id, event.type, Date.now()),
    ]);
    if (results.some(result => !result.success)) {
      throw new Error('D1 reported an unsuccessful donation refund write.');
    }
    return;
  }

  console.info('Stripe webhook event did not require donation storage.', {eventType: event.type});
}

async function handleWebhook(request: Request, runtime: DatasetRuntime, db: D1Database): Promise<Response> {
  const signature = request.headers.get('stripe-signature');
  const secret = runtime.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret || !secret.startsWith('whsec_')) {
    console.error('Stripe webhook verification is not configured.');
    return noStoreJson({error: 'Donation webhooks are unavailable.'}, 503);
  }
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/u.test(length) || Number(length) > MAX_WEBHOOK_BODY_BYTES)) {
    console.warn('An oversized Stripe webhook was refused.', {contentLength: length});
    return noStoreJson({error: 'Webhook request is too large.'}, 413);
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BODY_BYTES) {
    console.warn('An oversized Stripe webhook was refused after reading its body.');
    return noStoreJson({error: 'Webhook request is too large.'}, 413);
  }
  const client = stripeClient(runtime);
  let event: Stripe.Event;
  try {
    event = await client.webhooks.constructEventAsync(
      rawBody,
      signature,
      secret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (error) {
    console.warn('Stripe webhook signature verification failed.', error);
    return noStoreJson({error: 'Invalid webhook signature.'}, 400);
  }
  await applyDonationWebhookEvent(db, event, client);
  return noStoreJson({received: true});
}

export async function handleDonations(
  request: Request,
  runtime: DatasetRuntime,
  url: URL,
): Promise<Response> {
  const db = runtime.DB;
  if (!db) return noStoreJson({enabled: false, error: 'Donation storage is unavailable.'}, 503);
  try {
    await ensureDonationSchema(db);
    if (url.pathname === DONATIONS_ROUTE) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      let configuration: DonationConfiguration;
      try {
        configuration = donationConfiguration(runtime);
      } catch (error) {
        console.error('Donation operating costs are not configured.', error);
        return noStoreJson({enabled: false, error: 'Donations are not configured yet.'});
      }
      return await donationStatus(db, configuration);
    }
    if (url.pathname === DONATION_CHECKOUT_ROUTE) {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      donationConfiguration(runtime);
      return await createCheckout(request, runtime, url);
    }
    if (url.pathname === DONATION_SUBSCRIPTION_ROUTE) {
      if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed('GET, POST');
      return await manageDonationSubscription(request, runtime, url);
    }
    if (url.pathname === DONATION_WEBHOOK_ROUTE) {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      return await handleWebhook(request, runtime, db);
    }
    return noStoreJson({error: 'Not found.'}, 404);
  } catch (error) {
    console.error('Donation request failed.', {path: url.pathname, error});
    return noStoreJson({error: 'Donations are temporarily unavailable.'}, 503);
  }
}
