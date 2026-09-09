import assert from 'node:assert/strict';
import test from 'node:test';

const {
  applyDonationWebhookEvent,
  donationConfiguration,
  donationMonth,
  managedDonationSubscription,
} = await import('./donations.ts');

function database({processed = false} = {}) {
  const calls = [];
  const batches = [];
  return {
    calls,
    batches,
    prepare(sql) {
      const call = {sql: sql.replace(/\s+/gu, ' ').trim(), values: []};
      calls.push(call);
      const statement = {
        bind(...values) {
          call.values = values;
          return statement;
        },
        async first() {
          return processed ? {event_id: call.values[0]} : null;
        },
        async all() {
          return {success: true, results: []};
        },
        async run() {
          return {success: true, meta: {changes: 1}};
        },
      };
      return statement;
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map(() => ({success: true, meta: {changes: 1}}));
    },
  };
}

test('monthly operating costs reset on the first day of each UTC month', () => {
  const configuration = donationConfiguration({
    DONATION_SUPABASE_MONTHLY_CENTS: '2500',
    DONATION_CLOUDFLARE_MONTHLY_CENTS: '500',
    DONATION_GITHUB_ACTIONS_MONTHLY_CENTS: '400',
  });
  assert.deepEqual(configuration.costs.map(cost => cost.monthlyCents), [400, 500, 2500]);
  assert.deepEqual(configuration.costs.map(cost => cost.cumulativeCents), [400, 900, 3400]);
  assert.equal(configuration.goalCents, 3400);
  assert.deepEqual(
    donationMonth(Date.parse('2026-08-29T16:00:00Z')),
    {
      startsAt: Date.parse('2026-08-01T00:00:00Z'),
      endsAt: Date.parse('2026-09-01T00:00:00Z'),
    },
  );
});

test('operating costs fail closed instead of inventing a missing service amount', () => {
  assert.throws(
    () => donationConfiguration({
      DONATION_SUPABASE_MONTHLY_CENTS: '2500',
      DONATION_CLOUDFLARE_MONTHLY_CENTS: '500',
    }),
    /DONATION_GITHUB_ACTIONS_MONTHLY_CENTS/,
  );
});

test('a paid one-time Checkout Session is stored once with its opt-in public identity', async () => {
  const DB = database();
  await applyDonationWebhookEvent(DB, {
    id: 'evt_checkout',
    type: 'checkout.session.completed',
    created: 1_788_000_000,
    data: {object: {
      id: 'cs_test_123',
      mode: 'payment',
      payment_status: 'paid',
      amount_total: 2500,
      currency: 'usd',
      payment_intent: 'pi_123',
      metadata: {
        mrt_kind: 'one_time',
        mrt_donor_key: 'guest:123e4567-e89b-42d3-a456-426614174000',
        mrt_public: '1',
        mrt_public_name: 'Recipe Builder',
      },
    }},
  });

  assert.equal(DB.batches.length, 1);
  const write = DB.calls.find(call => call.sql.startsWith('INSERT INTO donation_contributions'));
  assert.ok(write);
  assert.deepEqual(write.values.slice(0, 7), [
    'checkout:cs_test_123',
    'guest:123e4567-e89b-42d3-a456-426614174000',
    'Recipe Builder',
    'one_time',
    'pi_123',
    2500,
    'usd',
  ]);
});

test('an already processed Stripe event is idempotent', async () => {
  const DB = database({processed: true});
  await applyDonationWebhookEvent(DB, {
    id: 'evt_checkout',
    type: 'checkout.session.completed',
    created: 1_788_000_000,
    data: {object: {}},
  });
  assert.equal(DB.batches.length, 0);
});

test('partial refunds save Stripe absolute refunded totals for net meter accounting', async () => {
  const DB = database();
  await applyDonationWebhookEvent(DB, {
    id: 'evt_refund',
    type: 'charge.refunded',
    created: 1_788_000_001,
    data: {object: {
      id: 'ch_123',
      payment_intent: 'pi_123',
      amount_refunded: 700,
      currency: 'usd',
    }},
  });
  const write = DB.calls.find(call => call.sql.startsWith('INSERT INTO donation_refunds'));
  assert.ok(write);
  assert.deepEqual(write.values.slice(0, 4), ['ch_123', 'pi_123', 700, 'usd']);
});

test('monthly tier management selects the newest active account subscription', async () => {
  const newest = {
    id: 'sub_new',
    status: 'active',
    created: 20,
    items: {data: [{
      id: 'si_new',
      current_period_end: 1_800_000_000,
      price: {
        currency: 'usd',
        unit_amount: 2500,
        recurring: {interval: 'month'},
        product: 'prod_recipe_tree',
      },
    }]},
  };
  const client = {
    subscriptions: {
      async search(parameters) {
        assert.deepEqual(parameters, {
          query: "metadata['mrt_donor_key']:'user:123e4567-e89b-42d3-a456-426614174000'",
          limit: 20,
        });
        return {
          data: [
            {...newest, id: 'sub_old', created: 10},
            {...newest, status: 'canceled', created: 30},
            newest,
          ],
        };
      },
    },
  };

  const managed = await managedDonationSubscription(
    client,
    '123e4567-e89b-42d3-a456-426614174000',
  );
  assert.equal(managed.subscription.id, 'sub_new');
  assert.equal(managed.amountCents, 2500);
});
