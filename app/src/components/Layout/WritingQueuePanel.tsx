import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/Common/Iconify/icons';
import { Button } from '@heroui/react';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { BaseStore } from '@/store/baseStore';
import { ShowEditBlinkoModel } from '@/components/BlinkoRightClickMenu';
import { ToastPlugin } from '@/store/module/Toast/Toast';
import i18n from '@/lib/i18n';
import dayjs from '@/lib/dayjs';

// Pull a short, human-readable title from a note's markdown content:
// first non-empty line, with leading markdown heading marks stripped.
const previewTitle = (content: string) => {
  const line = (content || '').split('\n').map(l => l.trim()).find(l => l.length > 0) || '';
  return line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').slice(0, 30) || '…';
};

export const WritingQueuePanel = observer(() => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore);
  const base = RootStore.Get(BaseStore);

  useEffect(() => {
    blinko.pendingWriteList.call();
  }, [blinko.updateTicker]);

  // Open the edit dialog in place (don't navigate away). Fetch the full note first
  // since the queue only holds a lightweight preview.
  const openEdit = async (id: number) => {
    const note = await blinko.noteDetail.call({ id });
    if (!note) {
      RootStore.Get(ToastPlugin).error(i18n.t('note-not-found'));
      return;
    }
    blinko.curSelectedNote = note as any;
    ShowEditBlinkoModel();
  };

  const items = blinko.pendingWriteList.value ?? [];

  return (
    <div
      className="relative h-full shrink-0 flex flex-col bg-background border-l border-divider"
      style={{ width: `${base.writingQueueWidth.value}px` }}
    >
      {/* Drag the left edge to resize the panel */}
      <div
        className={`absolute left-0 top-0 h-full w-1.5 cursor-col-resize z-10 hover:bg-primary/30 ${base.isQueueResizing ? 'bg-primary/40' : ''}`}
        onMouseDown={base.startQueueResizing}
      />
      <div className="flex items-center justify-between px-4 h-16 min-h-16 border-b border-divider">
        <div className="flex items-center gap-2">
          <Icon icon="mdi:clipboard-text-outline" width="20" height="20" className="text-primary" />
          <span className="font-bold">{t('writing-queue')}</span>
          {items.length > 0 && <span className="text-xs text-desc">({items.length})</span>}
        </div>
        <Button isIconOnly size="sm" variant="light" onPress={() => base.toggleWritingQueue()}>
          <Icon icon="mdi:close" width="18" height="18" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto hide-scrollbar px-3 py-3">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-desc gap-2 px-4">
            <Icon icon="material-symbols:check-circle-outline" width="36" height="36" className="opacity-40" />
            <span className="text-sm">{t('writing-queue-empty')}</span>
          </div>
        ) : (
          <div className="relative pl-4">
            {/* timeline rail */}
            <div className="absolute left-[5px] top-1 bottom-1 w-px bg-divider" />
            {items.map((item) => (
              <div key={item.id} className="relative mb-4 group/item">
                <div className="absolute -left-[13px] top-1.5 w-2.5 h-2.5 rounded-full bg-primary ring-2 ring-background" />
                <div
                  className="cursor-pointer rounded-lg p-2 hover:bg-hover !transition-all"
                  onClick={() => openEdit(item.id)}
                >
                  <div className="text-[11px] text-desc mb-0.5">{dayjs(item.createdAt).format('MM-DD HH:mm')}</div>
                  <div className="text-sm font-medium line-clamp-2">{previewTitle(item.content)}</div>
                </div>
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  className="absolute right-1 top-1 opacity-0 group-hover/item:opacity-100 !transition-all"
                  onPress={() => blinko.togglePendingWrite({ id: item.id, metadata: { pendingWrite: true } } as any)}
                >
                  <Icon icon="mdi:check" width="16" height="16" className="text-green-500" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
