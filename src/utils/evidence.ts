/**
 * 用款材料哈希工具。
 *
 * 材料原件（发票、签收单、验收报告）不上链——体积大、含隐私，也没必要。
 * 上链的是文件的 SHA-256 摘要：32 字节，正好对应合约里的 bytes32。
 * 之后任何人拿到原件都能重算一次摘要，与链上记录比对，改一个字节都对不上。
 */

/** 把 ArrayBuffer 转成 0x 开头的 64 位十六进制字符串 */
function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '0x';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** 计算文件的 SHA-256 摘要（bytes32 十六进制） */
export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return toHex(digest);
}

/** 计算一段文本的 SHA-256 摘要，用于没有附件、只填说明的场景 */
export async function hashText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

/** 把哈希截断成便于展示的形式 */
export function shortHash(hash: string, head = 10, tail = 6): string {
  if (hash.length <= head + tail + 3) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}
