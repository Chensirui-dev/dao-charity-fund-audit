import { CHAIN_ID, CHAIN_NAME, EXPLORER_URL, RPC_URL } from './config';

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export { CHAIN_ID, CHAIN_NAME, EXPLORER_URL, RPC_URL };

export function getEthereum(): Eip1193Provider | undefined {
  return window.ethereum;
}

export function parseChainId(value: unknown): number {
  return typeof value === 'string' ? Number.parseInt(value, 16) : Number(value);
}

export function chainIdHex(chainId: number = CHAIN_ID): string {
  return `0x${chainId.toString(16)}`;
}

export function isCorrectChain(chainId: number | null): boolean {
  return chainId === CHAIN_ID;
}

/**
 * 切换到系统约定的 Sepolia 网络。
 * MetaMask 已内置 Sepolia，正常情况下 wallet_switchEthereumChain 会直接成功；
 * 仅在钱包未内置该网络（错误码 4902）时，才回退到自动添加网络。
 */
export async function switchToChain(provider: Eip1193Provider): Promise<number> {
  const hex = chainIdHex();

  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: hex,
        chainName: CHAIN_NAME,
        nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: [RPC_URL],
        blockExplorerUrls: [EXPLORER_URL],
      }],
    });
  }

  return CHAIN_ID;
}
