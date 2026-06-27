const test = require('node:test');
const assert = require('node:assert/strict');
const { withSupabaseRetry } = require('../src/utils/supabaseRetry');

test('retries transient failures before succeeding', async () => {
  let attempts = 0;

  const value = await withSupabaseRetry(async () => {
    attempts += 1;
    if (attempts < 3) {
      const err = new Error('timeout');
      err.code = 'ETIMEDOUT';
      throw err;
    }
    return 'ok';
  }, { attempts: 3, baseDelayMs: 1 });

  assert.equal(value, 'ok');
  assert.equal(attempts, 3);
});

test('does not retry non-retryable failures', async () => {
  let attempts = 0;

  await assert.rejects(
    () => withSupabaseRetry(async () => {
      attempts += 1;
      throw new Error('invalid query');
    }, { attempts: 3, baseDelayMs: 1 }),
    /invalid query/
  );

  assert.equal(attempts, 1);
});
