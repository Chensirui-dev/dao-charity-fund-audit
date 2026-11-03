/**
 * 部署前自检：检查 chain/.env 是否填对、能不能连上 Sepolia、余额够不够。
 * 使用方式：cd chain && npm run check
 *
 * 这个脚本只做检查，不会发任何交易，不会花钱，可以放心反复运行。
 */
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const ENV_FILE = path.resolve(__dirname, '..', '.env');
const ENV_EXAMPLE = path.resolve(__dirname, '..', '.env.example');
const SEPOLIA_CHAIN_ID = 11155111;
const DEFAULT_SEPOLIA_RPC = 'https://sepolia.gateway.tenderly.co';
const RPC_URL = process.env.SEPOLIA_RPC_URL || DEFAULT_SEPOLIA_RPC;

/**
 * 备选公共 RPC。国内网络对多数境外节点直连不稳定（实测 publicnode / drpc / 1rpc
 * 均连不上，tenderly 网关可用），因此默认用 tenderly；连不上时会自动逐个探测，
 * 把当前网络真正能用的节点报给你。
 */
const RPC_CANDIDATES = [
  'https://sepolia.gateway.tenderly.co',
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://rpc.sepolia.org',
  'https://sepolia.drpc.org',
  'https://1rpc.io/sepolia',
];

const OK = '[通过]';
const BAD = '[不通过]';
const WARN = '[注意]';

const problems = [];

function line(icon, title, detail) {
  console.log(`${icon} ${title}`);
  if (detail) console.log(`    ${detail}`);
}

async function main() {
  console.log('===== 部署前自检 =====');
  console.log('（这个脚本只检查，不发交易，不花钱）\n');

  // 1. 配置文件是否存在
  if (!fs.existsSync(ENV_FILE)) {
    line(BAD, '找不到配置文件 chain/.env', `这个文件还不存在。请把 ${ENV_EXAMPLE} 复制一份，改名为 .env，然后填写里面的内容。`);
    problems.push('缺少 chain/.env 文件');
    return finish();
  }
  line(OK, '配置文件 chain/.env 存在');

  // 2. 部署私钥
  const rawKey = (process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  let wallet = null;
  if (!rawKey || rawKey === '0x') {
    line(BAD, 'DEPLOYER_PRIVATE_KEY 还没填', '这一行现在是空的。你需要把钱包私钥粘贴到等号后面（不要发给任何人）。');
    problems.push('部署私钥还没填');
  } else {
    try {
      wallet = new ethers.Wallet(rawKey);
      line(OK, 'DEPLOYER_PRIVATE_KEY 格式正确', `它对应的钱包地址是 ${wallet.address}`);
    } catch {
      line(BAD, 'DEPLOYER_PRIVATE_KEY 格式不对', '私钥必须是以 0x 开头的 66 个字符（0x 后面 64 位）。请回到 MetaMask 重新复制完整私钥，注意别漏字符、别带空格。');
      problems.push('部署私钥格式错误');
    }
  }

  // 3. DAO 成员地址
  const membersRaw = (process.env.DAO_MEMBERS || '').trim();
  const members = membersRaw.split(',').map((item) => item.trim()).filter(Boolean);
  const badMembers = members.filter((item) => !ethers.isAddress(item));
  if (members.length === 0) {
    line(WARN, 'DAO_MEMBERS 是空的', '这样部署时只会给部署账户投票权，演示时其他角色投票会失败。建议把 4 个演示账户地址都填上，用英文逗号隔开。');
  } else if (badMembers.length > 0) {
    line(BAD, `DAO_MEMBERS 里有 ${badMembers.length} 个地址格式不对`, `有问题的：${badMembers.join('、')}\n    地址必须是 0x 开头、一共 42 个字符。多个地址之间用英文逗号隔开。`);
    problems.push('DAO 成员地址格式错误');
  } else {
    line(OK, `DAO_MEMBERS 填了 ${members.length} 个地址，格式都正确`);
  }

  // 4. 网络连通性
  const provider = new ethers.JsonRpcProvider(RPC_URL, SEPOLIA_CHAIN_ID);
  try {
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== SEPOLIA_CHAIN_ID) {
      line(BAD, `连上的网络编号是 ${net.chainId}，不是 Sepolia 的 ${SEPOLIA_CHAIN_ID}`, 'SEPOLIA_RPC_URL 这一行可能填错了。');
      problems.push('连接的网络不是 Sepolia');
    } else {
      line(OK, '能正常连上 Sepolia 网络', `使用的 RPC：${RPC_URL}`);
    }
  } catch {
    line(BAD, '连不上 Sepolia 网络', `当前用的节点访问不了：${RPC_URL}\n    正在自动测试其他公共节点，请稍等……`);
    const usable = [];
    for (const candidate of RPC_CANDIDATES) {
      try {
        const probe = new ethers.JsonRpcProvider(candidate, SEPOLIA_CHAIN_ID);
        const net = await probe.getNetwork();
        if (Number(net.chainId) === SEPOLIA_CHAIN_ID) usable.push(candidate);
      } catch {
        /* 这个节点不可用，继续试下一个 */
      }
    }
    if (usable.length > 0) {
      console.log('    你的网络能连上这些节点：');
      usable.forEach((item) => console.log(`      ${item}`));
      console.log(`    请把 chain/.env 里 SEPOLIA_RPC_URL 改成其中第一个，保存后重跑 npm run check。`);
    } else {
      console.log('    所有公共节点都连不上，基本可以确定是网络环境问题。');
      console.log('    可以试试开启代理，或者换一个网络再试。');
    }
    problems.push('连不上 Sepolia 网络');
    return finish();
  }

  // 5. 部署账户余额
  if (!wallet) return finish();
  try {
    const balance = await provider.getBalance(wallet.address);
    const eth = Number(ethers.formatEther(balance));
    if (eth === 0) {
      line(BAD, '部署账户余额是 0，还不能部署', `去水龙头领免费测试币，接收地址填这个：\n    ${wallet.address}`);
      problems.push('部署账户没有测试币');
    } else if (eth < 0.005) {
      line(WARN, `部署账户只有 ${eth.toFixed(6)} ETH，建议多领一点`, 'Sepolia 平时 Gas 极低，这点币通常够部署；但若正好赶上网络拥堵，可能会不够。');
    } else {
      line(OK, `部署账户余额 ${eth.toFixed(6)} ETH，足够部署`);
    }
  } catch {
    line(WARN, '余额查询失败', '网络不太稳定，可以稍后再跑一次这个检查。');
  }

  // 6. 演示账户是不是普通钱包、余额够不够
  if (members.length > 0) {
    const notWallet = [];
    const empty = [];

    for (const member of members) {
      try {
        const code = await provider.getCode(member);
        if (code && code !== '0x') {
          const hex = code.slice(2);
          if (hex.startsWith('ef0100') && hex.length === 46) {
            notWallet.push(`${member}\n      这个地址被设置了 EIP-7702 委托，执行权已交给合约 0x${hex.slice(6)}\n      转进去的 ETH 会被立刻转走，无法作为演示账户使用`);
          } else {
            notWallet.push(`${member}\n      这个地址上有 ${hex.length / 2} 字节合约代码，不是普通钱包`);
          }
          continue;
        }
        if ((await provider.getBalance(member)) === 0n) empty.push(member);
      } catch {
        /* 单个地址查不到不影响整体检查 */
      }
    }

    if (notWallet.length > 0) {
      line(
        BAD,
        `有 ${notWallet.length} 个演示账户不是普通钱包`,
        `${notWallet.join('\n')}\n    原因多半是用了网上流传的「测试私钥」建号 —— 那些私钥是公开的，已经被人装上自动扫币的委托，\n    往里面转测试币会被瞬间转走，演示到一半就会因为没 Gas 而失败。\n    解决：在 MetaMask 里重新「添加账户」建一个新号，把新地址换进 DAO_MEMBERS，再跑一次 npm run check。`,
      );
      problems.push('有演示账户不是普通钱包（地址上有合约代码，测试币会被扫走）');
    } else {
      line(OK, `${members.length} 个演示账户都是普通钱包，可以正常收付`);
    }

    if (empty.length > 0) {
      line(WARN, `有 ${empty.length} 个演示账户余额是 0`, `现场这些角色发交易会因为没 Gas 而当场失败：\n    ${empty.join('\n    ')}\n    如果还没分币，执行 npm run fund 即可。`);
    } else if (notWallet.length === 0) {
      line(OK, `${members.length} 个演示账户都有余额，可以正常发交易`);
    }
  }

  // 7. 当前 Gas 价格（估算部署花费，让你心里有数）
  try {
    const fee = await provider.getFeeData();
    const gwei = fee.gasPrice ? Number(ethers.formatUnits(fee.gasPrice, 'gwei')) : 0;
    const deployCost = Number(ethers.formatEther((fee.gasPrice ?? 0n) * 3000000n));
    line(OK, `当前 Gas 价格约 ${gwei.toFixed(4)} gwei`, `按此价格，部署三个合约预计花费约 ${deployCost.toFixed(8)} ETH`);
  } catch {
    /* 查不到不影响自检结果 */
  }

  finish();
}

function finish() {
  console.log('\n===== 结论 =====');
  if (problems.length === 0) {
    console.log('全部检查通过，下一步执行：npm run deploy:sepolia');
  } else {
    console.log(`发现 ${problems.length} 个问题，请先解决：`);
    problems.forEach((item, index) => console.log(`  ${index + 1}. ${item}`));
    console.log('\n（上面 [不通过] 的行都有说明，照着改完再跑一次 npm run check）');
  }
}

main().catch((error) => {
  console.error('\n自检过程出错：', error.message || error);
  process.exitCode = 1;
});
