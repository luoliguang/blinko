import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "usehooks-ts";
import { Button } from "@heroui/react";
import { api } from "@/lib/trpc";
import { helper } from "@/lib/helper";
import dayjs from "@/lib/dayjs";
import { NoteContent } from "@/components/BlinkoCard/noteContent";
import { UserAvatar } from "@/components/BlinkoCard/commentButton";
import { RootStore } from "@/store";
import { BlinkoStore } from "@/store/blinkoStore";
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

const PublicHome = observer(() => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isPc = useMediaQuery("(min-width: 768px)");
  const blinko = RootStore.Get(BlinkoStore);

  const [site, setSite] = useState<{ name?: string; image?: string; description?: string } | null>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [authorFilter, setAuthorFilter] = useState<number | null>(null);

  // Distinct authors among the loaded notes, used for the participant row and filter.
  const authors = useMemo(() => {
    const map = new Map<number, { id: number; name: string; image?: string }>();
    for (const n of notes) {
      const a = n.account;
      if (a?.id != null && !map.has(a.id)) {
        map.set(a.id, { id: a.id, name: a.nickname || a.name || t("anonymous"), image: a.image });
      }
    }
    return [...map.values()];
  }, [notes, t]);

  const displayedNotes = authorFilter == null ? notes : notes.filter((n) => n.account?.id === authorFilter);

  useEffect(() => {
    api.public.siteInfo.query({}).then(setSite).catch(() => {});
  }, []);

  // This page is the site's public front door, so give it a real title and
  // description for the browser tab, search engines, and link previews.
  useEffect(() => {
    if (!site?.name) return;
    const title = t("public-plaza-title");
    const desc = site.description || t("public-cta-desc");
    document.title = title;
    setMeta("description", desc);
    setMeta("og:title", title, true);
    setMeta("og:description", desc, true);
  }, [site, t]);

  const byCreatedDesc = (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  const authorName = (acc: any) => acc?.nickname || acc?.name || t("anonymous");

  // Open a note and reflect it in the URL so the view is shareable and survives reload.
  const selectNote = (note: any) => {
    setSelected(note);
    setSearchParams({ note: String(note.id) });
  };

  const loadPage = async (p: number) => {
    const list = await api.notes.publicList.mutate({ page: p, size: PAGE_SIZE });
    const sorted = (p === 1 ? list : [...notes, ...list]).slice().sort(byCreatedDesc);
    setNotes(sorted);
    setHasMore(list.length === PAGE_SIZE);
    setPage(p);
    if (p === 1 && sorted.length) {
      const deepLinked = sorted.find((n) => String(n.id) === searchParams.get("note"));
      if (deepLinked) setSelected(deepLinked);
      else if (isPc) setSelected(sorted[0]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadPage(1);
  }, []);

  const authButtons = (
    <div className="flex items-center gap-2">
      <Button size="sm" radius="full" variant="light" isIconOnly aria-label="GitHub" onPress={() => window.open(GITHUB_URL, "_blank", "noopener")}>
        <Icon icon="tabler:brand-github" width="20" height="20" />
      </Button>
      <Button size="sm" radius="full" variant="bordered" onPress={() => navigate("/signin")}>
        {t("sign-in")}
      </Button>
      <Button size="sm" radius="full" color="primary" onPress={() => navigate("/signup")}>
        {t("sign-up")}
      </Button>
    </div>
  );

  const plazaHeader = (
    <div className="p-4 border-b border-hover">
      <div className="flex items-center gap-3">
        <UserAvatar account={{ image: site?.image }} guestName={site?.name} size={44} />
        <div className="min-w-0">
          <div className="text-base font-bold truncate">{t("public-plaza-title")}</div>
          {site?.name && <div className="text-xs text-desc truncate">{t("plaza-hosted-by", { name: site.name })}</div>}
        </div>
      </div>
      <div className="text-xs text-desc leading-relaxed mt-2 line-clamp-2">{site?.description || t("plaza-welcome")}</div>
      {authors.length > 0 && (
        <div className="flex items-center gap-2 mt-3">
          <div className="flex">
            {authors.slice(0, 4).map((a, i) => (
              <div key={a.id} style={{ marginLeft: i ? -7 : 0 }} className="rounded-full ring-2 ring-background">
                <UserAvatar account={{ image: a.image }} guestName={a.name} size={20} />
              </div>
            ))}
          </div>
          <span className="text-xs text-desc truncate">{t("plaza-participants", { count: authors.length })}</span>
        </div>
      )}
    </div>
  );

  const authorFilterRow = authors.length > 1 && (
    <div className="flex gap-2 px-3 py-2 overflow-x-auto hide-scrollbar border-b border-hover">
      <button
        onClick={() => setAuthorFilter(null)}
        className={`shrink-0 rounded-full px-3 py-1 text-xs transition-colors ${authorFilter == null ? "bg-primary/10 text-primary" : "text-desc hover:bg-hover"}`}
      >
        {t("all-authors")}
      </button>
      {authors.map((a) => (
        <button
          key={a.id}
          onClick={() => setAuthorFilter(a.id)}
          className={`shrink-0 flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors ${authorFilter === a.id ? "bg-primary/10 text-primary" : "text-desc hover:bg-hover"}`}
        >
          <UserAvatar account={{ image: a.image }} guestName={a.name} size={16} />
          <span className="max-w-[80px] truncate">{a.name}</span>
        </button>
      ))}
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
          <span className="shrink-0">{dayjs(note.createdAt).format("YYYY-MM-DD")}</span>
        </div>
      </div>
    );
  };

  const listPanel = (
    <ScrollArea className="flex-1" onBottom={() => hasMore && loadPage(page + 1)}>
      {plazaHeader}
      {authorFilterRow}
      <LoadingAndEmpty isLoading={loading} isEmpty={!loading && notes.length === 0} />
      {displayedNotes.map(noteRow)}
      {hasMore && (
        <div className="p-3 flex justify-center">
          <Button size="sm" variant="light" onPress={() => loadPage(page + 1)}>
            {t("load-more")}
          </Button>
        </div>
      )}
    </ScrollArea>
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
        <div className="max-w-3xl mx-auto">
          <div className="bg-background rounded-2xl p-4 md:p-6">
            <div className="flex items-center gap-2 mb-4">
              <UserAvatar account={{ image: selected.account?.image }} guestName={authorName(selected.account)} size={28} />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{authorName(selected.account)}</div>
                <div className="text-xs text-desc">{dayjs(selected.createdAt).format("YYYY-MM-DD HH:mm")}</div>
              </div>
            </div>
            <NoteContent blinkoItem={selected} blinko={blinko} isExpanded isShareMode />
          </div>
          {ctaCard}
          <div className="h-10" />
        </div>
      ) : (
        <div className="h-full flex items-center justify-center text-desc text-sm">{t("select-a-note")}</div>
      )}
    </ScrollArea>
  );

  return (
    <div className="h-mobile-full w-full flex flex-col bg-secondbackground">
        <div className="flex items-center justify-between px-4 md:px-6 h-14 shrink-0 bg-background border-b border-hover">
          <div className="flex items-center gap-2 min-w-0">
            <img src="/logo.png" alt="Blinko" className="w-7 h-7 rounded-lg" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
            <span className="font-bold truncate">{t("public-plaza-title")}</span>
          </div>
          {authButtons}
        </div>

        {isPc ? (
          <div className="flex-1 flex min-h-0 w-full">
            <div className="w-[300px] shrink-0 flex flex-col border-r border-hover bg-background">{listPanel}</div>
            {readerPanel}
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
              listPanel
            )}
          </div>
        )}
    </div>
  );
});

export default PublicHome;
