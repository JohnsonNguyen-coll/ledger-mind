/** Some signers return the authorization without the x402 V2 accepted wrapper.
 * Only restore that wrapper from the exact previewed offer. Never modify the
 * signature or authorization, and never infer a different recipient/amount.
 * This is envelope compatibility, not cryptographic signature verification.
 */
export function completeX402Envelope(header: string, accepted: Record<string, unknown>) {
  let body: Record<string, unknown>;
  try {
    if (header.length > 32000 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(header))
      return { header, diagnostic: 'UNRECOGNIZED_ENVELOPE' };
    body = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return { header, diagnostic: 'UNRECOGNIZED_ENVELOPE' };
  } catch { return { header, diagnostic: 'UNRECOGNIZED_ENVELOPE' }; }
  if (body.x402Version !== 2) return { header, diagnostic: 'NON_V2_ENVELOPE' };
  if (body.accepted !== undefined && body.accepted !== null)
    return { header, diagnostic: 'ACCEPTED_PRESENT' };
  const payload = body.payload as Record<string, unknown> | undefined;
  const auth = payload?.authorization as Record<string, unknown> | undefined;
  const address = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
  const timestamp = (v: unknown): v is string => typeof v === 'string' && /^\d{1,20}$/.test(v);
  if (accepted.scheme !== 'exact' || accepted.network !== 'eip155:8453' ||
      !address(accepted.asset) || !address(accepted.payTo) ||
      typeof accepted.maxTimeoutSeconds !== 'number' || !Number.isInteger(accepted.maxTimeoutSeconds) || accepted.maxTimeoutSeconds <= 0 ||
      !accepted.extra || typeof accepted.extra !== 'object' ||
      (accepted.extra as Record<string, unknown>).assetTransferMethod !== 'eip3009' ||
      !auth || !address(auth.from) || !address(auth.to) ||
      auth.to.toLowerCase() !== accepted.payTo.toLowerCase() || auth.value !== accepted.amount ||
      !timestamp(auth.validAfter) || !timestamp(auth.validBefore) ||
      BigInt(auth.validBefore) <= BigInt(auth.validAfter) ||
      typeof auth.nonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce) ||
      typeof payload?.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(payload.signature) ||
      (body.network !== undefined && body.network !== accepted.network) ||
      (body.scheme !== undefined && body.scheme !== accepted.scheme))
    throw new Error('X402_MISSING_ACCEPTED_CANNOT_REPAIR');
  const completed = Buffer.from(JSON.stringify({...body, accepted})).toString('base64');
  if (completed.length > 32000) throw new Error('X402_ENVELOPE_TOO_LARGE');
  return {header: completed, diagnostic: 'MISSING_ACCEPTED_RESTORED'};
}
