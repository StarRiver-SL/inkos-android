import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CircleDot, Loader2, Network, Search, SlidersHorizontal } from "lucide-react";
import { fetchJson } from "../../hooks/use-api";
import { cn } from "../../lib/utils";
import { roleFromPath } from "../../lib/truth-display";
import { useChatStore } from "../../store/chat";

interface PlayEntity {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly summary?: string;
  readonly status?: string;
}

interface PlayEdge {
  readonly id: string;
  readonly fromId: string;
  readonly type: string;
  readonly toId: string;
  readonly validUntilEventId?: string | null;
  readonly strength?: number | null;
}

interface PlayGraph {
  readonly entities: ReadonlyArray<PlayEntity>;
  readonly edges: ReadonlyArray<PlayEdge>;
}

interface TruthFileContent {
  readonly name: string;
  readonly content: string;
}

interface PlayRunResponse {
  readonly title?: string;
  readonly graph?: PlayGraph;
}

export interface RelationshipGraphNode {
  readonly id: string;
  readonly label: string;
  readonly type: string;
  readonly summary?: string;
  readonly status?: string;
  readonly degree: number;
  readonly x: number;
  readonly y: number;
}

export interface RelationshipGraphEdge {
  readonly id: string;
  readonly fromId: string;
  readonly toId: string;
  readonly type: string;
  readonly strength?: number;
}

export interface RelationshipGraphModel {
  readonly nodes: ReadonlyArray<RelationshipGraphNode>;
  readonly edges: ReadonlyArray<RelationshipGraphEdge>;
  readonly hiddenEdges: number;
  readonly typeCounts: ReadonlyArray<{ readonly type: string; readonly count: number }>;
}

const W = 640;
const H = 420;
const CX = W / 2;
const CY = H / 2;
const RELATION_ROLE_TYPES = new Set(["relation", "relationship", "support", "supports", "opposes", "threatens"]);
const ROLE_RUNTIME_START = "<!-- INKOS:ROLE_RUNTIME_STATE_START -->";
const ROLE_RUNTIME_END = "<!-- INKOS:ROLE_RUNTIME_STATE_END -->";
const RELATION_LINE_PATTERN = /关系|敌对|冲突|盟友|同盟|对手|怀疑|信任|背叛|合作|支持|反对|relationship|alliance|ally|enemy|trust|doubt|supports?|opposes?/i;
const COLOR_BY_TYPE: Record<string, string> = {
  actor: "fill-sky-500/18 stroke-sky-500 text-sky-700 dark:text-sky-200",
  location: "fill-emerald-500/16 stroke-emerald-500 text-emerald-700 dark:text-emerald-200",
  item: "fill-amber-500/18 stroke-amber-500 text-amber-700 dark:text-amber-200",
  clue: "fill-fuchsia-500/15 stroke-fuchsia-500 text-fuchsia-700 dark:text-fuchsia-200",
  evidence: "fill-rose-500/15 stroke-rose-500 text-rose-700 dark:text-rose-200",
};

function bookActorId(name: string): string {
  return `book-actor:${name.trim().toLowerCase()}`;
}

function cleanRelationMember(value: string): string {
  return value
    .replace(/^[#>*\-\d.\s]+/, "")
    .replace(/(?:三角|四角|多角)(?:关系)?$/, "")
    .replace(/[：:。；;，,]+$/, "")
    .trim();
}

function relationTypeFromLine(line: string, fallback = "关系"): string {
  const prefix = line.match(/^([^：:（）()]{2,18}(?:关系|同盟|冲突|合作|敌对|信任|怀疑))/)?.[1];
  if (prefix) return prefix.trim();
  const verb = line.match(/(敌对|冲突|同盟|盟友|合作|支持|反对|怀疑|信任|背叛|威胁|保护|雇佣|亲属|朋友|恋人)/)?.[1];
  return verb ?? fallback;
}

function addBookEdge(
  entities: Map<string, PlayEntity>,
  edges: Map<string, PlayEdge>,
  fromName: string,
  toName: string,
  type: string,
  summary?: string,
): void {
  const from = cleanRelationMember(fromName);
  const to = cleanRelationMember(toName);
  if (!from || !to || from === to) return;
  const fromId = bookActorId(from);
  const toId = bookActorId(to);
  if (!entities.has(fromId)) entities.set(fromId, { id: fromId, type: "actor", label: from });
  if (!entities.has(toId)) entities.set(toId, { id: toId, type: "actor", label: to });
  const normalizedType = type.trim() || "关系";
  const edgeId = `book-edge:${fromId}:${normalizedType}:${toId}`;
  if (!edges.has(edgeId)) {
    edges.set(edgeId, {
      id: edgeId,
      fromId,
      toId,
      type: normalizedType,
      strength: 1.6,
      value: { role: "relationship", summary },
    } as PlayEdge);
  }
}

function parseFocusRelationshipLines(
  content: string,
  entities: Map<string, PlayEntity>,
  edges: Map<string, PlayEdge>,
): void {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const group = line.match(/^(?:[-*]\s*)?([^（(]{1,24}?关系[^（(]*)[（(]([^）)]+)[）)]/);
    if (!group) continue;
    const relationType = cleanRelationMember(group[1]) || "关系";
    const members = group[2]
      .split(/\s*(?:-|—|–|→|↔|、|,|，|\/)\s*/)
      .map(cleanRelationMember)
      .filter(Boolean);
    for (let index = 0; index < members.length - 1; index += 1) {
      addBookEdge(entities, edges, members[index], members[index + 1], relationType, line);
    }
  }
}

function runtimeBlock(content: string): string {
  const start = content.indexOf(ROLE_RUNTIME_START);
  const end = content.indexOf(ROLE_RUNTIME_END);
  return start >= 0 && end > start
    ? content.slice(start + ROLE_RUNTIME_START.length, end)
    : content;
}

export function buildTruthRelationshipGraph(
  files: ReadonlyArray<TruthFileContent>,
): PlayGraph {
  const entities = new Map<string, PlayEntity>();
  const edges = new Map<string, PlayEdge>();
  const roles = files
    .map((file) => ({ file, role: roleFromPath(file.name) }))
    .filter((item): item is { file: TruthFileContent; role: NonNullable<ReturnType<typeof roleFromPath>> } => item.role !== null);

  for (const { role } of roles) {
    entities.set(bookActorId(role.name), {
      id: bookActorId(role.name),
      type: "actor",
      label: role.name,
      status: role.tier === "major" ? "主要角色" : "次要角色",
    });
  }

  const knownRoleNames = roles.map(({ role }) => role.name);
  for (const { file, role } of roles) {
    const lines = runtimeBlock(file.content)
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
      .filter((line) => line && RELATION_LINE_PATTERN.test(line));
    for (const line of lines) {
      const targets = knownRoleNames.filter((name) => name !== role.name && line.includes(name));
      for (const target of targets) {
        addBookEdge(entities, edges, role.name, target, relationTypeFromLine(line), line);
      }
    }
  }

  for (const file of files.filter((item) => item.name === "current_focus.md")) {
    parseFocusRelationshipLines(file.content, entities, edges);
  }

  return { entities: [...entities.values()], edges: [...edges.values()] };
}

export function mergeRelationshipGraphs(
  primary: PlayGraph | null | undefined,
  secondary: PlayGraph | null | undefined,
): PlayGraph {
  const entities = new Map<string, PlayEntity>();
  const edges = new Map<string, PlayEdge>();
  const actorIdByLabel = new Map<string, string>();

  for (const graph of [primary, secondary]) {
    if (!graph) continue;
    const remappedIds = new Map<string, string>();
    for (const entity of graph.entities) {
      const labelKey = entity.label.trim().toLowerCase();
      const existingActorId = entity.type === "actor" ? actorIdByLabel.get(labelKey) : undefined;
      const id = existingActorId ?? entity.id;
      remappedIds.set(entity.id, id);
      if (!entities.has(id)) entities.set(id, { ...entity, id });
      if (entity.type === "actor") actorIdByLabel.set(labelKey, id);
    }
    for (const edge of graph.edges) {
      const fromId = remappedIds.get(edge.fromId) ?? edge.fromId;
      const toId = remappedIds.get(edge.toId) ?? edge.toId;
      const id = `${edge.id}:${fromId}:${toId}`;
      if (!edges.has(id)) edges.set(id, { ...edge, id, fromId, toId });
    }
  }

  return { entities: [...entities.values()], edges: [...edges.values()] };
}

function edgeIsVisible(edge: PlayEdge): boolean {
  return edge.validUntilEventId == null && edge.fromId !== edge.toId;
}

function edgeHasRelationRole(edge: PlayEdge): boolean {
  if (RELATION_ROLE_TYPES.has(edge.type.toLowerCase())) return true;
  const value = (edge as { value?: unknown }).value;
  if (!value || typeof value !== "object") return false;
  const role = String((value as Record<string, unknown>).role ?? "").toLowerCase();
  return RELATION_ROLE_TYPES.has(role);
}

function matchesQuery(entity: PlayEntity, query: string): boolean {
  if (!query) return true;
  const haystack = [entity.label, entity.type, entity.summary, entity.status].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function buildRelationshipGraphModel(
  graph: PlayGraph | null | undefined,
  options: { readonly query?: string; readonly type?: string; readonly relationsOnly?: boolean } = {},
): RelationshipGraphModel {
  if (!graph) return { nodes: [], edges: [], hiddenEdges: 0, typeCounts: [] };

  const query = options.query?.trim() ?? "";
  const typeFilter = options.type?.trim() ?? "";
  const entityById = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const visibleEdges = graph.edges.filter(edgeIsVisible);
  const candidateEdges = options.relationsOnly ? visibleEdges.filter(edgeHasRelationRole) : visibleEdges;
  const connectedIds = new Set(candidateEdges.flatMap((edge) => [edge.fromId, edge.toId]));
  const includedEntities = graph.entities.filter((entity) =>
    connectedIds.has(entity.id)
    && (!typeFilter || entity.type === typeFilter)
    && matchesQuery(entity, query)
  );
  const includedIds = new Set(includedEntities.map((entity) => entity.id));
  const edges = candidateEdges
    .filter((edge) => includedIds.has(edge.fromId) && includedIds.has(edge.toId))
    .map((edge) => ({
      id: edge.id,
      fromId: edge.fromId,
      toId: edge.toId,
      type: edge.type,
      strength: typeof edge.strength === "number" ? edge.strength : undefined,
    }));

  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.fromId, (degree.get(edge.fromId) ?? 0) + 1);
    degree.set(edge.toId, (degree.get(edge.toId) ?? 0) + 1);
  }

  const orderedEntities = [...includedEntities].sort((a, b) =>
    (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.label.localeCompare(b.label),
  );
  const radiusX = Math.min(250, Math.max(110, 46 + orderedEntities.length * 9));
  const radiusY = Math.min(160, Math.max(82, 34 + orderedEntities.length * 5));
  const nodes = orderedEntities.map((entity, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(1, orderedEntities.length);
    const nodeDegree = degree.get(entity.id) ?? 0;
    const hubPull = Math.min(44, nodeDegree * 5);
    return {
      id: entity.id,
      label: entity.label,
      type: entity.type,
      summary: entity.summary,
      status: entity.status,
      degree: nodeDegree,
      x: CX + (radiusX - hubPull) * Math.cos(angle),
      y: CY + (radiusY - hubPull * 0.6) * Math.sin(angle),
    };
  });

  const typeCounter = new Map<string, number>();
  for (const entity of graph.entities) {
    if (connectedIds.has(entity.id)) typeCounter.set(entity.type, (typeCounter.get(entity.type) ?? 0) + 1);
  }
  const typeCounts = [...typeCounter.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  return { nodes, edges, hiddenEdges: candidateEdges.length - edges.length, typeCounts };
}

function truncate(value: string, max = 14): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}

function NodeBadge({ type, count, selected, onClick }: {
  readonly type: string;
  readonly count: number;
  readonly selected: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] leading-4 transition-colors",
        selected ? "border-primary/50 bg-primary/10 text-primary" : "border-border/30 bg-secondary/30 text-muted-foreground hover:text-foreground",
      )}
    >
      <CircleDot size={10} />
      <span>{type}</span>
      <span className="text-muted-foreground/70">{count}</span>
    </button>
  );
}

export function RelationshipGraph(props: {
  readonly source: "book" | "play";
  readonly bookId?: string | null;
  readonly sessionId: string | null;
  readonly onClose: () => void;
}) {
  const [run, setRun] = useState<PlayRunResponse | null>(null);
  const [truthGraph, setTruthGraph] = useState<PlayGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [relationsOnly, setRelationsOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playRefreshTick, setPlayRefreshTick] = useState(0);
  const bookDataVersion = useChatStore((state) => state.bookDataVersion);

  useEffect(() => {
    if (props.source !== "play") return;
    const timer = window.setInterval(() => setPlayRefreshTick((value) => value + 1), 2000);
    return () => window.clearInterval(timer);
  }, [props.source]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const runRequest = props.source === "play" && props.sessionId
      ? fetchJson<PlayRunResponse>(`/play/runs/${encodeURIComponent(props.sessionId)}/main`).catch(() => null)
      : Promise.resolve(null);
    const truthRequest = props.source === "book" && props.bookId
      ? fetchJson<{ files: ReadonlyArray<{ name: string }> }>(`/books/${props.bookId}/truth`)
      .then(async ({ files }) => {
        const names = files
          .map((file) => file.name)
          .filter((name) => name === "current_focus.md" || roleFromPath(name) !== null);
        const contents = await Promise.all(names.map(async (name) => {
          const detail = await fetchJson<{ content: string | null }>(
            `/books/${props.bookId!}/truth/${name}`,
          ).catch(() => ({ content: null }));
          return { name, content: detail.content ?? "" };
        }));
        return buildTruthRelationshipGraph(contents);
      })
      .catch(() => null)
      : Promise.resolve(null);

    Promise.all([runRequest, truthRequest])
      .then(([runData, bookGraph]) => {
        if (cancelled) return;
        setRun(runData);
        setTruthGraph(bookGraph);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bookDataVersion, playRefreshTick, props.bookId, props.sessionId, props.source]);

  const graph = useMemo(
    () => props.source === "book"
      ? mergeRelationshipGraphs(null, truthGraph)
      : mergeRelationshipGraphs(run?.graph, null),
    [props.source, run?.graph, truthGraph],
  );
  const model = useMemo(
    () => buildRelationshipGraphModel(graph, { query, type, relationsOnly }),
    [graph, query, type, relationsOnly],
  );
  const nodeById = useMemo(() => new Map(model.nodes.map((node) => [node.id, node])), [model.nodes]);
  const selected = selectedId ? nodeById.get(selectedId) ?? null : model.nodes[0] ?? null;

  useEffect(() => {
    if (selectedId && !nodeById.has(selectedId)) setSelectedId(null);
  }, [nodeById, selectedId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/20 px-3 py-2.5">
        <button
          onClick={props.onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          aria-label="返回"
        >
          <ArrowLeft size={14} />
        </button>
        <Network size={15} className="text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium leading-5">关系图谱</p>
          <p className="truncate text-[12px] leading-4 text-muted-foreground/70">
            {props.source === "book"
              ? "当前书籍角色关系"
              : run?.title || "当前互动世界"}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-b border-border/20 px-3 py-2.5">
        <div className="flex items-center gap-2 rounded-md border border-border/30 bg-secondary/25 px-2">
          <Search size={13} className="text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索角色、地点、线索"
            className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/50"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <NodeBadge type="全部" count={model.typeCounts.reduce((sum, item) => sum + item.count, 0)} selected={!type} onClick={() => setType("")} />
          {model.typeCounts.map((item) => (
            <NodeBadge key={item.type} type={item.type} count={item.count} selected={type === item.type} onClick={() => setType(item.type)} />
          ))}
          <button
            onClick={() => setRelationsOnly((value) => !value)}
            className={cn(
              "ml-auto flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] leading-4 transition-colors",
              relationsOnly ? "border-primary/50 bg-primary/10 text-primary" : "border-border/30 bg-secondary/30 text-muted-foreground hover:text-foreground",
            )}
          >
            <SlidersHorizontal size={11} />
            只看关系
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 size={17} className="animate-spin text-muted-foreground" />
          </div>
        ) : model.nodes.length === 0 ? (
          <div className="px-4 py-8 text-[14px] leading-6 text-muted-foreground/70">
            {props.source === "book"
              ? "尚未识别到书籍角色关系。章节结算或 current_focus.md 中的关系组生成后会自动显示。"
              : "尚未记录到互动关系。继续推进世界，角色、地点、物品和线索之间的连接会自动出现。"}
          </div>
        ) : (
          <div className="space-y-3 p-3">
            <div className="overflow-hidden rounded-lg border border-border/30 bg-background">
              <svg viewBox={`0 0 ${W} ${H}`} className="block aspect-[1.52] w-full" role="img" aria-label="关系图谱">
                <defs>
                  <marker id="relationship-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 Z" className="fill-muted-foreground/45" />
                  </marker>
                </defs>
                {model.edges.map((edge) => {
                  const from = nodeById.get(edge.fromId);
                  const to = nodeById.get(edge.toId);
                  if (!from || !to) return null;
                  return (
                    <g key={edge.id}>
                      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="stroke-muted-foreground/35" strokeWidth={Math.max(1.2, Math.min(3.2, edge.strength ?? 1.4))} markerEnd="url(#relationship-arrow)" />
                      <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 4} textAnchor="middle" fontSize="11" className="fill-muted-foreground">
                        {truncate(edge.type, 12)}
                      </text>
                    </g>
                  );
                })}
                {model.nodes.map((node) => {
                  const selectedNode = selected?.id === node.id;
                  const colors = COLOR_BY_TYPE[node.type] ?? "fill-secondary stroke-border text-foreground";
                  return (
                    <g
                      key={node.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedId(node.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") setSelectedId(node.id);
                      }}
                    >
                      <ellipse cx={node.x} cy={node.y} rx={selectedNode ? 58 : 50} ry={selectedNode ? 24 : 21} className={cn(colors, "transition-all")} strokeWidth={selectedNode ? 2.4 : 1.4} />
                      <text x={node.x} y={node.y - 2} textAnchor="middle" fontSize="12" fontWeight={700} className="fill-foreground">
                        {truncate(node.label)}
                      </text>
                      <text x={node.x} y={node.y + 12} textAnchor="middle" fontSize="10" className="fill-muted-foreground">
                        {node.type} · {node.degree}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            {model.hiddenEdges > 0 ? (
              <p className="text-[12px] leading-5 text-muted-foreground/70">已按当前筛选隐藏 {model.hiddenEdges} 条连接。</p>
            ) : null}
            {selected ? (
              <div className="rounded-lg border border-border/30 bg-secondary/20 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="min-w-0 truncate text-[15px] font-semibold leading-6">{selected.label}</h3>
                  <span className="shrink-0 rounded-md bg-background px-2 py-0.5 text-[12px] text-muted-foreground">{selected.type}</span>
                </div>
                {selected.status ? <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{selected.status}</p> : null}
                {selected.summary ? <p className="mt-1 text-[13px] leading-5 text-muted-foreground/80">{selected.summary}</p> : null}
                <div className="mt-2 space-y-1">
                  {model.edges
                    .filter((edge) => edge.fromId === selected.id || edge.toId === selected.id)
                    .map((edge) => {
                      const other = nodeById.get(edge.fromId === selected.id ? edge.toId : edge.fromId);
                      return (
                        <div key={edge.id} className="flex items-center gap-2 text-[12px] leading-5 text-muted-foreground">
                          <span className="rounded bg-background px-1.5 py-0.5 text-foreground">{edge.type}</span>
                          <span className="min-w-0 truncate">{other?.label ?? edge.toId}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
