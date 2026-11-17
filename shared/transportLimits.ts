// UTF-8 byte ceilings for distinct boundaries, not token limits. Required context
// is never trimmed to fit; request overflow remains recoverable by JSON export.
export const HTTP_REQUEST_BYTES = 1024 * 1024;
export const MODEL_OUTPUT_BYTES = 2 * 1024 * 1024;
// The final MVP brief is a document. Its text ceiling is shared by the model
// contract, preview parser and server; wire byte ceilings remain separate.
export const ASSISTANT_TEXT_CHARS = 64000;
export const VALIDATED_REPLY_BYTES = 2 * 1024 * 1024;
export const CHAT_RESPONSE_BYTES = 4 * 1024 * 1024;
export const CHAT_STREAM_BYTES = 8 * 1024 * 1024;
