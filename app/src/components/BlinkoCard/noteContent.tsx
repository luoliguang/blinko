import { MarkdownRender } from '@/components/Common/MarkdownRender';
import { FilesAttachmentRender } from "../Common/AttachmentRender";
import { Note } from '@shared/lib/types';
import { BlinkoStore } from '@/store/blinkoStore';
import { observer } from 'mobx-react-lite';
import { ReferencesContent } from './referencesContent';

interface NoteContentProps {
  blinkoItem: Note;
  blinko: BlinkoStore;
  isExpanded?: boolean;
  isShareMode?: boolean;
  isReadOnly?: boolean;
}

export const NoteContent = observer(({ blinkoItem, blinko, isExpanded, isShareMode, isReadOnly }: NoteContentProps) => {
  // Images embedded in the body are also linked as attachments (so they're
  // cleaned up with the note), but they're already shown inline — don't repeat
  // them in the bottom attachment strip. Match both markdown (](path)) and the
  // aligned html form (src="path").
  const content = blinkoItem.content ?? '';
  const isInlineReferenced = (path: string) =>
    !!path && (content.includes(`](${path})`) || content.includes(`src="${path}"`) || content.includes(`src='${path}'`));
  const attachments = (blinkoItem.attachments ?? []).filter((a) => !isInlineReferenced(a.path));

  return (
    <>
      <MarkdownRender
        content={blinkoItem.content}
        onChange={(newContent) => {
          if (isShareMode || isReadOnly) return;
          blinkoItem.content = newContent
          blinko.upsertNote.call({ id: blinkoItem.id, content: newContent, refresh: false })
        }}
        isShareMode={isShareMode || isReadOnly}
        largeSpacing={isShareMode || isExpanded}
      />
      <ReferencesContent blinkoItem={blinkoItem} className={`${isExpanded ? 'my-4' : 'my-2'}`} />
      <div className={attachments.length != 0 ? 'my-2' : ''}>
        <FilesAttachmentRender files={attachments} preview />
      </div>
    </>
  );
});