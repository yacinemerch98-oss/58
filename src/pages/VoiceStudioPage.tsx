import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bookmark,
  Check,
  CheckCircle2,
  Edit3,
  Languages,
  Loader2,
  Lock,
  Mic,
  Music,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sliders,
  Sparkles,
  Star,
  Trash2,
  Volume2,
  Wand2,
} from 'lucide-react';
import {
  CaptionSegment,
  FishVoiceModel,
  NavPage,
  Project,
  RenderJob,
  SavedFishVoice,
  SupportedLanguage,
  VoiceConfig,
} from '../types/studio';
import { api } from '../lib/api';
import { formatBytes, formatTimecode } from '../lib/formatters';
import { createWorkflowUpdate } from '../lib/workflowStages';
import { VideoStudioPlayer } from '../components/VideoStudioPlayer';
import { ExternalGeminiTranslatorPanel } from '../components/ExternalGeminiTranslatorPanel';
import { TimelineSyncCard } from '../components/TimelineSyncCard';

interface VoiceStudioPageProps {
  project: Project;
  onProjectUpdated: (p: Project) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  onSeek: (time: number) => void;
  previewEffects: boolean;
  onTogglePreviewEffects: (val: boolean) => void;
  onNavigate?: (page: NavPage) => void;
}

const SOURCE_LANGUAGES = [
  'Auto',
  'English',
  'French',
  'Arabic',
  'Spanish',
  'German',
  'Portuguese',
  'Italian',
  'Turkish',
  'Hindi',
];

const DUB_TARGET_LANGUAGES: SupportedLanguage[] = [
  'French',
  'Arabic',
  'English',
  'Spanish',
  'German',
  'Portuguese',
];

export function VoiceStudioPage({
  project,
  onProjectUpdated,
  videoRef,
  currentTime,
  onTimeUpdate,
  onSeek,
  previewEffects,
  onTogglePreviewEffects,
  onNavigate,
}: VoiceStudioPageProps) {
  const musicInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<number | null>(null);

  const [fishConfigured, setFishConfigured] = useState<boolean | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState<string>(
    project.translation.sourceLanguage || 'Auto'
  );
  const [targetLanguage, setTargetLanguage] = useState<SupportedLanguage>(
    DUB_TARGET_LANGUAGES.includes(project.voice.targetLanguage)
      ? project.voice.targetLanguage
      : 'French'
  );
  const [preserveProperNouns, setPreserveProperNouns] = useState<boolean>(
    project.translation.preserveProperNouns
  );
  const [translationMode, setTranslationMode] = useState<'auto' | 'external-gemini'>('auto');

  // Fish Audio Voices Browser & Saved Voice Library
  const [voices, setVoices] = useState<FishVoiceModel[]>([]);
  const [voiceQuery, setVoiceQuery] = useState('');
  const [selfVoicesOnly, setSelfVoicesOnly] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [savedVoices, setSavedVoices] = useState<SavedFishVoice[]>([]);
  const [newVoiceName, setNewVoiceName] = useState('');
  const [newVoiceId, setNewVoiceId] = useState('');
  const [setAsDefaultOnSave, setSetAsDefaultOnSave] = useState(false);
  const [editingSavedVoiceId, setEditingSavedVoiceId] = useState<string | null>(null);
  const [editVoiceName, setEditVoiceName] = useState('');
  const [editVoiceId, setEditVoiceId] = useState('');
  const [busySavedVoice, setBusySavedVoice] = useState(false);

  // Operation States
  const [busyTranscribe, setBusyTranscribe] = useState(false);
  const [busyTranslate, setBusyTranslate] = useState(false);
  const [busyPreview, setBusyPreview] = useState(false);
  const [busyGenerate, setBusyGenerate] = useState(false);
  const [busyRegenSegments, setBusyRegenSegments] = useState(false);
  const [busyMusic, setBusyMusic] = useState(false);
  const [focusAudioOverflowSignal, setFocusAudioOverflowSignal] = useState(0);

  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const [activeDubJob, setActiveDubJob] = useState<RenderJob | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const voice = project.voice;

  useEffect(() => {
    void api
      .getSystemStatus()
      .then((s) => setFishConfigured(s.fishConfigured))
      .catch(() => setFishConfigured(null));
    void api
      .listSavedFishVoices()
      .then(({ voices: sv }) => setSavedVoices(sv))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setSourceLanguage(project.translation.sourceLanguage || 'Auto');
    setActiveDubJob(null);
    void api
      .listProjectJobs(project.id)
      .then(({ jobs }) => {
        const runningVoice = jobs.find(
          (j) =>
            j.type === 'voice' && (j.status === 'queued' || j.status === 'processing')
        );
        if (runningVoice) {
          setActiveDubJob(runningVoice);
        }
      })
      .catch(() => {});
  }, [project.id, project.translation.sourceLanguage]);

  const loadFishVoices = async (opts?: { q?: string; self?: boolean }) => {
    setLoadingVoices(true);
    setVoicesError(null);
    try {
      const res = await api.listFishVoices({
        query: opts?.q ?? voiceQuery,
        selfOnly: opts?.self ?? selfVoicesOnly,
      });
      setVoices(res.voices);
    } catch (err) {
      setVoicesError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingVoices(false);
    }
  };

  useEffect(() => {
    if (fishConfigured) {
      void loadFishVoices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fishConfigured]);

  // Poll active Fish Audio dubbing job
  useEffect(() => {
    if (
      !activeDubJob ||
      (activeDubJob.status !== 'queued' && activeDubJob.status !== 'processing')
    ) {
      return;
    }

    const timer = setInterval(async () => {
      try {
        const res = await api.getJob(activeDubJob.id);
        setActiveDubJob(res.job);
        if (res.job.status === 'completed') {
          const pRes = await api.getProject(project.id);
          const nextWorkflow = createWorkflowUpdate(pRes.project.workflow, {
            completeStage: 'voice',
            modifiedStage: 'voice',
            hasExistingExport: Boolean(pRes.project.lastExportUrl),
          });
          const { project: syncedProject } = await api.updateProject(project.id, {
            workflow: nextWorkflow,
          });
          onProjectUpdated(syncedProject);
          setStatusMsg(
            `Generated all ${syncedProject.voice.generatedClips.length} synchronized MP3 segments using Fish Audio s2.1-pro-free.`
          );
        } else if (res.job.status === 'failed') {
          setErrorMsg(res.job.error || 'Fish Audio dubbing job failed.');
        }
      } catch {
        // ignore transient poll error
      }
    }, 700);

    return () => clearInterval(timer);
  }, [activeDubJob, project.id, onProjectUpdated]);

  const updateVoice = async (patch: Partial<VoiceConfig>) => {
    const nextVoice: VoiceConfig = { ...voice, ...patch, provider: 'fish' };
    const nextWorkflow = createWorkflowUpdate(project.workflow, {
      visitStage: 'voice',
      modifiedStage: 'voice',
      hasExistingExport: Boolean(project.lastExportUrl),
    });
    onProjectUpdated({ ...project, voice: nextVoice, workflow: nextWorkflow });
    const { project: saved } = await api.updateProject(project.id, {
      voice: nextVoice,
      workflow: nextWorkflow,
    });
    onProjectUpdated(saved);
  };

  const handleSaveFishVoice = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newVoiceName.trim();
    const trimmedId = newVoiceId.trim();
    if (!trimmedName || !trimmedId) return;
    setErrorMsg(null);
    setBusySavedVoice(true);
    try {
      const res = await api.createSavedFishVoice({
        name: trimmedName,
        voiceId: trimmedId,
        isDefault: setAsDefaultOnSave,
      });
      setSavedVoices(res.voices);
      setNewVoiceName('');
      setNewVoiceId('');
      setSetAsDefaultOnSave(false);
      await updateVoice({
        fishReferenceId: res.voice.voiceId,
        fishVoiceTitle: res.voice.name,
      });
      setStatusMsg(`Saved voice "${res.voice.name}" and set it active for this project.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusySavedVoice(false);
    }
  };

  const handleUseSavedVoice = async (savedVoice: SavedFishVoice) => {
    await updateVoice({
      fishReferenceId: savedVoice.voiceId,
      fishVoiceTitle: savedVoice.name,
    });
    setStatusMsg(`Selected saved voice "${savedVoice.name}".`);
  };

  const handleSetDefaultSavedVoice = async (savedVoice: SavedFishVoice) => {
    setErrorMsg(null);
    setBusySavedVoice(true);
    try {
      const res = await api.updateSavedFishVoice(savedVoice.id, { isDefault: true });
      setSavedVoices(res.voices);
      await updateVoice({
        fishReferenceId: savedVoice.voiceId,
        fishVoiceTitle: savedVoice.name,
      });
      setStatusMsg(`Set "${savedVoice.name}" as global default Fish Audio voice.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusySavedVoice(false);
    }
  };

  const handleSaveEditedSavedVoice = async (id: string) => {
    const trimmedName = editVoiceName.trim();
    const trimmedId = editVoiceId.trim();
    if (!trimmedName || !trimmedId) return;
    setErrorMsg(null);
    setBusySavedVoice(true);
    try {
      const oldVoice = savedVoices.find((v) => v.id === id);
      const res = await api.updateSavedFishVoice(id, {
        name: trimmedName,
        voiceId: trimmedId,
      });
      setSavedVoices(res.voices);
      setEditingSavedVoiceId(null);
      if (oldVoice && voice.fishReferenceId === oldVoice.voiceId) {
        await updateVoice({
          fishReferenceId: res.voice.voiceId,
          fishVoiceTitle: res.voice.name,
        });
      }
      setStatusMsg(`Updated saved voice "${res.voice.name}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusySavedVoice(false);
    }
  };

  const handleDeleteSavedVoice = async (savedVoice: SavedFishVoice) => {
    setErrorMsg(null);
    setBusySavedVoice(true);
    try {
      const res = await api.deleteSavedFishVoice(savedVoice.id);
      setSavedVoices(res.voices);
      if (editingSavedVoiceId === savedVoice.id) {
        setEditingSavedVoiceId(null);
      }
      setStatusMsg(`Removed "${savedVoice.name}" from saved voices.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusySavedVoice(false);
    }
  };

  const persistCaptionsDebounced = (nextCaptions: CaptionSegment[]) => {
    const nextWorkflow = createWorkflowUpdate(project.workflow, {
      visitStage: 'voice',
      modifiedStage: 'translator',
      hasGeneratedDub: Boolean(project.voice.fullDubUrl),
      hasGeneratedCaptions: Boolean(project.subtitleStyle.captionSync),
      hasExistingExport: Boolean(project.lastExportUrl),
    });
    onProjectUpdated({ ...project, captions: nextCaptions, workflow: nextWorkflow });
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void api
        .updateProject(project.id, { captions: nextCaptions, workflow: nextWorkflow })
        .then(({ project: saved }) => {
          onProjectUpdated(saved);
        });
    }, 450);
  };

  const handleTranscribeFish = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusyTranscribe(true);
    try {
      const res = await api.transcribeWithFish(project.id, sourceLanguage);
      onProjectUpdated(res.project);
      setSourceLanguage(res.detectedLanguage);
      setStatusMsg(
        `Fish Audio ASR extracted ${res.segmentCount} timestamped segments (${res.detectedLanguage}).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyTranscribe(false);
    }
  };

  const handleTranslate = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusyTranslate(true);
    try {
      // Persist any edited source text or timestamps before translating
      await api.updateProject(project.id, {
        captions: project.captions,
        translation: {
          ...project.translation,
          sourceLanguage,
          targetLanguage,
          preserveProperNouns,
        },
        voice: { ...voice, targetLanguage, provider: 'fish' },
      });
      const res = await api.translate(project.id, targetLanguage, preserveProperNouns);
      onProjectUpdated(res.project);
      setStatusMsg(`Translated ${res.project.captions.length} segments to ${targetLanguage}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyTranslate(false);
    }
  };

  const handlePreviewVoice = async () => {
    setErrorMsg(null);
    setBusyPreview(true);
    try {
      const firstSeg = project.captions[0];
      const sampleText =
        (firstSeg && (firstSeg.translatedText || firstSeg.text)) ||
        (targetLanguage === 'French'
          ? 'Tout a bascule au moment ou la porte du coffre s est ouverte en silence.'
          : targetLanguage === 'Arabic'
          ? 'تغير كل شيء في اللحظة التي انفتح فيها باب الخزنة في صمت تام.'
          : targetLanguage === 'Spanish'
          ? 'Todo cambio en el momento en que la puerta de la boveda se abrio en silencio.'
          : targetLanguage === 'German'
          ? 'Alles anderte sich in dem Moment, als sich die Tresortur lautlos offnete.'
          : targetLanguage === 'Portuguese'
          ? 'Tudo mudou no momento em que a porta do cofre se abriu em silencio.'
          : 'Everything changed the moment the vault door swung open in silence.');

      const res = await api.previewFishDub(project.id, {
        text: sampleText,
        referenceId: voice.fishReferenceId,
        speakingSpeed: 1.0,
      });
      setPreviewAudioUrl(res.audioUrl);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyPreview(false);
    }
  };

  const handleGenerateDub = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusyGenerate(true);
    try {
      const hasTranslations = project.captions.some((c) => Boolean(c.translatedText?.trim()));
      const res = await api.generateFishDub(project.id, {
        voice: { ...voice, targetLanguage, provider: 'fish', speakingSpeed: 1.0, enabled: true },
        captions: project.captions,
        useTranslated: hasTranslations,
      });
      setActiveDubJob(res.job);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyGenerate(false);
    }
  };

  const handleRegenerateSelectedSegments = async (segmentIds: string[]) => {
    if (segmentIds.length === 0) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setBusyRegenSegments(true);
    try {
      const hasTranslations = project.captions.some((c) => Boolean(c.translatedText?.trim()));
      const res = await api.regenerateFishSegments(project.id, {
        segmentIds,
        captions: project.captions,
        voice: { ...voice, targetLanguage, provider: 'fish', speakingSpeed: 1.0, enabled: true },
        useTranslated: hasTranslations,
      });
      onProjectUpdated(res.project);
      setStatusMsg(
        `Selectively regenerated ${res.regeneratedIds.length} corrected Fish Audio segment(s) at 1.0x and re-merged synchronized dub track.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyRegenSegments(false);
    }
  };

  const handleMusicUpload = async (file: File) => {
    setErrorMsg(null);
    setBusyMusic(true);
    try {
      const res = await api.uploadMusic(project.id, file);
      onProjectUpdated(res.project);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMusic(false);
    }
  };

  const updateSegment = (id: string, patch: Partial<CaptionSegment>) => {
    const next = project.captions.map((c) => (c.id === id ? { ...c, ...patch } : c));
    persistCaptionsDebounced(next);
  };

  const addSegment = () => {
    const last = project.captions[project.captions.length - 1];
    const start = last ? Number(last.end.toFixed(2)) : 0;
    const end = Number(
      Math.min(project.metadata?.duration || start + 4, start + 3).toFixed(2)
    );
    const next: CaptionSegment[] = [
      ...project.captions,
      {
        id: `seg_${Date.now()}`,
        start,
        end: Math.max(start + 0.5, end),
        text: '',
        translatedText: '',
      },
    ];
    persistCaptionsDebounced(next);
  };

  const removeSegment = (id: string) => {
    const next = project.captions.filter((c) => c.id !== id);
    persistCaptionsDebounced(next);
  };

  const isDubGenerating =
    busyGenerate ||
    Boolean(
      activeDubJob &&
        (activeDubJob.status === 'queued' || activeDubJob.status === 'processing')
    );

  const pendingRegenIds = project.translation.pendingRegenerateSegmentIds || [];

  const syncWarnings = (voice.generatedClips || [])
    .map((clip, idx) => {
      const slotDur = clip.slotDuration ?? Math.max(0.2, clip.end - clip.start);
      const overflow =
        clip.overflowSeconds ?? Math.max(0, Math.round((clip.duration - slotDur) * 100) / 100);
      return { clip, idx, slotDur, overflow };
    })
    .filter((item) => item.overflow > 0.15);

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-5">
      {/* Studio Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-display font-bold tracking-tight text-white">
            AI Video Dubbing Studio
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">
            Transcribe with Fish Audio ASR, translate across languages, synthesize MP3 narration via{' '}
            <span className="font-mono text-violet-300">s2.1-pro-free</span>, and export synced MP4.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#111115] border border-white/[0.08] text-xs text-zinc-200 cursor-pointer">
            <input
              type="checkbox"
              checked={voice.enabled}
              onChange={(e) => void updateVoice({ enabled: e.target.checked })}
              className="accent-violet-500"
            />
            Apply Dubbed Audio to Preview &amp; Export
          </label>
        </div>
      </div>

      {fishConfigured === false && (
        <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">FISH_API_KEY is not configured on the server.</span> Add{' '}
            <code className="font-mono text-amber-100">FISH_API_KEY</code> in the Secrets panel to
            run Fish Audio ASR transcription and <code className="font-mono">s2.1-pro-free</code>{' '}
            MP3 dubbing.
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {statusMsg && (
        <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* LEFT COLUMN: Video Player + Synchronization + Export */}
        <div className="xl:col-span-6 space-y-4">
          <VideoStudioPlayer
            project={project}
            currentTime={currentTime}
            onTimeUpdate={onTimeUpdate}
            videoRef={videoRef}
            previewEffects={previewEffects}
            onTogglePreviewEffects={onTogglePreviewEffects}
            drawMode="none"
          />

          {/* Audio Preview Banner */}
          {(previewAudioUrl || voice.fullDubUrl) && (
            <div className="p-4 rounded-xl bg-[#111115] border border-white/[0.08] space-y-3">
              {previewAudioUrl && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-zinc-200 flex items-center justify-between">
                    <span>Voice Sample Preview (MP3)</span>
                    <span className="font-mono text-[11px] text-violet-300">s2.1-pro-free</span>
                  </div>
                  <audio src={previewAudioUrl} controls autoPlay className="w-full h-9" />
                </div>
              )}

              {voice.fullDubUrl && (
                <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
                  <div className="text-xs font-medium text-emerald-300 flex items-center justify-between">
                    <span>
                      Synchronized Full Dub Track ({voice.generatedClips.length} segments)
                    </span>
                    <a
                      href={`${voice.fullDubUrl}?download=1`}
                      className="text-[11px] font-mono text-violet-300 hover:text-violet-200"
                    >
                      Download MP3
                    </a>
                  </div>
                  <audio src={voice.fullDubUrl} controls className="w-full h-9" />
                </div>
              )}
            </div>
          )}

          {/* Flexible Timeline Synchronization System */}
          <TimelineSyncCard
            project={project}
            onProjectUpdated={onProjectUpdated}
            onSeek={onSeek}
          />

          {/* Synchronization & Audio Mixing Controls */}
          <div className="p-4 rounded-xl bg-[#111115] border border-white/[0.08] space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-display font-semibold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-violet-400" />
                Synchronization &amp; Audio Mixing
              </h2>
              <span className="text-[11px] font-mono text-zinc-400">
                FFmpeg Timeline Mix
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-2.5 rounded-lg bg-[#18181D] border border-white/[0.06] flex flex-col justify-center">
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span className="flex items-center gap-1">
                    <Lock className="w-3 h-3 text-violet-400" />
                    Narrator Speed
                  </span>
                  <span className="font-mono tabular-nums font-semibold text-violet-300">
                    1.00x Constant
                  </span>
                </div>
                <p className="text-[10px] text-zinc-500 mt-1">
                  Uniform voice, pitch &amp; pace across all segments (no time-stretching).
                </p>
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-zinc-400">
                  <span>Dubbed Voice Volume</span>
                  <span className="font-mono tabular-nums text-zinc-200">
                    {Math.round(voice.voiceVolume * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={1.8}
                  step={0.05}
                  value={voice.voiceVolume}
                  onChange={(e) => void updateVoice({ voiceVolume: Number(e.target.value) })}
                  className="mt-1.5 w-full accent-violet-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-zinc-400">
                  <span>Timing Offset</span>
                  <span className="font-mono tabular-nums text-zinc-200">
                    {voice.timingOffsetSec >= 0 ? '+' : ''}
                    {(voice.timingOffsetSec || 0).toFixed(2)}s
                  </span>
                </div>
                <input
                  type="range"
                  min={-2.5}
                  max={2.5}
                  step={0.05}
                  value={voice.timingOffsetSec || 0}
                  onChange={(e) => void updateVoice({ timingOffsetSec: Number(e.target.value) })}
                  className="mt-1.5 w-full accent-violet-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/[0.06]">
              <div className="space-y-2">
                <label className="flex items-center justify-between text-xs text-zinc-200 cursor-pointer">
                  <span>Retain Original Video Audio</span>
                  <input
                    type="checkbox"
                    checked={voice.preserveOriginalAudio}
                    onChange={(e) =>
                      void updateVoice({ preserveOriginalAudio: e.target.checked })
                    }
                    className="accent-violet-500"
                  />
                </label>

                {voice.preserveOriginalAudio ? (
                  <div>
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Original Audio Level</span>
                      <span className="font-mono tabular-nums">
                        {Math.round(voice.originalAudioVolume * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1.2}
                      step={0.05}
                      value={voice.originalAudioVolume}
                      onChange={(e) =>
                        void updateVoice({ originalAudioVolume: Number(e.target.value) })
                      }
                      className="mt-1 w-full accent-violet-500"
                    />
                  </div>
                ) : (
                  <p className="text-[11px] text-zinc-500">
                    Original speech track is muted during dubbed playback and export.
                  </p>
                )}
              </div>

              {/* Optional Background Music */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-300 flex items-center gap-1.5">
                    <Music className="w-3.5 h-3.5 text-zinc-400" />
                    Background Music
                  </span>
                  <input
                    ref={musicInputRef}
                    type="file"
                    accept=".mp3,.wav,.aac,.m4a,.ogg,audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleMusicUpload(f);
                      e.target.value = '';
                    }}
                  />
                  <button
                    onClick={() => musicInputRef.current?.click()}
                    disabled={busyMusic}
                    className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-medium text-zinc-200 cursor-pointer"
                  >
                    {busyMusic ? 'Uploading...' : voice.bgMusicUrl ? 'Replace' : 'Add Track'}
                  </button>
                </div>

                {voice.bgMusicFilename && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-zinc-400">
                      <span className="truncate">{voice.bgMusicFilename}</span>
                      <button
                        onClick={() =>
                          void updateVoice({ bgMusicFilename: undefined, bgMusicUrl: undefined })
                        }
                        className="text-red-400 hover:text-red-300 ml-2 cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      type="range"
                      min={0.02}
                      max={1}
                      step={0.02}
                      value={voice.bgMusicVolume}
                      onChange={(e) => void updateVoice({ bgMusicVolume: Number(e.target.value) })}
                      className="w-full accent-violet-500"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Next Steps: Workflow Navigation (Rendering strictly happens in Stage 7) */}
          <div className="p-4 rounded-xl bg-[#111115] border border-white/[0.08] space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-display font-semibold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-400" />
                Workflow Pipeline Progress
              </h2>
              <span className="text-[11px] font-mono text-zinc-400">
                {project.voice.fullDubUrl ? 'Dub Audio Ready' : 'Stage 3 in Progress'}
              </span>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              Final video rendering occurs at <strong>Stage 7: Final Preview and Export</strong>. Proceed next to Stage 5 to apply color filters, adjustments, and visual effects, followed by CapCut caption customization in Stage 6.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => onNavigate?.('editor')}
                className="py-2.5 px-3.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
              >
                Next: Stage 5 Video Filters →
              </button>

              <button
                onClick={() => onNavigate?.('export')}
                className="py-2.5 px-3.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1.5 cursor-pointer border border-white/[0.06]"
              >
                Go to Stage 7 Final Export
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Transcription, Translation, Fish Voice Selection & Segment Editor */}
        <div className="xl:col-span-6 space-y-4">
          {/* Step 1 & 2: Source / Target Language + Transcribe + Translate */}
          <div className="p-4 rounded-xl bg-[#111115] border border-white/[0.08] space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-display font-semibold text-white flex items-center gap-2">
                <Languages className="w-4 h-4 text-violet-400" />
                1. Transcription &amp; Translation
              </h2>

              <div className="flex items-center bg-zinc-900 border border-white/[0.08] rounded-md p-0.5">
                <button
                  type="button"
                  onClick={() => setTranslationMode('auto')}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    translationMode === 'auto'
                      ? 'bg-violet-600 text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Automatic Pipeline
                </button>
                <button
                  type="button"
                  onClick={() => setTranslationMode('external-gemini')}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    translationMode === 'external-gemini'
                      ? 'bg-violet-600 text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  External Gemini
                </button>
              </div>
            </div>

            {translationMode === 'external-gemini' ? (
              <ExternalGeminiTranslatorPanel
                project={project}
                onProjectUpdated={onProjectUpdated}
                sourceLanguage={sourceLanguage}
                targetLanguage={targetLanguage}
                onChangeTargetLanguage={(nextLang) => {
                  setTargetLanguage(nextLang);
                  void updateVoice({ targetLanguage: nextLang });
                }}
                preserveProperNouns={preserveProperNouns}
                onChangePreserveProperNouns={setPreserveProperNouns}
                allowedTargetLanguages={DUB_TARGET_LANGUAGES}
                focusAudioOverflowSignal={focusAudioOverflowSignal}
                onApprovedSuccess={(count, lang) => {
                  setStatusMsg(
                    `Approved ${count} translated segments (${lang}) from External Gemini. Click "Generate Voice" below to synthesize Fish Audio MP3 dubbing.`
                  );
                }}
              />
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-zinc-400">Source Language</label>
                    <select
                      value={sourceLanguage}
                      onChange={(e) => setSourceLanguage(e.target.value)}
                      className="mt-1 w-full bg-[#18181D] border border-white/[0.08] rounded-lg px-2.5 py-2 text-xs text-zinc-100"
                    >
                      {SOURCE_LANGUAGES.map((l) => (
                        <option key={l} value={l}>
                          {l === 'Auto' ? 'Auto-Detect Spoken Language' : l}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-zinc-400">Target Dubbing Language</label>
                    <select
                      value={targetLanguage}
                      onChange={(e) => {
                        const nextLang = e.target.value as SupportedLanguage;
                        setTargetLanguage(nextLang);
                        void updateVoice({ targetLanguage: nextLang });
                      }}
                      className="mt-1 w-full bg-[#18181D] border border-white/[0.08] rounded-lg px-2.5 py-2 text-xs text-zinc-100"
                    >
                      {DUB_TARGET_LANGUAGES.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preserveProperNouns}
                    onChange={(e) => setPreserveProperNouns(e.target.checked)}
                    className="accent-violet-500"
                  />
                  Preserve character names, movie titles &amp; context during translation
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    onClick={handleTranscribeFish}
                    disabled={!project.sourceVideoUrl || busyTranscribe}
                    className="py-2.5 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs font-semibold text-white flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {busyTranscribe ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Mic className="w-3.5 h-3.5 text-violet-400" />
                    )}
                    {busyTranscribe ? 'Transcribing Audio...' : 'Transcribe with Fish Audio'}
                  </button>

                  <button
                    onClick={handleTranslate}
                    disabled={project.captions.length === 0 || busyTranslate}
                    className="py-2.5 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs font-semibold text-white flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {busyTranslate ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="w-3.5 h-3.5 text-violet-400" />
                    )}
                    {busyTranslate
                      ? `Translating to ${targetLanguage}...`
                      : `Translate to ${targetLanguage}`}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Step 3: Fish Audio Voice Selection (s2.1-pro-free) */}
          <div className="p-4 rounded-xl bg-[#111115] border border-white/[0.08] space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-display font-semibold text-white flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-violet-400" />
                2. Fish Audio Voice Selection
              </h2>
              <span className="text-[11px] font-mono text-violet-300">model: s2.1-pro-free</span>
            </div>

            {/* Active Voice Summary */}
            {(() => {
              const matchedSaved = savedVoices.find(
                (s) => s.voiceId === (voice.fishReferenceId || '').trim()
              );
              const activeDisplayName =
                matchedSaved?.name ||
                voice.fishVoiceTitle ||
                (voice.fishReferenceId
                  ? `Custom Voice (${voice.fishReferenceId.slice(0, 8)}...)`
                  : 'Default Neutral Narrator');

              return (
                <div className="p-3 rounded-lg bg-violet-600/10 border border-violet-500/30 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-violet-300 font-semibold">
                      Active Voice for All Segments
                    </div>
                    <div className="text-xs font-semibold text-white mt-0.5 flex items-center gap-1.5">
                      <span>{activeDisplayName}</span>
                      {matchedSaved?.isDefault && (
                        <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-[10px] font-mono text-violet-200">
                          Default
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-zinc-300 bg-[#18181D] px-2 py-1 rounded border border-white/[0.08]">
                    {voice.fishReferenceId
                      ? `ID: ${voice.fishReferenceId}`
                      : 'Default s2.1-pro-free'}
                  </span>
                </div>
              );
            })()}

            {/* Saved Fish Audio Voice Library */}
            <div className="p-3 rounded-lg bg-[#18181D] border border-white/[0.08] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
                  <Bookmark className="w-3.5 h-3.5 text-violet-400" />
                  Saved Voice IDs ({savedVoices.length})
                </span>

                <select
                  value={
                    savedVoices.some((s) => s.voiceId === voice.fishReferenceId)
                      ? voice.fishReferenceId
                      : voice.fishReferenceId
                      ? '__custom__'
                      : ''
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      void updateVoice({
                        fishReferenceId: '',
                        fishVoiceTitle: 'Default Fish Audio Voice (s2.1-pro-free)',
                      });
                      return;
                    }
                    const found = savedVoices.find((s) => s.voiceId === val);
                    if (found) {
                      void handleUseSavedVoice(found);
                    }
                  }}
                  aria-label="Select saved Fish Audio voice"
                  className="bg-zinc-900 border border-white/[0.08] rounded-md px-2.5 py-1.5 text-xs text-zinc-100 max-w-[260px]"
                >
                  <option value="">Default Fish Audio Voice</option>
                  {savedVoices.map((sv) => (
                    <option key={sv.id} value={sv.voiceId}>
                      {sv.name}
                      {sv.isDefault ? ' (Default)' : ''}
                    </option>
                  ))}
                  {voice.fishReferenceId &&
                    !savedVoices.some((s) => s.voiceId === voice.fishReferenceId) && (
                      <option value="__custom__">
                        Active Unsaved ID ({voice.fishReferenceId.slice(0, 10)}...)
                      </option>
                    )}
                </select>
              </div>

              {savedVoices.length > 0 && (
                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                  {savedVoices.map((sv) => {
                    const isSelected = voice.fishReferenceId === sv.voiceId;
                    const isEditing = editingSavedVoiceId === sv.id;

                    if (isEditing) {
                      return (
                        <div
                          key={sv.id}
                          className="p-2 rounded-lg bg-zinc-900 border border-violet-500/40 space-y-2"
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                              type="text"
                              value={editVoiceName}
                              onChange={(e) => setEditVoiceName(e.target.value)}
                              placeholder="Voice display name"
                              className="bg-[#111115] border border-white/[0.08] rounded px-2 py-1 text-xs text-zinc-100"
                            />
                            <input
                              type="text"
                              value={editVoiceId}
                              onChange={(e) => setEditVoiceId(e.target.value)}
                              placeholder="Fish Audio Voice ID"
                              className="bg-[#111115] border border-white/[0.08] rounded px-2 py-1 text-xs font-mono text-zinc-100"
                            />
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingSavedVoiceId(null)}
                              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-300 cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={busySavedVoice || !editVoiceName.trim() || !editVoiceId.trim()}
                              onClick={() => void handleSaveEditedSavedVoice(sv.id)}
                              className="px-2.5 py-1 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-[11px] font-semibold text-white flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                              Save
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={sv.id}
                        className={`px-2.5 py-2 rounded-lg border flex items-center justify-between gap-2 text-xs ${
                          isSelected
                            ? 'bg-violet-600/15 border-violet-500/50 text-white'
                            : 'bg-zinc-900/70 border-white/[0.06] text-zinc-300'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => void handleUseSavedVoice(sv)}
                          className="flex-1 text-left min-w-0 cursor-pointer"
                        >
                          <div className="font-medium truncate flex items-center gap-1.5">
                            <span>{sv.name}</span>
                            {sv.isDefault && (
                              <span className="text-[10px] font-mono text-amber-300">
                                ★ Default
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-zinc-500 truncate">
                            {sv.voiceId}
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleSetDefaultSavedVoice(sv)}
                            title="Set as global default voice"
                            className={`p-1 rounded hover:bg-zinc-800 cursor-pointer ${
                              sv.isDefault ? 'text-amber-400' : 'text-zinc-500 hover:text-amber-300'
                            }`}
                          >
                            <Star className={`w-3.5 h-3.5 ${sv.isDefault ? 'fill-amber-400' : ''}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSavedVoiceId(sv.id);
                              setEditVoiceName(sv.name);
                              setEditVoiceId(sv.voiceId);
                            }}
                            title="Edit saved voice"
                            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteSavedVoice(sv)}
                            title="Delete saved voice"
                            className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add / Save New Voice Form */}
              <form
                onSubmit={handleSaveFishVoice}
                className="pt-2 border-t border-white/[0.06] space-y-2"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newVoiceName}
                    onChange={(e) => setNewVoiceName(e.target.value)}
                    placeholder="Custom voice name (e.g. Deep Recap Narrator)"
                    className="bg-zinc-900 border border-white/[0.08] rounded-md px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500"
                  />
                  <input
                    type="text"
                    value={newVoiceId}
                    onChange={(e) => setNewVoiceId(e.target.value)}
                    placeholder="Fish Audio voiceId (reference_id)"
                    className="bg-zinc-900 border border-white/[0.08] rounded-md px-2.5 py-1.5 text-xs font-mono text-zinc-100 placeholder:text-zinc-500"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={setAsDefaultOnSave}
                      onChange={(e) => setSetAsDefaultOnSave(e.target.checked)}
                      className="accent-violet-500"
                    />
                    Set as default voice for new projects
                  </label>
                  <button
                    type="submit"
                    disabled={busySavedVoice || !newVoiceName.trim() || !newVoiceId.trim()}
                    className="px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Save Voice
                  </button>
                </div>
              </form>
            </div>

            {/* Search & Authorized Voice Filter */}
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={voiceQuery}
                  onChange={(e) => setVoiceQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void loadFishVoices({ q: voiceQuery });
                  }}
                  placeholder="Search Fish Audio voices..."
                  className="w-full bg-[#18181D] border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500"
                />
              </div>

              <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#18181D] border border-white/[0.08] text-[11px] text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selfVoicesOnly}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSelfVoicesOnly(checked);
                    void loadFishVoices({ self: checked });
                  }}
                  className="accent-violet-500"
                />
                My Voices
              </label>

              <button
                onClick={() => void loadFishVoices()}
                disabled={loadingVoices}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingVoices ? 'animate-spin' : ''}`} />
                Fetch
              </button>
            </div>

            {voicesError && (
              <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                {voicesError}
              </div>
            )}

            {/* Voice Selection Dropdown / Grid */}
            {voices.length > 0 && (
              <div className="max-h-40 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 pr-1">
                <button
                  onClick={() =>
                    void updateVoice({
                      fishReferenceId: '',
                      fishVoiceTitle: 'Default Fish Audio Voice (s2.1-pro-free)',
                    })
                  }
                  className={`text-left p-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                    !voice.fishReferenceId
                      ? 'bg-violet-600/20 border-violet-500/60 text-white'
                      : 'bg-[#18181D] border-white/[0.06] text-zinc-300 hover:border-white/20'
                  }`}
                >
                  <div className="font-medium truncate">Default Neutral Narrator</div>
                  <div className="text-[10px] text-zinc-500 font-mono">No reference_id</div>
                </button>

                {voices.map((v) => {
                  const selected = voice.fishReferenceId === v.id;
                  return (
                    <button
                      key={v.id}
                      onClick={() =>
                        void updateVoice({
                          fishReferenceId: v.id,
                          fishVoiceTitle: v.title,
                        })
                      }
                      className={`text-left p-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                        selected
                          ? 'bg-violet-600/20 border-violet-500/60 text-white'
                          : 'bg-[#18181D] border-white/[0.06] text-zinc-300 hover:border-white/20'
                      }`}
                    >
                      <div className="font-medium truncate">{v.title}</div>
                      <div className="text-[10px] text-zinc-500 truncate">
                        {v.author} {v.languages.length > 0 ? `· ${v.languages.join(', ')}` : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Narration Style & Locked Speed Settings */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/[0.06]">
              <div>
                <label className="text-[11px] text-zinc-400">Narration Style</label>
                <select
                  value={voice.narrationStyle || 'cinematic'}
                  onChange={(e) =>
                    void updateVoice({
                      narrationStyle: e.target.value as 'cinematic' | 'natural',
                    })
                  }
                  className="mt-1 w-full bg-[#18181D] border border-white/[0.08] rounded-lg px-2.5 py-2 text-xs text-zinc-100 cursor-pointer"
                >
                  <option value="cinematic">Cinematic (Dramatic &amp; Gripping)</option>
                  <option value="natural">Natural (Clear &amp; Expressive)</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] text-zinc-400">Narration Speed (Locked)</label>
                <div className="mt-1 w-full bg-[#18181D] border border-white/[0.08] rounded-lg px-2.5 py-2 text-xs font-mono text-violet-300 flex items-center justify-between">
                  <span>1.00x Constant</span>
                  <span className="text-[10px] text-zinc-500">No time-stretching</span>
                </div>
              </div>
            </div>

            {/* Authorized Custom Reference ID */}
            <div>
              <label className="text-[11px] text-zinc-400">
                Direct Voice Reference ID (optional — or pick from Saved Voice IDs above)
              </label>
              <input
                type="text"
                value={voice.fishReferenceId || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  const match = savedVoices.find((s) => s.voiceId === val.trim());
                  onProjectUpdated({
                    ...project,
                    voice: {
                      ...voice,
                      fishReferenceId: val,
                      fishVoiceTitle: match
                        ? match.name
                        : val
                        ? `Voice Reference ${val.slice(0, 8)}...`
                        : 'Default Fish Audio Voice',
                    },
                  });
                }}
                onBlur={(e) => {
                  const trimmed = e.target.value.trim();
                  const match = savedVoices.find((s) => s.voiceId === trimmed);
                  void updateVoice({
                    fishReferenceId: trimmed,
                    fishVoiceTitle: match
                      ? match.name
                      : trimmed
                      ? `Voice Reference ${trimmed.slice(0, 8)}...`
                      : 'Default Fish Audio Voice (s2.1-pro-free)',
                  });
                }}
                placeholder="Paste Fish Audio voice model reference_id..."
                className="mt-1 w-full bg-[#18181D] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-100 placeholder:text-zinc-600"
              />
            </div>

            <div className="flex flex-wrap gap-2.5 pt-1">
              <button
                onClick={handlePreviewVoice}
                disabled={busyPreview}
                className="px-3.5 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs font-medium text-zinc-100 flex items-center gap-2 whitespace-nowrap cursor-pointer"
              >
                {busyPreview ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 text-violet-400" />
                )}
                Audio Preview
              </button>

              <button
                onClick={handleGenerateDub}
                disabled={isDubGenerating || project.captions.length === 0}
                className="flex-1 py-2.5 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
              >
                {isDubGenerating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Mic className="w-3.5 h-3.5" />
                )}
                {isDubGenerating
                  ? `Generating Voice (${Math.round(activeDubJob?.progress || 0)}%)...`
                  : 'Generate Voice (s2.1-pro-free MP3)'}
              </button>
            </div>

            {activeDubJob && (
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between gap-2 text-[11px] font-mono text-zinc-400">
                  <span className="truncate">{activeDubJob.stage}</span>
                  <span className="shrink-0">
                    {Math.round(activeDubJob.progress)}%
                    {activeDubJob.etaSeconds !== null && activeDubJob.etaSeconds > 0
                      ? ` · ~${activeDubJob.etaSeconds}s`
                      : ''}
                  </span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      activeDubJob.status === 'failed'
                        ? 'bg-red-500'
                        : activeDubJob.status === 'completed'
                        ? 'bg-emerald-500'
                        : 'bg-violet-500'
                    }`}
                    style={{ width: `${activeDubJob.progress}%` }}
                  />
                </div>
              </div>
            )}
            {pendingRegenIds.length > 0 && (
              <div className="p-3 rounded-lg bg-violet-500/10 border border-violet-500/35 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="text-xs text-violet-200">
                  <strong>{pendingRegenIds.length} corrected segment(s)</strong> updated since last
                  Fish Audio generation. Passing MP3 clips are preserved.
                </div>
                <button
                  type="button"
                  onClick={() => void handleRegenerateSelectedSegments(pendingRegenIds)}
                  disabled={busyRegenSegments}
                  className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  {busyRegenSegments ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Regenerate Corrected Only ({pendingRegenIds.length})
                </button>
              </div>
            )}

            {syncWarnings.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-2">
                <div className="flex items-start justify-between gap-2 text-xs text-amber-200 font-semibold">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      FFprobe Audio Overflow: {syncWarnings.length} segment
                      {syncWarnings.length === 1 ? '' : 's'} exceed allocated window at 1.0x speed
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-amber-200/80 leading-relaxed">
                  Speech speed remains locked at 1.0x with no time-stretching. Generate a targeted
                  Gemini Fix Prompt with real FFprobe durations, apply shorter text, then
                  selectively regenerate only those segments.
                </p>
                <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                  {syncWarnings.map(({ clip, idx, slotDur, overflow }) => (
                    <button
                      key={clip.segmentId}
                      type="button"
                      onClick={() => onSeek(clip.start)}
                      className="w-full text-left px-2.5 py-1.5 rounded bg-black/30 hover:bg-black/45 border border-amber-500/20 text-[11px] text-amber-100 flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <span className="truncate">
                        #{idx + 1} ({formatTimecode(clip.start)} → {formatTimecode(clip.end)}):{' '}
                        {clip.text}
                      </span>
                      <span className="font-mono text-amber-300 shrink-0">
                        {clip.duration.toFixed(2)}s / {slotDur.toFixed(2)}s (+{overflow.toFixed(2)}s)
                      </span>
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setTranslationMode('external-gemini');
                      setFocusAudioOverflowSignal((n) => n + 1);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[11px] font-semibold text-amber-100 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                    Open Gemini Fix Prompt for Overflowing Segments
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleRegenerateSelectedSegments(
                        syncWarnings.map((w) => w.clip.segmentId)
                      )
                    }
                    disabled={busyRegenSegments}
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-white/[0.08] text-[11px] font-medium text-zinc-200 flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${busyRegenSegments ? 'animate-spin' : ''}`} />
                    Regenerate Overflow Clips ({syncWarnings.length})
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Step 4: Interactive Transcript & Translation Segment Editor */}
          <div className="p-4 rounded-xl bg-[#111115] border border-white/[0.08] space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-display font-semibold text-white">
                  3. Transcript &amp; Translation Editor
                </h2>
                <p className="text-[11px] text-zinc-500">
                  Edit timestamps, speaker lines, original transcript, and translated dubbing script.
                </p>
              </div>
              <button
                onClick={addSegment}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Segment
              </button>
            </div>

            {project.captions.length === 0 ? (
              <div className="py-10 text-center space-y-2 rounded-lg bg-[#09090B] border border-white/[0.06]">
                <Mic className="w-6 h-6 text-zinc-700 mx-auto" />
                <div className="text-xs font-medium text-zinc-300">No Transcript Segments Yet</div>
                <p className="text-[11px] text-zinc-500 max-w-sm mx-auto">
                  Click &ldquo;Transcribe with Fish Audio&rdquo; above to extract timestamped
                  dialogue from your video, or add a segment manually.
                </p>
              </div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto space-y-2.5 pr-1">
                {project.captions.map((seg, idx) => {
                  const isActive = currentTime >= seg.start && currentTime <= seg.end;
                  const segClip = voice.generatedClips?.find((c) => c.segmentId === seg.id);
                  const segSync = voice.syncPlan?.segments?.find((s) => s.segmentId === seg.id);
                  const segSlot = segClip?.slotDuration ?? Math.max(0.2, seg.end - seg.start);
                  const segOverflow = segClip
                    ? segClip.overflowSeconds ??
                      Math.max(0, Math.round((segClip.duration - segSlot) * 100) / 100)
                    : 0;
                  const hasConflict = Boolean(segSync?.conflict);
                  return (
                    <div
                      key={seg.id}
                      className={`p-3 rounded-lg border space-y-2 ${
                        isActive
                          ? 'bg-violet-950/20 border-violet-500/40'
                          : hasConflict || (!segSync && segOverflow > 0.15)
                          ? 'bg-amber-950/15 border-amber-500/35'
                          : segSync && segSync.adjustmentType !== 'unchanged'
                          ? 'bg-violet-950/10 border-violet-500/25'
                          : 'bg-[#18181D] border-white/[0.06]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => onSeek(segSync ? segSync.syncedStart : seg.start)}
                            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-mono text-violet-300 cursor-pointer"
                            title="Jump video to segment start"
                          >
                            #{idx + 1} · {formatTimecode(seg.start)}
                          </button>

                          {seg.speaker && (
                            <span className="text-[11px] font-medium text-zinc-300">
                              {seg.speaker}
                            </span>
                          )}

                          {segSync && segSync.adjustmentType === 'gap-expanded' && (
                            <span
                              className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono text-emerald-300"
                              title={`Expanded into trailing timeline gap (${segSync.syncedStart.toFixed(2)}s → ${segSync.syncedEnd.toFixed(2)}s)`}
                            >
                              Gap Expanded
                            </span>
                          )}

                          {segSync && segSync.adjustmentType === 'shifted' && (
                            <span
                              className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-[10px] font-mono text-sky-300"
                              title={`Safely shifted to ${segSync.syncedStart.toFixed(2)}s → ${segSync.syncedEnd.toFixed(2)}s without overlapping adjacent dialogue`}
                            >
                              Shifted → {formatTimecode(segSync.syncedStart)}
                            </span>
                          )}

                          {segSync && segSync.adjustmentType === 'frame-hold' && (
                            <span
                              className="px-1.5 py-0.5 rounded bg-violet-500/20 border border-violet-500/40 text-[10px] font-mono text-violet-200"
                              title={`Inserted +${segSync.holdAddedSec.toFixed(2)}s scene-boundary frame hold`}
                            >
                              Frame Hold +{segSync.holdAddedSec.toFixed(2)}s
                            </span>
                          )}

                          {(hasConflict || (!segSync && segOverflow > 0.15)) && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[10px] font-mono text-amber-300"
                              title={
                                segSync?.conflictReason ||
                                `1.0x audio (${segClip?.duration.toFixed(2)}s) exceeds ${segSlot.toFixed(2)}s window`
                              }
                            >
                              <AlertTriangle className="w-2.5 h-2.5" />
                              {segSync?.conflictReason ? 'Sync Conflict' : `+${segOverflow.toFixed(2)}s over window`}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            step={0.1}
                            min={0}
                            value={seg.start}
                            onChange={(e) =>
                              updateSegment(seg.id, { start: Math.max(0, Number(e.target.value)) })
                            }
                            aria-label="Segment start seconds"
                            className="w-16 bg-zinc-900 border border-white/[0.08] rounded px-1.5 py-0.5 text-[11px] font-mono text-zinc-200"
                          />
                          <span className="text-[10px] text-zinc-500">to</span>
                          <input
                            type="number"
                            step={0.1}
                            min={0}
                            value={seg.end}
                            onChange={(e) =>
                              updateSegment(seg.id, {
                                end: Math.max(seg.start + 0.2, Number(e.target.value)),
                              })
                            }
                            aria-label="Segment end seconds"
                            className="w-16 bg-zinc-900 border border-white/[0.08] rounded px-1.5 py-0.5 text-[11px] font-mono text-zinc-200"
                          />
                          <button
                            onClick={() => removeSegment(seg.id)}
                            className="p-1 text-zinc-500 hover:text-red-400 cursor-pointer"
                            aria-label="Delete segment"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div>
                          <div className="text-[10px] text-zinc-500 mb-1">Original Transcript</div>
                          <textarea
                            rows={2}
                            value={seg.text}
                            onChange={(e) => updateSegment(seg.id, { text: e.target.value })}
                            placeholder="Original spoken line..."
                            className="w-full bg-zinc-900 border border-white/[0.08] rounded-md px-2.5 py-1.5 text-xs text-zinc-100 resize-none"
                          />
                        </div>
                        <div>
                          <div className="text-[10px] text-violet-300 mb-1">
                            Translated Dub Script ({targetLanguage})
                          </div>
                          <textarea
                            rows={2}
                            value={seg.translatedText || ''}
                            onChange={(e) =>
                              updateSegment(seg.id, { translatedText: e.target.value })
                            }
                            placeholder={`Translated line in ${targetLanguage}...`}
                            className="w-full bg-zinc-900 border border-white/[0.08] rounded-md px-2.5 py-1.5 text-xs text-zinc-100 resize-none"
                          />
                        </div>
                      </div>

                      {(() => {
                        const allocatedDur = Math.max(0.1, Number((seg.end - seg.start).toFixed(2)));
                        const actualDur = segClip ? Number(segClip.duration.toFixed(2)) : null;
                        const durDiff = actualDur !== null ? Number((actualDur - allocatedDur).toFixed(2)) : 0;
                        const statusLabel =
                          !segClip ? 'Pending Generation' :
                          hasConflict ? 'Translation Needs Review' :
                          durDiff > 0.15 || (segSync && segSync.adjustmentType === 'frame-hold') ? 'Requires Additional Timeline Space' :
                          'Synchronized';
                        const statusBadgeClass =
                          !segClip ? 'text-zinc-400 bg-zinc-800/80 border-zinc-700' :
                          hasConflict ? 'text-red-300 bg-red-500/15 border-red-500/30' :
                          durDiff > 0.15 ? 'text-amber-300 bg-amber-500/15 border-amber-500/30' :
                          'text-emerald-300 bg-emerald-500/15 border-emerald-500/30';
                        return (
                          <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] font-mono text-zinc-400 pt-1.5 border-t border-white/[0.06]">
                            <div className="flex flex-wrap items-center gap-3">
                              <span>Allocated: {allocatedDur.toFixed(2)}s</span>
                              <span>Audio: {actualDur !== null ? `${actualDur.toFixed(2)}s` : 'Not generated'}</span>
                              {segClip?.speechDuration !== undefined && (
                                <span>Speech: {segClip.speechDuration.toFixed(2)}s</span>
                              )}
                              {segSync && (
                                <span className="text-sky-300">
                                  Final Start: {formatTimecode(segSync.syncedStart)}
                                </span>
                              )}
                              <span>Diff: {actualDur !== null ? `${durDiff >= 0 ? '+' : ''}${durDiff.toFixed(2)}s` : '—'}</span>
                            </div>
                            <span className={`px-2 py-0.5 rounded border font-sans font-medium ${statusBadgeClass}`}>
                              {statusLabel}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
