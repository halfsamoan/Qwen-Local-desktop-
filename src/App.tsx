import { ClipboardEvent, DragEvent, FormEvent, lazy, Suspense, useEffect, useRef, useState } from "react";
import { platform, visualFixtureMode } from "./platform";
import { parseChatDelta, takeSseData } from "./sse.js";
import { buildProjectContext, selectProjectContextPaths } from "./projectContext";
import { clipboardImageFiles } from "./clipboard";
import { buildLineDiff } from "./textDiff";

type Message = { id?: number; role: "user" | "assistant"; content: string; context_files?: string[] };
type Conversation = { id: number; title: string; updated_at: string; project_id: number | null };
type Project = { id: number; name: string; root_path: string; instructions: string };
type FileEntry = { path: string; name: string; is_dir: boolean };
type SearchHit = { path: string; line: number; snippet: string };
type Attachment = { id: number; message_id: number | null; name: string; mime: string; data_base64: string; text: string; ocr_error: string };
type ActivityGroup = { label: string; items: string[]; icon: string; collapsed: boolean };
type BackendStatus = { running: boolean; error: string; backend_kind: string; context_size: number; gpu_mode: string; detail: string; api_key: string };
type EditingMessage = { id: number; index: number };

const API = "http://127.0.0.1:18080";
const MarkdownView = lazy(() => import("./MarkdownView"));

async function nativeClipboardImage() {
  const { readImage } = await import("@tauri-apps/plugin-clipboard-manager");
  const image = await readImage();
  try {
    const [{ width, height }, rgba] = await Promise.all([image.size(), image.rgba()]);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image encoding failed.")), "image/png"));
    return new File([blob], `screenshot-${Date.now()}.png`, { type: "image/png" });
  } finally {
    await image.close();
  }
}

function backendError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  const detail = message.trim() || "Local backend unavailable.";
  const lower = detail.toLowerCase();
  if (lower.includes("model not found")) return "Model file is missing. Reinstall Qwen Local.";
  if (lower.includes("port 18080")) return "Local AI port 18080 is already in use. Close the other process and retry.";
  if (lower.includes("out of memory") || lower.includes("memory allocation")) return "Not enough VRAM or memory. Choose Balanced or Low GPU Usage and retry.";
  if (lower.includes("cuda") || lower.includes("no usable gpu") || lower.includes("shared libraries")) return "CUDA could not start. Qwen Local will use CPU when possible.";
  if (lower.includes("backend exited") || lower.includes("backend stopped")) return "The local AI backend stopped unexpectedly. Retry to restart it.";
  return "Qwen Local could not start the local AI backend. Open Diagnostics for details.";
}

async function waitForBackend(): Promise<BackendStatus> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${API}/health`)).ok) {
        const backend = await platform.invoke<BackendStatus>("backend_status");
        if (backend.running) return backend;
      }
    } catch { /* backend is still loading */ }
    const backend = await platform.invoke<BackendStatus>("backend_status");
    if (!backend.running) throw new Error(backend.error || "Qwen backend stopped while loading.");
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error("Qwen backend did not become ready within 60 seconds.");
}

async function launchBackend(command: "start_backend" | "restart_backend", contextSize: number, gpuMode: string) {
  await platform.invoke(command, { contextSize, gpuMode });
  if (visualFixtureMode) return { runtime: null, notice: "" };
  try {
    const runtime = await waitForBackend();
    if (gpuMode !== "Low GPU Usage" && runtime.detail.includes("no usable GPU")) throw new Error(runtime.detail);
    return { runtime, notice: "" };
  } catch (reason: unknown) {
    const diagnostic = await platform.invoke<BackendStatus>("backend_status");
    const detail = `${diagnostic.error} ${diagnostic.detail}`.toLowerCase();
    const gpuFailure = ["cuda", "gpu", "vram", "out of memory"].some((token) => detail.includes(token));
    if (gpuMode === "Low GPU Usage" || !gpuFailure) throw reason;
    await platform.invoke("restart_backend", { contextSize, gpuMode: "Low GPU Usage" });
    return { runtime: await waitForBackend(), notice: `CPU fallback · ${backendError(reason)}` };
  }
}

async function readWithIdleTimeout(reader: ReadableStreamDefaultReader<string>) {
  let timer = 0;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("Generation stalled for 60 seconds. Retry the request.")), 60_000);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

function clip(text: string, limit: number) {
  if (limit <= 0) return "";
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit))}\n[…context clipped…]`;
}

function recentMessages(messages: Message[], limit: number) {
  let used = 0;
  const result: Message[] = [];
  for (const message of [...messages].reverse()) {
    const content = clip(message.content, Math.max(0, limit - used));
    if (!content) break;
    result.push({ ...message, content });
    used += content.length;
  }
  return result.reverse();
}

function activitiesFor(messages: Message[]) {
  const files = [...messages].reverse().find((message) => message.role === "user" && message.context_files?.length)?.context_files ?? [];
  return files.length ? [{ label: "Files read", items: files, icon: "▾", collapsed: false }] : [];
}

function AttachmentCard({ attachment, remove }: { attachment: Attachment; remove?: () => void }) {
  const [data, setData] = useState(attachment.data_base64);
  useEffect(() => {
    if (!attachment.mime.startsWith("image/") || data) return;
    let active = true;
    void platform.invoke<string>("load_attachment_data", { attachmentId: attachment.id }).then((value) => { if (active) setData(value); }).catch(console.error);
    return () => { active = false; };
  }, [attachment.id, attachment.mime, data]);
  return <div className="attachment">{attachment.mime.startsWith("image/") && data ? <img src={`data:${attachment.mime};base64,${data}`} alt={attachment.name} /> : <span>{attachment.name}</span>}{remove && <button type="button" onClick={remove} aria-label={`Remove ${attachment.name}`}>×</button>}{attachment.ocr_error && <small>{attachment.ocr_error}</small>}</div>;
}

const fixtureActivities: ActivityGroup[] = [
  { label: "Files read", items: ["src/radar.py", "README.md"], icon: "▾", collapsed: false },
  { label: "Searched project for context", items: ["calculate_range"], icon: "⌕", collapsed: true },
];

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set());
  const [selectedFile, setSelectedFile] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [editingFile, setEditingFile] = useState(false);
  const [draftFileContent, setDraftFileContent] = useState("");
  const [showFileDiff, setShowFileDiff] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [fileSuggestions, setFileSuggestions] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [activities, setActivities] = useState<ActivityGroup[]>(visualFixtureMode && visualFixtureMode !== "empty-chat" && visualFixtureMode !== "empty" ? fixtureActivities : []);
  const [chatQuery, setChatQuery] = useState("");
  const [showChatSearch, setShowChatSearch] = useState(visualFixtureMode === "command-palette");
  const [showSettings, setShowSettings] = useState(visualFixtureMode === "settings");
  const [systemPrompt, setSystemPrompt] = useState(() => localStorage.getItem("qwen.systemPrompt") ?? "You are a helpful local AI assistant.");
  const [contextSize, setContextSize] = useState(() => localStorage.getItem("qwen.contextSize") ?? "8192");
  const [gpuMode, setGpuMode] = useState(() => localStorage.getItem("qwen.gpuMode") ?? "Balanced");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [editingMessage, setEditingMessage] = useState<EditingMessage | null>(null);
  const [status, setStatus] = useState("Starting");
  const [error, setError] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [notice, setNotice] = useState("");
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<number | null>(null);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [renamingConversationId, setRenamingConversationId] = useState<number | null>(null);
  const [conversationTitleDraft, setConversationTitleDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const apiKeyRef = useRef("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLElement>(null);
  const backendReadyRef = useRef(false);
  const backendConfigRef = useRef("");
  const searchRequestRef = useRef(0);
  const pasteEventAtRef = useRef(0);
  const selectedFileRef = useRef(selectedFile);
  const canSend = status === "Ready" || status === "Stopped";

  useEffect(() => { selectedFileRef.current = selectedFile; }, [selectedFile]);

  useEffect(() => {
    let active = true;
    async function loadWorkspace() {
      try {
        const [existing, savedProjects] = await Promise.all([
          platform.invoke<Conversation[]>("list_conversations"),
          platform.invoke<Project[]>("list_projects"),
        ]);
        let list = existing.length ? existing : [{ id: await platform.invoke<number>("create_conversation", { title: "New Chat", projectId: null }), title: "New Chat", updated_at: "", project_id: null }];
        const project = savedProjects[0] ?? null;
        let selectedConversation = list.find((conversation) => conversation.project_id === (project?.id ?? null));
        if (!selectedConversation) {
          selectedConversation = { id: await platform.invoke<number>("create_conversation", { title: "New Chat", projectId: project?.id ?? null }), title: "New Chat", updated_at: "", project_id: project?.id ?? null };
          list = [selectedConversation, ...list];
        }
        if (!active) return;
        setConversations(list);
        setConversationId(selectedConversation.id);
        setProjects(savedProjects);
        setActiveProject(project);
        const [loadedMessages, loadedAttachments, rootEntries] = await Promise.all([
          platform.invoke<Message[]>("list_messages", { conversationId: selectedConversation.id }),
          platform.invoke<Attachment[]>("list_attachments", { conversationId: selectedConversation.id }),
          project ? platform.invoke<FileEntry[]>("project_tree", { rootPath: project.root_path, relativePath: null }) : Promise.resolve([]),
        ]);
        if (!active) return;
        setMessages(loadedMessages);
        setActivities(activitiesFor(loadedMessages));
        setAttachments(loadedAttachments);
        setTree(rootEntries);
      } catch (reason: unknown) {
        console.error(reason);
        if (active) setWorkspaceError("Local conversations or project files could not be loaded.");
      }
    }
    async function loadBackend() {
      try {
        backendReadyRef.current = false;
        const launched = await launchBackend("start_backend", Number(contextSize), gpuMode);
        if (!active) return;
        setBackendStatus(launched.runtime);
        apiKeyRef.current = launched.runtime?.api_key ?? "";
        setNotice(launched.notice);
        backendConfigRef.current = `${contextSize}:${gpuMode}`;
        backendReadyRef.current = true;
        setStatus(visualFixtureMode === "generating" ? "Generating" : "Ready");
      } catch (reason: unknown) {
        console.error(reason);
        backendReadyRef.current = false;
        setBackendStatus(null);
        setStatus("Error");
        setError(backendError(reason));
      }
    }
    void loadWorkspace();
    void loadBackend();
    return () => {
      active = false;
      abortRef.current?.abort();
      void platform.invoke("stop_backend");
    };
  }, []);

  useEffect(() => {
    const request = ++searchRequestRef.current;
    if (!activeProject || !searchQuery.trim()) { setSearchHits([]); return; }
    const timer = window.setTimeout(() => void platform.invoke<SearchHit[]>("search_project", { rootPath: activeProject.root_path, query: searchQuery }).then((hits) => {
      if (searchRequestRef.current === request) setSearchHits(hits);
    }).catch((reason) => {
      console.error(reason);
      if (searchRequestRef.current === request) setSearchHits([]);
    }), 300);
    return () => window.clearTimeout(timer);
  }, [activeProject, searchQuery]);

  useEffect(() => {
    if (!activeProject || visualFixtureMode) return;
    let cancelled = false;
    let timer = 0;
    let unlisten: (() => void) | undefined;
    const rootPath = activeProject.root_path;
    void (async () => {
      try {
        await platform.invoke("watch_project", { rootPath });
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<string>("project-changed", (event) => {
          if (cancelled || event.payload !== rootPath) return;
          window.clearTimeout(timer);
          timer = window.setTimeout(() => void (async () => {
            try {
              await platform.invoke("invalidate_project_index", { rootPath });
              const rootEntries = await platform.invoke<FileEntry[]>("project_tree", { rootPath, relativePath: null });
              setTree(rootEntries);
              setExpandedDirs(new Set());
              setSearchHits([]);
              const path = selectedFileRef.current;
              if (path) setFileContent(await platform.invoke<string>("read_project_file", { rootPath, relativePath: path }));
            } catch (reason) {
              console.error(reason);
              setWorkspaceError("Project files changed, but the tree could not be refreshed.");
            }
          })(), 250);
        });
      } catch (reason) {
        console.error(reason);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      unlisten?.();
      void platform.invoke("unwatch_project");
    };
  }, [activeProject?.id]);

  useEffect(() => {
    const mention = input.match(/(?:^|\s)@([^\s@]*)$/);
    if (!activeProject || !mention) { setFileSuggestions([]); return; }
    let active = true;
    const timer = window.setTimeout(() => void platform.invoke<string[]>("search_project_files", { rootPath: activeProject.root_path, query: mention[1] }).then((paths) => {
      if (active) setFileSuggestions(paths);
    }).catch((reason) => {
      console.error(reason);
      if (active) setFileSuggestions([]);
    }), 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [activeProject, input]);

  useEffect(() => {
    const timer = window.setTimeout(() => void platform.invoke<Conversation[]>("search_conversations", { query: chatQuery }).then(setConversations), 120);
    return () => window.clearTimeout(timer);
  }, [chatQuery]);

  useEffect(() => {
    localStorage.setItem("qwen.systemPrompt", systemPrompt);
    localStorage.setItem("qwen.contextSize", contextSize);
    localStorage.setItem("qwen.gpuMode", gpuMode);
  }, [systemPrompt, contextSize, gpuMode]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "0";
    textarea.style.height = `${Math.min(150, Math.max(42, textarea.scrollHeight))}px`;
  }, [input]);

  useEffect(() => {
    if (status !== "Generating") return;
    const frame = requestAnimationFrame(() => {
      const conversation = conversationRef.current;
      if (conversation) conversation.scrollTop = conversation.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, status]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "p") { event.preventDefault(); setShowChatSearch(true); }
      else if ((event.ctrlKey || event.metaKey) && key === "n") { event.preventDefault(); void newChat(); }
      else if ((event.ctrlKey || event.metaKey) && key === ",") { event.preventDefault(); setShowSettings(true); }
      else if ((event.ctrlKey || event.metaKey) && key === "v" && !visualFixtureMode) {
        const keydownAt = Date.now();
        window.setTimeout(() => { if (pasteEventAtRef.current < keydownAt) void pasteNativeClipboard(); }, 80);
      }
      else if (key === "escape") {
        if (status === "Generating") abortRef.current?.abort();
        else { setShowChatSearch(false); setShowSettings(false); }
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [status, conversations, conversationId]);

  useEffect(() => {
    if (visualFixtureMode === "dark-theme") document.documentElement.dataset.fixtureTheme = "dark";
    return () => { delete document.documentElement.dataset.fixtureTheme; };
  }, []);

  useEffect(() => {
    const config = `${contextSize}:${gpuMode}`;
    if (visualFixtureMode || !backendReadyRef.current || backendConfigRef.current === config || status === "Starting" || status === "Generating" || status === "Error") return;
    const timer = window.setTimeout(() => void (async () => {
      backendReadyRef.current = false;
      setStatus("Starting");
      setError("");
      setNotice("");
      try {
        const launched = await launchBackend("restart_backend", Number(contextSize), gpuMode);
        setBackendStatus(launched.runtime);
        apiKeyRef.current = launched.runtime?.api_key ?? "";
        setNotice(launched.notice);
        backendConfigRef.current = config;
        backendReadyRef.current = true;
        setStatus("Ready");
      } catch (reason: unknown) {
        console.error(reason);
        backendReadyRef.current = false;
        setBackendStatus(null);
        setStatus("Error");
        setError(backendError(reason));
      }
    })(), 300);
    return () => window.clearTimeout(timer);
  }, [contextSize, gpuMode, status]);

  async function selectConversation(id: number, syncProject = true) {
    if (status === "Generating") return;
    if (syncProject) {
      const conversation = conversations.find((item) => item.id === id);
      const project = projects.find((item) => item.id === conversation?.project_id) ?? null;
      if ((activeProject?.id ?? null) !== (project?.id ?? null)) {
        setActiveProject(project);
        setTree(project ? await platform.invoke<FileEntry[]>("project_tree", { rootPath: project.root_path, relativePath: null }) : []);
        setExpandedDirs(new Set());
        setSelectedFile("");
        setFileContent("");
        setEditingFile(false);
        setDraftFileContent("");
        setShowFileDiff(false);
      }
    }
    setConversationId(id);
    const loaded = await platform.invoke<Message[]>("list_messages", { conversationId: id });
    setMessages(loaded);
    setActivities(activitiesFor(loaded));
    setAttachments(await platform.invoke<Attachment[]>("list_attachments", { conversationId: id }));
    setError("");
  }

  async function newChat() {
    await createChat(activeProject?.id ?? null);
  }

  async function createChat(projectId: number | null) {
    if (status === "Generating") return;
    const id = await platform.invoke<number>("create_conversation", { title: "New Chat", projectId });
    setConversations([{ id, title: "New Chat", updated_at: "", project_id: projectId }, ...conversations]);
    setConversationId(id);
    setMessages([]);
    setAttachments([]);
  }

  async function retryBackend() {
    backendReadyRef.current = false;
    setStatus("Starting");
    setError("");
    setNotice("");
    try {
      const launched = await launchBackend("restart_backend", Number(contextSize), gpuMode);
      setBackendStatus(launched.runtime);
      apiKeyRef.current = launched.runtime?.api_key ?? "";
      setNotice(launched.notice);
      backendConfigRef.current = `${contextSize}:${gpuMode}`;
      backendReadyRef.current = true;
      setStatus("Ready");
    } catch (reason: unknown) {
      console.error(reason);
      backendReadyRef.current = false;
      setBackendStatus(null);
      setStatus("Error");
      setError(backendError(reason));
    }
  }

  function stopGeneration() {
    abortRef.current?.abort();
    if (visualFixtureMode === "generating") setStatus("Stopped");
  }

  async function openProject() {
    try {
      const selected = await platform.open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      const project = await platform.invoke<Project>("register_project", { rootPath: selected });
      const next = projects.some((item) => item.id === project.id) ? projects : [project, ...projects];
      setProjects(next);
      await selectProject(project);
      setWorkspaceError("");
    } catch (reason: unknown) {
      console.error(reason);
      setWorkspaceError("The project folder could not be opened. Check that it still exists and is readable.");
    }
  }

  async function selectProject(project: Project) {
    if (status === "Generating") return;
    try {
      const rootEntries = await platform.invoke<FileEntry[]>("project_tree", { rootPath: project.root_path, relativePath: null });
      setActiveProject(project);
      setTree(rootEntries);
      setExpandedDirs(new Set());
      setSelectedFile("");
      setFileContent("");
      setEditingFile(false);
      setDraftFileContent("");
      setShowFileDiff(false);
      const recent = conversations.find((conversation) => conversation.project_id === project.id);
      if (recent) await selectConversation(recent.id, false);
      else await createChat(project.id);
      setWorkspaceError("");
    } catch (reason: unknown) {
      console.error(reason);
      setWorkspaceError(`Could not open ${project.name}. Check the folder path and permissions.`);
    }
  }

  async function selectGeneral() {
    if (status === "Generating") return;
    setActiveProject(null);
    setTree([]);
    setSelectedFile("");
    setFileContent("");
    setEditingFile(false);
    setDraftFileContent("");
    setShowFileDiff(false);
    const recent = conversations.find((conversation) => conversation.project_id === null);
    if (recent) await selectConversation(recent.id, false);
    else await createChat(null);
  }

  async function selectTreeEntry(entry: FileEntry) {
    if (!entry.is_dir) {
      await selectFile(entry);
      return;
    }
    const prefix = `${entry.path}/`;
    if (expandedDirs.has(entry.path)) {
      setTree((current) => current.filter((item) => !item.path.startsWith(prefix)));
      setExpandedDirs((current) => new Set([...current].filter((path) => path !== entry.path && !path.startsWith(prefix))));
      return;
    }
    if (!activeProject) return;
    const children = await platform.invoke<FileEntry[]>("project_tree", { rootPath: activeProject.root_path, relativePath: entry.path });
    setTree((current) => {
      const index = current.findIndex((item) => item.path === entry.path);
      if (index < 0) return current;
      return [...current.slice(0, index + 1), ...children, ...current.slice(index + 1)];
    });
    setExpandedDirs((current) => new Set(current).add(entry.path));
  }

  function insertFileMention(path: string) {
    setInput((current) => current.replace(/@[^\s@]*$/, `@${path} `));
    setFileSuggestions([]);
  }

  async function selectFile(entry: FileEntry) {
    if (!activeProject || entry.is_dir) return;
    try {
      const content = await platform.invoke<string>("read_project_file", { rootPath: activeProject.root_path, relativePath: entry.path });
      setSelectedFile(entry.path);
      setFileContent(content);
      setDraftFileContent(content);
      setEditingFile(false);
      setShowFileDiff(false);
      setWorkspaceError("");
    } catch (reason: unknown) {
      console.error(reason);
      setWorkspaceError(`Could not read ${entry.path}. It may be binary, too large, or inaccessible.`);
    }
  }

  function beginFileEdit() {
    setDraftFileContent(fileContent);
    setShowFileDiff(false);
    setEditingFile(true);
  }

  function cancelFileEdit() {
    setDraftFileContent(fileContent);
    setShowFileDiff(false);
    setEditingFile(false);
  }

  async function applyFileEdit() {
    if (!activeProject || !selectedFile || draftFileContent === fileContent || !showFileDiff) return;
    try {
      await platform.invoke("write_project_file", {
        rootPath: activeProject.root_path,
        relativePath: selectedFile,
        expectedContent: fileContent,
        content: draftFileContent,
      });
      setFileContent(draftFileContent);
      cancelFileEdit();
      setWorkspaceError("");
    } catch (reason) {
      console.error(reason);
      setWorkspaceError(reason instanceof Error ? reason.message : "The file changed before approval. Reload it and review the diff again.");
    }
  }

  async function saveProjectName(project: Project) {
    const name = projectNameDraft.trim();
    if (!name || name === project.name) { setRenamingProjectId(null); return; }
    try {
      await platform.invoke("rename_project", { projectId: project.id, name });
      setProjects((current) => current.map((item) => item.id === project.id ? { ...item, name } : item));
      setActiveProject((current) => current?.id === project.id ? { ...current, name } : current);
      setRenamingProjectId(null);
      setWorkspaceError("");
    } catch (reason) {
      console.error(reason);
      setWorkspaceError("Project name could not be changed.");
    }
  }

  async function saveConversationTitle(conversation: Conversation) {
    const title = conversationTitleDraft.trim();
    if (!title || title === conversation.title) { setRenamingConversationId(null); return; }
    try {
      await platform.invoke("rename_conversation", { conversationId: conversation.id, title });
      setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, title } : item));
      setRenamingConversationId(null);
    } catch (reason) {
      console.error(reason);
      setWorkspaceError("Conversation name could not be changed.");
    }
  }

  async function attachFiles() {
    if (conversationId === null) return;
    try {
      const selected = await platform.open({ multiple: true });
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      for (const path of paths) {
        const attachment = await platform.invoke<Attachment>("inspect_attachment", { conversationId, path });
        setAttachments((current) => [...current, attachment]);
      }
      setWorkspaceError("");
    } catch (reason: unknown) {
      console.error(reason);
      setWorkspaceError("The selected file could not be attached. Files must be readable and no larger than 10 MB.");
    }
  }

  async function handlePaste(event: ClipboardEvent<HTMLElement>) {
    if (conversationId === null) return;
    pasteEventAtRef.current = Date.now();
    const images = clipboardImageFiles(event.clipboardData);
    if (images.length) event.preventDefault();
    if (!images.length) return void await pasteNativeClipboard();
    try {
      await saveFiles(images);
      setWorkspaceError("");
    } catch (reason: unknown) {
      console.error(reason);
      setWorkspaceError("The clipboard image could not be saved. Copy the screenshot again and retry.");
    }
  }

  async function pasteNativeClipboard() {
    if (conversationId === null || visualFixtureMode) return;
    let image: File;
    try {
      image = await nativeClipboardImage();
    } catch {
      return; // Plain text stays on the WebView's normal paste path.
    }
    try {
      await saveFiles([image]);
      setWorkspaceError("");
    } catch (reason: unknown) {
      console.error(reason);
      setWorkspaceError("The clipboard image could not be saved. Copy the screenshot again and retry.");
    }
  }

  async function saveFiles(files: File[]) {
    if (conversationId === null) return;
    for (const [index, file] of files.entries()) {
      const bytes = [...new Uint8Array(await file.arrayBuffer())];
      const name = file.name || `screenshot-${Date.now()}-${index + 1}.png`;
      const attachment = await platform.invoke<Attachment>("save_pasted_image", { conversationId, name, bytes, mime: file.type || "text/plain" });
      setAttachments((current) => [...current, attachment]);
    }
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (!canSend) return;
    try {
      await saveFiles([...event.dataTransfer.files]);
      setWorkspaceError("");
    } catch (reason: unknown) {
      console.error(reason);
      setWorkspaceError("The dropped file could not be attached. Files must be readable and no larger than 10 MB.");
    }
  }

  async function removeAttachment(attachmentId: number) {
    await platform.invoke("remove_attachment", { attachmentId });
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }

  async function submitPrompt(prompt: string, edit: EditingMessage | null = null) {
    if (!prompt || conversationId === null || !canSend) return;
    const history = edit ? messages.slice(0, edit.index) : messages;
    setInput("");
    setEditingMessage(null);
    setStatus("Generating");
    setError("");
    const controller = new AbortController();
    abortRef.current = controller;
    let assistantText = "";
    try {
      const userMessageId = edit?.id ?? await platform.invoke<number>("append_message", { conversationId, role: "user", content: prompt });
      if (edit) await platform.invoke("revise_user_message", { conversationId, messageId: userMessageId, content: prompt });
      else {
        await platform.invoke("assign_pending_attachments", { conversationId, messageId: userMessageId });
        setAttachments((current) => current.map((attachment) => attachment.message_id === null ? { ...attachment, message_id: userMessageId } : attachment));
      }
      const next = [...history, { id: userMessageId, role: "user" as const, content: prompt }];
      setMessages([...next, { role: "assistant", content: "" }]);
      if (!edit && history.length === 0) await platform.invoke("rename_conversation", { conversationId, title: prompt.slice(0, 48) });
      const promptBudget = Math.max(12_000, Number(contextSize) * 3);
      const modelMessages = recentMessages(history, Math.floor(promptBudget * 0.45));
      let enrichedPrompt = prompt;
      let projectContext = "";
      let projectInstructions = activeProject?.instructions.trim() ?? "";
      let projectIdentity = "";
      if (activeProject) {
        projectIdentity = buildProjectContext(activeProject.name, activeProject.root_path, tree);
        try {
          const projectFileInstructions = (await platform.invoke<string>("read_project_file", { rootPath: activeProject.root_path, relativePath: "PROJECT.md" })).trim();
          if (projectFileInstructions) projectInstructions += `${projectInstructions ? "\n\n" : ""}${projectFileInstructions}`;
        } catch { /* PROJECT.md is optional */ }
        const explicit = [...prompt.matchAll(/@([^\s]+)/g)].map((match) => match[1]);
        const hits = explicit.length ? [] : (await platform.invoke<SearchHit[]>("search_project", { rootPath: activeProject.root_path, query: prompt })).slice(0, 5);
        const paths = selectProjectContextPaths(selectedFile, explicit, hits, tree);
        const perFileLimit = explicit.length ? 24_000 : 8_000;
        const files = (await Promise.all(paths.map(async (path) => {
          try {
            return { path, content: clip(await platform.invoke<string>("read_project_file", { rootPath: activeProject.root_path, relativePath: path }), perFileLimit) };
          } catch (reason: unknown) {
            console.error(reason);
            return null;
          }
        }))).filter((file): file is { path: string; content: string } => file !== null);
        const readPaths = files.map((file) => file.path);
        await platform.invoke("save_message_context", { messageId: userMessageId, paths: readPaths });
        setMessages((current) => current.map((message) => message.id === userMessageId ? { ...message, context_files: readPaths } : message));
        setActivities([
          { label: "Project context", items: [activeProject.name, `${tree.length} visible entries`], icon: "▱", collapsed: true },
          { label: "Files read", items: readPaths.length ? readPaths : ["Project tree only"], icon: "▾", collapsed: false },
        ]);
        projectContext = files.map((file) => `${file.path}\n${file.content}`).join("\n\n");
      }
      const currentAttachments = attachments.filter((attachment) => attachment.message_id === null || (edit && attachment.message_id === edit.id));
      const attachmentContext = currentAttachments.filter((attachment) => attachment.text).map((attachment) => `[${attachment.name}]\n${clip(attachment.text, 12_000)}`).join("\n\n");
      const recentChars = modelMessages.reduce((sum, message) => sum + message.content.length, 0);
      const effectiveSystemPrompt = `${systemPrompt}${projectIdentity ? `\n\n${projectIdentity}` : ""}${projectInstructions ? `\n\n[Project instructions]\n${projectInstructions}` : ""}`;
      const retrievalBudget = Math.max(2_000, promptBudget - effectiveSystemPrompt.length - recentChars - prompt.length - 1_200);
      const boundedProject = clip(projectContext, Math.floor(retrievalBudget * 0.7));
      const boundedAttachments = clip(attachmentContext, Math.max(0, retrievalBudget - boundedProject.length));
      if (boundedProject) enrichedPrompt += `\n\n[Relevant project context]\n${boundedProject}`;
      if (boundedAttachments) enrichedPrompt += `\n\n[Attachments]\n${boundedAttachments}`;
      const requestMessages = [...modelMessages, { role: "user" as const, content: enrichedPrompt }];
      if (visualFixtureMode) {
        assistantText = "Fixture response.";
        const assistantId = await platform.invoke<number>("append_message", { conversationId, role: "assistant", content: assistantText });
        setMessages([...next, { id: assistantId, role: "assistant", content: assistantText }]);
        setStatus("Ready");
        return;
      }
      const response = await fetch(`${API}/v1/chat/completions`, {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKeyRef.current}` }, signal: controller.signal,
        body: JSON.stringify({ model: "local", messages: [{ role: "system", content: effectiveSystemPrompt }, ...requestMessages], stream: true, max_tokens: Math.min(1024, Math.max(256, Number(contextSize) / 8)) }),
      });
      if (!response.ok || !response.body) throw new Error(`Backend returned ${response.status}`);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      const consume = (events: string[]) => {
        let appended = "";
        let done = false;
        for (const eventData of events) {
          const delta = parseChatDelta(eventData);
          if (!delta) { console.warn("Skipped malformed SSE event"); continue; }
          if (delta.done) { done = true; continue; }
          if (delta.text) {
            assistantText += delta.text;
            appended += delta.text;
          }
        }
        if (appended) setMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, content: message.content + appended } : message));
        return done;
      };
      while (true) {
        const chunk = await readWithIdleTimeout(reader);
        if (chunk.done) {
          consume(takeSseData(buffer, true).events);
          break;
        }
        buffer += chunk.value;
        const parsed = takeSseData(buffer);
        buffer = parsed.rest;
        if (consume(parsed.events)) { await reader.cancel(); break; }
      }
      if (assistantText) {
        const assistantId = await platform.invoke<number>("append_message", { conversationId, role: "assistant", content: assistantText });
        setMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, id: assistantId } : message));
      }
      setStatus("Ready");
    } catch (reason: unknown) {
      if ((reason as DOMException).name !== "AbortError") {
        controller.abort();
        console.error(reason);
        backendReadyRef.current = false;
        setBackendStatus(null);
        setStatus("Error");
        setError(backendError(reason));
      } else {
        setStatus("Stopped");
        if (assistantText) await platform.invoke("append_message", { conversationId, role: "assistant", content: assistantText });
      }
    } finally {
      abortRef.current = null;
      setConversations(await platform.invoke<Conversation[]>("list_conversations"));
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    await submitPrompt(input.trim(), editingMessage);
  }

  function editMessage(message: Message, index: number) {
    if (!message.id || status === "Generating") return;
    setEditingMessage({ id: message.id, index });
    setInput(message.content);
  }

  async function regenerate(index: number) {
    if (status === "Generating") return;
    for (let userIndex = index - 1; userIndex >= 0; userIndex -= 1) {
      const message = messages[userIndex];
      if (message.role === "user" && message.id) {
        await submitPrompt(message.content, { id: message.id, index: userIndex });
        return;
      }
    }
  }

  return (
    <main className="shell" onPaste={(event) => void handlePaste(event)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void handleDrop(event)}>
      <aside className={`sidebar ${sidebarOpen ? "" : "collapsed"}`}>
        <div className="sidebar-top"><button className="icon-button sidebar-toggle" onClick={() => setSidebarOpen((value) => !value)} aria-label="Toggle sidebar">◫</button><div className="brand">Qwen Local <span>⌄</span></div><button className="icon-button" onClick={() => setShowChatSearch((value) => !value)} aria-label="Search">⌕</button></div>
        <nav className="primary-nav">
          <button className="nav-item" onClick={() => void newChat()}><span className="nav-icon">✎</span><span>New chat</span><kbd>Ctrl N</kbd></button>
          <button className="nav-item" onClick={() => void openProject()}><span className="nav-icon">▱</span><span>Projects</span></button>
          <button className="nav-item" onClick={() => setShowChatSearch((value) => !value)}><span className="nav-icon">⌕</span><span>Search</span><kbd>Ctrl P</kbd></button>
        </nav>
        <div className="sidebar-heading"><span>Projects</span><button className="icon-button" onClick={() => void openProject()} aria-label="Open project">＋</button></div>
        <div className="project-list"><button className={`chat-item ${activeProject === null ? "selected" : ""}`} onClick={() => void selectGeneral()}><span className="item-icon">◌</span><span>General</span></button>{projects.map((project) => <div className="project-row" key={project.id}>{renamingProjectId === project.id ? <form className="rename-form" onSubmit={(event) => { event.preventDefault(); void saveProjectName(project); }}><input autoFocus value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} onBlur={() => void saveProjectName(project)} aria-label={`Rename ${project.name}`} /><button type="submit" aria-label="Save project name">✓</button></form> : <button className={`chat-item ${project.id === activeProject?.id ? "selected" : ""}`} onClick={() => void selectProject(project)}><span className="item-icon">▱</span><span>{project.name}</span></button>}<button type="button" className="rename-button" onClick={(event) => { event.stopPropagation(); setRenamingProjectId(project.id); setProjectNameDraft(project.name); }} aria-label={`Rename ${project.name}`}>✎</button></div>)}</div>
        <div className="sidebar-heading recent-heading"><span>Recent</span></div>
        <div className="chat-list">{conversations.filter((conversation) => conversation.project_id === (activeProject?.id ?? null)).map((conversation) => <div className="conversation-row" key={conversation.id}>{renamingConversationId === conversation.id ? <form className="rename-form" onSubmit={(event) => { event.preventDefault(); void saveConversationTitle(conversation); }}><input autoFocus value={conversationTitleDraft} onChange={(event) => setConversationTitleDraft(event.target.value)} onBlur={() => void saveConversationTitle(conversation)} aria-label={`Rename ${conversation.title}`} /><button type="submit" aria-label="Save conversation name">✓</button></form> : <button className={`chat-item ${conversation.id === conversationId ? "selected" : ""}`} onClick={() => void selectConversation(conversation.id)}><span className="item-icon">◌</span><span>{conversation.title}</span></button>}<button type="button" className="rename-button" onClick={(event) => { event.stopPropagation(); setRenamingConversationId(conversation.id); setConversationTitleDraft(conversation.title); }} aria-label={`Rename ${conversation.title}`}>✎</button></div>)}</div>
        <div className="sidebar-footer"><button className="nav-item" onClick={() => setShowSettings(true)}><span className="nav-icon">⚙</span><span>Settings</span><kbd>Ctrl ,</kbd></button><div className="local-badge"><span className="status-dot" />Local only</div></div>
      </aside>
      {activeProject && <aside className="file-tree"><div className="tree-header"><div><span className="tree-folder">▱</span><strong>{activeProject.name}</strong></div><span className="tree-count">{tree.filter((entry) => !entry.is_dir).length}</span></div><div className="project-search-wrap"><span>⌕</span><input className="project-search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search files" /></div><div className="tree-list">{searchHits.map((hit) => <button className="tree-item hit" key={`${hit.path}:${hit.line}`} onClick={() => void selectFile({ path: hit.path, name: hit.path, is_dir: false })}><span>{hit.path}:{hit.line}</span><small>{hit.snippet}</small></button>)}{!searchHits.length && tree.map((entry) => <button className={`tree-item ${entry.path === selectedFile ? "selected" : ""} ${entry.is_dir ? "directory" : ""}`} style={{ paddingLeft: `${8 + (entry.path.split("/").length - 1) * 12}px` }} key={entry.path} onClick={() => void selectTreeEntry(entry)}><span className="tree-glyph">{entry.is_dir ? expandedDirs.has(entry.path) ? "▾" : "›" : "·"}</span><span>{entry.name}</span></button>)}</div></aside>}
      <section className="workspace">
        <header className="topbar"><div className="workspace-title"><span className="title-icon">▱</span><strong>{activeProject?.name ?? "New chat"}</strong><span className={`status ${status.toLowerCase()}`}><span className="status-dot" />{status}</span></div><div className="topbar-actions"><button className="icon-button panel-button" onClick={() => setShowSettings(true)} aria-label="Open settings">☷</button></div></header>
        {showChatSearch && <div className="search-overlay" role="presentation" onClick={() => setShowChatSearch(false)}><div className="search-dialog" role="dialog" aria-label="Search chats" onClick={(event) => event.stopPropagation()}><div className="search-dialog-row"><span>⌕</span><input autoFocus className="chat-search" value={chatQuery} onChange={(event) => setChatQuery(event.target.value)} placeholder="Search chats" onKeyDown={(event) => { if (event.key === "Escape") setShowChatSearch(false); }} /><button className="icon-button" onClick={() => setShowChatSearch(false)} aria-label="Close search">×</button></div><div className="search-results">{conversations.slice(0, 8).map((conversation) => <button key={conversation.id} onClick={() => { void selectConversation(conversation.id); setShowChatSearch(false); }}><span>◌</span>{conversation.title}</button>)}</div></div></div>}
        <section ref={conversationRef} className={`conversation ${messages.length === 0 ? "empty" : ""}`} aria-live={status === "Generating" ? "off" : "polite"}>
          {messages.length === 0 && <div className="empty-hint">Ask Qwen Local</div>}
          {messages.map((message, index) => <div key={message.id ?? `${index}-${message.role}`}><article className={`message ${message.role}`}><div className="role">{message.role === "user" ? "You" : "Qwen"}</div>{message.id && attachments.some((attachment) => attachment.message_id === message.id) && <div className="message-attachments">{attachments.filter((attachment) => attachment.message_id === message.id).map((attachment) => <AttachmentCard key={attachment.id} attachment={attachment} />)}</div>}<div className="content">{message.content ? message.role === "assistant" ? <Suspense fallback={<span>{message.content}</span>}><MarkdownView content={message.content} /></Suspense> : message.content : message.role === "assistant" ? "…" : ""}</div>{message.content && <div className="message-actions"><button type="button" onClick={() => void navigator.clipboard.writeText(message.content)}>Copy</button>{message.role === "user" && <button type="button" onClick={() => editMessage(message, index)}>Edit</button>}{message.role === "assistant" && <button type="button" onClick={() => void regenerate(index)}>Regenerate</button>}</div>}</article>{message.role === "user" && index === messages.map((item) => item.role).lastIndexOf("user") && activities.length > 0 && <div className="activity-list">{activities.map((activity) => <details className="activity-group" key={activity.label} open={!activity.collapsed}><summary><span className="activity-icon">{activity.icon}</span><span>{activity.label}</span><span className="activity-count">{activity.items.length}</span></summary><div className="activity-items">{activity.items.map((item) => <div key={item}>{item}</div>)}</div></details>)}</div>}</div>)}
        </section>
        {selectedFile && <section className="file-preview"><div className="file-preview-header"><div className="role">Context file · {selectedFile}</div><div className="file-preview-actions">{!editingFile ? <button type="button" onClick={beginFileEdit}>Edit</button> : <><button type="button" onClick={cancelFileEdit}>Cancel</button>{draftFileContent !== fileContent && <button type="button" onClick={() => setShowFileDiff((value) => !value)}>{showFileDiff ? "Hide diff" : "Preview diff"}</button>}<button type="button" onClick={() => void applyFileEdit()} disabled={!showFileDiff || draftFileContent === fileContent}>Apply changes</button></>}<button type="button" onClick={() => { cancelFileEdit(); setSelectedFile(""); setFileContent(""); }} aria-label="Remove context file">×</button></div></div>{editingFile ? <textarea className="file-editor" value={draftFileContent} onChange={(event) => { setDraftFileContent(event.target.value); setShowFileDiff(false); }} aria-label={`Edit ${selectedFile}`} /> : <pre>{fileContent}</pre>}{showFileDiff && <div className="file-diff" aria-label="File diff"><div className="diff-caption">Review diff before applying</div>{buildLineDiff(fileContent, draftFileContent).map((line, index) => <div className={`diff-line ${line.kind}`} key={`${index}-${line.kind}`}>{line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}{line.text}</div>)}</div>}</section>}
        {error && <div className="error"><span>{error}</span><button onClick={() => void retryBackend()}>Retry</button><button onClick={() => setShowSettings(true)}>Diagnostics</button></div>}
        {workspaceError && <div className="notice">{workspaceError}</div>}
        {notice && <div className="notice">{notice}</div>}
        {attachments.some((attachment) => attachment.message_id === null) && <div className="attachments">{attachments.filter((attachment) => attachment.message_id === null).map((attachment) => <AttachmentCard key={attachment.id} attachment={attachment} remove={() => void removeAttachment(attachment.id)} />)}</div>}
        <form className="composer" onSubmit={send}>{fileSuggestions.length > 0 && <div className="file-suggestions" role="listbox" aria-label="Project files">{fileSuggestions.map((path) => <button type="button" role="option" key={path} onClick={() => insertFileMention(path)}>@{path}</button>)}</div>}<div className="composer-row"><button className="composer-plus" type="button" onClick={() => void attachFiles()} disabled={!canSend} aria-label="Attach file">＋</button><textarea ref={composerRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder="What would you like to work on?" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button className="send-button" type="submit" disabled={!canSend || !input.trim()} aria-label="Send message">↑</button></div><div className="composer-meta"><span className="access-label"><span className="status-dot" />{editingMessage ? "Editing message" : "Local only"}</span>{editingMessage && <button className="cancel-edit" type="button" onClick={() => { setEditingMessage(null); setInput(""); }}>Cancel</button>}<span className="model-label">Qwen 4B · {gpuMode} <span>⌄</span></span>{status === "Generating" && <button className="stop-button" type="button" onClick={stopGeneration} aria-label="Stop generation">■</button>}</div></form>
        {showSettings && <div className="settings-panel"><div className="settings-header"><h2>Settings</h2><button onClick={() => setShowSettings(false)}>×</button></div><label>System Prompt<textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} /></label>{activeProject && <label>Project Instructions<textarea value={activeProject.instructions} onChange={(event) => { const instructions = event.target.value; setActiveProject({ ...activeProject, instructions }); setProjects((current) => current.map((project) => project.id === activeProject.id ? { ...project, instructions } : project)); }} onBlur={(event) => void platform.invoke("update_project_instructions", { projectId: activeProject.id, instructions: event.target.value })} /></label>}<label>Context Size<select value={contextSize} onChange={(event) => setContextSize(event.target.value)}><option>4096</option><option>8192</option><option>16384</option></select></label><label>GPU Mode<select value={gpuMode} onChange={(event) => setGpuMode(event.target.value)}><option>Balanced</option><option>Maximum Performance</option><option>Low GPU Usage</option></select></label><div className="runtime-status"><strong>Backend</strong><span>{backendStatus ? `${backendStatus.backend_kind} · Context ${backendStatus.context_size}` : status}</span>{backendStatus?.detail && <small>{backendStatus.detail}</small>}</div></div>}
      </section>
    </main>
  );
}
