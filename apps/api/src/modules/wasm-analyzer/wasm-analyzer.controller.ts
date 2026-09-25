import { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env';
import { wasmAnalyzerService } from './wasm-analyzer.service';

// WASM is served/uploaded under a handful of content-types in practice
// depending on the client (browsers, curl, the Soroban CLI); anything else
// is rejected before we even try to buffer the body.
const ALLOWED_CONTENT_TYPES = new Set(['application/wasm', 'application/octet-stream', 'application/x-wasm']);

export class WasmAnalyzerController {
  async analyze(request: FastifyRequest, reply: FastifyReply) {
    if (!request.isMultipart()) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Expected a multipart/form-data upload with a single "file" field.',
        code: 'NOT_MULTIPART',
      });
    }

    let uploaded;
    try {
      uploaded = await request.file({ limits: { fileSize: env.WASM_ANALYZER_MAX_UPLOAD_BYTES } });
    } catch (err: any) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: `Could not read multipart upload: ${err?.message || err}`,
        code: 'MULTIPART_READ_ERROR',
      });
    }

    if (!uploaded) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'No file field found in the upload. Expected a field named "file".',
        code: 'FILE_MISSING',
      });
    }

    if (!ALLOWED_CONTENT_TYPES.has(uploaded.mimetype)) {
      // Drain the stream so the connection can be reused even though we're
      // rejecting the request.
      await uploaded.toBuffer().catch(() => undefined);
      return reply.status(415).send({
        error: 'Unsupported Media Type',
        message: `Content-Type "${uploaded.mimetype}" is not accepted. Expected one of: ${[...ALLOWED_CONTENT_TYPES].join(', ')}.`,
        code: 'UNSUPPORTED_CONTENT_TYPE',
      });
    }

    let buffer: Buffer;
    try {
      buffer = await uploaded.toBuffer();
    } catch (err: any) {
      if (uploaded.file.truncated || err?.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.status(413).send({
          error: 'Payload Too Large',
          message: `Upload exceeds the ${env.WASM_ANALYZER_MAX_UPLOAD_BYTES} byte limit.`,
          code: 'FILE_TOO_LARGE',
        });
      }
      return reply.status(400).send({
        error: 'Bad Request',
        message: `Failed to read upload body: ${err?.message || err}`,
        code: 'BODY_READ_ERROR',
      });
    }

    if (uploaded.file.truncated) {
      return reply.status(413).send({
        error: 'Payload Too Large',
        message: `Upload exceeds the ${env.WASM_ANALYZER_MAX_UPLOAD_BYTES} byte limit.`,
        code: 'FILE_TOO_LARGE',
      });
    }

    if (buffer.length === 0) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Uploaded file is empty.',
        code: 'FILE_EMPTY',
      });
    }

    const result = await wasmAnalyzerService.analyze(buffer, {
      filename: uploaded.filename,
      contentType: uploaded.mimetype,
      sizeBytes: buffer.length,
      userId: request.user?.id,
    });

    return reply.status(200).send({ success: true, ...result });
  }
}

export const wasmAnalyzerController = new WasmAnalyzerController();
