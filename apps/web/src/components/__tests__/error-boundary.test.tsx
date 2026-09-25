import React, { useState } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ErrorBoundary } from '../ErrorBoundary';
import { LoadingState } from '../LoadingState';

function ProblematicComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Simulated horizon node timeout error');
  }
  return <div>Component rendered successfully</div>;
}

function ResettableContainer() {
  const [hasError, setHasError] = useState(true);

  return (
    <ErrorBoundary
      title="Custom Boundary Error"
      onReset={() => setHasError(false)}
    >
      <ProblematicComponent shouldThrow={hasError} />
    </ErrorBoundary>
  );
}

describe('ErrorBoundary & Loading State Model (#324)', () => {
  it('renders children when no error occurs', () => {
    const { getByText } = render(
      <ErrorBoundary>
        <ProblematicComponent shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(getByText('Component rendered successfully')).toBeTruthy();
  });

  it('catches render errors and renders retryable fallback UI', () => {
    // Suppress console.error in tests for expected thrown error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { getByText, getByRole } = render(
      <ErrorBoundary title="Payment Ledger Failed">
        <ProblematicComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(getByRole('alert')).toBeTruthy();
    expect(getByText('Payment Ledger Failed')).toBeTruthy();
    expect(getByText(/Simulated horizon node timeout error/i)).toBeTruthy();
    expect(getByText('Try Again')).toBeTruthy();

    spy.mockRestore();
  });

  it('resets error state when Try Again button is clicked', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { getByText } = render(<ResettableContainer />);

    expect(getByText('Custom Boundary Error')).toBeTruthy();

    const retryBtn = getByText('Try Again');
    fireEvent.click(retryBtn);

    expect(getByText('Component rendered successfully')).toBeTruthy();

    spy.mockRestore();
  });

  it('renders custom fallback function if provided', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { getByText } = render(
      <ErrorBoundary
        fallback={(err, reset) => (
          <div>
            <span>Custom Fallback: {err.message}</span>
            <button onClick={reset}>Reset Me</button>
          </div>
        )}
      >
        <ProblematicComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(getByText(/Custom Fallback: Simulated horizon node timeout error/i)).toBeTruthy();
    expect(getByText('Reset Me')).toBeTruthy();

    spy.mockRestore();
  });

  describe('LoadingState Component', () => {
    it('renders page variant with spinner and message', () => {
      const { getByText, getByRole } = render(
        <LoadingState message="Connecting to Stellar network…" variant="page" />
      );

      expect(getByRole('status')).toBeTruthy();
      expect(getByText('Connecting to Stellar network…')).toBeTruthy();
    });

    it('renders card and inline variants', () => {
      const { getByText } = render(
        <>
          <LoadingState message="Loading card item…" variant="card" />
          <LoadingState message="Syncing ledger…" variant="inline" />
        </>
      );

      expect(getByText('Loading card item…')).toBeTruthy();
      expect(getByText('Syncing ledger…')).toBeTruthy();
    });
  });
});
