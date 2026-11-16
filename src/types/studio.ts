export type NavPage =
  | 'dashboard'
  | 'editor'
  | 'captions'
  | 'translator'
  | 'voice'
  | 'blur'
  | 'branding'
  | 'export'
  | 'settings';

export type SupportedLanguage =
  | 'English'
  | 'Arabic'
  | 'French'
  | 'Spanish'
  | 'German'
  | 'Portuguese'
  | 'Italian'
  | 'Turkish'
  | 'Hindi';

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  'English',
  'Arabic',
  'French',
  'Spanish',
  'German',
  'Portuguese',
  'Italian',
  'Turkish',
  'Hindi',
];

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  bitrate: number;
  fileSize: number;
  hasAudio: boolean;
  formatName: string;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface CaptionSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  translatedText?: string;
  speaker?: string;
  words?: WordTiming[];
}

export type SubtitleTemplate = 'tiktok' | 'shorts' | 'cinematic' | 'minimal' | 'capcut' | 'custom';

export type CaptionDisplayMode = 'word-by-word' | 'karaoke' | 'phrase-chunk' | 'sentence' | 'word';

export type CaptionAnimationPreset =
  | 'none'
  | 'word-popup'
  | 'karaoke'
  | 'typewriter'
  | 'fade'
  | 'bounce'
  | 'pop'
  | 'slide-up'
  | 'scale'
  | 'highlight-sweep'
  | 'word-emphasis'
  | 'gradient-emphasis'
  | 'box-highlight';

export interface SavedSubtitlePreset {
  id: string;
  name: string;
  style: Partial<SubtitleStyle>;
}

export type PresetCategory = 'caption' | 'filter' | 'editing';

export interface StudioPresetAssetRef {
  kind: 'background-image' | 'logo' | 'font';
  label: string;
  url: string;
  filename?: string;
}

export interface StudioPreset {
  id: string;
  category: PresetCategory;
  name: string;
  description?: string;
  isDefault?: boolean;
  thumbnailStyle?: {
    bg?: string;
    fg?: string;
    accent?: string;
    sampleText?: string;
    badge?: string;
  };
  payload: Record<string, unknown>;
  assetRefs?: StudioPresetAssetRef[];
  missingAssets?: StudioPresetAssetRef[];
  createdAt: string;
  updatedAt: string;
}

export interface SavedFontAsset {
  id: string;
  family: string;
  filename: string;
  url: string;
  createdAt: string;
}

export type StudioElementSelection =
  | { kind: 'video' }
  | { kind: 'bg-image' }
  | { kind: 'blur'; id: string }
  | { kind: 'logo'; id: string }
  | { kind: 'captions' }
  | null;

export type WorkflowStageId =
  | 'dashboard'
  | 'translator'
  | 'voice'
  | 'editor'
  | 'captions'
  | 'export';

export type StageStatus = 'Not Started' | 'In Progress' | 'Completed' | 'Needs Attention';

export interface ProjectWorkflowState {
  visitedStages: WorkflowStageId[];
  completedStages: WorkflowStageId[];
  needsAttentionStages: WorkflowStageId[];
  lastModifiedStage?: WorkflowStageId;
  revisions?: {
    mediaRev?: number;
    translationRev?: number;
    voiceRev?: number;
    editorRev?: number;
    captionsRev?: number;
    exportedMediaRev?: number;
    exportedTranslationRev?: number;
    exportedVoiceRev?: number;
    exportedEditorRev?: number;
    exportedCaptionsRev?: number;
  };
}

export interface SavedFishVoice {
  id: string;
  name: string;
  voiceId: string;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CaptionSyncSnapshot {
  generatedAt: string;
  sourceMode: 'translated' | 'original';
  targetLanguage: SupportedLanguage;
  segmentTexts: Record<string, string>;
  segmentTimes?: Record<string, string>;
}

export interface SubtitleStyle {
  enabled: boolean; // MANDATORY: Default false - never automatic
  mode: CaptionDisplayMode;
  chunkSize?: 2 | 3; // For phrase-chunk mode (2 or 3 words at a time)
  template: SubtitleTemplate;
  fontFamily: string;
  customFontId?: string;
  customFontUrl?: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold' | '900';
  italic: boolean;
  underline: boolean;
  primaryColor: string;
  highlightColor: string;
  gradientEnabled?: boolean;
  gradientColor?: string;
  highlightBoxEnabled?: boolean;
  highlightBoxColor?: string;
  highlightBoxOpacity?: number;
  outlineColor: string;
  outlineWidth: number;
  backgroundColor: string;
  backgroundOpacity: number;
  borderRadius: number;
  paddingH: number;
  paddingV: number;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowBlur: number;
  letterSpacing: number;
  lineSpacing: number;
  textAlign: 'left' | 'center' | 'right';
  position: 'bottom' | 'middle' | 'top' | 'custom';
  posX: number; // 0..100 (percentage horizontal position)
  posY: number; // 0..100 (percentage vertical position)
  marginV: number;
  uppercase: boolean;
  useTranslated: boolean;
  animationPreset: CaptionAnimationPreset;
  opacity?: number; // 0.1..1
  rotation?: number; // -180..180 degrees
  scale?: number; // 0.5..2.5
  locked?: boolean;
  visible?: boolean;
  zIndex?: number;
  showSafeGuides?: boolean;
  customPresets?: SavedSubtitlePreset[];
  captionSync?: CaptionSyncSnapshot;
}

export type BlurMode = 'full' | 'background' | 'selective' | 'motion';
export type BlurType = 'gaussian' | 'box' | 'pixelate';

export interface TrackingKeyframe {
  time: number;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  width: number; // normalized 0..1
  height: number; // normalized 0..1
}

export interface BlurEffect {
  id: string;
  name: string;
  mode: BlurMode;
  type: BlurType;
  enabled: boolean;
  intensity: number; // 1..40
  radius: number; // 2..50
  opacity: number; // 0.1..1.0 transparency/blend
  feather?: number; // 0..30 soft edge blend
  rotation?: number; // -180..180 degrees
  locked?: boolean;
  zIndex?: number;
  startTime: number;
  endTime: number;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  width: number; // normalized 0..1
  height: number; // normalized 0..1
  shape: 'rect' | 'ellipse';
  keyframes?: TrackingKeyframe[];
  maskAssetId?: string;
}

export type LogoMotionPattern = 'static' | 'bounce' | 'horizontal' | 'orbit' | 'custom';

export interface LogoMotionConfig {
  enabled: boolean;
  pattern: LogoMotionPattern;
  speed: number; // 0.2..3.0
  endX?: number; // normalized 0..1
  endY?: number; // normalized 0..1
}

export interface LogoOverlay {
  id: string;
  filename: string;
  url: string;
  enabled: boolean;
  x: number; // normalized 0..1 (left)
  y: number; // normalized 0..1 (top)
  widthPct: number; // 4..60 (% of video width)
  opacity: number; // 0.05..1
  rotation?: number; // -180..180 degrees
  locked?: boolean;
  zIndex?: number;
  permanent: boolean;
  startTime: number;
  endTime: number;
  presetPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'custom';
  motion?: LogoMotionConfig;
}

export type VoiceGender = 'male' | 'female';
export type GeminiVoiceName = 'Puck' | 'Charon' | 'Fenrir' | 'Kore' | 'Zephyr';
export type DubbingProvider = 'fish' | 'gemini';
export type SyncMode = 'flexible' | 'original' | 'continuous';
export type NarrationStyle = 'cinematic' | 'natural';

export interface VideoExtensionHold {
  id: string;
  atVideoTime: number;
  holdDuration: number;
  segmentId: string;
  reason: string;
}

export interface TimelineAdjustedSegment {
  segmentId: string;
  originalStart: number;
  originalEnd: number;
  syncedStart: number;
  syncedEnd: number;
  audioDuration: number;
  speechDuration?: number;
  leadingSilence?: number;
  trailingSilence?: number;
  adjustmentType: 'unchanged' | 'gap-expanded' | 'shifted' | 'frame-hold';
  holdAddedSec: number;
  conflict: boolean;
  conflictReason?: string;
  visualMismatch?: boolean;
  visualMismatchReason?: string;
}

export interface SegmentGapDiagnostic {
  segmentId: string;
  originalStart: number;
  originalEnd: number;
  audioDuration: number;
  speechDuration: number;
  leadingSilence: number;
  trailingSilence: number;
  finalStart: number;
  speechEnd: number;
  gapBeforeNext: number;
  visualMismatch?: boolean;
  visualMismatchReason?: string;
  recommendedAdjustment: string;
  isUnnecessarilyLongGap: boolean;
}

export interface NarrationAuditReport {
  expectedSegmentIds: string[];
  generatedSegmentIds: string[];
  missingSegmentIds: string[];
  emptySegmentIds: string[];
  duplicateSegmentIds: string[];
  outOfOrderSegmentIds: string[];
  isComplete: boolean;
  summary: string;
}

export interface TimelineSyncPlan {
  syncMode: SyncMode;
  pauseDurationMs?: number;
  originalVideoDuration: number;
  estimatedFinalDuration: number;
  totalSpeechDuration?: number;
  totalAudioTrackDuration?: number;
  additionalDuration: number;
  conflictCount: number;
  visualMismatchCount?: number;
  adjustedCount: number;
  holds: VideoExtensionHold[];
  segments: TimelineAdjustedSegment[];
  gapDiagnostics?: SegmentGapDiagnostic[];
  narrationAudit?: NarrationAuditReport;
  warnings: string[];
  computedAt: string;
}

export interface FishVoiceModel {
  id: string;
  title: string;
  description: string;
  languages: string[];
  author: string;
  tags: string[];
  visibility?: string;
  coverImage?: string;
}

export interface GeneratedVoiceClip {
  segmentId: string;
  audioUrl: string;
  start: number;
  end: number;
  duration: number;
  speechDuration?: number;
  leadingSilence?: number;
  trailingSilence?: number;
  speechStartOffset?: number;
  speechEndOffset?: number;
  slotDuration?: number;
  overflowSeconds?: number;
  text: string;
  speaker?: string;
}

export interface VoiceConfig {
  enabled: boolean;
  provider: DubbingProvider;
  syncMode: SyncMode;
  continuousPauseMs?: number;
  targetLanguage: SupportedLanguage;
  gender: VoiceGender;
  voiceName: GeminiVoiceName;
  fishReferenceId?: string;
  fishVoiceTitle?: string;
  style: string;
  narrationStyle: NarrationStyle;
  speakingSpeed: number; // Locked 1.0x
  voiceVolume: number; // 0..2
  timingOffsetSec: number; // -3.0..3.0
  preserveOriginalAudio: boolean;
  originalAudioVolume: number; // 0..1.5
  fadeInSec: number;
  fadeOutSec: number;
  bgMusicFilename?: string;
  bgMusicUrl?: string;
  bgMusicVolume: number; // 0..1
  generatedClips: GeneratedVoiceClip[];
  fullDubUrl?: string;
  syncPlan?: TimelineSyncPlan;
}

export interface NarrationValidationConfig {
  minWordsPerSec: number;
  maxWordsPerSec: number;
  audioOverflowToleranceSec: number;
}

export type SegmentNarrationStatus = 'PASS' | 'TOO LONG' | 'TOO SHORT' | 'NEEDS REVIEW';

export interface CorrectionHistoryEntry {
  id: string;
  timestamp: string;
  source: 'word-validation' | 'audio-overflow' | 'manual';
  updatedSegmentIds: string[];
  note: string;
  beforeSnapshot: Record<string, string>;
  afterSnapshot: Record<string, string>;
}

export interface TranslationConfig {
  sourceLanguage: string;
  targetLanguage: SupportedLanguage;
  preserveProperNouns: boolean;
  lastTranslatedAt?: string;
  externalGeminiDraftJson?: string;
  validationConfig?: NarrationValidationConfig;
  correctionHistory?: CorrectionHistoryEntry[];
  pendingRegenerateSegmentIds?: string[];
}

export type ColorFilterPreset =
  | 'none'
  | 'cinematic'
  | 'vintage'
  | 'film'
  | 'warm'
  | 'cool'
  | 'black-white'
  | 'high-contrast'
  | 'moody'
  | 'faded'
  | 'vibrant'
  | 'natural';

export interface ColorAdjustments {
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
  exposure: number; // -100..100
  temperature: number; // -100..100
  tint: number; // -100..100
  highlights: number; // -100..100
  shadows: number; // -100..100
  sharpness: number; // 0..100
  vignette: number; // 0..100
  fade: number; // 0..100
}

export type VisualEffectType =
  | 'film-grain'
  | 'motion-blur'
  | 'glow'
  | 'blur'
  | 'background-blur'
  | 'rgb-split'
  | 'glitch'
  | 'vhs'
  | 'light-leaks'
  | 'film-burn'
  | 'camera-shake'
  | 'zoom';

export interface VisualEffectItem {
  id: string;
  type: VisualEffectType;
  enabled: boolean;
  intensity: number; // 0..100
  startTime: number;
  endTime: number; // 0 = entire video
}

export interface VideoEffectsConfig {
  filterPreset: ColorFilterPreset;
  adjustments: ColorAdjustments;
  effects: VisualEffectItem[];
  compareMode: boolean; // toggle before/after comparison
}

export type CanvasAspectRatio = 'original' | '9:16' | '16:9' | '1:1' | 'custom';
export type CanvasBackgroundType = 'solid' | 'image' | 'blur';

export interface VideoCanvasConfig {
  aspectRatio: CanvasAspectRatio;
  customWidth: number;
  customHeight: number;
  zoom: number; // 0.25..3.0 (1.0 = fit inside canvas)
  offsetX: number; // -100..100 (% of canvas width)
  offsetY: number; // -100..100 (% of canvas height)
  videoRotation?: number; // -180..180 degrees
  videoOpacity?: number; // 0.05..1
  videoVisible?: boolean;
  videoLocked?: boolean;
  cropTop: number; // 0..45 (%)
  cropRight: number; // 0..45 (%)
  cropBottom: number; // 0..45 (%)
  cropLeft: number; // 0..45 (%)
  backgroundType: CanvasBackgroundType;
  bgColor: string; // HEX color
  bgImageUrl?: string;
  bgImageFilename?: string;
  bgImageScale: number; // 0.5..2.5
  bgImageOffsetX: number; // -50..50 (%)
  bgImageOffsetY: number; // -50..50 (%)
  bgImageRotation?: number; // -180..180 degrees
  bgImageOpacity?: number; // 0.05..1
  bgImageVisible?: boolean;
  bgImageLocked?: boolean;
  bgBlurIntensity: number; // 4..60
  bgBlurBrightness: number; // -60..60
  bgBlurOpacity: number; // 0.1..1.0
  showEditingGuides?: boolean; // toggle editing borders/handles on stage
  layerOrder?: string[]; // ordered bottom-to-top: 'bg-image', 'video', 'blur:<id>', 'logo:<id>', 'captions'
}

export const DEFAULT_VIDEO_CANVAS: VideoCanvasConfig = {
  aspectRatio: 'original',
  customWidth: 1080,
  customHeight: 1920,
  zoom: 1.0,
  offsetX: 0,
  offsetY: 0,
  videoRotation: 0,
  videoOpacity: 1.0,
  videoVisible: true,
  videoLocked: false,
  cropTop: 0,
  cropRight: 0,
  cropBottom: 0,
  cropLeft: 0,
  backgroundType: 'solid',
  bgColor: '#09090B',
  bgImageScale: 1.0,
  bgImageOffsetX: 0,
  bgImageOffsetY: 0,
  bgImageRotation: 0,
  bgImageOpacity: 1.0,
  bgImageVisible: true,
  bgImageLocked: false,
  bgBlurIntensity: 24,
  bgBlurBrightness: -15,
  bgBlurOpacity: 0.9,
  showEditingGuides: true,
};

export const DEFAULT_COLOR_ADJUSTMENTS: ColorAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  sharpness: 0,
  vignette: 0,
  fade: 0,
};

export const DEFAULT_VIDEO_EFFECTS: VideoEffectsConfig = {
  filterPreset: 'none',
  adjustments: DEFAULT_COLOR_ADJUSTMENTS,
  effects: [],
  compareMode: false,
};

export interface ExportSettings {
  aspectRatio: 'original' | '16:9' | '9:16' | '1:1' | 'custom';
  resolution: '480p' | '720p' | '1080p';
  fitMode: 'crop' | 'blur-pad' | 'letterbox';
  format: 'mp4';
  videoCodec: 'h264';
  audioCodec: 'aac';
  applyBlur: boolean;
  applyLogo: boolean;
  applyVideoEffects: boolean;
  applyCaptions: boolean; // STRICT: Default false
  applyDubbing: boolean;
  applyAudioMix: boolean;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sourceVideoUrl: string | null;
  sourceFilename: string | null;
  thumbnailUrl: string | null;
  metadata: VideoMetadata | null;
  waveformPeaks: number[];
  captions: CaptionSegment[];
  subtitleStyle: SubtitleStyle;
  translation: TranslationConfig;
  voice: VoiceConfig;
  blurs: BlurEffect[];
  logos: LogoOverlay[];
  videoEffects: VideoEffectsConfig;
  canvas?: VideoCanvasConfig;
  workflow?: ProjectWorkflowState;
  exportSettings: ExportSettings;
  lastExportUrl: string | null;
  lastExportSize: number | null;
  lastExportedAt: string | null;
}

export interface RenderJob {
  id: string;
  projectId: string;
  type: 'render' | 'transcribe' | 'translate' | 'voice' | 'analysis';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  stage: string;
  etaSeconds: number | null;
  outputUrl: string | null;
  outputSize: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SystemStatus {
  geminiConfigured: boolean;
  fishConfigured: boolean;
  ffmpegAvailable: boolean;
  ffprobeAvailable: boolean;
  ffmpegVersion: string;
  storageDir: string;
  maxUploadSizeMb: number;
  tempRetentionHours: number;
  supportedVideoFormats: string[];
  supportedLogoFormats: string[];
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  enabled: false, // STRICT: Never automatic, requires manual user trigger
  mode: 'word-by-word',
  chunkSize: 3,
  template: 'tiktok',
  fontFamily: 'DejaVu Sans',
  fontSize: 38,
  fontWeight: 'bold',
  italic: false,
  underline: false,
  primaryColor: '#FFFFFF',
  highlightColor: '#FACC15',
  gradientEnabled: false,
  gradientColor: '#38BDF8',
  highlightBoxEnabled: false,
  highlightBoxColor: '#7C3AED',
  highlightBoxOpacity: 0.85,
  outlineColor: '#09090B',
  outlineWidth: 3,
  backgroundColor: '#09090B',
  backgroundOpacity: 0.55,
  borderRadius: 8,
  paddingH: 14,
  paddingV: 6,
  shadowEnabled: true,
  shadowColor: '#000000',
  shadowBlur: 4,
  letterSpacing: 0,
  lineSpacing: 1.2,
  textAlign: 'center',
  position: 'bottom',
  posX: 50,
  posY: 84,
  marginV: 48,
  uppercase: false,
  useTranslated: false,
  animationPreset: 'none',
  opacity: 1,
  rotation: 0,
  scale: 1,
  locked: false,
  visible: true,
  showSafeGuides: false,
  customPresets: [],
};

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  enabled: false,
  provider: 'fish',
  syncMode: 'flexible',
  continuousPauseMs: 320,
  targetLanguage: 'French',
  gender: 'male',
  voiceName: 'Charon',
  fishReferenceId: '',
  fishVoiceTitle: 'Default Fish Audio Voice (s2.1-pro-free)',
  style: 'Dramatic, gripping movie recap narrator with clear pacing',
  narrationStyle: 'cinematic',
  speakingSpeed: 1.0,
  voiceVolume: 1.0,
  timingOffsetSec: 0,
  preserveOriginalAudio: false,
  originalAudioVolume: 0.25,
  fadeInSec: 0.3,
  fadeOutSec: 0.5,
  bgMusicVolume: 0.2,
  generatedClips: [],
};

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  aspectRatio: 'original',
  resolution: '1080p',
  fitMode: 'crop',
  format: 'mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  applyBlur: true,
  applyLogo: true,
  applyVideoEffects: true,
  applyCaptions: false, // STRICT: Default false - never burned into export unless requested
  applyDubbing: true,
  applyAudioMix: true,
};
