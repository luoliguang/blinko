import { observer } from "mobx-react-lite";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useDebounceValue, useMediaQuery } from "usehooks-ts";
import { useTheme } from "next-themes";
import { Button, Tooltip } from "@heroui/react";
import { api } from "@/lib/trpc";
import { helper } from "@/lib/helper";
import dayjs from "@/lib/dayjs";
import { NoteContent } from "@/components/BlinkoCard/noteContent";
import { UserAvatar } from "@/components/BlinkoCard/commentButton";
import { RootStore } from "@/store";
import { BlinkoStore } from "@/store/blinkoStore";
import { UserStore } from "@/store/user";
import { ScrollArea } from "@/components/Common/ScrollArea";
import { LoadingAndEmpty } from "@/components/Common/LoadingAndEmpty";
import { Icon } from "@/components/Common/Iconify/icons";

const PAGE_SIZE = 50;

// Owner's GitHub project, linked from the public header.
const GITHUB_URL = "https://github.com/luoliguang/blinko";

// First non-tag line of the note, stripped of a leading markdown heading marker.
function getTitle(content?: string) {
  const line = (content ?? "").split("\n").find((l) => l.trim() && !helper.regex.isContainHashTag.test(l)) ?? "";
  return line.replace(/^#+\s*/, "").trim() || "";
}

// Rough reading stats: CJK characters count one each, other words count one each.
function readingStats(content?: string) {
  const text = (content ?? "").replace(/!\[[^\]]*\]\([^)]*\)|\]\([^)]*\)|[#>*_`~|-]/g, " ");
  const words = (text.match(/[㐀-鿿]/g)?.length ?? 0) + (text.replace(/[㐀-鿿]/g, " ").match(/[A-Za-z0-9]+/g)?.length ?? 0);
  return { words, minutes: Math.max(1, Math.round(words / 400)) };
}

const HEATMAP_WEEKS = 26;

type ReadMode = "normal" | "light" | "full";

function setMeta(name: string, content: string, property = false) {
  const attr = property ? "property" : "name";
  let el = document.head.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.content = content;
}

// Memoized so TOC active-highlight re-renders (activeHeading state) don't re-render
// the markdown body and reset the reader's scroll position.
const ReaderBody = memo(({ note, blinko }: { note: any; blinko: any }) => (
  <div data-reader-content>
    <NoteContent blinkoItem={note} blinko={blinko} isExpanded isShareMode />
  </div>
));

const PublicHome = observer(() => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isPc = useMediaQuery("(min-width: 768px)");
  const blinko = RootStore.Get(BlinkoStore);
  const { resolvedTheme, setTheme } = useTheme();

  // Visitor light/dark switch. Saved to the same `userTheme` key the app reads
  // at startup, so the choice sticks across reloads (and into the app after login,
  // until the account's own theme setting takes over).
  const toggleTheme = () => {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("userTheme", next);
    RootStore.Get(UserStore).updatePWAColor(next);
  };

  const [site, setSite] = useState<{ id?: number; name?: string; image?: string; description?: string } | null>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [authorFilter, setAuthorFilter] = useState<number | null>(null);
  // Reading mode (desktop): "normal" full layout, "light" keeps only the note-title
  // list on the left (hides the widgets), "full" collapses the left entirely.
  // light + full share the enhanced TOC, progress bar and larger article type.
  const [readMode, setReadMode] = useState<ReadMode>(() => {
    const v = localStorage.getItem("plaza-readmode");
    return v === "light" || v === "full" ? v : "normal";
  });
  const focused = readMode !== "normal";
  const [progress, setProgress] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounceValue(search.trim(), 350);
  const [activeHeading, setActiveHeading] = useState(0);
  const [stats, setStats] = useState<{ posts: { id: number; t: number; a: number }[]; authors: any[] } | null>(null);

  // Everything below derives from the full public index (stats), not the loaded
  // page, and respects the author filter — so counts, heatmap, random,
  // on-this-day and prev/next always agree with each other.
  const scopedPosts = useMemo(
    () => (stats?.posts ?? []).filter((p) => authorFilter == null || p.a === authorFilter),
    [stats, authorFilter],
  );

  // Contributor wall: every public author with their all-time post count.
  const authors = useMemo(() => {
    const counts = new Map<number, number>();
    for (const p of stats?.posts ?? []) counts.set(p.a, (counts.get(p.a) ?? 0) + 1);
    return (stats?.authors ?? [])
      .map((a) => ({ id: a.id, name: a.nickname || a.name || t("anonymous"), image: a.image, count: counts.get(a.id) ?? 0 }))
      .sort((x, y) => y.count - x.count);
  }, [stats, t]);

  const monthCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of scopedPosts) {
      const k = dayjs(p.t).format("YYYY-MM");
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [scopedPosts]);

  // Day buckets in the visitor's local time (UTC bucketing shifts dates).
  const dayBuckets = useMemo(() => {
    const m = new Map<string, { count: number; latestId: number }>();
    for (const p of scopedPosts) {
      const k = dayjs(p.t).format("YYYY-MM-DD");
      const b = m.get(k);
      if (b) b.count++;
      else m.set(k, { count: 1, latestId: p.id });
    }
    return m;
  }, [scopedPosts]);

  // Posts written on today's month-day in earlier years, newest first.
  const onThisDay = useMemo(() => {
    const today = dayjs();
    return scopedPosts.filter((p) => {
      const d = dayjs(p.t);
      return d.format("MM-DD") === today.format("MM-DD") && d.year() < today.year();
    });
  }, [scopedPosts]);

  // Reading order for prev/next: search results when searching, else the full index.
  const sequence = debouncedSearch ? notes.map((n) => n.id) : scopedPosts.map((p) => p.id);
  const seqIdx = selected ? sequence.indexOf(selected.id) : -1;
  const newerId = seqIdx > 0 ? sequence[seqIdx - 1] : null;
  const olderId = seqIdx >= 0 && seqIdx < sequence.length - 1 ? sequence[seqIdx + 1] : null;

  // Notes come back filtered and newest-first, so consecutive runs share a month.
  const monthGroups: { key: string; notes: any[] }[] = [];
  for (const n of notes) {
    const key = dayjs(n.createdAt).format("YYYY-MM");
    const last = monthGroups[monthGroups.length - 1];
    if (last?.key === key) last.notes.push(n);
    else monthGroups.push({ key, notes: [n] });
  }

  // Table of contents parsed from the selected note's markdown headings.
  const toc = useMemo(() => {
    const out: { level: number; text: string }[] = [];
    for (const line of (selected?.content ?? "").split("\n")) {
      const m = /^(#{1,4})\s+(.+?)\s*#*$/.exec(line.trim());
      if (m) out.push({ level: m[1].length, text: m[2].replace(/[*`~]/g, "").trim() });
    }
    return out;
  }, [selected?.content]);

  useEffect(() => {
    api.public.siteInfo.query({}).then(setSite).catch(() => {});
    api.notes.publicPlazaStats.query().then(setStats).catch(() => {});
  }, []);

  // Page title/description follow the open note (tab title, bookmarks); the
  // server injects the same into shared /?note= links for crawler previews.
  useEffect(() => {
    const plaza = t("public-plaza-title");
    const noteTitle = selected ? getTitle(selected.content) : "";
    const title = noteTitle ? `${noteTitle} · ${plaza}` : plaza;
    const desc = site?.description || t("public-cta-desc");
    document.title = title;
    setMeta("description", desc);
    setMeta("og:title", title, true);
    setMeta("og:description", desc, true);
  }, [site, selected, t]);

  const authorName = (acc: any) => acc?.nickname || acc?.name || t("anonymous");

  // Open a note and reflect it in the URL so the view is shareable and survives reload.
  const selectNote = (note: any) => {
    setSelected(note);
    setSearchParams({ note: String(note.id) });
  };

  // Open by id, fetching it when it isn't in the loaded page (deep link,
  // random, on-this-day, heatmap, prev/next beyond the loaded range).
  const openById = async (id: number) => {
    const note = notes.find((n) => n.id === id) ?? (await api.notes.publicNoteById.query({ id }).catch(() => null));
    if (note) selectNote(note);
  };

  // Server-side filtering/search/paging; a sequence number drops stale responses
  // when the filter changes while a request is in flight.
  const reqSeq = useRef(0);
  const loadPage = async (p: number) => {
    const seq = ++reqSeq.current;
    const list = await api.notes.publicList.mutate({
      page: p,
      size: PAGE_SIZE,
      orderBy: "created",
      searchText: debouncedSearch,
      ...(authorFilter != null && { accountId: authorFilter }),
    });
    if (seq !== reqSeq.current) return list;
    setNotes((prev) => (p === 1 ? list : [...prev, ...list.filter((n) => !prev.some((x) => x.id === n.id))]));
    setHasMore(list.length === PAGE_SIZE);
    setPage(p);
    setLoading(false);
    return list;
  };

  const initialized = useRef(false);
  useEffect(() => {
    setLoading(true);
    loadPage(1).then((list) => {
      if (initialized.current) return;
      initialized.current = true;
      const deepLinkId = Number(searchParams.get("note"));
      if (deepLinkId) openById(deepLinkId);
      else if (isPc && list.length) setSelected(list[0]);
    });
  }, [authorFilter, debouncedSearch]);

  // A newly opened note starts at its top, not at the previous note's scroll offset.
  useEffect(() => {
    const root = document.querySelector("[data-reader-content]")?.closest(".scroll-area") as HTMLElement | null;
    root?.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [selected?.id]);

  // Reading progress (0–100) of the open article, for the focus-mode progress
  // bar and TOC percentage. Polls because the markdown renders asynchronously.
  useEffect(() => {
    setProgress(0);
    if (!selected) return;
    let root: HTMLElement | null = null;
    let onScroll: (() => void) | null = null;
    let tries = 0;
    const poll = setInterval(() => {
      tries++;
      const el = document.querySelector("[data-reader-content]")?.closest(".scroll-area") as HTMLElement | null;
      if (el) {
        clearInterval(poll);
        root = el;
        onScroll = () => {
          const max = root!.scrollHeight - root!.clientHeight;
          setProgress(max > 2 ? Math.min(100, Math.round((root!.scrollTop / max) * 100)) : 100);
        };
        root.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
      } else if (tries > 25) clearInterval(poll);
    }, 100);
    return () => {
      clearInterval(poll);
      if (root && onScroll) root.removeEventListener("scroll", onScroll);
    };
  }, [selected?.id]);

  // Remember the reading mode across reloads, and let Esc return to normal.
  useEffect(() => {
    localStorage.setItem("plaza-readmode", readMode);
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setReadMode("normal");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readMode, focused]);

  const openRandom = () => {
    const pool = scopedPosts.filter((p) => p.id !== selected?.id);
    if (pool.length) openById(pool[Math.floor(Math.random() * pool.length)].id);
  };

  // Three-way reading-mode switch (desktop, when a note is open).
  const modeToggle = isPc && selected && (
    <div className="flex items-center gap-0.5 rounded-full bg-hover p-0.5">
      {([
        ["normal", "tabler:layout-sidebar-left-expand", t("mode-normal")],
        ["light", "tabler:list", t("mode-light")],
        ["full", "tabler:book", t("mode-full")],
      ] as const).map(([m, icon, label]) => (
        <Tooltip key={m} content={label} placement="bottom" closeDelay={0}>
          <button
            aria-label={label}
            onClick={() => setReadMode(m)}
            className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
              readMode === m ? "bg-background text-primary shadow-sm" : "text-desc hover:text-foreground"
            }`}
          >
            <Icon icon={icon} width="17" height="17" />
          </button>
        </Tooltip>
      ))}
    </div>
  );

  const authButtons = (
    <div className="flex items-center gap-2">
      {modeToggle}
      {scopedPosts.length > 1 && (
        <Tooltip content={t("random-note")} placement="bottom" closeDelay={0}>
          <Button size="sm" radius="full" variant="light" isIconOnly aria-label={t("random-note")} onPress={openRandom}>
            <Icon icon="tabler:dice-5" width="20" height="20" />
          </Button>
        </Tooltip>
      )}
      <Tooltip content={resolvedTheme === "dark" ? t("light-mode") : t("dark-mode")} placement="bottom" closeDelay={0}>
        <Button
          size="sm"
          radius="full"
          variant="light"
          isIconOnly
          aria-label={resolvedTheme === "dark" ? t("light-mode") : t("dark-mode")}
          onPress={toggleTheme}
        >
          <Icon icon={resolvedTheme === "dark" ? "tabler:sun" : "tabler:moon"} width="20" height="20" />
        </Button>
      </Tooltip>
      <Tooltip content={t("github-cta")} placement="bottom" closeDelay={0}>
        <Button size="sm" radius="full" variant="light" isIconOnly aria-label={t("github-cta")} onPress={() => window.open(GITHUB_URL, "_blank", "noopener")}>
          <Icon icon="tabler:brand-github" width="20" height="20" />
        </Button>
      </Tooltip>
      <Button size="sm" radius="full" variant="bordered" onPress={() => navigate("/signin")}>
        {t("sign-in")}
      </Button>
      <Button size="sm" radius="full" color="primary" onPress={() => navigate("/signup")}>
        {t("sign-up")}
      </Button>
    </div>
  );

  // Reusable search box (shared by the full and the light-mode header).
  const searchBox = (
    <div className="flex items-center gap-2 bg-hover rounded-lg px-2.5 h-8">
      <Icon icon="tabler:search" width="15" height="15" className="text-desc shrink-0" />
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("search-notes-placeholder")}
        className="bg-transparent outline-none text-xs w-full placeholder:text-desc"
      />
      {search && (
        <button onClick={() => setSearch("")} aria-label={t("clear")} className="shrink-0 text-desc hover:text-foreground">
          <Icon icon="tabler:x" width="14" height="14" />
        </button>
      )}
    </div>
  );

  // 上 (fixed): plaza intro.
  const plazaHeader = (
    <div className="shrink-0 p-4 border-b border-hover">
      <div className="flex items-center gap-3">
        <UserAvatar account={{ image: site?.image }} guestName={site?.name} size={44} />
        <div className="min-w-0">
          <div className="text-base font-bold truncate">{t("public-plaza-title")}</div>
          {site?.name && <div className="text-xs text-desc truncate">{t("plaza-hosted-by", { name: site.name })}</div>}
        </div>
      </div>
      <div className="text-xs text-desc leading-relaxed mt-2 line-clamp-2">{site?.description || t("plaza-welcome")}</div>
      <div className="mt-3">{searchBox}</div>
    </div>
  );

  // Writing heatmap for the last HEATMAP_WEEKS weeks (Sunday-start columns,
  // today in the last one). Click a day to open its latest note.
  const heatmapDays = useMemo(() => {
    const today = dayjs().startOf("day");
    const start = today.subtract((HEATMAP_WEEKS - 1) * 7 + today.day(), "day");
    return Array.from({ length: HEATMAP_WEEKS * 7 }, (_, i) => {
      const d = start.add(i, "day");
      const key = d.format("YYYY-MM-DD");
      return { key, future: d.isAfter(today), ...(dayBuckets.get(key) ?? { count: 0, latestId: 0 }) };
    });
  }, [dayBuckets]);
  const heatmapTotal = heatmapDays.reduce((s, d) => s + d.count, 0);
  const heatColor = (c: number) =>
    c === 0 ? "bg-hover" : c === 1 ? "bg-primary/30" : c === 2 ? "bg-primary/55" : c <= 4 ? "bg-primary/80" : "bg-primary";

  const heatmap = isPc && stats && (
    <div className="mb-3">
      <div className="text-xs text-desc mb-1.5">{t("heatmap-title", { count: heatmapTotal })}</div>
      <div
        className="grid grid-flow-col gap-[2px]"
        style={{ gridTemplateRows: "repeat(7, minmax(0, 1fr))", gridTemplateColumns: `repeat(${HEATMAP_WEEKS}, minmax(0, 1fr))` }}
      >
        {heatmapDays.map((d) =>
          d.future ? (
            <div key={d.key} />
          ) : (
            <div
              key={d.key}
              title={t("heatmap-day", { date: d.key, count: d.count })}
              onClick={() => d.latestId && openById(d.latestId)}
              className={`aspect-square rounded-[2px] ${heatColor(d.count)} ${d.count ? "cursor-pointer hover:ring-1 hover:ring-primary" : ""}`}
            />
          ),
        )}
      </div>
    </div>
  );

  // 下 (fixed): activity heatmap + GitHub-style contributor wall. Click an avatar
  // to filter everything to that author; most-active first, the host gets a crown.
  const contributorWall = authors.length > 0 && (
    <div className="shrink-0 border-t border-hover p-3">
      {heatmap}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-desc">{t("plaza-participants", { count: authors.length })}</span>
        {authorFilter != null && (
          <button onClick={() => setAuthorFilter(null)} className="flex items-center gap-0.5 text-xs text-primary hover:opacity-80">
            <Icon icon="tabler:x" width="12" height="12" />
            {t("all-authors")}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2 max-h-[108px] overflow-y-auto hide-scrollbar px-1 pt-1.5 pb-0.5">
        {authors.map((a) => {
          const isActive = authorFilter === a.id;
          const isHost = site?.id != null && a.id === site.id;
          return (
            <button
              key={a.id}
              onClick={() => setAuthorFilter(isActive ? null : a.id)}
              title={t("author-post-count", { name: a.name, count: a.count })}
              className={`relative shrink-0 rounded-full transition-transform hover:scale-110 ${isActive ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
            >
              <UserAvatar account={{ image: a.image }} guestName={a.name} size={28} />
              {isHost && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-background flex items-center justify-center">
                  <Icon icon="tabler:crown" width="10" height="10" className="text-warning" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  const noteRow = (note: any) => {
    const active = selected?.id === note.id;
    return (
      <div
        key={note.id}
        onClick={() => selectNote(note)}
        className={`px-4 py-3 border-b border-hover cursor-pointer transition-colors ${active ? "bg-primary/10" : "hover:bg-hover"}`}
      >
        <div className={`text-sm font-medium truncate ${active ? "text-primary" : ""}`}>{getTitle(note.content) || t("untitled")}</div>
        <div className="flex items-center gap-1.5 mt-1.5 text-xs text-desc">
          <UserAvatar account={{ image: note.account?.image }} guestName={authorName(note.account)} size={16} />
          <span className="truncate max-w-[110px]">{authorName(note.account)}</span>
          <span>·</span>
          <span className="shrink-0">{dayjs(note.createdAt).format("MM-DD")}</span>
        </div>
      </div>
    );
  };

  // Slim header for light mode: plaza name + exit shortcut, and the search box
  // (dropped only the description/widgets), so the note titles get the room.
  const compactHeader = (
    <div className="shrink-0 px-4 py-3 border-b border-hover">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold truncate">{t("public-plaza-title")}</span>
        <button onClick={() => setReadMode("normal")} className="shrink-0 text-desc hover:text-foreground" aria-label={t("mode-normal")}>
          <Icon icon="tabler:layout-sidebar-left-expand" width="16" height="16" />
        </button>
      </div>
      <div className="mt-2.5">{searchBox}</div>
    </div>
  );

  // Left panel. In "light" mode it is stripped to just the note-title list
  // (no search, on-this-day, heatmap or contributor wall).
  const renderList = (compact: boolean) => (
    <div className="flex flex-col flex-1 min-h-0">
      {compact ? compactHeader : plazaHeader}
      <ScrollArea className="flex-1 min-h-0" onBottom={() => hasMore && loadPage(page + 1)}>
        {!compact && onThisDay.length > 0 && !debouncedSearch && (
          <button
            onClick={() => openById(onThisDay[0].id)}
            className="w-full flex items-center gap-2 px-4 py-2 text-left text-xs text-primary bg-primary/10 hover:bg-primary/15 border-b border-hover"
          >
            <Icon icon="tabler:calendar-heart" width="15" height="15" className="shrink-0" />
            <span className="truncate">
              {t("on-this-day", { years: dayjs().year() - dayjs(onThisDay[0].t).year(), count: onThisDay.length })}
            </span>
          </button>
        )}
        <LoadingAndEmpty isLoading={loading} isEmpty={!loading && notes.length === 0} />
        {monthGroups.map((g) => (
          <div key={g.key}>
            {/* z-20 + opaque: HeroUI avatar images carry `relative z-10`, which
                would otherwise paint over this sticky header while scrolling. */}
            <div className="sticky top-0 z-20 flex items-center justify-between px-4 py-1.5 text-xs font-medium text-desc bg-background border-b border-hover">
              <span>{dayjs(g.key + "-01").format(t("month-format"))}</span>
              {/* Full-month total from the index; search results only know what's loaded. */}
              <span className="font-normal">{debouncedSearch ? g.notes.length : monthCounts.get(g.key) ?? g.notes.length}</span>
            </div>
            {g.notes.map(noteRow)}
          </div>
        ))}
        {hasMore && (
          <div className="p-3 flex justify-center">
            <Button size="sm" variant="light" onPress={() => loadPage(page + 1)}>
              {t("load-more")}
            </Button>
          </div>
        )}
      </ScrollArea>
      {!compact && contributorWall}
    </div>
  );

  const ctaCard = (
    <div className="mt-4 bg-primary/10 rounded-2xl p-4 flex items-center justify-between gap-3">
      <div>
        <div className="text-sm font-medium text-primary">{t("public-cta-title")}</div>
        <div className="text-xs text-desc mt-1">{t("public-cta-desc")}</div>
      </div>
      <Button size="sm" radius="full" color="primary" className="shrink-0" onPress={() => navigate("/signup")}>
        {t("sign-up")}
      </Button>
    </div>
  );

  const readerPanel = (
    <ScrollArea className="flex-1 px-4 md:px-8 py-4">
      {selected ? (
        <div
          className={`max-w-3xl mx-auto ${
            focused ? "[&_.markdown-body]:!text-[17px] [&_.markdown-body]:!leading-[1.85]" : ""
          }`}
        >
          <div className="bg-background rounded-2xl p-4 md:p-6">
            <div className="flex items-center gap-2 mb-4">
              <UserAvatar account={{ image: selected.account?.image }} guestName={authorName(selected.account)} size={28} />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{authorName(selected.account)}</div>
                <div className="text-xs text-desc">
                  {dayjs(selected.createdAt).format("YYYY-MM-DD HH:mm")}
                  {" · "}
                  {t("reading-time", readingStats(selected.content))}
                </div>
              </div>
            </div>
            <ReaderBody note={selected} blinko={blinko} />
          </div>
          {(newerId || olderId) && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                { id: newerId, label: t("prev-note"), icon: "tabler:arrow-left", align: "items-start" },
                { id: olderId, label: t("next-note"), icon: "tabler:arrow-right", align: "items-end" },
              ].map(({ id, label, icon, align }) => {
                const loaded = id ? notes.find((n) => n.id === id) : null;
                return id ? (
                  <button
                    key={label}
                    onClick={() => openById(id)}
                    className={`flex flex-col ${align} gap-1 min-w-0 bg-background rounded-2xl px-4 py-3 hover:bg-hover transition-colors`}
                  >
                    <span className="flex items-center gap-1 text-xs text-desc">
                      {icon === "tabler:arrow-left" && <Icon icon={icon} width="13" height="13" />}
                      {label}
                      {icon === "tabler:arrow-right" && <Icon icon={icon} width="13" height="13" />}
                    </span>
                    {loaded && <span className="text-sm font-medium truncate max-w-full">{getTitle(loaded.content) || t("untitled")}</span>}
                  </button>
                ) : (
                  <div key={label} />
                );
              })}
            </div>
          )}
          {ctaCard}
          <div className="h-10" />
        </div>
      ) : (
        <div className="h-full flex items-center justify-center text-desc text-sm">{t("select-a-note")}</div>
      )}
    </ScrollArea>
  );

  const scrollToHeading = (idx: number) => {
    const wrap = document.querySelector("[data-reader-content]") as HTMLElement | null;
    const h = wrap?.querySelectorAll("h1,h2,h3,h4")[idx] as HTMLElement | undefined;
    const root = wrap?.closest(".scroll-area") as HTMLElement | null;
    if (h && root) {
      // Use an instant jump: the container's CSS smooth-scroll animation gets
      // cancelled by re-renders, so a smooth scrollTo would never land.
      root.scrollTo({ top: root.scrollTop + h.getBoundingClientRect().top - root.getBoundingClientRect().top - 12, behavior: "instant" as ScrollBehavior });
    }
  };

  // Right-side table of contents for the open article (desktop only). In focus
  // mode it becomes the reading companion: wider, larger, with a progress read-out
  // and the article title as a header.
  const tocPanel = (
    <div
      className={`shrink-0 border-l border-hover overflow-y-auto hide-scrollbar transition-[width] duration-300 ${
        focused ? "w-[280px] p-5" : "w-[200px] p-4"
      }`}
    >
      {focused && (
        <div className="text-sm font-bold mb-1 line-clamp-2 leading-snug">{getTitle(selected?.content) || t("untitled")}</div>
      )}
      <div className="flex items-center gap-1.5 text-desc mb-3 text-xs">
        <Icon icon="tabler:list" width={focused ? 15 : 14} height={focused ? 15 : 14} />
        {t("toc-title")}
        {focused && <span className="ml-auto tabular-nums text-primary font-medium">{progress}%</span>}
      </div>
      <div className={`flex flex-col ${focused ? "gap-0.5" : ""}`}>
        {toc.map((h, i) => {
          const active = activeHeading === i;
          return (
            <button
              key={i}
              onClick={() => { setActiveHeading(i); scrollToHeading(i); }}
              style={{ paddingLeft: `${(h.level - 1) * 12 + (focused ? 12 : 8)}px` }}
              title={h.text}
              className={`text-left leading-snug truncate border-l-2 transition-colors ${
                focused ? "text-sm py-1.5 pr-2 rounded-r-md" : "text-xs py-1"
              } ${
                active
                  ? `border-primary text-primary ${focused ? "font-medium bg-primary/10" : ""}`
                  : "border-transparent text-desc hover:text-foreground"
              }`}
            >
              {h.text}
            </button>
          );
        })}
      </div>
    </div>
  );

  // Highlight the heading currently near the top of the reader as it scrolls:
  // the active one is the last heading above a line ~80px below the reader top.
  useEffect(() => {
    setActiveHeading(0);
    if (!isPc || !selected || toc.length === 0) return;
    let root: HTMLElement | null = null;
    let onScroll: (() => void) | null = null;
    let tries = 0;
    // Markdown renders asynchronously; poll until the headings exist, then attach.
    const poll = setInterval(() => {
      tries++;
      const container = document.querySelector("[data-reader-content]") as HTMLElement | null;
      const headings = container ? (Array.from(container.querySelectorAll("h1,h2,h3,h4")) as HTMLElement[]) : [];
      if (headings.length > 0) {
        clearInterval(poll);
        root = (container!.closest(".scroll-area") as HTMLElement | null) ?? null;
        if (!root) return;
        onScroll = () => {
          const line = root!.getBoundingClientRect().top + 80;
          let idx = 0;
          headings.forEach((h, i) => {
            if (h.getBoundingClientRect().top <= line) idx = i;
          });
          setActiveHeading(idx);
        };
        root.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
      } else if (tries > 25) {
        clearInterval(poll);
      }
    }, 100);
    return () => {
      clearInterval(poll);
      if (root && onScroll) root.removeEventListener("scroll", onScroll);
    };
  }, [isPc, selected, toc.length]);

  return (
    <div className="h-mobile-full w-full flex flex-col bg-secondbackground">
        <div className="flex items-center justify-between px-4 md:px-6 h-14 shrink-0 bg-background border-b border-hover">
          <div className="flex items-center gap-2 min-w-0">
            <img src="/logo.png" alt="Blinko" className="w-7 h-7 rounded-lg" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
            {/* Phones: the header is full of buttons and the plaza intro below
                already shows the title, so keep just the logo here. */}
            <span className="hidden md:inline font-bold truncate">{t("public-plaza-title")}</span>
          </div>
          {authButtons}
        </div>

        {isPc ? (
          <div className="flex-1 flex min-h-0 w-full">
            {/* Left list collapses in focus mode; inner keeps its 300px so the
                content slides out cleanly instead of reflowing. */}
            <div
              className={`shrink-0 overflow-hidden bg-background transition-[width] duration-300 ${
                readMode === "full" ? "w-0 border-r-0" : "w-[300px] border-r border-hover"
              }`}
            >
              <div className="w-[300px] h-full flex flex-col">{renderList(readMode === "light")}</div>
            </div>
            {/* Focus mode gets a slim reading-progress bar above the article. */}
            <div className="flex-1 flex flex-col min-h-0">
              {focused && selected && (
                <div className="h-0.5 shrink-0 bg-hover">
                  <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${progress}%` }} />
                </div>
              )}
              {readerPanel}
            </div>
            {selected && toc.length > 0 && tocPanel}
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {selected ? (
              <>
                <div className="flex items-center gap-2 px-4 h-11 shrink-0 border-b border-hover">
                  <Button size="sm" variant="light" isIconOnly onPress={() => { setSelected(null); setSearchParams({}); }} aria-label={t("back")}>
                    <Icon icon="tabler:arrow-left" width="20" height="20" />
                  </Button>
                  <span className="text-sm font-medium truncate">{getTitle(selected.content)}</span>
                </div>
                {readerPanel}
              </>
            ) : (
              renderList(false)
            )}
          </div>
        )}
    </div>
  );
});

export default PublicHome;
