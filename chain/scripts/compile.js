/**
 * 使用 solc-js 编译 contracts/ 下的 Solidity 源码，输出 ABI 与字节码到 deployments/artifacts.json。
 * 不依赖 Hardhat 编译器下载，可在无外网编译器的环境下直接运行。
 */
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const CONTRACTS_DIR = path.resolve(__dirname, '..', 'contracts');
const ARTIFACT_DIR = path.resolve(__dirname, '..', 'deployments');
const ARTIFACT_FILE = path.join(ARTIFACT_DIR, 'artifacts.json');

function collectSources(dir) {
  const sources = {};
  for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith('.sol')) {
      sources[entry] = { content: fs.readFileSync(path.join(dir, entry), 'utf8') };
    }
  }
  return sources;
}

function main() {
  const sources = collectSources(CONTRACTS_DIR);
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (importPath) => ({ error: `未找到依赖：${importPath}` }),
    }),
  );

  const messages = output.errors || [];
  const errors = messages.filter((item) => item.severity === 'error');
  messages.forEach((item) => {
    const line = item.formattedMessage.trim();
    if (item.severity === 'error') console.error(line);
    else console.warn(line);
  });

  if (errors.length > 0) {
    console.error(`\n编译失败：共 ${errors.length} 个错误`);
    process.exitCode = 1;
    return;
  }

  const artifacts = {};
  for (const [fileName, contracts] of Object.entries(output.contracts || {})) {
    for (const [contractName, data] of Object.entries(contracts)) {
      artifacts[contractName] = {
        source: fileName,
        abi: data.abi,
        bytecode: `0x${data.evm.bytecode.object}`,
      };
    }
  }

  if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(ARTIFACT_FILE, JSON.stringify(artifacts, null, 2), 'utf8');

  console.log(`编译器版本：${solc.version()}`);
  console.log(`编译完成：${Object.keys(artifacts).join('、')}`);
  console.log(`产物已写入：${ARTIFACT_FILE}`);
}

main();
