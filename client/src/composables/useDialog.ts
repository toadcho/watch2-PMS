import { ref } from 'vue'

const visible = ref(false)
const title = ref('')
const message = ref('')
const type = ref<'alert' | 'confirm' | 'prompt'>('alert')
const color = ref('primary')
const inputValue = ref('')
const inputLabel = ref('')
const inputType = ref('text')
let resolveFn: ((val: any) => void) | null = null

export function useDialog() {
  function showAlert(msg: string, opts?: { title?: string; color?: string }): Promise<void> {
    title.value = opts?.title || '알림'
    message.value = msg
    type.value = 'alert'
    color.value = opts?.color || 'primary'
    visible.value = true
    return new Promise(resolve => { resolveFn = () => resolve() })
  }

  function showConfirm(msg: string, opts?: { title?: string; color?: string }): Promise<boolean> {
    title.value = opts?.title || '확인'
    message.value = msg
    type.value = 'confirm'
    color.value = opts?.color || 'primary'
    visible.value = true
    return new Promise(resolve => { resolveFn = resolve })
  }

  function showPrompt(msg: string, opts?: { title?: string; label?: string; inputType?: string }): Promise<string | null> {
    title.value = opts?.title || '입력'
    message.value = msg
    type.value = 'prompt'
    color.value = 'primary'
    inputValue.value = ''
    inputLabel.value = opts?.label || ''
    inputType.value = opts?.inputType || 'text'
    visible.value = true
    return new Promise(resolve => { resolveFn = resolve })
  }

  function onOk() {
    visible.value = false
    if (type.value === 'prompt') resolveFn?.(inputValue.value)
    else if (type.value === 'confirm') resolveFn?.(true)
    else resolveFn?.(undefined)
  }

  function onCancel() {
    visible.value = false
    if (type.value === 'prompt') resolveFn?.(null)
    else if (type.value === 'confirm') resolveFn?.(false)
    else resolveFn?.(undefined)
  }

  return {
    visible, title, message, type, color, inputValue, inputLabel,
    showAlert, showConfirm, showPrompt, onOk, onCancel, inputType,
  }
}
