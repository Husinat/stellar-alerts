import React from 'react'
import {render, fireEvent, waitFor} from '@testing-library/react'
import {vi, describe, it, expect, beforeEach, afterEach} from 'vitest'
import WebhookLogRetryModal from '../WebhookLogRetryModal'

describe('WebhookLogRetryModal', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    // @ts-expect-error test double for global.fetch
    global.fetch = vi.fn()
  })

  afterEach(() => {
    // @ts-expect-error test double for global.fetch
    global.fetch = originalFetch
    vi.resetAllMocks()
  })

  it('renders logs and triggers retry POST', async () => {
    const logs = [{id: 'log-1', statusCode: null, error: 'timeout', payload: {foo: 'bar'}}]
    // @ts-expect-error mock fetch instance has no vi.Mock type
    global.fetch.mockResolvedValue({ok: true, status: 200})

    const onClose = vi.fn()
    const {getByText} = render(<WebhookLogRetryModal isOpen={true} onClose={onClose} logs={logs} />)

    expect(getByText('Webhook Delivery Failures')).toBeTruthy()
    const button = getByText('Re-send Webhook')
    fireEvent.click(button)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/webhooks/retry', expect.objectContaining({method: 'POST'}))
    })

    await waitFor(() => {
      // The "Status:" label and value render as separate text nodes
      // (<strong>Status:</strong> {value}), so match on the element's
      // combined text content instead of a single exact string.
      expect(getByText((_, element) => element?.textContent === 'Status: 200')).toBeTruthy()
    })
  })
})
