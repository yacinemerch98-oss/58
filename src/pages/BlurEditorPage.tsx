import React, { useState } from 'react';
import {
  AlertCircle,
  Crosshair,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Plus,
  SquareDashed,
  Trash2,
  Unlock,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { BlurEffect, BlurMode, BlurType, Project } from '../types/studio';
import { api } from '../lib/api';
import { generateForegroundMaskPng, trackObjectAcrossVideo } from '../lib/visionEngine';

interface BlurEditorPageProps {
  project: Project;
  onProjectUpdated: (p: Project) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  drawMode: 'none' | 'selective' | 'motion';
  onSetDrawMode: (mode: 'none' | 'selective' | 'motion') => void;
  selectedBlurId: string | null;
  onSelectBlur: (id: string | null) => void;
}

export function BlurEditorPage({
  project,
  onProjectUpdated,
  videoRef,
  drawMode,
  onSetDrawMode,
  selectedBlurId,
  onSelectBlur,
}: BlurEditorPageProps) {
  const [trackingPct, setTrackingPct] = useState<number | null>(null);
  const [segmentBusy, setSegmentBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const duration = project.metadata?.duration || 12;
  const selectedBlur = project.blurs.find((b) => b.id === selectedBlurId) || project.blurs[0] || null;

  const saveBlurs = async (nextBlurs: BlurEffect[]) => {
    onProjectUpdated({ ...project, blurs: nextBlurs });
    const { project: saved } = await api.updateProject(project.id, { blurs: nextBlurs });
    onProjectUpdated(saved);
  };

  const addBlurEffect = async (mode: BlurMode) => {
    setErrorMsg(null);
    const id = uuidv4();
    const newBlur: BlurEffect = {
      id,
      name:
        mode === 'full'
          ? 'Full Video Blur'
          : mode === 'background'
          ? 'Background AI Blur'
          : mode === 'selective'
          ? 'Selective Blur Zone'
          : 'Motion Tracked Blur',
      mode,
      type: 'gaussian',
      enabled: true,
      intensity: 18,
      radius: 18,
      opacity: 1.0,
      feather: 10,
      rotation: 0,
      locked: false,
      startTime: 0,
      endTime: Number(duration.toFixed(2)),
      x: 0.3,
      y: 0.25,
      width: 0.28,
      height: 0.32,
      shape: 'rect',
    };

    const next = [...project.blurs, newBlur];
    await saveBlurs(next);
    onSelectBlur(id);
    if (mode === 'selective') onSetDrawMode('selective');
    if (mode === 'motion') onSetDrawMode('motion');
  };

  const updateBlur = async (id: string, patch: Partial<BlurEffect>) => {
    const next = project.blurs.map((b) => (b.id === id ? { ...b, ...patch } : b));
    await saveBlurs(next);
  };

  const removeBlur = async (id: string) => {
    const next = project.blurs.filter((b) => b.id !== id);
    await saveBlurs(next);
    if (selectedBlurId === id) {
      onSelectBlur(next[0]?.id || null);
    }
  };

  const handleRunMotionTracking = async (blur: BlurEffect) => {
    if (!videoRef.current || !project.sourceVideoUrl) {
      setErrorMsg('Load a video before running motion tracking.');
      return;
    }
    setErrorMsg(null);
    setTrackingPct(1);
    try {
      const keyframes = await trackObjectAcrossVideo({
        video: videoRef.current,
        initialBox: { x: blur.x, y: blur.y, width: blur.width, height: blur.height },
        startTime: blur.startTime,
        endTime: blur.endTime,
        onProgress: (pct) => setTrackingPct(pct),
      });
      await updateBlur(blur.id, { keyframes });
      onSetDrawMode('none');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setTrackingPct(null);
    }
  };

  const handleCaptureForegroundMatte = async (blur: BlurEffect) => {
    if (!videoRef.current || !project.sourceVideoUrl) {
      setErrorMsg('Load a video before running foreground segmentation.');
      return;
    }
    setErrorMsg(null);
    setSegmentBusy(true);
    try {
      const maskBase64 = generateForegroundMaskPng(videoRef.current);
      const res = await api.uploadMask(project.id, blur.id, maskBase64);
      await updateBlur(blur.id, { maskAssetId: res.maskUrl });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSegmentBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="border-b border-white/[0.08] pb-3">
        <h2 className="text-sm font-display font-semibold text-white">Advanced Blur Engine</h2>
        <p className="text-xs text-zinc-400 mt-0.5">
          Select exact blur zones directly on the video, control blur opacity, or track motion.
        </p>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 4 Blur Mode Creation Grid */}
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            { mode: 'full', label: 'A. Full Video Blur' },
            { mode: 'background', label: 'B. Background Blur' },
            { mode: 'selective', label: 'C. Pick Region Blur' },
            { mode: 'motion', label: 'D. Motion Tracking' },
          ] as Array<{ mode: BlurMode; label: string }>
        ).map((item) => (
          <button
            key={item.mode}
            onClick={() => void addBlurEffect(item.mode)}
            className="px-2.5 py-2 rounded-lg bg-[#18181D] hover:bg-violet-600/20 border border-white/[0.08] hover:border-violet-500/50 text-xs font-medium text-zinc-200 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-violet-400 shrink-0" />
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>

      {/* Layer List */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-zinc-400">
          Blur Layers ({project.blurs.length})
        </div>
        {project.blurs.length === 0 ? (
          <div className="p-4 rounded-lg bg-[#18181D] border border-white/[0.06] text-xs text-zinc-500 text-center">
            Choose "C. Pick Region Blur" to draw & position a blur box directly on the video, or
            select another mode above.
          </div>
        ) : (
          <div className="space-y-1.5">
            {project.blurs.map((b) => {
              const active = selectedBlur?.id === b.id;
              return (
                <div
                  key={b.id}
                  onClick={() => onSelectBlur(b.id)}
                  className={`px-3 py-2 rounded-lg border flex items-center justify-between gap-2 cursor-pointer text-xs ${
                    active
                      ? 'bg-violet-600/15 border-violet-500/60 text-white'
                      : 'bg-[#18181D] border-white/[0.06] text-zinc-300 hover:border-white/[0.15]'
                  }`}
                >
                  <div className="truncate">
                    <span className="font-medium">{b.name}</span>
                    <span className="text-[11px] text-zinc-500 font-mono ml-2">
                      {b.startTime}s–{b.endTime}s
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void updateBlur(b.id, { locked: !b.locked });
                      }}
                      className={`p-1 cursor-pointer ${
                        b.locked ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-200'
                      }`}
                      title={b.locked ? 'Unlock blur' : 'Lock blur'}
                    >
                      {b.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void updateBlur(b.id, { enabled: !b.enabled });
                      }}
                      className="p-1 text-zinc-400 hover:text-white cursor-pointer"
                      title={b.enabled ? 'Disable blur' : 'Enable blur'}
                    >
                      {b.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeBlur(b.id);
                      }}
                      className="p-1 text-zinc-500 hover:text-red-400 cursor-pointer"
                      title="Delete blur"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected Blur Controls */}
      {selectedBlur && (
        <div className="p-3.5 rounded-lg bg-[#18181D] border border-white/[0.08] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-100">{selectedBlur.name}</span>
            <span className="text-[11px] font-mono text-violet-300 uppercase">
              {selectedBlur.mode}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-zinc-400">Blur Type</label>
              <select
                value={selectedBlur.type}
                onChange={(e) =>
                  void updateBlur(selectedBlur.id, { type: e.target.value as BlurType })
                }
                className="mt-1 w-full bg-zinc-900 border border-white/[0.08] rounded-md px-2 py-1.5 text-xs text-zinc-100"
              >
                <option value="gaussian">Gaussian</option>
                <option value="box">Box Blur</option>
                <option value="pixelate">Pixelate</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-zinc-400">
                Intensity / Radius ({selectedBlur.radius})
              </label>
              <input
                type="range"
                min={3}
                max={42}
                value={selectedBlur.radius}
                onChange={(e) =>
                  void updateBlur(selectedBlur.id, {
                    radius: Number(e.target.value),
                    intensity: Number(e.target.value),
                  })
                }
                className="mt-2.5 w-full accent-violet-500"
              />
            </div>
          </div>

          {/* Blur Transparency, Feathering & Rotation */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Opacity</span>
                <span className="font-mono tabular-nums">
                  {Math.round((selectedBlur.opacity ?? 1) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={selectedBlur.opacity ?? 1}
                onChange={(e) =>
                  void updateBlur(selectedBlur.id, { opacity: Number(e.target.value) })
                }
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Edge Feather</span>
                <span className="font-mono tabular-nums">{selectedBlur.feather ?? 10}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={30}
                step={1}
                value={selectedBlur.feather ?? 10}
                onChange={(e) =>
                  void updateBlur(selectedBlur.id, { feather: Number(e.target.value) })
                }
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Rotation</span>
                <span className="font-mono tabular-nums">{Math.round(selectedBlur.rotation ?? 0)}°</span>
              </div>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={selectedBlur.rotation ?? 0}
                onChange={(e) =>
                  void updateBlur(selectedBlur.id, { rotation: Number(e.target.value) })
                }
                className="mt-1 w-full accent-violet-500"
              />
            </div>
          </div>

          <p className="text-[10.5px] text-zinc-500 leading-relaxed">
            Selection outlines only appear in edit mode when this region is selected with Guides enabled. Final preview and exported MP4 blend smoothly with zero borders.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-zinc-400">Start Time (s)</label>
              <input
                type="number"
                min={0}
                max={duration}
                step={0.1}
                value={selectedBlur.startTime}
                onChange={(e) =>
                  void updateBlur(selectedBlur.id, { startTime: Number(e.target.value) })
                }
                className="mt-1 w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-xs font-mono text-zinc-100"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-400">End Time (s)</label>
              <input
                type="number"
                min={0}
                max={duration}
                step={0.1}
                value={selectedBlur.endTime}
                onChange={(e) =>
                  void updateBlur(selectedBlur.id, { endTime: Number(e.target.value) })
                }
                className="mt-1 w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-xs font-mono text-zinc-100"
              />
            </div>
          </div>

          {/* Selective & Motion Tracking Controls */}
          {(selectedBlur.mode === 'selective' || selectedBlur.mode === 'motion') && (
            <div className="pt-2 border-t border-white/[0.06] space-y-2.5">
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    onSetDrawMode(
                      drawMode === selectedBlur.mode
                        ? 'none'
                        : (selectedBlur.mode as 'selective' | 'motion')
                    )
                  }
                  className={`flex-1 py-1.5 px-2.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
                    drawMode === selectedBlur.mode
                      ? 'bg-violet-600 text-white'
                      : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                  }`}
                >
                  <SquareDashed className="w-3.5 h-3.5" />
                  {drawMode === selectedBlur.mode
                    ? 'Click & Drag on Video...'
                    : 'Draw New Location on Video'}
                </button>

                {selectedBlur.mode === 'selective' && (
                  <select
                    value={selectedBlur.shape}
                    onChange={(e) =>
                      void updateBlur(selectedBlur.id, {
                        shape: e.target.value as 'rect' | 'ellipse',
                      })
                    }
                    className="bg-zinc-900 border border-white/[0.08] rounded-md px-2 py-1.5 text-xs text-zinc-100"
                  >
                    <option value="rect">Rectangle</option>
                    <option value="ellipse">Ellipse</option>
                  </select>
                )}
              </div>

              <p className="text-[11px] text-zinc-400">
                You can also drag the blur box directly on the video player to move it or drag its
                corner handle to resize.
              </p>

              <div className="grid grid-cols-4 gap-1.5 text-[11px] font-mono">
                <div>
                  <span className="text-zinc-500">X</span>
                  <input
                    type="number"
                    step={0.02}
                    min={0}
                    max={0.95}
                    value={selectedBlur.x}
                    onChange={(e) => void updateBlur(selectedBlur.id, { x: Number(e.target.value) })}
                    className="w-full bg-zinc-900 border border-white/[0.08] rounded px-1.5 py-1 text-zinc-200"
                  />
                </div>
                <div>
                  <span className="text-zinc-500">Y</span>
                  <input
                    type="number"
                    step={0.02}
                    min={0}
                    max={0.95}
                    value={selectedBlur.y}
                    onChange={(e) => void updateBlur(selectedBlur.id, { y: Number(e.target.value) })}
                    className="w-full bg-zinc-900 border border-white/[0.08] rounded px-1.5 py-1 text-zinc-200"
                  />
                </div>
                <div>
                  <span className="text-zinc-500">W</span>
                  <input
                    type="number"
                    step={0.02}
                    min={0.04}
                    max={1}
                    value={selectedBlur.width}
                    onChange={(e) =>
                      void updateBlur(selectedBlur.id, { width: Number(e.target.value) })
                    }
                    className="w-full bg-zinc-900 border border-white/[0.08] rounded px-1.5 py-1 text-zinc-200"
                  />
                </div>
                <div>
                  <span className="text-zinc-500">H</span>
                  <input
                    type="number"
                    step={0.02}
                    min={0.04}
                    max={1}
                    value={selectedBlur.height}
                    onChange={(e) =>
                      void updateBlur(selectedBlur.id, { height: Number(e.target.value) })
                    }
                    className="w-full bg-zinc-900 border border-white/[0.08] rounded px-1.5 py-1 text-zinc-200"
                  />
                </div>
              </div>

              {selectedBlur.mode === 'motion' && (
                <div className="space-y-2">
                  <button
                    onClick={() => void handleRunMotionTracking(selectedBlur)}
                    disabled={trackingPct !== null}
                    className="w-full py-2 px-3 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {trackingPct !== null ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Crosshair className="w-3.5 h-3.5" />
                    )}
                    {trackingPct !== null
                      ? `Tracking Object (${trackingPct}%)...`
                      : 'Track Moving Object Across Video'}
                  </button>
                  {selectedBlur.keyframes && selectedBlur.keyframes.length > 0 && (
                    <div className="text-[11px] text-emerald-400 font-mono">
                      {selectedBlur.keyframes.length} motion tracking keyframes recorded
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Background Segmentation Matte */}
          {selectedBlur.mode === 'background' && (
            <div className="pt-2 border-t border-white/[0.06] space-y-2">
              <button
                onClick={() => void handleCaptureForegroundMatte(selectedBlur)}
                disabled={segmentBusy}
                className="w-full py-2 px-3 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {segmentBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {segmentBusy ? 'Segmenting Subject...' : 'Generate Foreground Segmentation Matte'}
              </button>
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                {selectedBlur.maskAssetId
                  ? 'Foreground alpha matte captured and linked to FFmpeg alphamerge pipeline.'
                  : 'Pause on a representative frame and generate a foreground matte to keep the subject sharp while blurring the background.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
