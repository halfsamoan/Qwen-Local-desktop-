export type ProjectTreeEntry = { path: string; is_dir: boolean };
export type ProjectSearchResult = { path: string };

const supportedFile = /(?:^|\/)(?:readme|license|project\.md|agents\.md)$|\.(?:py|cpp|c|h|hpp|rs|js|ts|tsx|jsx|java|md|txt|json|yaml|yml|toml|xml|csv|html|css|sql|sh|ini|cfg)$/i;
const anchors = ["project.md", "agents.md", "readme.md", "readme", "package.json", "pyproject.toml", "cargo.toml", "go.mod", "pom.xml", "build.gradle", "requirements.txt", "makefile", "dockerfile"];

function unique(paths: string[], limit: number) {
  return [...new Set(paths.filter((path) => path && supportedFile.test(path)))].slice(0, limit);
}

export function selectProjectContextPaths(selectedFile: string, explicit: string[], hits: ProjectSearchResult[], entries: ProjectTreeEntry[], limit = 5) {
  const requested = [selectedFile, ...explicit, ...(explicit.length ? [] : hits.map((hit) => hit.path))];
  if (explicit.length || hits.length) return unique(requested, limit);
  const fallback = entries
    .filter((entry) => !entry.is_dir && supportedFile.test(entry.path))
    .sort((left, right) => {
      const leftName = left.path.split("/").pop()?.toLowerCase() ?? "";
      const rightName = right.path.split("/").pop()?.toLowerCase() ?? "";
      const leftRank = anchors.indexOf(leftName);
      const rightRank = anchors.indexOf(rightName);
      return (leftRank < 0 ? anchors.length : leftRank) - (rightRank < 0 ? anchors.length : rightRank)
        || left.path.split("/").length - right.path.split("/").length
        || left.path.localeCompare(right.path);
    })
    .map((entry) => entry.path);
  return unique([...requested, ...fallback], limit);
}

export function buildProjectContext(name: string, rootPath: string, entries: ProjectTreeEntry[]) {
  const visibleTree = entries.slice(0, 120).map((entry) => `- ${entry.path}${entry.is_dir ? "/" : ""}`).join("\n") || "- (empty project)";
  return `[Active local project]\nName: ${name}\nRoot: ${rootPath}\nThe project is selected and available. Use the supplied tree and file contents; do not claim that no project is selected.\n\n[Visible project tree]\n${visibleTree}`;
}
