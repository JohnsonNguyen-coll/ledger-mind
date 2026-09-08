/** Merchant bodies are untrusted and may echo signatures or account details.
 * Persist only a fixed diagnostic category, never the raw message/body.
 */
export function merchantErrorCategory(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return 'UNSPECIFIED';
  const body = raw as Record<string, unknown>;
  const error = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : {};
  const status = body.status && typeof body.status === 'object' ? body.status as Record<string, unknown> : {};
  const fields = [body.error, body.message, body.invalidReason, body.errorReason, error.message, error.code, error.reason, status.error_message];
  const text = fields.filter(v => typeof v === 'string').join(' ').slice(0, 4000).toLowerCase();
  if (/missing accepted in payment-signature payload/.test(text)) return 'MISSING_ACCEPTED';
  if (/insufficient.*(fund|balance)|(fund|balance).*insufficient/.test(text)) return 'INSUFFICIENT_FUNDS';
  if (/expir|validbefore|valid_before/.test(text)) return 'AUTHORIZATION_EXPIRED';
  if (/nonce|already.used|already.settl|replay/.test(text)) return 'AUTHORIZATION_ALREADY_USED';
  if (/signature/.test(text)) return 'SIGNATURE_REJECTED';
  if (/network|chain/.test(text)) return 'NETWORK_REJECTED';
  if (/recipient|payto|pay_to/.test(text)) return 'RECIPIENT_REJECTED';
  if (/amount|price/.test(text)) return 'AMOUNT_REJECTED';
  if (/payload|encoding|base64|malformed/.test(text)) return 'PAYLOAD_REJECTED';
  if (/facilitator/.test(text)) return 'FACILITATOR_ERROR';
  if (/payment required/.test(text)) return 'PAYMENT_REQUIRED';
  return 'UNSPECIFIED';
}
