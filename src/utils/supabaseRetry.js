const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableError = (error) => {
  if (!error) return false;
  const message = String(error?.message || error || '').toLowerCase();
  const code = String(error?.code || error?.status || '').toLowerCase();

  return (
    message.includes('timeout') ||
    message.includes('temporarily unavailable') ||
    message.includes('rate limit') ||
    message.includes('quota') ||
    message.includes('network') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('fetch failed') ||
    message.includes('etimedout') ||
    message.includes('econnrefused') ||
    message.includes('server error') ||
    code === 'etimedout' ||
    code === '429' ||
    code === '503' ||
    code === '504'
  );
};

async function withSupabaseRetry(operation, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 3));
  const baseDelayMs = Math.max(0, Number(options.baseDelayMs || 250));
  const logPrefix = options.logPrefix || '[supabase-retry]';

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error);
      if (!retryable || attempt === attempts) {
        throw error;
      }

      const delayMs = baseDelayMs * attempt;
      console.warn(`${logPrefix} attempt ${attempt}/${attempts} failed, retrying in ${delayMs}ms:`, error?.message || error);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

module.exports = {
  withSupabaseRetry,
  isRetryableError,
};
