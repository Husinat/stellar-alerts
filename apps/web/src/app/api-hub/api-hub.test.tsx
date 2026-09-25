import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ApiHubPage, { generateCodeExample, API_ENDPOINTS } from './page';

describe('Issue #266: Developer API Hub Screen Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Developer API Hub screen with search, sidebar, and initial endpoint', () => {
    render(<ApiHubPage />);

    expect(screen.getByTestId('developer-api-hub')).toBeInTheDocument();
    expect(screen.getByTestId('api-search-input')).toBeInTheDocument();
    expect(screen.getByTestId('endpoint-list')).toBeInTheDocument();
    expect(screen.getAllByText('Request Passwordless Magic Link').length).toBeGreaterThan(0);
  });

  it('filters endpoint list by category group pill', () => {
    render(<ApiHubPage />);

    const webhooksPill = screen.getByRole('button', { name: 'Webhooks' });
    fireEvent.click(webhooksPill);

    expect(screen.getAllByText('List Configured Webhooks').length).toBeGreaterThan(0);
    expect(screen.queryByText('Request Passwordless Magic Link')).not.toBeInTheDocument();
  });

  it('switches active endpoint details when a sidebar item is clicked', () => {
    render(<ApiHubPage />);

    const walletsBtn = screen.getByTestId('endpoint-btn-wallets-list');
    fireEvent.click(walletsBtn);

    expect(screen.getAllByText('List Watched Wallets').length).toBeGreaterThan(0);
    expect(screen.getByText('Retrieves all Stellar Ed25519 wallets being ingested and monitored for the authenticated user.')).toBeInTheDocument();
  });

  it('generates cURL, JavaScript, and Python code samples correctly', () => {
    const endpoint = API_ENDPOINTS[0]; // /auth/request-link

    const curl = generateCodeExample(endpoint, 'curl');
    expect(curl).toContain('curl -X POST');
    expect(curl).toContain('/auth/request-link');

    const js = generateCodeExample(endpoint, 'javascript');
    expect(js).toContain("fetch('https://api.stellar-alerts.org/auth/request-link'");

    const py = generateCodeExample(endpoint, 'python');
    expect(py).toContain('requests.post(');
  });

  it('switches code sample tabs on user click', () => {
    render(<ApiHubPage />);

    const jsTab = screen.getByTestId('lang-tab-javascript');
    fireEvent.click(jsTab);

    const pre = screen.getByTestId('code-sample-pre');
    expect(pre.textContent).toContain('fetch(');
  });

  it('executes live API endpoint example runner when "Try Endpoint" is clicked', async () => {
    render(<ApiHubPage />);

    const tryBtn = screen.getByTestId('run-live-example-btn');
    fireEvent.click(tryBtn);

    expect(tryBtn).toHaveTextContent('Running...');

    await waitFor(() => {
      expect(screen.getByTestId('live-response-result')).toBeInTheDocument();
    });

    expect(screen.getByText(/HTTP 200 OK/i)).toBeInTheDocument();
  });

  it('renders OpenAPI component request schema', () => {
    render(<ApiHubPage />);

    expect(screen.getByTestId('schema-display-card')).toBeInTheDocument();
    expect(screen.getByText(/Generated OpenAPI Component Schema/i)).toBeInTheDocument();
  });
});
