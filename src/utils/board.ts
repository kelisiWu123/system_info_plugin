type BoardReportRow = {
  label: string
  value: string
}

type BoardDisplayNameInput = {
  platform?: string
  loading?: boolean
  boardManufacturer?: string
  boardModel?: string
  biosVendor?: string
}

type BoardChipsetInput = {
  platform?: string
  boardModel?: string
  cpuFamily?: string
  cpuSocket?: string
}

type BoardMemorySlotLabelInput = {
  platform?: string
  bank?: string
  index: number
  totalSlots: number
}

const CHIPSET_MODEL_PATTERN = /(Z\d{3,4}|B\d{3,4}|H\d{3,4}|X\d{3,4}E?|TRX\d{2,3}|A\d{3}|Q\d{3}|W\d{3})/i

function cleanBoardText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function joinBoardParts(parts: Array<string | number | null | undefined>, separator = ' ') {
  return parts
    .map((part) => (typeof part === 'number' ? String(part) : cleanBoardText(part)))
    .filter(Boolean)
    .join(separator)
}

function isDarwinPlatform(platform?: string) {
  return cleanBoardText(platform).toLowerCase() === 'darwin'
}

function isPlaceholderBoardValue(value: string) {
  return ['', '--', '暂无', '未提供'].includes(cleanBoardText(value))
}

function normalizeModelToken(token: string) {
  return token.replace(/[-_]/g, '').toUpperCase()
}

function isNumericOnlyValue(value: string) {
  return /^\d+$/.test(cleanBoardText(value))
}

export function getBoardDisplayName(input: BoardDisplayNameInput) {
  const boardName = joinBoardParts([input.boardManufacturer, input.boardModel])
  if (boardName) return boardName
  if (input.loading) return '主板信息读取中'
  if (isDarwinPlatform(input.platform)) return 'Apple 平台固件'
  return '未识别主板信息'
}

export function inferBoardChipsetName(input: BoardChipsetInput) {
  const model = cleanBoardText(input.boardModel)
  const match = model.match(CHIPSET_MODEL_PATTERN)
  if (match) return normalizeModelToken(match[1])

  const cpuFamily = cleanBoardText(input.cpuFamily)
  const cpuSocket = cleanBoardText(input.cpuSocket)

  if (isDarwinPlatform(input.platform) || /soc/i.test(cpuSocket)) return 'SoC 集成'
  if (cpuFamily && !isNumericOnlyValue(cpuFamily)) return cpuFamily
  return '--'
}

export function getBoardMemorySlotLabel(input: BoardMemorySlotLabelInput) {
  const bank = cleanBoardText(input.bank)
  const needsUnifiedLabel =
    isDarwinPlatform(input.platform) &&
    (!bank || isNumericOnlyValue(bank) || /^bank\s*\d+$/i.test(bank) || /^channel[\s_-]?\d+$/i.test(bank))

  if (needsUnifiedLabel) {
    return input.totalSlots <= 1 ? '统一内存' : `统一内存 ${input.index + 1}`
  }

  return bank || `DIMM_${String.fromCharCode(65 + Math.floor(input.index / 2))}${(input.index % 2) + 1}`
}

export function filterBoardReportRows(rows: BoardReportRow[]) {
  return rows.filter((row) => !isPlaceholderBoardValue(row.value))
}
