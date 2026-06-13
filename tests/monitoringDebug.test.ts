import assert from 'node:assert/strict'
import test from 'node:test'

import { buildMonitoringDiagnosticsCards } from '../src/utils/monitoringDebug'

test('builds dev diagnostics cards with human-readable metrics and skip reasons', () => {
  const cards = buildMonitoringDiagnosticsCards([
    {
      id: 'overview-lite',
      label: '概览轻量',
      accent: 'blue',
      currentMode: 'background',
      diagnostics: {
        scope: 'overview-lite',
        activeSubscribers: 1,
        activationCount: 3,
        deactivationCount: 2,
        refreshAttemptCount: 12,
        refreshSuccessCount: 9,
        forcedRefreshCount: 2,
        skippedRefreshCount: 3,
        backgroundRefreshCount: 4,
        foregroundRefreshCount: 5,
        lastMode: 'background',
        lastRefreshMode: 'foreground',
        lastRefreshedAt: new Date('2026-06-13T09:08:07.000Z').getTime(),
        lastSkipReason: 'not-due',
      },
    },
  ])

  assert.equal(cards.length, 1)
  assert.equal(cards[0].statusLabel, '活跃中')
  assert.equal(cards[0].currentModeLabel, '当前窗口：后台')
  assert.equal(cards[0].lastRefreshModeLabel, '最近刷新：前台')
  assert.equal(cards[0].summaryLine, '成功 9 / 尝试 12')
  assert.equal(cards[0].subscriberLine, '订阅 1 · 激活 3 · 释放 2')
  assert.equal(cards[0].trafficLine, '前台 5 · 后台 4 · 强制 2 · 跳过 3')
  assert.equal(cards[0].lastSkipLine, '最近跳过：未到刷新时间')
  assert.match(cards[0].lastRefreshLine, /^最近刷新时间：\d{2}:\d{2}:\d{2}$/)
})

test('falls back to idle diagnostics copy when no refresh has happened yet', () => {
  const [card] = buildMonitoringDiagnosticsCards([
    {
      id: 'processor',
      label: '处理器详情',
      accent: 'green',
      currentMode: 'foreground',
      diagnostics: {
        scope: 'processor',
        activeSubscribers: 0,
        activationCount: 0,
        deactivationCount: 0,
        refreshAttemptCount: 0,
        refreshSuccessCount: 0,
        forcedRefreshCount: 0,
        skippedRefreshCount: 0,
        backgroundRefreshCount: 0,
        foregroundRefreshCount: 0,
        lastMode: 'unknown',
      },
    },
  ])

  assert.equal(card.statusLabel, '待机中')
  assert.equal(card.currentModeLabel, '当前窗口：前台')
  assert.equal(card.lastRefreshModeLabel, '最近刷新：暂无')
  assert.equal(card.summaryLine, '成功 0 / 尝试 0')
  assert.equal(card.lastSkipLine, '最近跳过：暂无')
  assert.equal(card.lastRefreshLine, '最近刷新时间：暂无')
})
