import React, { useState, useEffect } from 'react';

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSavePreferences: (prefs: { telegramChatId?: string; emailEnabled: boolean; mfaToken?: string }) => void;
}

export const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  onClose,
  onSavePreferences,
}) => {
  const [telegramChatId, setTelegramChatId] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      checkMFAStatus();
    }
  }, [isOpen]);

  const checkMFAStatus = async () => {
    try {
      const token = localStorage.getItem('sessionToken');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('http://localhost:3001/auth/mfa/status', { headers });
      const data = await res.json();
      if (data.success) {
        setMfaRequired(data.mfaEnabled);
      }
    } catch (error) {
      console.error('Failed to check MFA status:', error);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (mfaRequired && (!mfaToken || mfaToken.length !== 6)) {
      setErrorMessage('Please enter your 6-digit MFA code');
      return;
    }

    onSavePreferences({
      telegramChatId: telegramChatId.trim() || undefined,
      emailEnabled,
      mfaToken: mfaRequired ? mfaToken : undefined,
    });
    setMfaToken('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <span>🔔</span> Alert Channels &amp; Preferences
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Telegram Chat ID
            </label>
            <input
              type="text"
              placeholder="e.g. 123456789"
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 text-sm font-mono"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Start a chat with our bot to get your Telegram Chat ID.
            </p>
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <div>
              <div className="text-sm font-medium text-white">Email Receipts</div>
              <div className="text-xs text-slate-400">Receive payment alerts via email</div>
            </div>
            <input
              type="checkbox"
              checked={emailEnabled}
              onChange={(e) => setEmailEnabled(e.target.checked)}
              className="w-4 h-4 rounded accent-purple-600 bg-slate-900 border-slate-700"
            />
          </div>

          {/* MFA Token Input (conditionally shown) */}
          {mfaRequired && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-3">
              <div className="flex items-center gap-2 text-amber-300 text-sm font-semibold">
                <span>🔐</span> MFA Required
              </div>
              <p className="text-xs text-amber-200/80">
                Multi-factor authentication is enabled. Please enter your 6-digit code to update preferences.
              </p>
              <input
                type="text"
                value={mfaToken}
                onChange={(e) => setMfaToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-amber-500/30 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 text-center text-xl font-mono tracking-widest"
              />
            </div>
          )}

          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
              {errorMessage}
            </div>
          )}

          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm transition-all duration-200 shadow-md shadow-purple-600/20"
            >
              Save Preferences
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
