import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Move,
  Trash2,
  Unlock,
  UploadCloud,
} from 'lucide-react';
import { LogoMotionConfig, LogoMotionPattern, LogoOverlay, Project } from '../types/studio';
import { api } from '../lib/api';

interface BrandingPageProps {
  project: Project;
  onProjectUpdated: (p: Project) => void;
  selectedLogoId: string | null;
  onSelectLogo: (id: string | null) => void;
}

const DEFAULT_MOTION: LogoMotionConfig = {
  enabled: false,
  pattern: 'bounce',
  speed: 1.0,
  endX: 0.78,
  endY: 0.8,
};

export function BrandingPage({
  project,
  onProjectUpdated,
  selectedLogoId,
  onSelectLogo,
}: BrandingPageProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const duration = project.metadata?.duration || 30;
  const selectedLogo =
    project.logos.find((l) => l.id === selectedLogoId) || project.logos[0] || null;

  const saveLogos = async (nextLogos: LogoOverlay[]) => {
    onProjectUpdated({ ...project, logos: nextLogos });
    const { project: saved } = await api.updateProject(project.id, { logos: nextLogos });
    onProjectUpdated(saved);
  };

  const handleUploadLogo = async (file: File) => {
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await api.uploadLogo(project.id, file);
      onProjectUpdated(res.project);
      const added = res.project.logos[res.project.logos.length - 1];
      if (added) onSelectLogo(added.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const updateLogo = async (id: string, patch: Partial<LogoOverlay>) => {
    const next = project.logos.map((l) => (l.id === id ? { ...l, ...patch } : l));
    await saveLogos(next);
  };

  const updateLogoMotion = async (logo: LogoOverlay, patch: Partial<LogoMotionConfig>) => {
    const currentMotion = logo.motion || DEFAULT_MOTION;
    await updateLogo(logo.id, {
      motion: { ...currentMotion, ...patch },
    });
  };

  const applyPreset = async (
    logo: LogoOverlay,
    preset: LogoOverlay['presetPosition']
  ) => {
    const wNorm = logo.widthPct / 100;
    const coords: Record<LogoOverlay['presetPosition'], { x: number; y: number }> = {
      'top-left': { x: 0.04, y: 0.05 },
      'top-right': { x: Math.max(0.05, 0.96 - wNorm), y: 0.05 },
      'bottom-left': { x: 0.04, y: 0.82 },
      'bottom-right': { x: Math.max(0.05, 0.96 - wNorm), y: 0.82 },
      center: { x: Math.max(0.05, (1 - wNorm) / 2), y: 0.42 },
      custom: { x: logo.x, y: logo.y },
    };
    await updateLogo(logo.id, {
      presetPosition: preset,
      x: Number(coords[preset].x.toFixed(3)),
      y: Number(coords[preset].y.toFixed(3)),
    });
  };

  const removeLogo = async (id: string) => {
    const next = project.logos.filter((l) => l.id !== id);
    await saveLogos(next);
    if (selectedLogoId === id) {
      onSelectLogo(next[0]?.id || null);
    }
  };

  const motion = selectedLogo?.motion || DEFAULT_MOTION;

  return (
    <div className="space-y-5">
      <div className="border-b border-white/[0.08] pb-3">
        <h2 className="text-sm font-display font-semibold text-white">Logo & Watermark Editor</h2>
        <p className="text-xs text-zinc-400 mt-0.5">
          Upload PNG/SVG logos, adjust transparency, animate watermark motion, and drag on video.
        </p>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div>
        <input
          ref={fileRef}
          type="file"
          accept=".png,.svg,image/png,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUploadLogo(f);
            e.target.value = '';
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="w-full py-2.5 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center justify-center gap-2 cursor-pointer"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
          {busy ? 'Uploading Logo...' : 'Upload PNG or SVG Logo'}
        </button>
      </div>

      {/* Logo Layers List */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-zinc-400">
          Logo Overlays ({project.logos.length})
        </div>

        {project.logos.length === 0 ? (
          <div className="p-4 rounded-lg bg-[#18181D] border border-white/[0.06] text-xs text-zinc-500 text-center">
            No logos added yet. Upload a transparent PNG or SVG brand mark above.
          </div>
        ) : (
          project.logos.map((logo) => (
            <div
              key={logo.id}
              onClick={() => onSelectLogo(logo.id)}
              className={`px-3 py-2 rounded-lg border flex items-center justify-between gap-2 cursor-pointer text-xs ${
                selectedLogo?.id === logo.id
                  ? 'bg-violet-600/15 border-violet-500/60 text-white'
                  : 'bg-[#18181D] border-white/[0.06] text-zinc-300'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <img
                  src={logo.url}
                  alt={logo.filename}
                  className="w-6 h-6 object-contain bg-zinc-900 rounded p-0.5 shrink-0"
                />
                <span className="truncate font-medium">{logo.filename}</span>
                {logo.motion?.enabled && (
                  <span className="text-[10px] font-mono text-violet-300">
                    {logo.motion.pattern}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void updateLogo(logo.id, { locked: !logo.locked });
                  }}
                  title={logo.locked ? 'Unlock logo' : 'Lock logo'}
                  className={`p-1 cursor-pointer ${
                    logo.locked ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  {logo.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void updateLogo(logo.id, { enabled: !logo.enabled });
                  }}
                  className="p-1 text-zinc-400 hover:text-white cursor-pointer"
                >
                  {logo.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeLogo(logo.id);
                  }}
                  className="p-1 text-zinc-500 hover:text-red-400 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Selected Logo Properties */}
      {selectedLogo && (
        <>
          <div className="p-3.5 rounded-lg bg-[#18181D] border border-white/[0.08] space-y-3">
            <div className="text-xs font-medium text-zinc-300">Placement & Transparency</div>

            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ['top-left', 'Top Left'],
                  ['top-right', 'Top Right'],
                  ['center', 'Center'],
                  ['bottom-left', 'Bottom Left'],
                  ['bottom-right', 'Bottom Right'],
                ] as Array<[LogoOverlay['presetPosition'], string]>
              ).map(([preset, label]) => (
                <button
                  key={preset}
                  onClick={() => void applyPreset(selectedLogo, preset)}
                  className={`px-2 py-1.5 rounded text-[11px] font-medium cursor-pointer ${
                    selectedLogo.presetPosition === preset
                      ? 'bg-violet-600 text-white'
                      : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Logo Width</span>
                <span className="font-mono tabular-nums">{selectedLogo.widthPct}%</span>
              </div>
              <input
                type="range"
                min={4}
                max={55}
                step={1}
                value={selectedLogo.widthPct}
                onChange={(e) =>
                  void updateLogo(selectedLogo.id, { widthPct: Number(e.target.value) })
                }
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Opacity / Transparency</span>
                <span className="font-mono tabular-nums">
                  {Math.round(selectedLogo.opacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={selectedLogo.opacity}
                onChange={(e) =>
                  void updateLogo(selectedLogo.id, { opacity: Number(e.target.value) })
                }
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Rotation Angle</span>
                <span className="font-mono tabular-nums">{Math.round(selectedLogo.rotation ?? 0)}°</span>
              </div>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={selectedLogo.rotation ?? 0}
                onChange={(e) =>
                  void updateLogo(selectedLogo.id, { rotation: Number(e.target.value) })
                }
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            <label className="flex items-center justify-between text-xs text-zinc-300 cursor-pointer pt-1">
              <span>Permanent Watermark (Entire Video)</span>
              <input
                type="checkbox"
                checked={selectedLogo.permanent}
                onChange={(e) => void updateLogo(selectedLogo.id, { permanent: e.target.checked })}
                className="accent-violet-500"
              />
            </label>

            {!selectedLogo.permanent && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-zinc-400">Start Time (s)</label>
                  <input
                    type="number"
                    min={0}
                    max={duration}
                    step={0.1}
                    value={selectedLogo.startTime}
                    onChange={(e) =>
                      void updateLogo(selectedLogo.id, { startTime: Number(e.target.value) })
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
                    value={selectedLogo.endTime}
                    onChange={(e) =>
                      void updateLogo(selectedLogo.id, { endTime: Number(e.target.value) })
                    }
                    className="mt-1 w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-xs font-mono text-zinc-100"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Animated Motion Watermark Settings */}
          <div className="p-3.5 rounded-lg bg-[#18181D] border border-white/[0.08] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                <Move className="w-3.5 h-3.5 text-violet-400" />
                Animated Logo Motion
              </span>
              <label className="flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={motion.enabled}
                  onChange={(e) =>
                    void updateLogoMotion(selectedLogo, {
                      enabled: e.target.checked,
                      pattern:
                        e.target.checked && motion.pattern === 'static'
                          ? 'bounce'
                          : motion.pattern,
                    })
                  }
                  className="accent-violet-500"
                />
                Enable Motion
              </label>
            </div>

            {motion.enabled && (
              <div className="space-y-3 pt-1 border-t border-white/[0.06]">
                <div>
                  <label className="text-[11px] text-zinc-400">Motion Pattern</label>
                  <select
                    value={motion.pattern}
                    onChange={(e) =>
                      void updateLogoMotion(selectedLogo, {
                        pattern: e.target.value as LogoMotionPattern,
                      })
                    }
                    className="mt-1 w-full bg-zinc-900 border border-white/[0.08] rounded-md px-2.5 py-1.5 text-xs text-zinc-100"
                  >
                    <option value="bounce">Bounce Across Frame (Anti-Crop)</option>
                    <option value="horizontal">Horizontal Patrol Sweep</option>
                    <option value="orbit">Floating Circular Drift</option>
                    <option value="custom">Custom Glide (Start → Target)</option>
                  </select>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Motion Speed</span>
                    <span className="font-mono tabular-nums">{motion.speed.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.2}
                    max={3.0}
                    step={0.1}
                    value={motion.speed}
                    onChange={(e) =>
                      void updateLogoMotion(selectedLogo, { speed: Number(e.target.value) })
                    }
                    className="mt-1 w-full accent-violet-500"
                  />
                </div>

                {motion.pattern === 'custom' && (
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div>
                      <span className="text-zinc-400">Target End X</span>
                      <input
                        type="number"
                        min={0}
                        max={0.92}
                        step={0.05}
                        value={motion.endX ?? 0.78}
                        onChange={(e) =>
                          void updateLogoMotion(selectedLogo, { endX: Number(e.target.value) })
                        }
                        className="mt-1 w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-zinc-200"
                      />
                    </div>
                    <div>
                      <span className="text-zinc-400">Target End Y</span>
                      <input
                        type="number"
                        min={0}
                        max={0.92}
                        step={0.05}
                        value={motion.endY ?? 0.8}
                        onChange={(e) =>
                          void updateLogoMotion(selectedLogo, { endY: Number(e.target.value) })
                        }
                        className="mt-1 w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-zinc-200"
                      />
                    </div>
                  </div>
                )}

                <p className="text-[11px] text-zinc-500">
                  Press Play on the video player to preview the moving watermark in real time.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
