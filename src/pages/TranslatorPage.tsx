import React, { useState } from 'react';
import { AlertCircle, Languages, Loader2 } from 'lucide-react';
import { Project, SUPPORTED_LANGUAGES, SupportedLanguage } from '../types/studio';
import { api } from '../lib/api';
import { formatTimecode } from '../lib/formatters';
import { createWorkflowUpdate } from '../lib/workflowStages';
import { ExternalGeminiTranslatorPanel } from '../components/ExternalGeminiTranslatorPanel';

interface TranslatorPageProps {
  project: Project;
  onProjectUpdated: (p: Project) => void;
  onSeek: (time: number) => void;
}

export function TranslatorPage({ project, onProjectUpdated, onSeek }: TranslatorPageProps) {
  const [mode, setMode] = useState<'api' | 'external-gemini'>('external-gemini');
  const [targetLang, setTargetLang] = useState<SupportedLanguage>(
    project.translation.targetLanguage
  );
  const [preserveNames, setPreserveNames] = useState<boolean>(
    project.translation.preserveProperNouns
  );
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleTranslate = async () => {
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await api.translate(project.id, targetLang, preserveNames);
      const nextWorkflow = createWorkflowUpdate(res.project.workflow, {
        completeStage: 'translator',
        modifiedStage: 'translator',
        hasGeneratedDub: Boolean(res.project.voice.fullDubUrl),
        hasGeneratedCaptions: Boolean(res.project.subtitleStyle.captionSync),
        hasExistingExport: Boolean(res.project.lastExportUrl),
      });
      const { project: synced } = await api.updateProject(project.id, { workflow: nextWorkflow });
      onProjectUpdated(synced);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleShowTranslated = async (checked: boolean) => {
    const nextStyle = { ...project.subtitleStyle, useTranslated: checked };
    onProjectUpdated({ ...project, subtitleStyle: nextStyle });
    const { project: saved } = await api.updateProject(project.id, { subtitleStyle: nextStyle });
    onProjectUpdated(saved);
  };

  return (
    <div className="space-y-5">
      <div className="border-b border-white/[0.08] pb-3 space-y-2.5">
        <div>
          <h2 className="text-sm font-display font-semibold text-white">AI Language Translator</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Translate timestamped captions via External Gemini (no API key) or backend API.
          </p>
        </div>

        <div className="grid grid-cols-2 bg-zinc-900 border border-white/[0.08] rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setMode('external-gemini')}
            className={`py-1.5 px-2 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
              mode === 'external-gemini'
                ? 'bg-violet-600 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            External Gemini (No Key)
          </button>
          <button
            type="button"
            onClick={() => setMode('api')}
            className={`py-1.5 px-2 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
              mode === 'api'
                ? 'bg-violet-600 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Automatic API
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {mode === 'external-gemini' ? (
        <div className="space-y-3">
          <ExternalGeminiTranslatorPanel
            project={project}
            onProjectUpdated={onProjectUpdated}
            targetLanguage={targetLang}
            onChangeTargetLanguage={setTargetLang}
            preserveProperNouns={preserveNames}
            onChangePreserveProperNouns={setPreserveNames}
          />

          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer px-1">
            <input
              type="checkbox"
              checked={project.subtitleStyle.useTranslated}
              onChange={(e) => void toggleShowTranslated(e.target.checked)}
              className="accent-violet-500"
            />
            Preview translated captions in player
          </label>
        </div>
      ) : (
        <div className="p-3.5 rounded-lg bg-[#18181D] border border-white/[0.08] space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">Detected Source</span>
            <span className="font-medium text-zinc-200">{project.translation.sourceLanguage}</span>
          </div>

          <div>
            <label className="text-[11px] font-medium text-zinc-400">Target Language</label>
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value as SupportedLanguage)}
              className="mt-1 w-full bg-zinc-900 border border-white/[0.08] rounded-md px-2.5 py-2 text-xs text-zinc-100"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={preserveNames}
              onChange={(e) => setPreserveNames(e.target.checked)}
              className="accent-violet-500"
            />
            Preserve character names &amp; movie terminology
          </label>

          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={project.subtitleStyle.useTranslated}
              onChange={(e) => void toggleShowTranslated(e.target.checked)}
              className="accent-violet-500"
            />
            Preview translated captions in player
          </label>

          <button
            onClick={handleTranslate}
            disabled={busy || project.captions.length === 0}
            className="w-full py-2 px-3 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center justify-center gap-1.5 cursor-pointer"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Languages className="w-3.5 h-3.5" />}
            {busy ? `Translating to ${targetLang}...` : `Translate to ${targetLang}`}
          </button>
        </div>
      )}

      {/* Editable Original vs Translation Segments */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-zinc-300">
          Translated Segments ({project.captions.length})
        </div>

        <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
          {project.captions.length === 0 ? (
            <div className="p-4 rounded-lg bg-[#18181D] border border-white/[0.06] text-xs text-zinc-500 text-center">
              Generate captions in AI Captions first before translating.
            </div>
          ) : (
            project.captions.map((seg) => (
              <div
                key={seg.id}
                onClick={() => onSeek(seg.start)}
                className="p-2.5 rounded-lg bg-[#18181D] border border-white/[0.06] space-y-1.5"
              >
                <div className="text-[11px] font-mono text-zinc-500 tabular-nums">
                  {formatTimecode(seg.start)} → {formatTimecode(seg.end)}
                </div>
                <div className="text-[11px] text-zinc-400">{seg.text}</div>
                <textarea
                  rows={2}
                  value={seg.translatedText || ''}
                  placeholder="Translation pending..."
                  onChange={(e) => {
                    const next = project.captions.map((c) =>
                      c.id === seg.id ? { ...c, translatedText: e.target.value } : c
                    );
                    onProjectUpdated({ ...project, captions: next });
                  }}
                  onBlur={async () => {
                    const nextWorkflow = createWorkflowUpdate(project.workflow, {
                      completeStage: 'translator',
                      modifiedStage: 'translator',
                      hasGeneratedDub: Boolean(project.voice.fullDubUrl),
                      hasGeneratedCaptions: Boolean(project.subtitleStyle.captionSync),
                      hasExistingExport: Boolean(project.lastExportUrl),
                    });
                    const { project: saved } = await api.updateProject(project.id, {
                      captions: project.captions,
                      workflow: nextWorkflow,
                    });
                    onProjectUpdated(saved);
                  }}
                  className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-zinc-100 resize-none focus:outline-none focus:border-violet-500"
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
