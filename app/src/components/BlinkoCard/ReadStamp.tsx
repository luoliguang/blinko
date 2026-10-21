import { observer } from 'mobx-react-lite';
import { Tooltip } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import dayjs from '@/lib/dayjs';

// Bigger, rubber-stamp look. Positioned lower on the right so it clears the
// top-right hover action row (copy / comment / share / delete) instead of
// overlapping it.
const stampClass =
  'absolute top-9 right-3 z-10 -rotate-[16deg] select-none border-[2.5px] border-danger/70 text-danger/80 rounded-md px-3 py-1 text-xl font-black tracking-[0.1em] bg-danger/10';

// A "已阅 / Read" watermark stamp for internally-shared notes.
// - Recipient: shows once they've opened a note shared to them (their own receipt).
// - Owner: shows once at least one recipient has read it; hover lists each reader.
export const ReadStamp = observer(({ blinkoItem }: { blinkoItem: any }) => {
  const { t } = useTranslation();
  const label = t('read-stamp');

  // Recipient side: this note was shared TO the current user.
  if (blinkoItem.isSharedNote) {
    if (!blinkoItem.readByMe) return null;
    return <div className={`pointer-events-none ${stampClass}`}>{label}</div>;
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
