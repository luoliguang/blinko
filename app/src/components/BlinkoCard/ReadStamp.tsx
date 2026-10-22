import { observer } from 'mobx-react-lite';
import { Tooltip } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import dayjs from '@/lib/dayjs';
import { api } from '@/lib/trpc';

// Bigger, rubber-stamp look. Positioned lower on the right so it clears the
// top-right hover action row (copy / comment / share / delete) instead of
// overlapping it.
const stampClass =
  'absolute top-9 right-3 z-10 -rotate-[16deg] select-none border-[2.5px] border-danger/70 text-danger/80 rounded-md px-3 py-1 text-xl font-black tracking-[0.1em] bg-danger/10';

// A "已阅 / Read" watermark stamp for internally-shared notes.
// - Recipient: clicks the button to mark a note shared to them as read; the
//   button then turns into their "已阅" receipt stamp.
// - Owner: shows once at least one recipient has read it; hover lists each reader.
export const ReadStamp = observer(({ blinkoItem }: { blinkoItem: any }) => {
  const { t } = useTranslation();
  const label = t('read-stamp');
  const [loading, setLoading] = useState(false);

  // Recipient side: this note was shared TO the current user.
  if (blinkoItem.isSharedNote) {
    if (blinkoItem.readByMe) {
      return <div className={`pointer-events-none ${stampClass}`}>{label}</div>;
    }
    const markRead = async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (loading) return;
      setLoading(true);
      try {
        await api.notes.markInternalShareRead.mutate({ id: blinkoItem.id! });
        blinkoItem.readByMe = true;
      } catch {
        setLoading(false);
      }
    };
    return (
      <button
        type="button"
        onClick={markRead}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={loading}
        className="absolute top-9 right-3 z-10 rounded-full border border-default-300 bg-background/80 px-3 py-1 text-xs font-medium text-default-600 shadow-sm backdrop-blur transition-colors hover:border-danger/60 hover:text-danger disabled:opacity-60"
      >
        {t('mark-as-read')}
      </button>
    );
  }

  // Owner side: only meaningful for notes the owner has shared out.
  const shares = (blinkoItem.internalShares ?? []) as any[];
  if (!shares.length || !shares.some((s) => s.readAt)) return null;

  const detail = (
    <div className="flex flex-col gap-1 py-1 min-w-[160px] max-w-[240px]">
      {shares.map((s, i) => (
        <div key={s.accountId ?? i} className="flex items-center justify-between gap-3 text-xs">
          <span className="truncate">{s.account?.nickname || s.account?.name || `#${s.accountId}`}</span>
          <span className={s.readAt ? 'text-success whitespace-nowrap' : 'text-default-400 whitespace-nowrap'}>
            {s.readAt ? dayjs(s.readAt).format('MM-DD HH:mm') : t('unread')}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <Tooltip content={detail} placement="bottom" closeDelay={0}>
      <div className={`cursor-default ${stampClass}`}>{label}</div>
    </Tooltip>
  );
});
