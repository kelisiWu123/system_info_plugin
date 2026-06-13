export function splitItemsIntoColumns<T>(items: T[], columnCount: number) {
  const safeColumnCount = Number.isInteger(columnCount) && columnCount > 0 ? columnCount : 1
  const columns = Array.from({ length: safeColumnCount }, () => [] as T[])

  items.forEach((item, index) => {
    columns[index % safeColumnCount].push(item)
  })

  return columns
}
