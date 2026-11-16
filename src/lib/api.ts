import {
  CaptionSegment,
  FishVoiceModel,
  GeminiVoiceName,
  PresetCategory,
  Project,
  RenderJob,
  SavedFishVoice,
  SavedFontAsset,
  StudioPreset,
  StudioPresetAssetRef,
  SupportedLanguage,
  SyncMode,
  SystemStatus,
} from '../types/studio';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const raw = await res.text();
  let data: Record<string, unknown> | null = null;
  if (raw) {
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const errMsg = typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`;
    throw new Error(errMsg);
  }
  if (!data) {
    throw new Error('Server returned an unexpected non-JSON response. Please try again.');
  }
  return data as T;
}

export interface PresetApplyOptions {
  captionPresetId?: string | null;
  filterPresetId?: string | null;
  editingPresetId?: string | null;
  applyDefaults?: boolean;
}

export interface PresetWarning {
  presetName: string;
  missingAssets: StudioPresetAssetRef[];
}

export const api = {
  getSystemStatus: () => request<SystemStatus>('/api/system/status'),

  runCleanup: () => request<{ removedFiles: number }>('/api/system/cleanup', { method: 'POST' }),

  listFishVoices: (params?: { query?: string; selfOnly?: boolean; language?: string }) => {
    const qs = new URLSearchParams();
    if (params?.query) qs.set('q', params.query);
    if (params?.selfOnly) qs.set('self', 'true');
    if (params?.language) qs.set('language', params.language);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ voices: FishVoiceModel[]; total: number }>(`/api/fish/voices${suffix}`);
  },

  listSavedFishVoices: () =>
    request<{ voices: SavedFishVoice[] }>('/api/fish/saved-voices'),

  createSavedFishVoice: (params: { name: string; voiceId: string; isDefault?: boolean }) =>
    request<{ voice: SavedFishVoice; voices: SavedFishVoice[] }>('/api/fish/saved-voices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }),

  updateSavedFishVoice: (
    id: string,
    params: { name?: string; voiceId?: string; isDefault?: boolean }
  ) =>
    request<{ voice: SavedFishVoice; voices: SavedFishVoice[] }>(`/api/fish/saved-voices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }),

  deleteSavedFishVoice: (id: string) =>
    request<{ deleted: boolean; voices: SavedFishVoice[] }>(`/api/fish/saved-voices/${id}`, {
      method: 'DELETE',
    }),

  listCustomFonts: () => request<{ fonts: SavedFontAsset[] }>('/api/fonts'),

  uploadCustomFont: async (file: File, family?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    if (family) fd.append('family', family);
    return request<{ font: SavedFontAsset; fonts: SavedFontAsset[] }>('/api/fonts', {
      method: 'POST',
      body: fd,
    });
  },

  deleteCustomFont: (id: string) =>
    request<{ deleted: boolean; fonts: SavedFontAsset[] }>(`/api/fonts/${id}`, {
      method: 'DELETE',
    }),

  listPresets: (category?: PresetCategory) =>
    request<{ presets: StudioPreset[] }>(
      category ? `/api/presets?category=${encodeURIComponent(category)}` : '/api/presets'
    ),

  createPreset: (params: {
    category: PresetCategory;
    name: string;
    description?: string;
    isDefault?: boolean;
    thumbnailStyle?: StudioPreset['thumbnailStyle'];
    payload: Record<string, unknown>;
    assetRefs?: StudioPresetAssetRef[];
  }) =>
    request<{ preset: StudioPreset; presets: StudioPreset[] }>('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }),

  updatePreset: (
    id: string,
    patch: Partial<{
      name: string;
      description: string;
      isDefault: boolean;
      thumbnailStyle: StudioPreset['thumbnailStyle'];
      payload: Record<string, unknown>;
      assetRefs: StudioPresetAssetRef[];
    }>
  ) =>
    request<{ preset: StudioPreset; presets: StudioPreset[] }>(`/api/presets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  deletePreset: (id: string) =>
    request<{ deleted: boolean; presets: StudioPreset[] }>(`/api/presets/${id}`, {
      method: 'DELETE',
    }),

  importPresets: (bundle: unknown) =>
    request<{ importedCount: number; imported: StudioPreset[]; presets: StudioPreset[] }>(
      '/api/presets/import',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle),
      }
    ),

  exportPresetsUrl: '/api/presets/export',

  listProjects: () => request<{ projects: Project[] }>('/api/projects'),

  createProject: (name: string, presetOpts?: PresetApplyOptions) =>
    request<{ project: Project; presetWarnings?: PresetWarning[] }>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...(presetOpts || {}) }),
    }),

  applyPresetsToProject: (projectId: string, presetOpts: PresetApplyOptions) =>
    request<{ project: Project; presetWarnings?: PresetWarning[] }>(
      `/api/projects/${projectId}/apply-presets`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(presetOpts),
      }
    ),

  getProject: (id: string) => request<{ project: Project }>(`/api/projects/${id}`),

  updateProject: (id: string, patch: Partial<Project>) =>
    request<{ project: Project }>(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  deleteProject: (id: string) =>
    request<{ deleted: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),

  createSampleVideo: (projectId: string) =>
    request<{ project: Project }>(`/api/projects/${projectId}/sample-video`, {
      method: 'POST',
    }),

  uploadLogo: async (projectId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ project: Project }>(`/api/projects/${projectId}/logo`, {
      method: 'POST',
      body: fd,
    });
  },

  uploadCanvasBackground: async (projectId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ project: Project; url: string; filename: string }>(
      `/api/projects/${projectId}/canvas-bg`,
      {
        method: 'POST',
        body: fd,
      }
    );
  },

  uploadMusic: async (projectId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ project: Project }>(`/api/projects/${projectId}/music`, {
      method: 'POST',
      body: fd,
    });
  },

  uploadMask: (projectId: string, blurId: string, maskBase64: string) =>
    request<{ maskUrl: string; assetId: string }>(`/api/projects/${projectId}/mask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blurId, maskBase64 }),
    }),

  extractAudio: (projectId: string) =>
    request<{ audioUrl: string; downloadUrl: string; filename: string }>(
      `/api/projects/${projectId}/audio/extract`,
      { method: 'POST' }
    ),

  transcribe: (projectId: string, params?: { provider?: 'fish' | 'gemini'; sourceLanguage?: string }) =>
    request<{ project: Project; detectedLanguage: string; segmentCount: number }>(
      `/api/projects/${projectId}/transcribe`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params || {}),
      }
    ),

  transcribeWithFish: (projectId: string, sourceLanguage?: string) =>
    request<{ project: Project; detectedLanguage: string; segmentCount: number }>(
      `/api/projects/${projectId}/dubbing/transcribe`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceLanguage }),
      }
    ),

  importCaptions: (projectId: string, content: string) =>
    request<{ project: Project; count: number }>(`/api/projects/${projectId}/captions/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }),

  translate: (
    projectId: string,
    targetLanguage: SupportedLanguage,
    preserveProperNouns: boolean
  ) =>
    request<{ project: Project }>(`/api/projects/${projectId}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage, preserveProperNouns }),
    }),

  previewFishDub: (
    projectId: string,
    params: { text: string; referenceId?: string; speakingSpeed: number }
  ) =>
    request<{ audioUrl: string }>(`/api/projects/${projectId}/dubbing/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }),

  generateFishDub: (
    projectId: string,
    params: { voice: Project['voice']; captions?: CaptionSegment[]; useTranslated?: boolean }
  ) =>
    request<{ job: RenderJob }>(
      `/api/projects/${projectId}/dubbing/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }
    ),

  resyncFishDub: (projectId: string, syncMode: SyncMode, continuousPauseMs?: number) =>
    request<{ project: Project }>(`/api/projects/${projectId}/dubbing/resync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncMode, continuousPauseMs }),
    }),

  regenerateFishSegments: (
    projectId: string,
    params: {
      segmentIds: string[];
      captions?: CaptionSegment[];
      voice?: Partial<Project['voice']>;
      useTranslated?: boolean;
    }
  ) =>
    request<{
      project: Project;
      regeneratedIds: string[];
      fullDubUrl: string;
    }>(`/api/projects/${projectId}/dubbing/regenerate-segments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }),

  previewVoice: (
    projectId: string,
    params: {
      text: string;
      voiceName: GeminiVoiceName;
      style: string;
      targetLanguage: SupportedLanguage;
      speakingSpeed: number;
    }
  ) =>
    request<{ audioUrl: string }>(`/api/projects/${projectId}/voice/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }),

  generateVoiceover: (
    projectId: string,
    params: { voice: Project['voice']; useTranslated: boolean }
  ) =>
    request<{ project: Project; fullDubUrl: string }>(
      `/api/projects/${projectId}/voice/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }
    ),

  autoDubVideo: (
    projectId: string,
    params: { voice: Project['voice']; preserveProperNouns?: boolean }
  ) =>
    request<{
      project: Project;
      sourceLanguage: string;
      targetLanguage: SupportedLanguage;
      fullDubUrl: string;
    }>(`/api/projects/${projectId}/voice/auto-dub`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }),

  generateThumbnails: (projectId: string) =>
    request<{ thumbnails: string[]; suggestedTitle: string; suggestedSubtitle: string }>(
      `/api/projects/${projectId}/thumbnails/generate`,
      { method: 'POST' }
    ),

  startExport: (projectId: string, exportSettings: Project['exportSettings']) =>
    request<{ job: RenderJob }>(`/api/projects/${projectId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exportSettings }),
    }),

  listProjectJobs: (projectId: string) =>
    request<{ jobs: RenderJob[] }>(`/api/projects/${projectId}/jobs`),

  getJob: (jobId: string) => request<{ job: RenderJob }>(`/api/jobs/${jobId}`),

  listAllJobs: () => request<{ jobs: RenderJob[] }>('/api/jobs'),
};

export async function uploadVideoChunked(params: {
  projectId: string;
  file: File;
  onProgress: (pct: number, stage: string) => void;
}): Promise<Project> {
  const { projectId, file, onProgress } = params;
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB chunks
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

  onProgress(2, 'Initializing chunked upload...');
  const initRes = await request<{ uploadId: string; totalChunks: number }>('/api/uploads/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      filename: file.name,
      totalSize: file.size,
      totalChunks,
    }),
  });

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(file.size, start + CHUNK_SIZE);
    const slice = file.slice(start, end);
    const buffer = await slice.arrayBuffer();

    const chunkRes = await fetch(`/api/uploads/${initRes.uploadId}/chunk?index=${i}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer,
    });
    if (!chunkRes.ok) {
      const errData = await chunkRes.json().catch(() => ({}));
      throw new Error(errData.error || `Chunk ${i + 1} upload failed`);
    }

    const pct = Math.round(5 + ((i + 1) / totalChunks) * 80);
    onProgress(pct, `Uploading chunk ${i + 1} of ${totalChunks}...`);
  }

  onProgress(90, 'Analyzing video streams & extracting audio waveform...');
  const completeRes = await request<{ project: Project }>(
    `/api/uploads/${initRes.uploadId}/complete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    }
  );

  onProgress(100, 'Upload complete');
  return completeRes.project;
}
