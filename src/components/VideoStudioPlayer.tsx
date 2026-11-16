import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Grid,
  Maximize2,
  Pause,
  Play,
  RotateCw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  BlurEffect,
  DEFAULT_VIDEO_CANVAS,
  LogoOverlay,
  Project,
  SavedFontAsset,
  StudioElementSelection,
  SubtitleStyle,
  VideoCanvasConfig,
} from '../types/studio';
import { formatTimecode } from '../lib/formatters';
import { interpolateTrackingBox } from '../lib/visionEngine';
import {
  getActiveCaptionSourceText,
  normalizeCaptionDisplayMode,
  resolveCaptionWords,
} from '../lib/workflowStages';
import { buildOrderedLayerTokens } from './LayerPanel';

interface VideoStudioPlayerProps {
  project: Project;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  previewEffects: boolean;
  onTogglePreviewEffects: (val: boolean) => void;
  drawMode: 'none' | 'selective' | 'motion';
  onFinishDrawBox?: (box: { x: number; y: number; width: number; height: number }) => void;
  selectedLogoId?: string | null;
  onUpdateLogo?: (logoId: string, patch: Partial<LogoOverlay>) => void;
  selectedBlurId?: string | null;
  onUpdateBlur?: (blurId: string, patch: Partial<BlurEffect>) => void;
  onUpdateSubtitleStyle?: (patch: Partial<SubtitleStyle>) => void;
  selectedElement?: StudioElementSelection;
  onSelectElement?: (el: StudioElementSelection) => void;
  onUpdateCanvas?: (patch: Partial<VideoCanvasConfig>, opts?: { immediate?: boolean }) => void;
  customFonts?: SavedFontAsset[];
  readOnlyPreview?: boolean;
}

type ResizeHandleDir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

type ActiveInteraction =
  | {
      kind: 'blur';
      id: string;
      action: 'move' | 'resize' | 'rotate';
      dir?: ResizeHandleDir;
      startClientX: number;
      startClientY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
      origRot: number;
      centerClientX?: number;
      centerClientY?: number;
    }
  | {
      kind: 'logo';
      id: string;
      action: 'move' | 'resize' | 'rotate';
      dir?: ResizeHandleDir;
      startClientX: number;
      startClientY: number;
      origX: number;
      origY: number;
      origW: number;
      origRot: number;
      centerClientX?: number;
      centerClientY?: number;
    }
  | {
      kind: 'captions';
      action: 'move' | 'resize' | 'rotate';
      dir?: ResizeHandleDir;
      startClientX: number;
      startClientY: number;
      origX: number;
      origY: number;
      origScale: number;
      origRot: number;
      centerClientX?: number;
      centerClientY?: number;
    }
  | {
      kind: 'video';
      action: 'move' | 'resize' | 'rotate';
      dir?: ResizeHandleDir;
      startClientX: number;
      startClientY: number;
      origOffsetX: number;
      origOffsetY: number;
      origZoom: number;
      origRot: number;
      centerClientX?: number;
      centerClientY?: number;
      moved: boolean;
    }
  | {
      kind: 'bg-image';
      action: 'move' | 'resize' | 'rotate';
      dir?: ResizeHandleDir;
      startClientX: number;
      startClientY: number;
      origOffsetX: number;
      origOffsetY: number;
      origScale: number;
      origRot: number;
      centerClientX?: number;
      centerClientY?: number;
    };

const SNAP_TARGETS = [10, 50, 90];
const SNAP_THRESHOLD_PCT = 1.6;

function snapPercent(val: number): { snapped: number; line: number | null } {
  for (const target of SNAP_TARGETS) {
    if (Math.abs(val - target) <= SNAP_THRESHOLD_PCT) {
      return { snapped: target, line: target };
    }
  }
  return { snapped: val, line: null };
}

function hexToRgba(hex: string, opacity: number): string {
  const clean = (hex || '#09090B').replace('#', '');
  const r = parseInt(clean.slice(0, 2) || '09', 16) || 0;
  const g = parseInt(clean.slice(2, 4) || '09', 16) || 0;
  const b = parseInt(clean.slice(4, 6) || '0B', 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

const HANDLE_CURSORS: Record<ResizeHandleDir, string> = {
  nw: 'cursor-nwse-resize',
  se: 'cursor-nwse-resize',
  ne: 'cursor-nesw-resize',
  sw: 'cursor-nesw-resize',
  n: 'cursor-ns-resize',
  s: 'cursor-ns-resize',
  e: 'cursor-ew-resize',
  w: 'cursor-ew-resize',
};

const HANDLE_POSITIONS: Record<ResizeHandleDir, string> = {
  nw: '-top-1.5 -left-1.5',
  n: '-top-1.5 left-1/2 -translate-x-1/2',
  ne: '-top-1.5 -right-1.5',
  e: 'top-1/2 -translate-y-1/2 -right-1.5',
  se: '-bottom-1.5 -right-1.5',
  s: '-bottom-1.5 left-1/2 -translate-x-1/2',
  sw: '-bottom-1.5 -left-1.5',
  w: 'top-1/2 -translate-y-1/2 -left-1.5',
};

export function VideoStudioPlayer({
  project,
  currentTime,
  onTimeUpdate,
  videoRef,
  previewEffects,
  onTogglePreviewEffects,
  drawMode,
  onFinishDrawBox,
  selectedLogoId,
  onUpdateLogo,
  selectedBlurId,
  onUpdateBlur,
  onUpdateSubtitleStyle,
  selectedElement,
  onSelectElement,
  onUpdateCanvas,
  customFonts = [],
  readOnlyPreview = false,
}: VideoStudioPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bgVideoRef = useRef<HTMLVideoElement>(null);
  const dubAudioRef = useRef<HTMLAudioElement>(null);
  const musicAudioRef = useRef<HTMLAudioElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [aspectPreviewMode, setAspectPreviewMode] = useState<'original' | 'export'>(() => {
    const c = project.canvas || DEFAULT_VIDEO_CANVAS;
    return (c.aspectRatio && c.aspectRatio !== 'original') ||
      project.exportSettings.aspectRatio !== 'original'
      ? 'export'
      : 'original';
  });
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  const canvas = { ...DEFAULT_VIDEO_CANVAS, ...(project.canvas || {}) };
  const effectiveAspect =
    canvas.aspectRatio && canvas.aspectRatio !== 'original'
      ? canvas.aspectRatio
      : project.exportSettings.aspectRatio;

  const editingGuidesOn = !readOnlyPreview && canvas.showEditingGuides !== false;

  useEffect(() => {
    if (effectiveAspect !== 'original') {
      setAspectPreviewMode('export');
    }
  }, [effectiveAspect]);

  // Interactive box drawing state (for Selective / Motion Blur)
  const [dragDraw, setDragDraw] = useState<{
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);

  const [interaction, setInteraction] = useState<ActiveInteraction | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });

  // Video Filters & Effects Preview Controls
  const [compareModeActive, setCompareModeActive] = useState(false);
  const [showSafeGuides, setShowSafeGuides] = useState(
    Boolean(project.subtitleStyle.showSafeGuides)
  );

  useEffect(() => {
    setShowSafeGuides(Boolean(project.subtitleStyle.showSafeGuides));
  }, [project.subtitleStyle.showSafeGuides]);

  const duration = project.metadata?.duration || 0;
  const useDubAudio = Boolean(project.voice.enabled && project.voice.fullDubUrl);

  useEffect(() => {
    setNaturalSize(null);
    setIsPlaying(false);
  }, [project.sourceVideoUrl]);

  // Synchronize video & audio elements
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    if (useDubAudio) {
      vid.muted = muted || !project.voice.preserveOriginalAudio;
      vid.volume = project.voice.preserveOriginalAudio
        ? Math.min(1, project.voice.originalAudioVolume * volume)
        : 0;
    } else {
      vid.muted = muted;
      vid.volume = volume;
    }
    vid.playbackRate = playbackRate;
  }, [
    videoRef,
    useDubAudio,
    muted,
    volume,
    playbackRate,
    project.voice.preserveOriginalAudio,
    project.voice.originalAudioVolume,
  ]);

  useEffect(() => {
    if (bgVideoRef.current) {
      bgVideoRef.current.playbackRate = playbackRate;
    }
    const dub = dubAudioRef.current;
    if (dub) {
      dub.muted = muted;
      dub.volume = Math.min(1, Math.max(0, project.voice.voiceVolume * volume));
      dub.playbackRate = playbackRate;
    }
    const bgm = musicAudioRef.current;
    if (bgm) {
      bgm.muted = muted;
      bgm.volume = Math.min(1, Math.max(0, project.voice.bgMusicVolume * volume));
      bgm.playbackRate = playbackRate;
    }
  }, [muted, volume, playbackRate, project.voice.voiceVolume, project.voice.bgMusicVolume]);

  const togglePlay = async () => {
    const vid = videoRef.current;
    if (!vid || !project.sourceVideoUrl) return;
    if (vid.paused) {
      await vid.play();
      if (bgVideoRef.current) {
        bgVideoRef.current.currentTime = vid.currentTime;
        void bgVideoRef.current.play().catch(() => {});
      }
      if (dubAudioRef.current && useDubAudio) {
        const offset = project.voice.timingOffsetSec || 0;
        const dubTarget = Math.max(0, vid.currentTime - offset);
        dubAudioRef.current.currentTime = dubTarget;
        void dubAudioRef.current.play().catch(() => {});
      }
      if (musicAudioRef.current && project.voice.bgMusicUrl) {
        musicAudioRef.current.currentTime =
          vid.currentTime % Math.max(1, musicAudioRef.current.duration || 30);
        void musicAudioRef.current.play().catch(() => {});
      }
      setIsPlaying(true);
    } else {
      vid.pause();
      bgVideoRef.current?.pause();
      dubAudioRef.current?.pause();
      musicAudioRef.current?.pause();
      setIsPlaying(false);
    }
  };

  const seekTo = (t: number) => {
    const vid = videoRef.current;
    if (!vid) return;
    const clamped = Math.max(0, Math.min(duration || vid.duration || 0, t));
    vid.currentTime = clamped;
    if (bgVideoRef.current) {
      bgVideoRef.current.currentTime = clamped;
    }
    if (dubAudioRef.current && useDubAudio) {
      const offset = project.voice.timingOffsetSec || 0;
      dubAudioRef.current.currentTime = Math.max(0, clamped - offset);
    }
    if (musicAudioRef.current && project.voice.bgMusicUrl) {
      musicAudioRef.current.currentTime =
        clamped % Math.max(1, musicAudioRef.current.duration || 30);
    }
    onTimeUpdate(clamped);
  };

  const stepFrame = (dir: -1 | 1) => {
    const fps = project.metadata?.fps || 30;
    const vid = videoRef.current;
    if (vid && !vid.paused) {
      vid.pause();
      bgVideoRef.current?.pause();
      dubAudioRef.current?.pause();
      musicAudioRef.current?.pause();
      setIsPlaying(false);
    }
    seekTo(currentTime + dir * (1 / fps));
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current.requestFullscreen();
    }
  };

  // Layer z-index map aligned with backend video_render_service layerOrder
  const layerZIndexMap = useMemo(() => {
    const tokens = buildOrderedLayerTokens(project);
    const map = new Map<string, number>();
    tokens.forEach((tok, idx) => {
      map.set(tok, 10 + idx);
    });
    return map;
  }, [project]);

  const isSelectedEl = (check: Exclude<StudioElementSelection, null>): boolean => {
    if (readOnlyPreview) return false;
    if (selectedElement) {
      if (selectedElement.kind !== check.kind) return false;
      if (check.kind === 'blur' && selectedElement.kind === 'blur') {
        return check.id === selectedElement.id;
      }
      if (check.kind === 'logo' && selectedElement.kind === 'logo') {
        return check.id === selectedElement.id;
      }
      return true;
    }
    if (check.kind === 'blur') return check.id === selectedBlurId;
    if (check.kind === 'logo') return check.id === selectedLogoId;
    return false;
  };

  // Dynamic @font-face declarations for custom uploaded fonts
  const customFontCss = useMemo(() => {
    if (!customFonts || customFonts.length === 0) return '';
    return customFonts
      .map(
        (f) =>
          `@font-face { font-family: '${f.family.replace(/'/g, '')}'; src: url('${f.url}'); font-display: swap; }`
      )
      .join('\n');
  }, [customFonts]);

  // Active captions at currentTime
  const activeCaption = useMemo(() => {
    if (!previewEffects || !project.subtitleStyle.enabled || project.subtitleStyle.visible === false) {
      return null;
    }
    return project.captions.find((c) => currentTime >= c.start && currentTime <= c.end) || null;
  }, [previewEffects, project.subtitleStyle.enabled, project.subtitleStyle.visible, project.captions, currentTime]);

  // Active blur effects at currentTime
  const activeBlurs = useMemo(() => {
    if (!previewEffects) return [];
    return project.blurs.filter(
      (b) => b.enabled && currentTime >= b.startTime && currentTime <= b.endTime
    );
  }, [previewEffects, project.blurs, currentTime]);

  const fullBlurEffect = activeBlurs.find((b) => b.mode === 'full');
  const bgBlurEffect = activeBlurs.find((b) => b.mode === 'background');
  const boxBlurs = activeBlurs.filter((b) => b.mode === 'selective' || b.mode === 'motion');

  // Active logos at currentTime
  const activeLogos = useMemo(() => {
    if (!previewEffects) return [];
    return project.logos.filter(
      (l) => l.enabled && (l.permanent || (currentTime >= l.startTime && currentTime <= l.endTime))
    );
  }, [previewEffects, project.logos, currentTime]);

  // Computed Real-time CSS Video Filter
  const videoFilterCss = useMemo(() => {
    if (!previewEffects || compareModeActive) return undefined;
    const fx = project.videoEffects;
    if (!fx) return undefined;

    const parts: string[] = [];

    switch (fx.filterPreset) {
      case 'cinematic':
        parts.push('contrast(118%) saturate(112%) sepia(10%) hue-rotate(-5deg)');
        break;
      case 'vintage':
        parts.push('sepia(45%) contrast(92%) brightness(104%) saturate(75%)');
        break;
      case 'film':
        parts.push('contrast(112%) saturate(105%) sepia(8%)');
        break;
      case 'warm':
        parts.push('sepia(25%) saturate(115%) hue-rotate(-8deg)');
        break;
      case 'cool':
        parts.push('hue-rotate(15deg) saturate(95%) contrast(108%)');
        break;
      case 'black-white':
        parts.push('grayscale(100%) contrast(128%)');
        break;
      case 'high-contrast':
        parts.push('contrast(135%) brightness(97%) saturate(115%)');
        break;
      case 'moody':
        parts.push('contrast(122%) brightness(92%) saturate(82%) hue-rotate(10deg)');
        break;
      case 'faded':
        parts.push('contrast(86%) brightness(106%) saturate(82%)');
        break;
      case 'vibrant':
        parts.push('contrast(114%) brightness(101%) saturate(145%)');
        break;
      case 'natural':
        parts.push('contrast(105%) saturate(112%)');
        break;
    }

    const adj = fx.adjustments;
    if (adj) {
      const b = 1 + (adj.brightness + adj.exposure * 0.7) / 100;
      if (Math.abs(b - 1) > 0.01) parts.push(`brightness(${Math.max(0.2, Math.min(2.0, b)).toFixed(3)})`);

      const c = 1 + adj.contrast / 100;
      if (Math.abs(c - 1) > 0.01) parts.push(`contrast(${Math.max(0.2, Math.min(2.5, c)).toFixed(3)})`);

      let s = 1 + adj.saturation / 100;
      if (adj.fade > 0) s *= Math.max(0.4, 1 - (adj.fade / 100) * 0.4);
      if (Math.abs(s - 1) > 0.01) parts.push(`saturate(${Math.max(0, Math.min(3.0, s)).toFixed(3)})`);

      if (adj.temperature !== 0) {
        parts.push(
          adj.temperature > 0
            ? `sepia(${(adj.temperature * 0.35).toFixed(1)}%)`
            : `hue-rotate(${(adj.temperature * 0.3).toFixed(1)}deg)`
        );
      }
      if (adj.tint !== 0) {
        parts.push(`hue-rotate(${(adj.tint * 0.25).toFixed(1)}deg)`);
      }
    }

    const blurFx = fx.effects?.find((e) => e.enabled && e.type === 'blur');
    if (blurFx) {
      parts.push(`blur(${Math.max(1, Math.round((blurFx.intensity / 100) * 12))}px)`);
    }

    return parts.length > 0 ? parts.join(' ') : undefined;
  }, [previewEffects, compareModeActive, project.videoEffects]);

  // Active visual effects at currentTime
  const activeFx = useMemo(() => {
    if (!previewEffects || compareModeActive) return [];
    return (project.videoEffects?.effects || []).filter(
      (e) => e.enabled && (e.endTime === 0 || (currentTime >= e.startTime && currentTime <= e.endTime))
    );
  }, [previewEffects, compareModeActive, project.videoEffects, currentTime]);

  const grainFx = activeFx.find((e) => e.type === 'film-grain');
  const glowFx = activeFx.find((e) => e.type === 'glow');
  const vhsFx = activeFx.find(
    (e) => e.type === 'vhs' || e.type === 'rgb-split' || e.type === 'glitch'
  );
  const leakFx = activeFx.find((e) => e.type === 'light-leaks' || e.type === 'film-burn');
  const vignetteAmt =
    (project.videoEffects?.adjustments?.vignette || 0) > 0
      ? (project.videoEffects?.adjustments?.vignette || 0) / 100
      : project.videoEffects?.filterPreset === 'cinematic'
      ? 0.35
      : project.videoEffects?.filterPreset === 'vintage'
      ? 0.45
      : 0;

  const computeAngleFromCenter = (cx: number, cy: number, px: number, py: number) => {
    const deg = (Math.atan2(px - cx, -(py - cy)) * 180) / Math.PI;
    // Snap near cardinal 45-degree angles gently
    const snapped = Math.round(deg / 45) * 45;
    if (Math.abs(deg - snapped) < 3) return snapped;
    return Math.round(deg);
  };

  // Pointer handlers for stage drawing & unified element transform interactions
  const handleStageMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (readOnlyPreview) return;
    if (drawMode !== 'none' && stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      setDragDraw({ startX: x, startY: y, curX: x, curY: y });
      return;
    }
    // Clicked on empty stage backdrop -> deselect element & hide selection outline
    onSelectElement?.(null);
  };

  const handleStageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();

    if (dragDraw) {
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      setDragDraw({ ...dragDraw, curX: x, curY: y });
      return;
    }

    if (!interaction) return;
    const dx = (e.clientX - interaction.startClientX) / rect.width;
    const dy = (e.clientY - interaction.startClientY) / rect.height;

    if (interaction.kind === 'blur' && onUpdateBlur) {
      if (interaction.action === 'move') {
        const rawCenterX = (interaction.origX + dx + interaction.origW / 2) * 100;
        const rawCenterY = (interaction.origY + dy + interaction.origH / 2) * 100;
        const sx = snapPercent(rawCenterX);
        const sy = snapPercent(rawCenterY);
        setSnapGuides({ x: sx.line, y: sy.line });

        const finalX = sx.snapped / 100 - interaction.origW / 2;
        const finalY = sy.snapped / 100 - interaction.origH / 2;
        onUpdateBlur(interaction.id, {
          x: Number(Math.max(0, Math.min(1 - interaction.origW, finalX)).toFixed(3)),
          y: Number(Math.max(0, Math.min(1 - interaction.origH, finalY)).toFixed(3)),
        });
      } else if (interaction.action === 'resize') {
        const dir = interaction.dir || 'se';
        let nextX = interaction.origX;
        let nextY = interaction.origY;
        let nextW = interaction.origW;
        let nextH = interaction.origH;

        if (dir.includes('e')) nextW = Math.max(0.05, Math.min(1 - nextX, interaction.origW + dx));
        if (dir.includes('s')) nextH = Math.max(0.05, Math.min(1 - nextY, interaction.origH + dy));
        if (dir.includes('w')) {
          const clampedDx = Math.min(interaction.origW - 0.05, Math.max(-interaction.origX, dx));
          nextX = interaction.origX + clampedDx;
          nextW = interaction.origW - clampedDx;
        }
        if (dir.includes('n')) {
          const clampedDy = Math.min(interaction.origH - 0.05, Math.max(-interaction.origY, dy));
          nextY = interaction.origY + clampedDy;
          nextH = interaction.origH - clampedDy;
        }

        onUpdateBlur(interaction.id, {
          x: Number(nextX.toFixed(3)),
          y: Number(nextY.toFixed(3)),
          width: Number(nextW.toFixed(3)),
          height: Number(nextH.toFixed(3)),
        });
      } else if (interaction.action === 'rotate' && interaction.centerClientX && interaction.centerClientY) {
        const deg = computeAngleFromCenter(
          interaction.centerClientX,
          interaction.centerClientY,
          e.clientX,
          e.clientY
        );
        onUpdateBlur(interaction.id, { rotation: deg });
      }
      return;
    }

    if (interaction.kind === 'logo' && onUpdateLogo) {
      if (interaction.action === 'move') {
        const estCenterX = (interaction.origX + dx) * 100 + interaction.origW / 2;
        const estCenterY = (interaction.origY + dy) * 100 + 5;
        const sx = snapPercent(estCenterX);
        const sy = snapPercent(estCenterY);
        setSnapGuides({ x: sx.line, y: sy.line });
        const finalX = sx.line !== null ? (sx.snapped - interaction.origW / 2) / 100 : interaction.origX + dx;
        const finalY = sy.line !== null ? (sy.snapped - 5) / 100 : interaction.origY + dy;

        onUpdateLogo(interaction.id, {
          presetPosition: 'custom',
          x: Number(Math.max(0, Math.min(0.95, finalX)).toFixed(3)),
          y: Number(Math.max(0, Math.min(0.95, finalY)).toFixed(3)),
        });
      } else if (interaction.action === 'resize') {
        const dir = interaction.dir || 'se';
        const sign = dir.includes('w') ? -1 : 1;
        onUpdateLogo(interaction.id, {
          widthPct: Number(Math.max(4, Math.min(60, interaction.origW + sign * dx * 100)).toFixed(1)),
        });
      } else if (interaction.action === 'rotate' && interaction.centerClientX && interaction.centerClientY) {
        const deg = computeAngleFromCenter(
          interaction.centerClientX,
          interaction.centerClientY,
          e.clientX,
          e.clientY
        );
        onUpdateLogo(interaction.id, { rotation: deg });
      }
      return;
    }

    if (interaction.kind === 'captions' && onUpdateSubtitleStyle) {
      if (interaction.action === 'move') {
        const rawX = Math.max(5, Math.min(95, interaction.origX + dx * 100));
        const rawY = Math.max(5, Math.min(95, interaction.origY + dy * 100));
        const sx = snapPercent(rawX);
        const sy = snapPercent(rawY);
        setSnapGuides({ x: sx.line, y: sy.line });
        onUpdateSubtitleStyle({
          position: 'custom',
          posX: Math.round(sx.snapped),
          posY: Math.round(sy.snapped),
        });
      } else if (interaction.action === 'resize') {
        const dir = interaction.dir || 'se';
        const sign = dir.includes('w') ? -1 : 1;
        const nextScale = Math.max(0.5, Math.min(2.5, interaction.origScale + sign * dx * 1.6));
        onUpdateSubtitleStyle({ scale: Number(nextScale.toFixed(2)) });
      } else if (interaction.action === 'rotate' && interaction.centerClientX && interaction.centerClientY) {
        const deg = computeAngleFromCenter(
          interaction.centerClientX,
          interaction.centerClientY,
          e.clientX,
          e.clientY
        );
        onUpdateSubtitleStyle({ rotation: deg });
      }
      return;
    }

    if (interaction.kind === 'video' && onUpdateCanvas) {
      if (Math.abs(e.clientX - interaction.startClientX) > 3 || Math.abs(e.clientY - interaction.startClientY) > 3) {
        interaction.moved = true;
      }
      if (interaction.action === 'move') {
        const rawX = interaction.origOffsetX + dx * 100;
        const rawY = interaction.origOffsetY + dy * 100;
        const sx = Math.abs(rawX) < 1.8 ? 0 : rawX;
        const sy = Math.abs(rawY) < 1.8 ? 0 : rawY;
        setSnapGuides({ x: sx === 0 ? 50 : null, y: sy === 0 ? 50 : null });
        onUpdateCanvas({
          offsetX: Math.round(Math.max(-100, Math.min(100, sx))),
          offsetY: Math.round(Math.max(-100, Math.min(100, sy))),
        });
      } else if (interaction.action === 'resize') {
        const dir = interaction.dir || 'se';
        const delta = Math.abs(dx) > Math.abs(dy) ? (dir.includes('w') ? -dx : dx) : (dir.includes('n') ? -dy : dy);
        const nextZoom = Math.max(0.25, Math.min(3.0, interaction.origZoom + delta * 1.8));
        onUpdateCanvas({ zoom: Number(nextZoom.toFixed(2)) });
      } else if (interaction.action === 'rotate' && interaction.centerClientX && interaction.centerClientY) {
        const deg = computeAngleFromCenter(
          interaction.centerClientX,
          interaction.centerClientY,
          e.clientX,
          e.clientY
        );
        onUpdateCanvas({ videoRotation: deg });
      }
      return;
    }

    if (interaction.kind === 'bg-image' && onUpdateCanvas) {
      if (interaction.action === 'move') {
        onUpdateCanvas({
          bgImageOffsetX: Math.round(Math.max(-50, Math.min(50, interaction.origOffsetX + dx * 100))),
          bgImageOffsetY: Math.round(Math.max(-50, Math.min(50, interaction.origOffsetY + dy * 100))),
        });
      } else if (interaction.action === 'resize') {
        onUpdateCanvas({
          bgImageScale: Number(Math.max(0.5, Math.min(2.5, interaction.origScale + dx * 1.6)).toFixed(2)),
        });
      } else if (interaction.action === 'rotate' && interaction.centerClientX && interaction.centerClientY) {
        const deg = computeAngleFromCenter(
          interaction.centerClientX,
          interaction.centerClientY,
          e.clientX,
          e.clientY
        );
        onUpdateCanvas({ bgImageRotation: deg });
      }
    }
  };

  const handleStageMouseUp = () => {
    if (dragDraw && onFinishDrawBox) {
      const x = Math.min(dragDraw.startX, dragDraw.curX);
      const y = Math.min(dragDraw.startY, dragDraw.curY);
      const width = Math.abs(dragDraw.curX - dragDraw.startX);
      const height = Math.abs(dragDraw.curY - dragDraw.startY);
      if (width > 0.03 && height > 0.03) {
        onFinishDrawBox({
          x: Number(x.toFixed(3)),
          y: Number(y.toFixed(3)),
          width: Number(width.toFixed(3)),
          height: Number(height.toFixed(3)),
        });
      }
      setDragDraw(null);
    }

    if (interaction?.kind === 'video' && interaction.action === 'move' && !interaction.moved && drawMode === 'none') {
      void togglePlay();
    }

    if (interaction) {
      setInteraction(null);
      setSnapGuides({ x: null, y: null });
    }
  };

  const hasCustomCanvas =
    canvas.aspectRatio !== 'original' ||
    Math.abs((canvas.zoom || 1) - 1) > 0.005 ||
    Math.abs(canvas.offsetX || 0) > 0.1 ||
    Math.abs(canvas.offsetY || 0) > 0.1 ||
    Math.abs(canvas.videoRotation || 0) > 0.2 ||
    (canvas.videoOpacity ?? 1) < 0.99 ||
    canvas.videoVisible === false ||
    (canvas.cropTop || 0) > 0 ||
    (canvas.cropRight || 0) > 0 ||
    (canvas.cropBottom || 0) > 0 ||
    (canvas.cropLeft || 0) > 0 ||
    canvas.backgroundType !== 'solid' ||
    (canvas.bgColor || '#09090B').toUpperCase() !== '#09090B';

  const stageMetrics = useMemo(() => {
    const srcW = naturalSize?.w || project.metadata?.width || 16;
    const srcH = naturalSize?.h || project.metadata?.height || 9;

    let ratioW = srcW;
    let ratioH = srcH;

    if (aspectPreviewMode === 'export' && effectiveAspect !== 'original') {
      if (effectiveAspect === '9:16') {
        ratioW = 9;
        ratioH = 16;
      } else if (effectiveAspect === '1:1') {
        ratioW = 1;
        ratioH = 1;
      } else if (effectiveAspect === 'custom') {
        ratioW = Math.max(240, canvas.customWidth || 1080);
        ratioH = Math.max(240, canvas.customHeight || 1920);
      } else {
        ratioW = 16;
        ratioH = 9;
      }
    }

    const canvasAR = ratioW / Math.max(1, ratioH);
    const isPortraitOrSquare = canvasAR <= 1.05;
    const fitClass =
      aspectPreviewMode === 'original'
        ? 'object-contain'
        : project.exportSettings.fitMode === 'crop'
        ? 'object-cover'
        : 'object-contain';

    const style: React.CSSProperties = isPortraitOrSquare
      ? {
          aspectRatio: `${ratioW} / ${ratioH}`,
          height: 'min(450px, 56vh)',
          width: 'auto',
          maxWidth: '100%',
        }
      : {
          aspectRatio: `${ratioW} / ${ratioH}`,
          width: 'min(100%, 820px)',
          maxHeight: '450px',
          height: 'auto',
        };

    const cLeft = Math.max(0, Math.min(45, canvas.cropLeft || 0));
    const cRight = Math.max(0, Math.min(45, canvas.cropRight || 0));
    const cTop = Math.max(0, Math.min(45, canvas.cropTop || 0));
    const cBottom = Math.max(0, Math.min(45, canvas.cropBottom || 0));
    const cropScaleX = Math.max(0.1, 1 - (cLeft + cRight) / 100);
    const cropScaleY = Math.max(0.1, 1 - (cTop + cBottom) / 100);
    const croppedAR = (srcW * cropScaleX) / Math.max(1, srcH * cropScaleY);

    let fitW = 100;
    let fitH = 100;
    if (croppedAR > canvasAR) {
      fitW = 100;
      fitH = (canvasAR / croppedAR) * 100;
    } else {
      fitH = 100;
      fitW = (croppedAR / canvasAR) * 100;
    }

    const zoom = Math.max(0.25, Math.min(3.0, canvas.zoom || 1));
    const fgW = fitW * zoom;
    const fgH = fitH * zoom;
    const fgLeft = 50 + (canvas.offsetX || 0) - fgW / 2;
    const fgTop = 50 + (canvas.offsetY || 0) - fgH / 2;

    const fgBoxStyle: React.CSSProperties = {
      position: 'absolute',
      left: `${fgLeft}%`,
      top: `${fgTop}%`,
      width: `${fgW}%`,
      height: `${fgH}%`,
      opacity: canvas.videoVisible === false ? 0 : canvas.videoOpacity ?? 1,
      transform: canvas.videoRotation ? `rotate(${canvas.videoRotation}deg)` : undefined,
      transformOrigin: 'center center',
    };

    const fgVideoStyle: React.CSSProperties = {
      position: 'absolute',
      width: `${(1 / cropScaleX) * 100}%`,
      height: `${(1 / cropScaleY) * 100}%`,
      maxWidth: 'none',
      maxHeight: 'none',
      left: `${-(cLeft / (100 - cLeft - cRight)) * 100}%`,
      top: `${-(cTop / (100 - cTop - cBottom)) * 100}%`,
      objectFit: 'fill',
      filter: videoFilterCss,
    };

    return { style, fitClass, fgBoxStyle, fgVideoStyle };
  }, [
    naturalSize,
    project.metadata?.width,
    project.metadata?.height,
    aspectPreviewMode,
    effectiveAspect,
    canvas.customWidth,
    canvas.customHeight,
    canvas.cropLeft,
    canvas.cropRight,
    canvas.cropTop,
    canvas.cropBottom,
    canvas.zoom,
    canvas.offsetX,
    canvas.offsetY,
    canvas.videoOpacity,
    canvas.videoRotation,
    canvas.videoVisible,
    project.exportSettings.fitMode,
    videoFilterCss,
  ]);

  const getBlurBoxRect = (blur: BlurEffect) => {
    if (blur.mode === 'motion' && blur.keyframes && blur.keyframes.length > 0) {
      return interpolateTrackingBox(blur.keyframes, currentTime) || blur;
    }
    return blur;
  };

  const getAnimatedLogoPosition = (logo: LogoOverlay) => {
    const m = logo.motion;
    if (!m || !m.enabled || m.pattern === 'static') {
      return { x: logo.x, y: logo.y };
    }
    const speed = Math.max(0.2, Math.min(3.0, m.speed || 1));
    const maxW = Math.max(0.05, 1 - logo.widthPct / 100);
    const maxH = 0.86;
    const t = currentTime;

    if (m.pattern === 'bounce') {
      const vx = 0.16 * speed;
      const vy = 0.13 * speed;
      const rx = Math.abs(((logo.x + t * vx) % (2 * maxW)) - maxW);
      const ry = Math.abs(((logo.y + t * vy) % (2 * maxH)) - maxH);
      return { x: rx, y: ry };
    }
    if (m.pattern === 'horizontal') {
      const vx = 0.18 * speed;
      const rx = Math.abs(((logo.x + t * vx) % (2 * maxW)) - maxW);
      return { x: rx, y: logo.y };
    }
    if (m.pattern === 'orbit') {
      const omega = 1.6 * speed;
      const rx = Math.max(0, Math.min(maxW, logo.x + 0.14 * Math.sin(t * omega)));
      const ry = Math.max(0, Math.min(maxH, logo.y + 0.12 * Math.cos(t * omega)));
      return { x: rx, y: ry };
    }
    if (m.pattern === 'custom') {
      const endX = m.endX ?? 0.78;
      const endY = m.endY ?? 0.8;
      const cycle = Math.max(1.5, 6 / speed);
      const phase = (1 - Math.cos((Math.PI * (t % cycle)) / cycle)) / 2;
      return {
        x: Math.max(0, Math.min(maxW, logo.x + (endX - logo.x) * phase)),
        y: Math.max(0, Math.min(maxH, logo.y + (endY - logo.y) * phase)),
      };
    }
    return { x: logo.x, y: logo.y };
  };

  // Helper to render crisp 8-point resize handles + top rotation stem for selected element
  const renderTransformHandles = (
    onStartResize: (dir: ResizeHandleDir, e: React.MouseEvent<HTMLDivElement>) => void,
    onStartRotate: (e: React.MouseEvent<HTMLDivElement>) => void,
    showRotate = true
  ) => (
    <>
      {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeHandleDir[]).map((dir) => (
        <div
          key={dir}
          onMouseDown={(e) => {
            e.stopPropagation();
            onStartResize(dir, e);
          }}
          title="Drag to resize"
          className={`w-2.5 h-2.5 bg-white border border-violet-600 rounded-[2px] absolute z-40 shadow ${HANDLE_POSITIONS[dir]} ${HANDLE_CURSORS[dir]}`}
        />
      ))}
      {showRotate && (
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            onStartRotate(e);
          }}
          title="Drag to rotate"
          className="absolute -top-7 left-1/2 -translate-x-1/2 flex flex-col items-center z-40 cursor-grab active:cursor-grabbing"
        >
          <div className="w-5 h-5 rounded-full bg-violet-600 border border-white flex items-center justify-center shadow text-white">
            <RotateCw className="w-3 h-3" />
          </div>
          <div className="w-px h-2 bg-violet-400" />
        </div>
      )}
    </>
  );

  // Caption display renderer matching all 4 display modes cleanly
  const renderCaptionInner = () => {
    if (!activeCaption) return null;
    const style = project.subtitleStyle;
    const mode = normalizeCaptionDisplayMode(style.mode);
    const activeSource = getActiveCaptionSourceText(activeCaption, Boolean(style.useTranslated));
    const wordsToRender = resolveCaptionWords(activeCaption, Boolean(style.useTranslated));
    const animPreset = style.animationPreset || 'none';

    const getKeyframeAnimation = () => {
      switch (animPreset) {
        case 'word-popup':
        case 'pop':
        case 'word-emphasis':
          return 'captionPop 0.2s cubic-bezier(0.22, 1, 0.36, 1)';
        case 'bounce':
          return 'captionBounce 0.28s cubic-bezier(0.22, 1, 0.36, 1)';
        case 'scale':
          return 'captionScaleIn 0.2s ease-out';
        case 'slide-up':
          return 'captionSlideUp 0.2s ease-out';
        case 'fade':
          return 'captionFade 0.2s ease-out';
        default:
          return undefined;
      }
    };

    const renderStyledWord = (wordStr: string, isActive: boolean, keyStr: string, singleMode = false) => {
      const displayWord = style.uppercase ? wordStr.toUpperCase() : wordStr;
      const useGradient =
        isActive && (style.gradientEnabled || animPreset === 'gradient-emphasis') && (style.gradientColor || '#38BDF8');
      const useHighlightBox =
        isActive && (style.highlightBoxEnabled || animPreset === 'box-highlight');

      const pillBg = useHighlightBox
        ? hexToRgba(style.highlightBoxColor || '#7C3AED', style.highlightBoxOpacity ?? 0.85)
        : undefined;

      const textColor = useGradient
        ? 'transparent'
        : isActive
        ? singleMode
          ? style.primaryColor
          : style.highlightColor
        : style.primaryColor;

      return (
        <span
          key={keyStr}
          style={{
            display: 'inline-block',
            animation: isActive && singleMode ? getKeyframeAnimation() : undefined,
            color: textColor,
            backgroundImage: useGradient
              ? `linear-gradient(135deg, ${style.highlightColor || '#FACC15'}, ${
                  style.gradientColor || '#38BDF8'
                })`
              : undefined,
            WebkitBackgroundClip: useGradient ? 'text' : undefined,
            backgroundClip: useGradient ? 'text' : undefined,
            backgroundColor: pillBg,
            padding: useHighlightBox ? '2px 8px' : undefined,
            borderRadius: useHighlightBox ? `${Math.max(4, style.borderRadius ?? 8)}px` : undefined,
            transform:
              !singleMode && isActive
                ? animPreset === 'bounce'
                  ? 'translateY(-3px) scale(1.1)'
                  : 'scale(1.08)'
                : undefined,
            opacity: !singleMode && !isActive && animPreset === 'word-emphasis' ? 0.8 : 1,
            transition: 'transform 0.1s ease-out, color 0.1s ease',
            textShadow:
              isActive && !useGradient && (animPreset === 'highlight-sweep' || animPreset === 'word-emphasis')
                ? `0 0 12px ${style.highlightColor}`
                : undefined,
          }}
        >
          {displayWord}
        </span>
      );
    };

    if (mode === 'word-by-word') {
      if (wordsToRender.length === 0) return null;
      let activeIdx = wordsToRender.findIndex(
        (w) => currentTime >= w.start && currentTime <= w.end
      );
      if (activeIdx === -1) {
        activeIdx =
          currentTime < wordsToRender[0].start ? 0 : wordsToRender.length - 1;
      }
      const w = wordsToRender[activeIdx];
      return renderStyledWord(w.word, true, `${activeCaption.id}_word_${activeIdx}`, true);
    }

    if (mode === 'phrase-chunk') {
      if (wordsToRender.length === 0) return null;
      let activeIdx = wordsToRender.findIndex(
        (w) => currentTime >= w.start && currentTime <= w.end
      );
      if (activeIdx === -1) {
        activeIdx =
          currentTime < wordsToRender[0].start ? 0 : wordsToRender.length - 1;
      }
      const chunkSz = style.chunkSize === 2 ? 2 : 3;
      const chunkStart = Math.floor(activeIdx / chunkSz) * chunkSz;
      const chunk = wordsToRender.slice(chunkStart, chunkStart + chunkSz);
      return (
        <span
          key={`${activeCaption.id}_chunk_${chunkStart}`}
          className="inline-flex flex-wrap justify-center items-center gap-x-2"
          style={{ animation: getKeyframeAnimation() }}
        >
          {chunk.map((w, i) =>
            renderStyledWord(
              w.word,
              chunkStart + i === activeIdx,
              `${activeCaption.id}_c_${chunkStart + i}`,
              false
            )
          )}
        </span>
      );
    }

    if (mode === 'karaoke') {
      if (wordsToRender.length === 0) return null;
      let activeIdx = wordsToRender.findIndex(
        (w) => currentTime >= w.start && currentTime <= w.end
      );
      if (activeIdx === -1) {
        activeIdx =
          currentTime < wordsToRender[0].start ? -1 : wordsToRender.length - 1;
      }
      return (
        <span className="inline-flex flex-wrap justify-center items-center gap-x-1.5">
          {wordsToRender.map((w, idx) =>
            renderStyledWord(w.word, idx <= activeIdx, `${activeCaption.id}_k_${idx}`, false)
          )}
        </span>
      );
    }

    // Sentence mode (or typewriter progressive reveal)
    if (animPreset === 'typewriter' && wordsToRender.length > 0) {
      const idx = wordsToRender.findIndex((w) => currentTime >= w.start && currentTime <= w.end);
      const count = idx === -1 ? (currentTime < wordsToRender[0].start ? 1 : wordsToRender.length) : idx + 1;
      const sliceText = wordsToRender
        .slice(0, count)
        .map((w) => w.word)
        .join(' ');
      return (
        <span>{style.uppercase ? sliceText.toUpperCase() : sliceText}</span>
      );
    }

    return (
      <span
        key={activeCaption.id}
        style={{ animation: getKeyframeAnimation(), display: 'inline-block' }}
      >
        {style.uppercase ? activeSource.toUpperCase() : activeSource}
      </span>
    );
  };

  return (
    <div
      ref={containerRef}
      className="bg-[#111115] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col"
    >
      {customFontCss && <style>{customFontCss}</style>}

      {/* Top Bar of Preview Stage */}
      <div className="h-10 px-4 border-b border-white/[0.08] flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3 text-zinc-400 truncate">
          <span className="font-medium text-zinc-200 truncate">
            {project.sourceFilename || 'No source video loaded'}
          </span>
          {(naturalSize || project.metadata) && (
            <span className="hidden sm:inline font-mono text-[11px] text-zinc-500 tabular-nums whitespace-nowrap">
              {naturalSize?.w || project.metadata?.width}×{naturalSize?.h || project.metadata?.height}
              {project.metadata ? ` · ${project.metadata.fps} fps` : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {drawMode !== 'none' && !readOnlyPreview && (
            <span className="text-[11px] font-medium text-violet-300 hidden md:inline">
              Drag on video to draw {drawMode === 'motion' ? 'tracking target' : 'blur region'}
            </span>
          )}

          {/* Original True Ratio vs Export Ratio Frame Toggle */}
          <div className="flex items-center bg-zinc-900 border border-white/[0.08] rounded-md p-0.5">
            <button
              onClick={() => setAspectPreviewMode('original')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                aspectPreviewMode === 'original'
                  ? 'bg-violet-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Original Ratio
            </button>
            <button
              onClick={() => setAspectPreviewMode('export')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                aspectPreviewMode === 'export'
                  ? 'bg-violet-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Canvas ({effectiveAspect === 'custom' ? `${canvas.customWidth}×${canvas.customHeight}` : effectiveAspect})
            </button>
          </div>

          {/* Before / After Filter Comparison Toggle */}
          <button
            onClick={() => setCompareModeActive(!compareModeActive)}
            title="Toggle original vs filtered video preview"
            className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              compareModeActive
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-zinc-850 text-zinc-400 hover:text-zinc-200 border border-white/[0.08]'
            }`}
          >
            {compareModeActive ? 'Before (Raw)' : 'Filters / Effects'}
          </button>

          {/* Editing Guides & Selection Bounds Toggle */}
          {!readOnlyPreview && onUpdateCanvas && (
            <button
              onClick={() =>
                onUpdateCanvas(
                  { showEditingGuides: !(canvas.showEditingGuides !== false) },
                  { immediate: true }
                )
              }
              title="Toggle selection borders, resize handles, and editing guides"
              className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer ${
                editingGuidesOn
                  ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40'
                  : 'bg-zinc-850 text-zinc-400 hover:text-zinc-200 border border-white/[0.08]'
              }`}
            >
              <Grid className="w-3 h-3" />
              Guides
            </button>
          )}

          {/* Safe Area Guides Overlay Toggle */}
          {!readOnlyPreview && (
            <button
              onClick={() => setShowSafeGuides(!showSafeGuides)}
              title="Toggle TikTok 9:16 and 16:9 safe-area guides"
              className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showSafeGuides
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'bg-zinc-850 text-zinc-400 hover:text-zinc-200 border border-white/[0.08]'
              }`}
            >
              Safe Guides
            </button>
          )}

          <button
            onClick={() => onTogglePreviewEffects(!previewEffects)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              previewEffects
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40'
                : 'bg-zinc-800 text-zinc-400 border border-white/[0.08]'
            }`}
          >
            {previewEffects ? 'Effects: On' : 'Effects: Off'}
          </button>
        </div>
      </div>

      {/* Video Stage */}
      <div className="relative bg-[#060608] flex items-center justify-center p-3 sm:p-4 min-h-[280px] sm:min-h-[380px]">
        {project.sourceVideoUrl ? (
          <div
            ref={stageRef}
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
            onMouseLeave={handleStageMouseUp}
            style={{
              ...stageMetrics.style,
              backgroundColor:
                canvas.backgroundType === 'solid'
                  ? canvas.bgColor || '#09090B'
                  : '#09090B',
            }}
            className={`relative overflow-hidden rounded-lg border border-white/[0.08] shadow-2xl select-none ${
              drawMode !== 'none' ? 'cursor-crosshair' : ''
            }`}
          >
            {/* Background Fill Layer (Image or Blurred Duplicate Video) */}
            {canvas.backgroundType === 'image' &&
              canvas.bgImageUrl &&
              canvas.bgImageVisible !== false && (
                <div
                  onMouseDown={(e) => {
                    if (readOnlyPreview || drawMode !== 'none' || !onUpdateCanvas) return;
                    e.stopPropagation();
                    onSelectElement?.({ kind: 'bg-image' });
                    if (canvas.bgImageLocked) return;
                    setInteraction({
                      kind: 'bg-image',
                      action: 'move',
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      origOffsetX: canvas.bgImageOffsetX || 0,
                      origOffsetY: canvas.bgImageOffsetY || 0,
                      origScale: canvas.bgImageScale || 1,
                      origRot: canvas.bgImageRotation || 0,
                    });
                  }}
                  style={{
                    zIndex: layerZIndexMap.get('bg-image') ?? 5,
                    opacity: canvas.bgImageOpacity ?? 1,
                    transform: `translate(calc(-50% + ${canvas.bgImageOffsetX || 0}%), calc(-50% + ${
                      canvas.bgImageOffsetY || 0
                    }%)) scale(${canvas.bgImageScale || 1}) rotate(${
                      canvas.bgImageRotation || 0
                    }deg)`,
                  }}
                  className={`absolute left-1/2 top-1/2 w-full h-full select-none ${
                    editingGuidesOn && isSelectedEl({ kind: 'bg-image' })
                      ? 'ring-2 ring-cyan-400'
                      : ''
                  } ${onUpdateCanvas && !canvas.bgImageLocked ? 'cursor-move' : ''}`}
                >
                  <img
                    src={canvas.bgImageUrl}
                    alt="Canvas background"
                    draggable={false}
                    className="w-full h-full object-cover pointer-events-none select-none"
                  />
                </div>
              )}

            {canvas.backgroundType === 'blur' && canvas.bgImageVisible !== false && (
              <video
                ref={bgVideoRef}
                src={project.sourceVideoUrl}
                muted
                playsInline
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
                style={{
                  zIndex: 5,
                  filter: `blur(${Math.max(2, Math.round((canvas.bgBlurIntensity || 24) * 0.65))}px) brightness(${Math.max(
                    0.3,
                    1 + (canvas.bgBlurBrightness ?? -15) / 100
                  ).toFixed(2)})`,
                  opacity: canvas.bgBlurOpacity ?? 0.9,
                  transform: 'scale(1.06)',
                }}
              />
            )}

            {/* Foreground Video Layer */}
            {hasCustomCanvas ? (
              <div
                style={{
                  ...stageMetrics.fgBoxStyle,
                  zIndex: layerZIndexMap.get('video') ?? 10,
                }}
                onMouseDown={(e) => {
                  if (readOnlyPreview || drawMode !== 'none') return;
                  e.stopPropagation();
                  onSelectElement?.({ kind: 'video' });
                  if (!onUpdateCanvas || canvas.videoLocked) {
                    void togglePlay();
                    return;
                  }
                  setInteraction({
                    kind: 'video',
                    action: 'move',
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    origOffsetX: canvas.offsetX || 0,
                    origOffsetY: canvas.offsetY || 0,
                    origZoom: canvas.zoom || 1,
                    origRot: canvas.videoRotation || 0,
                    moved: false,
                  });
                }}
                className={`${
                  editingGuidesOn && isSelectedEl({ kind: 'video' }) && !canvas.videoLocked
                    ? 'ring-2 ring-violet-400'
                    : ''
                } ${onUpdateCanvas && !canvas.videoLocked && drawMode === 'none' ? 'cursor-move' : ''}`}
              >
                <div className="w-full h-full overflow-hidden relative">
                  <video
                    ref={videoRef}
                    src={project.sourceVideoUrl}
                    playsInline
                    style={stageMetrics.fgVideoStyle}
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget;
                      if (v.videoWidth && v.videoHeight) {
                        setNaturalSize({ w: v.videoWidth, h: v.videoHeight });
                      }
                    }}
                    onTimeUpdate={(e) => {
                      const t = e.currentTarget.currentTime;
                      if (
                        bgVideoRef.current &&
                        Math.abs(bgVideoRef.current.currentTime - t) > 0.2
                      ) {
                        bgVideoRef.current.currentTime = t;
                      }
                      onTimeUpdate(t);
                    }}
                    onEnded={() => {
                      setIsPlaying(false);
                      bgVideoRef.current?.pause();
                      dubAudioRef.current?.pause();
                      musicAudioRef.current?.pause();
                    }}
                  />
                </div>
                {editingGuidesOn &&
                  isSelectedEl({ kind: 'video' }) &&
                  !canvas.videoLocked &&
                  onUpdateCanvas &&
                  renderTransformHandles(
                    (dir, ev) => {
                      setInteraction({
                        kind: 'video',
                        action: 'resize',
                        dir,
                        startClientX: ev.clientX,
                        startClientY: ev.clientY,
                        origOffsetX: canvas.offsetX || 0,
                        origOffsetY: canvas.offsetY || 0,
                        origZoom: canvas.zoom || 1,
                        origRot: canvas.videoRotation || 0,
                        moved: true,
                      });
                    },
                    (ev) => {
                      const elRect = ev.currentTarget.parentElement?.getBoundingClientRect();
                      setInteraction({
                        kind: 'video',
                        action: 'rotate',
                        startClientX: ev.clientX,
                        startClientY: ev.clientY,
                        origOffsetX: canvas.offsetX || 0,
                        origOffsetY: canvas.offsetY || 0,
                        origZoom: canvas.zoom || 1,
                        origRot: canvas.videoRotation || 0,
                        centerClientX: elRect ? elRect.left + elRect.width / 2 : ev.clientX,
                        centerClientY: elRect ? elRect.top + elRect.height / 2 : ev.clientY,
                        moved: true,
                      });
                    }
                  )}
              </div>
            ) : (
              <video
                ref={videoRef}
                src={project.sourceVideoUrl}
                playsInline
                style={{
                  filter: videoFilterCss,
                  zIndex: layerZIndexMap.get('video') ?? 10,
                }}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (v.videoWidth && v.videoHeight) {
                    setNaturalSize({ w: v.videoWidth, h: v.videoHeight });
                  }
                }}
                onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
                onEnded={() => {
                  setIsPlaying(false);
                  dubAudioRef.current?.pause();
                  musicAudioRef.current?.pause();
                }}
                onClick={() => {
                  if (drawMode === 'none') {
                    onSelectElement?.({ kind: 'video' });
                    void togglePlay();
                  }
                }}
                className={`w-full h-full relative ${stageMetrics.fitClass}`}
              />
            )}

            {/* Vignette Filter Overlay */}
            {vignetteAmt > 0 && (
              <div
                className="absolute inset-0 pointer-events-none z-15"
                style={{
                  background: `radial-gradient(circle at center, transparent 38%, rgba(0,0,0,${Math.min(
                    0.85,
                    vignetteAmt * 0.9
                  )}) 100%)`,
                }}
              />
            )}

            {/* Film Grain Live Simulation */}
            {grainFx && (
              <div
                className="absolute inset-0 pointer-events-none mix-blend-overlay z-15"
                style={{
                  opacity: Math.min(0.65, (grainFx.intensity / 100) * 0.55),
                  backgroundImage: `radial-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), radial-gradient(rgba(0,0,0,0.4) 1px, transparent 1px)`,
                  backgroundSize: '4px 4px',
                  backgroundPosition: '0 0, 2px 2px',
                }}
              />
            )}

            {/* Bloom & Glow Live Simulation */}
            {glowFx && (
              <div
                className="absolute inset-0 pointer-events-none mix-blend-screen z-15"
                style={{
                  backdropFilter: 'blur(6px)',
                  WebkitBackdropFilter: 'blur(6px)',
                  opacity: Math.min(0.7, (glowFx.intensity / 100) * 0.5),
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                }}
              />
            )}

            {/* VHS / Scanlines Live Simulation */}
            {vhsFx && (
              <div
                className="absolute inset-0 pointer-events-none mix-blend-screen z-15"
                style={{
                  opacity: Math.min(0.4, (vhsFx.intensity / 100) * 0.35),
                  background:
                    'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.35) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.08), rgba(0, 255, 0, 0.04), rgba(0, 0, 255, 0.08))',
                  backgroundSize: '100% 3px, 6px 100%',
                }}
              />
            )}

            {/* Light Leaks / Film Burn Live Simulation */}
            {leakFx && (
              <div
                className="absolute inset-0 pointer-events-none mix-blend-screen z-15"
                style={{
                  opacity: Math.min(0.55, (leakFx.intensity / 100) * 0.5),
                  background:
                    'radial-gradient(ellipse at 85% 15%, rgba(255, 140, 50, 0.75) 0%, rgba(255, 70, 30, 0.35) 45%, transparent 75%)',
                }}
              />
            )}

            {/* Full Video Blur Live Preview Overlay */}
            {fullBlurEffect && (
              <div
                className="absolute inset-0 pointer-events-none z-15"
                style={{
                  opacity: fullBlurEffect.opacity ?? 1,
                  backdropFilter: `blur(${Math.max(2, fullBlurEffect.radius * 0.6)}px)`,
                  WebkitBackdropFilter: `blur(${Math.max(2, fullBlurEffect.radius * 0.6)}px)`,
                }}
              />
            )}

            {/* Synchronized AI Dub & Background Music Preview Elements */}
            {project.voice.fullDubUrl && (
              <audio ref={dubAudioRef} src={project.voice.fullDubUrl} preload="auto" />
            )}
            {project.voice.bgMusicUrl && (
              <audio ref={musicAudioRef} src={project.voice.bgMusicUrl} loop preload="auto" />
            )}

            {/* Background Blur Live Preview Simulation Overlay */}
            {bgBlurEffect && (
              <div
                className="absolute inset-0 pointer-events-none z-15"
                style={{
                  opacity: bgBlurEffect.opacity ?? 1,
                  backdropFilter: `blur(${Math.max(4, bgBlurEffect.radius * 0.55)}px)`,
                  WebkitBackdropFilter: `blur(${Math.max(4, bgBlurEffect.radius * 0.55)}px)`,
                  maskImage:
                    'radial-gradient(ellipse 46% 68% at 50% 48%, transparent 45%, black 85%)',
                  WebkitMaskImage:
                    'radial-gradient(ellipse 46% 68% at 50% 48%, transparent 45%, black 85%)',
                }}
              />
            )}

            {/* Selective & Motion Tracking Blur Region Previews — ZERO unwanted borders or strokes */}
            {boxBlurs.map((blur) => {
              const box = getBlurBoxRect(blur);
              const isSelected = isSelectedEl({ kind: 'blur', id: blur.id });
              const canEditBox =
                !readOnlyPreview && Boolean(onUpdateBlur) && drawMode === 'none' && !blur.locked;
              const showOutline = isSelected && editingGuidesOn && canEditBox;
              const featherAmt = Math.max(0, Math.min(30, blur.feather ?? 10));
              const innerRadiusPct = Math.max(45, 98 - featherAmt * 1.4);
              const maskCss =
                blur.shape === 'ellipse'
                  ? `radial-gradient(ellipse at center, rgba(0,0,0,1) ${innerRadiusPct}%, rgba(0,0,0,0) 100%)`
                  : featherAmt > 0
                  ? `radial-gradient(closest-side, rgba(0,0,0,1) ${Math.max(
                      55,
                      100 - featherAmt * 1.5
                    )}%, rgba(0,0,0,0) 100%)`
                  : undefined;

              return (
                <div
                  key={blur.id}
                  onMouseDown={(e) => {
                    if (readOnlyPreview || drawMode !== 'none') return;
                    e.stopPropagation();
                    onSelectElement?.({ kind: 'blur', id: blur.id });
                    if (!canEditBox) return;
                    setInteraction({
                      kind: 'blur',
                      id: blur.id,
                      action: 'move',
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      origX: box.x,
                      origY: box.y,
                      origW: box.width,
                      origH: box.height,
                      origRot: blur.rotation || 0,
                    });
                  }}
                  className={`absolute transition-none ${
                    canEditBox ? 'cursor-move' : 'pointer-events-none'
                  } ${showOutline ? 'ring-2 ring-violet-400' : ''}`}
                  style={{
                    zIndex: layerZIndexMap.get(`blur:${blur.id}`) ?? 18,
                    left: `${box.x * 100}%`,
                    top: `${box.y * 100}%`,
                    width: `${box.width * 100}%`,
                    height: `${box.height * 100}%`,
                    transform: blur.rotation ? `rotate(${blur.rotation}deg)` : undefined,
                    transformOrigin: 'center center',
                  }}
                >
                  {/* Inner natural feathered blur surface with ZERO border or dark tint */}
                  <div
                    className={`w-full h-full pointer-events-none ${
                      blur.shape === 'ellipse' ? 'rounded-full' : ''
                    }`}
                    style={{
                      opacity: blur.opacity ?? 1,
                      backdropFilter:
                        blur.type === 'pixelate'
                          ? `blur(${Math.max(4, blur.radius * 0.45)}px) contrast(1.15)`
                          : `blur(${Math.max(4, blur.radius * 0.65)}px)`,
                      WebkitBackdropFilter:
                        blur.type === 'pixelate'
                          ? `blur(${Math.max(4, blur.radius * 0.45)}px) contrast(1.15)`
                          : `blur(${Math.max(4, blur.radius * 0.65)}px)`,
                      maskImage: maskCss,
                      WebkitMaskImage: maskCss,
                    }}
                  />

                  {showOutline &&
                    renderTransformHandles(
                      (dir, ev) => {
                        setInteraction({
                          kind: 'blur',
                          id: blur.id,
                          action: 'resize',
                          dir,
                          startClientX: ev.clientX,
                          startClientY: ev.clientY,
                          origX: box.x,
                          origY: box.y,
                          origW: box.width,
                          origH: box.height,
                          origRot: blur.rotation || 0,
                        });
                      },
                      (ev) => {
                        const elRect = ev.currentTarget.parentElement?.getBoundingClientRect();
                        setInteraction({
                          kind: 'blur',
                          id: blur.id,
                          action: 'rotate',
                          startClientX: ev.clientX,
                          startClientY: ev.clientY,
                          origX: box.x,
                          origY: box.y,
                          origW: box.width,
                          origH: box.height,
                          origRot: blur.rotation || 0,
                          centerClientX: elRect ? elRect.left + elRect.width / 2 : ev.clientX,
                          centerClientY: elRect ? elRect.top + elRect.height / 2 : ev.clientY,
                        });
                      }
                    )}
                </div>
              );
            })}

            {/* Active Drag-Draw Marquee */}
            {dragDraw && (
              <div
                className="absolute border-2 border-dashed border-violet-400 bg-violet-500/15 pointer-events-none z-40"
                style={{
                  left: `${Math.min(dragDraw.startX, dragDraw.curX) * 100}%`,
                  top: `${Math.min(dragDraw.startY, dragDraw.curY) * 100}%`,
                  width: `${Math.abs(dragDraw.curX - dragDraw.startX) * 100}%`,
                  height: `${Math.abs(dragDraw.curY - dragDraw.startY) * 100}%`,
                }}
              />
            )}

            {/* Interactive Logo & Watermark Overlays */}
            {activeLogos.map((logo) => {
              const selected = isSelectedEl({ kind: 'logo', id: logo.id });
              const animPos = getAnimatedLogoPosition(logo);
              const canEditLogo =
                !readOnlyPreview && Boolean(onUpdateLogo) && drawMode === 'none' && !logo.locked;
              const showOutline = selected && editingGuidesOn && canEditLogo;

              return (
                <div
                  key={logo.id}
                  onMouseDown={(e) => {
                    if (readOnlyPreview || drawMode !== 'none') return;
                    e.stopPropagation();
                    onSelectElement?.({ kind: 'logo', id: logo.id });
                    if (!canEditLogo) return;
                    setInteraction({
                      kind: 'logo',
                      id: logo.id,
                      action: 'move',
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      origX: logo.x,
                      origY: logo.y,
                      origW: logo.widthPct,
                      origRot: logo.rotation || 0,
                    });
                  }}
                  className={`absolute ${canEditLogo ? 'cursor-move' : 'pointer-events-none'} ${
                    showOutline ? 'ring-2 ring-violet-400 rounded-sm' : ''
                  }`}
                  style={{
                    zIndex: layerZIndexMap.get(`logo:${logo.id}`) ?? 22,
                    left: `${animPos.x * 100}%`,
                    top: `${animPos.y * 100}%`,
                    width: `${logo.widthPct}%`,
                    opacity: logo.opacity,
                    transform: logo.rotation ? `rotate(${logo.rotation}deg)` : undefined,
                    transformOrigin: 'center center',
                  }}
                >
                  <img
                    src={logo.url}
                    alt={logo.filename}
                    draggable={false}
                    className="w-full h-auto pointer-events-none select-none"
                  />
                  {showOutline &&
                    renderTransformHandles(
                      (dir, ev) => {
                        setInteraction({
                          kind: 'logo',
                          id: logo.id,
                          action: 'resize',
                          dir,
                          startClientX: ev.clientX,
                          startClientY: ev.clientY,
                          origX: logo.x,
                          origY: logo.y,
                          origW: logo.widthPct,
                          origRot: logo.rotation || 0,
                        });
                      },
                      (ev) => {
                        const elRect = ev.currentTarget.parentElement?.getBoundingClientRect();
                        setInteraction({
                          kind: 'logo',
                          id: logo.id,
                          action: 'rotate',
                          startClientX: ev.clientX,
                          startClientY: ev.clientY,
                          origX: logo.x,
                          origY: logo.y,
                          origW: logo.widthPct,
                          origRot: logo.rotation || 0,
                          centerClientX: elRect ? elRect.left + elRect.width / 2 : ev.clientX,
                          centerClientY: elRect ? elRect.top + elRect.height / 2 : ev.clientY,
                        });
                      }
                    )}
                </div>
              );
            })}

            {/* Live Styled & Animated Caption Overlay (Word-by-Word / Karaoke / Chunk / Sentence) */}
            {activeCaption && (
              <div
                onMouseDown={(e) => {
                  if (readOnlyPreview || drawMode !== 'none') return;
                  e.stopPropagation();
                  onSelectElement?.({ kind: 'captions' });
                  if (!onUpdateSubtitleStyle || project.subtitleStyle.locked) return;
                  const curX =
                    project.subtitleStyle.posX !== undefined
                      ? project.subtitleStyle.posX
                      : 50;
                  const curY =
                    project.subtitleStyle.posY !== undefined
                      ? project.subtitleStyle.posY
                      : project.subtitleStyle.position === 'top'
                      ? 14
                      : project.subtitleStyle.position === 'middle'
                      ? 50
                      : 84;
                  setInteraction({
                    kind: 'captions',
                    action: 'move',
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    origX: curX,
                    origY: curY,
                    origScale: project.subtitleStyle.scale ?? 1,
                    origRot: project.subtitleStyle.rotation ?? 0,
                  });
                }}
                style={{
                  zIndex: layerZIndexMap.get('captions') ?? 26,
                  left: `${
                    project.subtitleStyle.posX !== undefined ? project.subtitleStyle.posX : 50
                  }%`,
                  top: `${
                    project.subtitleStyle.posY !== undefined
                      ? project.subtitleStyle.posY
                      : project.subtitleStyle.position === 'top'
                      ? 14
                      : project.subtitleStyle.position === 'middle'
                      ? 50
                      : 84
                  }%`,
                  opacity: project.subtitleStyle.opacity ?? 1,
                  transform: `translate(-50%, -50%) scale(${
                    project.subtitleStyle.scale ?? 1
                  }) rotate(${project.subtitleStyle.rotation ?? 0}deg)`,
                  transformOrigin: 'center center',
                }}
                className={`absolute max-w-[92%] select-none ${
                  !readOnlyPreview && onUpdateSubtitleStyle && !project.subtitleStyle.locked
                    ? 'cursor-move'
                    : 'pointer-events-none'
                } ${
                  editingGuidesOn &&
                  isSelectedEl({ kind: 'captions' }) &&
                  !project.subtitleStyle.locked &&
                  onUpdateSubtitleStyle
                    ? 'ring-2 ring-violet-400 rounded-lg p-0.5'
                    : ''
                }`}
              >
                <div
                  className="inline-block"
                  style={{
                    fontFamily: project.subtitleStyle.fontFamily || 'DejaVu Sans',
                    fontSize: `${Math.max(
                      12,
                      Math.round((project.subtitleStyle.fontSize || 36) * 0.52)
                    )}px`,
                    fontWeight:
                      project.subtitleStyle.fontWeight === '900'
                        ? 900
                        : project.subtitleStyle.fontWeight === 'bold'
                        ? 700
                        : 400,
                    fontStyle: project.subtitleStyle.italic ? 'italic' : 'normal',
                    textDecoration: project.subtitleStyle.underline ? 'underline' : 'none',
                    letterSpacing: `${project.subtitleStyle.letterSpacing || 0}px`,
                    lineHeight: project.subtitleStyle.lineSpacing || 1.25,
                    textAlign: project.subtitleStyle.textAlign || 'center',
                    borderRadius: `${project.subtitleStyle.borderRadius ?? 8}px`,
                    padding: `${project.subtitleStyle.paddingV ?? 6}px ${
                      project.subtitleStyle.paddingH ?? 14
                    }px`,
                    color: project.subtitleStyle.primaryColor || '#FFFFFF',
                    backgroundColor:
                      (project.subtitleStyle.backgroundOpacity ?? 0.55) > 0.02
                        ? hexToRgba(
                            project.subtitleStyle.backgroundColor || '#09090B',
                            project.subtitleStyle.backgroundOpacity ?? 0.55
                          )
                        : 'transparent',
                    textShadow: project.subtitleStyle.shadowEnabled
                      ? `0 2px ${project.subtitleStyle.shadowBlur ?? 4}px ${
                          project.subtitleStyle.shadowColor ||
                          project.subtitleStyle.outlineColor ||
                          '#000000'
                        }`
                      : undefined,
                    WebkitTextStroke:
                      (project.subtitleStyle.outlineWidth || 0) > 0
                        ? `${Math.min(
                            3,
                            (project.subtitleStyle.outlineWidth || 3) * 0.45
                          )}px ${project.subtitleStyle.outlineColor || '#09090B'}`
                        : undefined,
                  }}
                >
                  {renderCaptionInner()}
                </div>

                {editingGuidesOn &&
                  isSelectedEl({ kind: 'captions' }) &&
                  !project.subtitleStyle.locked &&
                  onUpdateSubtitleStyle &&
                  renderTransformHandles(
                    (dir, ev) => {
                      const curX = project.subtitleStyle.posX ?? 50;
                      const curY = project.subtitleStyle.posY ?? 84;
                      setInteraction({
                        kind: 'captions',
                        action: 'resize',
                        dir,
                        startClientX: ev.clientX,
                        startClientY: ev.clientY,
                        origX: curX,
                        origY: curY,
                        origScale: project.subtitleStyle.scale ?? 1,
                        origRot: project.subtitleStyle.rotation ?? 0,
                      });
                    },
                    (ev) => {
                      const elRect = ev.currentTarget.parentElement?.getBoundingClientRect();
                      const curX = project.subtitleStyle.posX ?? 50;
                      const curY = project.subtitleStyle.posY ?? 84;
                      setInteraction({
                        kind: 'captions',
                        action: 'rotate',
                        startClientX: ev.clientX,
                        startClientY: ev.clientY,
                        origX: curX,
                        origY: curY,
                        origScale: project.subtitleStyle.scale ?? 1,
                        origRot: project.subtitleStyle.rotation ?? 0,
                        centerClientX: elRect ? elRect.left + elRect.width / 2 : ev.clientX,
                        centerClientY: elRect ? elRect.top + elRect.height / 2 : ev.clientY,
                      });
                    }
                  )}
              </div>
            )}

            {/* Magnetic Snapping Guide Lines (shown strictly while dragging near center/safe lines) */}
            {snapGuides.x !== null && (
              <div
                className="absolute top-0 bottom-0 w-px bg-cyan-400/90 pointer-events-none z-40"
                style={{ left: `${snapGuides.x}%` }}
              />
            )}
            {snapGuides.y !== null && (
              <div
                className="absolute left-0 right-0 h-px bg-cyan-400/90 pointer-events-none z-40"
                style={{ top: `${snapGuides.y}%` }}
              />
            )}

            {/* Safe Area Guides Overlay */}
            {showSafeGuides && !readOnlyPreview && (
              <div className="absolute inset-0 pointer-events-none border border-violet-500/40 z-30">
                <div className="absolute top-[12%] bottom-[18%] left-[6%] right-[16%] border border-dashed border-amber-400/70 rounded-xs flex flex-col justify-between p-2">
                  <span className="self-start text-[9px] font-mono text-amber-300 bg-black/75 px-1.5 py-0.5 rounded">
                    TikTok Header Safe Zone
                  </span>
                  <span className="self-end text-[9px] font-mono text-amber-300 bg-black/75 px-1.5 py-0.5 rounded">
                    Right Action Buttons Safe
                  </span>
                  <span className="self-center text-[9px] font-mono text-amber-300 bg-black/75 px-1.5 py-0.5 rounded">
                    TikTok / Shorts Safe Area
                  </span>
                </div>
                <div className="absolute inset-[10%] border border-dashed border-cyan-400/40 rounded-xs pointer-events-none">
                  <span className="absolute top-1 left-1 text-[9px] font-mono text-cyan-300 bg-black/60 px-1 rounded">
                    16:9 Title Safe (10%)
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center space-y-2 py-14 px-6 max-w-md">
            <div className="text-sm font-medium text-zinc-200">No Video Loaded in Workspace</div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Upload an MP4, MOV, or MKV movie recap video from the Dashboard or Video Editor tab to
              begin editing, transcribing, blurring, and dubbing.
            </p>
          </div>
        )}
      </div>

      {/* Transport Controls Bar */}
      <div className="px-4 py-2.5 border-t border-white/[0.08] bg-[#111115] space-y-2">
        <input
          type="range"
          min={0}
          max={Math.max(0.1, duration)}
          step={0.02}
          value={Math.min(currentTime, duration || 0)}
          disabled={!project.sourceVideoUrl}
          onChange={(e) => seekTo(Number(e.target.value))}
          className="w-full accent-violet-500 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
          aria-label="Seek video timeline"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              disabled={!project.sourceVideoUrl}
              className="w-9 h-9 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white flex items-center justify-center transition-colors cursor-pointer"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>

            <button
              onClick={() => stepFrame(-1)}
              disabled={!project.sourceVideoUrl}
              title="Previous frame"
              className="p-2 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => stepFrame(1)}
              disabled={!project.sourceVideoUrl}
              title="Next frame"
              className="p-2 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <div className="ml-2 font-mono text-xs text-zinc-300 tabular-nums whitespace-nowrap">
              {formatTimecode(currentTime)} <span className="text-zinc-600">/</span>{' '}
              <span className="text-zinc-400">{formatTimecode(duration)}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={playbackRate}
              onChange={(e) => setPlaybackRate(Number(e.target.value))}
              className="bg-zinc-800/90 border border-white/[0.08] rounded-md px-2 py-1 text-xs font-mono text-zinc-200 cursor-pointer"
              aria-label="Playback speed"
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((spd) => (
                <option key={spd} value={spd}>
                  {spd}x
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setMuted(!muted)}
                className="p-1.5 text-zinc-300 hover:text-white cursor-pointer"
                aria-label={muted ? 'Unmute' : 'Mute'}
              >
                {muted || volume === 0 ? (
                  <VolumeX className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  setMuted(false);
                  setVolume(Number(e.target.value));
                }}
                className="w-16 sm:w-20 accent-violet-500 h-1 bg-zinc-800 rounded cursor-pointer"
                aria-label="Volume"
              />
            </div>

            <button
              onClick={toggleFullscreen}
              className="p-1.5 text-zinc-400 hover:text-white cursor-pointer"
              aria-label="Toggle fullscreen"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
