import { useSmartToast, useToast } from './useSmartToast'

/**
 * usePremiumToast — расширенный hook для премиум-уведомлений
 * Предоставляет готовые шаблоны для типичных сценариев
 */
export function usePremiumToast() {
  const { success, error, warning, info, dismissAll } = useSmartToast()
  // Старый API toast(msg, type) — 24 файла деструктурируют `toast` отсюда;
  // без этого поля он был undefined и каждый вызов падал
  // с "toast is not a function".
  const { toast } = useToast()

  // CRUD операции
  const successCreate = (entityName, _count = 1) =>
    success(`${entityName} created successfully`, {
      groupKey: `create-${entityName}`,
    })

  const successUpdate = entityName =>
    success(`${entityName} updated successfully`, {
      groupKey: `update-${entityName}`,
    })

  const successDelete = (entityName, count = 1) =>
    success(`${count} ${entityName}${count > 1 ? 's' : ''} deleted`, {
      groupKey: `delete-${entityName}`,
      duration: 3000,
    })

  const successImport = (entityName, count) =>
    success(`Imported ${count} ${entityName}${count > 1 ? 's' : ''}`, {
      groupKey: 'import',
      duration: 5000,
    })

  const successExport = entityName =>
    success(`${entityName} exported successfully`, {
      groupKey: 'export',
      duration: 4000,
    })

  // Ошибки
  const errorLoad = entityName =>
    error(`Failed to load ${entityName}`, {
      groupKey: `error-load-${entityName}`,
      duration: 6000,
    })

  const errorSave = (entityName, message) =>
    error(`Failed to save ${entityName}: ${message}`, {
      groupKey: `error-save-${entityName}`,
      duration: 7000,
    })

  const errorDelete = entityName =>
    error(`Failed to delete ${entityName}`, {
      groupKey: `error-delete-${entityName}`,
      duration: 5000,
    })

  // Предупреждения
  const warningValidation = message =>
    warning(`Validation warning: ${message}`, {
      groupKey: 'validation',
      duration: 6000,
    })

  const warningConflict = message =>
    warning(`Conflict detected: ${message}`, {
      groupKey: 'conflict',
      duration: 7000,
    })

  // Информационные
  const infoSync = message =>
    info(`Sync: ${message}`, {
      groupKey: 'sync',
      duration: 4000,
    })

  const infoBulkAction = (action, count) =>
    info(`${action} ${count} items`, {
      groupKey: `bulk-${action}`,
      duration: 3000,
    })

  // Уведомления с действиями
  const successWithAction = (message, actionLabel, actionCallback) =>
    success(message, {
      action: {
        label: actionLabel,
        onClick: actionCallback,
      },
      duration: 8000,
    })

  const warningUndo = (message, undoCallback) =>
    warning(message, {
      action: {
        label: 'Undo',
        onClick: undoCallback,
      },
      duration: 6000,
      groupKey: 'undo',
    })

  return {
    // Старый API: toast(msg, 'success' | 'error' | ...)
    toast,

    // Базовые методы
    success,
    error,
    warning,
    info,
    dismissAll,

    // CRUD методы
    successCreate,
    successUpdate,
    successDelete,
    successImport,
    successExport,

    // Ошибки
    errorLoad,
    errorSave,
    errorDelete,

    // Предупреждения
    warningValidation,
    warningConflict,

    // Информационные
    infoSync,
    infoBulkAction,

    // С действиями
    successWithAction,
    warningUndo,
  }
}
