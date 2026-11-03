/**
 * 统一的链上连接工具。
 *
 * 为什么单独抽出来（踩过的两个坑）：
 *
 * 1. tenderly 这类公共网关对「JSON-RPC 批量请求」支持不好，而 ethers 默认会把并发请求
 *    打包成一个数组发出去（batchMaxCount 默认 100），网关不认就一路挂到超时，
 *    报 `request timeout`。设 batchMaxCount: 1 关掉批量，问题即消失。
 *
 * 2. 免费公共网关都有配额限流。部署合约时 ethers 会连续发起十几次 RPC 调用
 *    （估算 Gas、取费率、广播、轮询回执），很容易撞上 429 `rate limit exceeded`。
 *    解决办法是用 FallbackProvider 挂多个节点：读操作自动挑可用的那个，
 *    广播交易时同时发往所有节点——只要有一个成功就成，被限流的那个不会拖垮流程。
 *
 * 注意：所有节点都必须声明 staticNetwork，否则 FallbackProvider 启动时会去探测网络，
 * 碰上有节点不可达会卡住初始化。
 */
const { ethers } = require('ethers');

const SEPOLIA_CHAIN_ID = 11155111;
const DEFAULT_SEPOLIA_RPC = 'https://sepolia.gateway.tenderly.co';

/**
 * 实测在当前网络环境下可直连的公共 RPC（其余多为超时 / 404 / 要求 API Key）。
 *
 * 只保留 tenderly 一个：它实测最健康（普通查询连发 20 次、estimateGas 连发 10 次均无异常）。
 * api.zan.top 试过但不合格——不对外开放 eth_estimateGas，且限流返回的是 HTTP 200 + 自定义
 * 错误体，ethers 的多节点聚合器无法识别，会把整个流程搞崩。所以不再作为备用节点。
 */
const LIVE_RPC_CANDIDATES = [
  'https://sepolia.gateway.tenderly.co',
];

/** 供自检脚本逐个探测用的候选清单（含历史可用节点） */
const RPC_CANDIDATES = [
  ...LIVE_RPC_CANDIDATES,
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://sepolia.drpc.org',
  'https://1rpc.io/sepolia',
];

/** 单个节点：关掉批量请求，声明静态网络避免多余探测 */
function buildProvider(url, chainId = SEPOLIA_CHAIN_ID) {
  return new ethers.JsonRpcProvider(url, chainId, {
    staticNetwork: true,
    batchMaxCount: 1,
  });
}

/**
 * 创建连接器。
 * - 传入 url：只用这一个节点（调试时用）
 * - 不传：用 .env 里的地址 + 内置备用节点，组成自动切换池
 */
function createProvider(url, chainId = SEPOLIA_CHAIN_ID) {
  const envUrl = (url || process.env.SEPOLIA_RPC_URL || '').trim();
  const urls = [];
  if (envUrl) urls.push(envUrl.replace(/\/+$/, ''));
  for (const candidate of LIVE_RPC_CANDIDATES) {
    if (!urls.includes(candidate)) urls.push(candidate);
  }

  const providers = urls.map((item) => buildProvider(item, chainId));
  if (providers.length === 1) return providers[0];

  return new ethers.FallbackProvider(
    providers.map((provider) => ({
      provider,
      priority: 1,
      weight: 1,
      stallTimeout: 5000,
    })),
    chainId,
    { quorum: 1 },
  );
}

/** 简单节流：公共网关挨太近会被限流，发交易之间喘口气 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 带重试的调用包装。
 * 只对「可安全重复执行」的操作使用：查询、以及广播同一份已签名的交易。
 */
async function withRetry(label, fn, attempts = 5, delayMs = 3000) {
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts) {
        const reason = error.shortMessage || error.message || String(error);
        console.log(`    ${label} 第 ${i} 次失败：${reason}`);
        console.log(`    ${delayMs / 1000} 秒后重试（第 ${i + 1}/${attempts} 次）……`);
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

module.exports = {
  createProvider,
  withRetry,
  sleep,
  SEPOLIA_CHAIN_ID,
  DEFAULT_SEPOLIA_RPC,
  RPC_CANDIDATES,
  LIVE_RPC_CANDIDATES,
};
