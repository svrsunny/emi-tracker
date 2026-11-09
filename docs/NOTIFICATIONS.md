# Reminders and notifications

Both apps share one reminder planner (`reminders.ts` / `Reminders.kt`). It is a pure function
from loan state, settings and delivery history to reminder occurrences, and it is fully unit-tested.

## Reminder types

| Category | When | Dedupe key |
| --- | --- | --- |
| Upcoming EMI | N days before each unpaid installment (default 7, 3, 1; per-loan override) | `emi_upcoming:<loan>:<row>:<due>:<offset>` |
| EMI due today | On the due date | `emi_due:<loan>:<row>:<due>` |
| EMI overdue | After due + grace, repeating every N days up to a maximum | `emi_overdue:<loan>:<row>:<due>:<k>` |
| Missed EMI | Installments you marked missed | `emi_missed:<loan>:<row>:<due>` |
| Upcoming loan closure | N days before the projected last payment | `loan_closure:<loan>:<date>` |
| Monthly summary | 1st of each month | `summary_monthly:<YYYY-MM>` |
| Weekly summary | Configured weekday | `summary_weekly:<ISO week>` |
| Backup reminder | When the last backup is older than N days | `backup:<last>:<n>` |
| Rate / loan change | Day before a future-dated rate, EMI or restructure change | `rate_change:<id>:<date>` |
| Custom | Your own reminders (once, daily, weekly, monthly, yearly; optionally tied to a loan) | `custom:<id>:<date>` |

Reminders are computed from the **current** records each time. Recording a payment, editing a due
date or changing a status immediately changes what is planned. A paid installment produces no more
reminders. Dismissing a reminder never marks an EMI as paid.

## Settings

All categories on or off · days-before offsets · notification time · overdue repeat interval and
maximum count · quiet hours (reminders inside are moved to the end of quiet hours) · allowed
weekdays (others move to the next allowed day) · snooze duration · catch-up window · sound ·
vibration (Android) · priority · channels (native and/or in-app) · per-loan on/off and offsets ·
closure lead time · backup interval · weekly summary day.

## Reliability rules

- **No duplicates.** Every delivery is stored with its dedupe key, and a key is delivered once.
  History is persisted across restarts and synced between devices, so a reminder shown on your PC is
  not repeated on your phone.
- **Snooze** stores `snoozedUntil`; the reminder becomes due again only after that time.
- **Catch-up.** Reminders whose time passed while the app could not run are delivered on the next
  run if they are within the catch-up window (default 3 days), and are marked **delivered late**.
  Older ones are skipped rather than flooding you.
- **In-app inbox.** Every reminder is recorded in *Reminders → Inbox*, even when the operating
  system cannot show it.

## Desktop (Windows) — exact conditions

| Condition | Reminders delivered? |
| --- | --- |
| App window open | Yes, as a Windows toast notification plus in-app |
| Window closed with *Keep running in the tray* on (default) | Yes. The tray process checks every minute |
| *Start with Windows* on (installed app) | Yes after login; the app starts minimized to the tray |
| App quit from the tray | **No.** Reminders resume and catch up on the next start |
| PC asleep or hibernating | **No.** On wake (power resume event) missed reminders within the window are delivered late |
| PC shut down | **No.** Caught up on the next start |
| Windows Focus Assist / Do Not Disturb, or notifications disabled for the app | The banner may be hidden; the reminder is still in the in-app inbox and Windows Action Center |

The desktop app deliberately does not install a Windows Task Scheduler entry or a background
service: delivery requires the app (window or tray) to be running. *Reminders → Diagnostics* shows
whether Windows notifications are available, the last scheduler check, the start-with-Windows state
and the time zone, and has *Send test notification* and *Check reminders now* buttons.

## Android — exact conditions

- **Permission.** On Android 13+ the app asks for `POST_NOTIFICATIONS` during onboarding, with an
  explanation. If you decline, reminders still appear in the in-app inbox, and the Reminders screen
  offers *Allow notifications* and a link to system settings.
- **Channels.** EMI reminders (high), Overdue & missed (high), Summaries & loan events
  (default), Backup reminders (low) and Custom (default). Sound, vibration and importance per
  channel are controlled by you in Android settings and respected by the app.
- **Scheduling.** WorkManager runs a periodic job (about every 15 minutes, the platform minimum)
  plus a one-off run after any change or snooze. WorkManager keeps the job scheduled across
  reboots and app updates; no separate boot receiver is needed.
- **No exact alarms.** `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` are not requested. A loan
  reminder does not justify exact-alarm special access, and the catch-up design handles deferral.
  Reminders can therefore arrive some minutes after the configured time.
- **Doze, battery saver and app standby** may defer background work further, sometimes by hours on
  aggressive OEM builds. The diagnostics screen shows whether battery optimisation is on and links
  to the setting. Deferred reminders are delivered late and flagged as such.
- **Phone off**: nothing is delivered; missed reminders inside the catch-up window arrive after boot.
- Notification actions: *Snooze* (reschedules after the snooze duration) and *Dismiss*. Neither
  changes any payment.

*Reminders → Diagnostics* on Android shows the permission state, each channel's state, battery
optimisation, the last background check and the history size, and has *Send test* and *Check now*.

## Tests

`tests/unit/reminders.test.ts` and `PortfolioTest.reminderPlanning` cover offsets and time,
due-today, overdue repeats with interval and maximum, dedupe, snooze expiry, recalculation after
payment, catch-up and late flags, quiet hours across midnight, weekday shifting, disabled
categories, per-loan opt-out, backup reminders and month-end custom repeats. `DataLayerTest`
(Robolectric) runs the real Android worker logic: delivery without permission (inbox only), no
duplicate on the second run, native delivery once permission is granted, and no reminder after the
installment is paid.

## Your own reminders (no loan needed)

*Reminders → My reminders* (the first tab), the *Add reminder* button on the Reminders page and the
dashboard (desktop), and the bell-plus button on the Android Reminders screen and dashboard all open
the same form: title, a note shown in the notification, date, time, repeat (once, daily, weekly,
monthly, yearly) and an optional linked loan (*None — standalone reminder* by default). They are
delivered like every other reminder (dedupe key `custom:<id>:<date>`), sync between devices, and can
be switched off or deleted.

## Reminders when you add a loan

The loan wizard has a **Reminders** step before the review: *Do you want reminders for this loan's
EMIs?* (yes / no), which days before each EMI (1, 2, 3, 5, 7, 10, 15 or your default), the first
EMI date and due day, and a preview of the next three EMIs with the exact reminder dates and time.
The reminder time itself is global (*Reminders → Settings*).

## Delivered once, even when checks overlap (Android)

The app start, the periodic background job and "check soon" requests can fire together. Background
checks now run one at a time (and a sync started from the screen waits for them), so a reminder is
never delivered twice and a sync merge cannot drop a reminder record written at the same moment.

## Bill reminders

Each bill can remind you N days before its due date (pick from 1, 2, 3, 5, 7 or your default), on the
due day, and once the day after if it is still unpaid (keys `bill:<id>:<date>:<days>`,
`bill_due:<id>:<date>`, `bill_overdue:<id>:<date>`). Marking the due date paid stops them. The
*Bills* category in Reminders → Settings turns all bill reminders on or off.

## Lending & borrowing reminders

An entry with a return-by date and *Remind me* on is reminded the day before (`debt:<id>:<date>:1`), on
the day (`debt_due:<id>:<date>`) and once the day after (`debt_overdue:<id>:<date>`), while money is
still pending. Money lent: "Collect ₹X from <name>"; money borrowed: "Return ₹X to <name>". The
*Lending & borrowing* category in Reminders → Settings turns them all on or off. A one-time expense
that is not yet paid is reminded like a bill.
