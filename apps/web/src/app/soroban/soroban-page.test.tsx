import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SorobanInspectorPage, {
  isValidSorobanContractId,
  truncateLongXdr,
} from './page';

describe('Issue #267: Soroban Contract Inspector & Simulation UI', () => {
  describe('Contract ID Format Validation & Helpers', () => {
    it('validates 56-character Soroban contract IDs starting with C', () => {
      expect(isValidSorobanContractId('CCONTRACTSAC2222222222222222222222222222222222222222222')).toBe(true);
      expect(isValidSorobanContractId('CA3D5KRYM6CB7OWQ6TWYRR3Z4EK7C3Y244HJ5CXAWSWVRTZR4WMADE72')).toBe(true);
      expect(isValidSorobanContractId('invalid_contract_id')).toBe(false);
      expect(isValidSorobanContractId('')).toBe(false);
    });

    it('truncates long XDR values cleanly with expand toggle status', () => {
      const longXdr = 'AAAAEgAAAAAAAABAAAAAAACW+gAAAABAAAAIAAAAAG3vX9k4l1+Q0n5m2u8x9Z7y6w5v4u3t2s1r0q9p8o7n6m5l4k3j2i1h0g';
      const { truncated, isLong } = truncateLongXdr(longXdr, 30);
      expect(isLong).toBe(true);
      expect(truncated).toContain('...');
      expect(truncated.length).toBeLessThan(longXdr.length);
    });
  });

  describe('Soroban Inspector Page UI Component', () => {
    it('renders Soroban Inspector Page with contract lookup input and tabs', () => {
      render(<SorobanInspectorPage />);

      expect(screen.getByTestId('soroban-inspector-page')).toBeInTheDocument();
      expect(screen.getByTestId('soroban-contract-lookup-input')).toBeInTheDocument();
      expect(screen.getByTestId('soroban-view-tabs')).toBeInTheDocument();
    });

    it('shows validation error alert when invalid contract ID is submitted', () => {
      render(<SorobanInspectorPage />);

      const input = screen.getByTestId('soroban-contract-lookup-input');
      const lookupBtn = screen.getByTestId('lookup-contract-btn');

      fireEvent.change(input, { target: { value: 'short-invalid-id' } });
      fireEvent.click(lookupBtn);

      expect(screen.getByTestId('contract-validation-error')).toBeInTheDocument();
      expect(screen.getByTestId('contract-validation-error')).toHaveTextContent(/Invalid Soroban Contract ID/i);
    });

    it('switches between Inspector tab and Simulation Sandbox tab', () => {
      render(<SorobanInspectorPage />);

      const simTab = screen.getByTestId('tab-simulation');
      fireEvent.click(simTab);

      expect(screen.getByText('Soroban Smart Contract Simulation & Dry-Run Sandbox')).toBeInTheDocument();

      const inspTab = screen.getByTestId('tab-inspector');
      fireEvent.click(inspTab);

      expect(screen.getByTestId('long-xdr-inspector')).toBeInTheDocument();
    });

    it('toggles long XDR expand and collapse in raw payload inspector', () => {
      render(<SorobanInspectorPage />);

      const toggleBtn = screen.getByTestId('toggle-xdr-xdr_01');
      expect(toggleBtn).toHaveTextContent('Expand Full XDR');

      fireEvent.click(toggleBtn);
      expect(toggleBtn).toHaveTextContent('Collapse');
    });
  });
});
