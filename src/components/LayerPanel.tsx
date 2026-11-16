import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Film,
  Image as ImageIcon,
  Layers,
  Lock,
  RotateCcw,
  Sparkles,
  Trash2,
  Type,
  Unlock,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import {
  BlurEffect,
  DEFAULT_VIDEO_CANVAS,
  LogoOverlay,
  Project,
  StudioElementSelection,
  SubtitleStyle,
  VideoCanvasConfig,
} from '../types/studio';

interface LayerPanelProps {
  project: Project;
  selectedElement: StudioElementSelection;
  onSelectElement: (sel: StudioElementSelection) => void;
  onUpdateCanvas: (patch: Partial<VideoCanvasConfig>, opts?: { immediate?: boolean }) => void;
  onUpdateBlurs: (nextBlurs: BlurEffect[]) => void;
  onUpdateLogos: (nextLogos: LogoOverlay[]) => void;
  onUpdateSubtitleStyle: (patch: Partial<SubtitleStyle>) => void;
}

interface LayerRow {
  token: string;
  selection: Exclude<StudioElementSelection, null>;
  label: string;
  sublabel: string;
  kind: 'video' | 'bg-image' | 'blur' | 'logo' | 'captions';
  visible: boolean;
  locked: boolean;
  opacity: number;
  rotation: number;
  canReorder: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
}

export function buildOrderedLayerTokens(project: Project): string[] {
  const canvas = { ...DEFAULT_VIDEO_CANVAS, ...(project.canvas || {}) };
  const baseTokens: string[] = [];
  if (canvas.backgroundType === 'image') baseTokens.push('bg-image');
  baseTokens.push('video');
  for (const b of project.blurs) baseTokens.push(`blur:${b.id}`);
  for (const l of project.logos) baseTokens.push(`logo:${l.id}`);
  if (project.captions.length > 0 || project.subtitleStyle.enabled) {
    baseTokens.push('captions');
  }

  const validSet = new Set(baseTokens);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const tok of canvas.layerOrder || []) {
    if (validSet.has(tok) && !seen.has(tok)) {
      ordered.push(tok);
      seen.add(tok);
    }
  }
  for (const tok of baseTokens) {
    if (!seen.has(tok)) {
      ordered.push(tok);
      seen.add(tok);
    }
  }
  return ordered;
}

export function LayerPanel({
  project,
  selectedElement,
  onSelectElement,
  onUpdateCanvas,
  onUpdateBlurs,
  onUpdateLogos,
  onUpdateSubtitleStyle,
}: LayerPanelProps) {
  const canvas = { ...DEFAULT_VIDEO_CANVAS, ...(project.canvas || {}) };
  const orderedBottomToTop = buildOrderedLayerTokens(project);

  const rowMap = new Map<string, LayerRow>();
  if (canvas.backgroundType === 'image') {
    rowMap.set('bg-image', {
      token: 'bg-image',
      selection: { kind: 'bg-image' },
      label: canvas.bgImageFilename || 'Background Image',
      sublabel: 'Canvas Backdrop',
      kind: 'bg-image',
      visible: canvas.bgImageVisible !== false,
      locked: Boolean(canvas.bgImageLocked),
      opacity: canvas.bgImageOpacity ?? 1,
      rotation: canvas.bgImageRotation ?? 0,
      canReorder: false,
      canDuplicate: false,
      canDelete: false,
    });
  }

  rowMap.set('video', {
    token: 'video',
    selection: { kind: 'video' },
    label: project.sourceFilename || 'Main Video Layer',
    sublabel: `${Math.round((canvas.zoom || 1) * 100)}% zoom`,
    kind: 'video',
    visible: canvas.videoVisible !== false,
    locked: Boolean(canvas.videoLocked),
    opacity: canvas.videoOpacity ?? 1,
    rotation: canvas.videoRotation ?? 0,
    canReorder: false,
    canDuplicate: false,
    canDelete: false,
  });

  for (const b of project.blurs) {
    rowMap.set(`blur:${b.id}`, {
      token: `blur:${b.id}`,
      selection: { kind: 'blur', id: b.id },
      label: b.name || 'Blur Region',
      sublabel: `${b.mode} · ${b.radius}px`,
      kind: 'blur',
      visible: b.enabled,
      locked: Boolean(b.locked),
      opacity: b.opacity ?? 1,
      rotation: b.rotation ?? 0,
      canReorder: true,
      canDuplicate: true,
      canDelete: true,
    });
  }

  for (const l of project.logos) {
    rowMap.set(`logo:${l.id}`, {
      token: `logo:${l.id}`,
      selection: { kind: 'logo', id: l.id },
      label: l.filename || 'Brand Logo',
      sublabel: `${Math.round(l.widthPct)}% width`,
      kind: 'logo',
      visible: l.enabled,
      locked: Boolean(l.locked),
      opacity: l.opacity ?? 1,
      rotation: l.rotation ?? 0,
      canReorder: true,
      canDuplicate: true,
      canDelete: true,
    });
  }

  if (project.captions.length > 0 || project.subtitleStyle.enabled) {
    rowMap.set('captions', {
      token: 'captions',
      selection: { kind: 'captions' },
      label: 'Captions Overlay',
      sublabel: project.subtitleStyle.enabled
        ? `${project.subtitleStyle.mode} · ${project.captions.length} lines`
        : 'Preview Hidden',
      kind: 'captions',
      visible: project.subtitleStyle.enabled && project.subtitleStyle.visible !== false,
      locked: Boolean(project.subtitleStyle.locked),
      opacity: project.subtitleStyle.opacity ?? 1,
      rotation: project.subtitleStyle.rotation ?? 0,
      canReorder: true,
      canDuplicate: false,
      canDelete: false,
    });
  }

  // UI lists top-most layer first
  const rowsTopToBottom = [...orderedBottomToTop]
    .reverse()
    .map((tok) => rowMap.get(tok))
    .filter((r): r is LayerRow => Boolean(r));

  const isRowSelected = (row: LayerRow): boolean => {
    if (!selectedElement) return false;
    if (row.selection.kind !== selectedElement.kind) return false;
    if (row.selection.kind === 'blur' && selectedElement.kind === 'blur') {
      return row.selection.id === selectedElement.id;
    }
    if (row.selection.kind === 'logo' && selectedElement.kind === 'logo') {
      return row.selection.id === selectedElement.id;
    }
    return true;
  };

  const selectedRow = rowsTopToBottom.find(isRowSelected) || null;

  const moveOverlayOrder = (token: string, direction: 'forward' | 'backward') => {
    const overlayOnly = orderedBottomToTop.filter((t) => t !== 'bg-image' && t !== 'video');
    const idx = overlayOnly.indexOf(token);
    if (idx === -1) return;
    const swapIdx = direction === 'forward' ? idx + 1 : idx - 1;
    if (swapIdx < 0 || swapIdx >= overlayOnly.length) return;
    const nextOverlays = [...overlayOnly];
    [nextOverlays[idx], nextOverlays[swapIdx]] = [nextOverlays[swapIdx], nextOverlays[idx]];
    const base = orderedBottomToTop.filter((t) => t === 'bg-image' || t === 'video');
    onUpdateCanvas({ layerOrder: [...base, ...nextOverlays] }, { immediate: true });
  };

  const toggleVisibility = (row: LayerRow) => {
    if (row.kind === 'video') {
      onUpdateCanvas({ videoVisible: !row.visible }, { immediate: true });
    } else if (row.kind === 'bg-image') {
      onUpdateCanvas({ bgImageVisible: !row.visible }, { immediate: true });
    } else if (row.kind === 'blur' && row.selection.kind === 'blur') {
      const id = row.selection.id;
      onUpdateBlurs(project.blurs.map((b) => (b.id === id ? { ...b, enabled: !b.enabled } : b)));
    } else if (row.kind === 'logo' && row.selection.kind === 'logo') {
      const id = row.selection.id;
      onUpdateLogos(project.logos.map((l) => (l.id === id ? { ...l, enabled: !l.enabled } : l)));
    } else if (row.kind === 'captions') {
      onUpdateSubtitleStyle({ visible: !row.visible });
    }
  };

  const toggleLock = (row: LayerRow) => {
    if (row.kind === 'video') {
      onUpdateCanvas({ videoLocked: !row.locked }, { immediate: true });
    } else if (row.kind === 'bg-image') {
      onUpdateCanvas({ bgImageLocked: !row.locked }, { immediate: true });
    } else if (row.kind === 'blur' && row.selection.kind === 'blur') {
      const id = row.selection.id;
      onUpdateBlurs(project.blurs.map((b) => (b.id === id ? { ...b, locked: !b.locked } : b)));
    } else if (row.kind === 'logo' && row.selection.kind === 'logo') {
      const id = row.selection.id;
      onUpdateLogos(project.logos.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l)));
    } else if (row.kind === 'captions') {
      onUpdateSubtitleStyle({ locked: !row.locked });
    }
  };

  const duplicateLayer = (row: LayerRow) => {
    if (row.kind === 'blur' && row.selection.kind === 'blur') {
      const targetId = row.selection.id;
      const orig = project.blurs.find((b) => b.id === targetId);
      if (!orig) return;
      const copy: BlurEffect = {
        ...orig,
        id: uuidv4(),
        name: `${orig.name} Copy`,
        x: Math.min(0.85, orig.x + 0.04),
        y: Math.min(0.85, orig.y + 0.04),
        locked: false,
      };
      onUpdateBlurs([...project.blurs, copy]);
      onSelectElement({ kind: 'blur', id: copy.id });
    } else if (row.kind === 'logo' && row.selection.kind === 'logo') {
      const targetId = row.selection.id;
      const orig = project.logos.find((l) => l.id === targetId);
      if (!orig) return;
      const copy: LogoOverlay = {
        ...orig,
        id: uuidv4(),
        presetPosition: 'custom',
        x: Math.min(0.85, orig.x + 0.05),
        y: Math.min(0.85, orig.y + 0.05),
        locked: false,
      };
      onUpdateLogos([...project.logos, copy]);
      onSelectElement({ kind: 'logo', id: copy.id });
    }
  };

  const deleteLayer = (row: LayerRow) => {
    if (row.kind === 'blur' && row.selection.kind === 'blur') {
      const targetId = row.selection.id;
      const next = project.blurs.filter((b) => b.id !== targetId);
      onUpdateBlurs(next);
      onSelectElement(null);
    } else if (row.kind === 'logo' && row.selection.kind === 'logo') {
      const targetId = row.selection.id;
      const next = project.logos.filter((l) => l.id !== targetId);
      onUpdateLogos(next);
      onSelectElement(null);
    }
  };

  const updateSelectedOpacity = (opacity: number) => {
    if (!selectedRow) return;
    if (selectedRow.kind === 'video') {
      onUpdateCanvas({ videoOpacity: opacity });
    } else if (selectedRow.kind === 'bg-image') {
      onUpdateCanvas({ bgImageOpacity: opacity });
    } else if (selectedRow.kind === 'blur' && selectedRow.selection.kind === 'blur') {
      const id = selectedRow.selection.id;
      onUpdateBlurs(project.blurs.map((b) => (b.id === id ? { ...b, opacity } : b)));
    } else if (selectedRow.kind === 'logo' && selectedRow.selection.kind === 'logo') {
      const id = selectedRow.selection.id;
      onUpdateLogos(project.logos.map((l) => (l.id === id ? { ...l, opacity } : l)));
    } else if (selectedRow.kind === 'captions') {
      onUpdateSubtitleStyle({ opacity });
    }
  };

  const updateSelectedRotation = (rotation: number) => {
    if (!selectedRow) return;
    if (selectedRow.kind === 'video') {
      onUpdateCanvas({ videoRotation: rotation });
    } else if (selectedRow.kind === 'bg-image') {
      onUpdateCanvas({ bgImageRotation: rotation });
    } else if (selectedRow.kind === 'blur' && selectedRow.selection.kind === 'blur') {
      const id = selectedRow.selection.id;
      onUpdateBlurs(project.blurs.map((b) => (b.id === id ? { ...b, rotation } : b)));
    } else if (selectedRow.kind === 'logo' && selectedRow.selection.kind === 'logo') {
      const id = selectedRow.selection.id;
      onUpdateLogos(project.logos.map((l) => (l.id === id ? { ...l, rotation } : l)));
    } else if (selectedRow.kind === 'captions') {
      onUpdateSubtitleStyle({ rotation });
    }
  };

  const iconForKind = (kind: LayerRow['kind']) => {
    if (kind === 'video') return <Film className="w-3.5 h-3.5 text-violet-400 shrink-0" />;
    if (kind === 'bg-image') return <ImageIcon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
    if (kind === 'blur') return <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    if (kind === 'logo') return <Layers className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    return <Type className="w-3.5 h-3.5 text-pink-400 shrink-0" />;
  };

  return (
    <div className="space-y-3.5">
      <div className="p-3 rounded-xl bg-[#18181D] border border-white/[0.08] space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-white flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-violet-400" />
            Canvas Layer Stack
          </span>
          <span className="text-[11px] font-mono text-zinc-500 tabular-nums">
            {rowsTopToBottom.length} Layers
          </span>
        </div>

        <p className="text-[11px] text-zinc-400 leading-relaxed">
          Click any layer or element on the stage to move, resize, rotate, lock, or reorder depth.
          Use <span className="font-mono text-zinc-300">Ctrl/Cmd+Z</span> to undo.
        </p>

        <div className="space-y-1.5 max-h-[290px] overflow-y-auto pr-0.5">
          {rowsTopToBottom.map((row) => {
            const active = isRowSelected(row);
            return (
              <div
                key={row.token}
                onClick={() => onSelectElement(row.selection)}
                className={`px-2.5 py-2 rounded-lg border flex items-center justify-between gap-2 cursor-pointer transition-colors text-xs ${
                  active
                    ? 'bg-violet-600/18 border-violet-500/70 text-white'
                    : 'bg-zinc-900/70 border-white/[0.06] text-zinc-300 hover:border-white/[0.16]'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {iconForKind(row.kind)}
                  <div className="min-w-0">
                    <div className="font-medium truncate">{row.label}</div>
                    <div className="text-[10px] text-zinc-500 font-mono truncate">
                      {row.sublabel}
                    </div>
                  </div>
                </div>

                <div
                  className="flex items-center gap-0.5 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {row.canReorder && (
                    <>
                      <button
                        type="button"
                        onClick={() => moveOverlayOrder(row.token, 'forward')}
                        title="Bring Forward"
                        className="p-1 text-zinc-400 hover:text-white rounded hover:bg-white/[0.06] cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveOverlayOrder(row.token, 'backward')}
                        title="Send Backward"
                        className="p-1 text-zinc-400 hover:text-white rounded hover:bg-white/[0.06] cursor-pointer"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleVisibility(row)}
                    title={row.visible ? 'Hide layer' : 'Show layer'}
                    className={`p-1 rounded hover:bg-white/[0.06] cursor-pointer ${
                      row.visible ? 'text-zinc-300 hover:text-white' : 'text-zinc-600'
                    }`}
                  >
                    {row.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleLock(row)}
                    title={row.locked ? 'Unlock layer' : 'Lock layer'}
                    className={`p-1 rounded hover:bg-white/[0.06] cursor-pointer ${
                      row.locked ? 'text-amber-400' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {row.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  </button>
                  {row.canDuplicate && (
                    <button
                      type="button"
                      onClick={() => duplicateLayer(row)}
                      title="Duplicate layer (Ctrl/Cmd+D)"
                      className="p-1 text-zinc-400 hover:text-white rounded hover:bg-white/[0.06] cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {row.canDelete && (
                    <button
                      type="button"
                      onClick={() => deleteLayer(row)}
                      title="Delete layer"
                      className="p-1 text-zinc-500 hover:text-red-400 rounded hover:bg-white/[0.06] cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Element Precision Transform Panel */}
      {selectedRow && (
        <div className="p-3.5 rounded-xl bg-[#18181D] border border-white/[0.08] space-y-3">
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
            <div className="flex items-center gap-2 min-w-0">
              {iconForKind(selectedRow.kind)}
              <span className="text-xs font-semibold text-white truncate">
                {selectedRow.label}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                updateSelectedRotation(0);
                updateSelectedOpacity(1);
              }}
              className="text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1 cursor-pointer shrink-0"
            >
              <RotateCcw className="w-3 h-3" />
              Reset Transform
            </button>
          </div>

          <div>
            <div className="flex justify-between text-[11px] text-zinc-300">
              <span>Layer Opacity</span>
              <span className="font-mono tabular-nums text-zinc-400">
                {Math.round(selectedRow.opacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              disabled={selectedRow.locked}
              value={selectedRow.opacity}
              onChange={(e) => updateSelectedOpacity(Number(e.target.value))}
              className="mt-1 w-full accent-violet-500 disabled:opacity-40"
            />
          </div>

          <div>
            <div className="flex justify-between text-[11px] text-zinc-300">
              <span>Rotation Angle</span>
              <span className="font-mono tabular-nums text-zinc-400">
                {Math.round(selectedRow.rotation)}°
              </span>
            </div>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              disabled={selectedRow.locked}
              value={selectedRow.rotation}
              onChange={(e) => updateSelectedRotation(Number(e.target.value))}
              className="mt-1 w-full accent-violet-500 disabled:opacity-40"
            />
          </div>
        </div>
      )}
    </div>
  );
}
