export type FailureClass = 'none' | 'auth' | 'trust' | 'limit' | 'network' | 'command' | 'timeout' | 'token-missing';

export function classifyFailure(combined: string): FailureClass {
  if (/free usage limit|rate limit|quota|limit reached|too many requests|429/i.test(combined)) {
    return 'limit';
  }
  if (
    /\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH)\b|dns error|failed to lookup address|could not resolve host/i.test(
      combined,
    )
  ) {
    return 'network';
  }
  if (
    /not (?:logged|signed) in|not authenticated|unauthenticated|authentication (?:failed|required)|please (?:log|sign) in|run ['"]?copilot login|unauthorized|\b401\b/i.test(
      combined,
    )
  ) {
    return 'auth';
  }
  if (/untrusted folder|folder (?:is )?not trusted|trust (?:is )?required|confirm folder trust/i.test(combined)) {
    return 'trust';
  }
  return 'command';
}
