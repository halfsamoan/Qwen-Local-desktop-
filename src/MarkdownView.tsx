import { useRef } from "react";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";

function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  return <div className="code-block"><button type="button" onClick={() => void navigator.clipboard.writeText(ref.current?.innerText ?? "")}>Copy</button><pre ref={ref}>{children}</pre></div>;
}

export default function MarkdownView({ content }: { content: string }) {
  return <Markdown components={{ pre: CodeBlock }} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight, rehypeKatex]}>{content}</Markdown>;
}
