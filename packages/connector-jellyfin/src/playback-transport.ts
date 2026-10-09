import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import type { Api } from '@jellyfin/sdk/lib/api.js';
import { ConnectorError } from '@openflix/connector-core';
import type { PlaybackStream, PlaybackStreamRequest } from '@openflix/connector-core';
export function binaryTransport(
  api: Api,
  url: URL,
  request: PlaybackStreamRequest,
  contentType: string,
  acceptedTypes: readonly string[],
  maxBytes?: number,
  headerTimeout = 5000,
): Promise<PlaybackStream> {
  return new Promise<PlaybackStream>((resolve, reject) => {
    const fail = (
      code:
        | 'unavailable'
        | 'timeout'
        | 'invalid_response'
        | 'unsafe_redirect'
        | 'unauthorized'
        | 'not_found',
    ) => reject(new ConnectorError(code));
    const upstream = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: request.method,
      agent: false,
      signal: request.signal,
      headers: {
        Authorization: api.authorizationHeader,
        Accept: contentType,
        'Accept-Encoding': 'identity',
        ...(request.range ? { Range: request.range } : {}),
      },
      maxHeaderSize: 16384,
    });
    const deadline = setTimeout(
      () => upstream.destroy(new ConnectorError('timeout')),
      headerTimeout,
    );
    deadline.unref();
    upstream.setTimeout(30000, () => upstream.destroy(new ConnectorError('timeout')));
    upstream.on('error', () => {
      clearTimeout(deadline);
      fail(request.signal.aborted ? 'timeout' : 'unavailable');
    });
    upstream.once('response', (response) => {
      clearTimeout(deadline);
      const status = response.statusCode ?? 0;
      const cancel = () => {
        response.destroy();
        upstream.destroy();
      };
      const invalid = (code: Parameters<typeof fail>[0]) => {
        cancel();
        fail(code);
      };
      if (status >= 300 && status < 400) return invalid('unsafe_redirect');
      if (status === 401 || status === 403) return invalid('unauthorized');
      if (status === 404) return invalid('not_found');
      if (![200, 206, 416].includes(status)) return invalid('unavailable');
      const headers: Record<string, string> = {};
      const contentRange = response.headers['content-range'];
      if (status === 416) {
        if (!request.range || !contentRange || !/^bytes \*\/\d{1,15}$/.test(contentRange))
          return invalid('invalid_response');
        headers['content-range'] = contentRange;
        cancel();
        resolve({ status: 416, headers, cancel });
        return;
      }
      const mime = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
      if (
        !acceptedTypes.includes(mime ?? '') ||
        (response.headers['content-encoding'] &&
          response.headers['content-encoding'] !== 'identity')
      )
        return invalid('invalid_response');
      headers['content-type'] = contentType;
      const length = response.headers['content-length'];
      if (length !== undefined) {
        if (!/^\d{1,15}$/.test(length) || (maxBytes !== undefined && Number(length) > maxBytes))
          return invalid('invalid_response');
        headers['content-length'] = length;
      }
      if (status === 206) {
        const m = contentRange && /^bytes (\d{1,15})-(\d{1,15})\/(\d{1,15})$/.exec(contentRange);
        if (
          !request.range ||
          !m ||
          Number(m[2]) < Number(m[1]) ||
          Number(m[3]) <= Number(m[2]) ||
          (length !== undefined && Number(length) !== Number(m[2]) - Number(m[1]) + 1)
        )
          return invalid('invalid_response');
        const requested = /^bytes=(\d*)-(\d*)$/.exec(request.range)!;
        const total = Number(m[3]);
        const expectedStart = requested[1]
          ? Number(requested[1])
          : Math.max(0, total - Number(requested[2]));
        const expectedEnd =
          requested[1] && requested[2] ? Math.min(total - 1, Number(requested[2])) : total - 1;
        if (Number(m[1]) !== expectedStart || Number(m[2]) !== expectedEnd)
          return invalid('invalid_response');
        headers['content-range'] = contentRange!;
      }
      if (response.headers['accept-ranges'] === 'bytes') headers['accept-ranges'] = 'bytes';
      if (request.method === 'HEAD') {
        cancel();
        resolve({ status: status as 200 | 206, headers, cancel });
        return;
      }
      response.on('error', () => {});
      const body = Readable.from(
        (async function* () {
          try {
            let received = 0;
            for await (const chunk of response) {
              received += chunk.length;
              if (maxBytes !== undefined && received > maxBytes)
                throw new ConnectorError('invalid_response');
              yield chunk;
            }
          } catch (error) {
            if (error instanceof ConnectorError) throw error;
            throw new ConnectorError('unavailable');
          } finally {
            cancel();
          }
        })(),
        { objectMode: false, highWaterMark: 65536 },
      );
      body.on('error', () => {});
      body.once('close', cancel);
      resolve({ status: status as 200 | 206, headers, body, cancel });
    });
    upstream.end();
  });
}
