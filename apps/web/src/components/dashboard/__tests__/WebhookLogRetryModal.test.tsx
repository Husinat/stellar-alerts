import React from 'react'
import {render, fireEvent, waitFor} from '@testing-library/react'
import {vi, describe, it, expect, beforeEach, afterEach} from 'vitest'
import WebhookLogRetryModal from '../WebhookLogRetryModal'

describe('WebhookLogRetryModal', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    // @ts-expect-error mock fetch
    global.fetch = vi.fn()
  })

  afterEach(() => {
    // @ts-expect-error restore fetch
    global.fetch = originalFetch
    vi.resetAllMocks()
  })

  it('renders logs and triggers retry POST', async () => {
    const logs = [{id: 'log-1', statusCode: null, error: 'timeout', payload: {foo: 'bar'}}]
    // @ts-expect-error mock fetch response
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
      expect(getByText(/200/)).toBeTruthy()
    })
  })
})
