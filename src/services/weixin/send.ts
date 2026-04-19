import { randomUUID } from 'node:crypto'
import type { CDNMedia, MessageItem } from './types.js'
import { sendMessage } from './api.js'
import { guessMediaType, uploadFile } from './media.js'
import { MessageItemType, MessageState, MessageType } from './types.js'

export function markdownToPlainText(text: string): string {
  return text
    .replace(/```[\s\S]*?\n([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/___(.+?)___/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '[$1]')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*_]{3,}$/gm, '---')
    .replace(/^[\s]*[-*+]\s+/gm, '- ')
    .replace(/^[\s]*(\d+)\.\s+/gm, '$1. ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function sendText(params: {
  to: string
  text: string
  baseUrl: string
  token: string
  contextToken: string
}): Promise<{ messageId: string }> {
  const clientId = randomUUID()
  await sendMessage(params.baseUrl, params.token, {
    to_user_id: params.to,
    from_user_id: '',
    client_id: clientId,
    message_type: MessageType.BOT,
    message_state: MessageState.FINISH,
    context_token: params.contextToken,
    item_list: [
      {
        type: MessageItemType.TEXT,
        text_item: { text: markdownToPlainText(params.text) },
      },
    ],
  })

  return { messageId: clientId }
}

async function sendItems(params: {
  items: MessageItem[]
  to: string
  baseUrl: string
  token: string
  contextToken: string
}): Promise<string> {
  let lastClientId = ''
  for (const item of params.items) {
    lastClientId = randomUUID()
    await sendMessage(params.baseUrl, params.token, {
      to_user_id: params.to,
      from_user_id: '',
      client_id: lastClientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: params.contextToken,
      item_list: [item],
    })
  }
  return lastClientId
}

export async function sendMediaFile(params: {
  filePath: string
  to: string
  text: string
  baseUrl: string
  token: string
  contextToken: string
  cdnBaseUrl: string
}): Promise<{ messageId: string }> {
  const mediaType = guessMediaType(params.filePath)
  const uploaded = await uploadFile({
    filePath: params.filePath,
    toUserId: params.to,
    mediaType,
    apiBaseUrl: params.baseUrl,
    token: params.token,
    cdnBaseUrl: params.cdnBaseUrl,
  })

  const cdnMedia: CDNMedia = {
    encrypt_query_param: uploaded.encryptQueryParam,
    aes_key: uploaded.aesKey,
    encrypt_type: 1,
  }

  const items: MessageItem[] = []
  if (params.text) {
    items.push({
      type: MessageItemType.TEXT,
      text_item: { text: markdownToPlainText(params.text) },
    })
  }

  switch (mediaType) {
    case 1:
      items.push({
        type: MessageItemType.IMAGE,
        image_item: { media: cdnMedia, mid_size: uploaded.fileSize },
      })
      break
    case 2:
      items.push({
        type: MessageItemType.VIDEO,
        video_item: { media: cdnMedia, video_size: uploaded.fileSize },
      })
      break
    default:
      items.push({
        type: MessageItemType.FILE,
        file_item: {
          media: cdnMedia,
          file_name: uploaded.fileName,
          len: String(uploaded.rawSize),
        },
      })
      break
  }

  const messageId = await sendItems({
    items,
    to: params.to,
    baseUrl: params.baseUrl,
    token: params.token,
    contextToken: params.contextToken,
  })
  return { messageId }
}
