import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Crop,
  Download,
  FileAudio,
  Film,
  Image as ImageIcon,
  Loader2,
  Maximize,
  Palette,
  Redo2,
  RotateCcw,
  Sliders,
  Undo2,
  UploadCloud,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import {
  BlurEffect,
  CanvasAspectRatio,
  CanvasBackgroundType,
  ColorAdjustments,
  ColorFilterPreset,
  DEFAULT_COLOR_ADJUSTMENTS,
  DEFAULT_VIDEO_CANVAS,
  DEFAULT_VIDEO_EFFECTS,
  LogoOverlay,
  NavPage,
  Project,
  StudioElementSelection,
  StudioPreset,
  StudioPresetAssetRef,
  SubtitleStyle,
  VideoCanvasConfig,
  VideoEffectsConfig,
  VisualEffectItem,
  VisualEffectType,
} from '../types/studio';
import { api, uploadVideoChunked } from '../lib/api';
import { formatBytes, formatDurationShort } from '../lib/formatters';
import { createWorkflowUpdate, resolveCanvasDimensions } from '../lib/workflowStages';
import { LayerPanel } from '../components/LayerPanel';
import { PresetLibraryPanel } from '../components/PresetLibraryPanel';
import { BlurEditorPage } from './BlurEditorPage';
import { BrandingPage } from './BrandingPage';

export type EditorSection =
  | 'canvas'
  | 'layers'
  | 'filters'
  | 'adjustments'
  | 'effects'
  | 'blur'
  | 'branding'
  | 'media';

interface EditorInspectorPageProps {
  project: Project;
  onProjectUpdated: (p: Project) => void;
  onNavigate: (page: NavPage) => void;
  activeSection: EditorSection;
  onSelectSection: (section: EditorSection) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  drawMode: 'none' | 'selective' | 'motion';
  onSetDrawMode: (mode: 'none' | 'selective' | 'motion') => void;
  selectedBlurId: string | null;
  onSelectBlur: (id: string | null) => void;
  selectedLogoId: string | null;
  onSelectLogo: (id: string | null) => void;
  selectedElement?: StudioElementSelection;
  onSelectElement?: (el: StudioElementSelection) => void;
  onUpdateSubtitleStyle?: (patch: Partial<SubtitleStyle>) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

const FILTER_PRESETS: Array<{ id: ColorFilterPreset; name: string; desc: string; previewColor: string }> = [
  { id: 'none', name: 'Original', desc: 'No color filter', previewColor: '#71717A' },
  { id: 'cinematic', name: 'Cinematic', desc: 'Teal & orange film grade', previewColor: '#0284C7' },
  { id: 'vintage', name: 'Vintage', desc: 'Warm sepia nostalgia', previewColor: '#D97706' },
  { id: 'film', name: 'Film Look', desc: 'Analogue 35mm stock', previewColor: '#EA580C' },
  { id: 'warm', name: 'Warm Golden', desc: 'Sunset glow', previewColor: '#F59E0B' },
  { id: 'cool', name: 'Cool Nordic', desc: 'Icy blue thriller tones', previewColor: '#38BDF8' },
  { id: 'black-white', name: 'Noir B&W', desc: 'High-contrast monochrome', previewColor: '#E4E4E7' },
  { id: 'high-contrast', name: 'High Contrast', desc: 'Punchy vivid dynamics', previewColor: '#A855F7' },
  { id: 'moody', name: 'Moody Dark', desc: 'Atmospheric shadows', previewColor: '#4338CA' },
  { id: 'faded', name: 'Faded Matte', desc: 'Lifted blacks aesthetic', previewColor: '#9CA3AF' },
  { id: 'vibrant', name: 'Vibrant Pop', desc: 'High-saturation social look', previewColor: '#EC4899' },
  { id: 'natural', name: 'Natural', desc: 'Clean balanced grade', previewColor: '#10B981' },
];

const AVAILABLE_EFFECTS: Array<{ type: VisualEffectType; name: string; desc: string }> = [
  { type: 'film-grain', name: 'Film Grain', desc: 'Authentic 35mm film texture & noise' },
  { type: 'motion-blur', name: 'Motion Blur', desc: 'Temporal action blur smoothing' },
  { type: 'glow', name: 'Glow / Bloom', desc: 'Dreamy highlight diffusion' },
  { type: 'blur', name: 'Soft Blur', desc: 'Cinematic overall lens softening' },
  { type: 'background-blur', name: 'Background Blur', desc: 'Radial center focus with blurred edge perimeter' },
  { type: 'rgb-split', name: 'RGB Split', desc: 'Chromatic aberration color fringing' },
  { type: 'glitch', name: 'Glitch Displacement', desc: 'Digital compression artifacts & scanlines' },
  { type: 'vhs', name: 'VHS Tape', desc: 'Retro tape tracking noise & saturation' },
  { type: 'light-leaks', name: 'Light Leaks', desc: 'Organic warm lens flare bleed' },
  { type: 'film-burn', name: 'Film Burn', desc: 'Vintage celluloid edge flash' },
  { type: 'camera-shake', name: 'Camera Shake', desc: 'Handheld dynamic camera pulse' },
  { type: 'zoom', name: 'Cinematic Zoom', desc: 'Subtle slow punch-in' },
];

export function EditorInspectorPage({
  project,
  onProjectUpdated,
  onNavigate,
  activeSection,
  onSelectSection,
  videoRef,
  drawMode,
  onSetDrawMode,
  selectedBlurId,
  onSelectBlur,
  selectedLogoId,
  onSelectLogo,
  selectedElement = null,
  onSelectElement,
  onUpdateSubtitleStyle,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
}: EditorInspectorPageProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);
  const canvasSaveTimerRef = useRef<number | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadStage, setUploadStage] = useState('');
  const [busyAudio, setBusyAudio] = useState(false);
  const [busyBgUpload, setBusyBgUpload] = useState(false);
  const [extractedAudio, setExtractedAudio] = useState<{
    audioUrl: string;
    downloadUrl: string;
    filename: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fxConfig: VideoEffectsConfig = project.videoEffects || DEFAULT_VIDEO_EFFECTS;
  const adjustments: ColorAdjustments = fxConfig.adjustments || DEFAULT_COLOR_ADJUSTMENTS;
  const canvasConfig: VideoCanvasConfig = {
    ...DEFAULT_VIDEO_CANVAS,
    ...(project.canvas || {}),
  };
  const resolvedCanvasDims = resolveCanvasDimensions(
    canvasConfig,
    project.exportSettings,
    project.metadata
  );

  const updateCanvasConfig = (
    patch: Partial<VideoCanvasConfig>,
    opts?: { immediate?: boolean; syncExportAspect?: CanvasAspectRatio }
  ) => {
    const nextCanvas: VideoCanvasConfig = { ...canvasConfig, ...patch };
    const nextExport = opts?.syncExportAspect
      ? { ...project.exportSettings, aspectRatio: opts.syncExportAspect }
      : project.exportSettings;
    const nextWorkflow = createWorkflowUpdate(project.workflow, {
      completeStage: 'editor',
      modifiedStage: 'editor',
      hasExistingExport: Boolean(project.lastExportUrl),
    });

    onProjectUpdated({
      ...project,
      canvas: nextCanvas,
      exportSettings: nextExport,
      workflow: nextWorkflow,
    });

    if (canvasSaveTimerRef.current) window.clearTimeout(canvasSaveTimerRef.current);
    const delay = opts?.immediate ? 0 : 280;
    canvasSaveTimerRef.current = window.setTimeout(() => {
      void api
        .updateProject(project.id, {
          canvas: nextCanvas,
          exportSettings: nextExport,
          workflow: nextWorkflow,
        })
        .then(({ project: saved }) => onProjectUpdated(saved))
        .catch(() => {});
    }, delay);
  };

  const handleUploadBgImage = async (file: File) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyBgUpload(true);
    try {
      const res = await api.uploadCanvasBackground(project.id, file);
      onProjectUpdated(res.project);
      setSuccessMsg(`Uploaded canvas background image "${res.filename}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyBgUpload(false);
    }
  };

  const updateEffectsConfig = async (patch: Partial<VideoEffectsConfig>) => {
    const nextConfig: VideoEffectsConfig = { ...fxConfig, ...patch };
    const nextWorkflow = createWorkflowUpdate(project.workflow, {
      completeStage: 'editor',
      modifiedStage: 'editor',
      hasExistingExport: Boolean(project.lastExportUrl),
    });
    onProjectUpdated({ ...project, videoEffects: nextConfig, workflow: nextWorkflow });
    const { project: saved } = await api.updateProject(project.id, {
      videoEffects: nextConfig,
      workflow: nextWorkflow,
    });
    onProjectUpdated(saved);
  };

  const updateAdjustments = async (patch: Partial<ColorAdjustments>) => {
    const nextAdj: ColorAdjustments = { ...adjustments, ...patch };
    await updateEffectsConfig({ adjustments: nextAdj });
  };

  const resetAdjustments = async () => {
    await updateEffectsConfig({ adjustments: DEFAULT_COLOR_ADJUSTMENTS });
    setSuccessMsg('Reset all color adjustments to zero.');
  };

  const setFilterPreset = async (preset: ColorFilterPreset) => {
    await updateEffectsConfig({ filterPreset: preset });
  };

  const toggleEffect = async (type: VisualEffectType) => {
    const existing = fxConfig.effects || [];
    const found = existing.find((e) => e.type === type);
    let nextEffects: VisualEffectItem[];

    if (found) {
      nextEffects = existing.map((e) => (e.type === type ? { ...e, enabled: !e.enabled } : e));
    } else {
      nextEffects = [
        ...existing,
        {
          id: uuidv4(),
          type,
          enabled: true,
          intensity: 50,
          startTime: 0,
          endTime: 0,
        },
      ];
    }
    await updateEffectsConfig({ effects: nextEffects });
  };

  const updateEffectItem = async (type: VisualEffectType, patch: Partial<VisualEffectItem>) => {
    const existing = fxConfig.effects || [];
    const nextEffects = existing.map((e) => (e.type === type ? { ...e, ...patch } : e));
    await updateEffectsConfig({ effects: nextEffects });
  };

  const handleReplaceVideo = async (file: File) => {
    setErrorMsg(null);
    try {
      setUploadPct(2);
      const updated = await uploadVideoChunked({
        projectId: project.id,
        file,
        onProgress: (pct, stage) => {
          setUploadPct(pct);
          setUploadStage(stage);
        },
      });
      onProjectUpdated(updated);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadPct(null);
      setUploadStage('');
    }
  };

  const handleExtractAudio = async () => {
    setErrorMsg(null);
    setBusyAudio(true);
    try {
      const res = await api.extractAudio(project.id);
      setExtractedAudio(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAudio(false);
    }
  };

  const activeEffectsCount = (fxConfig.effects || []).filter((e) => e.enabled).length;

  return (
    <div className="space-y-4">
      {/* Stage Header */}
      <div className="border-b border-white/[0.08] pb-3 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-display font-semibold text-white flex items-center gap-2">
              <Palette className="w-4 h-4 text-violet-400" />
              Stage 5: Editing, Canvas &amp; Effects
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Resize canvas, fill background, grade colors, blur regions, and position brand logos.
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onUndo && (
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo}
                title="Undo (Ctrl/Cmd+Z)"
                className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 disabled:opacity-35 border border-white/[0.08] text-zinc-200 cursor-pointer"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
            )}
            {onRedo && (
              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo}
                title="Redo (Ctrl/Cmd+Shift+Z)"
                className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 disabled:opacity-35 border border-white/[0.08] text-zinc-200 cursor-pointer"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => onNavigate('captions')}
              className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-sm"
            >
              Next: Captions →
            </button>
          </div>
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

      {/* Stage 5 Unified Navigation Tabs */}
      <div className="flex flex-wrap border-b border-white/[0.08] gap-x-3.5 gap-y-1.5 text-xs font-medium text-zinc-400">
        {(
          [
            { id: 'canvas', label: 'Canvas & Fill' },
            { id: 'layers', label: 'Layers' },
            { id: 'filters', label: `Filters (${fxConfig.filterPreset})` },
            { id: 'adjustments', label: 'Adjustments' },
            { id: 'effects', label: `FX (${activeEffectsCount})` },
            { id: 'blur', label: `A. Blur (${project.blurs.length})` },
            { id: 'branding', label: `B. Logos (${project.logos.length})` },
            { id: 'media', label: 'Media' },
          ] as Array<{ id: EditorSection; label: string }>
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelectSection(t.id)}
            className={`pb-2 transition-colors relative whitespace-nowrap cursor-pointer ${
              activeSection === t.id ? 'text-violet-400 font-semibold' : 'hover:text-zinc-200'
            }`}
          >
            {t.label}
            {activeSection === t.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* SECTION: Unified Canvas Layers Stack */}
      {activeSection === 'layers' && (
        <LayerPanel
          project={project}
          selectedElement={selectedElement}
          onSelectElement={(sel) => {
            onSelectElement?.(sel);
            if (sel?.kind === 'blur') onSelectBlur(sel.id);
            if (sel?.kind === 'logo') onSelectLogo(sel.id);
          }}
          onUpdateCanvas={(patch, opts) => updateCanvasConfig(patch, opts)}
          onUpdateBlurs={async (nextBlurs: BlurEffect[]) => {
            onProjectUpdated({ ...project, blurs: nextBlurs });
            const { project: saved } = await api.updateProject(project.id, { blurs: nextBlurs });
            onProjectUpdated(saved);
          }}
          onUpdateLogos={async (nextLogos: LogoOverlay[]) => {
            onProjectUpdated({ ...project, logos: nextLogos });
            const { project: saved } = await api.updateProject(project.id, { logos: nextLogos });
            onProjectUpdated(saved);
          }}
          onUpdateSubtitleStyle={(patch) => {
            if (onUpdateSubtitleStyle) {
              onUpdateSubtitleStyle(patch);
            } else {
              const nextStyle = { ...project.subtitleStyle, ...patch };
              onProjectUpdated({ ...project, subtitleStyle: nextStyle });
              void api.updateProject(project.id, { subtitleStyle: nextStyle }).then(({ project: s }) => onProjectUpdated(s));
            }
          }}
        />
      )}

      {/* SECTION: Canvas Resize, Crop & Background Fill */}
      {activeSection === 'canvas' && (
        <div className="space-y-4">
          {/* Output Frame Aspect Ratio */}
          <div className="p-3.5 rounded-xl bg-[#18181D] border border-white/[0.08] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Maximize className="w-3.5 h-3.5 text-violet-400" />
                Aspect Ratio &amp; Output Canvas
              </span>
              <span className="text-[11px] font-mono text-violet-300 tabular-nums">
                {resolvedCanvasDims.width} × {resolvedCanvasDims.height}
              </span>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {(
                [
                  { id: 'original', label: 'Original' },
                  { id: '9:16', label: '9:16' },
                  { id: '16:9', label: '16:9' },
                  { id: '1:1', label: '1:1' },
                  { id: 'custom', label: 'Custom' },
                ] as Array<{ id: CanvasAspectRatio; label: string }>
              ).map((ratio) => (
                <button
                  key={ratio.id}
                  type="button"
                  onClick={() =>
                    updateCanvasConfig(
                      { aspectRatio: ratio.id },
                      { immediate: true, syncExportAspect: ratio.id }
                    )
                  }
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    canvasConfig.aspectRatio === ratio.id
                      ? 'bg-violet-600 border-violet-500 text-white'
                      : 'bg-zinc-900 border-white/[0.06] text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {ratio.label}
                </button>
              ))}
            </div>

            {canvasConfig.aspectRatio === 'custom' && (
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <div>
                  <label className="text-[10px] text-zinc-400">Custom Width (px)</label>
                  <input
                    type="number"
                    min={240}
                    max={3840}
                    step={2}
                    value={canvasConfig.customWidth}
                    onChange={(e) =>
                      updateCanvasConfig({
                        customWidth: Math.max(240, Math.min(3840, Number(e.target.value) || 1080)),
                      })
                    }
                    className="mt-1 w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-xs font-mono text-zinc-100"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-400">Custom Height (px)</label>
                  <input
                    type="number"
                    min={240}
                    max={3840}
                    step={2}
                    value={canvasConfig.customHeight}
                    onChange={(e) =>
                      updateCanvasConfig({
                        customHeight: Math.max(240, Math.min(3840, Number(e.target.value) || 1920)),
                      })
                    }
                    className="mt-1 w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-xs font-mono text-zinc-100"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Framing, Zoom & Position */}
          <div className="p-3.5 rounded-xl bg-[#18181D] border border-white/[0.08] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white">Resize &amp; Position</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    updateCanvasConfig({ zoom: 1.0, offsetX: 0, offsetY: 0 }, { immediate: true })
                  }
                  className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[10.5px] text-zinc-200 cursor-pointer"
                >
                  Fit Frame
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const srcW = project.metadata?.width || 1280;
                    const srcH = project.metadata?.height || 720;
                    const dstW = resolvedCanvasDims.width || srcW;
                    const dstH = resolvedCanvasDims.height || srcH;
                    const srcRatio = srcW / Math.max(1, srcH);
                    const dstRatio = dstW / Math.max(1, dstH);
                    const coverZoom =
                      srcRatio > dstRatio ? srcRatio / dstRatio : dstRatio / srcRatio;
                    updateCanvasConfig(
                      {
                        zoom: Number(Math.min(3.0, Math.max(1.0, coverZoom)).toFixed(2)),
                        offsetX: 0,
                        offsetY: 0,
                      },
                      { immediate: true }
                    );
                  }}
                  className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[10.5px] text-zinc-200 cursor-pointer"
                >
                  Fill Frame
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateCanvasConfig(DEFAULT_VIDEO_CANVAS, {
                      immediate: true,
                      syncExportAspect: 'original',
                    })
                  }
                  className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-[10.5px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                >
                  Reset
                </button>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-zinc-300">
                <span>Zoom / Scale</span>
                <span className="font-mono tabular-nums text-zinc-200">
                  {Math.round(canvasConfig.zoom * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.25}
                max={3.0}
                step={0.02}
                value={canvasConfig.zoom}
                onChange={(e) => updateCanvasConfig({ zoom: Number(e.target.value) })}
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between text-[11px] text-zinc-300">
                  <span>Move X</span>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {canvasConfig.offsetX > 0 ? '+' : ''}
                    {canvasConfig.offsetX}%
                  </span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={canvasConfig.offsetX}
                  onChange={(e) => updateCanvasConfig({ offsetX: Number(e.target.value) })}
                  className="mt-1 w-full accent-violet-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-zinc-300">
                  <span>Move Y</span>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {canvasConfig.offsetY > 0 ? '+' : ''}
                    {canvasConfig.offsetY}%
                  </span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={canvasConfig.offsetY}
                  onChange={(e) => updateCanvasConfig({ offsetY: Number(e.target.value) })}
                  className="mt-1 w-full accent-violet-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1 border-t border-white/[0.06]">
              <div>
                <div className="flex justify-between text-[11px] text-zinc-300">
                  <span>Video Rotation</span>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {Math.round(canvasConfig.videoRotation ?? 0)}°
                  </span>
                </div>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={canvasConfig.videoRotation ?? 0}
                  onChange={(e) => updateCanvasConfig({ videoRotation: Number(e.target.value) })}
                  className="mt-1 w-full accent-violet-500"
                />
              </div>
              <div>
                <div className="flex justify-between text-[11px] text-zinc-300">
                  <span>Video Opacity</span>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {Math.round((canvasConfig.videoOpacity ?? 1) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={canvasConfig.videoOpacity ?? 1}
                  onChange={(e) => updateCanvasConfig({ videoOpacity: Number(e.target.value) })}
                  className="mt-1 w-full accent-violet-500"
                />
              </div>
            </div>
          </div>

          {/* Crop Margins */}
          <div className="p-3.5 rounded-xl bg-[#18181D] border border-white/[0.08] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Crop className="w-3.5 h-3.5 text-violet-400" />
                Video Crop Margins (%)
              </span>
              {(canvasConfig.cropTop > 0 ||
                canvasConfig.cropRight > 0 ||
                canvasConfig.cropBottom > 0 ||
                canvasConfig.cropLeft > 0) && (
                <button
                  type="button"
                  onClick={() =>
                    updateCanvasConfig(
                      { cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 },
                      { immediate: true }
                    )
                  }
                  className="text-[10.5px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                >
                  Clear Crop
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              {(
                [
                  { key: 'cropTop', label: 'Top' },
                  { key: 'cropBottom', label: 'Bottom' },
                  { key: 'cropLeft', label: 'Left' },
                  { key: 'cropRight', label: 'Right' },
                ] as const
              ).map((side) => (
                <div key={side.key}>
                  <div className="flex justify-between text-[11px] text-zinc-300">
                    <span>{side.label}</span>
                    <span className="font-mono tabular-nums text-zinc-400">
                      {canvasConfig[side.key]}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={45}
                    step={1}
                    value={canvasConfig[side.key]}
                    onChange={(e) =>
                      updateCanvasConfig({ [side.key]: Number(e.target.value) })
                    }
                    className="mt-1 w-full accent-violet-500"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Canvas Background Fill */}
          <div className="p-3.5 rounded-xl bg-[#18181D] border border-white/[0.08] space-y-3">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-violet-400" />
              Canvas Background Fill
            </span>

            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'solid', label: 'Solid Color' },
                  { id: 'image', label: 'Image Fill' },
                  { id: 'blur', label: 'Blur Video' },
                ] as Array<{ id: CanvasBackgroundType; label: string }>
              ).map((bg) => (
                <button
                  key={bg.id}
                  type="button"
                  onClick={() => updateCanvasConfig({ backgroundType: bg.id }, { immediate: true })}
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    canvasConfig.backgroundType === bg.id
                      ? 'bg-violet-600 border-violet-500 text-white'
                      : 'bg-zinc-900 border-white/[0.06] text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {bg.label}
                </button>
              ))}
            </div>

            {canvasConfig.backgroundType === 'solid' && (
              <div className="space-y-2.5 pt-1">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(canvasConfig.bgColor) ? canvasConfig.bgColor : '#09090B'}
                    onChange={(e) => updateCanvasConfig({ bgColor: e.target.value })}
                    className="w-9 h-9 rounded bg-transparent cursor-pointer shrink-0"
                  />
                  <input
                    type="text"
                    value={canvasConfig.bgColor}
                    onChange={(e) => updateCanvasConfig({ bgColor: e.target.value })}
                    placeholder="#09090B"
                    className="flex-1 bg-zinc-900 border border-white/[0.08] rounded-md px-2.5 py-1.5 text-xs font-mono text-zinc-100"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {['#09090B', '#000000', '#18181B', '#1E1B4B', '#312E81', '#FFFFFF'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => updateCanvasConfig({ bgColor: c }, { immediate: true })}
                      style={{ backgroundColor: c }}
                      title={c}
                      className={`w-6 h-6 rounded-full border cursor-pointer ${
                        canvasConfig.bgColor.toUpperCase() === c
                          ? 'border-violet-400 ring-2 ring-violet-500/40'
                          : 'border-white/20'
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}

            {canvasConfig.backgroundType === 'image' && (
              <div className="space-y-3 pt-1">
                <input
                  ref={bgFileRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUploadBgImage(f);
                    e.target.value = '';
                  }}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-zinc-400 truncate">
                    {canvasConfig.bgImageFilename || 'No background image uploaded'}
                  </span>
                  <button
                    type="button"
                    disabled={busyBgUpload}
                    onClick={() => bgFileRef.current?.click()}
                    className="px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    {busyBgUpload ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <UploadCloud className="w-3.5 h-3.5" />
                    )}
                    {canvasConfig.bgImageUrl ? 'Replace Image' : 'Upload Image'}
                  </button>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-zinc-300">
                    <span>Background Scale</span>
                    <span className="font-mono tabular-nums">
                      {Math.round(canvasConfig.bgImageScale * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={2.5}
                    step={0.05}
                    value={canvasConfig.bgImageScale}
                    onChange={(e) => updateCanvasConfig({ bgImageScale: Number(e.target.value) })}
                    className="mt-1 w-full accent-violet-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex justify-between text-[11px] text-zinc-300">
                      <span>BG Offset X</span>
                      <span className="font-mono tabular-nums">{canvasConfig.bgImageOffsetX}%</span>
                    </div>
                    <input
                      type="range"
                      min={-50}
                      max={50}
                      step={1}
                      value={canvasConfig.bgImageOffsetX}
                      onChange={(e) =>
                        updateCanvasConfig({ bgImageOffsetX: Number(e.target.value) })
                      }
                      className="mt-1 w-full accent-violet-500"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-zinc-300">
                      <span>BG Offset Y</span>
                      <span className="font-mono tabular-nums">{canvasConfig.bgImageOffsetY}%</span>
                    </div>
                    <input
                      type="range"
                      min={-50}
                      max={50}
                      step={1}
                      value={canvasConfig.bgImageOffsetY}
                      onChange={(e) =>
                        updateCanvasConfig({ bgImageOffsetY: Number(e.target.value) })
                      }
                      className="mt-1 w-full accent-violet-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-white/[0.06]">
                  <div>
                    <div className="flex justify-between text-[11px] text-zinc-300">
                      <span>BG Rotation</span>
                      <span className="font-mono tabular-nums">
                        {Math.round(canvasConfig.bgImageRotation ?? 0)}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={canvasConfig.bgImageRotation ?? 0}
                      onChange={(e) =>
                        updateCanvasConfig({ bgImageRotation: Number(e.target.value) })
                      }
                      className="mt-1 w-full accent-violet-500"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-zinc-300">
                      <span>BG Opacity</span>
                      <span className="font-mono tabular-nums">
                        {Math.round((canvasConfig.bgImageOpacity ?? 1) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={canvasConfig.bgImageOpacity ?? 1}
                      onChange={(e) =>
                        updateCanvasConfig({ bgImageOpacity: Number(e.target.value) })
                      }
                      className="mt-1 w-full accent-violet-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {canvasConfig.backgroundType === 'blur' && (
              <div className="space-y-2.5 pt-1">
                <div>
                  <div className="flex justify-between text-[11px] text-zinc-300">
                    <span>Background Blur Intensity</span>
                    <span className="font-mono tabular-nums">{canvasConfig.bgBlurIntensity}px</span>
                  </div>
                  <input
                    type="range"
                    min={4}
                    max={60}
                    step={1}
                    value={canvasConfig.bgBlurIntensity}
                    onChange={(e) =>
                      updateCanvasConfig({ bgBlurIntensity: Number(e.target.value) })
                    }
                    className="mt-1 w-full accent-violet-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex justify-between text-[11px] text-zinc-300">
                      <span>Brightness</span>
                      <span className="font-mono tabular-nums">
                        {canvasConfig.bgBlurBrightness}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-60}
                      max={60}
                      step={2}
                      value={canvasConfig.bgBlurBrightness}
                      onChange={(e) =>
                        updateCanvasConfig({ bgBlurBrightness: Number(e.target.value) })
                      }
                      className="mt-1 w-full accent-violet-500"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-zinc-300">
                      <span>Opacity</span>
                      <span className="font-mono tabular-nums">
                        {Math.round(canvasConfig.bgBlurOpacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={1.0}
                      step={0.05}
                      value={canvasConfig.bgBlurOpacity}
                      onChange={(e) =>
                        updateCanvasConfig({ bgBlurOpacity: Number(e.target.value) })
                      }
                      className="mt-1 w-full accent-violet-500"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Saved Editing / Canvas Layout Presets */}
          <PresetLibraryPanel
            category="editing"
            title="Saved Canvas & Editing Presets"
            subtitle="Save aspect ratio, zoom, crop, background fill, and branding layout templates across videos."
            getPayload={() => {
              const assetRefs: StudioPresetAssetRef[] = [];
              if (canvasConfig.backgroundType === 'image' && canvasConfig.bgImageUrl) {
                assetRefs.push({
                  kind: 'background-image',
                  label: canvasConfig.bgImageFilename || 'Background Image',
                  url: canvasConfig.bgImageUrl,
                  filename: canvasConfig.bgImageFilename,
                });
              }
              return {
                payload: {
                  canvas: canvasConfig,
                  logos: project.logos,
                },
                assetRefs,
                thumbnailStyle: {
                  bg: canvasConfig.bgColor || '#18181D',
                  fg: '#FFFFFF',
                  sampleText: canvasConfig.aspectRatio === 'original' ? 'RAW' : canvasConfig.aspectRatio,
                  badge: `${canvasConfig.backgroundType} · ${Math.round(canvasConfig.zoom * 100)}% zoom`,
                },
              };
            }}
            onApplyPreset={async (preset: StudioPreset) => {
              const res = await api.applyPresetsToProject(project.id, {
                editingPresetId: preset.id,
              });
              onProjectUpdated(res.project);
              if (res.presetWarnings && res.presetWarnings.length > 0) {
                setErrorMsg(
                  `Applied "${preset.name}", but missing asset: ${res.presetWarnings[0].missingAssets
                    .map((a) => a.label)
                    .join(', ')}. Re-upload it below.`
                );
              } else {
                setSuccessMsg(`Applied editing template "${preset.name}".`);
              }
            }}
            onReuploadMissingAsset={async (_missing, preset, file) => {
              const uploaded = await api.uploadCanvasBackground(project.id, file);
              onProjectUpdated(uploaded.project);
              await api.updatePreset(preset.id, {
                payload: {
                  ...(preset.payload || {}),
                  canvas: {
                    ...((preset.payload?.canvas as Record<string, unknown>) || {}),
                    bgImageUrl: uploaded.url,
                    bgImageFilename: uploaded.filename,
                  },
                },
                assetRefs: [
                  {
                    kind: 'background-image',
                    label: uploaded.filename,
                    url: uploaded.url,
                    filename: uploaded.filename,
                  },
                ],
              });
              setSuccessMsg(`Re-uploaded background "${uploaded.filename}" and updated "${preset.name}".`);
            }}
          />
        </div>
      )}

      {/* TAB 1: Color Filter Presets */}
      {activeSection === 'filters' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Select Cinematic Color Palette</span>
            <span className="font-mono text-zinc-300">Active: {fxConfig.filterPreset}</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {FILTER_PRESETS.map((preset) => {
              const active = fxConfig.filterPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => void setFilterPreset(preset.id)}
                  className={`p-3 rounded-xl text-left border transition-all cursor-pointer relative overflow-hidden group ${
                    active
                      ? 'bg-violet-600/20 border-violet-500 shadow-sm'
                      : 'bg-[#18181D] border-white/[0.06] hover:border-white/[0.15]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div
                      className="w-4 h-4 rounded-full border border-white/20"
                      style={{ backgroundColor: preset.previewColor }}
                    />
                    {active && <Check className="w-3.5 h-3.5 text-violet-400" />}
                  </div>
                  <div className="text-xs font-semibold text-white">{preset.name}</div>
                  <div className="text-[10px] text-zinc-400 mt-0.5 line-clamp-1">{preset.desc}</div>
                </button>
              );
            })}
          </div>

          <div className="p-3 rounded-lg bg-zinc-900 border border-white/[0.06] flex items-center justify-between text-xs text-zinc-400">
            <span>Compare with raw video footage:</span>
            <span className="text-zinc-300">Use "Filters / Effects" button on top of player</span>
          </div>

          <PresetLibraryPanel
            category="filter"
            title="Saved Filter & Color Grade Presets"
            subtitle="Save color filter, adjustments, and FX combinations for instant reuse."
            getPayload={() => {
              const found = FILTER_PRESETS.find((f) => f.id === fxConfig.filterPreset);
              return {
                payload: fxConfig as unknown as Record<string, unknown>,
                thumbnailStyle: {
                  bg: found?.previewColor || '#7C3AED',
                  fg: '#FFFFFF',
                  sampleText: 'FX',
                  badge: `${fxConfig.filterPreset} · ${activeEffectsCount} FX`,
                },
              };
            }}
            onApplyPreset={async (preset) => {
              const res = await api.applyPresetsToProject(project.id, {
                filterPresetId: preset.id,
              });
              onProjectUpdated(res.project);
              setSuccessMsg(`Applied filter preset "${preset.name}".`);
            }}
          />
        </div>
      )}

      {/* TAB 2: Fine Color Adjustments */}
      {activeSection === 'adjustments' && (
        <div className="p-4 rounded-xl bg-[#18181D] border border-white/[0.08] space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-violet-400" />
              Primary Color Grading Sliders
            </span>
            <button
              onClick={resetAdjustments}
              className="text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              Reset All
            </button>
          </div>

          {/* Core Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5">
            {/* Brightness */}
            <div>
              <div className="flex justify-between text-[11px] text-zinc-300">
                <span>Brightness</span>
                <span className="font-mono text-zinc-400">{adjustments.brightness}</span>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                value={adjustments.brightness}
                onChange={(e) => void updateAdjustments({ brightness: Number(e.target.value) })}
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            {/* Contrast */}
            <div>
              <div className="flex justify-between text-[11px] text-zinc-300">
                <span>Contrast</span>
                <span className="font-mono text-zinc-400">{adjustments.contrast}</span>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                value={adjustments.contrast}
                onChange={(e) => void updateAdjustments({ contrast: Number(e.target.value) })}
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            {/* Saturation */}
            <div>
              <div className="flex justify-between text-[11px] text-zinc-300">
                <span>Saturation</span>
                <span className="font-mono text-zinc-400">{adjustments.saturation}</span>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                value={adjustments.saturation}
                onChange={(e) => void updateAdjustments({ saturation: Number(e.target.value) })}
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            {/* Exposure */}
            <div>
              <div className="flex justify-between text-[11px] text-zinc-300">
                <span>Exposure</span>
                <span className="font-mono text-zinc-400">{adjustments.exposure}</span>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                value={adjustments.exposure}
                onChange={(e) => void updateAdjustments({ exposure: Number(e.target.value) })}
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            {/* Temperature */}
            <div>
              <div className="flex justify-between text-[11px] text-zinc-300">
                <span>Temperature (Cool / Warm)</span>
                <span className="font-mono text-zinc-400">{adjustments.temperature}</span>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                value={adjustments.temperature}
                onChange={(e) => void updateAdjustments({ temperature: Number(e.target.value) })}
                className="mt-1 w-full accent-amber-500"
              />
            </div>

            {/* Tint */}
            <div>
              <div className="flex justify-between text-[11px] text-zinc-300">
                <span>Tint (Green / Magenta)</span>
                <span className="font-mono text-zinc-400">{adjustments.tint}</span>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                value={adjustments.tint}
                onChange={(e) => void updateAdjustments({ tint: Number(e.target.value) })}
                className="mt-1 w-full accent-fuchsia-500"
              />
            </div>

            {/* Sharpness */}
            <div>
              <div className="flex justify-between text-[11px] text-zinc-300">
                <span>Sharpness</span>
                <span className="font-mono text-zinc-400">{adjustments.sharpness}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={adjustments.sharpness}
                onChange={(e) => void updateAdjustments({ sharpness: Number(e.target.value) })}
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            {/* Vignette */}
            <div>
              <div className="flex justify-between text-[11px] text-zinc-300">
                <span>Vignette Edge Falloff</span>
                <span className="font-mono text-zinc-400">{adjustments.vignette}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={adjustments.vignette}
                onChange={(e) => void updateAdjustments({ vignette: Number(e.target.value) })}
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            {/* Highlights */}
            <div>
              <div className="flex justify-between text-[11px] text-zinc-300">
                <span>Highlights</span>
                <span className="font-mono text-zinc-400">{adjustments.highlights}</span>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                value={adjustments.highlights}
                onChange={(e) => void updateAdjustments({ highlights: Number(e.target.value) })}
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            {/* Shadows */}
            <div>
              <div className="flex justify-between text-[11px] text-zinc-300">
                <span>Shadows</span>
                <span className="font-mono text-zinc-400">{adjustments.shadows}</span>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                value={adjustments.shadows}
                onChange={(e) => void updateAdjustments({ shadows: Number(e.target.value) })}
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            {/* Fade */}
            <div>
              <div className="flex justify-between text-[11px] text-zinc-300">
                <span>Matte Film Fade</span>
                <span className="font-mono text-zinc-400">{adjustments.fade}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={adjustments.fade}
                onChange={(e) => void updateAdjustments({ fade: Number(e.target.value) })}
                className="mt-1 w-full accent-violet-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Visual Effects Checklist */}
      {activeSection === 'effects' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Special Visual Effects & Texture Layers</span>
            <span className="font-mono text-violet-400">{activeEffectsCount} Active</span>
          </div>

          <div className="space-y-2.5">
            {AVAILABLE_EFFECTS.map((fxDef) => {
              const item = (fxConfig.effects || []).find((e) => e.type === fxDef.type);
              const isEnabled = Boolean(item && item.enabled);
              const intensity = item ? item.intensity : 50;

              return (
                <div
                  key={fxDef.type}
                  className={`p-3.5 rounded-xl border transition-all ${
                    isEnabled
                      ? 'bg-violet-950/20 border-violet-500/40'
                      : 'bg-[#18181D] border-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={() => void toggleEffect(fxDef.type)}
                        className="accent-violet-500 rounded"
                      />
                      <div>
                        <div className="text-xs font-semibold text-white">{fxDef.name}</div>
                        <div className="text-[11px] text-zinc-400">{fxDef.desc}</div>
                      </div>
                    </label>

                    {isEnabled && (
                      <span className="text-[11px] font-mono text-violet-300 shrink-0">
                        {intensity}%
                      </span>
                    )}
                  </div>

                  {isEnabled && (
                    <div className="mt-3 pt-2.5 border-t border-white/[0.06] space-y-2">
                      <div className="flex justify-between text-[10px] text-zinc-400">
                        <span>Intensity</span>
                        <span className="font-mono">{intensity}%</span>
                      </div>
                      <input
                        type="range"
                        min={10}
                        max={100}
                        value={intensity}
                        onChange={(e) =>
                          void updateEffectItem(fxDef.type, { intensity: Number(e.target.value) })
                        }
                        className="w-full accent-violet-500"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION A: Blur & Motion Tracking */}
      {activeSection === 'blur' && (
        <BlurEditorPage
          project={project}
          onProjectUpdated={onProjectUpdated}
          videoRef={videoRef}
          drawMode={drawMode}
          onSetDrawMode={onSetDrawMode}
          selectedBlurId={selectedBlurId}
          onSelectBlur={onSelectBlur}
        />
      )}

      {/* SECTION B: Logo & Watermark */}
      {activeSection === 'branding' && (
        <BrandingPage
          project={project}
          onProjectUpdated={onProjectUpdated}
          selectedLogoId={selectedLogoId}
          onSelectLogo={onSelectLogo}
        />
      )}

      {/* TAB 4: Source Media Inspector */}
      {activeSection === 'media' && (
        <div className="space-y-4">
          {/* Project Title */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Project Title</label>
            <input
              type="text"
              value={project.name}
              onChange={async (e) => {
                const name = e.target.value;
                onProjectUpdated({ ...project, name });
              }}
              onBlur={async (e) => {
                const { project: saved } = await api.updateProject(project.id, {
                  name: e.target.value.trim() || 'Untitled Recap',
                });
                onProjectUpdated(saved);
              }}
              className="w-full bg-[#18181D] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-violet-500"
            />
          </div>

          {/* Upload / Replace Source Video */}
          <div className="p-3.5 rounded-lg bg-[#18181D] border border-white/[0.08] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-violet-400" />
                Source Video
              </span>
              <input
                ref={fileRef}
                type="file"
                accept=".mp4,.mov,.mkv,video/mp4,video/quicktime,video/x-matroska"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleReplaceVideo(f);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="px-2.5 py-1 rounded-md bg-violet-600 hover:bg-violet-500 text-[11px] font-medium text-white flex items-center gap-1 cursor-pointer"
              >
                <UploadCloud className="w-3 h-3" />
                {project.sourceVideoUrl ? 'Replace' : 'Upload'}
              </button>
            </div>

            {uploadPct !== null && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] text-zinc-400">
                  <span>{uploadStage}</span>
                  <span className="font-mono tabular-nums">{uploadPct}%</span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500" style={{ width: `${uploadPct}%` }} />
                </div>
              </div>
            )}

            {project.metadata ? (
              <dl className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs pt-1 border-t border-white/[0.06]">
                <div>
                  <dt className="text-[11px] text-zinc-500">Duration</dt>
                  <dd className="font-mono text-zinc-200 tabular-nums">
                    {formatDurationShort(project.metadata.duration)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-zinc-500">Resolution</dt>
                  <dd className="font-mono text-zinc-200 tabular-nums">
                    {project.metadata.width} × {project.metadata.height}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-zinc-500">File Size</dt>
                  <dd className="font-mono text-zinc-200 tabular-nums">
                    {formatBytes(project.metadata.fileSize)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-zinc-500">Frame Rate / Codec</dt>
                  <dd className="font-mono text-zinc-200 tabular-nums">
                    {project.metadata.fps} fps · {project.metadata.videoCodec}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-xs text-zinc-500">
                Supports MP4, MOV, and MKV files with chunked upload.
              </p>
            )}
          </div>

          {/* Audio Stream Extraction */}
          <div className="p-3.5 rounded-lg bg-[#18181D] border border-white/[0.08] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                <FileAudio className="w-3.5 h-3.5 text-zinc-400" />
                Original Audio Stream
              </span>
              <button
                onClick={handleExtractAudio}
                disabled={!project.metadata?.hasAudio || busyAudio}
                className="px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-[11px] font-medium text-zinc-200 flex items-center gap-1 cursor-pointer"
              >
                {busyAudio && <Loader2 className="w-3 h-3 animate-spin" />}
                Extract Audio Track
              </button>
            </div>

            {extractedAudio && (
              <div className="space-y-2 pt-1">
                <audio src={extractedAudio.audioUrl} controls className="w-full h-8" />
                <a
                  href={extractedAudio.downloadUrl}
                  className="inline-flex items-center gap-1.5 text-[11px] text-violet-400 hover:text-violet-300"
                >
                  <Download className="w-3 h-3" />
                  Download {extractedAudio.filename}
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
