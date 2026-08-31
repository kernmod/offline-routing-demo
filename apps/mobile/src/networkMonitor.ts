let attempts: Array<{ operation: string; url: string }> = [];
export function recordNetworkAttempt(operation: string, url: string) { attempts.push({ operation, url }); }
export function networkAttemptCount() { return attempts.length; }
export function resetNetworkAttempts() { attempts = []; }
