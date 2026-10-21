'use client'

/**
 * The page's motion layer: one listener set for the whole document.
 *
 * - `[data-reveal]` elements get `is-in` the first time they enter the viewport.
 * - `[data-spotlight]` elements follow the pointer through `--mx` and `--my`.
 * - `[data-parallax]` elements lean toward the pointer through `--px` and `--py`.
 * - `html[data-scrolled]` tells the header when the page has left the top.
 *
 * Values go straight to CSS custom properties instead of React state, so the
 * pointer never re-renders anything. Reveals only start once
 * `html[data-motion='on']` is set here, so the page reads fine without
 * JavaScript, and reduced motion gets the final state at once.
 */

import { useEffect } from 'react'

export function Motion() {
  useEffect(() => {
    const root = document.documentElement
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    root.dataset.motion = 'on'

    const reveals = document.querySelectorAll<HTMLElement>('[data-reveal]')
    const revealer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          revealer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    )
    for (const element of reveals) {
      if (reduced) element.classList.add('is-in')
      else revealer.observe(element)
    }

    const onScroll = () => {
      root.dataset.scrolled = String(window.scrollY > 24)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })

    let frame = 0
    const onPointer = (event: PointerEvent) => {
      if (reduced || event.pointerType !== 'mouse') return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const target = event.target instanceof Element ? event.target : null
        const spot = target?.closest<HTMLElement>('[data-spotlight]')
        if (spot) {
          const box = spot.getBoundingClientRect()
          spot.style.setProperty('--mx', `${String(event.clientX - box.left)}px`)
          spot.style.setProperty('--my', `${String(event.clientY - box.top)}px`)
        }
        for (const layer of document.querySelectorAll<HTMLElement>('[data-parallax]')) {
          const box = layer.getBoundingClientRect()
          if (box.bottom < 0 || box.top > window.innerHeight) continue
          const x = (event.clientX - (box.left + box.width / 2)) / window.innerWidth
          const y = (event.clientY - (box.top + box.height / 2)) / window.innerHeight
          layer.style.setProperty('--px', x.toFixed(3))
          layer.style.setProperty('--py', y.toFixed(3))
        }
      })
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    return () => {
      revealer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pointermove', onPointer)
    }
  }, [])

  return null
}
