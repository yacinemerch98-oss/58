import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Flame,
  Layers,
  Loader2,
  Merge,
  Move,
  Plus,
  RefreshCw,
  Scissors,
  Sparkles,
  Trash2,
  Type,
  UploadCloud,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import {
  CaptionAnimationPreset,
  CaptionDisplayMode,
  CaptionSegment,
  Project,
  SavedFontAsset,
  StudioPreset,
  StudioPresetAssetRef,
  SubtitleStyle,
  SubtitleTemplate,
} from '../types/studio';
import { api } from '../lib/api';
import {
  buildCaptionsFromTranscript,
  computeCaptionSyncStatus,
  createWorkflowUpdate,
  normalizeCaptionDisplayMode,
} from '../lib/workflowStages';
import { PresetLibraryPanel } from '../components/PresetLibraryPanel';

interface CaptionsPageProps {
  project: Project;
  onProjectUpdated: (p: Project) => void;
  onSeek: (time: number) => void;
  customFonts?: SavedFontAsset[];
  onCustomFontsChanged?: () => void;
}

interface TrendingPresetDef {
  id: string;
  name: string;
  tag: string;
  previewBg: string;
  previewFg: string;
  previewAccent: string;
  sampleWord: string;
  style: Partial<SubtitleStyle>;
}

const TRENDING_PRESETS: TrendingPresetDef[] = [
  {
    id: 'tiktok-pop',
    name: 'TikTok Word Pop',
    tag: '1 Word',
    previewBg: '#09090B',
    previewFg: '#FFFFFF',
    previewAccent: '#FACC15',
    sampleWord: 'SHOCKING',
    style: {
      template: 'tiktok',
      mode: 'word-by-word',
      fontFamily: 'DejaVu Sans',
      fontSize: 44,
      fontWeight: '900',
      primaryColor: '#FFFFFF',
      highlightColor: '#FACC15',
      gradientEnabled: false,
      highlightBoxEnabled: false,
      outlineColor: '#000000',
      outlineWidth: 4,
      backgroundOpacity: 0,
      shadowEnabled: true,
      uppercase: true,
      animationPreset: 'word-popup',
    },
  },
  {
    id: 'hormozi-bold',
    name: 'Bold Impact',
    tag: '1 Word',
    previewBg: '#111827',
    previewFg: '#4ADE80',
    previewAccent: '#4ADE80',
    sampleWord: 'SECRET',
    style: {
      template: 'custom',
      mode: 'word-by-word',
      fontFamily: 'Bebas Neue',
      fontSize: 48,
      fontWeight: '900',
      primaryColor: '#4ADE80',
      highlightColor: '#FACC15',
      gradientEnabled: false,
      highlightBoxEnabled: false,
      outlineColor: '#000000',
      outlineWidth: 5,
      backgroundOpacity: 0,
      shadowEnabled: true,
      uppercase: true,
      animationPreset: 'bounce',
    },
  },
  {
    id: 'gradient-neon',
    name: 'Gradient Neon',
    tag: 'Gradient',
    previewBg: '#0F172A',
    previewFg: '#38BDF8',
    previewAccent: '#F472B6',
    sampleWord: 'TWIST',
    style: {
      template: 'custom',
      mode: 'word-by-word',
      fontFamily: 'Montserrat',
      fontSize: 42,
      fontWeight: '900',
      primaryColor: '#FFFFFF',
      highlightColor: '#38BDF8',
      gradientEnabled: true,
      gradientColor: '#EC4899',
      highlightBoxEnabled: false,
      outlineColor: '#09090B',
      outlineWidth: 3,
      backgroundOpacity: 0,
      uppercase: true,
      animationPreset: 'gradient-emphasis',
    },
  },
  {
    id: 'highlight-pill',
    name: 'Highlight Pill Box',
    tag: 'Karaoke',
    previewBg: '#7C3AED',
    previewFg: '#FFFFFF',
    previewAccent: '#FFFFFF',
    sampleWord: 'FOCUS',
    style: {
      template: 'shorts',
      mode: 'karaoke',
      fontFamily: 'Poppins',
      fontSize: 38,
      fontWeight: 'bold',
      primaryColor: '#FFFFFF',
      highlightColor: '#FFFFFF',
      gradientEnabled: false,
      highlightBoxEnabled: true,
      highlightBoxColor: '#7C3AED',
      highlightBoxOpacity: 0.9,
      outlineColor: '#09090B',
      outlineWidth: 2,
      backgroundOpacity: 0.35,
      uppercase: false,
      animationPreset: 'box-highlight',
    },
  },
  {
    id: 'chunk-punch',
    name: '2-Word Punch',
    tag: 'Chunk',
    previewBg: '#18181B',
    previewFg: '#FFFFFF',
    previewAccent: '#FB923C',
    sampleWord: 'RIGHT NOW',
    style: {
      template: 'capcut',
      mode: 'phrase-chunk',
      chunkSize: 2,
      fontFamily: 'Oswald',
      fontSize: 42,
      fontWeight: '900',
      primaryColor: '#FFFFFF',
      highlightColor: '#FB923C',
      gradientEnabled: false,
      highlightBoxEnabled: false,
      outlineColor: '#000000',
      outlineWidth: 4,
      backgroundColor: '#09090B',
      backgroundOpacity: 0.55,
      uppercase: true,
      animationPreset: 'pop',
    },
  },
  {
    id: 'typewriter-clean',
    name: 'Typewriter Film',
    tag: 'Reveal',
    previewBg: '#18181B',
    previewFg: '#E4E4E7',
    previewAccent: '#A78BFA',
    sampleWord: 'Chapter 1',
    style: {
      template: 'cinematic',
      mode: 'sentence',
      fontFamily: 'JetBrains Mono',
      fontSize: 30,
      fontWeight: 'bold',
      primaryColor: '#F4F4F5',
      highlightColor: '#A78BFA',
      gradientEnabled: false,
      highlightBoxEnabled: false,
      outlineColor: '#09090B',
      outlineWidth: 2,
      backgroundColor: '#09090B',
      backgroundOpacity: 0.65,
      uppercase: false,
      animationPreset: 'typewriter',
    },
  },
  {
    id: 'minimal-clean',
    name: 'Minimal Clean',
    tag: 'Sentence',
    previewBg: '#09090B',
    previewFg: '#F4F4F5',
    previewAccent: '#FFFFFF',
    sampleWord: 'Subtitles',
    style: {
      template: 'minimal',
      mode: 'sentence',
      fontFamily: 'Liberation Sans',
      fontSize: 28,
      fontWeight: 'normal',
      primaryColor: '#FFFFFF',
      highlightColor: '#FFFFFF',
      gradientEnabled: false,
      highlightBoxEnabled: false,
      outlineColor: '#000000',
      outlineWidth: 1,
      backgroundColor: '#000000',
      backgroundOpacity: 0.45,
      shadowEnabled: false,
      uppercase: false,
      animationPreset: 'fade',
    },
  },
  {
    id: 'scale-viral',
    name: 'Zoom Pop 1-Word',
    tag: 'Scale-In',
    previewBg: '#1E1B4B',
    previewFg: '#FACC15',
    previewAccent: '#38BDF8',
    sampleWord: 'WATCH',
    style: {
      template: 'custom',
      mode: 'word-by-word',
      fontFamily: 'Anton',
      fontSize: 46,
      fontWeight: '900',
      primaryColor: '#FACC15',
      highlightColor: '#38BDF8',
      gradientEnabled: false,
      highlightBoxEnabled: false,
      outlineColor: '#000000',
      outlineWidth: 4,
      backgroundOpacity: 0,
      uppercase: true,
      animationPreset: 'scale',
    },
  },
];

const ANIMATIONS: Array<{ id: CaptionAnimationPreset; label: string; desc: string }> = [
  { id: 'none', label: 'None (Static)', desc: 'Clean static display' },
  { id: 'word-popup', label: 'Word Pop-up', desc: 'Punchy pop entrance per word' },
  { id: 'karaoke', label: 'Karaoke Sweep', desc: 'Word highlight sweep' },
  { id: 'bounce', label: 'Playful Bounce', desc: 'Springy vertical bounce' },
  { id: 'pop', label: 'Pop Spring', desc: 'Elastic scale snap' },
  { id: 'scale', label: 'Scale-In', desc: 'Zoom settle transition' },
  { id: 'slide-up', label: 'Slide Up', desc: 'Smooth upward reveal' },
  { id: 'fade', label: 'Smooth Fade', desc: 'Cinematic opacity fade' },
  { id: 'typewriter', label: 'Typewriter', desc: 'Word-by-word sentence reveal' },
  { id: 'gradient-emphasis', label: 'Gradient Glow', desc: 'Two-tone gradient highlight' },
  { id: 'box-highlight', label: 'Pill Box Pop', desc: 'Colored backdrop highlight' },
  { id: 'highlight-sweep', label: 'Neon Glow', desc: 'Emissive accent halo' },
];

const BUILTIN_FONTS = [
  'Montserrat',
  'Poppins',
  'Inter',
  'Manrope',
  'Archivo',
  'Plus Jakarta Sans',
  'Anton',
  'Bebas Neue',
  'Oswald',
  'Roboto Condensed',
  'Barlow Condensed',
  'Roboto',
  'Open Sans',
  'Lato',
  'DM Sans',
  'Nunito Sans',
  'Playfair Display',
  'Cormorant Garamond',
  'Libre Baskerville',
  'DejaVu Sans',
  'Liberation Sans',
  'JetBrains Mono',
];

const QUICK_COLORS = ['#FFFFFF', '#FACC15', '#38BDF8', '#4ADE80', '#F43F5E', '#C084FC', '#FB923C'];

export function CaptionsPage({
  project,
  onProjectUpdated,
  onSeek,
  customFonts: externalFonts,
  onCustomFontsChanged,
}: CaptionsPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingFont, setUploadingFont] = useState(false);
  const [localFonts, setLocalFonts] = useState<SavedFontAsset[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'style' | 'animation' | 'position' | 'segments'>('style');

  const customFonts = externalFonts || localFonts;
  const normalizedMode = normalizeCaptionDisplayMode(project.subtitleStyle.mode);

  useEffect(() => {
    if (!externalFonts) {
      void api.listCustomFonts().then((r) => setLocalFonts(r.fonts || [])).catch(() => {});
    }
  }, [externalFonts]);

  const handleUploadFont = async (file: File) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setUploadingFont(true);
    try {
      const res = await api.uploadCustomFont(file);
      if (!externalFonts) setLocalFonts(res.fonts);
      onCustomFontsChanged?.();
      await updateStyle({
        fontFamily: res.font.family,
        customFontId: res.font.id,
        customFontUrl: res.font.url,
        template: 'custom',
      });
      setSuccessMsg(`Uploaded font "${res.font.family}" for live preview and FFmpeg burn-in.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingFont(false);
    }
  };

  const syncStatus = computeCaptionSyncStatus(project);

  const updateStyle = async (patch: Partial<SubtitleStyle>) => {
    const nextStyle = { ...project.subtitleStyle, ...patch };
    const nextWorkflow = createWorkflowUpdate(project.workflow, {
      visitStage: 'captions',
      modifiedStage: 'captions',
      hasExistingExport: Boolean(project.lastExportUrl),
    });
    onProjectUpdated({ ...project, subtitleStyle: nextStyle, workflow: nextWorkflow });
    const { project: saved } = await api.updateProject(project.id, {
      subtitleStyle: nextStyle,
      workflow: nextWorkflow,
    });
    onProjectUpdated(saved);
  };

  const updateExportSettings = async (applyCaptions: boolean) => {
    const nextSettings = { ...project.exportSettings, applyCaptions };
    const nextWorkflow = createWorkflowUpdate(project.workflow, {
      visitStage: 'captions',
      modifiedStage: 'captions',
      hasExistingExport: Boolean(project.lastExportUrl),
    });
    onProjectUpdated({ ...project, exportSettings: nextSettings, workflow: nextWorkflow });
    const { project: saved } = await api.updateProject(project.id, {
      exportSettings: nextSettings,
      workflow: nextWorkflow,
    });
    onProjectUpdated(saved);
  };

  // STRICT MANUAL GENERATION: Builds timed captions strictly from Stage 3-4 transcript/translations
  const handleManualGenerateCaptions = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusy(true);
    try {
      const built = buildCaptionsFromTranscript(project);
      const nextWorkflow = createWorkflowUpdate(project.workflow, {
        completeStage: 'captions',
        modifiedStage: 'captions',
        hasExistingExport: Boolean(project.lastExportUrl),
      });
      const { project: saved } = await api.updateProject(project.id, {
        captions: built.captions,
        subtitleStyle: built.subtitleStyle,
        workflow: nextWorkflow,
      });
      onProjectUpdated(saved);
      setSuccessMsg(
        `Generated ${built.captions.length} timed captions directly from Stage 3–4 (${
          built.sourceMode === 'translated'
            ? `Translated: ${built.targetLanguage}`
            : 'Original Transcript'
        }).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleImportSrtVtt = async (file: File) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const text = await file.text();
      const res = await api.importCaptions(project.id, text);
      const updatedStyle = { ...res.project.subtitleStyle, enabled: true };
      const nextWorkflow = createWorkflowUpdate(res.project.workflow, {
        completeStage: 'captions',
        modifiedStage: 'captions',
        hasExistingExport: Boolean(res.project.lastExportUrl),
      });
      const { project: saved } = await api.updateProject(project.id, {
        subtitleStyle: updatedStyle,
        workflow: nextWorkflow,
      });
      onProjectUpdated(saved);
      setSuccessMsg(`Imported ${res.count} captions from ${file.name}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const updateSegment = async (id: string, patch: Partial<CaptionSegment>) => {
    const next = project.captions.map((c) => (c.id === id ? { ...c, ...patch } : c));
    onProjectUpdated({ ...project, captions: next });
  };

  const saveSegments = async (next: CaptionSegment[]) => {
    const nextWorkflow = createWorkflowUpdate(project.workflow, {
      visitStage: 'captions',
      modifiedStage: 'captions',
      hasExistingExport: Boolean(project.lastExportUrl),
    });
    const { project: saved } = await api.updateProject(project.id, {
      captions: next,
      workflow: nextWorkflow,
    });
    onProjectUpdated(saved);
  };

  const addManualSegment = async () => {
    const lastEnd = project.captions.length
      ? project.captions[project.captions.length - 1].end
      : 0;
    const dur = project.metadata?.duration || 12;
    const start = Math.min(dur - 1, Math.max(0, lastEnd));
    const end = Math.min(dur, start + 2.5);
    const seg: CaptionSegment = {
      id: uuidv4(),
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      text: 'New caption line',
    };
    const next = [...project.captions, seg];
    onProjectUpdated({ ...project, captions: next });
    await saveSegments(next);
  };

  const splitSegment = async (id: string) => {
    const idx = project.captions.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const seg = project.captions[idx];
    const duration = seg.end - seg.start;
    if (duration < 0.6) return; // too short to split

    const words = seg.text.split(' ');
    const midWord = Math.max(1, Math.floor(words.length / 2));
    const text1 = words.slice(0, midWord).join(' ');
    const text2 = words.slice(midWord).join(' ') || '...';
    const midTime = Number((seg.start + duration / 2).toFixed(2));

    const seg1: CaptionSegment = {
      ...seg,
      end: midTime,
      text: text1,
      words: undefined,
    };
    const seg2: CaptionSegment = {
      id: uuidv4(),
      start: midTime,
      end: seg.end,
      text: text2,
    };

    const next = [...project.captions];
    next.splice(idx, 1, seg1, seg2);
    onProjectUpdated({ ...project, captions: next });
    await saveSegments(next);
  };

  const mergeWithNextSegment = async (id: string) => {
    const idx = project.captions.findIndex((c) => c.id === id);
    if (idx === -1 || idx >= project.captions.length - 1) return;
    const cur = project.captions[idx];
    const next = project.captions[idx + 1];

    const merged: CaptionSegment = {
      id: cur.id,
      start: cur.start,
      end: next.end,
      text: `${cur.text} ${next.text}`.trim(),
      translatedText:
        cur.translatedText && next.translatedText
          ? `${cur.translatedText} ${next.translatedText}`.trim()
          : undefined,
    };

    const nextCaptions = [...project.captions];
    nextCaptions.splice(idx, 2, merged);
    onProjectUpdated({ ...project, captions: nextCaptions });
    await saveSegments(nextCaptions);
  };

  const removeSegment = async (id: string) => {
    const next = project.captions.filter((c) => c.id !== id);
    onProjectUpdated({ ...project, captions: next });
    await saveSegments(next);
  };

  return (
    <div className="space-y-4">
      {/* Header and Manual Status Banner */}
      <div className="border-b border-white/[0.08] pb-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-display font-semibold text-white flex items-center gap-2">
              <Type className="w-4 h-4 text-violet-400" />
              Stage 6: Caption Studio (Manual)
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              CapCut-style subtitle styling, animations, safe guides, and timeline timing.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void updateStyle({ enabled: !project.subtitleStyle.enabled })}
              className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                project.subtitleStyle.enabled
                  ? 'bg-violet-600/30 text-violet-300 border border-violet-500/50'
                  : 'bg-zinc-800 text-zinc-400 border border-white/[0.08]'
              }`}
            >
              {project.subtitleStyle.enabled ? (
                <>
                  <Eye className="w-3.5 h-3.5" />
                  Preview: On
                </>
              ) : (
                <>
                  <EyeOff className="w-3.5 h-3.5" />
                  Preview: Off
                </>
              )}
            </button>
          </div>
        </div>

        {/* Manual Caption Requirement Reminder Notice */}
        <div className="p-2.5 rounded-lg bg-zinc-900 border border-white/[0.06] flex items-center justify-between gap-2 text-xs text-zinc-300">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-violet-400" />
            Auto-captions are permanently disabled. Generate manually below when ready.
          </span>
          <span className="font-mono text-zinc-400 text-[11px] tabular-nums">
            {project.captions.length} Segments
          </span>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Outdated Translation / Transcript Sync Warning Banner */}
      {syncStatus.hasOutdated && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/35 text-xs text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">
                Captions Outdated ({syncStatus.outdatedSegmentIds.length} segment
                {syncStatus.outdatedSegmentIds.length === 1 ? '' : 's'} edited in Stage 3–4)
              </div>
              <div className="text-[11px] text-amber-200/80 mt-0.5">
                Your translations or segment timings changed after captions were generated.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleManualGenerateCaptions}
            disabled={busy || project.captions.length === 0}
            className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[11px] font-semibold text-amber-100 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Regenerate from Stage 3–4
          </button>
        </div>
      )}

      {/* Prominent Manual GENERATE CAPTIONS Button */}
      <div className="p-3.5 rounded-xl bg-[#18181D] border border-violet-500/30 space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-violet-400" />
              Generate Captions from Stage 3–4 Script
            </div>
            <div className="text-[11px] text-zinc-400">
              {project.captions.length > 0
                ? `Source: ${
                    syncStatus.sourceMode === 'translated'
                      ? `Translated (${syncStatus.targetLanguage})`
                      : 'Original Transcript'
                  } · Preserves exact Stage 3–4 timestamps.`
                : 'No Stage 3–4 transcript segments yet. Transcribe or translate in Stage 2 / 3–4 first.'}
            </div>
          </div>

          <button
            onClick={handleManualGenerateCaptions}
            disabled={busy || project.captions.length === 0}
            className="py-2 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-bold text-white flex items-center justify-center gap-2 whitespace-nowrap shadow-sm shadow-violet-600/30 cursor-pointer"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flame className="w-4 h-4" />}
            {busy
              ? 'Syncing Captions...'
              : syncStatus.hasSnapshot
              ? 'REGENERATE CAPTIONS'
              : 'GENERATE CAPTIONS'}
          </button>
        </div>

        {/* Separate Export Toggle Checkbox */}
        <label className="flex items-center gap-2 pt-2 border-t border-white/[0.06] text-xs text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={project.exportSettings.applyCaptions}
            onChange={(e) => void updateExportSettings(e.target.checked)}
            className="accent-violet-500 rounded"
          />
          <span className="font-medium text-white">
            Burn Captions into Final Exported MP4 Video
          </span>
          <span className="text-[11px] text-zinc-500 ml-auto font-mono">
            {project.exportSettings.applyCaptions ? 'Included in Stage 7' : 'Excluded from Stage 7'}
          </span>
        </label>
      </div>

      {/* Display Mode Selector (Strict Word-by-Word / Karaoke / Phrase Chunk / Sentence) */}
      <div className="p-3.5 rounded-xl bg-[#18181D] border border-white/[0.08] space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-white">Caption Display Mode</span>
          <span className="text-[11px] font-mono text-violet-300">{normalizedMode}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {(
            [
              { id: 'word-by-word', label: '1 Word at a Time' },
              { id: 'karaoke', label: 'Karaoke Sweep' },
              { id: 'phrase-chunk', label: '2–3 Word Chunk' },
              { id: 'sentence', label: 'Full Sentence' },
            ] as Array<{ id: CaptionDisplayMode; label: string }>
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => void updateStyle({ mode: m.id, template: 'custom' })}
              className={`px-2 py-2 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                normalizedMode === m.id
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : 'bg-zinc-900 border-white/[0.06] text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {normalizedMode === 'phrase-chunk' && (
          <div className="flex items-center justify-between pt-1 text-xs text-zinc-400">
            <span>Words per chunk:</span>
            <div className="flex items-center gap-1.5">
              {([2, 3] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => void updateStyle({ chunkSize: sz })}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono cursor-pointer ${
                    (project.subtitleStyle.chunkSize ?? 3) === sz
                      ? 'bg-violet-600 text-white'
                      : 'bg-zinc-900 text-zinc-300 border border-white/[0.06]'
                  }`}
                >
                  {sz} words
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Trending Short-Form Style Presets with Visual Mini-Previews */}
      <div className="p-3.5 rounded-xl bg-[#18181D] border border-white/[0.08] space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-violet-400" />
            Trending Caption Styles
          </span>
          <span className="text-[11px] font-mono text-zinc-500 capitalize">
            Active: {project.subtitleStyle.template}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {TRENDING_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => void updateStyle(preset.style)}
              className="p-2 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-white/[0.07] hover:border-violet-500/50 text-left transition-all cursor-pointer group"
            >
              <div
                className="h-9 rounded flex items-center justify-center font-extrabold text-xs tracking-wide mb-1.5 px-2 truncate"
                style={{
                  backgroundColor: preset.previewBg,
                  color: preset.previewFg,
                }}
              >
                {preset.sampleWord}
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-medium text-zinc-200 truncate">
                  {preset.name}
                </span>
                <span className="text-[9.5px] font-mono text-violet-300 bg-violet-500/15 px-1.5 py-0.5 rounded shrink-0">
                  {preset.tag}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Persistent Global Caption Presets Library */}
      <PresetLibraryPanel
        category="caption"
        title="Saved Caption Style Library"
        subtitle="Save & reuse custom caption styles globally across all projects."
        getPayload={() => {
          const assetRefs: StudioPresetAssetRef[] = [];
          if (project.subtitleStyle.customFontUrl) {
            assetRefs.push({
              kind: 'font',
              label: project.subtitleStyle.fontFamily,
              url: project.subtitleStyle.customFontUrl,
            });
          }
          const {
            enabled: _enabled,
            captionSync: _captionSync,
            customPresets: _customPresets,
            ...cleanStyle
          } = project.subtitleStyle;
          return {
            payload: cleanStyle as Record<string, unknown>,
            assetRefs,
            thumbnailStyle: {
              bg: project.subtitleStyle.backgroundColor || '#09090B',
              fg: project.subtitleStyle.highlightColor || '#FACC15',
              sampleText: 'Aa',
              badge: `${normalizedMode} · ${project.subtitleStyle.fontFamily}`,
            },
          };
        }}
        onApplyPreset={async (preset: StudioPreset) => {
          const res = await api.applyPresetsToProject(project.id, {
            captionPresetId: preset.id,
          });
          onProjectUpdated(res.project);
          if (res.presetWarnings && res.presetWarnings.length > 0) {
            setErrorMsg(
              `Applied "${preset.name}", but custom font missing: ${res.presetWarnings[0].missingAssets
                .map((a) => a.label)
                .join(', ')}. Re-upload the font file.`
            );
          } else {
            setSuccessMsg(`Applied caption preset "${preset.name}".`);
          }
        }}
        onReuploadMissingAsset={async (_missing, preset, file) => {
          const uploaded = await api.uploadCustomFont(file);
          if (!externalFonts) setLocalFonts(uploaded.fonts);
          onCustomFontsChanged?.();
          await api.updatePreset(preset.id, {
            payload: {
              ...(preset.payload || {}),
              fontFamily: uploaded.font.family,
              customFontId: uploaded.font.id,
              customFontUrl: uploaded.font.url,
            },
            assetRefs: [
              {
                kind: 'font',
                label: uploaded.font.family,
                url: uploaded.font.url,
                filename: uploaded.font.filename,
              },
            ],
          });
          setSuccessMsg(`Re-uploaded font "${uploaded.font.family}" and updated "${preset.name}".`);
        }}
      />

      {/* Editor Sub-Tabs */}
      <div className="flex border-b border-white/[0.08] gap-4 text-xs font-medium text-zinc-400">
        {[
          { id: 'style' as const, label: 'Typography & Colors' },
          { id: 'animation' as const, label: 'Animations' },
          { id: 'position' as const, label: 'Transform & Guides' },
          { id: 'segments' as const, label: `Segments (${project.captions.length})` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`pb-2 transition-colors relative cursor-pointer ${
              activeTab === t.id ? 'text-violet-400 font-semibold' : 'hover:text-zinc-200'
            }`}
          >
            {t.label}
            {activeTab === t.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* TAB 1: Typography & Colors */}
      {activeTab === 'style' && (
        <div className="p-4 rounded-xl bg-[#18181D] border border-white/[0.08] space-y-4">
          {/* Font Family & Custom Font Upload */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-zinc-400">Font Family</label>
                <select
                  value={project.subtitleStyle.fontFamily}
                  onChange={(e) => {
                    const family = e.target.value;
                    const matchCustom = customFonts.find((f) => f.family === family);
                    void updateStyle({
                      fontFamily: family,
                      customFontId: matchCustom?.id,
                      customFontUrl: matchCustom?.url,
                      template: 'custom',
                    });
                  }}
                  className="mt-1 w-full bg-zinc-900 border border-white/[0.08] rounded-md px-2.5 py-1.5 text-xs text-zinc-100"
                >
                  {customFonts.length > 0 && (
                    <optgroup label="Uploaded Custom Fonts">
                      {customFonts.map((cf) => (
                        <option key={cf.id} value={cf.family}>
                          {cf.family} (Custom)
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Studio Fonts">
                    {BUILTIN_FONTS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-zinc-400">Font Weight</label>
                <select
                  value={project.subtitleStyle.fontWeight || 'bold'}
                  onChange={(e) =>
                    void updateStyle({
                      fontWeight: e.target.value as 'normal' | 'bold' | '900',
                      template: 'custom',
                    })
                  }
                  className="mt-1 w-full bg-zinc-900 border border-white/[0.08] rounded-md px-2.5 py-1.5 text-xs text-zinc-100"
                >
                  <option value="normal">Normal (400)</option>
                  <option value="bold">Bold (700)</option>
                  <option value="900">Black / Extra Bold (900)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <input
                ref={fontInputRef}
                type="file"
                accept=".ttf,.otf,.woff,.woff2"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUploadFont(f);
                  e.target.value = '';
                }}
              />
              <span className="text-[10.5px] text-zinc-500">
                Upload .TTF/.OTF for custom fonts in preview &amp; MP4 burn-in.
              </span>
              <button
                type="button"
                disabled={uploadingFont}
                onClick={() => fontInputRef.current?.click()}
                className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-[11px] font-medium text-zinc-200 flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <UploadCloud className="w-3 h-3" />
                {uploadingFont ? 'Uploading...' : 'Upload Font'}
              </button>
            </div>
          </div>

          {/* Quick Style Toggles (Italic, Underline, Uppercase, Alignment) */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-zinc-900/80 border border-white/[0.06]">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() =>
                  void updateStyle({
                    fontWeight: project.subtitleStyle.fontWeight === 'bold' ? 'normal' : 'bold',
                    template: 'custom',
                  })
                }
                className={`w-7 h-7 rounded text-xs font-bold transition-colors cursor-pointer ${
                  project.subtitleStyle.fontWeight === 'bold' || project.subtitleStyle.fontWeight === '900'
                    ? 'bg-violet-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                B
              </button>
              <button
                onClick={() =>
                  void updateStyle({ italic: !project.subtitleStyle.italic, template: 'custom' })
                }
                className={`w-7 h-7 rounded text-xs italic transition-colors cursor-pointer ${
                  project.subtitleStyle.italic
                    ? 'bg-violet-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                I
              </button>
              <button
                onClick={() =>
                  void updateStyle({ underline: !project.subtitleStyle.underline, template: 'custom' })
                }
                className={`w-7 h-7 rounded text-xs underline transition-colors cursor-pointer ${
                  project.subtitleStyle.underline
                    ? 'bg-violet-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                U
              </button>
              <button
                onClick={() =>
                  void updateStyle({ uppercase: !project.subtitleStyle.uppercase, template: 'custom' })
                }
                className={`px-2 h-7 rounded text-xs font-mono transition-colors cursor-pointer ${
                  project.subtitleStyle.uppercase
                    ? 'bg-violet-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                TT
              </button>
            </div>

            <div className="flex items-center gap-1 bg-zinc-800 p-0.5 rounded">
              {(['left', 'center', 'right'] as const).map((align) => (
                <button
                  key={align}
                  onClick={() => void updateStyle({ textAlign: align, template: 'custom' })}
                  className={`px-2 py-0.5 rounded text-[11px] capitalize cursor-pointer ${
                    project.subtitleStyle.textAlign === align
                      ? 'bg-violet-600 text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {align}
                </button>
              ))}
            </div>
          </div>

          {/* Font Size & Spacings */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Font Size</span>
                <span className="font-mono">{project.subtitleStyle.fontSize}px</span>
              </div>
              <input
                type="range"
                min={18}
                max={68}
                value={project.subtitleStyle.fontSize}
                onChange={(e) =>
                  void updateStyle({ fontSize: Number(e.target.value), template: 'custom' })
                }
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Letter Spacing</span>
                <span className="font-mono">{project.subtitleStyle.letterSpacing || 0}px</span>
              </div>
              <input
                type="range"
                min={-1}
                max={8}
                step={0.5}
                value={project.subtitleStyle.letterSpacing || 0}
                onChange={(e) =>
                  void updateStyle({ letterSpacing: Number(e.target.value), template: 'custom' })
                }
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Line Height</span>
                <span className="font-mono">{(project.subtitleStyle.lineSpacing || 1.2).toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={1.0}
                max={2.0}
                step={0.1}
                value={project.subtitleStyle.lineSpacing || 1.2}
                onChange={(e) =>
                  void updateStyle({ lineSpacing: Number(e.target.value), template: 'custom' })
                }
                className="mt-1 w-full accent-violet-500"
              />
            </div>
          </div>

          {/* Color Palettes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/[0.06]">
            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">
                Text Primary Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={project.subtitleStyle.primaryColor}
                  onChange={(e) =>
                    void updateStyle({ primaryColor: e.target.value, template: 'custom' })
                  }
                  className="w-8 h-8 rounded bg-transparent cursor-pointer shrink-0"
                />
                <div className="flex flex-wrap gap-1">
                  {QUICK_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => void updateStyle({ primaryColor: c, template: 'custom' })}
                      style={{ backgroundColor: c }}
                      className="w-5 h-5 rounded-full border border-white/20 cursor-pointer"
                    />
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">
                Active Word Highlight Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={project.subtitleStyle.highlightColor}
                  onChange={(e) =>
                    void updateStyle({ highlightColor: e.target.value, template: 'custom' })
                  }
                  className="w-8 h-8 rounded bg-transparent cursor-pointer shrink-0"
                />
                <div className="flex flex-wrap gap-1">
                  {['#FACC15', '#A855F7', '#38BDF8', '#4ADE80', '#FB7185'].map((c) => (
                    <button
                      key={c}
                      onClick={() => void updateStyle({ highlightColor: c, template: 'custom' })}
                      style={{ backgroundColor: c }}
                      className="w-5 h-5 rounded-full border border-white/20 cursor-pointer"
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Gradient Emphasis & Highlight Pill Box Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/[0.06]">
            <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-white/[0.04] space-y-2">
              <label className="flex items-center justify-between text-[11px] text-zinc-200 font-medium cursor-pointer">
                <span>Gradient Word Emphasis</span>
                <input
                  type="checkbox"
                  checked={Boolean(project.subtitleStyle.gradientEnabled)}
                  onChange={(e) => void updateStyle({ gradientEnabled: e.target.checked })}
                  className="accent-violet-500"
                />
              </label>
              {project.subtitleStyle.gradientEnabled && (
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>Gradient End Color</span>
                  <input
                    type="color"
                    value={project.subtitleStyle.gradientColor || '#38BDF8'}
                    onChange={(e) => void updateStyle({ gradientColor: e.target.value })}
                    className="w-6 h-6 rounded bg-transparent cursor-pointer"
                  />
                </div>
              )}
            </div>

            <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-white/[0.04] space-y-2">
              <label className="flex items-center justify-between text-[11px] text-zinc-200 font-medium cursor-pointer">
                <span>Active Highlight Pill Box</span>
                <input
                  type="checkbox"
                  checked={Boolean(project.subtitleStyle.highlightBoxEnabled)}
                  onChange={(e) => void updateStyle({ highlightBoxEnabled: e.target.checked })}
                  className="accent-violet-500"
                />
              </label>
              {project.subtitleStyle.highlightBoxEnabled && (
                <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                  <input
                    type="color"
                    value={project.subtitleStyle.highlightBoxColor || '#7C3AED'}
                    onChange={(e) => void updateStyle({ highlightBoxColor: e.target.value })}
                    className="w-6 h-6 rounded bg-transparent cursor-pointer shrink-0"
                  />
                  <input
                    type="range"
                    min={0.2}
                    max={1}
                    step={0.05}
                    value={project.subtitleStyle.highlightBoxOpacity ?? 0.85}
                    onChange={(e) => void updateStyle({ highlightBoxOpacity: Number(e.target.value) })}
                    className="flex-1 accent-violet-500"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Stroke, Shadow, and Background Box Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-white/[0.06]">
            {/* Outline / Stroke */}
            <div className="space-y-1.5 p-2.5 rounded-lg bg-zinc-900/60 border border-white/[0.04]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-300 font-medium">Text Stroke</span>
                <input
                  type="color"
                  value={project.subtitleStyle.outlineColor}
                  onChange={(e) =>
                    void updateStyle({ outlineColor: e.target.value, template: 'custom' })
                  }
                  className="w-5 h-5 rounded bg-transparent cursor-pointer"
                />
              </div>
              <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                <span>Width</span>
                <span>{project.subtitleStyle.outlineWidth}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={8}
                value={project.subtitleStyle.outlineWidth}
                onChange={(e) =>
                  void updateStyle({ outlineWidth: Number(e.target.value), template: 'custom' })
                }
                className="w-full accent-violet-500"
              />
            </div>

            {/* Drop Shadow */}
            <div className="space-y-1.5 p-2.5 rounded-lg bg-zinc-900/60 border border-white/[0.04]">
              <label className="flex items-center justify-between text-[11px] text-zinc-300 font-medium cursor-pointer">
                <span>Drop Shadow</span>
                <input
                  type="checkbox"
                  checked={project.subtitleStyle.shadowEnabled}
                  onChange={(e) => void updateStyle({ shadowEnabled: e.target.checked })}
                  className="accent-violet-500"
                />
              </label>
              <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                <span>Blur</span>
                <span>{project.subtitleStyle.shadowBlur ?? 4}px</span>
              </div>
              <input
                type="range"
                min={1}
                max={16}
                value={project.subtitleStyle.shadowBlur ?? 4}
                onChange={(e) =>
                  void updateStyle({ shadowBlur: Number(e.target.value), template: 'custom' })
                }
                className="w-full accent-violet-500"
              />
            </div>

            {/* Background Box Styling */}
            <div className="space-y-1.5 p-2.5 rounded-lg bg-zinc-900/60 border border-white/[0.04]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-300 font-medium">Box Background</span>
                <input
                  type="color"
                  value={project.subtitleStyle.backgroundColor || '#09090B'}
                  onChange={(e) =>
                    void updateStyle({ backgroundColor: e.target.value, template: 'custom' })
                  }
                  className="w-5 h-5 rounded bg-transparent cursor-pointer"
                />
              </div>
              <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                <span>Opacity</span>
                <span>{Math.round((project.subtitleStyle.backgroundOpacity ?? 0.55) * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={project.subtitleStyle.backgroundOpacity ?? 0.55}
                onChange={(e) =>
                  void updateStyle({ backgroundOpacity: Number(e.target.value), template: 'custom' })
                }
                className="w-full accent-violet-500"
              />
            </div>
          </div>

          {/* Box Corner Radius & Padding */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="flex justify-between text-[10px] text-zinc-400">
                <span>Corner Radius</span>
                <span className="font-mono">{project.subtitleStyle.borderRadius ?? 8}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={24}
                value={project.subtitleStyle.borderRadius ?? 8}
                onChange={(e) =>
                  void updateStyle({ borderRadius: Number(e.target.value), template: 'custom' })
                }
                className="mt-1 w-full accent-violet-500"
              />
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-zinc-400">
                <span>Pad Horizontal</span>
                <span className="font-mono">{project.subtitleStyle.paddingH ?? 14}px</span>
              </div>
              <input
                type="range"
                min={4}
                max={36}
                value={project.subtitleStyle.paddingH ?? 14}
                onChange={(e) =>
                  void updateStyle({ paddingH: Number(e.target.value), template: 'custom' })
                }
                className="mt-1 w-full accent-violet-500"
              />
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-zinc-400">
                <span>Pad Vertical</span>
                <span className="font-mono">{project.subtitleStyle.paddingV ?? 6}px</span>
              </div>
              <input
                type="range"
                min={2}
                max={20}
                value={project.subtitleStyle.paddingV ?? 6}
                onChange={(e) =>
                  void updateStyle({ paddingV: Number(e.target.value), template: 'custom' })
                }
                className="mt-1 w-full accent-violet-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Animations */}
      {activeTab === 'animation' && (
        <div className="p-4 rounded-xl bg-[#18181D] border border-white/[0.08] space-y-3">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-white">Select Caption Animation</span>
            <p className="text-[11px] text-zinc-400">
              Animations apply live on the stage and burn cleanly into the final MP4 via ASS filter timing.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ANIMATIONS.map((anim) => {
              const active = (project.subtitleStyle.animationPreset || 'none') === anim.id;
              return (
                <button
                  key={anim.id}
                  onClick={() => void updateStyle({ animationPreset: anim.id, template: 'custom' })}
                  className={`p-2.5 rounded-lg text-left text-xs font-medium border transition-all cursor-pointer ${
                    active
                      ? 'bg-violet-600/20 border-violet-500 text-violet-200'
                      : 'bg-zinc-900 border-white/[0.06] text-zinc-300 hover:border-white/[0.15]'
                  }`}
                >
                  <div className="font-semibold">{anim.label}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{anim.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: Position & Safe Guides */}
      {activeTab === 'position' && (
        <div className="p-4 rounded-xl bg-[#18181D] border border-white/[0.08] space-y-4">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Move className="w-3.5 h-3.5 text-violet-400" />
              Caption Positioning & Safe Area Guides
            </span>
            <p className="text-[11px] text-zinc-400">
              Drag captions directly anywhere on the video preview player, or use precise percentage sliders.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { pos: 'top' as const, y: 14, label: 'Top (14%)' },
              { pos: 'middle' as const, y: 50, label: 'Center (50%)' },
              { pos: 'bottom' as const, y: 84, label: 'Bottom (84%)' },
            ].map((p) => (
              <button
                key={p.pos}
                onClick={() =>
                  void updateStyle({
                    position: p.pos,
                    posX: 50,
                    posY: p.y,
                    template: 'custom',
                  })
                }
                className={`py-2 px-3 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                  project.subtitleStyle.position === p.pos
                    ? 'bg-violet-600 text-white border-violet-500'
                    : 'bg-zinc-900 border-white/[0.06] text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/[0.06]">
            <div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Horizontal Center (X)</span>
                <span className="font-mono">{project.subtitleStyle.posX ?? 50}%</span>
              </div>
              <input
                type="range"
                min={10}
                max={90}
                value={project.subtitleStyle.posX ?? 50}
                onChange={(e) =>
                  void updateStyle({
                    posX: Number(e.target.value),
                    position: 'custom',
                    template: 'custom',
                  })
                }
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Vertical Position (Y)</span>
                <span className="font-mono">{project.subtitleStyle.posY ?? 84}%</span>
              </div>
              <input
                type="range"
                min={8}
                max={92}
                value={project.subtitleStyle.posY ?? 84}
                onChange={(e) =>
                  void updateStyle({
                    posY: Number(e.target.value),
                    position: 'custom',
                    template: 'custom',
                  })
                }
                className="mt-1 w-full accent-violet-500"
              />
            </div>
          </div>

          {/* Caption Scale, Rotation & Opacity */}
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-white/[0.06]">
            <div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Scale</span>
                <span className="font-mono">{Math.round((project.subtitleStyle.scale ?? 1) * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={2.2}
                step={0.05}
                value={project.subtitleStyle.scale ?? 1}
                onChange={(e) => void updateStyle({ scale: Number(e.target.value) })}
                className="mt-1 w-full accent-violet-500"
              />
            </div>
            <div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Rotation</span>
                <span className="font-mono">{Math.round(project.subtitleStyle.rotation ?? 0)}°</span>
              </div>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={project.subtitleStyle.rotation ?? 0}
                onChange={(e) => void updateStyle({ rotation: Number(e.target.value) })}
                className="mt-1 w-full accent-violet-500"
              />
            </div>
            <div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Opacity</span>
                <span className="font-mono">{Math.round((project.subtitleStyle.opacity ?? 1) * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={project.subtitleStyle.opacity ?? 1}
                onChange={(e) => void updateStyle({ opacity: Number(e.target.value) })}
                className="mt-1 w-full accent-violet-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Segments Timeline List & Editing */}
      {activeTab === 'segments' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-300">
              Captions Timeline Segments ({project.captions.length})
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={addManualSegment}
                className="px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Line
              </button>
            </div>
          </div>

          <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
            {project.captions.length === 0 ? (
              <div className="p-6 rounded-lg bg-[#18181D] border border-white/[0.06] text-xs text-zinc-500 text-center space-y-2">
                <p>No Stage 3–4 transcript segments exist yet. Create or transcribe segments first.</p>
              </div>
            ) : (
              project.captions.map((seg, idx) => {
                const isOutdated = syncStatus.outdatedSegmentIds.includes(seg.id);
                const useTranslatedField =
                  syncStatus.sourceMode === 'translated' &&
                  Boolean(seg.translatedText !== undefined);
                return (
                <div
                  key={seg.id}
                  onClick={() => onSeek(seg.start)}
                  className={`p-3 rounded-lg bg-[#18181D] border space-y-2 transition-colors ${
                    isOutdated
                      ? 'border-amber-500/45 hover:border-amber-400/60'
                      : 'border-white/[0.06] hover:border-violet-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-mono">
                      <span className="text-zinc-500 font-sans text-[10px]">#{idx + 1}</span>
                      <input
                        type="number"
                        step={0.05}
                        min={0}
                        value={seg.start}
                        onChange={(e) => void updateSegment(seg.id, { start: Number(e.target.value) })}
                        onBlur={() => void saveSegments(project.captions)}
                        className="w-16 bg-zinc-900 border border-white/[0.08] rounded px-1.5 py-0.5 text-zinc-200 tabular-nums"
                      />
                      <span className="text-zinc-500">→</span>
                      <input
                        type="number"
                        step={0.05}
                        min={0}
                        value={seg.end}
                        onChange={(e) => void updateSegment(seg.id, { end: Number(e.target.value) })}
                        onBlur={() => void saveSegments(project.captions)}
                        className="w-16 bg-zinc-900 border border-white/[0.08] rounded px-1.5 py-0.5 text-zinc-200 tabular-nums"
                      />
                      <span className="text-zinc-500 text-[10px]">
                        ({(seg.end - seg.start).toFixed(1)}s)
                      </span>
                      {isOutdated && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-sans text-[10px] font-medium">
                          Outdated
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {/* Split Caption Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void splitSegment(seg.id);
                        }}
                        title="Split this caption in half"
                        className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 cursor-pointer"
                      >
                        <Scissors className="w-3.5 h-3.5" />
                      </button>

                      {/* Merge Caption with Next Button */}
                      {idx < project.captions.length - 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void mergeWithNextSegment(seg.id);
                          }}
                          title="Merge with next caption line"
                          className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 cursor-pointer"
                        >
                          <Merge className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Delete */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeSegment(seg.id);
                        }}
                        title="Delete caption segment"
                        className="p-1 text-zinc-500 hover:text-red-400 rounded hover:bg-zinc-800 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {useTranslatedField ? (
                    <div className="space-y-1.5">
                      <textarea
                        rows={2}
                        value={seg.translatedText || ''}
                        onChange={(e) =>
                          void updateSegment(seg.id, {
                            translatedText: e.target.value,
                            words: undefined,
                          })
                        }
                        onBlur={() => void saveSegments(project.captions)}
                        className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2.5 py-1.5 text-xs text-zinc-100 resize-none focus:outline-none focus:border-violet-500"
                      />
                      <div className="text-[11px] text-zinc-400 bg-zinc-900/60 px-2 py-1 rounded border border-white/[0.04]">
                        Source: {seg.text}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <textarea
                        rows={2}
                        value={seg.text}
                        onChange={(e) =>
                          void updateSegment(seg.id, {
                            text: e.target.value,
                            words: undefined,
                          })
                        }
                        onBlur={() => void saveSegments(project.captions)}
                        className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2.5 py-1.5 text-xs text-zinc-100 resize-none focus:outline-none focus:border-violet-500"
                      />
                      {seg.translatedText && (
                        <div className="text-[11px] text-violet-300 font-sans italic bg-violet-950/20 px-2 py-1 rounded border border-violet-500/20">
                          Translated: {seg.translatedText}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* SRT / VTT Import & Export Bar */}
      <div className="pt-2 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".srt,.vtt,text/plain"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportSrtVtt(file);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 flex items-center gap-1.5 cursor-pointer"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            Import SRT / VTT
          </button>
        </div>

        {project.captions.length > 0 && (
          <div className="flex items-center gap-2">
            <a
              href={`/api/projects/${project.id}/subtitles/srt`}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3 h-3" />
              SRT
            </a>
            <a
              href={`/api/projects/${project.id}/subtitles/vtt`}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3 h-3" />
              VTT
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
