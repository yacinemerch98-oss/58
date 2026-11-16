import {
  CaptionSegment,
  CaptionSyncSnapshot,
  DEFAULT_VIDEO_CANVAS,
  Project,
  ProjectWorkflowState,
  StageStatus,
  SupportedLanguage,
  VideoCanvasConfig,
  WorkflowStageId,
  WordTiming,
} from '../types/studio';

export interface WorkflowStageDef {
  id: WorkflowStageId;
  stepLabel: string;
  title: string;
  shortTitle: string;
  optional: boolean;
}

export const WORKFLOW_STAGES: WorkflowStageDef[] = [
  {
    id: 'dashboard',
    stepLabel: '1',
    title: 'Import Video',
    shortTitle: 'Import',
    optional: false,
  },
  {
    id: 'translator',
    stepLabel: '2',
    title: 'Analysis & Translation',
    shortTitle: 'Translation',
    optional: true,
  },
  {
    id: 'voice',
    stepLabel: '3–4',
    title: 'Voiceover & Sync',
    shortTitle: 'Voice & Sync',
    optional: true,
  },
  {
    id: 'editor',
    stepLabel: '5',
    title: 'Editing & Filters',
    shortTitle: 'Edit & Canvas',
    optional: true,
  },
  {
    id: 'captions',
    stepLabel: '6',
    title: 'Captions (Manual)',
    shortTitle: 'Captions',
    optional: true,
  },
  {
    id: 'export',
    stepLabel: '7',
    title: 'Final Preview & Export',
    shortTitle: 'Export',
    optional: false,
  },
];

export function getActiveCaptionSourceText(
  seg: CaptionSegment,
  useTranslated: boolean
): string {
  if (useTranslated && seg.translatedText && seg.translatedText.trim()) {
    return seg.translatedText.trim();
  }
  return (seg.text || seg.translatedText || '').trim();
}

export function normalizeCaptionDisplayMode(
  mode: Project['subtitleStyle']['mode']
): 'word-by-word' | 'karaoke' | 'phrase-chunk' | 'sentence' {
  if (mode === 'word' || mode === 'word-by-word') return 'word-by-word';
  if (mode === 'karaoke') return 'karaoke';
  if (mode === 'phrase-chunk') return 'phrase-chunk';
  return 'sentence';
}

export function distributeWordsEvenly(
  text: string,
  start: number,
  end: number
): WordTiming[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const safeStart = Math.max(0, start);
  const safeEnd = Math.max(safeStart + 0.15, end);
  const totalDur = safeEnd - safeStart;
  const weights = words.map((w) =>
    Math.max(2, w.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '').length)
  );
  const weightSum = weights.reduce((a, b) => a + b, 0) || words.length;

  let cursor = safeStart;
  return words.map((word, idx) => {
    const share = (weights[idx] / weightSum) * totalDur;
    const wStart = cursor;
    const wEnd = idx === words.length - 1 ? safeEnd : wStart + share;
    cursor = wEnd;
    return {
      word,
      start: Number(wStart.toFixed(3)),
      end: Number(Math.max(wStart + 0.05, wEnd).toFixed(3)),
    };
  });
}

export function resolveCaptionWords(
  seg: CaptionSegment,
  useTranslated: boolean
): WordTiming[] {
  const activeSource = getActiveCaptionSourceText(seg, useTranslated);
  const normalized = activeSource.replace(/\s+/g, ' ').trim();
  const existingJoined = (seg.words || []).map((w) => w.word).join(' ').trim();

  if (seg.words && seg.words.length > 0 && (!normalized || existingJoined === normalized)) {
    return seg.words.map((w, idx) => {
      const next = seg.words![idx + 1];
      const start = idx === 0 ? Math.min(seg.start, w.start) : w.start;
      const end = next ? Math.max(w.end, next.start) : Math.max(seg.end, w.end);
      return {
        word: w.word,
        start,
        end: Math.max(start + 0.05, end),
      };
    });
  }
  return distributeWordsEvenly(activeSource, seg.start, seg.end);
}

export interface CaptionSyncStatus {
  hasSnapshot: boolean;
  generatedAt: string | null;
  sourceMode: 'translated' | 'original';
  targetLanguage: SupportedLanguage;
  outdatedSegmentIds: string[];
  outdatedReasons: Record<string, string>;
  hasOutdated: boolean;
}

export function computeCaptionSyncStatus(project: Project): CaptionSyncStatus {
  const snap = project.subtitleStyle.captionSync;
  const hasTranslated = project.captions.some((c) => Boolean(c.translatedText?.trim()));
  const activeMode: 'translated' | 'original' =
    project.subtitleStyle.useTranslated || hasTranslated ? 'translated' : 'original';
  const targetLanguage =
    project.voice.targetLanguage || project.translation.targetLanguage || 'French';

  if (!snap) {
    return {
      hasSnapshot: false,
      generatedAt: null,
      sourceMode: activeMode,
      targetLanguage,
      outdatedSegmentIds: [],
      outdatedReasons: {},
      hasOutdated: false,
    };
  }

  const outdatedSegmentIds: string[] = [];
  const outdatedReasons: Record<string, string> = {};

  for (const seg of project.captions) {
    const currentText = getActiveCaptionSourceText(seg, activeMode === 'translated');
    const prevText = snap.segmentTexts?.[seg.id];
    const currentTimeKey = `${seg.start.toFixed(2)}-${seg.end.toFixed(2)}`;
    const prevTimeKey = snap.segmentTimes?.[seg.id];

    if (prevText === undefined) {
      outdatedSegmentIds.push(seg.id);
      outdatedReasons[seg.id] = 'Segment added after captions were generated';
    } else if (currentText !== prevText) {
      outdatedSegmentIds.push(seg.id);
      outdatedReasons[seg.id] = 'Translation/transcript edited in Stage 3–4';
    } else if (prevTimeKey && prevTimeKey !== currentTimeKey) {
      outdatedSegmentIds.push(seg.id);
      outdatedReasons[seg.id] = 'Timestamps adjusted in Stage 3–4';
    }
  }

  return {
    hasSnapshot: true,
    generatedAt: snap.generatedAt,
    sourceMode: activeMode,
    targetLanguage,
    outdatedSegmentIds,
    outdatedReasons,
    hasOutdated: outdatedSegmentIds.length > 0,
  };
}

/**
 * Generates timed captions strictly from Stage 3-4 Transcript & Translation Editor
 * (NEVER calls external ASR or creates independent translations).
 * Must ONLY be invoked manually when the user clicks "GENERATE CAPTIONS".
 */
export function buildCaptionsFromTranscript(project: Project): {
  captions: CaptionSegment[];
  subtitleStyle: Project['subtitleStyle'];
  sourceMode: 'translated' | 'original';
  targetLanguage: SupportedLanguage;
} {
  if (!project.captions || project.captions.length === 0) {
    throw new Error(
      'No transcript or translation segments found in Stage 3–4. Add or transcribe segments in Stage 2 / Stage 3–4 first.'
    );
  }

  const hasTranslated = project.captions.some((c) => Boolean(c.translatedText?.trim()));
  const sourceMode: 'translated' | 'original' = hasTranslated ? 'translated' : 'original';
  const targetLanguage =
    project.voice.targetLanguage || project.translation.targetLanguage || 'French';

  const segmentTexts: Record<string, string> = {};
  const segmentTimes: Record<string, string> = {};

  const updatedCaptions: CaptionSegment[] = project.captions.map((seg) => {
    const activeText = getActiveCaptionSourceText(seg, hasTranslated);
    segmentTexts[seg.id] = activeText;
    segmentTimes[seg.id] = `${seg.start.toFixed(2)}-${seg.end.toFixed(2)}`;
    return {
      ...seg,
      words: distributeWordsEvenly(activeText, seg.start, seg.end),
    };
  });

  const captionSync: CaptionSyncSnapshot = {
    generatedAt: new Date().toISOString(),
    sourceMode,
    targetLanguage,
    segmentTexts,
    segmentTimes,
  };

  return {
    captions: updatedCaptions,
    subtitleStyle: {
      ...project.subtitleStyle,
      enabled: true,
      useTranslated: hasTranslated,
      captionSync,
    },
    sourceMode,
    targetLanguage,
  };
}

export interface StageStatusInfo {
  id: WorkflowStageId;
  stepLabel: string;
  title: string;
  shortTitle: string;
  status: StageStatus;
  canContinue: boolean;
  validationMessage?: string;
  attentionReason?: string;
  optional: boolean;
}

export function computeStageStatuses(
  project: Project | null,
  activeStage: WorkflowStageId
): StageStatusInfo[] {
  const wf = project?.workflow;
  const visited = new Set<WorkflowStageId>(wf?.visitedStages || []);
  const completed = new Set<WorkflowStageId>(wf?.completedStages || []);
  const attention = new Set<WorkflowStageId>(wf?.needsAttentionStages || []);
  const captionSync = project ? computeCaptionSyncStatus(project) : null;

  return WORKFLOW_STAGES.map((def): StageStatusInfo => {
    if (!project) {
      return {
        ...def,
        status: def.id === activeStage ? 'In Progress' : 'Not Started',
        canContinue: false,
        validationMessage: 'Create or upload a project video first.',
      };
    }

    const hasVideo = Boolean(project.sourceVideoUrl && project.metadata);
    const hasTranscript = project.captions.length > 0;
    const hasTranslations = project.captions.some((c) => Boolean(c.translatedText?.trim()));
    const hasDub = Boolean(project.voice.enabled && project.voice.fullDubUrl);
    const hasPendingVoiceRegen =
      (project.translation.pendingRegenerateSegmentIds?.length || 0) > 0;
    const hasVoiceConflict = Boolean(
      project.voice.syncPlan &&
        (project.voice.syncPlan.conflictCount > 0 ||
          (project.voice.syncPlan.narrationAudit &&
            !project.voice.syncPlan.narrationAudit.isComplete))
    );
    const canvasEdited =
      project.canvas &&
      (project.canvas.aspectRatio !== 'original' ||
        project.canvas.zoom !== 1 ||
        project.canvas.offsetX !== 0 ||
        project.canvas.offsetY !== 0 ||
        project.canvas.cropTop > 0 ||
        project.canvas.cropRight > 0 ||
        project.canvas.cropBottom > 0 ||
        project.canvas.cropLeft > 0);
    const hasVisualEdits =
      project.videoEffects?.filterPreset !== 'none' ||
      (project.videoEffects?.effects?.some((e) => e.enabled) ?? false) ||
      project.blurs.some((b) => b.enabled) ||
      project.logos.some((l) => l.enabled) ||
      Boolean(canvasEdited);

    let canContinue = true;
    let validationMessage: string | undefined;
    let attentionReason: string | undefined;
    let status: StageStatus = 'Not Started';

    if (def.id === 'dashboard') {
      if (!hasVideo) {
        canContinue = false;
        validationMessage = 'Upload a source video (MP4, MOV, or MKV) before continuing to Stage 2.';
        status = activeStage === 'dashboard' || project.id ? 'In Progress' : 'Not Started';
      } else {
        status = 'Completed';
      }
    } else if (def.id === 'translator') {
      if (!hasVideo) {
        canContinue = false;
        validationMessage = 'Stage 1 requires a source video first.';
      }
      if (attention.has('translator')) {
        status = 'Needs Attention';
        attentionReason = 'Source video changed — review transcript and translations.';
      } else if (hasTranslations || completed.has('translator')) {
        status = 'Completed';
      } else if (hasTranscript || visited.has('translator') || activeStage === 'translator') {
        status = 'In Progress';
      }
    } else if (def.id === 'voice') {
      if (!hasVideo) {
        canContinue = false;
        validationMessage = 'Stage 1 requires a source video first.';
      }
      if (attention.has('voice') || hasPendingVoiceRegen || hasVoiceConflict) {
        status = 'Needs Attention';
        attentionReason = hasPendingVoiceRegen
          ? `${project.translation.pendingRegenerateSegmentIds?.length} edited segment(s) need Fish Audio regeneration.`
          : hasVoiceConflict
          ? 'Audio sync conflicts or missing narration segments detected.'
          : 'Upstream script or media changed — review Voiceover & Sync.';
      } else if (hasDub || completed.has('voice')) {
        status = 'Completed';
      } else if (visited.has('voice') || activeStage === 'voice' || hasTranscript) {
        status = 'In Progress';
      }
    } else if (def.id === 'editor') {
      if (!hasVideo) {
        canContinue = false;
        validationMessage = 'Stage 1 requires a source video first.';
      }
      if (attention.has('editor')) {
        status = 'Needs Attention';
        attentionReason = 'Source video changed — review canvas, blurs, and logos.';
      } else if (completed.has('editor') || (hasVisualEdits && activeStage !== 'editor')) {
        status = 'Completed';
      } else if (visited.has('editor') || activeStage === 'editor' || hasVisualEdits) {
        status = 'In Progress';
      }
    } else if (def.id === 'captions') {
      if (!hasVideo) {
        canContinue = false;
        validationMessage = 'Stage 1 requires a source video first.';
      }
      if (attention.has('captions') || captionSync?.hasOutdated) {
        status = 'Needs Attention';
        attentionReason = captionSync?.hasOutdated
          ? `${captionSync.outdatedSegmentIds.length} caption segment(s) outdated after translation edits.`
          : 'Upstream transcript changed — review manual captions.';
      } else if (completed.has('captions') || captionSync?.hasSnapshot || project.subtitleStyle.enabled) {
        status = 'Completed';
      } else if (visited.has('captions') || activeStage === 'captions') {
        status = 'In Progress';
      }
    } else if (def.id === 'export') {
      canContinue = false; // Final stage
      if (!hasVideo) {
        validationMessage = 'Stage 1 requires a source video before exporting.';
      }
      if (attention.has('export')) {
        status = 'Needs Attention';
        attentionReason = 'Project settings changed since last MP4 export — re-render when ready.';
      } else if (project.lastExportUrl) {
        status = 'Completed';
      } else if (visited.has('export') || activeStage === 'export') {
        status = 'In Progress';
      }
    }

    return {
      ...def,
      status,
      canContinue,
      validationMessage,
      attentionReason,
    };
  });
}

export function createWorkflowUpdate(
  existing: ProjectWorkflowState | undefined,
  opts: {
    visitStage?: WorkflowStageId;
    completeStage?: WorkflowStageId;
    clearAttentionFor?: WorkflowStageId;
    modifiedStage?: WorkflowStageId;
    hasExistingExport?: boolean;
    hasGeneratedDub?: boolean;
    hasGeneratedCaptions?: boolean;
  }
): ProjectWorkflowState {
  const visited = new Set<WorkflowStageId>(existing?.visitedStages || []);
  const completed = new Set<WorkflowStageId>(existing?.completedStages || []);
  const attention = new Set<WorkflowStageId>(existing?.needsAttentionStages || []);

  if (opts.visitStage) visited.add(opts.visitStage);
  if (opts.completeStage) {
    visited.add(opts.completeStage);
    completed.add(opts.completeStage);
    attention.delete(opts.completeStage);
  }
  if (opts.clearAttentionFor) {
    attention.delete(opts.clearAttentionFor);
  }

  if (opts.modifiedStage === 'dashboard') {
    if (completed.has('translator') || visited.has('translator')) attention.add('translator');
    if (opts.hasGeneratedDub || completed.has('voice')) attention.add('voice');
    if (completed.has('editor')) attention.add('editor');
    if (opts.hasGeneratedCaptions || completed.has('captions')) attention.add('captions');
    if (opts.hasExistingExport) attention.add('export');
  } else if (opts.modifiedStage === 'translator') {
    if (opts.hasGeneratedDub) attention.add('voice');
    if (opts.hasGeneratedCaptions) attention.add('captions');
    if (opts.hasExistingExport) attention.add('export');
  } else if (opts.modifiedStage === 'voice') {
    if (opts.hasGeneratedCaptions) attention.add('captions');
    if (opts.hasExistingExport) attention.add('export');
  } else if (opts.modifiedStage === 'editor') {
    if (opts.hasExistingExport) attention.add('export');
  } else if (opts.modifiedStage === 'captions') {
    if (opts.hasExistingExport) attention.add('export');
  }

  return {
    visitedStages: Array.from(visited),
    completedStages: Array.from(completed),
    needsAttentionStages: Array.from(attention),
    lastModifiedStage: opts.modifiedStage || existing?.lastModifiedStage,
    revisions: existing?.revisions,
  };
}

export function resolveCanvasDimensions(
  canvas: VideoCanvasConfig | undefined,
  exportSettings: Project['exportSettings'],
  metadata: Project['metadata']
): { width: number; height: number } {
  const c = canvas || DEFAULT_VIDEO_CANVAS;
  const effectiveRatio =
    c.aspectRatio && c.aspectRatio !== 'original'
      ? c.aspectRatio
      : exportSettings.aspectRatio;

  if (effectiveRatio === 'custom') {
    const w = Math.max(240, Math.min(3840, Math.round(c.customWidth || 1080))) & ~1;
    const h = Math.max(240, Math.min(3840, Math.round(c.customHeight || 1920))) & ~1;
    return { width: w, height: h };
  }

  const shortSide =
    exportSettings.resolution === '480p'
      ? 480
      : exportSettings.resolution === '720p'
      ? 720
      : 1080;

  if (effectiveRatio === 'original' && metadata?.width && metadata?.height) {
    if (metadata.width >= metadata.height) {
      const height = shortSide & ~1;
      const width = Math.max(2, Math.round((metadata.width / metadata.height) * height) & ~1);
      return { width, height };
    }
    const width = shortSide & ~1;
    const height = Math.max(2, Math.round((metadata.height / metadata.width) * width) & ~1);
    return { width, height };
  }

  if (effectiveRatio === '9:16') {
    const width = shortSide & ~1;
    const height = Math.round((width * 16) / 9) & ~1;
    return { width, height };
  }
  if (effectiveRatio === '1:1') {
    return { width: shortSide & ~1, height: shortSide & ~1 };
  }

  const height = shortSide & ~1;
  const width = Math.round((height * 16) / 9) & ~1;
  return { width, height };
}
