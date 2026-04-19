import { existsSync } from 'node:fs'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import {
  ChannelPermissionRequestNotificationSchema,
  type ChannelPermissionRequestParams,
} from '../mcp/channelNotification.js'
import { initializeAnalyticsSink } from '../analytics/sink.js'
import { shutdownDatadog } from '../analytics/datadog.js'
import { shutdown1PEventLogging } from '../analytics/firstPartyEventLogger.js'
import { enableConfigs } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { CDN_BASE_URL, DEFAULT_BASE_URL, loadAccount } from './accounts.js'
import { getConfig, sendTyping } from './api.js'
import { getContextToken, startPollLoop, type ParsedMessage } from './monitor.js'
import { getActivePermissionChat, savePendingPermission } from './permissions.js'
import { sendMediaFile, sendText } from './send.js'
import { TypingStatus } from './types.js'

function formatPermissionRequestMessage(
  request: ChannelPermissionRequestParams,
): string {
  return [
    'Claude Code needs your approval.',
    '',
    `Tool: ${request.tool_name}`,
    `Reason: ${request.description}`,
    `Input: ${request.input_preview}`,
    '',
    `Reply with: yes ${request.request_id}`,
    `Or deny with: no ${request.request_id}`,
  ].join('\n')
}

export function createWeixinMcpServer(): Server {
  const server = new Server(
    { name: 'weixin', version: MACRO.VERSION },
    {
      capabilities: {
        experimental: {
          'claude/channel': {},
          'claude/channel/permission': {},
        },
        tools: {},
      },
      instructions:
        'Messages from WeChat arrive as <channel source="plugin:weixin:weixin" chat_id="..." sender_id="...">. Reply using the reply tool with the chat_id from the channel tag. Use absolute paths for file attachments.',
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'reply',
        description:
          'Reply to a WeChat message. Pass the chat_id from the channel tag.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            chat_id: {
              type: 'string',
              description: 'The chat_id from the channel notification',
            },
            text: { type: 'string', description: 'The reply text' },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional absolute file paths to attach',
            },
          },
          required: ['chat_id', 'text'],
        },
      },
      {
        name: 'send_typing',
        description: 'Send a typing indicator to a WeChat user.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            chat_id: { type: 'string', description: 'The chat_id (user ID)' },
          },
          required: ['chat_id'],
        },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params
    const account = loadAccount()
    if (!account) {
      return {
        content: [
          {
            type: 'text',
            text: 'WeChat not connected. Run `ccb weixin login` first.',
          },
        ],
        isError: true,
      }
    }

    const baseUrl = account.baseUrl || DEFAULT_BASE_URL
    const cdnBaseUrl = CDN_BASE_URL

    switch (name) {
      case 'reply': {
        const chatId = typeof args?.chat_id === 'string' ? args.chat_id : ''
        const text = typeof args?.text === 'string' ? args.text : ''
        const files = Array.isArray(args?.files)
          ? args.files.filter((value): value is string => typeof value === 'string')
          : undefined

        if (!chatId || !text) {
          return {
            content: [
              { type: 'text', text: 'Missing chat_id or text parameter.' },
            ],
            isError: true,
          }
        }

        const contextToken = getContextToken(chatId) || ''

        try {
          if (files && files.length > 0) {
            for (const [index, filePath] of files.entries()) {
              if (!existsSync(filePath)) {
                return {
                  content: [
                    { type: 'text', text: `File not found: ${filePath}` },
                  ],
                  isError: true,
                }
              }
              await sendMediaFile({
                filePath,
                to: chatId,
                text: index === 0 ? text : '',
                baseUrl,
                token: account.token,
                contextToken,
                cdnBaseUrl,
              })
            }

            return {
              content: [{ type: 'text', text: 'Message sent with attachments.' }],
            }
          }

          await sendText({
            to: chatId,
            text,
            baseUrl,
            token: account.token,
            contextToken,
          })
          return { content: [{ type: 'text', text: 'Message sent.' }] }
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Failed to send: ${error}` }],
            isError: true,
          }
        }
      }

      case 'send_typing': {
        const chatId = typeof args?.chat_id === 'string' ? args.chat_id : ''
        if (!chatId) {
          return {
            content: [{ type: 'text', text: 'Missing chat_id parameter.' }],
            isError: true,
          }
        }

        try {
          const contextToken = getContextToken(chatId)
          const config = await getConfig(
            baseUrl,
            account.token,
            chatId,
            contextToken,
          )
          if (config.typing_ticket) {
            await sendTyping(baseUrl, account.token, {
              ilink_user_id: chatId,
              typing_ticket: config.typing_ticket,
              status: TypingStatus.TYPING,
            })
          }
          return {
            content: [{ type: 'text', text: 'Typing indicator sent.' }],
          }
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Failed to send typing: ${error}` }],
            isError: true,
          }
        }
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        }
    }
  })

  return server
}

export async function runWeixinMcpServer(): Promise<void> {
  enableConfigs()
  initializeAnalyticsSink()

  const account = loadAccount()
  if (!account) {
    process.stderr.write(
      '[weixin] No account configured. Run `ccb weixin login` to connect your WeChat account.\n',
    )
    await Promise.all([shutdown1PEventLogging(), shutdownDatadog()])
    process.exit(1)
  }

  const server = createWeixinMcpServer()
  const transport = new StdioServerTransport()

  server.setNotificationHandler(
    ChannelPermissionRequestNotificationSchema(),
    async notification => {
      const request = notification.params
      const targetChatId = request.channel_context?.chat_id
      const targetChat = targetChatId
        ? {
            chatId: targetChatId,
            contextToken: getContextToken(targetChatId),
          }
        : getActivePermissionChat()

      if (!targetChat) {
        logForDebugging(
          `[Weixin MCP] No active chat available for permission request ${request.request_id}`,
        )
        return
      }

      try {
        savePendingPermission(
          request,
          targetChat.chatId,
          targetChat.contextToken,
        )
        await sendText({
          to: targetChat.chatId,
          text: formatPermissionRequestMessage(request),
          baseUrl,
          token: account.token,
          contextToken: targetChat.contextToken || '',
        })
      } catch (error) {
        process.stderr.write(
          `[weixin] Failed to relay permission request ${request.request_id}: ${error}\n`,
        )
      }
    },
  )

  await server.connect(transport)

  const baseUrl = account.baseUrl || DEFAULT_BASE_URL
  const controller = new AbortController()

  let exiting = false
  const shutdownAndExit = async (): Promise<void> => {
    if (exiting) return
    exiting = true
    if (!controller.signal.aborted) {
      controller.abort()
    }
    await Promise.all([shutdown1PEventLogging(), shutdownDatadog()])
    process.exit(0)
  }

  process.stdin.on('end', () => void shutdownAndExit())
  process.stdin.on('error', () => void shutdownAndExit())
  process.on('SIGINT', () => void shutdownAndExit())
  process.on('SIGTERM', () => void shutdownAndExit())
  process.on('SIGHUP', () => void shutdownAndExit())

  const ppid = process.ppid
  const parentCheck = setInterval(() => {
    try {
      process.kill(ppid, 0)
    } catch {
      process.stderr.write('[weixin] Parent process exited, shutting down...\n')
      clearInterval(parentCheck)
      void shutdownAndExit()
    }
  }, 5000)

  logForDebugging('[Weixin MCP] Starting poll loop')
  await startPollLoop({
    baseUrl,
    cdnBaseUrl: CDN_BASE_URL,
    token: account.token,
    onMessage: async (msg: ParsedMessage) => {
      await server.notification({
        method: 'notifications/claude/channel',
        params: {
          content: msg.text,
          meta: {
            chat_id: msg.fromUserId,
            sender_id: msg.fromUserId,
            message_id: msg.messageId,
            ...(msg.attachmentPath && { attachment_path: msg.attachmentPath }),
            ...(msg.attachmentType && { attachment_type: msg.attachmentType }),
          },
        },
      })
    },
    onPermissionResponse: async response => {
      await server.notification({
        method: 'notifications/claude/channel/permission',
        params: {
          request_id: response.requestId,
          behavior: response.behavior,
        },
      })
    },
    abortSignal: controller.signal,
  })

  clearInterval(parentCheck)
  await shutdownAndExit()
}
