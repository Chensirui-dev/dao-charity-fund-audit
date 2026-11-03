import { useEffect, useState } from 'react';
import { readGovernanceParamsOnchain, type GovernanceParams } from '../contracts/chainAdapter';
import { IS_ONCHAIN } from '../contracts/config';

/**
 * 治理参数（法定人数、执行时间锁）在合约部署后基本不变，
 * 但会被多个提案卡同时用到，所以这里做一层模块级缓存，避免一次渲染打十几个 RPC。
 */
let cached: GovernanceParams | null = null;
let inflight: Promise<GovernanceParams> | null = null;

function load(): Promise<GovernanceParams> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = readGovernanceParamsOnchain()
      .then((value) => {
        cached = value;
        return value;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useGovernanceParams(): GovernanceParams | null {
  const [params, setParams] = useState<GovernanceParams | null>(cached);

  useEffect(() => {
    if (!IS_ONCHAIN) return;
    let cancelled = false;
    load()
      .then((value) => {
        if (!cancelled) setParams(value);
      })
      .catch(() => {
        if (!cancelled) setParams(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return params;
}

/** 每秒刷新一次的当前时间戳，用于在卡片上跑时间锁倒计时 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
