import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Download,
  Loader2,
  Menu,
  Redo2,
  Undo2,
  X,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import {
  BlurEffect,
  DEFAULT_VIDEO_CANVAS,
  LogoOverlay,
  NavPage,
  Project,
  RenderJob,
  SavedFontAsset,
  StudioElementSelection,
  SubtitleStyle,
  VideoCanvasConfig,
  VideoEffectsConfig,
  WorkflowStageId,
} from './types/studio';
import { api, PresetWarning } from './lib/api';
import {
  WORKFLOW_STAGES,
  computeStageStatuses,
  createWorkflowUpdate,
} from './lib/workflowStages';
import { SidebarNav } from './components/SidebarNav';
import { WorkflowStepperBar, isWorkflowStage } from './components/WorkflowStepperBar';
import { VideoStudioPlayer } from './components/VideoStudioPlayer';
import { TimelineEditor } from './components/TimelineEditor';
import { DashboardPage } from './pages/DashboardPage';
import { EditorInspectorPage, EditorSection } from './pages/EditorInspectorPage';
import { CaptionsPage } from './pages/CaptionsPage';
import { TranslatorPage } from './pages/TranslatorPage';
import { VoiceStudioPage } from './pages/VoiceStudioPage';
import { ExportCenterPage } from './pages/ExportCenterPage';
import { SettingsPage } from './pages/SettingsPage';

interface EditableSnapshot {
  canvas?: VideoCanvasConfig;
  videoEffects: VideoEffectsConfig;
  blurs: BlurEffect[];
  logos: LogoOverlay[];
  subtitleStyle: SubtitleStyle;
}

function cloneEditableSnapshot(project: Project): EditableSnapshot {
  return JSON.parse(
    JSON.stringify({
      canvas: project.canvas,
      videoEffects: project.videoEffects,
      blurs: project.blurs,
      logos: project.logos,
      subtitleStyle: project.subtitleStyle,
    })
  ) as EditableSnapshot;
}

function snapshotsEqual(a: EditableSnapshot, b: EditableSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const PAGE_TITLES: Record<NavPage, string> = {
  dashboard: 'Stage 1: Import Video',
  translator: 'Stage 2: Analysis & Translation',
  voice: 'Stage 3–4: Voiceover & Sync',
  editor: 'Stage 5: Editing & Filters',
  captions: 'Stage 6: Captions (Manual)',
  export: 'Stage 7: Final Preview & Export',
  blur: 'Stage 5: Blur & Tracking',
  branding: 'Stage 5: Logo & Watermark',
  settings: 'System Settings',
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const logoSaveTimer = useRef<number | null>(null);
  const isUndoRedoApplyingRef = useRef(false);

  const [activePage, setActivePage] = useState<NavPage>('dashboard');
  const [editorSection, setEditorSection] = useState<EditorSection>('canvas');
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [recentJobs, setRecentJobs] = useState<RenderJob[]>([]);
  const [customFonts, setCustomFonts] = useState<SavedFontAsset[]>([]);
  const [presetWarnings, setPresetWarnings] = useState<PresetWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Sequential Navigation State
  const [savingNavigation, setSavingNavigation] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);

  // Studio Workspace State
  const [currentTime, setCurrentTime] = useState(0);
  const [previewEffects, setPreviewEffects] = useState(true);
  const [drawMode, setDrawMode] = useState<'none' | 'selective' | 'motion'>('none');
  const [selectedBlurId, setSelectedBlurId] = useState<string | null>(null);
  const [selectedLogoId, setSelectedLogoId] = useState<string | null>(null);
  const [selectedElement, setSelectedElement] = useState<StudioElementSelection>(null);

  // Undo / Redo Stacks for Active Project Visual Edits
  const [undoStack, setUndoStack] = useState<EditableSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditableSnapshot[]>([]);

  const reloadCustomFonts = useCallback(async () => {
    try {
      const res = await api.listCustomFonts();
      if (Array.isArray(res?.fonts)) {
        setCustomFonts(res.fonts);
      }
    } catch {
      // ignore transient font list errors
    }
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    try {
      const [projRes, jobRes, fontRes] = await Promise.all([
        api.listProjects(),
        api.listAllJobs(),
        api.listCustomFonts().catch(() => ({ fonts: [] as SavedFontAsset[] })),
      ]);
      const validProjects = Array.isArray(projRes?.projects)
        ? projRes.projects.filter((p): p is Project => Boolean(p && p.id))
        : [];
      const validJobs = Array.isArray(jobRes?.jobs) ? jobRes.jobs : [];
      setProjects(validProjects);
      setRecentJobs(validJobs);
      if (Array.isArray(fontRes?.fonts)) {
        setCustomFonts(fontRes.fonts);
      }
      setActiveProjectId((prev) => {
        if (prev && validProjects.some((p) => p.id === prev)) return prev;
        return validProjects[0]?.id || null;
      });
    } catch {
      // keep existing state on transient fetch error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  // Reset Undo/Redo history when switching active project
  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, [activeProjectId]);

  const activeProject = projects.find((p) => p && p.id === activeProjectId) || null;

  const activeWorkflowStage: WorkflowStageId = useMemo(() => {
    if (isWorkflowStage(activePage)) return activePage;
    if (activePage === 'blur' || activePage === 'branding') return 'editor';
    return 'dashboard';
  }, [activePage]);

  const stageStatuses = useMemo(
    () => computeStageStatuses(activeProject, activeWorkflowStage),
    [activeProject, activeWorkflowStage]
  );

  const pushUndoSnapshot = useCallback((projectToSave: Project) => {
    const snap = cloneEditableSnapshot(projectToSave);
    setUndoStack((prev) => {
      const top = prev[prev.length - 1];
      if (top && snapshotsEqual(top, snap)) return prev;
      return [...prev.slice(-29), snap];
    });
    setRedoStack([]);
  }, []);

  const handleProjectUpdated = useCallback(
    (updated: Project) => {
      if (!updated || !updated.id) return;
      setProjects((prev) => {
        const safePrev = (Array.isArray(prev) ? prev : []).filter(
          (p): p is Project => Boolean(p && p.id)
        );
        const existing = safePrev.find((p) => p.id === updated.id);
        if (
          existing &&
          updated.id === activeProjectId &&
          !isUndoRedoApplyingRef.current &&
          logoSaveTimer.current === null
        ) {
          const prevSnap = cloneEditableSnapshot(existing);
          const nextSnap = cloneEditableSnapshot(updated);
          if (!snapshotsEqual(prevSnap, nextSnap)) {
            setUndoStack((u) => {
              const top = u[u.length - 1];
              if (top && snapshotsEqual(top, prevSnap)) return u;
              return [...u.slice(-29), prevSnap];
            });
            setRedoStack([]);
          }
        }
        return existing
          ? safePrev.map((p) => (p.id === updated.id ? updated : p))
          : [updated, ...safePrev];
      });
    },
    [activeProjectId]
  );

  const applySnapshot = useCallback(
    async (snap: EditableSnapshot) => {
      if (!activeProject) return;
      isUndoRedoApplyingRef.current = true;
      if (logoSaveTimer.current) {
        window.clearTimeout(logoSaveTimer.current);
        logoSaveTimer.current = null;
      }
      const nextProject: Project = {
        ...activeProject,
        canvas: snap.canvas,
        videoEffects: snap.videoEffects,
        blurs: snap.blurs,
        logos: snap.logos,
        subtitleStyle: snap.subtitleStyle,
      };
      setProjects((prev) =>
        prev.map((p) => (p.id === activeProject.id ? nextProject : p))
      );
      try {
        const { project: saved } = await api.updateProject(activeProject.id, {
          canvas: snap.canvas,
          videoEffects: snap.videoEffects,
          blurs: snap.blurs,
          logos: snap.logos,
          subtitleStyle: snap.subtitleStyle,
        });
        if (saved) {
          setProjects((prev) =>
            prev.map((p) => (p.id === saved.id ? saved : p))
          );
        }
      } catch {
        // keep reverted local state
      } finally {
        isUndoRedoApplyingRef.current = false;
      }
    },
    [activeProject]
  );

  const handleUndo = useCallback(() => {
    if (!activeProject || undoStack.length === 0) return;
    const prevSnap = undoStack[undoStack.length - 1];
    const currentSnap = cloneEditableSnapshot(activeProject);
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r.slice(-29), currentSnap]);
    void applySnapshot(prevSnap);
  }, [activeProject, undoStack, applySnapshot]);

  const handleRedo = useCallback(() => {
    if (!activeProject || redoStack.length === 0) return;
    const nextSnap = redoStack[redoStack.length - 1];
    const currentSnap = cloneEditableSnapshot(activeProject);
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u.slice(-29), currentSnap]);
    void applySnapshot(nextSnap);
  }, [activeProject, redoStack, applySnapshot]);

  const navigateToStage = useCallback(
    async (
      target: NavPage,
      opts?: { markCurrentCompleted?: boolean; bypassGate?: boolean }
    ) => {
      setNavigationError(null);

      // Map legacy blur/branding page targets cleanly inside Stage 5
      let resolvedPage: NavPage = target;
      if (target === 'blur') {
        resolvedPage = 'editor';
        setEditorSection('blur');
      } else if (target === 'branding') {
        resolvedPage = 'editor';
        setEditorSection('branding');
      }

      if (resolvedPage !== 'dashboard' && resolvedPage !== 'settings' && activeProject && !opts?.bypassGate) {
        if (!activeProject.sourceVideoUrl) {
          setNavigationError('Upload or create a source video in Stage 1 before proceeding.');
          setActivePage('dashboard');
          return;
        }
      }

      if (activeProject && isWorkflowStage(resolvedPage)) {
        const prevStage = activeWorkflowStage;
        const nextWorkflow = createWorkflowUpdate(activeProject.workflow, {
          visitStage: resolvedPage,
          completeStage: opts?.markCurrentCompleted ? prevStage : undefined,
        });
        setSavingNavigation(true);
        try {
          handleProjectUpdated({ ...activeProject, workflow: nextWorkflow });
          const { project: saved } = await api.updateProject(activeProject.id, {
            workflow: nextWorkflow,
          });
          handleProjectUpdated(saved);
        } catch {
          // keep local navigation responsive
        } finally {
          setSavingNavigation(false);
        }
      }

      setActivePage(resolvedPage);
    },
    [activeProject, activeWorkflowStage, handleProjectUpdated]
  );

  const handleStepBack = useCallback(() => {
    const idx = WORKFLOW_STAGES.findIndex((s) => s.id === activeWorkflowStage);
    if (idx > 0) {
      void navigateToStage(WORKFLOW_STAGES[idx - 1].id, { bypassGate: true });
    }
  }, [activeWorkflowStage, navigateToStage]);

  const handleStepContinue = useCallback(() => {
    const idx = WORKFLOW_STAGES.findIndex((s) => s.id === activeWorkflowStage);
    if (idx < 0 || idx >= WORKFLOW_STAGES.length - 1) return;

    const currentInfo = stageStatuses.find((s) => s.id === activeWorkflowStage);
    if (currentInfo && !currentInfo.canContinue) {
      setNavigationError(
        currentInfo.validationMessage || 'Complete required step before continuing.'
      );
      return;
    }

    const nextStage = WORKFLOW_STAGES[idx + 1];
    void navigateToStage(nextStage.id, { markCurrentCompleted: true });
  }, [activeWorkflowStage, stageStatuses, navigateToStage]);

  const handleSelectElement = useCallback((el: StudioElementSelection) => {
    setSelectedElement(el);
    if (el?.kind === 'blur') {
      setSelectedBlurId(el.id);
    } else if (el?.kind === 'logo') {
      setSelectedLogoId(el.id);
    }
  }, []);

  const handleSelectBlurSynced = useCallback((id: string | null) => {
    setSelectedBlurId(id);
    setSelectedElement(id ? { kind: 'blur', id } : null);
  }, []);

  const handleSelectLogoSynced = useCallback((id: string | null) => {
    setSelectedLogoId(id);
    setSelectedElement(id ? { kind: 'logo', id } : null);
  }, []);

  const handleSelectProject = (project: Project, navigateTo?: NavPage) => {
    if (!project || !project.id) return;
    handleProjectUpdated(project);
    setActiveProjectId(project.id);
    setCurrentTime(0);
    setNavigationError(null);
    const firstBlur = project.blurs?.[0]?.id || null;
    const firstLogo = project.logos?.[0]?.id || null;
    setSelectedBlurId(firstBlur);
    setSelectedLogoId(firstLogo);
    setSelectedElement(null);
    if (navigateTo) {
      if (navigateTo === 'blur') {
        setActivePage('editor');
        setEditorSection('blur');
      } else if (navigateTo === 'branding') {
        setActivePage('editor');
        setEditorSection('branding');
      } else {
        setActivePage(navigateTo);
      }
    }
  };

  const handleSeek = (t: number) => {
    setCurrentTime(t);
    if (videoRef.current) {
      videoRef.current.currentTime = t;
    }
  };

  const handleFinishDrawBox = async (box: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    if (!activeProject) return;
    const targetId = selectedBlurId || activeProject.blurs[0]?.id;
    if (!targetId) return;

    const nextBlurs = activeProject.blurs.map((b) =>
      b.id === targetId ? { ...b, ...box, keyframes: undefined } : b
    );
    const nextWorkflow = createWorkflowUpdate(activeProject.workflow, {
      completeStage: 'editor',
      modifiedStage: 'editor',
      hasExistingExport: Boolean(activeProject.lastExportUrl),
    });
    handleProjectUpdated({ ...activeProject, blurs: nextBlurs, workflow: nextWorkflow });
    setDrawMode('none');
    const { project: saved } = await api.updateProject(activeProject.id, {
      blurs: nextBlurs,
      workflow: nextWorkflow,
    });
    handleProjectUpdated(saved);
  };

  const scheduleProjectPatchSave = (
    projectId: string,
    patch: Partial<Project>,
    immediate?: boolean
  ) => {
    if (logoSaveTimer.current) {
      window.clearTimeout(logoSaveTimer.current);
      logoSaveTimer.current = null;
    }
    if (immediate) {
      void api
        .updateProject(projectId, patch)
        .then(({ project: saved }) => {
          if (saved) handleProjectUpdated(saved);
        })
        .catch(() => {});
      return;
    }
    logoSaveTimer.current = window.setTimeout(() => {
      logoSaveTimer.current = null;
      void api
        .updateProject(projectId, patch)
        .then(({ project: saved }) => {
          if (saved) handleProjectUpdated(saved);
        })
        .catch(() => {});
    }, 250);
  };

  const handleInteractiveLogoUpdate = (logoId: string, patch: Partial<LogoOverlay>) => {
    if (!activeProject) return;
    if (logoSaveTimer.current === null) {
      pushUndoSnapshot(activeProject);
    }
    const nextLogos = activeProject.logos.map((l) => (l.id === logoId ? { ...l, ...patch } : l));
    const nextWorkflow = createWorkflowUpdate(activeProject.workflow, {
      completeStage: 'editor',
      modifiedStage: 'editor',
      hasExistingExport: Boolean(activeProject.lastExportUrl),
    });
    handleProjectUpdated({ ...activeProject, logos: nextLogos, workflow: nextWorkflow });
    scheduleProjectPatchSave(activeProject.id, { logos: nextLogos, workflow: nextWorkflow });
  };

  const handleInteractiveBlurUpdate = (blurId: string, patch: Partial<BlurEffect>) => {
    if (!activeProject) return;
    if (logoSaveTimer.current === null) {
      pushUndoSnapshot(activeProject);
    }
    setSelectedBlurId(blurId);
    const geometryChanged =
      'x' in patch || 'y' in patch || 'width' in patch || 'height' in patch;
    const nextBlurs = activeProject.blurs.map((b) =>
      b.id === blurId
        ? {
            ...b,
            ...patch,
            keyframes: geometryChanged ? undefined : b.keyframes,
          }
        : b
    );
    const nextWorkflow = createWorkflowUpdate(activeProject.workflow, {
      completeStage: 'editor',
      modifiedStage: 'editor',
      hasExistingExport: Boolean(activeProject.lastExportUrl),
    });
    handleProjectUpdated({ ...activeProject, blurs: nextBlurs, workflow: nextWorkflow });
    scheduleProjectPatchSave(activeProject.id, { blurs: nextBlurs, workflow: nextWorkflow });
  };

  const handleInteractiveSubtitleStyleUpdate = (patch: Partial<SubtitleStyle>) => {
    if (!activeProject) return;
    if (logoSaveTimer.current === null) {
      pushUndoSnapshot(activeProject);
    }
    const nextStyle = { ...activeProject.subtitleStyle, ...patch };
    const nextWorkflow = createWorkflowUpdate(activeProject.workflow, {
      visitStage: 'captions',
      modifiedStage: 'captions',
      hasExistingExport: Boolean(activeProject.lastExportUrl),
    });
    handleProjectUpdated({
      ...activeProject,
      subtitleStyle: nextStyle,
      workflow: nextWorkflow,
    });
    scheduleProjectPatchSave(activeProject.id, {
      subtitleStyle: nextStyle,
      workflow: nextWorkflow,
    });
  };

  const handleInteractiveCanvasUpdate = (
    patch: Partial<VideoCanvasConfig>,
    opts?: { immediate?: boolean }
  ) => {
    if (!activeProject) return;
    const onlyGuidesToggle =
      Object.keys(patch).length === 1 && 'showEditingGuides' in patch;
    if (!onlyGuidesToggle && logoSaveTimer.current === null) {
      pushUndoSnapshot(activeProject);
    }
    const nextCanvas: VideoCanvasConfig = {
      ...DEFAULT_VIDEO_CANVAS,
      ...(activeProject.canvas || {}),
      ...patch,
    };
    const nextWorkflow = onlyGuidesToggle
      ? activeProject.workflow
      : createWorkflowUpdate(activeProject.workflow, {
          completeStage: 'editor',
          modifiedStage: 'editor',
          hasExistingExport: Boolean(activeProject.lastExportUrl),
        });
    handleProjectUpdated({
      ...activeProject,
      canvas: nextCanvas,
      workflow: nextWorkflow,
    });
    scheduleProjectPatchSave(
      activeProject.id,
      { canvas: nextCanvas, workflow: nextWorkflow },
      opts?.immediate
    );
  };

  // Global Keyboard Shortcuts (Undo/Redo, Delete, Duplicate, Arrow Nudge)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!activeProject) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (meta && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if ((meta && key === 'z' && e.shiftKey) || (meta && key === 'y')) {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (activePage !== 'editor' && activePage !== 'captions') return;

      // Duplicate selected unlocked blur or logo (Ctrl/Cmd + D)
      if (meta && key === 'd' && selectedElement) {
        if (selectedElement.kind === 'blur') {
          const orig = activeProject.blurs.find((b) => b.id === selectedElement.id);
          if (orig && !orig.locked) {
            e.preventDefault();
            const copy: BlurEffect = {
              ...orig,
              id: uuidv4(),
              name: `${orig.name} Copy`,
              x: Math.min(0.95 - orig.width, orig.x + 0.03),
              y: Math.min(0.95 - orig.height, orig.y + 0.03),
            };
            const nextBlurs = [...activeProject.blurs, copy];
            const nextCanvas: VideoCanvasConfig = {
              ...DEFAULT_VIDEO_CANVAS,
              ...(activeProject.canvas || {}),
              ...(activeProject.canvas?.layerOrder
                ? { layerOrder: [...activeProject.canvas.layerOrder, `blur:${copy.id}`] }
                : {}),
            };
            handleProjectUpdated({ ...activeProject, blurs: nextBlurs, canvas: nextCanvas });
            handleSelectElement({ kind: 'blur', id: copy.id });
            void api.updateProject(activeProject.id, { blurs: nextBlurs, canvas: nextCanvas });
          }
        } else if (selectedElement.kind === 'logo') {
          const orig = activeProject.logos.find((l) => l.id === selectedElement.id);
          if (orig && !orig.locked) {
            e.preventDefault();
            const copy: LogoOverlay = {
              ...orig,
              id: uuidv4(),
              x: Math.min(0.92, orig.x + 0.03),
              y: Math.min(0.92, orig.y + 0.03),
              presetPosition: 'custom',
            };
            const nextLogos = [...activeProject.logos, copy];
            const nextCanvas: VideoCanvasConfig = {
              ...DEFAULT_VIDEO_CANVAS,
              ...(activeProject.canvas || {}),
              ...(activeProject.canvas?.layerOrder
                ? { layerOrder: [...activeProject.canvas.layerOrder, `logo:${copy.id}`] }
                : {}),
            };
            handleProjectUpdated({ ...activeProject, logos: nextLogos, canvas: nextCanvas });
            handleSelectElement({ kind: 'logo', id: copy.id });
            void api.updateProject(activeProject.id, { logos: nextLogos, canvas: nextCanvas });
          }
        }
        return;
      }

      // Delete selected unlocked blur or logo
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElement) {
        if (selectedElement.kind === 'blur') {
          const orig = activeProject.blurs.find((b) => b.id === selectedElement.id);
          if (orig && !orig.locked) {
            e.preventDefault();
            const nextBlurs = activeProject.blurs.filter((b) => b.id !== orig.id);
            handleProjectUpdated({ ...activeProject, blurs: nextBlurs });
            setSelectedElement(null);
            setSelectedBlurId(nextBlurs[0]?.id || null);
            void api.updateProject(activeProject.id, { blurs: nextBlurs });
          }
        } else if (selectedElement.kind === 'logo') {
          const orig = activeProject.logos.find((l) => l.id === selectedElement.id);
          if (orig && !orig.locked) {
            e.preventDefault();
            const nextLogos = activeProject.logos.filter((l) => l.id !== orig.id);
            handleProjectUpdated({ ...activeProject, logos: nextLogos });
            setSelectedElement(null);
            setSelectedLogoId(nextLogos[0]?.id || null);
            void api.updateProject(activeProject.id, { logos: nextLogos });
          }
        }
        return;
      }

      // Arrow keys nudge selected unlocked element
      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) &&
        selectedElement
      ) {
        e.preventDefault();
        const mult = e.shiftKey ? 3 : 1;
        const dxNorm =
          e.key === 'ArrowRight' ? 0.01 * mult : e.key === 'ArrowLeft' ? -0.01 * mult : 0;
        const dyNorm =
          e.key === 'ArrowDown' ? 0.01 * mult : e.key === 'ArrowUp' ? -0.01 * mult : 0;
        const dxPct = e.key === 'ArrowRight' ? 1 * mult : e.key === 'ArrowLeft' ? -1 * mult : 0;
        const dyPct = e.key === 'ArrowDown' ? 1 * mult : e.key === 'ArrowUp' ? -1 * mult : 0;

        if (selectedElement.kind === 'blur') {
          const orig = activeProject.blurs.find((b) => b.id === selectedElement.id);
          if (orig && !orig.locked) {
            handleInteractiveBlurUpdate(orig.id, {
              x: Math.max(0, Math.min(1 - orig.width, Number((orig.x + dxNorm).toFixed(4)))),
              y: Math.max(0, Math.min(1 - orig.height, Number((orig.y + dyNorm).toFixed(4)))),
            });
          }
        } else if (selectedElement.kind === 'logo') {
          const orig = activeProject.logos.find((l) => l.id === selectedElement.id);
          if (orig && !orig.locked) {
            handleInteractiveLogoUpdate(orig.id, {
              x: Math.max(0, Math.min(0.95, Number((orig.x + dxNorm).toFixed(4)))),
              y: Math.max(0, Math.min(0.95, Number((orig.y + dyNorm).toFixed(4)))),
              presetPosition: 'custom',
            });
          }
        } else if (selectedElement.kind === 'captions') {
          if (!activeProject.subtitleStyle.locked) {
            handleInteractiveSubtitleStyleUpdate({
              position: 'custom',
              posX: Math.max(5, Math.min(95, (activeProject.subtitleStyle.posX ?? 50) + dxPct)),
              posY: Math.max(5, Math.min(95, (activeProject.subtitleStyle.posY ?? 84) + dyPct)),
            });
          }
        } else if (selectedElement.kind === 'video') {
          const cv = { ...DEFAULT_VIDEO_CANVAS, ...(activeProject.canvas || {}) };
          if (!cv.videoLocked) {
            handleInteractiveCanvasUpdate({
              offsetX: Math.max(-100, Math.min(100, cv.offsetX + dxPct)),
              offsetY: Math.max(-100, Math.min(100, cv.offsetY + dyPct)),
            });
          }
        } else if (selectedElement.kind === 'bg-image') {
          const cv = { ...DEFAULT_VIDEO_CANVAS, ...(activeProject.canvas || {}) };
          if (!cv.bgImageLocked) {
            handleInteractiveCanvasUpdate({
              bgImageOffsetX: Math.max(-50, Math.min(50, cv.bgImageOffsetX + dxPct)),
              bgImageOffsetY: Math.max(-50, Math.min(50, cv.bgImageOffsetY + dyPct)),
            });
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Clear blur draw mode when leaving Stage 5 blur section
  useEffect(() => {
    if ((activePage !== 'editor' || editorSection !== 'blur') && drawMode !== 'none') {
      setDrawMode('none');
    }
  }, [activePage, editorSection, drawMode]);

  const isThreePaneEditor =
    activePage === 'editor' ||
    activePage === 'captions' ||
    activePage === 'translator';

  const headerTitle =
    activePage === 'editor' && editorSection === 'blur'
      ? 'Stage 5: Editing & Blur Tracking'
      : activePage === 'editor' && editorSection === 'branding'
      ? 'Stage 5: Editing & Logo Watermark'
      : activePage === 'editor' && editorSection === 'canvas'
      ? 'Stage 5: Canvas, Filters & Effects'
      : PAGE_TITLES[activePage];

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#09090B] text-zinc-100 flex">
      <SidebarNav
        activePage={activePage}
        onSelectPage={(page) => void navigateToStage(page)}
        activeProject={activeProject}
        stageStatuses={stageStatuses}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        {/* Top Workspace Header */}
        <header className="h-14 px-4 lg:px-6 border-b border-white/[0.08] bg-[#111115]/90 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06]"
              aria-label="Open menu"
            >
              <Menu className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 text-xs sm:text-sm min-w-0">
              <span className="font-medium text-zinc-400 whitespace-nowrap">
                {headerTitle}
              </span>
              {activeProject && activePage !== 'dashboard' && activePage !== 'settings' && (
                <>
                  <span className="text-zinc-600">/</span>
                  <select
                    value={activeProject.id}
                    onChange={(e) => {
                      const found = projects.find((p) => p.id === e.target.value);
                      if (found) handleSelectProject(found);
                    }}
                    className="bg-transparent text-zinc-100 font-medium truncate max-w-[200px] sm:max-w-[300px] focus:outline-none cursor-pointer"
                    aria-label="Select active project"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id} className="bg-[#111115] text-zinc-100">
                        {p.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {activeProject && isThreePaneEditor && (
              <div className="flex items-center gap-1 border-r border-white/[0.08] pr-2 sm:pr-3">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={undoStack.length === 0}
                  title="Undo (Ctrl+Z)"
                  className="p-1.5 rounded-lg bg-zinc-900 border border-white/[0.08] text-zinc-300 hover:text-white disabled:opacity-35 cursor-pointer"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={redoStack.length === 0}
                  title="Redo (Ctrl+Shift+Z)"
                  className="p-1.5 rounded-lg bg-zinc-900 border border-white/[0.08] text-zinc-300 hover:text-white disabled:opacity-35 cursor-pointer"
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {activeProject && activePage !== 'export' && (
              <button
                onClick={() => void navigateToStage('export')}
                disabled={!activeProject.sourceVideoUrl}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Export MP4
              </button>
            )}
          </div>
        </header>

        {/* Sequential Guided Stage Stepper */}
        {activeProject && isWorkflowStage(activePage) && (
          <WorkflowStepperBar
            stages={stageStatuses}
            activeStage={activeWorkflowStage}
            project={activeProject}
            savingNavigation={savingNavigation}
            navigationError={navigationError}
            onSelectStage={(stage) => void navigateToStage(stage)}
            onBack={handleStepBack}
            onContinue={handleStepContinue}
            onDismissError={() => setNavigationError(null)}
          />
        )}

        {/* Preset Missing Asset Banner */}
        {presetWarnings.length > 0 && activePage !== 'dashboard' && (
          <div className="px-4 lg:px-6 py-2 bg-amber-500/10 border-b border-amber-500/25 flex items-center justify-between gap-3 text-xs text-amber-200 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="truncate">
                Preset applied with missing media asset(s):{' '}
                {presetWarnings
                  .map(
                    (w) =>
                      `${w.presetName} (${w.missingAssets.map((a) => a.label).join(', ')})`
                  )
                  .join(' · ')}{' '}
                — re-upload in Stage 5/6.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setPresetWarnings([])}
              className="p-1 text-amber-300 hover:text-white shrink-0 cursor-pointer"
              aria-label="Dismiss warning"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Main Viewport */}
        <main className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="h-full flex items-center justify-center gap-2 text-sm text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
              Loading workspace...
            </div>
          ) : activePage === 'dashboard' ? (
            <DashboardPage
              projects={projects}
              activeProjectId={activeProjectId}
              recentJobs={recentJobs}
              onSelectProject={handleSelectProject}
              onRefreshProjects={loadWorkspaceData}
              onPresetWarnings={setPresetWarnings}
            />
          ) : activePage === 'settings' ? (
            <SettingsPage />
          ) : !activeProject ? (
            <div className="p-10 text-center space-y-3">
              <div className="text-sm font-medium text-zinc-200">No Active Project Selected</div>
              <p className="text-xs text-zinc-500">
                Create or upload a movie recap project on the Dashboard to open the studio tools.
              </p>
              <button
                onClick={() => setActivePage('dashboard')}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white cursor-pointer"
              >
                Go to Dashboard
              </button>
            </div>
          ) : activePage === 'export' ? (
            <ExportCenterPage
              project={activeProject}
              onProjectUpdated={handleProjectUpdated}
              customFonts={customFonts}
            />
          ) : activePage === 'voice' ? (
            <VoiceStudioPage
              project={activeProject}
              onProjectUpdated={handleProjectUpdated}
              videoRef={videoRef}
              currentTime={currentTime}
              onTimeUpdate={setCurrentTime}
              onSeek={handleSeek}
              previewEffects={previewEffects}
              onTogglePreviewEffects={setPreviewEffects}
              onNavigate={(p) => void navigateToStage(p)}
            />
          ) : isThreePaneEditor ? (
            <div className="h-full flex flex-col xl:flex-row overflow-y-auto xl:overflow-hidden">
              {/* Center: Video Player + Multi-Track Timeline */}
              <div className="flex-1 min-w-0 p-4 lg:p-5 space-y-4 xl:overflow-y-auto">
                <VideoStudioPlayer
                  project={activeProject}
                  currentTime={currentTime}
                  onTimeUpdate={setCurrentTime}
                  videoRef={videoRef}
                  previewEffects={previewEffects}
                  onTogglePreviewEffects={setPreviewEffects}
                  drawMode={drawMode}
                  onFinishDrawBox={handleFinishDrawBox}
                  selectedLogoId={selectedLogoId}
                  onUpdateLogo={
                    activePage === 'editor' || activePage === 'captions'
                      ? handleInteractiveLogoUpdate
                      : undefined
                  }
                  selectedBlurId={selectedBlurId}
                  onUpdateBlur={
                    activePage === 'editor' || activePage === 'captions'
                      ? handleInteractiveBlurUpdate
                      : undefined
                  }
                  onUpdateSubtitleStyle={
                    activePage === 'captions' || activePage === 'editor'
                      ? handleInteractiveSubtitleStyleUpdate
                      : undefined
                  }
                  selectedElement={selectedElement}
                  onSelectElement={handleSelectElement}
                  onUpdateCanvas={
                    activePage === 'editor' || activePage === 'captions'
                      ? handleInteractiveCanvasUpdate
                      : undefined
                  }
                  customFonts={customFonts}
                />

                <TimelineEditor
                  project={activeProject}
                  currentTime={currentTime}
                  onSeek={handleSeek}
                  onNavigate={(p) => void navigateToStage(p)}
                />
              </div>

              {/* Right: Dedicated Properties / AI Tool Inspector */}
              <aside className="w-full xl:w-[400px] shrink-0 border-t xl:border-t-0 xl:border-l border-white/[0.08] bg-[#111115] p-4 lg:p-5 xl:overflow-y-auto">
                {activePage === 'editor' && (
                  <EditorInspectorPage
                    project={activeProject}
                    onProjectUpdated={handleProjectUpdated}
                    onNavigate={(p) => void navigateToStage(p)}
                    activeSection={editorSection}
                    onSelectSection={setEditorSection}
                    videoRef={videoRef}
                    drawMode={drawMode}
                    onSetDrawMode={setDrawMode}
                    selectedBlurId={selectedBlurId}
                    onSelectBlur={handleSelectBlurSynced}
                    selectedLogoId={selectedLogoId}
                    onSelectLogo={handleSelectLogoSynced}
                    selectedElement={selectedElement}
                    onSelectElement={handleSelectElement}
                    onUpdateSubtitleStyle={handleInteractiveSubtitleStyleUpdate}
                    canUndo={undoStack.length > 0}
                    canRedo={redoStack.length > 0}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                  />
                )}
                {activePage === 'captions' && (
                  <CaptionsPage
                    project={activeProject}
                    onProjectUpdated={handleProjectUpdated}
                    onSeek={handleSeek}
                    customFonts={customFonts}
                    onCustomFontsChanged={() => void reloadCustomFonts()}
                  />
                )}
                {activePage === 'translator' && (
                  <TranslatorPage
                    project={activeProject}
                    onProjectUpdated={handleProjectUpdated}
                    onSeek={handleSeek}
                  />
                )}
              </aside>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
