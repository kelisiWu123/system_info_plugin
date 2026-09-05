export interface DevPageCopyTarget {
  section: string
  methodName:
    | 'copyOverviewInfo'
    | 'copyProcessorInfo'
    | 'copyGraphicsInfo'
    | 'copyBoardInfo'
    | 'copyMemoryInfo'
    | 'copyStorageInfo'
  buttonLabel: '复制当前页信息'
}

const DEV_PAGE_COPY_TARGETS: Record<string, DevPageCopyTarget> = {
  overview: {
    section: 'overview',
    methodName: 'copyOverviewInfo',
    buttonLabel: '复制当前页信息',
  },
  processor: {
    section: 'processor',
    methodName: 'copyProcessorInfo',
    buttonLabel: '复制当前页信息',
  },
  graphics: {
    section: 'graphics',
    methodName: 'copyGraphicsInfo',
    buttonLabel: '复制当前页信息',
  },
  board: {
    section: 'board',
    methodName: 'copyBoardInfo',
    buttonLabel: '复制当前页信息',
  },
  memory: {
    section: 'memory',
    methodName: 'copyMemoryInfo',
    buttonLabel: '复制当前页信息',
  },
  storage: {
    section: 'storage',
    methodName: 'copyStorageInfo',
    buttonLabel: '复制当前页信息',
  },
}

export function resolveDevPageCopyTarget(section: string) {
  return DEV_PAGE_COPY_TARGETS[section] || null
}
