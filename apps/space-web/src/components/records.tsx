'use client'

/**
 * «Cada récord se cuenta»: the share flow told in three steps while the section
 * holds still.
 *
 * On wide screens the section is three viewports tall and its content sticks;
 * three invisible markers, one per viewport, decide the step as they cross the
 * middle of the screen. On narrow screens nothing sticks, so the story editor
 * steps on its own while it is in view. With reduced motion it stays on the
 * first card unless the visitor scrolls the markers.
 */

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'

import {
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  ExpandIcon,
  FavouriteIcon,
  ForwardIcon,
  ImageIcon,
} from '@allfitone/react/icons'

import type { Dictionary } from '@/content'

import { Phone } from './phone'
import { Title } from './title'

const CARDS = ['/images/cards/card5.webp', '/images/cards/card2.webp', '/images/cards/photoA.webp']
const AUTO_STEP_MS = 2800

export function Records({ copy }: { copy: Dictionary['records'] }) {
  const section = useRef<HTMLElement>(null)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const element = section.current
    if (!element) return
    const markers = [...element.querySelectorAll<HTMLElement>('[data-marker]')]
    const sticky = window.matchMedia('(min-width: 961px)').matches
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (sticky) {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting)
              setStep(markers.findIndex((marker) => marker === entry.target))
          }
        },
        { rootMargin: '-50% 0px -50% 0px' },
      )
      for (const marker of markers) observer.observe(marker)
      return () => observer.disconnect()
    }
    if (reduced) return

    let timer = 0
    const observer = new IntersectionObserver(([entry]) => {
      window.clearInterval(timer)
      if (entry?.isIntersecting) {
        timer = window.setInterval(
          () => setStep((current) => (current + 1) % CARDS.length),
          AUTO_STEP_MS,
        )
      }
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      window.clearInterval(timer)
    }
  }, [])

  return (
    <section ref={section} className="records" aria-labelledby="records-title">
      <div className="records__markers" aria-hidden="true">
        {CARDS.map((card) => (
          <div key={card} data-marker="" />
        ))}
      </div>
      <div className="records__sticky">
        <div className="records__photo">
          <Image src="/images/photos/records.webp" alt="" fill sizes="100vw" />
        </div>
        <div className="records__veil" />
        <div className="wrap records__grid">
          <div className="records__copy">
            <Title
              id="records-title"
              lines={copy.title}
              tones={['solid', 'ghost', 'cyan']}
              size="xl"
            />
            <p className="lead" data-reveal="">
              {copy.lead}
            </p>
            <ol className="steps" data-reveal="">
              {copy.steps.map((item, index) => (
                <li key={item.verb} className="step" data-active={String(index === step)}>
                  <span className="step__num">0{index + 1}</span>
                  <span className="step__verb">{item.verb}</span>
                  <span className="step__text">{item.text}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="records__stage" data-reveal="">
            <figure className="story" data-step={step} aria-label={copy.editor.label}>
              <Phone>
                <span className="story__close" aria-hidden="true">
                  <CloseIcon size="md" decorative />
                </span>
                <span className="story__tools" aria-hidden="true">
                  <span className="story__tool story__tool--text">Aa</span>
                  <span className="story__tool">
                    <ImageIcon size="md" decorative />
                  </span>
                  <span className="story__tool">
                    <FavouriteIcon size="md" decorative />
                  </span>
                  <span className="story__tool">
                    <DownloadIcon size="md" decorative />
                  </span>
                  <span className="story__tool story__tool--more">
                    <ExpandIcon size="sm" decorative />
                  </span>
                </span>
                <span className="story__toast" aria-hidden="true">
                  <CheckIcon size="sm" decorative />
                  {copy.editor.published}
                </span>
                <span className="story__cards">
                  {CARDS.map((card, index) => (
                    <span key={card} className="story__card" data-active={String(index === step)}>
                      <Image
                        src={card}
                        alt={index === step ? (copy.cards[index] ?? '') : ''}
                        width={640}
                        height={1136}
                        sizes="280px"
                      />
                    </span>
                  ))}
                </span>
                <p className="story__caption" aria-hidden="true">
                  {copy.editor.caption}
                </p>
                <span className="story__bar" aria-hidden="true">
                  <span className="story__pill story__pill--story">
                    <span className="story__avatar" />
                    {copy.editor.story}
                  </span>
                  <span className="story__pill">
                    <span className="story__star">
                      <FavouriteIcon size="xs" decorative />
                    </span>
                    {copy.editor.friends}
                  </span>
                  <span className="story__send">
                    <ForwardIcon size="md" decorative />
                  </span>
                </span>
              </Phone>
            </figure>
          </div>
        </div>
      </div>
    </section>
  )
}
