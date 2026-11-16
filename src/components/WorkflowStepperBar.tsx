import React from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Loader2,
} from 'lucide-react';
import { NavPage, Project, WorkflowStageId } from '../types/studio';
import { StageStatusInfo, WORKFLOW_STAGES } from '../lib/workflowStages';

interface WorkflowStepperBarProps {
  stages: StageStatusInfo[];
  activeStage: WorkflowStageId;
  project: Project | null;
  savingNavigation: boolean;
  navigationError: string | null;
  onSelectStage: (stage: WorkflowStageId) => void;
  onBack: () => void;
  onContinue: () => void;
  onDismissError: () => void;
}

export function WorkflowStepperBar({
  stages,
  activeStage,
  project,
  savingNavigation,
  navigationError,
  onSelectStage,
  onBack,
  onContinue,
  onDismissError,
}: WorkflowStepperBarProps) {
  const activeIdx = WORKFLOW_STAGES.findIndex((s) => s.id === activeStage);
  const currentInfo = stages.find((s) => s.id === activeStage);
  const canGoBack = activeIdx > 0;
  const hasNext = activeIdx >= 0 && activeIdx < WORKFLOW_STAGES.length - 1;
  const nextDef = hasNext ? WORKFLOW_STAGES[activeIdx + 1] : null;

  return (
    <div className="border-b border-white/[0.08] bg-[#0D0D11] shrink-0">
      <div className="px-4 lg:px-6 py-2 flex items-center justify-between gap-3">
        {/* Step-by-Step Progress Indicator */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar min-w-0">
          {stages.map((st, idx) => {
            const isActive = st.id === activeStage;
            const statusColor =
              st.status === 'Completed'
                ? 'text-emerald-400'
                : st.status === 'Needs Attention'
                ? 'text-amber-400'
                : st.status === 'In Progress'
                ? 'text-violet-400'
                : 'text-zinc-500';

            return (
              <React.Fragment key={st.id}>
                <button
                  type="button"
                  onClick={() => onSelectStage(st.id)}
                  title={`${st.stepLabel}. ${st.title} — ${st.status}${
                    st.attentionReason ? `: ${st.attentionReason}` : ''
                  }`}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-violet-600/20 border-violet-500/60 text-white'
                      : 'bg-transparent border-transparent hover:bg-white/[0.04] hover:border-white/[0.08] text-zinc-300'
                  }`}
                >
                  {st.status === 'Completed' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : st.status === 'Needs Attention' ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  ) : st.status === 'In Progress' ? (
                    <Circle className="w-3.5 h-3.5 text-violet-400 fill-violet-500/30 shrink-0" />
                  ) : (
                    <span className="w-4 h-4 rounded-full bg-zinc-800 text-[10px] font-mono text-zinc-400 flex items-center justify-center shrink-0">
                      {st.stepLabel}
                    </span>
                  )}

                  <div className="flex flex-col leading-tight">
                    <span className="text-[11px] font-medium whitespace-nowrap">
                      {st.stepLabel}. {st.shortTitle}
                    </span>
                    <span className={`text-[9.5px] font-mono whitespace-nowrap ${statusColor}`}>
                      {st.status}
                    </span>
                  </div>
                </button>

                {idx < stages.length - 1 && (
                  <div className="w-3 h-px bg-white/[0.1] shrink-0" />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Guided Sequential Controls: Back & Continue */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onBack}
            disabled={!canGoBack || savingNavigation}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-800/90 hover:bg-zinc-700 disabled:opacity-35 text-xs font-medium text-zinc-200 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer border border-white/[0.06]"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>

          {hasNext && nextDef && (
            <button
              type="button"
              onClick={onContinue}
              disabled={!project || savingNavigation}
              className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer shadow-sm"
            >
              {savingNavigation ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : null}
              <span>Continue to {nextDef.shortTitle}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Attention or Validation Notice Banner */}
      {(navigationError || currentInfo?.status === 'Needs Attention') && (
        <div
          className={`px-4 lg:px-6 py-1.5 border-t flex items-center justify-between gap-3 text-xs ${
            navigationError
              ? 'bg-red-500/10 border-red-500/25 text-red-200'
              : 'bg-amber-500/10 border-amber-500/25 text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle
              className={`w-3.5 h-3.5 shrink-0 ${
                navigationError ? 'text-red-400' : 'text-amber-400'
              }`}
            />
            <span className="truncate">
              {navigationError || currentInfo?.attentionReason}
            </span>
          </div>
          {navigationError && (
            <button
              type="button"
              onClick={onDismissError}
              className="text-[11px] font-medium text-red-300 hover:text-white shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function isWorkflowStage(page: NavPage): page is WorkflowStageId {
  return WORKFLOW_STAGES.some((s) => s.id === page);
}
