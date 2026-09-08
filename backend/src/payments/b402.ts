import { createPrivateKey, sign } from 'node:crypto';

/** Merchant/facilitator transport boundary: chỉ tạo request, không gửi tiền.
 * Serialize MỘT lần; body gửi đi phải đúng từng byte với body được ký.
 * Endpoint/schema V2 lấy từ docs, credentials do Binance cấp khi onboarding. */
export function signedB402Request(
  body: unknown,
  credentials: { clientId: string; accessToken: string; privateKeyBase64: string },
  timestamp = Date.now(),
) {
  const json = JSON.stringify(body);
  const key = createPrivateKey({
    key: Buffer.from(credentials.privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const signature = sign('RSA-SHA256', Buffer.from(json + String(timestamp), 'utf8'), key).toString(
    'base64',
  );
  return {
    body: json,
    headers: {
      'Content-Type': 'application/json',
      'X-Tesla-ClientId': credentials.clientId,
      'X-Tesla-SignAccessToken': credentials.accessToken,
      'X-Tesla-Timestamp': String(timestamp),
      'X-Tesla-Signature': signature,
    },
  };
}
export interface B402Facilitator {
  supported(): Promise<unknown>;
  verify(paymentPayload: unknown, paymentRequirements: unknown): Promise<unknown>;
  settle(paymentPayload: unknown, paymentRequirements: unknown): Promise<unknown>;
}
