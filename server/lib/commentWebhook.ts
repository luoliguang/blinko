import axios from 'axios';
import { SendWebhook } from '@server/lib/helper';
import { prisma } from '@server/prisma';

export const PERSONAL_WEBHOOK_CONFIG_KEY = 'personalWebhookEndpoint';

export type CommentWebhookEvent = 'comment.created' | 'comment.updated' | 'comment.deleted';
type CommentWebhookAction = 'create' | 'update' | 'delete';

const commentWebhookActionMap: Record<CommentWebhookEvent, CommentWebhookAction> = {
  'comment.created': 'create',
  'comment.updated': 'update',
  'comment.deleted': 'delete'
};

export const commentAccountSelect = {
  id: true,
  name: true,
  nickname: true,
  image: true
} as const;

export const commentWebhookInclude = {
  account: {
    select: commentAccountSelect
  },
  note: {
    select: {
      accountId: true,
      account: {
        select: {
          id: true
        }
      }
    }
  }
} as const;

export const getCommentAuthor = (comment: any) => {
  return comment.account?.nickname || comment.account?.name || comment.guestName || null;
}

export const getCommentWebhookConfigUserId = (comment: any, ctx: any) => {
  return comment.note?.accountId ?? comment.accountId ?? (ctx.id ? Number(ctx.id) : null);
}

export const buildCommentWebhookPayload = (event: CommentWebhookEvent, comment: any, extra: Record<string, any> = {}) => {
  return {
    event,
    noteId: comment.noteId,
    comment: {
      id: comment.id,
      content: comment.content,
      noteId: comment.noteId,
      parentId: comment.parentId,
      accountId: comment.accountId,
      guestName: comment.guestName,
      author: getCommentAuthor(comment),
      account: comment.account ? {
        id: comment.account.id,
        name: comment.account.name,
        nickname: comment.account.nickname,
        image: comment.account.image
      } : null,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt
    },
    ...extra
  };
}

export const sendCommentWebhook = (event: CommentWebhookEvent, comment: any, ctx: any, extra: Record<string, any> = {}) => {
  const webhookType = commentWebhookActionMap[event];
  SendWebhook(buildCommentWebhookPayload(event, comment, extra), webhookType, ctx, {
    activityType: `blinko.comment.${webhookType}`,
    configUserId: getCommentWebhookConfigUserId(comment, ctx)
  });
}

// Personal, per-account webhooks. Unlike the global webhookEndpoint (superadmin,
// receives everything), these are set by the superadmin per accountId out-of-band
// (no UI) and only fire for events relevant to that specific account: their own
// comments, and replies to their comments.
export const getPersonalWebhookUrl = async (accountId: number | null | undefined): Promise<string | null> => {
  if (!accountId) return null;
  const row = await prisma.config.findFirst({ where: { userId: accountId, key: PERSONAL_WEBHOOK_CONFIG_KEY } });
  const url = (row?.config as any)?.value;
  return typeof url === 'string' && url ? url : null;
}

export const sendPersonalCommentWebhook = async (
  accountId: number | null | undefined,
  event: CommentWebhookEvent,
  comment: any,
  extra: Record<string, any> = {}
) => {
  const url = await getPersonalWebhookUrl(accountId);
  if (!url) return;
  const webhookType = commentWebhookActionMap[event];
  try {
    await axios.post(url, {
      data: buildCommentWebhookPayload(event, comment, extra),
      webhookType,
      activityType: `blinko.comment.${webhookType}`
    });
  } catch (error) {
    console.log('request personal webhook error:', error)
  }
}
