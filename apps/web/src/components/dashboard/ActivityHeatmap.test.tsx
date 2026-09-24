import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityHeatmap, buildActivityHeatmapData } from './ActivityHeatmap';

describe('ActivityHeatmap', () => {
  const referenceDate = new Date('2026-08-29T12:00:00.000Z');

  it('aggregates transactions by UTC day', () => {
    const data = buildActivityHeatmapData(
      [
        { receivedAt: '2026-08-29T01:00:00.000Z' },
        { receivedAt: '2026-08-29T23:00:00.000Z' },
        { createdAt: '2026-08-28T23:00:00.000Z' },
      ],
      referenceDate,
      365
    );

    expect(data).toHaveLength(365);
    expect(data.find((day) => day.date === '2026-08-29')?.count).toBe(2);
    expect(data.find((day) => day.date === '2026-08-28')?.count).toBe(1);
  });

  it('renders a 365-day grid with activity intensity levels', () => {
    render(
      <ActivityHeatmap
        payments={[{ receivedAt: '2026-08-29T12:00:00.000Z' }]}
        referenceDate={referenceDate}
      />
    );

    expect(screen.getByTestId('activity-heatmap-grid')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(365);
    expect(screen.getByTestId('activity-heatmap-day-2026-08-29')).toHaveAttribute('data-level', '4');
  });

  it('supports date range presets and accessible daily counts', () => {
    render(
      <ActivityHeatmap
        payments={[{ receivedAt: '2026-08-29T12:00:00.000Z' }, { receivedAt: '2026-08-29T13:00:00.000Z' }]}
        referenceDate={referenceDate}
      />
    );

    expect(screen.getByRole('button', { name: /Aug 29, 2026: 2 transactions/i })).toBeInTheDocument();
    expect(screen.getByTestId('activity-heatmap-range-90d')).toBeInTheDocument();
    expect(screen.getByTestId('activity-heatmap-end-date')).toHaveValue('2026-08-29');
    expect(screen.getAllByRole('button', { name: /transactions/i })).toHaveLength(365);
  });
});
