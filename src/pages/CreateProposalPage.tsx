import { ArrowLeft, FileText, LockKeyhole, ShieldCheck, Wallet } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Address } from '../components/ui/Address';
import { useApp } from '../context/AppContext';
import {
  campaignKeyOf,
  readAllFundRequestsOnchain,
  readCampaignBalanceOnchain,
  readCampaignRecipientOnchain,
  readGovernanceParamsOnchain,
  type ChainFundRequest,
  type GovernanceParams,
} from '../contracts/chainAdapter';
import { IS_ONCHAIN } from '../contracts/config';
import type { ProposalType } from '../types';
import { formatEth, proposalTypeLabel, shortAddress, weiToEth } from '../utils/format';
import { shortHash } from '../utils/evidence';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function CreateProposalPage() {
  const { campaigns, connectedWallet, createProposal, permissions, currentRole, roleProfiles } = useApp();
  const navigate = useNavigate();
  const [type, setType] = useState<ProposalType>('FUND_RELEASE');
  const [targetId, setTargetId] = useState('');
  const [title, setTitle] = useState('执行下一阶段公益资金拨付');
  const [description, setDescription] = useState('根据受助方提交的用款申请与材料摘要，申请 DAO 批准本阶段资金拨付。');
  const [amount, setAmount] = useState('0.005');
  const [balance, setBalance] = useState<string | null>(null);
  const [chainRecipient, setChainRecipient] = useState<string>('');
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [govParams, setGovParams] = useState<GovernanceParams | null>(null);
  const [fundRequests, setFundRequests] = useState<ChainFundRequest[]>([]);
  const [requestId, setRequestId] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);

  const isFundRelease = type === 'FUND_RELEASE';
  // 链上模式下只列真正上过链的项目：种子项目在金库里没有立项记录，选它必然被合约拒绝
  const selectableCampaigns = useMemo(
    () => (IS_ONCHAIN ? campaigns.filter((item) => item.onchainId) : campaigns),
    [campaigns],
  );
  const campaign = useMemo(() => campaigns.find((item) => item.id === targetId), [campaigns, targetId]);

  // 链上项目是异步同步进来的，首次渲染时列表可能还是空的，这里补一次默认选中
  useEffect(() => {
    if (targetId && selectableCampaigns.some((item) => item.id === targetId)) return;
    const preferred = selectableCampaigns[0];
    if (preferred) setTargetId(preferred.id);
  }, [selectableCampaigns, targetId]);

  // 收款方只做展示，且只认链上读数：
  // 链上真读到 address 才算「已登记」；种子项目在链上没有立项记录，不能拿来当链上地址用。
  const recipientRegistered = Boolean(chainRecipient) && chainRecipient !== ZERO_ADDRESS;
  const lockedRecipient = IS_ONCHAIN ? chainRecipient : (campaign?.recipientAddress ?? '');
  const recipientUnknown = IS_ONCHAIN && recipientLoading === false && !recipientRegistered;

  // 读链上可拨付余额与登记收款方，避免提交一个必然被合约拒绝的提案
  useEffect(() => {
    if (!IS_ONCHAIN || !isFundRelease || !campaign) {
      setBalance(null);
      setChainRecipient('');
      setRecipientLoading(false);
      return;
    }
    let cancelled = false;
    setBalance(null);
    setChainRecipient('');
    setRecipientLoading(true);
    const key = campaignKeyOf(campaign);
    readCampaignBalanceOnchain(key)
      .then((value) => {
        if (!cancelled) setBalance(value);
      })
      .catch(() => {
        if (!cancelled) setBalance(null);
      });
    readCampaignRecipientOnchain(key)
      .then((value) => {
        if (cancelled) return;
        setChainRecipient(value);
        setRecipientLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setChainRecipient('');
        setRecipientLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campaign, isFundRelease]);

  /**
   * 读该项目的待表决用款申请。
   *
   * 这一步是「先申请后拨款」的关键：下拉里只有受助方已经提交、材料摘要已上链、
   * 且还没被拨付过的申请单。没有可选申请时，页面直接拦住提交，
   * 因为合约侧的 createFundReleaseProposal 只接受申请单号，凭空写个金额根本没有入口。
   */
  useEffect(() => {
    if (!IS_ONCHAIN || !isFundRelease || !campaign) {
      setFundRequests([]);
      setRequestId('');
      return;
    }
    let cancelled = false;
    const key = campaignKeyOf(campaign);
    readAllFundRequestsOnchain()
      .then((list) => {
        if (cancelled) return;
        const matched = list.filter(
          (item) => item.statusCode === 0 && item.campaignIdHex.toLowerCase() === key.toLowerCase(),
        );
        setFundRequests(matched);
        setRequestId(matched[0]?.requestId ?? '');
      })
      .catch(() => {
        if (cancelled) return;
        setFundRequests([]);
        setRequestId('');
      });
    return () => {
      cancelled = true;
    };
  }, [campaign, isFundRelease]);

  // 治理参数：法定人数与执行时间锁，写在页面上比藏在合约里更有说服力
  useEffect(() => {
    if (!IS_ONCHAIN) return;
    let cancelled = false;
    readGovernanceParamsOnchain()
      .then((value) => {
        if (!cancelled) setGovParams(value);
      })
      .catch(() => {
        if (!cancelled) setGovParams(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedRequest = useMemo(
    () => fundRequests.find((item) => item.requestId === requestId) ?? null,
    [fundRequests, requestId],
  );

  // 金额不再由提案人填写：链上以申请单为准，这里只是同步展示
  useEffect(() => {
    if (isFundRelease && selectedRequest) {
      setAmount(String(weiToEth(selectedRequest.amountWei)));
    }
  }, [isFundRelease, selectedRequest]);

  const balanceEth = balance ? weiToEth(balance) : 0;
  const insufficient = isFundRelease && balance !== null && Number(amount || 0) > balanceEth;
  const missingRequest = isFundRelease && IS_ONCHAIN && !selectedRequest;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!permissions.canCreateProposal) return;
    if (isFundRelease && !selectedRequest) return;
    setLoading(true);
    await createProposal({
      type,
      targetId,
      title,
      description,
      amountEth: isFundRelease ? Number(amount) : undefined,
      requestId: isFundRelease ? selectedRequest?.requestId : undefined,
      evidenceHash: isFundRelease ? selectedRequest?.evidenceHash : undefined,
    });
    setLoading(false);
    navigate('/governance');
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <form className="glass-card space-y-5 rounded-xl p-6" onSubmit={submit}>
        <Link to="/governance" className="inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-gold">
          <ArrowLeft className="h-4 w-4" /> 返回治理
        </Link>
        <div>
          <p className="text-sm text-zinc-500">链上治理入口</p>
          <h1 className="mt-2 text-3xl font-bold gold-text">创建提案</h1>
        </div>
        {!permissions.canCreateProposal ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            当前角色：{roleProfiles[currentRole].label}，无创建提案权限。请切换为 DAO 成员演示该流程。
          </div>
        ) : null}
        <label className="block">
          <span className="text-sm text-zinc-500">提案类型</span>
          <select className="mt-2 w-full rounded-xl border border-line bg-black/30 p-3 outline-none focus:border-gold/60" value={type} onChange={(event) => setType(event.target.value as ProposalType)}>
            <option value="FUND_RELEASE">资金拨付</option>
            <option value="CAMPAIGN_APPROVAL">项目上架</option>
            <option value="AUDIT_RULE_CHANGE">审计规则</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-zinc-500">关联项目</span>
          <select className="mt-2 w-full rounded-xl border border-line bg-black/30 p-3 outline-none focus:border-gold/60" value={targetId} onChange={(event) => setTargetId(event.target.value)}>
            {!isFundRelease ? <option value="global">全局规则</option> : null}
            {selectableCampaigns.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>

        {isFundRelease ? (
          <div className="space-y-4 rounded-xl border border-line-gold bg-gold/5 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-2 text-gold-light"><FileText className="h-4 w-4" /> 用款申请单</span>
              <span className="text-xs text-zinc-500">
                链上可拨付余额：
                <span className="ml-1 font-mono text-zinc-300">{balance === null ? '读取中…' : formatEth(balance, 6)}</span>
              </span>
            </div>

            {!IS_ONCHAIN ? (
              <div className="rounded-xl border border-line bg-black/30 p-3 text-xs text-zinc-500">
                演示模式下没有链上申请单，金额可直接填写。
              </div>
            ) : null}

            {IS_ONCHAIN && fundRequests.length === 0 ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3 text-xs leading-relaxed text-amber-200">
                该项目还没有待表决的用款申请。拨付只能由受助方已提交的申请发起——
                请先在项目详情页用受助方钱包提交申请（附材料），再回到这里发起提案。
              </div>
            ) : null}

            {IS_ONCHAIN && fundRequests.length > 0 ? (
              <select
                className="w-full rounded-xl border border-line bg-black/30 p-3 font-mono text-sm outline-none focus:border-gold/60"
                value={String(requestId)}
                onChange={(event) => setRequestId(Number(event.target.value))}
              >
                {fundRequests.map((item) => (
                  <option key={item.requestId} value={item.requestId}>
                    #{item.requestId} · {formatEth(item.amountWei, 6)} · 材料 {shortHash(item.evidenceHash, 8, 4)}
                  </option>
                ))}
              </select>
            ) : null}

            <div className="flex items-center rounded-xl border border-line bg-black/30 px-4">
              <input
                className="w-full bg-transparent py-3 font-mono text-2xl text-gold-light outline-none"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.005"
                readOnly={IS_ONCHAIN && !!selectedRequest}
              />
              <span className="font-mono text-zinc-500">ETH</span>
            </div>
            {IS_ONCHAIN && selectedRequest ? (
              <p className="text-xs text-zinc-500">
                金额取自申请单，提案人不可修改。材料摘要
                <span className="ml-1 font-mono text-zinc-300">{shortHash(selectedRequest.evidenceHash)}</span>
                ，提交时会与链上锚定值逐字节比对。
              </p>
            ) : null}

            {/* 收款方只读：这是导师那句「地址不是管理员选的吗」的正面回答 */}
            <div className={`rounded-xl border p-3 ${recipientUnknown ? 'border-amber-500/30 bg-amber-500/[0.06]' : 'border-emerald-500/25 bg-emerald-500/[0.06]'}`}>
              <div className={`flex items-center gap-2 text-sm ${recipientUnknown ? 'text-amber-300' : 'text-emerald-300'}`}>
                <ShieldCheck className="h-4 w-4" />
                {recipientUnknown ? '该项目未在链上立项，无法发起拨款' : '收款方由立项记录锁定，提案人不可指定'}
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-xs text-zinc-500">链上登记的受助方</span>
                <span className="truncate font-mono text-xs text-zinc-200">
                  {recipientLoading ? '读取中…' : recipientRegistered ? <Address value={lockedRecipient} /> : '—'}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                {recipientUnknown
                  ? '这个项目只存在于本地示例数据里，链上金库没有它的收款方记录。要发起拨款，先由项目方提交上架提案、投票通过并执行。'
                  : '立项提案通过时，受助方地址就写进了金库的 CampaignAccount，之后每个项目只能登记一次。拨款提案的合约参数只有「申请单号 + 材料摘要」，执行时由金库读回收款方转账——即使有人改了表单里的地址，链上也不认。'}
              </p>
            </div>

            {insufficient ? (
              <p className="text-xs text-red-300">金额超过可拨付余额，合约会拒绝该提案。请先由捐赠者向本项目捐款。</p>
            ) : null}
            {balance === '0' ? (
              <p className="text-xs text-amber-300">该项目链上余额为 0，请先用捐赠者账户捐款，再申请拨付。</p>
            ) : null}
          </div>
        ) : null}

        <input className="w-full rounded-xl border border-line bg-black/30 p-3 outline-none focus:border-gold/60" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="标题" />
        <textarea className="min-h-40 w-full rounded-xl border border-line bg-black/30 p-3 outline-none focus:border-gold/60" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="描述" />
        <Button
          loading={loading}
          className="w-full"
          disabled={!permissions.canCreateProposal || !title || !description || insufficient || recipientUnknown || missingRequest}
          icon={!permissions.canCreateProposal ? <LockKeyhole className="h-4 w-4" /> : undefined}
        >
          提交提案
        </Button>
      </form>
      <aside className="glass-card h-fit rounded-xl p-6">
        <div className="text-sm text-zinc-500">实时预览</div>
        <div className="mt-4 rounded-xl border border-line bg-black/30 p-5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xl text-gold-light">#NEW</span>
            <Badge kind={type}>{proposalTypeLabel(type)}</Badge>
          </div>
          <h2 className="mt-4 text-xl font-semibold text-zinc-100">{title}</h2>
          <p className="mt-3 text-sm text-zinc-500">{description}</p>
          {isFundRelease ? (
            <div className="mt-4 space-y-2 rounded-lg border border-line bg-black/30 p-3 text-sm">
              <div className="flex justify-between gap-4"><span className="shrink-0 text-zinc-500">拨付金额</span><span className="font-mono text-gold-light">{amount || '0'} ETH</span></div>
              <div className="flex justify-between gap-4"><span className="shrink-0 text-zinc-500">申请单号</span><span className="font-mono text-zinc-300">{selectedRequest ? `#${selectedRequest.requestId}` : '未选择'}</span></div>
              <div className="flex items-center justify-between gap-4"><span className="shrink-0 text-zinc-500">受助方</span><span className="truncate font-mono text-xs text-zinc-300">{recipientLoading ? '读取中…' : lockedRecipient ? shortAddress(lockedRecipient, 8, 6) : '未登记'}</span></div>
              <div className="flex items-center justify-between gap-4"><span className="shrink-0 text-zinc-500">地址来源</span><span className={`text-xs ${recipientUnknown ? 'text-amber-300' : 'text-emerald-300'}`}>{recipientLoading ? '—' : recipientUnknown ? '项目未上链' : '立项记录（只读）'}</span></div>
            </div>
          ) : null}
          <div className="mt-5 text-sm text-zinc-500">发起人 <Address value={connectedWallet} /></div>
        </div>

        {/* 治理约束前置：让评审一眼看到「不是一个人说了算」 */}
        <div className="mt-5 rounded-xl border border-line bg-black/20 p-4">
          <div className="text-xs font-semibold tracking-wide text-zinc-400">提案通过需要满足</div>
          <ul className="mt-3 space-y-2 text-xs text-zinc-500">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-gold" />
              <span>
                投票期内赞成票多于反对票
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-gold" />
              <span>
                参与票权达到总票权的{' '}
                <span className="font-mono text-zinc-300">
                  {govParams ? `${govParams.quorumBps / 100}%` : '25%'}
                </span>
                {govParams ? `（${govParams.totalVotingPower} 票中至少 ${Math.ceil((govParams.totalVotingPower * govParams.quorumBps) / 10000)} 票参与）` : ''}
                ，否则提案自动失效
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-gold" />
              <span>
                判定通过后再等{' '}
                <span className="font-mono text-zinc-300">{govParams ? `${govParams.timelockSeconds} 秒` : '时间锁'}</span>{' '}
                才能执行，留出异议窗口
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-gold" />
              <span>收款方本人对涉及自己项目的提案不参与表决（利益冲突回避）</span>
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
