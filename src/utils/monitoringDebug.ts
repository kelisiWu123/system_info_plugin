import type { MonitoringDiagnosticsState } from './monitoring'

export type MonitoringDebugMode = 'foreground' | 'background'

export interface MonitoringDiagnosticsCardInput {
  id: string
  label: string
  accent: string
  currentMode: MonitoringDebugMode
  diagnostics: MonitoringDiagnosticsState
}

export interface MonitoringDiagnosticsCard {
  id: string
  label: string
  accent: string
  statusLabel: string
  currentModeLabel: string
  lastRefreshModeLabel: string
  summaryLine: string
  subscriberLine: string
  trafficLine: string
  lastSkipLine: string
  lastRefreshLine: string
}

function formatModeLabel(mode: MonitoringDiagnosticsState['lastMode'] | MonitoringDebugMode) {
  if (mode === 'foreground') return '前台'
  if (mode === 'background') return '后台'
  return '未知'
}

function formatSkipReason(reason?: string) {
  switch (reason) {
    case 'not-due':
      return '未到刷新时间'
    case 'background-paused':
      return '后台暂停重链路'
    case 'no-active-requirements':
      return '当前没有活跃采样需求'
    case 'no-metric-updated':
      return '本轮没有新指标写入'
    default:
      return reason || '暂无'
  }
}

function formatTime(value?: number) {
  if (!value) return '暂无'
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function buildMonitoringDiagnosticsCards(inputs: MonitoringDiagnosticsCardInput[]): MonitoringDiagnosticsCard[] {
  return inputs.map(({ id, label, accent, currentMode, diagnostics }) => ({
    id,
    label,
    accent,
    statusLabel: diagnostics.activeSubscribers > 0 ? '活跃中' : '待机中',
    currentModeLabel: `当前窗口：${formatModeLabel(currentMode)}`,
    lastRefreshModeLabel: diagnostics.lastRefreshMode ? `最近刷新：${formatModeLabel(diagnostics.lastRefreshMode)}` : '最近刷新：暂无',
    summaryLine: `成功 ${diagnostics.refreshSuccessCount} / 尝试 ${diagnostics.refreshAttemptCount}`,
    subscriberLine: `订阅 ${diagnostics.activeSubscribers} · 激活 ${diagnostics.activationCount} · 释放 ${diagnostics.deactivationCount}`,
    trafficLine: `前台 ${diagnostics.foregroundRefreshCount} · 后台 ${diagnostics.backgroundRefreshCount} · 强制 ${diagnostics.forcedRefreshCount} · 跳过 ${diagnostics.skippedRefreshCount}`,
    lastSkipLine: `最近跳过：${formatSkipReason(diagnostics.lastSkipReason)}`,
    lastRefreshLine: `最近刷新时间：${formatTime(diagnostics.lastRefreshedAt)}`,
  }))
}
