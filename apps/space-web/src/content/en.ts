/** English copy. Its shape is the Spanish dictionary's, enforced by the type. */

import type { Dictionary } from './es'

export const en: Dictionary = {
  meta: {
    title: 'Allfit Space · Train with a plan, not with luck',
    description:
      'Your programme, every set and what you eat, in one app. And your history goes with you: your data is yours.',
    privacyTitle: 'Data processing policy · Allfit Space',
    termsTitle: 'Terms and conditions · Allfit Space',
  },
  nav: {
    skip: 'Skip to content',
    label: 'Main',
    features: 'The app',
    programs: 'Programmes',
    privacy: 'Privacy',
    gyms: 'Gyms',
    language: 'Language',
    home: 'Allfit Space, home',
  },
  stores: {
    soon: 'Coming soon on',
    appStore: 'App Store',
    googlePlay: 'Google Play',
    download: 'Get it on',
  },
  hero: {
    lines: ['TRAIN', 'WITH A PLAN.', 'NOT WITH LUCK.'],
    lead: 'Your programme, every set and what you eat, in one app. And your history goes with you.',
    todayAlt: "Allfit Space Today screen: the day's Pull session and the week at a glance.",
    programAlt: 'Upper and lower programme detail: 10 weeks, 4 days a week and its sessions.',
    scroll: 'Scroll',
  },
  ticker: ['Strength', 'Hypertrophy', 'Running', 'Nutrition', 'Records', 'Consistency'],
  features: {
    title: ['FROM THE FIRST SET', 'TO THE LAST BITE.'],
    cards: [
      {
        title: 'YOUR WEEK, AT A GLANCE',
        text: "What's on today, how far into the week you are and everything you've already trained.",
        alt: 'Today screen with the weekly summary and the session history.',
      },
      {
        title: 'EVERY SET COUNTS',
        text: 'See what you lifted last time and beat it, set by set.',
        alt: 'Session in progress with pull-up sets and the previous weight.',
      },
      {
        title: 'WHAT YOU EAT, AGAINST YOUR GOAL',
        text: "The day's calories and macros against the goal that comes with your programme.",
        alt: "The day's meals with calories and macros against the goal.",
      },
    ],
  },
  programs: {
    title: ['A PROGRAMME', 'FOR YOUR GOAL.'],
    lead: "Tell it what you want to achieve and how much you've trained, and the app suggests where to start. Strength, hypertrophy, running or getting moving again.",
    suggested: 'Suggested for you',
    items: [
      { name: 'UPPER AND LOWER', meta: '4 days · 10 weeks' },
      { name: 'BASIC STRENGTH', meta: '3 days · 8 weeks' },
      { name: 'HALF MARATHON', meta: '4 days · 12 weeks' },
      { name: 'PUSH · PULL · LEGS', meta: '5 days · 12 weeks' },
    ],
  },
  privacy: {
    title: ['YOUR DATA', 'IS YOURS.'],
    lead: 'Your gym and your coach see only what you accept, category by category. And you take it back whenever you want, without losing anything of yours.',
    alt: 'What you share screen: each gym with the categories it can see.',
    pillars: [
      {
        title: 'Nothing is shared on its own',
        text: 'Accepting a gym shares no data. You choose what it sees, category by category.',
      },
      {
        title: 'Cut it off whenever you want',
        text: 'Remove a permission and they stop seeing it instantly. Your data stays with you.',
      },
      {
        title: 'You leave with everything',
        text: 'If you leave a gym, your history stays with you and you keep training without losing anything.',
      },
    ],
  },
  records: {
    title: ['EVERY', 'RECORD', 'COUNTS.'],
    lead: 'Finish your workout and the app already has your card ready: your record, the muscles you worked or your own photo. One tap from your stories.',
    steps: [
      { verb: 'FINISH', text: 'The card is built from your real data.' },
      { verb: 'CHOOSE', text: 'Muscles, a record or your photo behind it.' },
      { verb: 'POST', text: 'Straight to your stories, no screenshots.' },
    ],
    cards: [
      'Muscles card: lats and upper back, worked in the Pull session.',
      'Personal record card: 35 kg pull-ups, 2.5 kg more than last time.',
      'Workout completed card with a photo: Pull session, 26:05 and 1,920 kg in total.',
    ],
    editor: {
      label: 'Preview of a story ready to post',
      caption: 'Add a caption…',
      story: 'Your story',
      friends: 'Friends',
      published: 'Shared to your story',
    },
    background: 'Athlete checking her phone at the gym after training.',
  },
  pro: {
    eyebrow: 'ALLFIT PRO',
    title: ['ALLFIT PRO,', 'INCLUDED WITH', 'YOUR GYM.'],
    text: 'The app is free. Allfit Pro gives you unlimited programmes and all your progress in detail. If your gym uses Allfit, Pro is included for as long as you stay with them.',
    alt: 'Athlete with headphones focusing before training at the gym.',
  },
  studio: {
    title: 'Do you run a gym or coach others?',
    text: 'Invite your clients, assign their programme and follow them from Allfit Studio.',
    cta: 'Discover Allfit Studio',
  },
  closing: {
    title: ['YOUR NEXT RECORD', 'STARTS TODAY.'],
  },
  nvidia: {
    member: 'Allfit One is a member of NVIDIA Inception.',
    trademark:
      '© 2026 NVIDIA, the NVIDIA logo, and NVIDIA Inception are trademarks and/or registered trademarks of NVIDIA Corporation in the U.S. and other countries.',
    alt: 'NVIDIA Inception Program',
  },
  footer: {
    terms: 'Terms',
    privacy: 'Privacy',
    studio: 'Allfit Studio',
    one: 'Allfit One',
    rights: '© 2026 Allfit One',
    newWindow: 'Opens in a new tab.',
  },
  legal: {
    draft: 'Preliminary version',
    draftNote: 'This text is a draft under legal review. It may change before the app launches.',
    updated: 'Last updated: 20 October 2026',
    back: 'Back to Allfit Space',
    pending: '[To be confirmed]',
    privacy: {
      title: 'Personal data processing policy',
      sections: [
        {
          heading: '1. Who is responsible',
          body: [
            'The controller of your data in Allfit Space is [To be confirmed: company name and tax ID], domiciled in [To be confirmed], Colombia.',
            'For any request or complaint about your data, write to [To be confirmed: privacy email].',
            'This policy follows Colombian Law 1581 of 2012 and Decree 1377 of 2013 (compiled in Decree 1074 of 2015).',
          ],
        },
        {
          heading: '2. What data we process',
          body: [
            'Identification and contact data: first name, last name, email and, if you give it, your mobile number.',
            'Training data: programmes, sessions, sets, loads, times and records.',
            'Non-clinical nutrition data: meals, foods, nutrients and, if you upload them, photos of your meals.',
            'Body progress and health context, only if you choose to record them. These are sensitive data: providing them is optional and never a condition for using the app.',
          ],
        },
        {
          heading: '3. What we use them for',
          body: [
            'To provide the service: keep your history, show your progress and suggest programmes.',
            'To share with a gym or coach exactly the categories you authorise, and only while you authorise them.',
            'For the security of your account, support and compliance with legal obligations.',
            'We do not sell your data or use it for third-party advertising.',
          ],
        },
        {
          heading: '4. What you share with your gym',
          body: [
            'Accepting a gym shares no data on its own. You choose which categories it sees, one by one.',
            'You can withdraw any permission at any time from the app. From that moment they stop seeing it, and everything else you share stays the same.',
            'If you end your relationship with a gym, your history is still yours and stays in your account.',
          ],
        },
        {
          heading: '5. Your rights',
          body: [
            'To know, update and correct your data; to request proof of your authorisation; to know how it has been used; to revoke your authorisation or request deletion when there is no legal duty to keep it; and to file complaints with the Superintendencia de Industria y Comercio.',
            'Requests are answered within ten business days at most, and complaints within fifteen business days at most, as the law provides.',
          ],
        },
        {
          heading: '6. Security, retention and transfers',
          body: [
            'We protect your data with technical and organisational controls, and every authorised access to it is logged.',
            'We use cloud infrastructure providers that may host data outside Colombia, with adequate protection safeguards.',
            'We keep your data while you have an active account and for the periods the law requires.',
          ],
        },
        {
          heading: '7. Minimum age',
          body: ['Allfit Space is only for people aged 18 or over.'],
        },
      ],
    },
    terms: {
      title: 'Terms and conditions of use',
      sections: [
        {
          heading: '1. Acceptance',
          body: [
            'By creating an Allfit Space account you accept these terms. Accounts are created only in the app.',
            'The service is provided by [To be confirmed: company name and tax ID].',
          ],
        },
        {
          heading: '2. Who can use it',
          body: [
            'You must be 18 or over and give truthful information. Your account is personal and you are responsible for its use.',
          ],
        },
        {
          heading: '3. The service',
          body: [
            'Allfit Space lets you follow training programmes, log your sessions and your non-clinical nutrition, and share what you choose with your gym or coach.',
            'The app does not provide medical or clinical nutrition advice. See a health professional before starting a programme if you have any medical condition.',
          ],
        },
        {
          heading: '4. Gyms and coaches',
          body: [
            'Gyms and coaches using Allfit Studio are independent from Allfit. Their service and their fees are governed by what you agree with them.',
            'Allfit does not receive or handle the money you pay your gym.',
          ],
        },
        {
          heading: '5. Allfit Pro',
          body: [
            'The app is free. Allfit Pro is an optional subscription bought on the App Store or Google Play, under their payment and cancellation terms.',
            'If your gym uses Allfit, Pro is included while you stay active with them. If Pro ends, you keep your whole history.',
          ],
        },
        {
          heading: '6. Acceptable use',
          body: [
            "Do not use the app for unlawful purposes, to access other people's accounts or to disrupt how it works.",
          ],
        },
        {
          heading: '7. Liability',
          body: [
            'Training involves physical risks that you assume when following a programme. Allfit is liable under the applicable Colombian law.',
          ],
        },
        {
          heading: '8. Changes and governing law',
          body: [
            'If we change these terms we will let you know in the app before they take effect.',
            'These terms are governed by the laws of the Republic of Colombia.',
          ],
        },
      ],
    },
  },
}
