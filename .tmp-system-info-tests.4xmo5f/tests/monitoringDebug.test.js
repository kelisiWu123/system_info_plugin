"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const monitoringDebug_1 = require("../src/utils/monitoringDebug");
(0, node_test_1.default)('builds dev diagnostics cards with human-readable metrics and skip reasons', () => {
    const cards = (0, monitoringDebug_1.buildMonitoringDiagnosticsCards)([
        {
            id: 'overview-lite',
            label: '概览轻量',
            accent: 'blue',
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
                lastRefreshedAt: new Date('2026-06-13T09:08:07.000Z').getTime(),
                lastSkipReason: 'not-due',
            },
        },
    ]);
    strict_1.default.equal(cards.length, 1);
    strict_1.default.equal(cards[0].statusLabel, '活跃中');
    strict_1.default.equal(cards[0].modeLabel, '后台');
    strict_1.default.equal(cards[0].summaryLine, '成功 9 / 尝试 12');
    strict_1.default.equal(cards[0].subscriberLine, '订阅 1 · 激活 3 · 释放 2');
    strict_1.default.equal(cards[0].trafficLine, '前台 5 · 后台 4 · 强制 2 · 跳过 3');
    strict_1.default.equal(cards[0].lastSkipLine, '最近跳过：未到刷新时间');
    strict_1.default.match(cards[0].lastRefreshLine, /^最近刷新：\d{2}:\d{2}:\d{2}$/);
});
(0, node_test_1.default)('falls back to idle diagnostics copy when no refresh has happened yet', () => {
    const [card] = (0, monitoringDebug_1.buildMonitoringDiagnosticsCards)([
        {
            id: 'processor',
            label: '处理器详情',
            accent: 'green',
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
    ]);
    strict_1.default.equal(card.statusLabel, '待机中');
    strict_1.default.equal(card.modeLabel, '未知');
    strict_1.default.equal(card.summaryLine, '成功 0 / 尝试 0');
    strict_1.default.equal(card.lastSkipLine, '最近跳过：暂无');
    strict_1.default.equal(card.lastRefreshLine, '最近刷新：暂无');
});
