'use client';

import React, { useState, useEffect } from 'react';

interface MfaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MfaModal: React.FC<MfaModalProps> = ({ isOpen, onClose }) => {
  const [step, setStep] = useState<'status' | 'setup' | 'verify' | 'disable'>('status');
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Check MFA status on mount
  useEffect(() => {
    if (isOpen) {
      checkMFAStatus();
    }
  }, [isOpen]);

  const getHeaders = () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Get token from session (you'll need to adapt this to your auth setup)
    const token = localStorage.getItem('sessionToken');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  };

  const checkMFAStatus = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('http://localhost:3001/auth/mfa/status', {
        headers: getHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setMfaEnabled(data.mfaEnabled);
      }
    } catch (error) {
      console.error('Failed to check MFA status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetupMFA = async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const res = await fetch('http://localhost:3001/auth/mfa/setup', {
        method: 'POST',
        headers: getHeaders(),
      });
      const data = await res.json();
      
      if (data.success) {
        setQrCode(data.qrCode);
        setSecret(data.secret);
        setStep('setup');
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to setup MFA' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnableMFA = async () => {
    if (!token || token.length !== 6) {
      setMessage({ type: 'error', text: 'Please enter a valid 6-digit code' });
      return;
    }

    setIsLoading(true);
    setMessage(null);
    try {
      const res = await fetch('http://localhost:3001/auth/mfa/enable', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      
      if (data.success) {
        setMessage({ type: 'success', text: 'MFA enabled successfully!' });
        setMfaEnabled(true);
        setToken('');
        setTimeout(() => {
          setStep('status');
          setQrCode(null);
          setSecret(null);
        }, 2000);
      } else {
        setMessage({ type: 'error', text: data.message || 'Invalid code. Please try again.' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisableMFA = async () => {
    if (!token || token.length !== 6) {
      setMessage({ type: 'error', text: 'Please enter a valid 6-digit code' });
      return;
    }

    setIsLoading(true);
    setMessage(null);
    try {
      const res = await fetch('http://localhost:3001/auth/mfa/disable', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      
      if (data.success) {
        setMessage({ type: 'success', text: 'MFA disabled successfully!' });
        setMfaEnabled(false);
        setToken('');
        setTimeout(() => {
          setStep('status');
        }, 2000);
      } else {
        setMessage({ type: 'error', text: data.message || 'Invalid code. Please try again.' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0c0c14] border border-white/10 rounded-3xl p-8 max-w-md w-full mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>🔐</span> Multi-Factor Auth
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-2xl"
          >
            ×
          </button>
        </div>

        {/* Status View */}
        {step === 'status' && (
          <div className="space-y-6">
            <div className={`p-4 rounded-xl border ${mfaEnabled ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-gray-500/10 border-gray-500/30'}`}>
              <p className="text-sm font-semibold text-gray-300">
                Status: {mfaEnabled ? '🟢 Enabled' : '⚫ Disabled'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {mfaEnabled
                  ? 'Two-factor authentication is protecting your account'
                  : 'Enable MFA to secure sensitive operations'}
              </p>
            </div>

            {!mfaEnabled ? (
              <button
                onClick={handleSetupMFA}
                disabled={isLoading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold disabled:opacity-50 transition-all"
              >
                {isLoading ? 'Loading...' : 'Setup MFA'}
              </button>
            ) : (
              <button
                onClick={() => setStep('disable')}
                className="w-full py-3 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 font-semibold transition-all"
              >
                Disable MFA
              </button>
            )}
          </div>
        )}

        {/* Setup View */}
        {step === 'setup' && qrCode && (
          <div className="space-y-6">
            <div className="text-center">
              <p className="text-sm text-gray-300 mb-4">
                Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
              </p>
              <img src={qrCode} alt="MFA QR Code" className="mx-auto rounded-xl border border-white/10" />
              {secret && (
                <div className="mt-4 p-3 bg-slate-950 rounded-xl border border-white/10">
                  <p className="text-xs text-gray-400 mb-1">Manual Entry Key:</p>
                  <p className="text-xs font-mono text-cyan-400 break-all">{secret}</p>
                </div>
              )}
            </div>

            <button
              onClick={() => setStep('verify')}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold transition-all"
            >
              I've Scanned the Code
            </button>

            <button
              onClick={() => {
                setStep('status');
                setQrCode(null);
                setSecret(null);
              }}
              className="w-full py-2 rounded-xl text-gray-400 hover:text-white text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Verify View */}
        {step === 'verify' && (
          <div className="space-y-6">
            <div>
              <p className="text-sm text-gray-300 mb-4">
                Enter the 6-digit code from your authenticator app to complete setup
              </p>
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 text-center text-2xl font-mono tracking-widest"
              />
            </div>

            {message && (
              <div className={`p-3 rounded-xl text-sm ${message.type === 'success' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                {message.text}
              </div>
            )}

            <button
              onClick={handleEnableMFA}
              disabled={isLoading || token.length !== 6}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold disabled:opacity-50 transition-all"
            >
              {isLoading ? 'Verifying...' : 'Enable MFA'}
            </button>

            <button
              onClick={() => setStep('setup')}
              className="w-full py-2 rounded-xl text-gray-400 hover:text-white text-sm transition-colors"
            >
              Back to QR Code
            </button>
          </div>
        )}

        {/* Disable View */}
        {step === 'disable' && (
          <div className="space-y-6">
            <div>
              <p className="text-sm text-gray-300 mb-4">
                Enter your 6-digit authentication code to disable MFA
              </p>
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 text-center text-2xl font-mono tracking-widest"
              />
            </div>

            {message && (
              <div className={`p-3 rounded-xl text-sm ${message.type === 'success' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                {message.text}
              </div>
            )}

            <button
              onClick={handleDisableMFA}
              disabled={isLoading || token.length !== 6}
              className="w-full py-3 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 font-semibold disabled:opacity-50 transition-all"
            >
              {isLoading ? 'Disabling...' : 'Disable MFA'}
            </button>

            <button
              onClick={() => {
                setStep('status');
                setToken('');
                setMessage(null);
              }}
              className="w-full py-2 rounded-xl text-gray-400 hover:text-white text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
