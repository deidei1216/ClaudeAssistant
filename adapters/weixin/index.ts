import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, extname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AdapterConfig, ChannelAdapter, SendMessageOptions, SendMessageResult } from '../../core/adapter';
import type { AgentMessage, Attachment } from '../../core/types';
import { saveInboundAttachment } from '../../core/attachments';
import { getDefaultWeixinAuthFile, loadStoredWeixinAccounts } from './account-store';
import {
  buildWeixinChannelId,
  toAgentMessage,
  type WeixinInboundMessage,
  type WeixinMessageItem
} from './message-mapper';

interface WeixinAccountConfig {
  id: string;
  token: string;
  ilinkUserId: string;
  baseUrl?: string;
  cdnBaseUrl?: string;
  enabled?: boolean;
}

interface WeixinAdapterConfig extends AdapterConfig {
  accounts?: WeixinAccountConfig[];
  channelVersion?: string;
  appId?: string;
  authFile?: string;
  lockDirectory?: string;
  rootDirectory?: string;
  stateFile?: string;
  requestTimeoutMs?: number;
  longPollTimeoutMs?: number;
  retryDelayMs?: number;
  typingCacheTtlMs?: number;
}

interface WeixinChannelState {
  accountId: string;
  peerUserId: string;
  contextToken?: string;
  typingTicket?: string;
  typingTicketFetchedAt?: number;
}

interface WeixinGetUpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinInboundMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

interface WeixinGetUploadUrlResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  upload_param?: string;
  thumb_upload_param?: string;
  upload_full_url?: string;
}

interface PersistedWeixinState {
  cursors?: Record<string, string>;
  channels?: Record<string, WeixinChannelState>;
}

interface WeixinAccountLock {
  pid?: number;
  accountId?: string;
  acquiredAt?: string;
}

type FetchLike = typeof fetch;

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com/';
const DEFAULT_CHANNEL_VERSION = '2.1.1';
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_RETRY_DELAY_MS = 3_000;
const DEFAULT_TYPING_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_UPLOAD_RETRY_COUNT = 3;
const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
const DEFAULT_STATE_FILE = join('data', 'adapters', 'weixin-state.json');
const DEFAULT_LOCK_DIRECTORY = join('data', 'adapters', 'weixin-locks');
const RECENT_MESSAGE_TTL_MS = 15 * 60_000;
const DEFAULT_HEALTHCHECK_INTERVAL_MS = 5_000;

function detectImageType(buffer: Buffer): { extension: string; mime: string } {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: 'png', mime: 'image/png' };
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: 'jpg', mime: 'image/jpeg' };
  }

  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') {
      return { extension: 'gif', mime: 'image/gif' };
    }
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { extension: 'webp', mime: 'image/webp' };
  }

  return { extension: 'bin', mime: 'application/octet-stream' };
}

function detectMimeTypeFromFileName(fileName: string): string {
  switch (extname(fileName).toLowerCase()) {
    case '.pdf':
      return 'application/pdf';
    case '.txt':
      return 'text/plain';
    case '.md':
      return 'text/markdown';
    case '.json':
      return 'application/json';
    case '.csv':
      return 'text/csv';
    case '.doc':
      return 'application/msword';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.ppt':
      return 'application/vnd.ms-powerpoint';
    case '.pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case '.zip':
      return 'application/zip';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

interface ExtractedInboundAttachment {
  attachment: Attachment;
  sourceType: number;
}

function sanitizeLockSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
}

export class WeixinAdapter implements ChannelAdapter {
  readonly name = 'Weixin';
  readonly type = 'weixin';

  private callback?: (message: AgentMessage) => Promise<void>;
  private config?: WeixinAdapterConfig;
  private running = false;
  private readonly channelStates = new Map<string, WeixinChannelState>();
  private readonly cursors = new Map<string, string>();
  private readonly pollTasks = new Map<string, Promise<void>>();
  private readonly inboundDispatchTasks = new Set<Promise<void>>();
  private readonly lockRetryTimers = new Map<string, NodeJS.Timeout>();
  private maintenanceTimer?: NodeJS.Timeout;
  private readonly abortControllers = new Set<AbortController>();
  private readonly recentInboundMessages = new Map<string, number>();
  private readonly accountLockPaths = new Map<string, string>();
  private readonly waitingForAccountLocks = new Set<string>();

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly logger: {
      info?: (data: unknown, message: string) => void;
      warn?: (data: unknown, message: string) => void;
      error?: (data: unknown, message: string) => void;
    } = {}
  ) {}

  async initialize(config: WeixinAdapterConfig): Promise<void> {
    this.config = {
      channelVersion: DEFAULT_CHANNEL_VERSION,
      authFile: getDefaultWeixinAuthFile(),
      lockDirectory: DEFAULT_LOCK_DIRECTORY,
      rootDirectory: process.cwd(),
      stateFile: DEFAULT_STATE_FILE,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      longPollTimeoutMs: DEFAULT_LONG_POLL_TIMEOUT_MS,
      retryDelayMs: DEFAULT_RETRY_DELAY_MS,
      typingCacheTtlMs: DEFAULT_TYPING_CACHE_TTL_MS,
      ...config,
      accounts: this.resolveAccounts(config)
    };
    const resolvedConfig = this.config;
    const accounts = resolvedConfig.accounts ?? [];

    if (!accounts.length) {
      throw new Error(
        'No enabled Weixin accounts were configured. Run `npm run weixin:login` or fill config/adapters/weixin.json manually.'
      );
    }

    for (const account of accounts) {
      if (!account.id.trim()) {
        throw new Error('Each Weixin account requires a non-empty id.');
      }
      if (!account.token.trim()) {
        throw new Error(`Weixin account ${account.id} is missing a bot token.`);
      }
      if (!account.ilinkUserId.trim()) {
        throw new Error(`Weixin account ${account.id} is missing ilinkUserId.`);
      }
    }

    this.loadState();
  }

  onMessage(callback: (message: AgentMessage) => Promise<void>): void {
    this.callback = callback;

    if (!this.running) {
      void this.connect().catch((error) => {
        this.log('error', 'Weixin polling failed to start', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }
  }

  async sendMessage(channelId: string, content: string, options?: SendMessageOptions): Promise<SendMessageResult> {
    const state = this.channelStates.get(channelId);
    if (!state) {
      return {
        messageId: '',
        success: false,
        error: `Unknown Weixin channel ${channelId}.`
      };
    }

    const account = this.getAccount(state.accountId);
    const itemList = await this.buildOutboundItems(account, state, content, options);
    let lastClientId = '';

    for (const item of itemList) {
      const clientId = `gateway-${randomUUID()}`;
      await this.postJson(account, 'ilink/bot/sendmessage', {
        msg: {
          from_user_id: '',
          to_user_id: state.peerUserId,
          client_id: clientId,
          message_type: 2,
          message_state: 2,
          context_token: state.contextToken ?? '',
          item_list: [item]
        }
      });
      lastClientId = clientId;
    }

    return {
      messageId: lastClientId,
      success: true
    };
  }

  async setTyping(channelId: string, typing: boolean): Promise<void> {
    if (!typing) {
      return;
    }

    const state = this.channelStates.get(channelId);
    if (!state) {
      return;
    }

    const account = this.getAccount(state.accountId);
    const typingTicket = await this.getTypingTicket(account, channelId, state);
    if (!typingTicket) {
      return;
    }

    await this.postJson(account, 'ilink/bot/sendtyping', {
      ilink_user_id: account.ilinkUserId,
      typing_ticket: typingTicket,
      status: 1
    });
  }

  async stop(): Promise<void> {
    await this.disconnect();
  }

  async connect(): Promise<void> {
    const config = this.config;
    if (!config) {
      throw new Error('Weixin adapter must be initialized before connect.');
    }

    if (this.running) {
      return;
    }

    const accounts = config.accounts ?? [];
    this.running = true;
    this.startMaintenanceLoop(accounts);

    for (const account of accounts) {
      this.ensureAccountPolling(account);
    }
  }

  async disconnect(): Promise<void> {
    this.running = false;

    for (const controller of this.abortControllers) {
      controller.abort();
    }

    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = undefined;
    }

    for (const timer of this.lockRetryTimers.values()) {
      clearTimeout(timer);
    }

    this.lockRetryTimers.clear();
    await Promise.allSettled(this.pollTasks.values());
    this.pollTasks.clear();
    await Promise.allSettled(this.inboundDispatchTasks);
    this.inboundDispatchTasks.clear();
    this.abortControllers.clear();
    this.waitingForAccountLocks.clear();

    for (const accountId of this.accountLockPaths.keys()) {
      this.releaseAccountLock(accountId);
    }
  }

  private ensureAccountPolling(account: WeixinAccountConfig): void {
    if (!this.running || this.pollTasks.has(account.id)) {
      return;
    }

    this.clearAccountLockRetry(account.id);

    if (!this.tryAcquireAccountLock(account.id)) {
      this.scheduleAccountLockRetry(account);
      return;
    }

    const task = this.pollAccount(account)
      .catch((error) => {
        if (!this.running) {
          return;
        }

        this.log('error', 'Weixin account poll task exited unexpectedly', {
          accountId: account.id,
          error: error instanceof Error ? error.message : String(error)
        });
      })
      .finally(() => {
        this.pollTasks.delete(account.id);

        if (this.running) {
          this.scheduleAccountLockRetry(account);
        }
      });

    this.pollTasks.set(account.id, task);
  }

  private startMaintenanceLoop(accounts: WeixinAccountConfig[]): void {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
    }

    this.maintenanceTimer = setInterval(() => {
      if (!this.running) {
        return;
      }

      for (const account of accounts) {
        this.ensureAccountPolling(account);
      }
    }, DEFAULT_HEALTHCHECK_INTERVAL_MS);
  }

  private scheduleAccountLockRetry(
    account: WeixinAccountConfig,
    delayMs = this.config?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  ): void {
    if (!this.running || this.pollTasks.has(account.id) || this.lockRetryTimers.has(account.id)) {
      return;
    }

    const timer = setTimeout(() => {
      this.lockRetryTimers.delete(account.id);
      this.ensureAccountPolling(account);
    }, delayMs);

    this.lockRetryTimers.set(account.id, timer);
  }

  private clearAccountLockRetry(accountId: string): void {
    const timer = this.lockRetryTimers.get(accountId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.lockRetryTimers.delete(accountId);
  }

  private async pollAccount(account: WeixinAccountConfig): Promise<void> {
    try {
      while (this.running) {
        try {
          const response = await this.postJson<WeixinGetUpdatesResponse>(
            account,
            'ilink/bot/getupdates',
            {
              get_updates_buf: this.cursors.get(account.id) ?? ''
            },
            this.config?.longPollTimeoutMs
          );

          if (typeof response.get_updates_buf === 'string') {
            this.cursors.set(account.id, response.get_updates_buf);
            this.persistState();
          }

          if (response.ret && response.ret !== 0) {
            this.log('warn', 'Weixin getupdates returned a non-zero status', {
              accountId: account.id,
              ret: response.ret,
              errcode: response.errcode,
              errmsg: response.errmsg
            });
            await this.sleep(this.config?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
            continue;
          }

          for (const message of response.msgs ?? []) {
            await this.processInboundMessage(account, message);
          }
        } catch (error) {
          if (!this.running && this.isAbortError(error)) {
            return;
          }

          if (this.running && this.isAbortError(error)) {
            continue;
          }

          this.log('error', 'Weixin polling failed', {
            accountId: account.id,
            error: error instanceof Error ? error.message : String(error)
          });
          await this.sleep(this.config?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
        }
      }
    } finally {
      this.releaseAccountLock(account.id);
    }
  }

  private async processInboundMessage(account: WeixinAccountConfig, message: WeixinInboundMessage): Promise<void> {
    if (!message.from_user_id) {
      return;
    }

    this.log('info', 'Weixin inbound message received from getupdates', {
      accountId: account.id,
      messageId: message.message_id,
      fromUserId: message.from_user_id,
      createTimeMs: message.create_time_ms,
      itemCount: message.item_list?.length ?? 0,
      itemTypes: (message.item_list ?? []).map((item) => item.type)
    });

    const dedupeKey = this.getInboundMessageKey(account.id, message);
    if (this.isDuplicateInboundMessage(dedupeKey)) {
      this.log('info', 'Skipping duplicate Weixin inbound message', {
        accountId: account.id,
        channelId: buildWeixinChannelId(account.id, message.from_user_id),
        messageId: message.message_id,
        dedupeKey
      });
      return;
    }

    const channelId = buildWeixinChannelId(account.id, message.from_user_id);
    this.channelStates.set(channelId, {
      accountId: account.id,
      peerUserId: message.from_user_id,
      contextToken: message.context_token
    });
    this.persistState();

    const attachmentExtractStartedAt = Date.now();
    const extractedAttachments = await this.extractInboundAttachments(account, channelId, message);
    const attachments = extractedAttachments.map((entry) => entry.attachment);
    this.log('info', 'Weixin inbound attachment extraction finished', {
      accountId: account.id,
      channelId,
      messageId: message.message_id,
      attachmentCount: attachments.length,
      durationMs: Date.now() - attachmentExtractStartedAt
    });
    const omittedMediaTypes = [...new Set(extractedAttachments.map((entry) => entry.sourceType))];
    const agentMessage = toAgentMessage(account.id, message, {
      omitMediaTypes: omittedMediaTypes,
      allowEmptyContent: attachments.length > 0
    });
    if (!agentMessage) {
      return;
    }

    if (attachments.length > 0) {
      agentMessage.attachments = attachments;
    }

    this.dispatchInboundMessage(agentMessage);
  }

  private dispatchInboundMessage(message: AgentMessage): void {
    if (!this.callback) {
      return;
    }

    let task: Promise<void>;
    task = this.callback(message)
      .catch((error) => {
        this.log('error', 'Weixin inbound message callback failed', {
          channelId: message.channelId,
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error)
        });
      })
      .finally(() => {
        this.inboundDispatchTasks.delete(task);
      });

    this.inboundDispatchTasks.add(task);
  }

  private async getTypingTicket(
    account: WeixinAccountConfig,
    channelId: string,
    state: WeixinChannelState
  ): Promise<string | undefined> {
    const now = Date.now();
    const ttl = this.config?.typingCacheTtlMs ?? DEFAULT_TYPING_CACHE_TTL_MS;

    if (state.typingTicket && state.typingTicketFetchedAt && now - state.typingTicketFetchedAt < ttl) {
      return state.typingTicket;
    }

    const response = await this.postJson<{ ret?: number; typing_ticket?: string }>(account, 'ilink/bot/getconfig', {
      ilink_user_id: account.ilinkUserId,
      context_token: state.contextToken
    });

    if (response.ret && response.ret !== 0) {
      this.log('warn', 'Weixin getconfig returned a non-zero status', {
        accountId: account.id,
        channelId,
        ret: response.ret
      });
      return undefined;
    }

    const nextState: WeixinChannelState = {
      ...state,
      typingTicket: response.typing_ticket,
      typingTicketFetchedAt: now
    };
    this.channelStates.set(channelId, nextState);
    this.persistState();
    return response.typing_ticket;
  }

  private async buildOutboundItems(
    account: WeixinAccountConfig,
    state: WeixinChannelState,
    content: string,
    options?: SendMessageOptions
  ): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    const text = content.trim();
    const attachmentNotes: string[] = [];

    for (const attachment of options?.attachments ?? []) {
      if (!attachment.localPath) {
        attachmentNotes.push(`[Skipped attachment ${attachment.name}: missing localPath.]`);
        continue;
      }

      const upload = await this.uploadAttachment(account, state, attachment);
      items.push({
        type: 4,
        file_item: {
          media: upload.media,
          file_name: attachment.name,
          md5: upload.md5,
          len: String(upload.plaintext.length)
        }
      });
    }

    const visibleText = [text, ...attachmentNotes].filter(Boolean).join('\n\n').trim();
    if (visibleText || items.length === 0) {
      items.unshift({
        type: 1,
        text_item: {
          text: visibleText
        }
      });
    }

    return items;
  }

  private async uploadAttachment(
    account: WeixinAccountConfig,
    state: WeixinChannelState,
    attachment: Attachment
  ): Promise<{
    plaintext: Buffer;
    md5: string;
    media: Record<string, unknown>;
  }> {
    const plaintext = readFileSync(resolve(attachment.localPath ?? ''));
    const aesKey = randomBytes(16);
    const encrypted = this.encryptAttachment(plaintext, aesKey);
    const md5 = createHash('md5').update(plaintext).digest('hex');
    const aesKeyHex = aesKey.toString('hex');
    const aesKeyBase64 = Buffer.from(aesKeyHex, 'utf8').toString('base64');

    const { uploadUrl } = await this.requestOutboundUploadTarget(account, state, attachment, {
      plaintextLength: plaintext.length,
      encryptedLength: encrypted.length,
      md5,
      aesKeyHex
    });
    const downloadParam = await this.uploadBinaryToCdn(uploadUrl, encrypted);

    return {
      plaintext,
      md5,
      media: {
        encrypt_query_param: downloadParam,
        aes_key: aesKeyBase64,
        encrypt_type: 1
      }
    };
  }

  private async requestOutboundUploadTarget(
    account: WeixinAccountConfig,
    state: WeixinChannelState,
    attachment: Attachment,
    payload: {
      plaintextLength: number;
      encryptedLength: number;
      md5: string;
      aesKeyHex: string;
    }
  ): Promise<{ uploadUrl: string }> {
    let lastResponse: WeixinGetUploadUrlResponse | undefined;
    let lastUploadUrl: string | undefined;

    for (let attempt = 1; attempt <= DEFAULT_UPLOAD_RETRY_COUNT; attempt += 1) {
      const filekey = randomBytes(16).toString('hex');
      const uploadResponse = await this.postJson<WeixinGetUploadUrlResponse>(account, 'ilink/bot/getuploadurl', {
        filekey,
        media_type: 3,
        to_user_id: state.peerUserId,
        rawsize: payload.plaintextLength,
        rawfilemd5: payload.md5,
        filesize: payload.encryptedLength,
        no_need_thumb: true,
        aeskey: payload.aesKeyHex
      });
      const uploadUrl = this.resolveOutboundUploadUrl(account, uploadResponse, filekey);

      if (uploadUrl) {
        return { uploadUrl };
      }

      lastResponse = uploadResponse;
      lastUploadUrl = uploadUrl;

      this.log('warn', 'Weixin upload response was missing resolved attachment fields', {
        accountId: account.id,
        attachmentName: attachment.name,
        attempt,
        uploadResponse,
        uploadUrl
      });

      if (attempt < DEFAULT_UPLOAD_RETRY_COUNT) {
        await this.sleep(500);
      }
    }

    throw new Error(
        `Weixin upload URL missing for attachment ${attachment.name}. ` +
        `Last response: ${JSON.stringify({
          uploadResponse: lastResponse,
          uploadUrl: lastUploadUrl
        })}`
    );
  }

  private encryptAttachment(content: Buffer, aesKey: Buffer): Buffer {
    const cipher = createCipheriv('aes-128-ecb', aesKey, null);
    cipher.setAutoPadding(true);
    return Buffer.concat([cipher.update(content), cipher.final()]);
  }

  private async uploadBinaryToCdn(url: string, content: Buffer): Promise<string> {
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream'
      },
      body: new Uint8Array(content)
    });

    if (!response.ok) {
      throw new Error(`Weixin CDN upload failed: ${response.status} ${await response.text()}`);
    }

    const downloadParam = response.headers.get('x-encrypted-param')?.trim();
    if (!downloadParam) {
      throw new Error('Weixin CDN upload response missing x-encrypted-param header.');
    }

    return downloadParam;
  }

  private async extractInboundAttachments(
    account: WeixinAccountConfig,
    channelId: string,
    message: WeixinInboundMessage
  ): Promise<ExtractedInboundAttachment[]> {
    const attachments: ExtractedInboundAttachment[] = [];

    for (const [index, item] of (message.item_list ?? []).entries()) {
      try {
        if (item.type === 2 && item.image_item?.media) {
          const image = await this.downloadInboundImage(account, channelId, item, message, index);
          attachments.push({
            attachment: image,
            sourceType: 2
          });
          continue;
        }

        if (item.type === 4 && item.file_item?.media) {
          const file = await this.downloadInboundFile(account, channelId, item, message, index);
          attachments.push({
            attachment: file,
            sourceType: 4
          });
        }
      } catch (error) {
        this.log('warn', 'Failed to download Weixin inbound attachment', {
          accountId: account.id,
          channelId,
          messageId: message.message_id,
          itemType: item.type,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return attachments;
  }

  private async downloadInboundImage(
    account: WeixinAccountConfig,
    channelId: string,
    item: WeixinMessageItem,
    message: WeixinInboundMessage,
    index: number
  ): Promise<Attachment> {
    const imageMedia = item.image_item?.media;
    if (!imageMedia) {
      throw new Error('Image media payload is missing.');
    }

    const aesKey = this.resolveInboundImageKey(item);
    const downloadStartedAt = Date.now();
    const encrypted = await this.fetchBinary(this.resolveInboundMediaUrl(account, imageMedia), 'Weixin inbound image');
    const decrypted = aesKey ? this.decryptAttachment(encrypted, aesKey) : encrypted;
    const imageType = detectImageType(decrypted);
    const fileName = `weixin-image-${message.message_id ?? index}.${imageType.extension}`;
    const localPath = saveInboundAttachment(this.config?.rootDirectory ?? process.cwd(), channelId, {
      id: `image-${message.message_id ?? index}-${index}`,
      name: fileName,
      data: decrypted
    });

    this.log('info', 'Weixin inbound image downloaded', {
      accountId: account.id,
      channelId,
      messageId: message.message_id,
      index,
      fileName,
      size: decrypted.length,
      durationMs: Date.now() - downloadStartedAt
    });

    return {
      id: `weixin:image:${message.message_id ?? index}:${index}`,
      name: fileName,
      type: imageType.mime,
      size: decrypted.length,
      url: localPath,
      localPath
    };
  }

  private async downloadInboundFile(
    account: WeixinAccountConfig,
    channelId: string,
    item: WeixinMessageItem,
    message: WeixinInboundMessage,
    index: number
  ): Promise<Attachment> {
    const fileMedia = item.file_item?.media;
    if (!fileMedia) {
      throw new Error('File media payload is missing.');
    }

    const aesKey = this.resolveInboundMediaKey(item.file_item?.aeskey, item.file_item?.media?.aes_key);
    const downloadStartedAt = Date.now();
    const encrypted = await this.fetchBinary(this.resolveInboundMediaUrl(account, fileMedia), 'Weixin inbound file');
    const decrypted = aesKey ? this.decryptAttachment(encrypted, aesKey) : encrypted;
    const fileName = item.file_item?.file_name?.trim() || `weixin-file-${message.message_id ?? index}.bin`;
    const localPath = saveInboundAttachment(this.config?.rootDirectory ?? process.cwd(), channelId, {
      id: `file-${message.message_id ?? index}-${index}`,
      name: fileName,
      data: decrypted
    });

    this.log('info', 'Weixin inbound file downloaded', {
      accountId: account.id,
      channelId,
      messageId: message.message_id,
      index,
      fileName,
      size: decrypted.length,
      durationMs: Date.now() - downloadStartedAt
    });

    return {
      id: `weixin:file:${message.message_id ?? index}:${index}`,
      name: fileName,
      type: detectMimeTypeFromFileName(fileName),
      size: decrypted.length,
      url: localPath,
      localPath
    };
  }

  private resolveInboundImageKey(item: WeixinMessageItem): Buffer | undefined {
    return this.resolveInboundMediaKey(item.image_item?.aeskey, item.image_item?.media?.aes_key);
  }

  private resolveInboundMediaKey(explicitHexKey?: string, encodedMediaKey?: string): Buffer | undefined {
    if (explicitHexKey?.trim()) {
      return Buffer.from(explicitHexKey.trim(), 'hex');
    }

    const base64Key = encodedMediaKey?.trim();
    if (!base64Key) {
      return undefined;
    }

    const decoded = Buffer.from(base64Key, 'base64');
    if (decoded.length === 16) {
      return decoded;
    }

    if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) {
      return Buffer.from(decoded.toString('ascii'), 'hex');
    }

    throw new Error(`Unsupported inbound image aes_key length: ${decoded.length}`);
  }

  private resolveInboundMediaUrl(
    account: WeixinAccountConfig,
    media: { full_url?: string; encrypt_query_param?: string }
  ): string {
    if (media.full_url?.trim()) {
      return media.full_url.trim();
    }

    if (!media.encrypt_query_param?.trim()) {
      throw new Error('Inbound media is missing both full_url and encrypt_query_param.');
    }

    const cdnBaseUrl = account.cdnBaseUrl ?? DEFAULT_CDN_BASE_URL;
    return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param.trim())}`;
  }

  private resolveOutboundUploadUrl(
    account: WeixinAccountConfig,
    response: WeixinGetUploadUrlResponse,
    filekey: string
  ): string | undefined {
    if (response.upload_full_url?.trim()) {
      return response.upload_full_url.trim();
    }

    if (!response.upload_param?.trim()) {
      return undefined;
    }

    const cdnBaseUrl = account.cdnBaseUrl ?? DEFAULT_CDN_BASE_URL;
    return (
      `${cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(response.upload_param.trim())}` +
      `&filekey=${encodeURIComponent(filekey)}`
    );
  }

  private async fetchBinary(url: string, label: string): Promise<Buffer> {
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`${label} ${response.status}: ${await response.text()}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private decryptAttachment(content: Buffer, aesKey: Buffer): Buffer {
    const decipher = createDecipheriv('aes-128-ecb', aesKey, null);
    decipher.setAutoPadding(true);
    return Buffer.concat([decipher.update(content), decipher.final()]);
  }

  private async postJson<T>(
    account: WeixinAccountConfig,
    endpoint: string,
    body: Record<string, unknown>,
    timeoutMs = this.config?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<T> {
    const serialized = JSON.stringify({
      ...body,
      base_info: {
        channel_version: this.config?.channelVersion ?? DEFAULT_CHANNEL_VERSION
      }
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    this.abortControllers.add(controller);

    try {
      const response = await this.fetchImpl(new URL(endpoint, this.getBaseUrl(account)), {
        method: 'POST',
        headers: this.buildHeaders(account, serialized),
        body: serialized,
        signal: controller.signal
      });

      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(`${endpoint} ${response.status}: ${rawText}`);
      }

      return (rawText ? JSON.parse(rawText) : {}) as T;
    } finally {
      clearTimeout(timeout);
      this.abortControllers.delete(controller);
    }
  }

  private buildHeaders(account: WeixinAccountConfig, body: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      AuthorizationType: 'ilink_bot_token',
      Authorization: `Bearer ${account.token.trim()}`,
      'Content-Length': String(Buffer.byteLength(body, 'utf8')),
      'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE(0)), 'utf8').toString('base64'),
      'iLink-App-ClientVersion': String(this.buildClientVersion(this.config?.channelVersion ?? DEFAULT_CHANNEL_VERSION))
    };

    if (this.config?.appId) {
      headers['iLink-App-Id'] = this.config.appId;
    }

    return headers;
  }

  private buildClientVersion(version: string): number {
    const parts = version.split('.').map((segment) => Number.parseInt(segment, 10) || 0);
    return (((parts[0] ?? 0) & 0xff) << 16) | (((parts[1] ?? 0) & 0xff) << 8) | ((parts[2] ?? 0) & 0xff);
  }

  private getBaseUrl(account: WeixinAccountConfig): string {
    const baseUrl = account.baseUrl ?? DEFAULT_BASE_URL;
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  private loadState(): void {
    const stateFile = this.config?.stateFile;
    if (!stateFile || !existsSync(stateFile)) {
      return;
    }

    try {
      const raw = JSON.parse(readFileSync(stateFile, 'utf8')) as PersistedWeixinState;
      for (const [accountId, cursor] of Object.entries(raw.cursors ?? {})) {
        this.cursors.set(accountId, cursor);
      }
      for (const [channelId, state] of Object.entries(raw.channels ?? {})) {
        this.channelStates.set(channelId, state);
      }
    } catch (error) {
      this.log('warn', 'Failed to load persisted Weixin state', {
        stateFile,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private persistState(): void {
    const stateFile = this.config?.stateFile;
    if (!stateFile) {
      return;
    }

    const snapshot: PersistedWeixinState = {
      cursors: Object.fromEntries(this.cursors.entries()),
      channels: Object.fromEntries(this.channelStates.entries())
    };

    mkdirSync(dirname(resolve(stateFile)), { recursive: true });
    writeFileSync(stateFile, JSON.stringify(snapshot, null, 2));
  }

  private getAccount(accountId: string): WeixinAccountConfig {
    const config = this.config;
    const account = (config?.accounts ?? []).find((candidate) => candidate.id === accountId);
    if (!account) {
      throw new Error(`Unknown Weixin account ${accountId}.`);
    }
    return account;
  }

  private resolveAccounts(config: WeixinAdapterConfig): WeixinAccountConfig[] {
    const configuredAccounts = (config.accounts ?? []).filter((account) => account.enabled !== false);
    const storedAccounts = loadStoredWeixinAccounts(config.authFile ?? getDefaultWeixinAuthFile());
    const storedById = new Map(storedAccounts.map((account) => [account.id, account]));

    if (configuredAccounts.length === 0) {
      return storedAccounts.map((account) => ({
        id: account.id,
        token: account.token,
        ilinkUserId: account.ilinkUserId,
        baseUrl: account.baseUrl,
        enabled: true
      }));
    }

    return configuredAccounts.map((account) => {
      const stored = storedById.get(account.id);
      return {
        ...account,
        token: account.token?.trim() || stored?.token || '',
        ilinkUserId: account.ilinkUserId?.trim() || stored?.ilinkUserId || '',
        baseUrl: account.baseUrl?.trim() || stored?.baseUrl || account.baseUrl
      };
    });
  }

  private getInboundMessageKey(accountId: string, message: WeixinInboundMessage): string {
    if (message.message_id !== undefined) {
      return `${accountId}:${message.message_id}`;
    }

    return `${accountId}:${message.from_user_id ?? ''}:${message.create_time_ms ?? 0}:${JSON.stringify(message.item_list ?? [])}`;
  }

  private isDuplicateInboundMessage(key: string): boolean {
    const now = Date.now();
    for (const [candidate, timestamp] of this.recentInboundMessages.entries()) {
      if (now - timestamp > RECENT_MESSAGE_TTL_MS) {
        this.recentInboundMessages.delete(candidate);
      }
    }

    if (this.recentInboundMessages.has(key)) {
      return true;
    }

    this.recentInboundMessages.set(key, now);
    return false;
  }

  private tryAcquireAccountLock(accountId: string): boolean {
    const lockDirectory = this.config?.lockDirectory;
    if (!lockDirectory) {
      return true;
    }

    const lockPath = resolve(lockDirectory, `${sanitizeLockSegment(accountId)}.lock`);
    mkdirSync(dirname(lockPath), { recursive: true });

    if (this.writeAccountLock(lockPath, accountId)) {
      if (this.waitingForAccountLocks.delete(accountId)) {
        this.log('info', 'Acquired Weixin account lock after waiting', {
          accountId,
          lockPath
        });
      }
      return true;
    }

    if (this.recoverStaleAccountLock(lockPath, accountId) && this.writeAccountLock(lockPath, accountId)) {
      if (this.waitingForAccountLocks.delete(accountId)) {
        this.log('info', 'Acquired Weixin account lock after waiting', {
          accountId,
          lockPath
        });
      }
      return true;
    }

    if (!this.waitingForAccountLocks.has(accountId)) {
      this.waitingForAccountLocks.add(accountId);
      this.log('warn', 'Waiting for Weixin account lock held by another gateway instance', {
        accountId,
        lockPath
      });
    }

    return false;
  }

  private releaseAccountLock(accountId: string): void {
    const lockPath = this.accountLockPaths.get(accountId);
    if (!lockPath) {
      return;
    }

    try {
      rmSync(lockPath, { force: true });
    } catch {
      // Best-effort cleanup.
    }

    this.accountLockPaths.delete(accountId);
    this.waitingForAccountLocks.delete(accountId);
  }

  private writeAccountLock(lockPath: string, accountId: string): boolean {
    try {
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, accountId, acquiredAt: new Date().toISOString() }, null, 2),
        { flag: 'wx' }
      );
      this.accountLockPaths.set(accountId, lockPath);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        return false;
      }

      throw error;
    }
  }

  private recoverStaleAccountLock(lockPath: string, accountId: string): boolean {
    const existingLock = this.readAccountLock(lockPath);

    if (!existingLock || typeof existingLock.pid !== 'number' || existingLock.pid <= 0) {
      this.removeStaleAccountLock(lockPath, accountId, existingLock, 'Lock file was unreadable or missing a valid pid');
      return true;
    }

    if (existingLock.pid === process.pid) {
      this.removeStaleAccountLock(lockPath, accountId, existingLock, 'Lock file belonged to the current process');
      return true;
    }

    if (!this.isProcessAlive(existingLock.pid)) {
      this.removeStaleAccountLock(lockPath, accountId, existingLock, `Lock owner pid ${existingLock.pid} is no longer running`);
      return true;
    }

    return false;
  }

  private readAccountLock(lockPath: string): WeixinAccountLock | null {
    try {
      return JSON.parse(readFileSync(lockPath, 'utf8')) as WeixinAccountLock;
    } catch {
      return null;
    }
  }

  private removeStaleAccountLock(
    lockPath: string,
    accountId: string,
    existingLock: WeixinAccountLock | null,
    reason: string
  ): void {
    try {
      rmSync(lockPath, { force: true });
    } catch {
      return;
    }

    this.log('info', 'Recovered stale Weixin account lock', {
      accountId,
      lockPath,
      reason,
      existingLock
    });
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') {
        return false;
      }

      if (code === 'EPERM') {
        return true;
      }

      throw error;
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }

  private log(level: 'info' | 'warn' | 'error', message: string, data: Record<string, unknown>): void {
    const method = this.logger[level];
    method?.call(this.logger, data, message);
  }
}
