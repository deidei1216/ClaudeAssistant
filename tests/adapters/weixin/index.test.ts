import { createCipheriv } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveStoredWeixinAccount } from '../../../adapters/weixin/account-store';
import { WeixinAdapter } from '../../../adapters/weixin';

function createAbortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

describe('WeixinAdapter', () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();

    while (tempDirectories.length > 0) {
      const directory = tempDirectories.pop();
      if (directory) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it('polls inbound messages and reuses the latest context token when replying', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    let getUpdatesCalls = 0;

    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      requests.push({ url, body });

      if (url.endsWith('/ilink/bot/getupdates')) {
        getUpdatesCalls += 1;
        if (getUpdatesCalls === 1) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ret: 0,
                msgs: [
                  {
                    message_id: 101,
                    from_user_id: 'user-1@im.wechat',
                    to_user_id: 'bot-1@im.wechat',
                    create_time_ms: Date.parse('2026-04-09T12:00:00.000Z'),
                    context_token: 'ctx-1',
                    message_type: 1,
                    item_list: [{ type: 1, text_item: { text: '你好' } }]
                  }
                ],
                get_updates_buf: 'cursor-1'
              })
          } as Response;
        }

        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(createAbortError());
            },
            { once: true }
          );
        });
      }

      if (url.endsWith('/ilink/bot/sendmessage')) {
        return {
          ok: true,
          status: 200,
          text: async () => '{}'
        } as Response;
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const adapter = new WeixinAdapter(fetchMock as never);
    const inboundMessages: string[] = [];

    await adapter.initialize({
      enabled: true,
      accounts: [
        {
          id: 'acct-1',
          token: 'token-1',
          ilinkUserId: 'bot-1@im.wechat'
        }
      ]
    });
    adapter.onMessage(async (message) => {
      inboundMessages.push(message.content);
    });

    await adapter.connect();
    await vi.waitFor(() => {
      expect(inboundMessages).toEqual(['你好']);
    });

    const result = await adapter.sendMessage('acct-1:user-1@im.wechat', '收到');

    const sendRequests = requests.filter((request) => request.url.endsWith('/ilink/bot/sendmessage'));

    expect(sendRequests).toHaveLength(1);
    expect(sendRequests[0]?.body).toEqual({
      msg: {
        from_user_id: '',
        to_user_id: 'user-1@im.wechat',
        client_id: expect.stringMatching(/^gateway-/),
        message_type: 2,
        message_state: 2,
        context_token: 'ctx-1',
        item_list: [{ type: 1, text_item: { text: '收到' } }]
      },
      base_info: {
        channel_version: '2.1.1'
      }
    });
    expect(result).toEqual({
      messageId: expect.stringMatching(/^gateway-/),
      success: true
    });

    await adapter.disconnect();
  });

  it('fetches a typing ticket and sends typing status', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    let getUpdatesCalls = 0;

    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      requests.push({ url, body });

      if (url.endsWith('/ilink/bot/getupdates')) {
        getUpdatesCalls += 1;
        if (getUpdatesCalls === 1) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ret: 0,
                msgs: [
                  {
                    message_id: 201,
                    from_user_id: 'user-2@im.wechat',
                    to_user_id: 'bot-1@im.wechat',
                    create_time_ms: Date.parse('2026-04-09T12:01:00.000Z'),
                    context_token: 'ctx-typing',
                    message_type: 1,
                    item_list: [{ type: 1, text_item: { text: '在吗' } }]
                  }
                ],
                get_updates_buf: 'cursor-2'
              })
          } as Response;
        }

        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(createAbortError());
            },
            { once: true }
          );
        });
      }

      if (url.endsWith('/ilink/bot/getconfig')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ret: 0, typing_ticket: 'ticket-1' })
        } as Response;
      }

      if (url.endsWith('/ilink/bot/sendtyping')) {
        return {
          ok: true,
          status: 200,
          text: async () => '{}'
        } as Response;
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const adapter = new WeixinAdapter(fetchMock as never);
    const inboundMessages: string[] = [];

    await adapter.initialize({
      enabled: true,
      accounts: [
        {
          id: 'acct-1',
          token: 'token-1',
          ilinkUserId: 'bot-1@im.wechat'
        }
      ]
    });
    adapter.onMessage(async (message) => {
      inboundMessages.push(message.content);
    });

    await adapter.connect();
    await vi.waitFor(() => {
      expect(inboundMessages).toEqual(['在吗']);
    });

    await adapter.setTyping('acct-1:user-2@im.wechat', true);

    const getConfigRequest = requests.find((request) => request.url.endsWith('/ilink/bot/getconfig'));
    const sendTypingRequest = requests.find((request) => request.url.endsWith('/ilink/bot/sendtyping'));

    expect(getConfigRequest?.body).toEqual({
      ilink_user_id: 'bot-1@im.wechat',
      context_token: 'ctx-typing',
      base_info: {
        channel_version: '2.1.1'
      }
    });
    expect(sendTypingRequest?.body).toEqual({
      ilink_user_id: 'bot-1@im.wechat',
      typing_ticket: 'ticket-1',
      status: 1,
      base_info: {
        channel_version: '2.1.1'
      }
    });

    await adapter.disconnect();
  });

  it('uploads outbound attachments and persists channel state', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'weixin-adapter-'));
    tempDirectories.push(tempRoot);

    const attachmentPath = join(tempRoot, 'report.txt');
    const stateFile = join(tempRoot, 'weixin-state.json');
    writeFileSync(attachmentPath, 'hello from attachment');

    const requests: Array<{
      url: string;
      method: string;
      body?: Record<string, unknown>;
      binary?: Buffer;
    }> = [];
    let getUpdatesCalls = 0;

    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/ilink/bot/getupdates')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        requests.push({ url, method, body });
        getUpdatesCalls += 1;

        if (getUpdatesCalls === 1) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ret: 0,
                msgs: [
                  {
                    message_id: 301,
                    from_user_id: 'user-3@im.wechat',
                    to_user_id: 'bot-1@im.wechat',
                    create_time_ms: Date.parse('2026-04-09T12:02:00.000Z'),
                    context_token: 'ctx-upload',
                    message_type: 1,
                    item_list: [{ type: 1, text_item: { text: '给我文件' } }]
                  }
                ],
                get_updates_buf: 'cursor-upload'
              })
          } as Response;
        }

        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(createAbortError());
            },
            { once: true }
          );
        });
      }

      if (url.endsWith('/ilink/bot/getuploadurl')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        requests.push({ url, method, body });

        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              upload_param: 'enc-param-1',
              upload_full_url: 'https://cdn.weixin.example/upload/1'
            })
        } as Response;
      }

      if (url === 'https://cdn.weixin.example/upload/1') {
        requests.push({ url, method, binary: Buffer.from(init?.body as Buffer) });
        return {
          ok: true,
          status: 200,
          text: async () => '',
          headers: {
            get(name: string) {
              return name.toLowerCase() === 'x-encrypted-param' ? 'download-param-1' : null;
            }
          }
        } as Response;
      }

      if (url.endsWith('/ilink/bot/sendmessage')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        requests.push({ url, method, body });
        return {
          ok: true,
          status: 200,
          text: async () => '{}'
        } as Response;
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const adapter = new WeixinAdapter(fetchMock as never);

    await adapter.initialize({
      enabled: true,
      stateFile,
      accounts: [
        {
          id: 'acct-1',
          token: 'token-1',
          ilinkUserId: 'bot-1@im.wechat'
        }
      ]
    });
    adapter.onMessage(async () => undefined);

    await adapter.connect();
    await vi.waitFor(() => {
      expect(readFileSync(stateFile, 'utf8')).toContain('ctx-upload');
    });

    const result = await adapter.sendMessage('acct-1:user-3@im.wechat', '已上传', {
      attachments: [
        {
          id: 'att-1',
          name: 'report.txt',
          type: 'text/plain',
          size: 21,
          url: attachmentPath,
          localPath: attachmentPath
        }
      ]
    });

    const uploadRequest = requests.find((request) => request.url.endsWith('/ilink/bot/getuploadurl'));
    const cdnUploadRequest = requests.find((request) => request.url === 'https://cdn.weixin.example/upload/1');
    const sendRequests = requests.filter((request) => request.url.endsWith('/ilink/bot/sendmessage'));

    expect(uploadRequest?.body).toEqual({
      filekey: expect.stringMatching(/^[0-9a-f]{32}$/),
      media_type: 3,
      to_user_id: 'user-3@im.wechat',
      rawsize: 21,
      rawfilemd5: expect.any(String),
      filesize: expect.any(Number),
      no_need_thumb: true,
      aeskey: expect.any(String),
      base_info: {
        channel_version: '2.1.1'
      }
    });
    expect(cdnUploadRequest?.method).toBe('POST');
    expect(cdnUploadRequest?.binary && cdnUploadRequest.binary.length).toBeGreaterThan(21);
    expect(sendRequests).toHaveLength(2);
    expect(sendRequests[0]?.body).toEqual({
      msg: {
        from_user_id: '',
        to_user_id: 'user-3@im.wechat',
        client_id: expect.stringMatching(/^gateway-/),
        message_type: 2,
        message_state: 2,
        context_token: 'ctx-upload',
        item_list: [{ type: 1, text_item: { text: '已上传' } }]
      },
      base_info: {
        channel_version: '2.1.1'
      }
    });
    expect(sendRequests[1]?.body).toEqual({
      msg: {
        from_user_id: '',
        to_user_id: 'user-3@im.wechat',
        client_id: expect.stringMatching(/^gateway-/),
        message_type: 2,
        message_state: 2,
        context_token: 'ctx-upload',
        item_list: [
          {
            type: 4,
            file_item: {
              media: {
                encrypt_query_param: 'download-param-1',
                aes_key: expect.any(String),
                encrypt_type: 1
              },
              file_name: 'report.txt',
              md5: expect.any(String),
              len: '21'
            }
          }
        ]
      },
      base_info: {
        channel_version: '2.1.1'
      }
    });
    expect(JSON.parse(readFileSync(stateFile, 'utf8'))).toEqual(
      expect.objectContaining({
        cursors: { 'acct-1': 'cursor-upload' },
        channels: {
          'acct-1:user-3@im.wechat': expect.objectContaining({
            contextToken: 'ctx-upload'
          })
        }
      })
    );
    expect(result).toEqual({
      messageId: expect.stringMatching(/^gateway-/),
      success: true
    });

    await adapter.disconnect();
  });

  it('uploads outbound attachments when getuploadurl only returns upload_param', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'weixin-adapter-'));
    tempDirectories.push(tempRoot);

    const attachmentPath = join(tempRoot, 'report.docx');
    writeFileSync(attachmentPath, 'docx payload');

    const requests: Array<{
      url: string;
      method: string;
      body?: Record<string, unknown>;
      binary?: Buffer;
    }> = [];

    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/ilink/bot/getuploadurl')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        requests.push({ url, method, body });

        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              upload_param: 'enc-only-param'
            })
        } as Response;
      }

      if (url.startsWith('https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=enc-only-param&filekey=')) {
        requests.push({ url, method, binary: Buffer.from(init?.body as Buffer) });
        return {
          ok: true,
          status: 200,
          text: async () => '',
          headers: {
            get(name: string) {
              return name.toLowerCase() === 'x-encrypted-param' ? 'download-param-only' : null;
            }
          }
        } as Response;
      }

      if (url.endsWith('/ilink/bot/sendmessage')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        requests.push({ url, method, body });
        return {
          ok: true,
          status: 200,
          text: async () => '{}'
        } as Response;
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const adapter = new WeixinAdapter(fetchMock as never);

    await adapter.initialize({
      enabled: true,
      accounts: [
        {
          id: 'acct-1',
          token: 'token-1',
          ilinkUserId: 'bot-1@im.wechat'
        }
      ]
    });

    // Seed the channel state directly so the send path can resolve the target peer.
    (adapter as unknown as { channelStates: Map<string, { accountId: string; peerUserId: string; contextToken?: string }> }).channelStates.set(
      'acct-1:user-4@im.wechat',
      {
        accountId: 'acct-1',
        peerUserId: 'user-4@im.wechat',
        contextToken: 'ctx-upload'
      }
    );

    const result = await adapter.sendMessage('acct-1:user-4@im.wechat', '发文件', {
      attachments: [
        {
          id: 'att-docx',
          name: 'report.docx',
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 12,
          url: attachmentPath,
          localPath: attachmentPath
        }
      ]
    });

    const cdnUploadRequest = requests.find((request) =>
      request.url.startsWith('https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=enc-only-param&filekey=')
    );
    const sendRequests = requests.filter((request) => request.url.endsWith('/ilink/bot/sendmessage'));

    expect(result).toEqual({
      messageId: expect.stringMatching(/^gateway-/),
      success: true
    });
    expect(cdnUploadRequest?.method).toBe('POST');
    expect(cdnUploadRequest?.binary && cdnUploadRequest.binary.length).toBeGreaterThan(12);
    expect(sendRequests).toHaveLength(2);
    expect(sendRequests[0]?.body).toEqual({
      msg: {
        from_user_id: '',
        to_user_id: 'user-4@im.wechat',
        client_id: expect.stringMatching(/^gateway-/),
        message_type: 2,
        message_state: 2,
        context_token: 'ctx-upload',
        item_list: [{ type: 1, text_item: { text: '发文件' } }]
      },
      base_info: {
        channel_version: '2.1.1'
      }
    });
    expect(sendRequests[1]?.body).toEqual({
      msg: {
        from_user_id: '',
        to_user_id: 'user-4@im.wechat',
        client_id: expect.stringMatching(/^gateway-/),
        message_type: 2,
        message_state: 2,
        context_token: 'ctx-upload',
        item_list: [
          {
            type: 4,
            file_item: {
              media: {
                encrypt_query_param: 'download-param-only',
                aes_key: expect.any(String),
                encrypt_type: 1
              },
              file_name: 'report.docx',
              md5: expect.any(String),
              len: '12'
            }
          }
        ]
      },
      base_info: {
        channel_version: '2.1.1'
      }
    });
  });

  it('uploads outbound attachments when getuploadurl only returns upload_full_url', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'weixin-adapter-'));
    tempDirectories.push(tempRoot);

    const attachmentPath = join(tempRoot, 'report.docx');
    writeFileSync(attachmentPath, 'docx payload');

    const requests: Array<{
      url: string;
      method: string;
      body?: Record<string, unknown>;
      binary?: Buffer;
    }> = [];

    const uploadFullUrl =
      'https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=enc-from-full-url&filekey=test&taskid=abc';

    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/ilink/bot/getuploadurl')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        requests.push({ url, method, body });

        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              upload_full_url: uploadFullUrl
            })
        } as Response;
      }

      if (url === uploadFullUrl) {
        requests.push({ url, method, binary: Buffer.from(init?.body as Buffer) });
        return {
          ok: true,
          status: 200,
          text: async () => '',
          headers: {
            get(name: string) {
              return name.toLowerCase() === 'x-encrypted-param' ? 'download-from-header' : null;
            }
          }
        } as Response;
      }

      if (url.endsWith('/ilink/bot/sendmessage')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        requests.push({ url, method, body });
        return {
          ok: true,
          status: 200,
          text: async () => '{}'
        } as Response;
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const adapter = new WeixinAdapter(fetchMock as never);

    await adapter.initialize({
      enabled: true,
      accounts: [
        {
          id: 'acct-1',
          token: 'token-1',
          ilinkUserId: 'bot-1@im.wechat'
        }
      ]
    });

    (adapter as unknown as { channelStates: Map<string, { accountId: string; peerUserId: string; contextToken?: string }> }).channelStates.set(
      'acct-1:user-6@im.wechat',
      {
        accountId: 'acct-1',
        peerUserId: 'user-6@im.wechat',
        contextToken: 'ctx-upload'
      }
    );

    const result = await adapter.sendMessage('acct-1:user-6@im.wechat', '发文件', {
      attachments: [
        {
          id: 'att-docx-full-url',
          name: 'report.docx',
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 12,
          url: attachmentPath,
          localPath: attachmentPath
        }
      ]
    });

    const sendRequests = requests.filter((request) => request.url.endsWith('/ilink/bot/sendmessage'));

    expect(result).toEqual({
      messageId: expect.stringMatching(/^gateway-/),
      success: true
    });
    expect(sendRequests).toHaveLength(2);
    expect(sendRequests[0]?.body).toEqual({
      msg: {
        from_user_id: '',
        to_user_id: 'user-6@im.wechat',
        client_id: expect.stringMatching(/^gateway-/),
        message_type: 2,
        message_state: 2,
        context_token: 'ctx-upload',
        item_list: [{ type: 1, text_item: { text: '发文件' } }]
      },
      base_info: {
        channel_version: '2.1.1'
      }
    });
    expect(sendRequests[1]?.body).toEqual({
      msg: {
        from_user_id: '',
        to_user_id: 'user-6@im.wechat',
        client_id: expect.stringMatching(/^gateway-/),
        message_type: 2,
        message_state: 2,
        context_token: 'ctx-upload',
        item_list: [
          {
            type: 4,
            file_item: {
              media: {
                encrypt_query_param: 'download-from-header',
                aes_key: expect.any(String),
                encrypt_type: 1
              },
              file_name: 'report.docx',
              md5: expect.any(String),
              len: '12'
            }
          }
        ]
      },
      base_info: {
        channel_version: '2.1.1'
      }
    });
  });

  it('retries getuploadurl when weixin returns a transient failure before succeeding', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'weixin-adapter-'));
    tempDirectories.push(tempRoot);

    const attachmentPath = join(tempRoot, 'report.docx');
    writeFileSync(attachmentPath, 'docx payload');

    const requests: Array<{
      url: string;
      method: string;
      body?: Record<string, unknown>;
    }> = [];
    let uploadAttempts = 0;

    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/ilink/bot/getuploadurl')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        requests.push({ url, method, body });
        uploadAttempts += 1;

        if (uploadAttempts === 1) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ret: -1 })
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              upload_full_url:
                'https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=retry-success&filekey=test&taskid=ok'
            })
        } as Response;
      }

      if (
        url ===
        'https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=retry-success&filekey=test&taskid=ok'
      ) {
        return {
          ok: true,
          status: 200,
          text: async () => '',
          headers: {
            get(name: string) {
              return name.toLowerCase() === 'x-encrypted-param' ? 'download-param-retry' : null;
            }
          }
        } as Response;
      }

      if (url.endsWith('/ilink/bot/sendmessage')) {
        return {
          ok: true,
          status: 200,
          text: async () => '{}'
        } as Response;
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const adapter = new WeixinAdapter(fetchMock as never);

    await adapter.initialize({
      enabled: true,
      accounts: [
        {
          id: 'acct-1',
          token: 'token-1',
          ilinkUserId: 'bot-1@im.wechat'
        }
      ]
    });

    (adapter as unknown as { channelStates: Map<string, { accountId: string; peerUserId: string; contextToken?: string }> }).channelStates.set(
      'acct-1:user-7@im.wechat',
      {
        accountId: 'acct-1',
        peerUserId: 'user-7@im.wechat',
        contextToken: 'ctx-upload'
      }
    );

    const result = await adapter.sendMessage('acct-1:user-7@im.wechat', '发文件', {
      attachments: [
        {
          id: 'att-docx-retry',
          name: 'report.docx',
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 12,
          url: attachmentPath,
          localPath: attachmentPath
        }
      ]
    });

    expect(result.success).toBe(true);
    expect(uploadAttempts).toBe(2);
    expect(requests.filter((request) => request.url.endsWith('/ilink/bot/getuploadurl'))).toHaveLength(2);
  });

  it('loads saved accounts when config accounts are omitted', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'weixin-adapter-auth-'));
    tempDirectories.push(tempRoot);

    const authFile = join(tempRoot, 'weixin-auth.json');
    saveStoredWeixinAccount(
      {
        id: 'acct-saved',
        token: 'token-saved',
        ilinkUserId: 'bot-saved@im.wechat',
        baseUrl: 'https://ilinkai.weixin.qq.com',
        savedAt: '2026-04-09T00:00:00.000Z'
      },
      authFile
    );

    const requests: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      requests.push({ url, body });

      if (url.endsWith('/ilink/bot/getupdates')) {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(createAbortError());
            },
            { once: true }
          );
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const adapter = new WeixinAdapter(fetchMock as never);
    await adapter.initialize({
      enabled: true,
      authFile,
      accounts: []
    });
    adapter.onMessage(async () => undefined);

    await adapter.connect();
    await vi.waitFor(() => {
      expect(requests[0]).toEqual({
        url: 'https://ilinkai.weixin.qq.com/ilink/bot/getupdates',
        body: {
          get_updates_buf: '',
          base_info: {
            channel_version: '2.1.1'
          }
        }
      });
    });
    await adapter.disconnect();
  });

  it('deduplicates repeated inbound messages with the same message id', async () => {
    let getUpdatesCalls = 0;
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/ilink/bot/getupdates')) {
        getUpdatesCalls += 1;
        if (getUpdatesCalls === 1) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ret: 0,
                msgs: [
                  {
                    message_id: 401,
                    from_user_id: 'user-4@im.wechat',
                    to_user_id: 'bot-1@im.wechat',
                    create_time_ms: Date.parse('2026-04-10T00:00:00.000Z'),
                    context_token: 'ctx-dup',
                    message_type: 1,
                    item_list: [{ type: 1, text_item: { text: '重复测试' } }]
                  },
                  {
                    message_id: 401,
                    from_user_id: 'user-4@im.wechat',
                    to_user_id: 'bot-1@im.wechat',
                    create_time_ms: Date.parse('2026-04-10T00:00:00.000Z'),
                    context_token: 'ctx-dup',
                    message_type: 1,
                    item_list: [{ type: 1, text_item: { text: '重复测试' } }]
                  }
                ],
                get_updates_buf: 'cursor-dup'
              })
          } as Response;
        }

        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(createAbortError()),
            { once: true }
          );
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const adapter = new WeixinAdapter(fetchMock as never);
    const inboundMessages: string[] = [];

    await adapter.initialize({
      enabled: true,
      accounts: [
        {
          id: 'acct-1',
          token: 'token-1',
          ilinkUserId: 'bot-1@im.wechat'
        }
      ]
    });
    adapter.onMessage(async (message) => {
      inboundMessages.push(message.content);
    });

    await adapter.connect();
    await vi.waitFor(() => {
      expect(inboundMessages).toEqual(['重复测试']);
    });
    await adapter.disconnect();
  });

  it('downloads inbound images as attachments instead of text placeholders', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'weixin-adapter-image-'));
    tempDirectories.push(tempRoot);

    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
    ]);
    const aesKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const cipher = createCipheriv('aes-128-ecb', aesKey, null);
    cipher.setAutoPadding(true);
    const encryptedPng = Buffer.concat([cipher.update(pngBytes), cipher.final()]);

    let getUpdatesCalls = 0;
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/ilink/bot/getupdates')) {
        getUpdatesCalls += 1;
        if (getUpdatesCalls === 1) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ret: 0,
                msgs: [
                  {
                    message_id: 501,
                    from_user_id: 'user-5@im.wechat',
                    to_user_id: 'bot-1@im.wechat',
                    create_time_ms: Date.parse('2026-04-10T00:10:00.000Z'),
                    context_token: 'ctx-image',
                    message_type: 1,
                    item_list: [
                      {
                        type: 2,
                        image_item: {
                          aeskey: aesKey.toString('hex'),
                          media: {
                            full_url: 'https://cdn.weixin.example/download/1'
                          }
                        }
                      }
                    ]
                  }
                ],
                get_updates_buf: 'cursor-image'
              })
          } as Response;
        }

        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(createAbortError()),
            { once: true }
          );
        });
      }

      if (url === 'https://cdn.weixin.example/download/1') {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => encryptedPng.buffer.slice(
            encryptedPng.byteOffset,
            encryptedPng.byteOffset + encryptedPng.byteLength
          ),
          text: async () => ''
        } as Response;
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const adapter = new WeixinAdapter(fetchMock as never);
    const inboundMessages: Array<{ content: string; attachment?: string; attachmentType?: string }> = [];

    await adapter.initialize({
      enabled: true,
      rootDirectory: tempRoot,
      accounts: [
        {
          id: 'acct-1',
          token: 'token-1',
          ilinkUserId: 'bot-1@im.wechat'
        }
      ]
    });
    adapter.onMessage(async (message) => {
      inboundMessages.push({
        content: message.content,
        attachment: message.attachments?.[0]?.localPath,
        attachmentType: message.attachments?.[0]?.type
      });
    });

    await adapter.connect();
    await vi.waitFor(() => {
      expect(inboundMessages).toEqual([
        {
          content: '',
          attachment: expect.stringContaining(`${tempRoot}/.claude-gateway/inbox/acct-1:user-5@im.wechat/`),
          attachmentType: 'image/png'
        }
      ]);
    });
    expect(readFileSync(inboundMessages[0].attachment ?? '')).toEqual(pngBytes);

    await adapter.disconnect();
  });
});
