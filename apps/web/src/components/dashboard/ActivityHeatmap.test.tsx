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

    const grid = screen.getByTestId('activity-heatmap-grid');
    expect(grid).toBeInTheDocument();
    expect(grid.querySelectorAll('button')).toHaveLength(365);
    expect(screen.getByTestId('activity-heatmap-day-2026-08-29')).toHaveAttribute('data-level', '4');
  }, 15000);

  it('supports date range presets and accessible daily counts', () => {
    render(
      <ActivityHeatmap
        payments={[{ receivedAt: '2026-08-29T12:00:00.000Z' }, { receivedAt: '2026-08-29T13:00:00.000Z' }]}
        referenceDate={referenceDate}
      />
    );

    const dayButton = screen.getByTestId('activity-heatmap-day-2026-08-29');
    expect(dayButton).toHaveAttribute('aria-label', expect.stringMatching(/2 transactions/i));
    expect(screen.getByTestId('activity-heatmap-range-90d')).toBeInTheDocument();
    expect(screen.getByTestId('activity-heatmap-end-date')).toHaveValue('2026-08-29');
    expect(screen.getByTestId('activity-heatmap-grid').querySelectorAll('button')).toHaveLength(365);
  }, 15000);
});
