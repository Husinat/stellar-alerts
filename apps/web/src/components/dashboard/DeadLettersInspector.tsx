'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';

interface DeadLetterRow {
  id: string;
  deliveryKey: string | null;
  paymentId: string | null;
  channel: string;
  destination: string | null;
  error: string;
  status: 'pending' | 'retried' | 'suppressed';
  retryCount: number;
  failedAt: string;
  createdAt: string;
  updatedAt: string;
}

interface DeadLetterAuditRow {
  id: string;
  deadLetterId: string;
  actorUserId: string | null;
  action: string;
  note: string | null;
  createdAt: string;
}

interface DeadLetterDetail extends DeadLetterRow {
  auditLogs: DeadLetterAuditRow[];
}

interface DeadLetterListResponse {
  success?: boolean;
  items: DeadLetterRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

const CHANNEL_STYLES: Record<string, string> = {
  telegram: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
  email: 'text-violet-300 bg-violet-500/10 border-violet-500/30',
  webhook: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  whatsapp: 'text-green-300 bg-green-500/10 border-green-500/30',
  queue: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
};

const STATUS_STYLES: Record<DeadLetterRow['status'], string> = {
  pending: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  retried: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  suppressed: 'text-red-300 bg-red-500/10 border-red-500/30',
};

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

/**
 * Dead-letter inspector for terminal notification failures (#273): filter by
 * channel/search/age, replay idempotently, suppress, and inspect audit history.
 */
export function DeadLettersInspector() {
  const { data: session } = useSession();
  const [items, setItems] = useState<DeadLetterRow[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DeadLetterDetail | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filters, setFilters] = useState<{ channel?: string; status?: string; q?: string }>({});
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchItems = useCallback(
    async (page = pagination.page, nextFilters = filters) => {
      if (!session?.accessToken) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('pageSize', String(pagination.pageSize));
        if (nextFilters.channel) params.set('channel', nextFilters.channel);
        if (nextFilters.status) params.set('status', nextFilters.status);
        if (nextFilters.q) params.set('q', nextFilters.q);
        const res = await fetch(`${API_BASE_URL}/dead-letters?${params}`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        const data = (await res.json()) as Partial<DeadLetterListResponse>;
        if (!res.ok || !data.items) {
          throw new Error((data as any).error || 'Failed to load dead letters');
        }
        setItems(data.items);
        setPagination(data.pagination as DeadLetterListResponse['pagination']);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [session?.accessToken, pagination.pageSize],
  );

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const openDetail = useCallback(async (id: string) => {
    if (!session?.accessToken) return;
    setSelected(null);
    try {
      const res = await fetch(`${API_BASE_URL}/dead-letters/${id}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const data = (await res.json()) as { success?: boolean; deadLetter?: DeadLetterDetail };
      if (res.ok && data.success && data.deadLetter) {
        setSelected(data.deadLetter);
      }
    } catch {
      setSelected(null);
    }
  }, [session?.accessToken]);

  const runAction = useCallback(
    async (id: string, action: 'replay' | 'suppress') => {
      if (!session?.accessToken) return;
      setActingId(id);
      setActionError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/dead-letters/${id}/${action}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        if (!res.ok) {
          throw new Error((data as any).message || data.error || `Failed to ${action}`);
        }
        await fetchItems();
        if (selected?.id === id) {
          await openDetail(id);
        }
      } catch (err) {
        setActionError((err as Error).message);
      } finally {
        setActingId(null);
      }
    },
    [session?.accessToken, fetchItems, selected?.id, openDetail],
  );

  return (
    <div className="space-y-6" data-testid="dead-letters-inspector">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filters.channel ?? ''}
          onChange={(e) => {
            const next = { ...filters, channel: e.target.value || undefined };
            setFilters(next);
            void fetchItems(1, next);
          }}
          data-testid="dead-letters-channel-filter"
          className="px-3 py-2 rounded-xl bg-[#12121f] border border-white/10 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/50"
        >
          <option value="">All channels</option>
          {Object.keys(CHANNEL_STYLES).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <select
          value={filters.status ?? ''}
          onChange={(e) => {
            const next = { ...filters, status: e.target.value || undefined };
            setFilters(next);
            void fetchItems(1, next);
          }}
          data-testid="dead-letters-status-filter"
          className="px-3 py-2 rounded-xl bg-[#12121f] border border-white/10 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/50"
        >
          <option value="">All statuses</option>
          <option value="pending">pending</option>
          <option value="retried">retried</option>
          <option value="suppressed">suppressed</option>
        </select>

        <input
          value={filters.q ?? ''}
          onChange={(e) => {
            const next = { ...filters, q: e.target.value || undefined };
            setFilters(next);
            if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
            searchTimerRef.current = setTimeout(() => void fetchItems(1, next), 400);
          }}
          placeholder="Search error or destination"
          data-testid="dead-letters-search"
          className="flex-1 min-w-[180px] px-3 py-2 rounded-xl bg-[#12121f] border border-white/10 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500/50"
        />
      </div>

      {actionError && (
        <p className="text-xs text-red-400" role="alert">{actionError}</p>
      )}

      {loading ? (
        <div className="text-sm text-gray-400 py-8 text-center">Loading dead letters…</div>
      ) : error ? (
        <div className="text-sm text-red-400 py-8 text-center bg-red-950/20 rounded-2xl border border-red-500/30" role="alert">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-400 py-8 text-center bg-white/5 rounded-2xl border border-white/10">
          No dead letters match the current filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#0c0c14]/70">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-white/10">
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3">Error</th>
                <th className="px-4 py-3">Retries</th>
                <th className="px-4 py-3">Failed At</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-white/5 hover:bg-white/5 transition-colors"
                >
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => void openDetail(item.id)}
                      className="hover:underline cursor-pointer"
                    >
                      <span className={`px-2.5 py-1 rounded-full border text-xs font-semibold ${CHANNEL_STYLES[item.channel] ?? 'bg-white/5 border-white/10 text-gray-300'}`}>
                        {item.channel}
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2.5 py-1 rounded-full border text-xs font-semibold ${STATUS_STYLES[item.status]}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-300 max-w-[160px] truncate">
                    {item.destination ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-300 max-w-[260px] truncate" title={item.error}>
                    {item.error}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{item.retryCount}</td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{formatDate(item.failedAt)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        disabled={actingId === item.id || item.status !== 'pending'}
                        onClick={() => void runAction(item.id, 'replay')}
                        title="Replay through the idempotent dispatch pipeline"
                        className="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        Replay
                      </button>
                      <button
                        type="button"
                        disabled={actingId === item.id || item.status !== 'pending'}
                        onClick={() => void runAction(item.id, 'suppress')}
                        title="Suppress and stop retrying this dead letter"
                        className="px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-300 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        Suppress
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} dead letters
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => void fetchItems(pagination.page - 1)}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40 cursor-pointer"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => void fetchItems(pagination.page + 1)}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40 cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/60 backdrop-blur-sm p-4" onClick={() => setSelected(null)}>
          <div
            className="w-full max-w-lg h-[90vh] overflow-y-auto bg-[#0a0a14] border border-white/15 rounded-3xl p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
            data-testid="dead-letter-detail"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white">Dead Letter Detail</h3>
                <p className="text-xs font-mono text-gray-500 mt-1">{selected.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-gray-400 hover:text-white transition-colors cursor-pointer"
                aria-label="Close detail"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              <div>
                <dt className="text-gray-500 uppercase tracking-wider text-[10px] font-bold">Payment</dt>
                <dd className="font-mono text-gray-200 truncate">{selected.paymentId ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500 uppercase tracking-wider text-[10px] font-bold">Channel</dt>
                <dd className="text-gray-200">{selected.channel}</dd>
              </div>
              <div>
                <dt className="text-gray-500 uppercase tracking-wider text-[10px] font-bold">Destination</dt>
                <dd className="font-mono text-gray-200 truncate">{selected.destination ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500 uppercase tracking-wider text-[10px] font-bold">Status</dt>
                <dd className="text-gray-200">{selected.status} ({selected.retryCount} retries)</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-gray-500 uppercase tracking-wider text-[10px] font-bold mb-1">Error</dt>
                <dd className="p-3 rounded-xl bg-red-950/30 border border-red-500/30 text-red-200 text-[11px] break-words">
                  {selected.error}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-gray-500 uppercase tracking-wider text-[10px] font-bold mb-1">Delivery Key</dt>
                <dd className="font-mono text-[11px] text-gray-300 break-all">{selected.deliveryKey ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500 uppercase tracking-wider text-[10px] font-bold">Failed At</dt>
                <dd className="text-gray-200">{formatDate(selected.failedAt)}</dd>
              </div>
            </dl>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Audit History</h4>
              {selected.auditLogs.length === 0 ? (
                <p className="text-xs text-gray-500">No actions recorded yet.</p>
              ) : (
                <ol className="space-y-2">
                  {selected.auditLogs.map((log) => (
                    <li key={log.id} className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-cyan-300">{log.action}</span>
                        <span className="text-gray-500">{formatDate(log.createdAt)}</span>
                      </div>
                      {log.note && <p className="text-gray-300 mt-1">{log.note}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {selected.status === 'pending' && (
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => void runAction(selected.id, 'replay')}
                  className="flex-1 py-2.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-sm font-bold transition-all cursor-pointer"
                >
                  Replay
                </button>
                <button
                  type="button"
                  onClick={() => void runAction(selected.id, 'suppress')}
                  className="flex-1 py-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 text-sm font-bold transition-all cursor-pointer"
                >
                  Suppress
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}