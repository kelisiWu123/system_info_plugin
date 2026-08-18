import { onActivated, onDeactivated, onUnmounted, watch } from 'vue'

type PageLifecycleAction = () => void | Promise<void>

export function useActivePageLifecycle(
  isActive: () => boolean | undefined,
  activate: PageLifecycleAction,
  deactivate: () => void,
) {
  const requestActivation = () => {
    if (isActive() === false) return
    void Promise.resolve(activate()).catch((error) => {
      console.error('页面激活失败:', error)
    })
  }

  watch(
    isActive,
    (active) => {
      if (active === false) {
        deactivate()
        return
      }

      requestActivation()
    },
    { immediate: true },
  )

  onActivated(() => {
    requestActivation()
  })

  onDeactivated(() => {
    deactivate()
  })

  onUnmounted(() => {
    deactivate()
  })
}
