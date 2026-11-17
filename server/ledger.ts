import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { ChatResponse, ApiError, ExternalEvidence } from '../shared/types.js';
import { ServiceError } from './errors.js';

export function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export interface LedgerOptions {
  budgetUsd: number; maxConcurrent: number; sessionConcurrent: number; sessionRate: number;
  ipRate: number; rateWindowMs: number; responseTtlMs: number; maxCachedResponses: number;
  timeoutMs: number; now?: () => number;
}
const defaults: LedgerOptions = { budgetUsd: 0, maxConcurrent: 3, sessionConcurrent: 1, sessionRate: 12, ipRate: 30, rateWindowMs: 60_000, responseTtlMs: 86_400_000, maxCachedResponses: 200, timeoutMs: 60_000 };
interface LedgerRow { body_hash: string; state: string; reserved: number; charged: number; response: string | null; http_status: number }
export interface OperationEvent {
  id: string; kind: 'plan' | 'search' | 'read' | 'generate' | 'skill' | 'evaluate'; inputHash: string;
  state: 'started' | 'completed' | 'failed' | 'unknown'; reservedUsd?: number; chargedUsd?: number;
  usage?: { inputTokens: number; outputTokens: number }; toolCalls?: number; errorCode?: string;
  metadata?: Record<string, unknown>;
}
export interface Reservation { session: string; requestId: string; stepwise?: true }
export type ReservationResult = { kind: 'reserved'; reservation: Reservation } | { kind: 'cached'; status: number; body: ChatResponse | ApiError };
const units = (usd: number) => {
  const value = Math.ceil(usd * 1_000_000_000);
  if (!Number.isFinite(usd) || usd < 0 || !Number.isSafeInteger(value)) throw new Error('Invalid monetary amount.');
  return value;
};
/** All monetary values are integral nano-USD; reservations and limits share one write transaction. */
export class BudgetLedger {
  private db: DatabaseSync;
  private options: LedgerOptions;
  private now: () => number;
  constructor(filename: string, options: Partial<LedgerOptions> = {}) {
    this.options = { ...defaults, ...options };
    this.now = options.now || Date.now;
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (
        session TEXT NOT NULL, request_id TEXT NOT NULL, body_hash TEXT NOT NULL, state TEXT NOT NULL,
        reserved INTEGER NOT NULL, charged INTEGER NOT NULL DEFAULT 0, pending_until INTEGER NOT NULL,
        response TEXT, http_status INTEGER NOT NULL DEFAULT 200, expires INTEGER NOT NULL, updated INTEGER NOT NULL,
        PRIMARY KEY (session, request_id)
      );
      CREATE TABLE IF NOT EXISTS operations (
        session TEXT NOT NULL, request_id TEXT NOT NULL, operation_id TEXT NOT NULL, kind TEXT NOT NULL,
        input_hash TEXT NOT NULL, state TEXT NOT NULL, reserved INTEGER NOT NULL, charged INTEGER NOT NULL DEFAULT 0,
        metadata TEXT, error_code TEXT, started INTEGER NOT NULL, finished INTEGER,
        PRIMARY KEY(session, request_id, operation_id)
      );
      CREATE INDEX IF NOT EXISTS requests_state ON requests(state, pending_until);
      CREATE INDEX IF NOT EXISTS requests_request_id ON requests(request_id);
      CREATE TABLE IF NOT EXISTS session_issuance (ip TEXT NOT NULL, time INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS session_issuance_ip ON session_issuance(ip, time);
      CREATE TABLE IF NOT EXISTS attempts (session TEXT NOT NULL, ip TEXT NOT NULL, time INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS attempts_session ON attempts(session, time);
      CREATE INDEX IF NOT EXISTS attempts_ip ON attempts(ip, time);
    `);
    this.maintenance();
  }
  private maintenance(): void {
    this.transaction(() => {
      this.db.prepare('UPDATE requests SET response = NULL WHERE response IS NOT NULL AND expires <= ?').run(this.now());
      this.db.prepare("UPDATE operations SET state = 'unknown', charged = reserved, finished = ? WHERE state = 'started' AND EXISTS (SELECT 1 FROM requests r WHERE r.session = operations.session AND r.request_id = operations.request_id AND r.state = 'pending' AND r.pending_until <= ?)").run(this.now(), this.now());
      this.db.prepare("UPDATE requests SET state = 'unknown', charged = reserved WHERE state = 'pending' AND pending_until <= ?").run(this.now());
    });
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  session(token?: string): string | null {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const id = hash(token);
    return this.db.prepare('SELECT id FROM sessions WHERE id = ? AND expires > ?').get(id, this.now()) ? id : null;
  }
  createSession(ip = 'unknown'): string {
    return this.transaction(() => {
      const now = this.now();
      const ipHash = hash(ip);
      // Admission is atomic and independent of paid-chat limits; no session exists until it passes.
      this.db.prepare('DELETE FROM session_issuance WHERE time <= ?').run(now - 60_000);
      const issued = Number(this.db.prepare('SELECT COUNT(*) AS n FROM session_issuance WHERE ip = ?').get(ipHash)?.n);
      if ((this.options.sessionRate > 0 || this.options.ipRate > 0) && issued >= 10) throw new ServiceError('SESSION_RATE_LIMIT', 'Слишком много новых подключений. Подождите минуту. Открытые сессии продолжают работать.', 429, true);
      this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(this.now());
      if (Number(this.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()?.n) >= 10_000) throw new ServiceError('SESSION_LIMIT', 'Сервер занят. Попробуйте позже.', 503, true);
      const token = randomBytes(32).toString('hex');
      this.db.prepare('INSERT INTO sessions (id, expires) VALUES (?, ?)').run(hash(token), this.now() + 7 * 86_400_000);
      this.db.prepare('INSERT INTO session_issuance (ip, time) VALUES (?, ?)').run(ipHash, now);
      return token;
    });
  }
  reserve(session: string, requestId: string, bodyHash: string, maxCost: number, ip = 'unknown', stepwise = false): ReservationResult {
    // Expiration must persist even when this request is rejected and its transaction rolls back.
    this.maintenance();
    return this.transaction(() => {
      const now = this.now();
      const previous = this.db.prepare('SELECT * FROM requests WHERE session = ? AND request_id = ?').get(session, requestId) as unknown as LedgerRow | undefined;
      if (previous) {
        if (previous.body_hash !== bodyHash) throw new ServiceError('REQUEST_CONFLICT', 'Этот идентификатор уже использован для другого сообщения.', 409);
        if (previous.state === 'pending') throw new ServiceError('REQUEST_PENDING', 'Это сообщение уже обрабатывается. Дождитесь ответа.', 409, true);
        if (previous.state === 'unknown') throw new ServiceError('OUTCOME_UNKNOWN', 'Исход прошлого запроса неизвестен. Повторная платная отправка заблокирована.', 409);
        if (previous.state !== 'retryable') {
          if (previous.response) return { kind: 'cached', status: previous.http_status, body: JSON.parse(previous.response) as ChatResponse | ApiError };
          throw new ServiceError('REPLAY_EXPIRED', 'Срок хранения ответа истёк. Повторная платная отправка этого сообщения заблокирована.', 409);
        }
      }
      // Session rotation must not turn an existing request into another paid call.
      // Retain owner isolation: never expose another session's cached response.
      const otherOwner = this.db.prepare('SELECT 1 FROM requests WHERE request_id = ? AND session != ? LIMIT 1').get(requestId, session);
      if (otherOwner) throw new ServiceError('REQUEST_CONFLICT', 'Этот запрос уже связан с другой сессией. Повторная платная отправка заблокирована.', 409);
      this.db.prepare('DELETE FROM attempts WHERE time <= ?').run(now - this.options.rateWindowMs);
      const sessionAttempts = Number(this.db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE session = ?').get(session)?.n);
      const ipHash = hash(ip);
      const ipAttempts = Number(this.db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE ip = ?').get(ipHash)?.n);
      if ((this.options.sessionRate > 0 && sessionAttempts >= this.options.sessionRate) || (this.options.ipRate > 0 && ipAttempts >= this.options.ipRate)) throw new ServiceError('RATE_LIMIT', 'Слишком много сообщений. Подождите минуту.', 429, true);
      const pending = Number(this.db.prepare("SELECT COUNT(*) AS n FROM requests WHERE state = 'pending'").get()?.n);
      const ownerPending = Number(this.db.prepare("SELECT COUNT(*) AS n FROM requests WHERE state = 'pending' AND session = ?").get(session)?.n);
      if ((this.options.maxConcurrent > 0 && pending >= this.options.maxConcurrent) || (this.options.sessionConcurrent > 0 && ownerPending >= this.options.sessionConcurrent)) throw new ServiceError('CONCURRENCY_LIMIT', 'Уже идёт обработка сообщения. Подождите завершения.', 429, true);
      const reserved = units(maxCost);
      const spent = Number(this.db.prepare("SELECT COALESCE(SUM(CASE WHEN state = 'pending' THEN reserved ELSE charged END), 0) AS total FROM requests").get()?.total);
      const budget = Math.floor(this.options.budgetUsd * 1_000_000_000);
      if (!Number.isSafeInteger(budget) || budget <= 0 || reserved <= 0 || spent + reserved > budget) throw this.budgetError(reserved, budget - spent);
      if (previous?.state === 'retryable') this.db.prepare("UPDATE operations SET operation_id = operation_id || ':unbilled:' || ? WHERE session=? AND request_id=? AND state='failed' AND charged=0").run(now,session,requestId);
      this.db.prepare(`INSERT INTO requests (session, request_id, body_hash, state, reserved, charged, pending_until, expires, updated)
        VALUES (?, ?, ?, 'pending', ?, 0, ?, ?, ?)
        ON CONFLICT(session, request_id) DO UPDATE SET state='pending', reserved=excluded.reserved, charged=0, pending_until=excluded.pending_until, response=NULL, expires=excluded.expires, updated=excluded.updated`).run(session, requestId, bodyHash, reserved, now + this.options.timeoutMs + 5000, now + this.options.responseTtlMs, now);
      this.db.prepare('INSERT INTO attempts (session, ip, time) VALUES (?, ?, ?)').run(session, ipHash, now);
      return { kind: 'reserved', reservation: { session, requestId, ...(stepwise ? { stepwise: true as const } : {}) } };
    });
  }
  complete(reservation: Reservation, actualCost: number, response: ChatResponse): void {
    this.finish(reservation, 'completed', Math.max(units(actualCost), this.operationCharge(reservation)), 200, response);
  }
  fail(reservation: Reservation, knownUnspent: boolean, error: ServiceError): ServiceError {
    // Only a provider-confirmed unbilled rejection can be explicitly retried.
    const children = this.readOperations(reservation);
    const spent = this.operationCharge(reservation);
    const unspent = knownUnspent && spent === 0 && children.every(child => child.state === 'failed');
    const safe = unspent ? error : new ServiceError(error.code, error.message, error.status, false, false);
    this.finish(reservation, unspent && error.retryable ? 'retryable' : 'failed', children.length ? spent : knownUnspent ? 0 : null, error.status, safe.toJSON(reservation.requestId));
    return safe;
  }
  recordOperation(reservation: Reservation, event: OperationEvent): void {
    this.transaction(() => {
      const parent = this.db.prepare('SELECT state, reserved FROM requests WHERE session = ? AND request_id = ?').get(reservation.session, reservation.requestId);
      if (!parent || parent.state !== 'pending') throw new ServiceError('OUTCOME_UNKNOWN', 'Запрос уже завершён; новый шаг заблокирован.', 409);
      const prior = this.db.prepare('SELECT input_hash, state, metadata FROM operations WHERE session = ? AND request_id = ? AND operation_id = ?').get(reservation.session, reservation.requestId, event.id);
      if (event.state === 'started') {
        if (prior) throw new ServiceError('OPERATION_REPLAY', 'Повтор уже начатого шага заблокирован.', 409);
        const reserved = units(event.reservedUsd ?? 0);
        if (reservation.stepwise) {
          const held = this.operationCharge(reservation), next = held + reserved;
          const others = Number(this.db.prepare("SELECT COALESCE(SUM(CASE WHEN state='pending' THEN reserved ELSE charged END),0) total FROM requests WHERE NOT (session=? AND request_id=?)").get(reservation.session,reservation.requestId)?.total);
          const budget = Math.floor(this.options.budgetUsd * 1e9);
          if (!Number.isSafeInteger(budget) || budget <= 0 || others + next > budget) throw this.budgetError(reserved, budget - others - held);
          this.db.prepare('UPDATE requests SET reserved=? WHERE session=? AND request_id=?').run(next,reservation.session,reservation.requestId);
        } else {
          const sum = Number(this.db.prepare("SELECT COALESCE(SUM(CASE WHEN state='failed' AND charged=0 THEN 0 ELSE reserved END),0) total FROM operations WHERE session = ? AND request_id = ?").get(reservation.session, reservation.requestId)?.total);
          if (sum + reserved > Number(parent.reserved)) throw new ServiceError('BUDGET_EXHAUSTED', 'Резерва недостаточно для следующего шага.', 402);
        }
        this.db.prepare('INSERT INTO operations (session,request_id,operation_id,kind,input_hash,state,reserved,metadata,started) VALUES (?,?,?,?,?,?,?,?,?)').run(reservation.session,reservation.requestId,event.id,event.kind,event.inputHash,event.state,reserved,JSON.stringify(event.metadata ?? {}),this.now());
      } else {
        if (!prior || prior.input_hash !== event.inputHash || prior.state !== 'started') throw new ServiceError('OPERATION_CONFLICT', 'Состояние шага изменилось; повтор заблокирован.', 409);
        this.db.prepare(`UPDATE operations SET state=?,charged=CASE WHEN ? IS NULL THEN reserved ELSE ? END,metadata=?,error_code=?,finished=? WHERE session=? AND request_id=? AND operation_id=?`).run(event.state,event.chargedUsd === undefined ? null : units(event.chargedUsd),event.chargedUsd === undefined ? null : units(event.chargedUsd),JSON.stringify({...JSON.parse(String(prior.metadata ?? '{}')),...event.metadata,usage:event.usage,toolCalls:event.toolCalls}),event.errorCode ?? null,this.now(),reservation.session,reservation.requestId,event.id);
        if (reservation.stepwise) this.db.prepare('UPDATE requests SET reserved=? WHERE session=? AND request_id=?').run(this.operationCharge(reservation),reservation.session,reservation.requestId);
      }
    });
  }
  readOperations(reservation: Reservation): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT operation_id AS id,kind,input_hash AS inputHash,state,reserved / 1e9 AS reservedUsd,charged / 1e9 AS chargedUsd,metadata,error_code AS errorCode,started,finished FROM operations WHERE session=? AND request_id=? ORDER BY started,rowid').all(reservation.session,reservation.requestId) as Array<Record<string, unknown>>;
  }
  trustedEvidence(session: string, projectId: string, supplied: ExternalEvidence[]): ExternalEvidence[] {
    if (!supplied.length) return [];
    const rows = this.db.prepare("SELECT json_extract(metadata,'$.evidence') evidence FROM operations WHERE session=? AND kind='read' AND state='completed' AND json_extract(metadata,'$.evidence.projectId')=?").all(session,projectId);
    const saved = rows.flatMap(row => typeof row.evidence === 'string' ? [JSON.parse(row.evidence) as ExternalEvidence] : []);
    return supplied.filter(item => saved.some(source => isDeepStrictEqual(source,item)));
  }
  recoverableEvidence(session: string, projectId: string, moduleId: string, generation: number): ExternalEvidence[] {
    // Recover only the latest research batch in this exact conversation. A later
    // successful research supersedes it; restart, project and session boundaries
    // must never resurrect old or foreign reads. No paid request is replayed.
    const latest = this.db.prepare(`SELECT o.request_id, r.state FROM operations o
      JOIN requests r ON r.session=o.session AND r.request_id=o.request_id
      WHERE o.session=? AND o.kind='read' AND r.state!='pending'
        AND json_extract(o.metadata,'$.evidence.projectId')=?
        AND json_extract(o.metadata,'$.evidence.moduleId')=?
        AND json_extract(o.metadata,'$.evidence.generation')=?
      ORDER BY o.started DESC,o.rowid DESC LIMIT 1`).get(session,projectId,moduleId,generation);
    if (!latest || !['failed','unknown'].includes(String(latest.state))) return [];
    return this.db.prepare(`SELECT json_extract(metadata,'$.evidence') evidence FROM operations
      WHERE session=? AND request_id=? AND kind='read' AND state='completed' ORDER BY started,rowid`)
      .all(session,latest.request_id as string)
      .flatMap(row => typeof row.evidence === 'string' ? [JSON.parse(row.evidence) as ExternalEvidence] : []);
  }
  private operationCharge(reservation: Reservation): number {
    return Number(this.db.prepare("SELECT COALESCE(SUM(CASE WHEN state='started' THEN reserved ELSE charged END),0) total FROM operations WHERE session=? AND request_id=?").get(reservation.session,reservation.requestId)?.total);
  }
  private budgetError(required: number, available: number): ServiceError {
    const amount = (value: number) => (Math.max(0,value) / 1e9).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:4});
    return new ServiceError('BUDGET_EXHAUSTED', `Недостаточно AI-бюджета для следующего шага: доступно $${amount(available)}, требуется резерв $${amount(required)}. Сохранённые материалы можно редактировать и скачать.`, 402, false, true);
  }
  private finish(reservation: Reservation, state: string, charged: number | null, status: number, response: ChatResponse | ApiError): void {
    this.transaction(() => {
      this.db.prepare("UPDATE operations SET state='unknown',charged=reserved,finished=? WHERE session=? AND request_id=? AND state='started'").run(this.now(),reservation.session,reservation.requestId);
      this.db.prepare(`UPDATE requests SET state = ?, charged = COALESCE(?, reserved), response = ?, http_status = ?, expires = ?, updated = ? WHERE session = ? AND request_id = ? AND state = 'pending'`).run(state, charged, JSON.stringify(response), status, this.now() + this.options.responseTtlMs, this.now(), reservation.session, reservation.requestId);
      // Keep spent totals and id/hash tombstones, but bound saved conversation content.
      this.db.prepare('UPDATE requests SET response = NULL WHERE response IS NOT NULL AND rowid NOT IN (SELECT rowid FROM requests WHERE response IS NOT NULL ORDER BY updated DESC, rowid DESC LIMIT ?)').run(this.options.maxCachedResponses);
    });
  }
  close(): void { this.db.close(); }
}
