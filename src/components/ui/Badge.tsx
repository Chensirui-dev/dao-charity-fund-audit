import type { AuditStatus, CampaignStatus, OperationType, ProposalStatus, ProposalType } from '../../types';
import { operationLabel, proposalTypeLabel, statusLabel } from '../../utils/format';

type BadgeKind = CampaignStatus | ProposalStatus | ProposalType | OperationType | AuditStatus;

export function Badge({ kind, children }: { kind: BadgeKind; children?: React.ReactNode }) {
  const palette: Record<string, string> = {
    ACTIVE: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300',
    PENDING: 'border-gold/60 bg-gold/10 text-gold-light',
    FUNDED: 'border-blue-500/60 bg-blue-500/10 text-blue-300',
    COMPLETED: 'border-zinc-500/60 bg-zinc-500/10 text-zinc-300',
    REJECTED: 'border-red-500/60 bg-red-500/10 text-red-300',
    PASSED: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300',
    EXECUTED: 'border-zinc-500/60 bg-zinc-500/10 text-zinc-300',
    FUND_RELEASE: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300',
    CAMPAIGN_APPROVAL: 'border-blue-500/60 bg-blue-500/10 text-blue-300',
    AUDIT_RULE_CHANGE: 'border-violet-500/60 bg-violet-500/10 text-violet-300',
    DEPOSIT: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300',
    WITHDRAWAL: 'border-gold/60 bg-gold/10 text-gold-light',
    GAS_FEE: 'border-blue-500/60 bg-blue-500/10 text-blue-300',
    REFUND: 'border-violet-500/60 bg-violet-500/10 text-violet-300',
    PROPOSAL_EXECUTION: 'border-zinc-500/60 bg-zinc-500/10 text-zinc-300',
    EVIDENCE: 'border-sky-500/60 bg-sky-500/10 text-sky-300',
    FREEZE: 'border-red-500/60 bg-red-500/10 text-red-300',
    CONFIRMED: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300',
    FLAGGED: 'border-red-500/60 bg-red-500/10 text-red-300',
  };

  const label =
    children ??
    (['ACTIVE', 'PENDING', 'FUNDED', 'COMPLETED', 'REJECTED'].includes(kind)
      ? statusLabel(kind as CampaignStatus)
      : ['FUND_RELEASE', 'CAMPAIGN_APPROVAL', 'AUDIT_RULE_CHANGE'].includes(kind)
        ? proposalTypeLabel(kind as ProposalType)
        : ['DEPOSIT', 'WITHDRAWAL', 'GAS_FEE', 'REFUND', 'PROPOSAL_EXECUTION', 'EVIDENCE', 'FREEZE'].includes(kind)
          ? operationLabel(kind as OperationType)
          : kind);

  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${palette[kind]}`}>{label}</span>;
}
