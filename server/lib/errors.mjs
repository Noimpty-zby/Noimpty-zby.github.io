export class ApiError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
export function invariant(condition, status, code, message, extra) {
  if (!condition) throw new ApiError(status, code, message, extra);
}
