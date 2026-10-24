import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "usehooks-ts";
import { Button } from "@heroui/react";
import { api } from "@/lib/trpc";
import { helper } from "@/lib/helper";
import dayjs from "@/lib/dayjs";
import { BlinkoCard } from "@/components/BlinkoCard";
import { UserAvatar } from "@/components/BlinkoCard/commentButton";
import { ScrollArea } from "@/components/Common/ScrollArea";
import { LoadingAndEmpty } from "@/components/Common/LoadingAndEmpty";
import { Icon } from "@/components/Common/Iconify/icons";

const PAGE_SIZE = 50;

// First non-tag line of the note, stripped of a leading markdown heading marker.
function getTitle(content?: string) {
  const line = (content ?? "").split("\n").find((l) => l.trim() && !helper.regex.isContainHashTag.test(l)) ?? "";
  return line.replace(/^#+\s*/, "").trim() || "";
}

const PublicHome = observer(() => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isPc = useMediaQuery("(min-width: 768px)");

  const [site, setSite] = useState<{ name?: string; image?: string; description?: string } | null>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    api.public.siteInfo.query({}).then(setSite).catch(() => {});
  }, []);

  const byCreatedDesc = (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

  const loadPage = async (p: number) => {
    const list = await api.notes.publicList.mutate({ page: p, size: PAGE_SIZE });
    setNotes((prev) => (p === 1 ? list : [...prev, ...list]).slice().sort(byCreatedDesc));
    setHasMore(list.length === PAGE_SIZE);
    setPage(p);
    if (p === 1 && isPc && list.length) setSelected(list.slice().sort(byCreatedDesc)[0]);
    setLoading(false);
  };

  useEffect(() => {
    loadPage(1);
  }, []);

  const authButtons = (
    <div className="flex items-center gap-2">
      <Button size="sm" radius="full" variant="bordered" onPress={() => navigate("/signin")}>
        {t("sign-in")}
      </Button>
      <Button size="sm" radius="full" color="primary" onPress={() => navigate("/signup")}>
        {t("sign-up")}
      </Button>
    </div>
  );

  const profileHeader = (
    <div className="flex items-center gap-3 p-4 border-b border-hover">
      <UserAvatar account={{ image: site?.image }} guestName={site?.name} size={isPc ? 56 : 48} />
      <div className="min-w-0">
        <div className="text-lg font-bold truncate">{site?.name}</div>
        {site?.description && <div className="text-xs text-desc line-clamp-2 mt-1">{site.description}</div>}
      </div>
    </div>
  );

  const noteRow = (note: any) => {
    const active = selected?.id === note.id;
    return (
      <div
        key={note.id}
        onClick={() => setSelected(note)}
        className={`px-4 py-3 border-b border-hover cursor-pointer transition-colors ${active ? "bg-primary/10" : "hover:bg-hover"}`}
      >
        <div className={`text-sm font-medium truncate ${active ? "text-primary" : ""}`}>{getTitle(note.content) || t("untitled")}</div>
        <div className="text-xs text-desc mt-1">{dayjs(note.createdAt).format("YYYY-MM-DD")}</div>
      </div>
    );
  };

  const listPanel = (
    <ScrollArea className="flex-1" onBottom={() => hasMore && loadPage(page + 1)}>
      {profileHeader}
      <LoadingAndEmpty isLoading={loading} isEmpty={!loading && notes.length === 0} />
      {notes.map(noteRow)}
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
          <BlinkoCard blinkoItem={selected} isShareMode glassEffect defaultExpanded withoutHoverAnimation />
          {ctaCard}
        </div>
      ) : (
        <div className="h-full flex items-center justify-center text-desc text-sm">{t("select-a-note")}</div>
      )}
    </ScrollArea>
  );

  return (
    <div className="h-[100vh] w-full flex flex-col bg-secondbackground">
        <div className="flex items-center justify-between px-4 md:px-6 h-14 shrink-0 bg-background border-b border-hover">
          <div className="flex items-center gap-2 min-w-0">
            <img src="/logo.png" alt="Blinko" className="w-7 h-7 rounded-lg" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
            <span className="font-bold truncate">{site?.name ? t("public-site-title", { name: site.name }) : "Blinko"}</span>
          </div>
          {authButtons}
        </div>

        {isPc ? (
          <div className="flex-1 flex min-h-0 max-w-screen-xl w-full mx-auto">
            <div className="w-[300px] shrink-0 flex flex-col border-r border-hover bg-background">{listPanel}</div>
            {readerPanel}
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {selected ? (
              <>
                <div className="flex items-center gap-2 px-4 h-11 shrink-0 border-b border-hover">
                  <Button size="sm" variant="light" isIconOnly onPress={() => setSelected(null)} aria-label={t("back")}>
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
