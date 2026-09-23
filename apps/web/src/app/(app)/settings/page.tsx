'use client';

import { useCallback, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  EmailTemplatePreview,
  type EmailTemplateConfig,
} from '@/components/dashboard';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

interface SettingsForm {
  telegramChatId: string;
  emailEnabled: boolean;
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const [form, setForm] = useState<SettingsForm>({ telegramChatId: '', emailEnabled: true });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const authHeaders = useCallback(() => {
    const headers: Record<string, string> = {};
    if (session?.accessToken) headers['Authorization'] = `Bearer ${session.accessToken}`;
    return headers;
  }, [session?.accessToken]);

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch(`${API_BASE_URL}/notifications/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          telegramChatId: form.telegramChatId.trim() || undefined,
          emailEnabled: form.emailEnabled,
        }),
      });
      const ok = res.ok;
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setStatus({ ok, message: ok ? (data.message ?? 'Preferences saved.') : (data.error ?? 'Failed to save preferences.') });
    } catch (err) {
      console.error(err);
      setStatus({ ok: false, message: 'Could not reach API server.' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEmailTemplate = async (template: EmailTemplateConfig) => {
    try {
      await fetch(`${API_BASE_URL}/notifications/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ emailTemplate: template }),
      });
    } catch (err) {
      console.error('Failed to save email template preferences:', err);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Notification Settings</h1>
        <p className="text-gray-400 text-sm mt-1">
          Configure how and where StellarAlerts delivers payment alerts.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Alert Channels */}
        <form
          onSubmit={handleSavePreferences}
          className="bg-[#0c0c14]/80 backdrop-blur-md rounded-3xl border border-white/10 p-7 hover:border-cyan-500/30 transition-all duration-500 space-y-5"
        >
          <h2 className="text-lg font-bold text-white">Alert Channels</h2>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Telegram Chat ID
            </label>
            <input
              type="text"
              placeholder="e.g. 123456789"
              value={form.telegramChatId}
              onChange={(e) => setForm({ ...form, telegramChatId: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#0f0f1a] border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 text-sm font-mono"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Start a chat with our bot to get your Telegram Chat ID.
            </p>
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#0f0f1a] border border-white/10">
            <div>
              <div className="text-sm font-medium text-white">Email Receipts</div>
              <div className="text-xs text-slate-400">Receive payment alerts via email</div>
            </div>
            <input
              type="checkbox"
              checked={form.emailEnabled}
              onChange={(e) => setForm({ ...form, emailEnabled: e.target.checked })}
              className="w-4 h-4 rounded accent-cyan-600 bg-[#0f0f1a] border-slate-700"
            />
          </div>

          {status && (
            <div
              className={`p-3 rounded-xl text-xs ${status.ok ? 'bg-emerald-950/40 border border-emerald-500/30 text-emerald-300' : 'bg-red-950/40 border border-red-500/30 text-red-300'}`}
              role="status"
            >
              {status.message}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-sm shadow-lg transition-all cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Preferences'}
          </button>
        </form>

        {/* Email Template */}
        <div className="bg-[#0c0c14]/80 backdrop-blur-md rounded-3xl border border-white/10 p-7 hover:border-cyan-500/30 transition-all duration-500">
          <h2 className="text-lg font-bold text-white mb-4">Email Receipt Template</h2>
          <EmailTemplatePreview onSaveTemplate={handleSaveEmailTemplate} />
        </div>
      </div>
    </div>
  );
}