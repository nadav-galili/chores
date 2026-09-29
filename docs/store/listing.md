# Store listing copy

The description, promotional text and Play descriptions for both stores, in English and Hebrew. Written once here and pasted from here — into App Store Connect at stage 11 of `scripts/setup-store-listing.sh`, and into Play Console by `scripts/setup-play-listing.sh`, which puts each block on the clipboard. `scripts/setup-play-listing.sh --check` counts every block against its store limit and exits non-zero on any overrun. The title, subtitle and keywords are not here — `docs/spec/05-store-listing.md` owns them.

Rules this copy is written to:

- **Parent-facing.** The reader is the parent who installs it; children are described, never addressed and never claimed as the audience (guideline 2.3.8, ADR-0018). No "for kids" in the prose — Play's title carries that and is Play's business.
- **Allowance as a ledger.** Mibo records what a child is owed; no money moves through it. Promising more is a documented source of 1★ reviews (`docs/spec/05-store-listing.md`).
- **Premium told straight.** What is free and what is Premium follow ADR-0005; the child's side is never paywalled, and the copy says so.
- **3.1.2.** The iOS description ends with the subscription paragraph from `scripts/setup-store-listing.sh`, verbatim in English; the preflight fails if they drift. The Hebrew one carries the same facts in Hebrew. Play has no 3.1.2, so its descriptions end with a Play-worded paragraph instead of Apple's.
- **Terms from the app.** The Hebrew uses the app's own words (`packages/shared/src/i18n/he.ts`): מטלות, מטבעות, חיה, חורשה, דמי כיס, קוד הורה, קוד הצטרפות, מצב ילדים, משק בית, דרישת תמונה.

Each block's marker names its field and its limit. The text between the fences is what gets pasted, character for character.

| field | limit |
|---|---|
| App Store promotional text | 170 |
| App Store description | 4000 |
| Play short description | 80 |
| Play full description | 4000 |

## English

### App Store — promotional text

<!-- field: en.ios.promo limit=170 -->
```text
Chores, coins and a pet that cheers them on. Each child ticks off their own list on their own device, even offline, and you get one summary of the day each evening.
```

### App Store — description

<!-- field: en.ios.description limit=4000 -->
```text
Mibo turns the family chore chart into something your children actually want to open. You set the chores and the rewards. Each child ticks off their own list on their own phone or tablet, earns coins the moment a chore is done, and raises a pet that cheers them on.

FOR THE PARENT WHO RUNS THE HOUSE
• Daily chores, chores on chosen weekdays, or one-off chores — for one child or several
• One evening summary of the day, while there is still time to finish what's left, instead of a notification for every chore
• A chore marked done that wasn't? Reject it: it comes back as a redo, and the coins it earned go back too
• A Parent PIN keeps a child's device in kid mode
• Add your partner, and you both see the same household

WHAT YOUR CHILD SEES
• Today's chores, in a "Little" mode with larger text and buttons for younger children, or a "Big" mode for readers
• Coins for every chore, a daily bonus when the whole list is done, and a streak that grows
• A pet whose mood follows today and whose level follows the effort over time
• A family grove: each child's tree grows a little on every day the list is finished, and never shrinks
• A reward shop to spend coins in — pick a snack, 30 minutes of screen time, pick Friday dinner, or rewards you create

ALLOWANCE WITHOUT THE ARGUMENTS
Set what a coin is worth, see what each child is owed, and record payouts and adjustments. No money moves through Mibo: it keeps the ledger, and you hand over the pocket money.

WORKS OFFLINE
A child's device keeps working without a connection and catches up the next time it is online.

PRIVATE BY DESIGN
Children have no account, no email address and no password. A parent adds a child by first name and connects the child's device with a one-time join code. Mibo shows no ads and contains no advertising or tracking SDK. Parents sign in with Apple, with Google or with email.

ENGLISH AND HEBREW
Fully translated into Hebrew, laid out right to left.

FREE AND PREMIUM
Free: one child, two parents, unlimited chores, the pet, the built-in rewards and seven days of history. Mibo Premium adds more children, a third parent, your own rewards, the allowance ledger and payouts, full history and photo proof — for the whole household. A child's side of the app is never behind a paywall.

Mibo Premium is an auto-renewable subscription: $6.99 per month or $39.99 per year. Payment is charged to your Apple Account at confirmation of purchase. The subscription renews automatically unless it is cancelled at least 24 hours before the end of the current period, and your account is charged for renewal within 24 hours of the end of that period. Manage or cancel it in your Apple Account settings after purchase. Mibo Premium is also available as a one-time purchase of $79.99, which does not renew. Terms of Use: https://mibokids.app/terms  Privacy Policy: https://mibokids.app/privacy
```

### Google Play — short description

<!-- field: en.play.short limit=80 -->
```text
Chore chart and allowance tracker: your child earns coins and raises a pet.
```

### Google Play — full description

<!-- field: en.play.full limit=4000 -->
```text
Mibo turns the family chore chart into something your children actually want to open. You set the chores and the rewards. Each child ticks off their own list on their own phone or tablet, earns coins the moment a chore is done, and raises a pet that cheers them on.

FOR THE PARENT WHO RUNS THE HOUSE
• Daily chores, chores on chosen weekdays, or one-off chores — for one child or several
• One evening summary of the day, while there is still time to finish what's left, instead of a notification for every chore
• A chore marked done that wasn't? Reject it: it comes back as a redo, and the coins it earned go back too
• A Parent PIN keeps a child's device in kid mode
• Add your partner, and you both see the same household

WHAT YOUR CHILD SEES
• Today's chores, in a "Little" mode with larger text and buttons for younger children, or a "Big" mode for readers
• Coins for every chore, a daily bonus when the whole list is done, and a streak that grows
• A pet whose mood follows today and whose level follows the effort over time
• A family grove: each child's tree grows a little on every day the list is finished, and never shrinks
• A reward shop to spend coins in — pick a snack, 30 minutes of screen time, pick Friday dinner, or rewards you create

ALLOWANCE WITHOUT THE ARGUMENTS
Set what a coin is worth, see what each child is owed, and record payouts and adjustments. No money moves through Mibo: it keeps the ledger, and you hand over the pocket money.

WORKS OFFLINE
A child's device keeps working without a connection and catches up the next time it is online.

PRIVATE BY DESIGN
Children have no account, no email address and no password. A parent adds a child by first name and connects the child's device with a one-time join code. Mibo shows no ads and contains no advertising or tracking SDK. Parents sign in with Google or with email.

ENGLISH AND HEBREW
Fully translated into Hebrew, laid out right to left.

FREE AND PREMIUM
Free: one child, two parents, unlimited chores, the pet, the built-in rewards and seven days of history. Mibo Premium adds more children, a third parent, your own rewards, the allowance ledger and payouts, full history and photo proof — for the whole household. A child's side of the app is never behind a paywall.

Mibo Premium is a monthly or yearly subscription that renews automatically until you cancel it in Google Play, or a one-time lifetime purchase that does not renew. Prices are shown in the app before you buy. Terms of Use: https://mibokids.app/terms  Privacy Policy: https://mibokids.app/privacy
```

## עברית

### App Store — טקסט קידום

<!-- field: he.ios.promo limit=170 -->
```text
מטלות, מטבעות וחיה שמעודדת אותם. כל ילד מסמן את הרשימה שלו במכשיר שלו, גם בלי אינטרנט, ואתם מקבלים סיכום אחד של היום בכל ערב.
```

### App Store — תיאור

<!-- field: he.ios.description limit=4000 -->
```text
Mibo הופכת את לוח המטלות של הבית למשהו שהילדים באמת רוצים לפתוח. אתם קובעים את המטלות ואת הפרסים. כל ילד מסמן את הרשימה שלו בטלפון או בטאבלט שלו, מקבל מטבעות ברגע שהמטלה הושלמה, ומגדל חיה שמעודדת אותו.

להורים שמנהלים את הבית
• מטלות לכל יום, לימים מסוימים או לפעם אחת — לילד אחד או לכמה ילדים
• סיכום ערב אחד על היום, כשעוד יש זמן לסיים את מה שנשאר, במקום התראה על כל מטלה
• מטלה סומנה אבל לא באמת בוצעה? דוחים אותה: היא חוזרת לביצוע חוזר, והמטבעות שהרוויחה חוזרים איתה
• קוד הורה משאיר את המכשיר של הילד במצב ילדים
• מוסיפים את בן/בת הזוג, ושניכם רואים את אותו משק בית

מה הילדים רואים
• את המטלות של היום, בתצוגת ״קטנים״ עם טקסט וכפתורים גדולים לילדים צעירים, או בתצוגת ״גדולים״ לילדים שכבר קוראים
• מטבעות על כל מטלה, בונוס כשכל הרשימה הושלמה, ורצף ימים שהולך וגדל
• חיה שמצב הרוח שלה תלוי במה שנעשה היום, והרמה שלה במאמץ לאורך זמן
• חורשה משפחתית: לכל ילד עץ שצומח עוד קצת בכל יום שבו הרשימה הושלמה, ולעולם לא קטן
• חנות פרסים להוציא בה את המטבעות — לבחור חטיף, 30 דקות מסך, לבחור ארוחת שישי, או פרסים שאתם יוצרים

דמי כיס בלי ויכוחים
קובעים כמה שווה מטבע, רואים כמה מגיע לכל ילד, ורושמים תשלומים והתאמות. שום כסף לא עובר דרך Mibo: היא מנהלת את החשבון, ואתם נותנים את דמי הכיס.

עובדת גם בלי אינטרנט
המכשיר של הילד ממשיך לעבוד בלי חיבור ומתעדכן בפעם הבאה שהוא מחובר.

פרטיות מהיסוד
לילדים אין חשבון, אין אימייל ואין סיסמה. הורה מוסיף ילד לפי שם פרטי ומחבר את המכשיר שלו בקוד הצטרפות חד־פעמי. ב־Mibo אין פרסומות, ואין בה רכיבי פרסום או מעקב. הורים נכנסים עם Apple, עם Google או עם אימייל.

עברית ואנגלית
האפליקציה מתורגמת במלואה לעברית, מימין לשמאל.

חינם ו־Premium
בחינם: ילד אחד, שני הורים, מטלות ללא הגבלה, החיה, הפרסים המובנים ושבעה ימי היסטוריה. Mibo Premium מוסיף עוד ילדים, הורה שלישי, פרסים משלכם, דמי כיס ותשלומים, היסטוריה מלאה ודרישת תמונה — לכל משק הבית. הצד של הילד באפליקציה אף פעם לא נעול.

Mibo Premium הוא מינוי שמתחדש אוטומטית: $6.99 לחודש או $39.99 לשנה. התשלום מחויב בחשבון Apple שלכם עם אישור הרכישה. המינוי מתחדש אוטומטית אלא אם בוטל לפחות 24 שעות לפני תום התקופה הנוכחית, והחשבון מחויב על החידוש במהלך 24 השעות שלפני תום התקופה. אפשר לנהל או לבטל את המינוי בהגדרות חשבון Apple אחרי הרכישה. Mibo Premium זמין גם ברכישה חד־פעמית של $79.99, שאינה מתחדשת. תנאי שימוש: https://mibokids.app/terms  מדיניות פרטיות: https://mibokids.app/privacy
```

### Google Play — תיאור קצר

<!-- field: he.play.short limit=80 -->
```text
לוח מטלות ודמי כיס: הילדים צוברים מטבעות ומגדלים חיה שמעודדת אותם.
```

### Google Play — תיאור מלא

<!-- field: he.play.full limit=4000 -->
```text
Mibo הופכת את לוח המטלות של הבית למשהו שהילדים באמת רוצים לפתוח. אתם קובעים את המטלות ואת הפרסים. כל ילד מסמן את הרשימה שלו בטלפון או בטאבלט שלו, מקבל מטבעות ברגע שהמטלה הושלמה, ומגדל חיה שמעודדת אותו.

להורים שמנהלים את הבית
• מטלות לכל יום, לימים מסוימים או לפעם אחת — לילד אחד או לכמה ילדים
• סיכום ערב אחד על היום, כשעוד יש זמן לסיים את מה שנשאר, במקום התראה על כל מטלה
• מטלה סומנה אבל לא באמת בוצעה? דוחים אותה: היא חוזרת לביצוע חוזר, והמטבעות שהרוויחה חוזרים איתה
• קוד הורה משאיר את המכשיר של הילד במצב ילדים
• מוסיפים את בן/בת הזוג, ושניכם רואים את אותו משק בית

מה הילדים רואים
• את המטלות של היום, בתצוגת ״קטנים״ עם טקסט וכפתורים גדולים לילדים צעירים, או בתצוגת ״גדולים״ לילדים שכבר קוראים
• מטבעות על כל מטלה, בונוס כשכל הרשימה הושלמה, ורצף ימים שהולך וגדל
• חיה שמצב הרוח שלה תלוי במה שנעשה היום, והרמה שלה במאמץ לאורך זמן
• חורשה משפחתית: לכל ילד עץ שצומח עוד קצת בכל יום שבו הרשימה הושלמה, ולעולם לא קטן
• חנות פרסים להוציא בה את המטבעות — לבחור חטיף, 30 דקות מסך, לבחור ארוחת שישי, או פרסים שאתם יוצרים

דמי כיס בלי ויכוחים
קובעים כמה שווה מטבע, רואים כמה מגיע לכל ילד, ורושמים תשלומים והתאמות. שום כסף לא עובר דרך Mibo: היא מנהלת את החשבון, ואתם נותנים את דמי הכיס.

עובדת גם בלי אינטרנט
המכשיר של הילד ממשיך לעבוד בלי חיבור ומתעדכן בפעם הבאה שהוא מחובר.

פרטיות מהיסוד
לילדים אין חשבון, אין אימייל ואין סיסמה. הורה מוסיף ילד לפי שם פרטי ומחבר את המכשיר שלו בקוד הצטרפות חד־פעמי. ב־Mibo אין פרסומות, ואין בה רכיבי פרסום או מעקב. הורים נכנסים עם Google או עם אימייל.

עברית ואנגלית
האפליקציה מתורגמת במלואה לעברית, מימין לשמאל.

חינם ו־Premium
בחינם: ילד אחד, שני הורים, מטלות ללא הגבלה, החיה, הפרסים המובנים ושבעה ימי היסטוריה. Mibo Premium מוסיף עוד ילדים, הורה שלישי, פרסים משלכם, דמי כיס ותשלומים, היסטוריה מלאה ודרישת תמונה — לכל משק הבית. הצד של הילד באפליקציה אף פעם לא נעול.

Mibo Premium הוא מינוי חודשי או שנתי שמתחדש אוטומטית עד שתבטלו אותו ב־Google Play, או רכישה חד־פעמית לכל החיים שאינה מתחדשת. המחירים מוצגים באפליקציה לפני הרכישה. תנאי שימוש: https://mibokids.app/terms  מדיניות פרטיות: https://mibokids.app/privacy
```

## Not localised here

The title and subtitle stay as `docs/spec/05-store-listing.md` fixes them, in English, on the Hebrew listing too. A Hebrew title is an ASO decision the spec has not made; until it does, the `he` listing inherits the default title rather than one invented here.
