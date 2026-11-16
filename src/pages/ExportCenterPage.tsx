import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  Film,
  Flame,
  Loader2,
  Mic,
  Palette,
  RefreshCw,
  Sparkles,
  Type,
} from 'lucide-react';
import JSZip from 'jszip';
import {
  DEFAULT_VIDEO_CANVAS,
  ExportSettings,
  Project,
  RenderJob,
  SavedFontAsset,
} from '../types/studio';
import { api } from '../lib/api';
import { formatBytes, formatDurationShort } from '../lib/formatters';
import { createWorkflowUpdate, resolveCanvasDimensions } from '../lib/workflowStages';
import { TimelineSyncCard } from '../components/TimelineSyncCard';
import { VideoStudioPlayer } from '../components/VideoStudioPlayer';

interface ExportCenterPageProps {
  project: Project;
  onProjectUpdated: (p: Project) => void;
  customFonts?: SavedFontAsset[];
}

export function ExportCenterPage({
  project,
  onProjectUpdated,
  customFonts = [],
}: ExportCenterPageProps) {
  const draftVideoRef = useRef<HTMLVideoElement | null>(null);
  const finalVideoRef = useRef<HTMLVideoElement | null>(null);

  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [activeJob, setActiveJob] = useState<RenderJob | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [previewMode, setPreviewMode] = useState<'rendered' | 'draft'>(() =>
    project.lastExportUrl ? 'rendered' : 'draft'
  );
  const [draftTime, setDraftTime] = useState(0);
  const [draftEffects, setDraftEffects] = useState(true);

  const [exportValidation, setExportValidation] = useState<
    'idle' | 'checking' | 'valid' | 'error'
  >('idle');
  const [exportValidationMsg, setExportValidationMsg] = useState<string | null>(null);
  const [videoMetaInfo, setVideoMetaInfo] = useState<{
    w: number;
    h: number;
    dur: number;
  } | null>(null);

  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [generatingThumbs, setGeneratingThumbs] = useState(false);
  const [selectedThumbIndex, setSelectedThumbIndex] = useState(0);
  const [thumbTitle, setThumbTitle] = useState(project.name || 'Movie Recap Highlights');
  const [thumbSubtitle, setThumbSubtitle] = useState('Full Story Explained');
  const [thumbAspect, setThumbAspect] = useState<'16:9' | '1:1' | '9:16'>('16:9');
  const [thumbStyle, setThumbStyle] = useState<'cinematic' | 'viral' | 'minimal' | 'impact' | 'social'>('cinematic');
  const [zipDownloading, setZipDownloading] = useState(false);
  const [thumbError, setThumbError] = useState<string | null>(null);

  const settings = project.exportSettings;
  const resolvedDims = resolveCanvasDimensions(
    project.canvas,
    settings,
    project.metadata
  );

  const verifyExportedFile = useCallback(async (url: string | null) => {
    if (!url) {
      setExportValidation('idle');
      setExportValidationMsg(null);
      setVideoMetaInfo(null);
      return;
    }
    setExportValidation('checking');
    setExportValidationMsg(null);
    setVideoMetaInfo(null);
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      const size = Number(res.headers.get('content-length') || 0);
      if (!res.ok || size < 1024) {
        setExportValidation('error');
        setExportValidationMsg(
          !res.ok
            ? `Exported video file not found on server (HTTP ${res.status}). Re-render Final MP4.`
            : 'Exported MP4 is empty or incomplete (0 bytes). Re-render Final MP4.'
        );
        return;
      }
      setExportValidation('valid');
    } catch (err) {
      setExportValidation('error');
      setExportValidationMsg(
        err instanceof Error ? err.message : 'Unable to verify exported MP4.'
      );
    }
  }, []);

  useEffect(() => {
    void verifyExportedFile(project.lastExportUrl);
    if (project.lastExportUrl) {
      setPreviewMode('rendered');
    } else {
      setPreviewMode('draft');
    }
  }, [project.lastExportUrl, project.lastExportedAt, verifyExportedFile]);

  useEffect(() => {
    void api.listProjectJobs(project.id).then((res) => {
      setJobs(res.jobs);
      const running = res.jobs.find((j) => j.status === 'queued' || j.status === 'processing');
      if (running) setActiveJob(running);
    });
  }, [project.id]);

  // Poll active background render job every 900ms
  useEffect(() => {
    if (!activeJob || (activeJob.status !== 'queued' && activeJob.status !== 'processing')) {
      return;
    }

    const timer = setInterval(async () => {
      try {
        const res = await api.getJob(activeJob.id);
        setActiveJob(res.job);
        setJobs((prev) => prev.map((j) => (j.id === res.job.id ? res.job : j)));

        if (res.job.status === 'completed') {
          const pRes = await api.getProject(project.id);
          const nextWorkflow = createWorkflowUpdate(pRes.project.workflow, {
            completeStage: 'export',
            clearAttentionFor: 'export',
          });
          const { project: synced } = await api.updateProject(project.id, {
            workflow: nextWorkflow,
          });
          onProjectUpdated(synced);
          setPreviewMode('rendered');
          void verifyExportedFile(synced.lastExportUrl);
        }
      } catch {
        // ignore transient poll errors
      }
    }, 900);

    return () => clearInterval(timer);
  }, [activeJob, project.id, onProjectUpdated, verifyExportedFile]);

  const updateSettings = async (patch: Partial<ExportSettings>) => {
    const next = { ...settings, ...patch };
    const nextCanvas =
      patch.aspectRatio !== undefined
        ? { ...DEFAULT_VIDEO_CANVAS, ...(project.canvas || {}), aspectRatio: patch.aspectRatio }
        : project.canvas;
    onProjectUpdated({ ...project, exportSettings: next, canvas: nextCanvas });
    const { project: saved } = await api.updateProject(project.id, {
      exportSettings: next,
      canvas: nextCanvas,
    });
    onProjectUpdated(saved);
  };

  // Requirement 5: Prominent GENERATE FINAL VIDEO Handler with Pre-Render Validations
  const handleGenerateFinalVideo = async () => {
    setErrorMsg(null);

    if (!project.sourceVideoUrl) {
      setErrorMsg('No source video uploaded. Please import a video before generating final output.');
      return;
    }

    setStarting(true);
    try {
      const { job } = await api.startExport(project.id, settings);
      setActiveJob(job);
      setJobs((prev) => [job, ...prev]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const isRendering =
    activeJob && (activeJob.status === 'queued' || activeJob.status === 'processing');

  // Validation Checks summary
  const hasVideo = Boolean(project.sourceVideoUrl && project.metadata);
  const dubbingReady = Boolean(project.voice.enabled && project.voice.fullDubUrl);
  const narrationAudit = project.voice.syncPlan?.narrationAudit;
  const incompleteNarration = Boolean(
    settings.applyDubbing && dubbingReady && narrationAudit && !narrationAudit.isComplete
  );
  const activeFxCount = (project.videoEffects?.effects || []).filter((e) => e.enabled).length;
  const filterPreset = project.videoEffects?.filterPreset || 'none';
  const hasCaptions = project.captions.length > 0;
  const captionsWillBurn = settings.applyCaptions && hasCaptions;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header & Prominent Generation Button */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-violet-600/30 text-violet-300 border border-violet-500/40">
              STAGE 7
            </span>
            <h1 className="text-2xl font-display font-bold tracking-tight text-white">
              Final Preview and Export
            </h1>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Validate all pipeline modules, render the final synchronized MP4 with FFmpeg, and preview or download the finished video.
          </p>
        </div>

        {/* REQUIREMENT 5: Single Prominent GENERATE FINAL VIDEO Button */}
        <button
          onClick={handleGenerateFinalVideo}
          disabled={!hasVideo || Boolean(isRendering) || starting}
          className="px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-sm font-bold text-white flex items-center gap-2.5 whitespace-nowrap shrink-0 shadow-lg shadow-violet-600/30 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          {isRendering || starting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Flame className="w-5 h-5 text-amber-300" />
          )}
          {isRendering
            ? `Rendering Final MP4 (${Math.round(activeJob?.progress || 0)}%)...`
            : 'GENERATE FINAL VIDEO'}
        </button>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-200 flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {incompleteNarration && narrationAudit && (
        <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/35 text-xs text-amber-200 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Missing or incomplete narration segments detected:</span>{' '}
            {narrationAudit.summary} Review Voice Studio before final export.
          </div>
        </div>
      )}

      {/* Pre-Render Pipeline Verification Checklist */}
      <div className="p-4 rounded-xl bg-[#111115] border border-white/[0.08] space-y-3">
        <h2 className="text-xs font-semibold text-zinc-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-violet-400" />
          Pipeline Pre-Flight Validation
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {/* Source Video Status */}
          <div className="p-2.5 rounded-lg bg-[#18181D] border border-white/[0.06] space-y-1">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="flex items-center gap-1.5 font-medium text-zinc-200">
                <Film className="w-3.5 h-3.5 text-zinc-400" />
                1. Source Video
              </span>
              {hasVideo ? (
                <span className="text-emerald-400 font-medium">Ready</span>
              ) : (
                <span className="text-amber-400 font-medium">Missing</span>
              )}
            </div>
            <div className="text-[11px] text-zinc-500 font-mono">
              {project.metadata
                ? `${project.metadata.width}x${project.metadata.height} · ${formatDurationShort(project.metadata.duration)}`
                : 'No source video loaded'}
            </div>
          </div>

          {/* Voice Dub & Sync Status */}
          <div className="p-2.5 rounded-lg bg-[#18181D] border border-white/[0.06] space-y-1">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="flex items-center gap-1.5 font-medium text-zinc-200">
                <Mic className="w-3.5 h-3.5 text-zinc-400" />
                3 & 4. Voiceover & Sync
              </span>
              {settings.applyDubbing ? (
                incompleteNarration ? (
                  <span className="text-amber-400 font-medium">Incomplete</span>
                ) : dubbingReady ? (
                  <span className="text-emerald-400 font-medium">Dubbed</span>
                ) : (
                  <span className="text-zinc-500">Original Audio</span>
                )
              ) : (
                <span className="text-zinc-500">Muted / Source</span>
              )}
            </div>
            <div className="text-[11px] text-zinc-500 font-mono">
              {dubbingReady
                ? `${project.voice.targetLanguage} · 1.0x constant · ${project.voice.syncMode}`
                : 'Using original audio track'}
            </div>
          </div>

          {/* Video Filters & Canvas Status */}
          <div className="p-2.5 rounded-lg bg-[#18181D] border border-white/[0.06] space-y-1">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="flex items-center gap-1.5 font-medium text-zinc-200">
                <Palette className="w-3.5 h-3.5 text-zinc-400" />
                5. Canvas &amp; Effects
              </span>
              {settings.applyVideoEffects ? (
                <span className="text-emerald-400 font-medium">Active</span>
              ) : (
                <span className="text-zinc-500">Bypassed</span>
              )}
            </div>
            <div className="text-[11px] text-zinc-500 capitalize font-mono">
              {(() => {
                const canvasCfg = { ...DEFAULT_VIDEO_CANVAS, ...(project.canvas || {}) };
                const dims = resolveCanvasDimensions(canvasCfg, settings, project.metadata);
                return `${dims.width}×${dims.height} (${canvasCfg.backgroundType}) · ${
                  filterPreset !== 'none' ? filterPreset : 'Natural'
                }${activeFxCount > 0 ? ` +${activeFxCount} FX` : ''}`;
              })()}
            </div>
          </div>

          {/* Captions Status */}
          <div className="p-2.5 rounded-lg bg-[#18181D] border border-white/[0.06] space-y-1">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="flex items-center gap-1.5 font-medium text-zinc-200">
                <Type className="w-3.5 h-3.5 text-zinc-400" />
                6. Subtitles
              </span>
              {captionsWillBurn ? (
                <span className="text-emerald-400 font-medium">Burning In</span>
              ) : (
                <span className="text-zinc-500 font-medium">Excluded</span>
              )}
            </div>
            <div className="text-[11px] text-zinc-500 font-mono">
              {captionsWillBurn
                ? `${project.captions.length} timed segments`
                : 'Excluded from export (Default)'}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Output & Pipeline Operations */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-xl bg-[#111115] border border-white/[0.08] space-y-4">
            <h2 className="text-sm font-display font-semibold text-white">Format & Dimensions</h2>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Aspect Ratio</label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                {(
                  [
                    ['original', 'Original'],
                    ['16:9', '16:9'],
                    ['9:16', '9:16'],
                    ['1:1', '1:1'],
                    ['custom', 'Custom'],
                  ] as const
                ).map(([ratio, label]) => (
                  <button
                    key={ratio}
                    onClick={() => void updateSettings({ aspectRatio: ratio })}
                    className={`py-2 px-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      settings.aspectRatio === ratio
                        ? 'bg-violet-600 text-white'
                        : 'bg-[#18181D] text-zinc-300 hover:bg-zinc-800 border border-white/[0.06]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Resolution</label>
              <div className="grid grid-cols-3 gap-2">
                {(['480p', '720p', '1080p'] as const).map((res) => (
                  <button
                    key={res}
                    onClick={() => void updateSettings({ resolution: res })}
                    className={`py-2 px-2 rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
                      settings.resolution === res
                        ? 'bg-violet-600 text-white'
                        : 'bg-[#18181D] text-zinc-300 hover:bg-zinc-800 border border-white/[0.06]'
                    }`}
                  >
                    {res}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400">Framing Fit</label>
                <select
                  value={settings.fitMode}
                  onChange={(e) =>
                    void updateSettings({
                      fitMode: e.target.value as ExportSettings['fitMode'],
                    })
                  }
                  className="mt-1 w-full bg-[#18181D] border border-white/[0.08] rounded-lg px-2.5 py-2 text-xs text-zinc-100"
                >
                  <option value="crop">Smart Center Crop</option>
                  <option value="blur-pad">Blurred Fill</option>
                  <option value="letterbox">Letterbox Fit</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-zinc-400">Codec & Container</label>
                <div className="mt-1 bg-[#18181D] border border-white/[0.08] rounded-lg px-2.5 py-2 text-xs font-mono text-zinc-300">
                  MP4 · H.264 / AAC
                </div>
              </div>
            </div>
          </div>

          {/* Pipeline Modules Selection */}
          <div className="p-5 rounded-xl bg-[#111115] border border-white/[0.08] space-y-3">
            <h2 className="text-sm font-display font-semibold text-white">
              Pipeline Processing Modules
            </h2>
            <div className="space-y-2 text-xs">
              {[
                {
                  key: 'applyVideoEffects' as const,
                  label: 'Apply Video Filters & Visual Effects',
                  count: `${filterPreset !== 'none' ? filterPreset : 'Natural'}${activeFxCount > 0 ? ` +${activeFxCount} FX` : ''}`,
                },
                {
                  key: 'applyBlur' as const,
                  label: 'Apply Blur & Motion Tracking Effects',
                  count: `${project.blurs.filter((b) => b.enabled).length} active`,
                },
                {
                  key: 'applyLogo' as const,
                  label: 'Burn Logo & Watermark Overlays',
                  count: `${project.logos.filter((l) => l.enabled).length} active`,
                },
                {
                  key: 'applyCaptions' as const,
                  label: 'Burn Styled Captions / Subtitles',
                  count: `${project.captions.length} segments`,
                },
                {
                  key: 'applyDubbing' as const,
                  label: 'Use AI Narration Dub Track',
                  count: project.voice.enabled && project.voice.fullDubUrl ? 'Ready' : 'Off',
                },
                {
                  key: 'applyAudioMix' as const,
                  label: 'Apply Audio Fades & Background Music Mix',
                  count: project.voice.bgMusicFilename || 'Fades & Balance',
                },
              ].map((op) => (
                <label
                  key={op.key}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#18181D] border border-white/[0.06] cursor-pointer hover:border-white/[0.12] transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={Boolean(settings[op.key])}
                      onChange={(e) => void updateSettings({ [op.key]: e.target.checked })}
                      className="accent-violet-500 rounded"
                    />
                    <span className="text-zinc-200">{op.label}</span>
                  </div>
                  <span className="text-[11px] font-mono text-zinc-500">{op.count}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Active Progress + Final Functional Preview & Download */}
        <div className="lg:col-span-7 space-y-4">
          {activeJob && (
            <div className="p-5 rounded-xl bg-[#111115] border border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  {activeJob.status === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : activeJob.status === 'failed' ? (
                    <AlertCircle className="w-4 h-4 text-red-400" />
                  ) : (
                    <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
                  )}
                  <span>{activeJob.stage}</span>
                </div>
                <span className="font-mono text-sm text-violet-300 tabular-nums">
                  {Math.round(activeJob.progress)}%
                </span>
              </div>

              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    activeJob.status === 'failed'
                      ? 'bg-red-500'
                      : activeJob.status === 'completed'
                      ? 'bg-emerald-500'
                      : 'bg-violet-500'
                  }`}
                  style={{ width: `${activeJob.progress}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs text-zinc-400 font-mono tabular-nums">
                <span>Job {activeJob.id.slice(0, 8)}</span>
                <span>
                  {activeJob.etaSeconds !== null && activeJob.status === 'processing'
                    ? `Estimated remaining: ${formatDurationShort(activeJob.etaSeconds)}`
                    : activeJob.status === 'completed' && activeJob.outputSize
                    ? `Finished size: ${formatBytes(activeJob.outputSize)}`
                    : ''}
                </span>
              </div>

              {activeJob.error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-200">
                  {activeJob.error}
                </div>
              )}
            </div>
          )}

          <TimelineSyncCard project={project} onProjectUpdated={onProjectUpdated} compact />

          {/* Professional 5-Option Thumbnail Generator */}
          <div className="p-5 rounded-xl bg-[#111115] border border-white/[0.08] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-display font-semibold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-400" />
                  Professional Thumbnail Generator
                </h2>
                <p className="text-xs text-zinc-400">
                  Automatically extract 5 representative frames and create distinct viral thumbnail compositions.
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  setThumbError(null);
                  setGeneratingThumbs(true);
                  try {
                    const res = await api.generateThumbnails(project.id);
                    setThumbnails(res.thumbnails || []);
                    if (res.suggestedTitle) setThumbTitle(res.suggestedTitle);
                    if (res.suggestedSubtitle) setThumbSubtitle(res.suggestedSubtitle);
                    setSelectedThumbIndex(0);
                  } catch (err) {
                    setThumbError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setGeneratingThumbs(false);
                  }
                }}
                disabled={generatingThumbs || !project.sourceVideoUrl}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-45 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {generatingThumbs && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <Sparkles className="w-3.5 h-3.5" />
                Generate 5 Thumbnails
              </button>
            </div>

            {thumbError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-200">
                {thumbError}
              </div>
            )}

            {thumbnails.length > 0 && (
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {thumbnails.map((url, idx) => (
                    <div
                      key={idx}
                      onClick={() => setSelectedThumbIndex(idx)}
                      className={`group relative rounded-lg overflow-hidden border transition-all cursor-pointer bg-black aspect-video flex items-center justify-center ${
                        selectedThumbIndex === idx
                          ? 'border-violet-500 ring-2 ring-violet-500/40'
                          : 'border-white/[0.08] hover:border-white/[0.2]'
                      }`}
                    >
                      <img src={url} alt={`Thumbnail ${idx + 1}`} className="w-full h-full object-cover" />
                      <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-mono text-zinc-200">
                        Option #{idx + 1}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Thumbnail Editor & Preview */}
                <div className="p-4 rounded-xl bg-[#18181D] border border-white/[0.08] space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <span className="text-xs font-semibold text-white">
                        Customizing Option #{selectedThumbIndex + 1}
                      </span>
                      <p className="text-[11px] text-zinc-400">
                        Edit text, typography, layout style, and download in multiple aspect ratios.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center bg-zinc-900 border border-white/[0.08] rounded-md p-0.5 text-[11px]">
                        {(['16:9', '1:1', '9:16'] as const).map((asp) => (
                          <button
                            key={asp}
                            type="button"
                            onClick={() => setThumbAspect(asp)}
                            className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
                              thumbAspect === asp ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {asp}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center bg-zinc-900 border border-white/[0.08] rounded-md p-0.5 text-[11px]">
                        {(['cinematic', 'viral', 'minimal', 'impact', 'social'] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => setThumbStyle(st)}
                            className={`px-2 py-1 rounded uppercase tracking-wider font-mono text-[10px] transition-colors cursor-pointer ${
                              thumbStyle === st ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Live Render Preview */}
                    <div
                      className="relative rounded-lg overflow-hidden bg-black border border-white/[0.1] shadow-xl flex items-center justify-center mx-auto w-full"
                      style={{
                        aspectRatio: thumbAspect === '1:1' ? '1 / 1' : thumbAspect === '9:16' ? '9 / 16' : '16 / 9',
                        maxHeight: '320px',
                      }}
                    >
                      <img
                        src={thumbnails[selectedThumbIndex]}
                        alt="Selected Thumb"
                        className="w-full h-full object-cover filter contrast-110 brightness-95"
                      />

                      {/* Style Overlay Composition */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex flex-col justify-end p-4 text-left">
                        {thumbStyle === 'viral' && (
                          <span className="self-start px-2 py-0.5 rounded bg-yellow-400 text-black font-extrabold text-[11px] uppercase tracking-wide mb-1.5 shadow">
                            🔥 TRENDING RECAP
                          </span>
                        )}
                        {thumbStyle === 'social' && (
                          <span className="self-start px-2 py-0.5 rounded-full bg-violet-600 text-white font-bold text-[10px] uppercase tracking-wide mb-1.5">
                            EXCLUSIVE STORY
                          </span>
                        )}
                        <h3
                          className={`font-display font-black tracking-tight text-white drop-shadow-lg ${
                            thumbStyle === 'minimal' ? 'text-lg font-bold' : 'text-xl sm:text-2xl uppercase'
                          }`}
                          style={{ fontFamily: thumbStyle === 'cinematic' ? 'Playfair Display, serif' : 'Montserrat, sans-serif' }}
                        >
                          {thumbTitle || 'Movie Recap Title'}
                        </h3>
                        {thumbSubtitle && (
                          <p className="text-xs text-zinc-200 font-medium mt-0.5 drop-shadow">
                            {thumbSubtitle}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Controls */}
                    <div className="space-y-3">
                      <div>
                        <label className="text-[11px] text-zinc-400">Main Headline Title</label>
                        <input
                          type="text"
                          value={thumbTitle}
                          onChange={(e) => setThumbTitle(e.target.value)}
                          className="mt-1 w-full bg-zinc-900 border border-white/[0.08] rounded-md px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-violet-500"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-zinc-400">Subtitle / Hook</label>
                        <input
                          type="text"
                          value={thumbSubtitle}
                          onChange={(e) => setThumbSubtitle(e.target.value)}
                          className="mt-1 w-full bg-zinc-900 border border-white/[0.08] rounded-md px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-violet-500"
                        />
                      </div>

                      <div className="pt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            const imgUrl = thumbnails[selectedThumbIndex];
                            const a = document.createElement('a');
                            a.href = imgUrl;
                            a.download = `recap_thumbnail_${selectedThumbIndex + 1}_${thumbAspect.replace(':', '_')}.jpg`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                          }}
                          className="px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download Selected JPG
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            setZipDownloading(true);
                            try {
                              const zip = new JSZip();
                              const folder = zip.folder('recap_thumbnails');
                              for (let i = 0; i < thumbnails.length; i++) {
                                const resp = await fetch(thumbnails[i]);
                                const blob = await resp.blob();
                                folder?.file(`thumbnail_${i + 1}.jpg`, blob);
                              }
                              const content = await zip.generateAsync({ type: 'blob' });
                              const link = document.createElement('a');
                              link.href = URL.createObjectURL(content);
                              link.download = `${project.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_thumbnails_5pack.zip`;
                              document.body.appendChild(link);
                              link.click();
                              document.body.removeChild(link);
                            } catch (err) {
                              setThumbError(err instanceof Error ? err.message : String(err));
                            } finally {
                              setZipDownloading(false);
                            }
                          }}
                          disabled={zipDownloading}
                          className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-xs font-semibold text-zinc-100 flex items-center gap-1.5 cursor-pointer"
                        >
                          {zipDownloading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          <Download className="w-3.5 h-3.5 text-violet-400" />
                          Download All 5 (.zip)
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Functional Final Export Preview & Separate Draft Preview */}
          <div className="p-5 rounded-xl bg-[#111115] border border-white/[0.08] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-display font-semibold text-white">
                  {previewMode === 'rendered'
                    ? 'Final Rendered Video Output'
                    : 'Draft Editing Preview'}
                </h2>
                <p className="text-xs text-zinc-400">
                  {previewMode === 'rendered' && project.lastExportUrl
                    ? 'Verified MP4 output encoded by FFmpeg (H.264 / AAC).'
                    : 'Real-time workspace preview — click GENERATE FINAL VIDEO to encode the downloadable MP4.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center bg-zinc-900 border border-white/[0.08] rounded-lg p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setPreviewMode('rendered')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                      previewMode === 'rendered'
                        ? 'bg-violet-600 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Final Exported MP4
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('draft')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                      previewMode === 'draft'
                        ? 'bg-amber-500/25 text-amber-200'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Eye className="w-3 h-3" />
                    Draft Preview
                  </button>
                </div>

                {project.lastExportUrl && (
                  <a
                    href={
                      exportValidation === 'valid'
                        ? `${project.lastExportUrl}?download=1`
                        : undefined
                    }
                    onClick={(e) => {
                      if (exportValidation !== 'valid') e.preventDefault();
                    }}
                    aria-disabled={exportValidation !== 'valid'}
                    download={`${project.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_final.mp4`}
                    className={`px-4 py-2 rounded-lg text-xs font-bold text-white flex items-center gap-2 whitespace-nowrap shadow-sm ${
                      exportValidation === 'valid'
                        ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30 cursor-pointer'
                        : 'bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-60'
                    }`}
                  >
                    <Download className="w-4 h-4" />
                    {exportValidation === 'valid'
                      ? `Download Final MP4 (${formatBytes(project.lastExportSize)})`
                      : exportValidation === 'checking'
                      ? 'Verifying MP4...'
                      : 'MP4 Unavailable'}
                  </a>
                )}
              </div>
            </div>

            {previewMode === 'draft' ? (
              <div className="space-y-2.5">
                <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    DRAFT PREVIEW — NOT FINAL EXPORT
                  </span>
                  <span className="text-[11px] text-amber-200/80 font-mono">
                    Interactive live layers preview
                  </span>
                </div>
                <VideoStudioPlayer
                  project={project}
                  currentTime={draftTime}
                  onTimeUpdate={setDraftTime}
                  videoRef={draftVideoRef}
                  previewEffects={draftEffects}
                  onTogglePreviewEffects={setDraftEffects}
                  drawMode="none"
                  customFonts={customFonts}
                  readOnlyPreview={true}
                />
              </div>
            ) : project.lastExportUrl ? (
              <div className="space-y-2.5">
                {exportValidation === 'checking' && (
                  <div className="py-12 flex flex-col items-center justify-center gap-2 rounded-xl bg-[#09090B] border border-white/[0.06] text-xs text-zinc-400">
                    <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
                    <span>Verifying rendered MP4 stream...</span>
                  </div>
                )}

                {exportValidation === 'error' && (
                  <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">Final Video Preview Error</div>
                        <div className="text-red-200/80 mt-0.5">{exportValidationMsg}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void verifyExportedFile(project.lastExportUrl)}
                      className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry Check
                    </button>
                  </div>
                )}

                {exportValidation === 'valid' && (
                  <>
                    <div
                      className="rounded-xl overflow-hidden bg-black border border-white/[0.08] shadow-2xl mx-auto flex items-center justify-center"
                      style={{
                        aspectRatio: `${resolvedDims.width} / ${resolvedDims.height}`,
                        maxHeight: '460px',
                        maxWidth: '100%',
                      }}
                    >
                      <video
                        ref={finalVideoRef}
                        key={`${project.lastExportUrl}_${project.lastExportedAt || ''}`}
                        src={`${project.lastExportUrl}?v=${encodeURIComponent(
                          project.lastExportedAt || '1'
                        )}`}
                        controls
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={(e) => {
                          const v = e.currentTarget;
                          setVideoMetaInfo({
                            w: v.videoWidth,
                            h: v.videoHeight,
                            dur: v.duration,
                          });
                        }}
                        onError={() => {
                          setExportValidation('error');
                          setExportValidationMsg(
                            'Browser could not decode the rendered MP4 stream. Please click GENERATE FINAL VIDEO to re-encode.'
                          );
                        }}
                        className="w-full h-full object-contain bg-black"
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-zinc-400 px-1 tabular-nums">
                      <span>
                        {videoMetaInfo
                          ? `${videoMetaInfo.w}×${videoMetaInfo.h} · ${formatDurationShort(
                              videoMetaInfo.dur
                            )}`
                          : `${resolvedDims.width}×${resolvedDims.height}`}
                      </span>
                      <span>
                        {project.lastExportSize ? formatBytes(project.lastExportSize) : ''} · H.264 / AAC
                      </span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="py-12 text-center space-y-3 rounded-xl bg-[#09090B] border border-white/[0.06]">
                <Film className="w-8 h-8 text-zinc-700 mx-auto" />
                <div className="text-sm font-semibold text-zinc-200">
                  No Final Video Rendered Yet
                </div>
                <p className="text-xs text-zinc-500 max-w-md mx-auto leading-relaxed">
                  Click <strong>GENERATE FINAL VIDEO</strong> above to encode the finished MP4, or
                  switch to <strong>Draft Preview</strong> to inspect your layers before rendering.
                </p>
              </div>
            )}
          </div>

          {/* Project Render History */}
          {jobs.length > 0 && (
            <div className="p-5 rounded-xl bg-[#111115] border border-white/[0.08] space-y-3">
              <h2 className="text-sm font-display font-semibold text-white">
                Render Queue History
              </h2>
              <div className="divide-y divide-white/[0.06] text-xs">
                {jobs.slice(0, 6).map((j) => (
                  <div key={j.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {j.status === 'completed' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : j.status === 'failed' ? (
                        <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                      )}
                      <span className="truncate text-zinc-200">{j.stage}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
                      <span className="text-zinc-400">{Math.round(j.progress)}%</span>
                      {j.outputUrl && (
                        <a
                          href={`${j.outputUrl}?download=1`}
                          className="text-violet-400 hover:text-violet-300 font-medium"
                        >
                          Download MP4
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
