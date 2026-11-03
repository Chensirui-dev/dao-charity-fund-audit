/**
 * 链配置与模式开关。
 *
 * - CHAIN_MODE = 'sepolia'：交易真实发到 Sepolia，链上可留痕、可在区块浏览器查验。
 * - CHAIN_MODE = 'mock'   ：未配置合约地址时的降级模式，本地模拟确认，保证演示不中断。
 */

export type ChainMode = 'mock' | 'sepolia';

export interface ContractAddresses {
  donationVault: string;
  daoGovernor: string;
  auditRegistry: string;
}

function readEnv(key: string, fallback = ''): string {
  const value = import.meta.env[key as keyof ImportMetaEnv] as string | undefined;
  return (value ?? fallback).trim();
}

export const CHAIN_MODE: ChainMode = readEnv('VITE_CHAIN_MODE', 'mock') === 'sepolia' ? 'sepolia' : 'mock';

export const CHAIN_ID = Number(readEnv('VITE_CHAIN_ID', '11155111'));

export const CHAIN_NAME = readEnv('VITE_CHAIN_NAME', 'Sepolia');

/** 默认公共 RPC。实测国内网络连不上 publicnode / drpc / 1rpc，tenderly 网关可用 */
export const RPC_URL = readEnv('VITE_RPC_URL', 'https://sepolia.gateway.tenderly.co');

export const EXPLORER_URL = readEnv('VITE_EXPLORER_URL', 'https://sepolia.etherscan.io');

export const CONTRACT_ADDRESSES: ContractAddresses = {
  donationVault: readEnv('VITE_DONATION_VAULT_ADDRESS'),
  daoGovernor: readEnv('VITE_DAO_GOVERNOR_ADDRESS'),
  auditRegistry: readEnv('VITE_AUDIT_REGISTRY_ADDRESS'),
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function isAddressSet(address: string): boolean {
  return ADDRESS_PATTERN.test(address);
}

/**
 * 演示账户 → 界面角色 的自动对齐表。
 *
 * 只登记公开地址，不含任何私钥。配置后，钱包里切换账户时界面角色会自动跟着变，
 * 单窗口演示就不需要手动再切一次「演示角色」，也不会出现「角色是项目方、签名却是捐赠者」的穿帮。
 * 未配置时留空，行为与原来一致（完全手动）。
 */
export const DEMO_ACCOUNT_ROLES: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const pairs: Array<[string, string]> = [
    [readEnv('VITE_DEMO_DONOR'), 'DONOR'],
    [readEnv('VITE_DEMO_PROJECT_OWNER'), 'PROJECT_OWNER'],
    [readEnv('VITE_DEMO_DAO_MEMBER'), 'DAO_MEMBER'],
    [readEnv('VITE_DEMO_AUDITOR'), 'AUDITOR'],
  ];
  pairs.forEach(([address, role]) => {
    if (isAddressSet(address)) map[address.toLowerCase()] = role;
  });
  return map;
})();

/** 三个合约地址都配置齐全时，才允许走真实链交易 */
export const CONTRACTS_READY = Object.values(CONTRACT_ADDRESSES).every(isAddressSet);

/** 是否处于「真实链」运行状态 */
export const IS_ONCHAIN = CHAIN_MODE === 'sepolia' && CONTRACTS_READY;

export function explorerTxUrl(txHash: string): string {
  return `${EXPLORER_URL.replace(/\/$/, '')}/tx/${txHash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER_URL.replace(/\/$/, '')}/address/${address}`;
}
