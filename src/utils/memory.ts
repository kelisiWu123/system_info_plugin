function cleanMemorySlotText(value: unknown) {
  return String(value ?? '').trim()
}

export function getMemoryChannel(bank: unknown, index: number) {
  const normalized = cleanMemorySlotText(bank).toUpperCase()
  const channelMatch = normalized.match(/CHANNEL\s+([A-D])/)
  if (channelMatch?.[1]) return channelMatch[1]

  const dimmMatch = normalized.match(/DIMM[_-]?([A-D])/)
  if (dimmMatch?.[1]) return dimmMatch[1]

  return index % 2 === 0 ? 'A' : 'B'
}

function hasMemoryModule(item?: MemoLayoutData) {
  return Number(item?.size) > 0
}

/**
 * Keep inferred empty-slot names consistent across the memory and board pages.
 * Some Windows providers return placeholder banks such as DIMM_B1/DIMM_B2 for
 * empty slots even when the installed modules identify channels A and B.
 */
export function buildMemorySlotLabels(total: number, source: MemoLayoutData[]) {
  const slotTotal = Math.max(0, Math.floor(total))
  const channelOrder = ['A', 'B', 'C', 'D']
  const channelCounts = new Map<string, number>()
  const labels = Array.from({ length: slotTotal }, () => '')

  source.forEach((item, index) => {
    if (!hasMemoryModule(item)) return
    const bank = cleanMemorySlotText(item?.bank)
    if (bank) return
    const channel = getMemoryChannel(bank, index)
    channelCounts.set(channel, (channelCounts.get(channel) || 0) + 1)
  })

  source.forEach((item, index) => {
    if (!hasMemoryModule(item)) return
    const bank = cleanMemorySlotText(item?.bank)
    if (bank && index < slotTotal) {
      labels[index] = bank
      const channel = getMemoryChannel(bank, index)
      channelCounts.set(channel, Math.max(channelCounts.get(channel) || 0, 1))
    }
  })

  const knownChannels = [...channelCounts.keys()]
  const visibleChannels = [...new Set([
    ...knownChannels,
    ...channelOrder.slice(0, Math.max(2, Math.min(4, knownChannels.length || 2))),
  ])]
  const slotsPerChannel = Math.max(1, Math.ceil(slotTotal / visibleChannels.length))

  const nextGeneratedLabel = (index: number) => {
    const channel = getMemoryChannel('', index)
    const nextIndex = (channelCounts.get(channel) || 0) + 1
    channelCounts.set(channel, nextIndex)
    return `DIMM_${channel}${nextIndex}`
  }

  const nextBalancedEmptyLabel = () => {
    const channel = visibleChannels
      .filter((candidate) => (channelCounts.get(candidate) || 0) < slotsPerChannel)
      .sort((left, right) => {
        const countDelta = (channelCounts.get(left) || 0) - (channelCounts.get(right) || 0)
        if (countDelta !== 0) return countDelta
        return channelOrder.indexOf(left) - channelOrder.indexOf(right)
      })[0] || visibleChannels[0] || 'A'
    const nextIndex = (channelCounts.get(channel) || 0) + 1
    channelCounts.set(channel, nextIndex)
    return `DIMM_${channel}${nextIndex}`
  }

  for (let index = 0; index < slotTotal; index += 1) {
    if (labels[index]) continue
    const item = source[index]
    labels[index] = hasMemoryModule(item)
      ? nextGeneratedLabel(index)
      : nextBalancedEmptyLabel()
  }

  return labels
}
