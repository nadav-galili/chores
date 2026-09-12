/**
 * Every string the app says, in the default locale. `he.ts` is typed against this object, so a key
 * added here without a Hebrew twin is a typecheck failure rather than an English word on a Hebrew
 * screen. Placeholders are i18n-js `%{name}`; a `{ one, other }` value is chosen by `count`.
 */
/**
 * A counted string. Hebrew adds `two` — two days is `יומיים`, one word, not "2 days" — so the
 * Hebrew catalog may carry a form English has no use for (`pluralize` in the device's i18n).
 */
export type Plural = { one: string; two?: string; other: string };

/** Written as a call so a plural leaf types as `Plural` and Hebrew can add its own forms. */
const plural = (forms: Plural): Plural => forms;

export const en = {
  common: {
    back: 'Back',
    save: 'Save',
    done: 'Done',
    tryAgain: 'Try again',
    all: 'All',
    continue: 'Continue',
  },
  role: {
    question: 'Who is using this device?',
    parent: 'Parent',
    kid: 'Kid',
  },
  kid: {
    offline: 'Showing what’s saved on this device.',
    refused: plural({
      one: 'One tap didn’t save. Tap to hide.',
      other: '%{count} taps didn’t save. Tap to hide.',
    }),
    petButton: '%{name}, level %{level}',
    // Voice is the third of the three differences between the modes (docs/spec/06-design.md):
    // celebratory for a 7-year-old, neutral for a 10-year-old. `big` carries no exclamation
    // mark anywhere — that is the whole of what "neutral" means here, and it is checkable.
    little: {
      greeting: 'Hi %{name}!',
      empty: '🎈 Nothing to do today!',
      dayComplete: 'Everything’s done! Amazing!',
      // A rejected chore, back for a redo: the copy says what to do, never what went wrong.
      redo: 'Do these again!',
      redoEmpty: 'Nothing to do again. Great!',
      grove: 'Your grove is growing!',
      shop: 'Spend your coins!',
      coins: 'Look how many coins you have!',
      doneMoment: 'Nice! Plus %{coins} coins',
      grew: 'Your tree grew! 🌱',
    },
    big: {
      greeting: 'Hi %{name}',
      empty: 'Nothing to do today.',
      dayComplete: 'Everything’s done.',
      redo: 'Do again',
      redoEmpty: 'Nothing to do again.',
      grove: 'Your grove',
      shop: 'Reward shop',
      coins: 'Your coins',
      doneMoment: 'Plus %{coins} coins',
      grew: 'Your tree grew 🌱',
    },
  },
  // The coin display's own strings: the glyph sits where the language wants it, which is why a
  // number and an emoji need a catalog entry at all.
  coins: {
    tally: '%{coins} 🪙',
    pays: '+%{coins} 🪙',
  },
  streak: {
    badge: plural({ one: '🔥 %{count} day', other: '🔥 %{count} days' }),
    line: plural({ one: '🔥 %{count} day in a row', other: '🔥 %{count} days in a row' }),
  },
  pet: {
    back: 'Today',
    level: 'Level %{level}',
    mood: {
      happy: '%{name} is delighted — everything is done!',
      content: '%{name} is pleased. Keep going!',
      sleepy: '%{name} is dozing. Tap a chore to wake them up.',
    },
    moodWord: { happy: 'happy', content: 'content', sleepy: 'sleepy' },
    stage: {
      egg: 'Egg',
      hatchling: 'Hatchling',
      fledgling: 'Fledgling',
      full: 'Full-grown',
      splendid: 'Splendid',
    },
    artLabel: '%{name}, level %{level}, %{mood}',
    fullyGrown: 'fully grown',
    xpMax: '%{xp} XP · fully grown',
    xpToNext: '%{into} / %{needed} XP to level %{level}',
  },
  grove: {
    back: 'Today',
    title: 'Your grove',
    buttonLabel: plural({ one: 'Your grove, one tree', other: 'Your grove, %{count} trees' }),
    mine: 'You',
    trees: plural({ one: '%{count} tree', other: '%{count} trees' }),
    empty: 'Finish everything today and this seed starts growing.',
    treeLabel: plural({ one: '%{name}, one tree', other: '%{name}, %{count} trees' }),
  },
  join: {
    title: 'Type your code',
    titleRevoked: 'Ask a parent to reconnect',
    hint: 'A parent can show it to you.',
    hintRevoked: 'This device was disconnected. A parent can show you a new code.',
    action: 'Join',
    imAParent: 'I’m a parent',
    error: {
      invalid_code: 'That code isn’t right. Check it with a parent.',
      code_expired: 'That code has expired. Ask a parent for a new one.',
      code_redeemed: 'That code was already used. Ask a parent for a new one.',
      rate_limited: 'Too many tries. Wait a little and try again.',
      platform: 'Mibo kid mode runs on a phone or tablet.',
      failed: 'Could not join. Try again.',
    },
  },
  exit: {
    pinTitle: 'Parent PIN',
    pinBody: 'Enter the PIN to leave kid mode.',
    pinLabel: 'PIN',
    unlock: 'Continue',
    wrongPin: 'That PIN is not right. Have another go.',
    cooldown: 'That is enough tries for now. Try again in %{seconds}s.',
    noPinTitle: 'Not yet',
    noPin:
      'The PIN has not reached this device yet. It arrives with the next sync, so this device needs to be online once — then kid mode ends here with the PIN.',
    title: 'Leave kid mode?',
    body: 'This device will forget %{name} and switch to parent mode. Show a new join code to connect it again.',
    theChild: 'the child',
    leave: 'Leave kid mode',
    stay: 'Stay',
  },
  signIn: {
    title: 'Sign in as a parent',
    codeTitle: 'Enter the code we emailed you',
    differentEmail: 'Use a different email',
    google: 'Continue with Google',
    googleUnfinished: 'Google sign-in did not finish',
    googleFailed: 'Google sign-in failed',
    emailLabel: 'Or use your email',
    emailCode: 'Email me a code',
    unfinished: 'That did not finish (%{status})',
  },
  parent: {
    unreachable: 'Could not reach Mibo',
    todayTitle: 'Today · %{household}',
    notYet: 'Not yet',
    doneAt: '✓ %{time}',
    progress: '%{done} of %{due} done',
    loadFailed: 'Could not load today.',
    nothingDue: 'Nothing due today.',
    noChildren: 'No children yet. Add the first one.',
    reject: 'Reject',
    rejecting: 'Rejecting…',
    // What came back from the rejection, said in the parent's terms rather than the protocol's.
    rejected: 'Rejected. %{title} is back for a redo.',
    rejectAlreadyUndone: '%{title} was already undone. Nothing changed.',
    rejectFailed: 'Could not reject %{title}.',
    // The reward requests waiting on a parent. The coins are already gone by the time one of
    // these appears (ADR-0014), so a decline gives them back and says so: to a child, that is
    // the whole of what happened.
    requests: {
      title: plural({ one: 'One request', other: '%{count} requests' }),
      asked: '%{name} asked for %{reward}',
      approve: 'Approve',
      decline: 'Decline',
      deciding: 'Saving…',
      approved: 'Approved %{reward} for %{name}.',
      declined: 'Declined. %{name} has their coins back.',
      alreadyDecided: 'That was already decided. Nothing changed.',
      alreadyCancelled: '%{name} changed their mind first. Their coins are back.',
      failed: 'Could not answer %{name}’s request.',
    },
    // The seven-day grid. It reuses the today screen's reject copy verbatim, because it is the
    // same endpoint and the same decision — only the day is older.
    week: {
      open: 'Last seven days',
      title: 'Last seven days · %{name}',
      empty: 'Nothing recorded in the last seven days.',
      loadFailed: 'Could not load the last seven days.',
      // What a cell reads as to a screen reader: the chore, the day, and where it stands.
      cell: '%{title}, %{date}: %{state}',
      state: {
        due: 'not done',
        done: 'done',
        redo: 'sent back for a redo',
        pending_photo: 'waiting on a photo',
      },
    },
    nav: {
      children: 'Children',
      chores: 'Chores',
      partner: 'Add a partner',
      rewards: 'Rewards',
      pin: 'Parent PIN',
      signOut: 'Sign out',
    },
  },
  household: {
    title: 'Set up your household',
    name: 'Household name',
    namePlaceholder: 'The Galilis',
    currency: 'Currency',
    ils: '₪ ILS',
    usd: '$ USD',
    tz: 'Timezone (from this phone)',
    create: 'Create household',
    failed: 'Could not create the household',
  },
  partner: {
    title: 'Your partner',
    hint: 'They sign in with this email and land in this household. Two parents on the free plan.',
    signedIn: 'Signed in',
    pending: '%{email} · waiting for sign-in',
    emailLabel: 'Partner’s email',
    add: 'Add partner',
    error: {
      gated: 'The free plan covers two parents.',
      already_in_household: 'That email already belongs to a household.',
      invalid_body: 'That does not look like an email address.',
      failed: 'Could not add them. Try again.',
      loadFailed: 'Could not load who is in this household.',
    },
  },
  chores: {
    title: 'Chores',
    empty: 'No chores yet. Add the first one.',
    add: 'Add a chore',
    needAChild: 'Add a child before adding chores.',
    everyDay: 'Every day',
    once: 'Once · %{date}',
    meta: '%{recurrence} · %{who}',
  },
  choreForm: {
    edit: 'Edit %{title}',
    title: 'Title',
    howOften: 'How often',
    kind: { daily: 'Every day', weekdays: 'Some days', once: 'Once' },
    whichDays: 'Which days',
    clearAll: 'Clear all',
    selectAll: 'Every day',
    dueDate: 'Due date (YYYY-MM-DD)',
    who: 'Who',
    delete: 'Delete chore',
  },
  children: {
    title: 'Children · %{household}',
    meta: '%{mode} · pet %{pet}',
    reminderMeta: ' · reminder %{time}',
    add: 'Add a child',
  },
  childForm: {
    add: 'Add a child',
    edit: 'Edit %{name}',
    firstName: 'First name',
    uiMode: 'Screen mode',
    little: 'Little',
    big: 'Big',
    petName: 'Pet name',
    reminder: 'Reminder time (HH:MM, optional)',
    showJoinCode: 'Show join code',
  },
  pin: {
    title: 'Parent PIN',
    hint: 'Four digits. Kid mode ends only with this PIN, so set one before a device joins.',
    label: 'PIN',
    save: 'Save PIN',
    failed: 'Could not save the PIN',
  },
  joinCode: {
    title: '%{name}’s join code',
    hint: 'On %{name}’s device, choose Kid and type this code.',
    expired: 'Expired',
    expiresIn: 'Expires in %{time}',
    getting: 'Getting a code…',
    failed: 'Could not get a code',
    pinRequired: 'Set a Parent PIN first: it is how kid mode ends.',
    newCode: 'New code',
  },
  // The reward shop. Flat rather than mode-voiced: what a button does and what a request is
  // waiting for read the same to a 7-year-old and a 10-year-old; only the section's name changes,
  // and that one lives under `kid.little` / `kid.big` with the rest of the voice.
  shop: {
    back: 'Today',
    yours: 'Yours to spend',
    ask: 'Ask',
    cantAfford: 'Not enough coins yet',
    waiting: 'Waiting for a parent',
    cancel: 'Change my mind',
    empty: 'Nothing to spend coins on yet.',
    requests: 'What you asked for',
    approved: 'Yes — go and get it',
    declined: 'Not this time',
  },
  // Built-in reward titles, keyed by `builtin_key` verbatim (packages/shared/src/reward.ts): the
  // seeded row carries the key and no title, so the shop renders its name in the reader's own
  // language rather than the one the household happened to be created in.
  rewards: {
    builtin: {
      snack: 'Pick a snack',
      screen_time: '30 min screen time',
      friday_dinner: 'Pick Friday dinner',
    },
    title: 'Rewards',
    hint: 'Hide anything you are not willing to give. The shop follows on the next sync.',
    shown: 'In the shop',
    hidden: 'Hidden',
    hide: 'Hide',
    show: 'Show',
    saving: 'Saving…',
    saveFailed: 'Could not change %{title}.',
    loadFailed: 'Could not load the rewards.',
  },
  notifications: {
    channel: 'Reminders',
  },
  errors: {
    save: 'Could not save',
    delete: 'Could not delete',
    field: '%{field}: %{message}',
    form: 'form',
    invalid: 'invalid',
  },
};

export type Catalog = typeof en;
