export function isDatabaseQuotaError(error: unknown) {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === '53000' &&
    'message' in error &&
    typeof error.message === 'string' &&
    /quota/i.test(error.message)
  );
}
