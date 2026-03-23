import { useEffect, useRef } from 'react'

/**
 * Hook to add entrance animation to a component
 */
export function useEntranceAnimation(animationClass = 'fade-in') {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.classList.add(animationClass)
    }
  }, [animationClass])

  return ref
}

/**
 * Hook to animate list items with stagger effect
 */
export function useStaggerAnimation(items, delay = 50) {
  const refs = useRef([])

  useEffect(() => {
    refs.current.forEach((ref, index) => {
      if (ref) {
        ref.style.animationDelay = `${index * delay}ms`
        ref.classList.add('stagger-item')
      }
    })
  }, [items, delay])

  return refs
}

/**
 * Hook to add page transition animation
 */
export function usePageTransition() {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.classList.add('page-enter')
    }
  }, [])

  return ref
}
