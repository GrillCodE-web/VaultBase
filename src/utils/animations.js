/**
 * Animation utilities for table rows and other elements
 */

/**
 * Add highlight animation to a row element
 */
export function highlightRow(element) {
  if (!element) return

  element.classList.add('row-highlight')

  setTimeout(() => {
    element.classList.remove('row-highlight')
  }, 1000)
}

/**
 * Add delete animation to a row element
 */
export function animateRowDelete(element, callback) {
  if (!element) {
    callback?.()
    return
  }

  element.classList.add('row-delete')

  setTimeout(() => {
    callback?.()
  }, 300)
}

/**
 * Add insert animation to a row element
 */
export function animateRowInsert(element) {
  if (!element) return

  element.classList.add('row-insert')

  setTimeout(() => {
    element.classList.remove('row-insert')
  }, 300)
}

/**
 * Add shake animation to an element (for errors)
 */
export function shakeElement(element) {
  if (!element) return

  element.classList.add('shake')

  setTimeout(() => {
    element.classList.remove('shake')
  }, 400)
}

/**
 * Add pulse animation to an element (for success)
 */
export function pulseElement(element) {
  if (!element) return

  element.classList.add('pulse')

  setTimeout(() => {
    element.classList.remove('pulse')
  }, 300)
}

/**
 * Add bounce animation to an element
 */
export function bounceElement(element) {
  if (!element) return

  element.classList.add('bounce')

  setTimeout(() => {
    element.classList.remove('bounce')
  }, 500)
}

/**
 * Flash row when updated via WebSocket
 */
export function flashRow(element) {
  if (!element) return

  element.classList.add('row-flash')

  setTimeout(() => {
    element.classList.remove('row-flash')
  }, 2000)
}
