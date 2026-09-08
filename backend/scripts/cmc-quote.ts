import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Lấy báo giá ETH trực tiếp từ CoinMarketCap, không dùng ví và không trả tiền.
 * id=1027 là Ethereum theo tài liệu CMC. Chỉ GET tới địa chỉ cố định;
 * không tự theo redirect, không gửi API key/cookie/chữ ký thanh toán.
 * Giữ nguyên payment requirements để Binance preview đúng báo giá merchant.
 */
const url = 'https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest?id=1027';
const maxBytes = 16_000;

try {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'error',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  console.log(`CoinMarketCap HTTP ${response.status}`);
  if (response.status !== 402) {
    await response.body?.cancel();
    throw new Error('EXPECTED_HTTP_402: Chua nhan duoc bao gia thanh toan.');
  }

  // x402 v2 dùng header base64; hỗ trợ JSON body nếu merchant không có header.
  const header = response.headers.get('payment-required');
  let text: string;
  if (header) {
    await response.body?.cancel();
    if (header.length > 24_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(header))
      throw new Error('INVALID_PAYMENT_REQUIRED_HEADER');
    text = Buffer.from(header, 'base64').toString('utf8');
  } else {
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!response.body) throw new Error('EMPTY_PAYMENT_REQUIREMENTS');
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new Error('REQUIREMENTS_TOO_LARGE');
      chunks.push(chunk);
    }
    text = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(text) > maxBytes) throw new Error('REQUIREMENTS_TOO_LARGE');
  const requirements = JSON.parse(text);
  if (
    requirements?.x402Version !== 2 ||
    !Array.isArray(requirements.accepts) ||
    requirements.accepts.length === 0 ||
    requirements.accepts.length > 50
  )
    throw new Error('INVALID_X402_V2_REQUIREMENTS');

  // CMC có thể trả resource.url tương đối, không kèm query. Chỉ kiểm tra,
  // không sửa URL trong payload mà merchant đã phát hành.
  if (typeof requirements.resource?.url !== 'string') throw new Error('MISSING_RESOURCE_URL');
  const resource = new URL(requirements.resource.url, url);
  const requested = new URL(url);
  if (
    resource.origin !== requested.origin ||
    resource.pathname !== requested.pathname ||
    resource.username ||
    resource.password ||
    resource.hash ||
    (resource.search && resource.search !== requested.search)
  )
    throw new Error('UNEXPECTED_RESOURCE_URL');

  for (const option of requirements.accepts) {
    if (
      !option ||
      ['scheme', 'network', 'asset', 'amount', 'payTo'].some(
        (key) => typeof option[key] !== 'string' || option[key].length > 200,
      ) ||
      !/^\d+$/.test(option.amount)
    )
      throw new Error('INVALID_PAYMENT_OPTION');
  }
  const file = resolve('data', 'cmc-eth-requirements.json');
  await mkdir(resolve('data'), { recursive: true });
  await writeFile(file, text, 'utf8');
  console.log(
    JSON.stringify(
      {
        requestUrl: url,
        resourceUrl: requirements.resource.url,
        options: requirements.accepts.map((option: Record<string, unknown>) => ({
          scheme: option.scheme,
          network: option.network,
          asset: option.asset,
          atomicAmount: option.amount,
          payTo: option.payTo,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`Saved: ${file}`);
  console.log('Read-only. No payment signed or submitted.');
  console.log('Next: npm run wallet:preview -- .\\data\\cmc-eth-requirements.json');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'CMC_QUOTE_FAILED');
  console.error('Khong chay preview tu file cu neu lenh nay bi loi.');
  process.exitCode = 1;
}
