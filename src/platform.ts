import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";

export type InvokeArgs = Record<string, unknown> | undefined;
export type OpenOptions = { directory?: boolean; multiple?: boolean };
export type PlatformAdapter = {
  invoke<T>(command: string, args?: InvokeArgs): Promise<T>;
  open(options?: OpenOptions): Promise<string | string[] | null>;
};

type FixtureMessage = { id: number; role: "user" | "assistant"; content: string; context_files?: string[] };
type FixtureConversation = { id: number; title: string; updated_at: string; project_id: number | null };
type FixtureProject = { id: number; name: string; root_path: string; instructions: string };
type FixtureEntry = { path: string; name: string; is_dir: boolean };
type FixtureAttachment = { id: number; message_id: number | null; name: string; mime: string; data_base64: string; text: string; ocr_error: string };

export const visualFixtureMode = new URLSearchParams(window.location.search).get("visual-fixture");

const fixtureProject: FixtureProject = { id: 1, name: "Radar Project", root_path: "/fixture/radar-project", instructions: "Prefer concise radar engineering explanations." };
const fixtureTree: FixtureEntry[] = [
  { path: "src", name: "src", is_dir: true },
  { path: "src/radar.py", name: "radar.py", is_dir: false },
  { path: "src/main.py", name: "main.py", is_dir: false },
  { path: "README.md", name: "README.md", is_dir: false },
];

export class VisualFixtureAdapter implements PlatformAdapter {
  private readonly attachment: FixtureAttachment = { id: 1, message_id: null, name: "fixture.txt", mime: "text/plain", data_base64: "", text: "Fixture attachment", ocr_error: "" };
  private backendStarts = 0;
  private conversations: FixtureConversation[] = visualFixtureMode === "empty-chat" || !visualFixtureMode ? [] : [{ id: 1, title: "Radar CFAR analysis", updated_at: "2026-09-07 00:00:00", project_id: 1 }];
  private messages: FixtureMessage[] = visualFixtureMode === "empty-chat" || !visualFixtureMode ? [] : [
    { id: 1, role: "user", content: "Explain how @src/radar.py calculates range.", context_files: ["src/radar.py", "README.md"] },
    { id: 2, role: "assistant", content: "`calculate_range` converts the round-trip time into distance:\n\n```python\ndef calculate_range(t, c=3e8):\n    return c * t / 2\n```\n\nThe division by two accounts for the outbound and return path." },
  ];

  async invoke<T>(command: string, args?: InvokeArgs): Promise<T> {
    const conversationId = Number(args?.conversationId ?? 1);
    switch (command) {
      case "list_conversations": return this.conversations as T;
      case "create_conversation": {
        const id = Math.max(0, ...this.conversations.map((conversation) => conversation.id)) + 1;
        this.conversations.unshift({ id, title: "New Chat", updated_at: "", project_id: Number(args?.projectId) || null });
        return id as T;
      }
      case "list_messages": {
        if (conversationId !== 1) return [] as T;
        if (visualFixtureMode === "long-chat") return Array.from({ length: 6 }, (_, index) => ({ id: index + 1, role: index % 2 ? "assistant" : "user", content: index % 2 ? "A concise fixture response with enough text to exercise conversation scrolling." : `Fixture question ${index + 1}: explain the project behavior.` })) as T;
        return this.messages.map((message) => ({ ...message, context_files: message.context_files ? [...message.context_files] : undefined })) as T;
      }
      case "append_message": {
        const role = String(args?.role) as FixtureMessage["role"];
        const id = Math.max(0, ...this.messages.map((message) => message.id)) + 1;
        this.messages.push({ id, role, content: String(args?.content ?? "") });
        return id as T;
      }
      case "assign_pending_attachments": return undefined as T;
      case "revise_user_message": {
        const messageId = Number(args?.messageId);
        const index = this.messages.findIndex((message) => message.id === messageId && message.role === "user");
        if (index >= 0) {
          this.messages[index].content = String(args?.content ?? "");
          this.messages.splice(index + 1);
        }
        return undefined as T;
      }
      case "save_message_context": return undefined as T;
      case "rename_conversation": {
        const id = Number(args?.conversationId);
        const conversation = this.conversations.find((item) => item.id === id);
        if (conversation) conversation.title = String(args?.title ?? conversation.title);
        return undefined as T;
      }
      case "search_conversations": {
        const query = String(args?.query ?? "").toLowerCase();
        return this.conversations.filter((conversation) => conversation.title.toLowerCase().includes(query)) as T;
      }
      case "list_projects": return (visualFixtureMode === "empty-chat" ? [] : [fixtureProject]) as T;
      case "register_project": return fixtureProject as T;
      case "rename_project": fixtureProject.name = String(args?.name ?? fixtureProject.name); return undefined as T;
      case "update_project_instructions": return undefined as T;
      case "write_project_file": return undefined as T;
      case "watch_project": return undefined as T;
      case "unwatch_project": return undefined as T;
      case "invalidate_project_index": return undefined as T;
      case "project_tree": return (args?.relativePath === "src" ? fixtureTree.filter((entry) => entry.path.startsWith("src/")) : fixtureTree.filter((entry) => !entry.path.includes("/"))) as T;
      case "search_project": return [{ path: "src/radar.py", line: 3, snippet: "def calculate_range(t, c=3e8):" }] as T;
      case "search_project_files": return fixtureTree.filter((entry) => !entry.is_dir && entry.path.includes(String(args?.query ?? ""))).map((entry) => entry.path) as T;
      case "read_project_file": return "def calculate_range(t, c=3e8):\n    return c * t / 2\n" as T;
      case "list_attachments": return (visualFixtureMode === "attachments" ? [this.attachment] : []) as T;
      case "inspect_attachment": return this.attachment as T;
      case "save_pasted_image": return { ...this.attachment, name: String(args?.name ?? "screenshot.png"), mime: String(args?.mime ?? "image/png") } as T;
      case "load_attachment_data": return "" as T;
      case "remove_attachment": return undefined as T;
      case "start_backend":
        if (visualFixtureMode === "backend-recoverable-error" && this.backendStarts++ === 0) throw new Error("fixture backend unavailable");
        return undefined as T;
      case "restart_backend":
        this.backendStarts += 1;
        return undefined as T;
      case "stop_backend": return undefined as T;
      default: throw new Error(`Unsupported visual fixture command: ${command}`);
    }
  }

  async open(): Promise<string | string[] | null> {
    return null;
  }
}

const tauriAdapter: PlatformAdapter = {
  invoke: tauriInvoke,
  open: tauriOpen,
};

export const platform: PlatformAdapter = visualFixtureMode ? new VisualFixtureAdapter() : tauriAdapter;
