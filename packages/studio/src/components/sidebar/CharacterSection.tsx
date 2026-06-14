import { useEffect, useState } from "react";
import { ArrowRight, GitBranch, Sparkles, Users, ChevronDown } from "lucide-react";
import { useChatStore } from "../../store/chat";
import { fetchJson } from "../../hooks/use-api";
import { SidebarCard } from "./SidebarCard";
import { cn } from "../../lib/utils";
import { roleFromPath, type RoleRef } from "../../lib/truth-display";

interface CharacterInfo {
  name: string;
  fields: Record<string, string>;
}

function parseCharacterMatrix(md: string): CharacterInfo[] {
  const characters: CharacterInfo[] = [];
  // Split by ## headings (level 2 only)
  const sections = md.split(/^## /m).slice(1);
  for (const section of sections) {
    const lines = section.split("\n");
    const name = lines[0].trim();
    if (!name) continue;
    const fields: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const match = lines[i].match(/^-\s+\*\*(.+?)\*\*:\s*(.+)/);
      if (match) {
        fields[match[1]] = match[2].trim();
      }
    }
    characters.push({ name, fields });
  }
  return characters;
}

const ROLE_COLORS: Record<string, string> = {
  "主角": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "反派": "bg-red-500/15 text-red-600 dark:text-red-400",
  "盟友": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "配角": "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "提及": "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  "protagonist": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "antagonist": "bg-red-500/15 text-red-600 dark:text-red-400",
  "ally": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "minor": "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "mentioned": "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

function getRoleColor(role: string): string {
  const lower = role.toLowerCase().trim();
  for (const [key, color] of Object.entries(ROLE_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400";
}

const TIER_BADGE: Record<RoleRef["tier"], { label: string; color: string }> = {
  major: { label: "主要", color: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  minor: { label: "次要", color: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
};

interface RoleRuntimeSummary {
  readonly chapter: number | null;
  readonly stateLines: ReadonlyArray<string>;
  readonly relationLines: ReadonlyArray<string>;
}

interface RoleDisplayInfo {
  readonly ref: RoleRef;
  readonly runtime: RoleRuntimeSummary | null;
}

const ROLE_STATE_START = "<!-- INKOS:ROLE_RUNTIME_STATE_START -->";
const ROLE_STATE_END = "<!-- INKOS:ROLE_RUNTIME_STATE_END -->";
const RELATION_PATTERN = /关系|敌我|盟友|同盟|对手|怀疑|信任|背叛|合作|冲突|alliance|relationship|trust|doubt|ally|enemy|opposes|supports/i;

export function parseRoleRuntimeSummary(markdown: string): RoleRuntimeSummary | null {
  const start = markdown.indexOf(ROLE_STATE_START);
  const end = markdown.indexOf(ROLE_STATE_END);
  if (start < 0 || end <= start) return null;
  const block = markdown.slice(start + ROLE_STATE_START.length, end);
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const chapterLine = lines[0] ?? "";
  const chapter = Number.parseInt(chapterLine.match(/\d+/)?.[0] ?? "", 10);
  const details = lines.slice(1);
  const relationLines = details.filter((line) => RELATION_PATTERN.test(line));
  const stateLines = details.filter((line) => !RELATION_PATTERN.test(line));
  return {
    chapter: Number.isFinite(chapter) ? chapter : null,
    stateLines,
    relationLines,
  };
}

// Phase 5 layout: one file per character under roles/. Each entry opens the
// full (humanized) character sheet — no raw matrix parsing needed.
function RoleEntry({ role }: { readonly role: RoleRef }) {
  const openArtifact = useChatStore((s) => s.openArtifact);
  const badge = TIER_BADGE[role.tier];
  return (
    <button
      onClick={() => openArtifact(role.path)}
      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors text-left"
    >
      <Users size={16} className="shrink-0 text-muted-foreground/60" />
      <span className="text-[15px] leading-6 font-medium text-foreground font-['SimSun','Songti_SC','STSong',serif] flex-1 truncate">
        {role.name}
      </span>
      <span className={cn("text-[12px] px-1.5 py-0.5 rounded-full shrink-0", badge.color)}>
        {badge.label}
      </span>
    </button>
  );
}

function RoleOverview({ bookId, roles }: {
  readonly bookId: string;
  readonly roles: ReadonlyArray<RoleDisplayInfo>;
}) {
  const expanded = useChatStore((state) => state.roleOverviewExpandedByBook[bookId] ?? false);
  const setRoleOverviewExpanded = useChatStore((state) => state.setRoleOverviewExpanded);
  const major = roles.filter((role) => role.ref.tier === "major");
  const minor = roles.filter((role) => role.ref.tier === "minor");

  return (
    <div className="rounded-lg border border-border/25 bg-secondary/20">
      <button
        onClick={() => setRoleOverviewExpanded(bookId, !expanded)}
        className="flex w-full items-center gap-2 px-2.5 py-2.5 text-left transition-colors hover:bg-secondary/30"
      >
        <Users size={16} className="shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium leading-5 text-foreground">角色总览</p>
          <p className="truncate text-[12px] leading-4 text-muted-foreground/70">
            主要 {major.length} · 次要 {minor.length}
          </p>
        </div>
        <ArrowRight size={14} className={cn("text-muted-foreground/60 transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border/20 px-2.5 py-2.5">
          <RoleGroup title="主要角色" roles={major} />
          <RoleGroup title="次要角色" roles={minor} />
        </div>
      )}
    </div>
  );
}

function RoleGroup({ title, roles }: {
  readonly title: string;
  readonly roles: ReadonlyArray<RoleDisplayInfo>;
}) {
  if (roles.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="px-1 text-[12px] font-medium leading-4 text-muted-foreground/70">{title}</div>
      {roles.map((role) => <RoleEntry key={role.ref.path} role={role.ref} />)}
    </div>
  );
}

function ChapterSettlement({ roles }: { readonly roles: ReadonlyArray<RoleDisplayInfo> }) {
  const settled = selectLatestChapterSettlementRoles(roles);
  if (settled.length === 0) {
    return (
      <div className="rounded-lg bg-secondary/20 px-2.5 py-2 text-[13px] leading-5 text-muted-foreground/65">
        写完章节后，这里会显示本章涉及角色的状态和关系变化。
      </div>
    );
  }

  const chapter = settled[0].runtime?.chapter;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-1 text-[12px] font-medium leading-4 text-muted-foreground/70">
        <Sparkles size={12} className="text-primary" />
        <span>{chapter ? `第 ${chapter} 章结算` : "最近角色结算"}</span>
      </div>
      {settled.slice(0, 5).map((role) => (
        <SettlementEntry key={role.ref.path} role={role} />
      ))}
    </div>
  );
}

export function selectLatestChapterSettlementRoles(
  roles: ReadonlyArray<RoleDisplayInfo>,
): ReadonlyArray<RoleDisplayInfo> {
  const settled = roles
    .filter((role) => role.runtime && (role.runtime.stateLines.length > 0 || role.runtime.relationLines.length > 0));
  const latestChapter = Math.max(...settled.map((role) => role.runtime?.chapter ?? 0));
  return settled
    .filter((role) => latestChapter <= 0 || role.runtime?.chapter === latestChapter)
    .sort((a, b) => a.ref.name.localeCompare(b.ref.name));
}

function SettlementEntry({ role }: { readonly role: RoleDisplayInfo }) {
  const openArtifact = useChatStore((s) => s.openArtifact);
  const badge = TIER_BADGE[role.ref.tier];
  const stateLines = role.runtime?.stateLines ?? [];
  const relationLines = role.runtime?.relationLines ?? [];
  return (
    <button
      onClick={() => openArtifact(role.ref.path)}
      className="w-full rounded-lg bg-secondary/25 px-2.5 py-2 text-left transition-colors hover:bg-secondary/45"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-foreground">
          {role.ref.name}
        </span>
        <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[11px]", badge.color)}>{badge.label}</span>
      </div>
      {stateLines.slice(0, 2).map((line) => (
        <p key={line} className="line-clamp-2 text-[13px] leading-5 text-muted-foreground">
          {line}
        </p>
      ))}
      {relationLines.slice(0, 2).map((line) => (
        <p key={line} className="mt-1 flex gap-1.5 text-[13px] leading-5 text-muted-foreground">
          <GitBranch size={12} className="mt-1 shrink-0 text-primary/80" />
          <span className="line-clamp-2">{line}</span>
        </p>
      ))}
    </button>
  );
}

function CharacterCard({ char }: { readonly char: CharacterInfo }) {
  const [expanded, setExpanded] = useState(false);
  const role = char.fields["定位"] ?? char.fields["Role"] ?? "";
  const tags = char.fields["标签"] ?? char.fields["Tags"] ?? "";
  const current = char.fields["当前"] ?? char.fields["Current"] ?? "";

  return (
    <div className="rounded-lg bg-secondary/30 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
      >
        <Users size={16} className="shrink-0 text-muted-foreground/60" />
        <span className="text-[15px] leading-6 font-medium text-foreground font-['SimSun','Songti_SC','STSong',serif] flex-1 truncate">
          {char.name}
        </span>
        {role && (
          <span className={cn("text-[12px] px-1.5 py-0.5 rounded-full shrink-0", getRoleColor(role))}>
            {role.split("/")[0].trim()}
          </span>
        )}
        <ChevronDown size={14} className={cn("text-muted-foreground/50 transition-transform shrink-0", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-1">
          {tags && (
            <p className="text-[14px] leading-6 text-muted-foreground"><span className="text-muted-foreground/60">标签</span> {tags}</p>
          )}
          {current && (
            <p className="text-[14px] leading-6 text-muted-foreground"><span className="text-muted-foreground/60">当前</span> {current}</p>
          )}
          {Object.entries(char.fields)
            .filter(([k]) => !["定位", "Role", "标签", "Tags", "当前", "Current"].includes(k))
            .map(([key, val]) => (
              <p key={key} className="text-[14px] leading-6 text-muted-foreground">
                <span className="text-muted-foreground/60">{key}</span> {val}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

interface CharacterSectionProps {
  readonly bookId: string;
}

export function CharacterSection({ bookId }: CharacterSectionProps) {
  const [roles, setRoles] = useState<ReadonlyArray<RoleDisplayInfo>>([]);
  const [legacyChars, setLegacyChars] = useState<CharacterInfo[]>([]);
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);

  useEffect(() => {
    let cancelled = false;
    setRoles([]);
    setLegacyChars([]);

    fetchJson<{ files: ReadonlyArray<{ name: string }> }>(`/books/${bookId}/truth`)
      .then(async (data) => {
        if (cancelled) return;
        const roleRefs = data.files
          .map((f) => roleFromPath(f.name))
          .filter((r): r is RoleRef => r !== null)
          .sort((a, b) =>
            a.tier === b.tier ? a.name.localeCompare(b.name) : a.tier === "major" ? -1 : 1,
          );

        // Phase 5 books expose one file per character under roles/.
        if (roleRefs.length > 0) {
          const roleDetails = await Promise.all(roleRefs.map(async (role) => {
            const detail = await fetchJson<{ content: string | null }>(
              `/books/${bookId}/truth/${role.path}`,
            ).catch(() => ({ content: null }));
            return { ref: role, runtime: parseRoleRuntimeSummary(detail.content ?? "") };
          }));
          if (!cancelled) setRoles(roleDetails);
          return;
        }

        // Pre-Phase-5 books only have the flat character_matrix.md table.
        const matrix = await fetchJson<{ content: string | null }>(
          `/books/${bookId}/truth/character_matrix.md`,
        ).catch(() => ({ content: null }));
        if (!cancelled && matrix.content) {
          setLegacyChars(parseCharacterMatrix(matrix.content));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRoles([]);
          setLegacyChars([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, bookDataVersion]);

  if (roles.length === 0 && legacyChars.length === 0) return null;

  return (
    <SidebarCard title="角色">
      <div className="space-y-1.5">
        {roles.length > 0 && (
          <>
            <RoleOverview bookId={bookId} roles={roles} />
            <ChapterSettlement roles={roles} />
          </>
        )}
        {roles.length > 0
          ? null
          : legacyChars.map((char) => <CharacterCard key={char.name} char={char} />)}
      </div>
    </SidebarCard>
  );
}
